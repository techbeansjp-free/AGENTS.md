import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, resolveAsset } from '../lib/paths.js';
import { loadConfig, type AgentSkillChainConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import {
  defaultBranch,
  findIssueWorktree,
  inspectCommitReachability,
  integrationPreservationRef,
  resolveCurrentBranch,
} from '../lib/worktree.js';
import { integrationFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, writeYamlFileAtomic } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { gh, git } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { resolveMergeTarget, checkFreshness, attemptUpdateBranch, MergeFailureClassifier } from '../lib/pr-freshness.js';
import * as rootCleanup from './root-cleanup.js';

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

\`.agent-skill-chain/config/agent-skill-chain.yaml\` の \`merge.autonomous\` が true
（明示opt-in）でない限り、実際のマージは実行せず日本語メッセージで停止する（既定 false）。

\`gh pr merge\` 実行前に、対象PRのhead branchがbase branch（既定ではmain）の最新コミットに
対して最新（behind=0）かどうかを必ず確認する（--admin 等のオプションでも迂回できない）。
最新でない場合、\`merge.auto_update_branch: true\`（既定 false）を明示設定していなければ
最新化を試みず日本語エラーメッセージで中断する。true設定時は update-branch API による
最新化を試み、コンフリクト等で完了できない場合も中断する。対象PRの識別は引数からの明示指定、
または指定が無い場合の暗黙解決に委ねる。暗黙解決はrepoRoot()（進行役が操作するmain
worktree。default branchをチェックアウトしている前提）の現在ブランチに紐づくPRを対象と
する——Issue worktree上で本コマンドを実行した場合でも、対象PRの解決基準はmain worktree
であり、そのIssue worktree自身の現在ブランチではない。いずれの方法でも対象PRを特定
できない場合や最新性確認自体が失敗した場合も、マージを実行せず中断する。

マージ成功後、main worktree（repoRoot()が指す共通作業ツリー。default branchを
チェックアウトしている前提）のローカルブランチを origin/<default-branch> へ
fast-forward同期する（'git fetch origin <default-branch>' + 'git merge --ff-only'相当）。
これは、進行役が短時間に複数PRを連続マージした際、ローカルmainが古いまま残り
（1）後続PRのCIがbase branchをfetchできず恒久失敗する、（2）進行役自身が古いビルド済み
bin/agents-md.jsのままdoctor等を実行し誤った判定結果を得る、という2つの実害を防ぐため。

マージ成功・ローカル同期成功後、同一プロセス内で既存の \`root-cleanup run\`（Issue #208、
ADR-0007）を呼び出し、repoRoot直下に残存するIssueセグメント成果物（SPEC.md/DESIGN.md/
PLAN.md/VALIDATION.md）を検出時のみ自動で検出・削除する（ISSUE-590、ADR-0046）。この
クリーンアップはIssueブランチ自体へは一切commitを追加しない。agent-skill-chain-ci.yml の
必須check「verify-root-clean (merge-ready)」は、draftでないPRのrepoRoot直下に対象4ファイルが
存在する限り常に失敗する設計であるため、validation-gateまで正常に完了したPRであっても
\`pr merge\` の呼び出しには \`--admin\`（必須checkのbypass）を明示する必要がある。

出力:
  マージ自体が失敗した場合: gh pr merge の終了コード・標準エラー出力をそのまま返す
  （ローカル同期・root-cleanup runは実行しない）。
  マージは成功したがローカル同期に失敗した場合（main worktreeがdefault branch以外を
  チェックアウトしている・fast-forward不能なコンフリクトがある等）: 終了コード1以上。
  マージ結果自体は巻き戻さず、日本語のエラーメッセージで手動同期を促す（root-cleanup runは
  実行しない）。
  マージ・ローカル同期には成功したがroot-cleanup runが失敗した場合（human_required等）:
  終了コード1以上。マージ結果自体は巻き戻さず、日本語のエラーメッセージで追加確認を促す。
  既存の非同期root-cleanup workflow（push to main契機）が保険として独立に後追い検出・修復する。
  すべて成功した場合: 終了コード0。
`;

const COMPLETE_USAGE = `
使い方: agent-skill-chain pr complete <issue_id> <merged|closed>

local backend の Integration Record を統合完了状態へ遷移する。Issue ブランチ先端が
default branch または実 remote から到達可能であることを確認できた場合だけ、そのSHAを
head_shaへ記録する。確認できない場合は状態を変更せず、日本語の理由を標準エラー出力へ返す。
`;

interface IntegrationRecord {
  schema_version: string;
  issue_id: string;
  branch: string;
  pr_url?: string;
  status: 'draft' | 'ready_for_review' | 'merged' | 'closed';
  head_sha?: string;
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

export async function complete(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(COMPLETE_USAGE);
      return 0;
    }
    const [issueIdRaw, targetStatus] = args;
    if (!issueIdRaw || (targetStatus !== 'merged' && targetStatus !== 'closed')) {
      throw new CliError('issue_id と status（merged または closed）は必須です');
    }
    const { number } = parseIssueId(issueIdRaw);
    const root = repoRoot();
    const config = loadConfig(root);
    if (config.coordination.backend !== 'local') {
      return fail('pr complete は local backend の Integration Record 専用です');
    }

    const recordPath = integrationFilePath(root, number);
    const record = tryReadYamlFile<IntegrationRecord>(recordPath);
    if (!record) return fail(`Integration Record が見つかりません: ${recordPath}`);
    if (record.status === 'merged' || record.status === 'closed') {
      return fail(`Integration Record は既に完了済みです（status=${record.status}）: ${recordPath}`);
    }

    const entry = findIssueWorktree(root, config, number);
    if (!entry?.branch || entry.branch !== record.branch) {
      return fail(`Integration Record と一致する Issue worktree を確認できません: ${record.branch}`);
    }
    const branchHead = git(['rev-parse', '--verify', `${record.branch}^{commit}`], entry.path);
    if (branchHead.status !== 0) {
      return fail(`統合完了時の Issue ブランチ先端SHAを確認できません: ${record.branch}`);
    }
    const headSha = branchHead.stdout.trim();
    const preservation = inspectCommitReachability(entry.path, headSha);
    if (!preservation.reachable && preservation.reason === 'unreachable') {
      return fail(
        `Integration Record を完了できません。Issue ブランチ先端 ${headSha.slice(0, 12)} は` +
          'remote または統合先から到達できません',
      );
    }
    if (!preservation.reachable) {
      return fail(`Integration Record を完了できません。commitの保全状況を確認できません（${preservation.detail}）`);
    }

    const confirmedHead = git(['rev-parse', '--verify', `${record.branch}^{commit}`], entry.path);
    if (confirmedHead.status !== 0 || confirmedHead.stdout.trim() !== headSha) {
      return fail('保全状況の確認中に Issue ブランチ先端が変化したため、Integration Record を更新しません');
    }
    const completedRecord: IntegrationRecord = { ...record, status: targetStatus, head_sha: headSha };
    const outcome = validateAgainstSchema('integration', completedRecord, root);
    if (!outcome.valid) return fail(`Integration Record がスキーマに適合しません: ${outcome.errors.join('; ')}`);

    const preservationRef = integrationPreservationRef(number);
    const recordPosition = git(['update-ref', preservationRef, headSha], entry.path);
    if (recordPosition.status !== 0) {
      return fail(`確認済みの統合位置を記録できません: ${recordPosition.stderr.trim()}`);
    }

    writeYamlFileAtomic(recordPath, completedRecord);
    return ok(recordPath);
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
  return guard(async () => {
    if (isHelp(args)) {
      printUsage(MERGE_USAGE);
      return 0;
    }

    const root = repoRoot();
    const config = loadConfig(root);
    if (config.merge?.autonomous !== true) {
      return fail(
        [
          '進行役によるPRマージは、人間の明示的な確認を得てから実行するのが既定です。このPRをマージしてよいか、まず人間に確認してください。',
          '人間がこの場でマージを承認した場合は、`gh pr merge` を直接実行するか、そのマージを代行して構いません（本コマンド自体は依然として拒否しますが、`gh pr merge` を直接呼ぶことは制限しません）。',
          '複数PRにわたる自走的なマージ運用が既に人間から許可されている場合は、`.agent-skill-chain/config/agent-skill-chain.yaml` の `merge.autonomous: true` を設定することで、以後このコマンド自体でもマージできるようになります。',
        ].join('\n'),
      );
    }

    // Issue #493: --admin 等のオプションでも迂回できない、gh pr merge 実行前の必須最新性チェック。
    const { target, repoOverride } = resolveMergeTarget(args, root);
    if (target === undefined) {
      return fail(
        '対象PRを特定できませんでした。引数にPR番号・URL・ブランチのいずれも含まれておらず、' +
          'cwdの現在ブランチに紐づくPRの暗黙解決にも失敗しました。PR番号を明示するか、' +
          '対象PRのブランチ上で実行してください。',
      );
    }

    const initial = checkFreshness(root, target, repoOverride);
    if (initial.status === 'check_failed') {
      return fail(
        `対象PR（${target}）の最新性確認自体が失敗しました（GitHub APIエラー等）。マージを実行せず中断します。`,
      );
    }
    // Issue #493実装ゲート3回目是正: attemptUpdateBranch()側のnot_applicable（ポーリング中に
    // 対象PRがOPENでなくなった場合）には専用メッセージがあるのに対し、この初回判定側
    // （対象PRが最初からOPENでない場合）には無く一貫性を欠いていた
    // （not-applicable-status-unhandled-in-merge）。ここで扱わなくても後続のgh pr merge自体が
    // 同じ理由で失敗しその終了コード・標準エラー出力がそのまま返るため安全側だが、原因を
    // 早期かつ一貫した日本語メッセージで伝えるためここで明示的に扱う。
    if (initial.status === 'not_applicable') {
      return fail(
        `対象PR（${target}）が既にクローズ・マージ済みのため最新性確認を行えません。マージを実行せず中断します。`,
      );
    }
    if (initial.status === 'behind') {
      if (config.merge?.auto_update_branch !== true) {
        return fail(
          [
            `対象PR（${target}）のhead branchがbase branchの最新コミットに対して最新ではありません（behind）。`,
            'このままではマージを実行しません。対象PRブランチをbase branchへ追随させたうえで再実行するか、',
            '`.agent-skill-chain/config/agent-skill-chain.yaml` の `merge.auto_update_branch: true` で',
            '自動最新化を明示的に有効化してください（既定は無効です）。',
            '進行役がこの設定を有効化する、または update-branch API を直接呼び出すことは、ローカルでコミットを作成せず GitHub 側でサーバーサイドのマージ／調整状態操作を行うため、I5 違反ではありません。',
          ].join('\n'),
        );
      }
      // Issue #493実装ゲート是正: update-branch REST APIは数値PR番号のパスセグメントを要求する。
      // `target`（PR番号／URL／ブランチ名のいずれもあり得る）をそのまま渡すと、対象識別子が
      // 数値のPR番号でない場合に不正なAPIパスとなり常に失敗するため、`checkFreshness()` が
      // `gh pr view` から取得した実際のPR番号（`initial.prNumber`）へ正規化してから渡す
      // （findings update-branch-target-not-pr-number / update-branch-non-numeric-target）。
      if (initial.prNumber === undefined) {
        return fail(
          `対象PR（${target}）のPR番号を特定できなかったため、自動最新化を実行できません。マージを実行せず中断します。`,
        );
      }
      // Issue #493実装ゲート2回目是正: `repoOverride`（`-R`由来のヒント値）ではなく、
      // `checkFreshness()` が `gh pr view` の応答から導出した対象PRの実際の所属リポジトリ
      // （`initial.repo`）を使う。fork由来PRやcwdの既定リポジトリと異なるリポジトリを指す
      // PR URLを対象指定した場合でも、常に正しいリポジトリへupdate-branchを呼ぶため。
      const update = attemptUpdateBranch(root, initial.prNumber, initial.repo);
      if (update.status === 'not_applicable') {
        return fail(`対象PR（${target}）が処理中にクローズ・マージされたため最新化を中断しました。`);
      }
      if (update.status !== 'updated') {
        return fail(
          `対象PR（${target}）の自動最新化に失敗しました（コンフリクト、またはポーリング上限到達まで反映されませんでした）。` +
            'マージを実行せず中断します。手動で対象PRブランチを最新化してください。',
        );
      }
    }

    const result = gh(['pr', 'merge', ...args], root);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status !== 0) {
      if (result.stderr) process.stderr.write(result.stderr);
      if (MergeFailureClassifier.classifyMergeFailure(result.stderr) === 'ambiguous') {
        process.stderr.write(
          '対象PRの最新性チェックを通過した後にマージ自体が失敗しました。確認からマージ実行までの間に' +
            '別のマージが成立した可能性（TOCTOU競合）を含め、原因を確認してください。\n',
        );
      }
      return result.status;
    }
    if (result.stderr) process.stderr.write(result.stderr);

    // Issue #493実装ゲート是正: 確認通過後のベストエフォート事後検知は撤去した。コンフリクトの
    // 無い通常の成功マージであっても、マージ自体がbase branchの先端を必ず前進させるため、単純な
    // 事後baseRefOid比較では正常なマージのたびに誤検知（狼少年化）が発生する欠陥があった。
    // マージ成立後に生成された実コミットの親SHAまで遡って比較する代替も検討したが、マージ手法
    // （マージコミット／squash／rebase）ごとに親構造が異なり実装・検証コストが高い一方、この
    // 検知はいずれもベストエフォート（最新性保証自体は担わない付加的な観測性強化）であったため、
    // 多段防御は「fresh判定からgh pr merge呼び出しまでの間隔最小化」のみで構成する。

    const syncStatus = syncMainWorktree(root);
    if (syncStatus !== 0) return syncStatus;

    // ISSUE-590/ADR-0046: マージ・ローカル同期成功後、既存のroot-cleanup run（Issue #208、
    // 無変更のまま再利用）を同一プロセス内で呼び出し、repoRoot直下に残存するIssueセグメント
    // 成果物を検出時のみ自動削除する。Issueブランチ自体へは削除commitを追加しない（run()の
    // 既存動作）。run()が非0を返した場合（human_required等）も、マージ自体は既に成功済みで
    // あり取り消さない。既存の非同期root-cleanup workflow（push to main契機、不変）が保険として
    // 独立に後追い検出・修復するため、ここでの失敗はAC-3・AC-5の実効性を損なわない。
    const cleanupStatus = await rootCleanup.run([]);
    if (cleanupStatus !== 0) {
      return fail(
        'PRのマージとmain worktreeの同期には成功しましたが、root直下混入ファイルの自動クリーンアップ' +
          '（root-cleanup run）に失敗しました。上記の出力を確認し、必要な追加対応を行ってください。' +
          '既存の非同期 root-cleanup workflow（push to main契機）が保険として独立に後追いで検出・修復するため、' +
          'マージ結果自体は巻き戻りません。',
      );
    }
    return 0;
  });
}
