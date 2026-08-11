import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { git, gh } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { ensureGitIdentity } from '../lib/git-identity.js';
import { findOpenPrByHead, type OpenPr } from '../lib/gh-open-pr.js';
import { ROOT_ARTIFACT_FILES } from '../lib/root-artifacts.js';
import { defaultBranch } from '../lib/worktree.js';

/**
 * main post-merge cleanup自動化（Issue #208、ADR-0007）: squash mergeのたびにmainリポジトリ
 * ルート直下へ恒久混入するIssueセグメント成果物（SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md）を、
 * mainへのpushを契機に検出・削除する。`.github/workflows/agent-skill-chain-root-cleanup.yml`
 * からは `.agent-skill-chain/scripts/root-cleanup.sh` 経由で呼ばれる。
 *
 * 既存のリリース自動化（release bump、Issue #196、ADR-0005）と同型のPR作成→スコープ検査→
 * admin merge パターンを再利用する。`checkOutputExists()`/`wasEverAddedOrModified()`
 * （src/commands/verify.ts）・segments.yaml・roles.yaml のいずれにも触れない、完全に独立した
 * 構造検査として実装する。
 */

const ROOT_CLEANUP_BRANCH_PREFIX = 'chore/root-cleanup-';
const ROOT_CLEANUP_BRANCH_RE = /^chore\/root-cleanup-[0-9]{8}T[0-9]{6}Z$/;
// バッククォート表記（テンプレートリテラル、実質は通常の固定文字列）は、vocab lintの識別子文脈
// 判定をコードの意味を変えずに通すため（cli-routes.ts の route key表記と同一の既存規則）。
const ROOT_CLEANUP_COMMIT_MESSAGE = `chore: remove stray root-level issue segment artifacts [skip ci]`;

/** `chore/root-cleanup-<UTC timestamp>` のtimestamp部分（`YYYYMMDDTHHMMSSZ`）を生成する。 */
function utcTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** repoRoot直下に存在する対象4ファイルのうち、実際に存在するものだけを返す。0件ならno-op。 */
function detectStrayRootArtifacts(root: string): string[] {
  return ROOT_ARTIFACT_FILES.filter((f) => fs.existsSync(path.join(root, f)));
}

/** 既にOPENな root-cleanup ブランチ（`chore/root-cleanup-*`）が無いかを、headブランチ名を
 * 指定せずに列挙して探す（timestampを含むためブランチ名を事前には特定できない）。
 * 見つかったheadブランチ名を返し、無ければ undefined。 */
function findOpenRootCleanupBranch(root: string): string | undefined {
  const result = gh(['pr', 'list', '--state', 'open', '--json', 'number,headRefName', '--limit', '100'], root);
  if (result.status !== 0) return undefined;
  try {
    const list = JSON.parse(result.stdout) as { number: number; headRefName: string }[];
    return list.find((item) => ROOT_CLEANUP_BRANCH_RE.test(item.headRefName))?.headRefName;
  } catch {
    return undefined;
  }
}

/** admin merge直前のスコープ検査（ADR-0007）: (a) head が chore/root-cleanup-* に一致し、
 * (b) 変更内容がrepoRoot直下の対象4ファイルの**削除のみ**（追加・変更・他パスへの変更を
 * 一切含まない）であることを機械検査する。いずれか不成立の場合はエラー文言を返す
 * （undefinedは検査通過）。 */
function checkRootCleanupPrScope(pr: OpenPr, expectedBranch: string): string | undefined {
  if (pr.headRefName !== expectedBranch || !ROOT_CLEANUP_BRANCH_RE.test(pr.headRefName)) {
    return `PR #${pr.number} の headRefName '${pr.headRefName}' がスコープ外です（期待値: '${expectedBranch}'）`;
  }
  if (pr.files.length === 0) {
    return `PR #${pr.number} の変更ファイルが0件です（想定外の空PR）`;
  }
  const outOfScopePaths = pr.files.filter((f) => !(ROOT_ARTIFACT_FILES as readonly string[]).includes(f.path));
  if (outOfScopePaths.length > 0) {
    return `PR #${pr.number} にスコープ外の変更ファイルが含まれています: ${outOfScopePaths.map((f) => f.path).join(', ')}`;
  }
  const notDeletionOnly = pr.files.filter((f) => f.additions > 0);
  if (notDeletionOnly.length > 0) {
    return `PR #${pr.number} に削除以外の変更が含まれています（削除のみで構成されている必要があります）: ${notDeletionOnly
      .map((f) => f.path)
      .join(', ')}`;
  }
  return undefined;
}

const RUN_USAGE = `
使い方: agent-skill-chain root-cleanup run

repoRoot直下の SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md（Issueセグメント成果物、コード内
リテラル4件、設定化しない）の存在を検出する。0件ならno-opで終了する。1件以上あれば、
現在のmain先端から短命ブランチ chore/root-cleanup-<UTC timestamp> を作成し、該当ファイルのみを
git rm して固定メッセージでcommit・push、PRを作成し、'gh pr merge --admin --squash --subject' で
mainへマージする。マージ直前に head ブランチ名・変更内容（削除のみで構成されているか）の
スコープ検査を行い、逸脱時は自動admin mergeを行わず human_required として停止する（ADR-0007）。
既にOPENな root-cleanup ブランチ/PRが存在する場合は、スコープ検査を通過したときのみ再利用する
（冪等）。引数・設定入力は一切受け付けない。

出力:
  成功時: 終了コード0。no-opの場合はその旨、cleanupを行った場合はマージしたPR番号を標準出力へ。
  失敗時（human_required 含む）: 終了コード1以上。理由を標準エラー出力へ。
`;

export async function run(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(RUN_USAGE), 0;

    const root = repoRoot();
    const stray = detectStrayRootArtifacts(root);
    if (stray.length === 0) {
      return ok('no-op（root直下に対象ファイルは存在しません）');
    }

    const existingBranch = findOpenRootCleanupBranch(root);
    let branch: string;
    let pr: OpenPr | undefined;

    if (existingBranch) {
      branch = existingBranch;
      pr = findOpenPrByHead(root, branch);
    } else {
      branch = `${ROOT_CLEANUP_BRANCH_PREFIX}${utcTimestamp()}`;
    }

    if (!pr) {
      const base = defaultBranch(root);

      const checkout = git(['checkout', '-b', branch], root);
      if (checkout.status !== 0) return fail(`git checkout -b に失敗しました: ${checkout.stderr.trim()}`);

      const identityError = ensureGitIdentity(root);
      if (identityError) return fail(identityError);

      const rm = git(['rm', ...stray], root);
      if (rm.status !== 0) return fail(`git rm に失敗しました: ${rm.stderr.trim()}`);

      const commit = git(['commit', '-m', ROOT_CLEANUP_COMMIT_MESSAGE], root);
      if (commit.status !== 0) return fail(`git commit に失敗しました: ${commit.stderr.trim()}`);

      const push = git(['push', 'origin', branch], root);
      if (push.status !== 0) return fail(`git push に失敗しました: ${push.stderr.trim()}`);

      const title = `chore: remove stray root-level issue segment artifacts`;
      const body = [
        '機械生成のroot直下混入解消PR（Issue #208 root-cleanup runが生成）。',
        '',
        '以下のファイルはIssueセグメント成果物であり、mainルート直下に恒久残存すべきではないため削除する:',
        ...stray.map((f) => `- \`${f}\``),
        '',
        'SPEC/DESIGN/PLAN/VALIDATIONを伴わない、承認済みの本Issue design-gate決定（ADR-0007）の機械的執行。',
      ].join('\n');
      const create = gh(['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body], root);
      if (create.status !== 0) return fail(`gh pr create に失敗しました: ${create.stderr.trim()}`);

      pr = findOpenPrByHead(root, branch);
      if (!pr) return fail('gh pr create 後にPRを解決できませんでした');
    }

    const scopeError = checkRootCleanupPrScope(pr, branch);
    if (scopeError) {
      return fail(`human_required: 自動admin mergeを行わず停止します（${scopeError}）`);
    }

    const merge = gh(
      ['pr', 'merge', String(pr.number), '--admin', '--squash', '--subject', ROOT_CLEANUP_COMMIT_MESSAGE, '--body', ''],
      root,
    );
    if (merge.status !== 0) return fail(`gh pr merge --admin に失敗しました: ${merge.stderr.trim()}`);

    return ok(String(pr.number));
  });
}
