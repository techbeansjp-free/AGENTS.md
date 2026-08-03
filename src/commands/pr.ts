import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, resolveAsset } from '../lib/paths.js';
import { loadConfig, type AgentSkillChainConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { defaultBranch, findIssueWorktree, resolveCurrentBranch } from '../lib/worktree.js';
import { integrationFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, writeYamlFileAtomic } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { gh, git } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain pr create <issue_id> <branch>

branch: Draft PR / Integration Recordの対象ブランチ名

出力:
  成功時: 終了コード0。作成したPR URLまたはIntegration Recordパスを標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
`;

const MERGE_USAGE = `
使い方: agent-skill-chain pr merge <gh pr merge に渡す引数...>

引数はすべて \`gh pr merge\` へ透過的に渡す（--squash・--admin・--delete-branch等、
既存のマージ方式・オプションをそのまま利用できる）。

マージ成功後、main worktree（repoRoot()が指す共通作業ツリー。default branchを
チェックアウトしている前提）のローカルブランチを origin/<default-branch> へ
fast-forward同期する（'git fetch origin <default-branch>' + 'git merge --ff-only'相当）。
これは、進行役が短時間に複数PRを連続マージした際、ローカルmainが古いまま残り
（1）後続PRのCIがbase branchをfetchできず恒久失敗する、（2）進行役自身が古いビルド済み
bin/agents-md.jsのままdoctor等を実行し誤った判定結果を得る、という2つの実害を防ぐため。

出力:
  マージ自体が失敗した場合: gh pr merge の終了コード・標準エラー出力をそのまま返す
  （ローカル同期は実行しない）。
  マージは成功したがローカル同期に失敗した場合（main worktreeがdefault branch以外を
  チェックアウトしている・fast-forward不能なコンフリクトがある等）: 終了コード1以上。
  マージ結果自体は巻き戻さず、日本語のエラーメッセージで手動同期を促す。
  すべて成功した場合: 終了コード0。
`;

interface IntegrationRecord {
  schema_version: string;
  issue_id: string;
  branch: string;
  pr_url?: string;
  status: 'draft' | 'ready_for_review' | 'merged' | 'closed';
  closes: string;
  gates: {
    spec: 'pending' | 'approved' | 'rejected';
    design: 'pending' | 'approved' | 'rejected';
    implementation: 'pending' | 'approved' | 'rejected';
    validation: 'pending' | 'approved' | 'rejected';
  };
}

/**
 * `## <heading>` セクションの本文（次の `## ` 見出し直前まで）を抜き出す。見つからなければ undefined。
 * 正規表現の `$`（マルチライン）は空行位置でも zero-width match してしまい本文が空扱いになる
 * バグを避けるため、`indexOf` による文字列走査で実装する。
 */
function extractSection(text: string, heading: string): string | undefined {
  const marker = `## ${heading}`;
  const markerStart = text.indexOf(marker);
  if (markerStart === -1) return undefined;
  const lineEnd = text.indexOf('\n', markerStart);
  const bodyStart = lineEnd === -1 ? text.length : lineEnd + 1;
  const nextHeadingOffset = text.slice(bodyStart).indexOf('\n## ');
  const bodyEnd = nextHeadingOffset === -1 ? text.length : bodyStart + nextHeadingOffset;
  const body = text.slice(bodyStart, bodyEnd).trim();
  return body.length > 0 ? body : undefined;
}

/** `- <label>: <value>` 形式の箇条書き行から value を抜き出す。見つからなければ undefined。 */
function extractBulletValue(text: string, label: string): string | undefined {
  const regex = new RegExp(`^- ${label}:\\s*(.+)$`, 'm');
  const match = regex.exec(text);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** `## <heading>` 直後のプレースホルダ行（`<...>`）を value に置き換える。value が無ければ本文を変更しない。 */
function fillSection(body: string, heading: string, value: string | undefined): string {
  if (!value) return body;
  const regex = new RegExp(`(## ${heading}\\n\\n)<[^\\n]*>`);
  return body.replace(regex, (_match, prefix: string) => `${prefix}${value}`);
}

/**
 * DESIGN.md「PR本文組み込み方式」節に従い、PRテンプレートの5節（変更概要／理由／影響範囲／
 * ロールバック方針／成果物リンク）のうち、pr create実行時点で自動充填可能な範囲を埋める。
 * SPEC.md/DESIGN.mdが読めない・見出しが見つからない場合は該当節のプレースホルダをそのまま残す
 * （例外を投げてpr create自体を失敗させない）。
 */
function buildIssueBody(
  root: string,
  config: AgentSkillChainConfig,
  number: string,
  templateBody: string,
): string {
  let body = templateBody.replace('Closes #<issue-id>', `Closes #${number}`);

  const entry = findIssueWorktree(root, config, number);
  if (!entry) return body;

  const specPath = path.join(entry.path, 'SPEC.md');
  if (fs.existsSync(specPath)) {
    const specText = fs.readFileSync(specPath, 'utf8');
    const titleMatch = /^#\s*SPEC:\s*(.+)$/m.exec(specText);
    body = fillSection(body, '変更概要', titleMatch?.[1]?.trim());
    body = fillSection(body, '理由', extractSection(specText, '目的・背景'));
  }

  const designPath = path.join(entry.path, 'DESIGN.md');
  if (fs.existsSync(designPath)) {
    const designText = fs.readFileSync(designPath, 'utf8');
    const rollbackSection = extractSection(designText, '障害・ロールバック考慮');
    if (rollbackSection) {
      body = fillSection(body, '影響範囲', extractBulletValue(rollbackSection, '影響を受ける既存機能'));
      body = fillSection(body, 'ロールバック方針', extractBulletValue(rollbackSection, 'ロールバック手順'));
    }
  }

  const artifactNames = ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md'].filter((name) =>
    fs.existsSync(path.join(entry.path, name)),
  );
  if (artifactNames.length > 0) {
    body = fillSection(body, '成果物リンク', artifactNames.map((name) => `- \`${name}\``).join('\n'));
  }

  return body;
}

export async function create(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [issueIdRaw, branch] = args;
    if (!issueIdRaw || !branch) throw new CliError('issue_id, branch はすべて必須です');
    const { issueId, number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    if (config.coordination.backend === 'local') {
      const existing = tryReadYamlFile<IntegrationRecord>(integrationFilePath(root, number));
      if (existing) {
        return fail(`Integration Record は既に存在します（status=${existing.status}）: ${integrationFilePath(root, number)}`);
      }
      const record: IntegrationRecord = {
        schema_version: 'agent-skill-chain/integration/v1',
        issue_id: issueId,
        branch,
        status: 'draft',
        closes: issueId,
        gates: { spec: 'pending', design: 'pending', implementation: 'pending', validation: 'pending' },
      };
      const outcome = validateAgainstSchema('integration', record, root);
      if (!outcome.valid) return fail(`Integration Record がスキーマに適合しません: ${outcome.errors.join('; ')}`);
      const dest = integrationFilePath(root, number);
      writeYamlFileAtomic(dest, record);
      return ok(dest);
    }

    const base = defaultBranch(root);
    const title = `${issueId}: ${branch.replace(/^[a-z]+\//, '').replace(/-/g, ' ')}`;

    // PRテンプレート（変更概要・理由・影響範囲・ロールバック方針・成果物リンクの5節）を
    // 反映した本文を組み立てる。テンプレート自体が読めない場合（配布同期前等）は、
    // Issue #174着手前と同一の `Closes #<id>` のみの本文にフォールバックする。
    let body = `Closes #${number}`;
    try {
      const templatePath = resolveAsset(path.join('templates', 'github', '.github', 'pull_request_template.md'), root);
      const templateBody = fs.readFileSync(templatePath, 'utf8');
      body = buildIssueBody(root, config, number, templateBody);
    } catch {
      // フォールバック維持（本文は `Closes #${number}` のまま）。
    }

    const result = gh(
      ['pr', 'create', '--draft', '--head', branch, '--base', base, '--title', title, '--body', body],
      root,
    );
    if (result.status !== 0) return fail(`gh pr create に失敗しました: ${result.stderr.trim()}`);
    return ok(result.stdout.trim());
  });
}

/**
 * マージ成功後、main worktree（`repoRoot()` が指す共通作業ツリー）のローカル default branch を
 * `origin/<default-branch>` へ fast-forward 同期する。
 *
 * default branch が main worktree で現在チェックアウトされていない場合、`git fetch` の
 * refspec 経由の直接更新（checkout不要な同期）は「チェックアウト中のブランチは他ブランチからの
 * refspec更新を拒否する」gitの安全策とは別の問題として、そもそも「進行役のmain worktreeが
 * defaultブランチ上にある」という前提（本Issueが解決しようとしている実害の発生条件そのもの）が
 * 崩れていることを意味するため、暗黙に切り替えず明示エラーで停止し人間判断へ委ねる。
 */
function syncMainWorktree(root: string): number {
  let base: string;
  try {
    base = defaultBranch(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(
      `PRのマージ自体は成功しましたが、同期先のdefault branchを特定できませんでした: ${message}。` +
        `${root} にて手動で同期してください。`,
    );
  }

  const currentBranch = resolveCurrentBranch(root);
  if (currentBranch !== base) {
    return fail(
      `PRのマージ自体は成功しましたが、main worktree（${root}）が default branch（${base}）を` +
        `チェックアウトしていない（現在: ${currentBranch ?? '不明'}）ため、ローカル同期を行いませんでした。` +
        `手動で ${root} にて ${base} へ切り替えたうえで 'git pull --ff-only' を実行してください。`,
    );
  }

  const fetchResult = git(['fetch', 'origin', base], root);
  if (fetchResult.status !== 0) {
    return fail(
      `PRのマージ自体は成功しましたが、'git fetch origin ${base}' に失敗しました: ` +
        `${fetchResult.stderr.trim()}。${root} にて手動で同期してください。`,
    );
  }

  const mergeResult = git(['merge', '--ff-only', `origin/${base}`], root);
  if (mergeResult.status !== 0) {
    return fail(
      `PRのマージ自体は成功しましたが、main worktree（${root}）の ${base} を ` +
        `origin/${base} へ fast-forward 同期できませんでした: ${mergeResult.stderr.trim()}。` +
        `コンフリクト等が疑われます。${root} にて手動で対応してください。`,
    );
  }

  return ok(`main worktree（${root}）の ${base} を origin/${base} へ同期しました。`);
}

export async function merge(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(MERGE_USAGE);
      return 0;
    }

    const root = repoRoot();
    const result = gh(['pr', 'merge', ...args], root);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) return result.status;

    return syncMainWorktree(root);
  });
}
