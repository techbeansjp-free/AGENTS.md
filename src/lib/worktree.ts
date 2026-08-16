import path from 'node:path';
import { git } from './exec.js';
import { expandPattern } from './pattern.js';
import { formatToRegex } from './timestamp.js';
import type { AgentSkillChainConfig } from './config.js';

export interface WorktreeEntry {
  path: string;
  head: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
  prunable?: boolean;
}

export type IssueWorktreeResolution =
  | { status: 'found'; worktree: WorktreeEntry }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidatePaths: string[] };

/**
 * worktree の正本は `git worktree list --porcelain` であり、.worktrees/ 配下の
 * ディレクトリ走査ではない（standards/GIT_CONVENTIONS.md が定めるworktreeの正本の定義）。
 */
export function listWorktrees(repoRoot: string): WorktreeEntry[] {
  const result = git(['worktree', 'list', '--porcelain'], repoRoot);
  if (result.status !== 0) {
    throw new Error(`git worktree list --porcelain に失敗しました: ${result.stderr.trim()}`);
  }
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> | undefined;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current?.path) entries.push(current as WorktreeEntry);
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ')) {
      if (current) current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      if (current) current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'bare') {
      if (current) current.bare = true;
    } else if (line === 'detached') {
      if (current) current.detached = true;
    } else if (line.startsWith('prunable')) {
      if (current) current.prunable = true;
    }
  }
  if (current?.path) entries.push(current as WorktreeEntry);
  return entries;
}

export function hasUncommittedChanges(worktreePath: string): boolean {
  const result = git(['status', '--porcelain'], worktreePath);
  return result.stdout.trim().length > 0;
}

/**
 * リポジトリのデフォルトブランチ名を解決する。`actions/checkout@v4` は既定で
 * `fetch-depth: 1` かつPRのマージrefのみをフェッチするため、`origin/HEAD` のsymrefは
 * 設定されず、`main`/`master` のローカルrefも（フェッチ対象外のため）存在しない。
 * この場合 GitHub Actions が pull_request イベントで設定する `GITHUB_BASE_REF`
 * （PRのbaseブランチ名）を代替のブランチ名ソースとして使う。
 *
 * `resolveCurrentBranchInfo` の `GITHUB_HEAD_REF` フォールバックと同一パターン。
 *
 * `GITHUB_BASE_REF` はブランチ名文字列に過ぎず、それ自体がローカルで解決可能なrefである保証は
 * ない（PR #172 run 29717941752 で実落ち：`agent-skill-chain-ci.yml` がbaseブランチを
 * フェッチしていなかったため `git diff base...HEAD` がref解決不能で失敗した）。ワークフロー側で
 * `git fetch origin <base>:refs/remotes/origin/<base>` を実行済みであれば `origin/<base>` が
 * 解決可能になるため、その形を優先して返す。ローカル開発機で `GITHUB_BASE_REF` を手動設定した
 * だけのケース（`origin/<base>` 側は未フェッチ）まで壊さないよう、解決できなければ素の値へ
 * フォールバックする（既存挙動を保つ）。
 */
export function defaultBranch(repoRoot: string): string {
  const symbolic = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot);
  if (symbolic.status === 0) {
    return symbolic.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
  }
  for (const candidate of ['main', 'master']) {
    if (git(['rev-parse', '--verify', candidate], repoRoot).status === 0) return candidate;
  }
  if (process.env.GITHUB_BASE_REF) {
    const base = process.env.GITHUB_BASE_REF;
    const remoteRef = `origin/${base}`;
    if (git(['rev-parse', '--verify', remoteRef], repoRoot).status === 0) return remoteRef;
    return base;
  }
  throw new Error('デフォルトブランチを特定できません（origin/HEAD 未設定・main/master 不在）');
}

export interface CurrentBranchInfo {
  /**
   * 解決されたブランチ名。通常チェックアウトなら実ブランチ名、detached HEAD状態では
   * `GITHUB_HEAD_REF` から取得したブランチ名、いずれからも得られない場合は undefined。
   */
  branch: string | undefined;
  /** `git rev-parse --abbrev-ref HEAD` が文字列 "HEAD" を返す（detached HEAD状態）かどうか。 */
  detached: boolean;
}

/**
 * 現在のHEADのブランチ名を解決する（詳細版）。`git rev-parse --abbrev-ref HEAD` は通常
 * チェックアウトでは実ブランチ名を返すが、`actions/checkout@v4` が pull_request イベントで
 * PRのマージrefをdetached HEADでチェックアウトする場合（`switching to 'refs/remotes/pull/<n>/merge'`）
 * は文字列 "HEAD" しか返らない。この場合 GitHub Actions が設定する `GITHUB_HEAD_REF`
 * （PRのheadブランチ名）を代替のブランチ名ソースとして使う。`git rev-parse` 自体が失敗する場合
 * （gitリポジトリでない等）は undefined を返す。
 *
 * `findIssueWorktree` のdetached HEAD対応と `verify branch-name`/`checkpoint` の
 * 「現在のブランチ名」解決は同一ロジックであるため、本関数を唯一の実装として共有する。
 */
export function resolveCurrentBranchInfo(root: string): CurrentBranchInfo | undefined {
  const result = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  if (result.status !== 0) return undefined;
  const rawBranch = result.stdout.trim();
  const detached = rawBranch === 'HEAD';
  const branch = detached ? process.env.GITHUB_HEAD_REF || undefined : rawBranch;
  return { branch, detached };
}

/**
 * 現在のHEADのブランチ名のみを解決する薄いラッパー。detached HEAD状態では `GITHUB_HEAD_REF` へ
 * フォールバックし、それも無ければ undefined を返す。呼び出し元は undefined を
 * 「ブランチ名を解決できない」ケースとして明示的にハンドリングすること。
 */
export function resolveCurrentBranch(root: string): string | undefined {
  return resolveCurrentBranchInfo(root)?.branch;
}

/**
 * Issue #692: cleanupが保全すべきなのは「一度もpushされていないcommit」である。
 * squash/rebase後の内容一致ではpush実績を立証できないため、実remoteと一致する
 * remote-tracking refとそのpush reflog、または呼び出し元がPRから取得したhead SHAだけを
 * push済み位置の根拠にする。
 */
export type UnpushedCommitCheck =
  | { hasUnpushedCommits: false }
  | { hasUnpushedCommits: true; reason: 'unpreserved_commits'; commitShas: string[] }
  | { hasUnpushedCommits: true; reason: 'indeterminate'; detail: string };

export function inspectUnpushedCommits(
  worktreePath: string,
  branch: string,
  knownPushedCommit?: string,
): UnpushedCommitCheck {
  if (knownPushedCommit) {
    const known = commitsAfterPushedPosition(worktreePath, branch, knownPushedCommit);
    if ('detail' in known) return { hasUnpushedCommits: true, reason: 'indeterminate', detail: known.detail };
    return known.commitShas.length === 0
      ? { hasUnpushedCommits: false }
      : { hasUnpushedCommits: true, reason: 'unpreserved_commits', commitShas: known.commitShas };
  }

  const remoteRefs = git(
    ['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/remotes'],
    worktreePath,
  );
  if (remoteRefs.status !== 0) {
    return { hasUnpushedCommits: true, reason: 'indeterminate', detail: 'remote-tracking refを列挙できません' };
  }

  const remotes = git(['remote'], worktreePath);
  if (remotes.status !== 0) {
    return { hasUnpushedCommits: true, reason: 'indeterminate', detail: 'リモート一覧を取得できません' };
  }
  const remoteNames = remotes.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  const pushedPositions: string[] = [];
  for (const line of remoteRefs.stdout.split('\n').filter(Boolean)) {
    const [refName, localSha] = line.split('\t');
    const remote = remoteNames.find((name) => refName.startsWith(`refs/remotes/${name}/`));
    if (!remote) continue;
    const remoteBranch = refName.slice(`refs/remotes/${remote}/`.length);
    if (!remoteBranch || remoteBranch === 'HEAD') continue;

    const relation = commitRelation(worktreePath, branch, localSha);
    const reflog = git(['reflog', 'show', '--format=%H%x09%gs', refName], worktreePath);
    const reflogPositions =
      reflog.status === 0
        ? reflog.stdout
            .split('\n')
            .map((entry) => entry.split('\t'))
            .filter((entry) => entry.length >= 2 && entry.slice(1).join('\t').includes('update by push'))
            .map(([sha]) => sha)
            .filter((sha) => commitRelation(worktreePath, branch, sha) !== 'unrelated')
        : [];
    if (relation === 'unrelated' && reflogPositions.length === 0) continue;

    const live = git(['ls-remote', '--exit-code', remote, `refs/heads/${remoteBranch}`], worktreePath);
    if (live.status !== 0) {
      if (live.status === 2) continue;
      return {
        hasUnpushedCommits: true,
        reason: 'indeterminate',
        detail: `実リモート ${remote} の ${remoteBranch} を確認できません`,
      };
    }
    const liveSha = live.stdout.trim().split(/\s+/)[0];
    if (liveSha !== localSha) continue;
    pushedPositions.push(localSha, ...reflogPositions);
  }

  let closest: { sha: string; commitShas: string[] } | undefined;
  for (const pushedPosition of new Set(pushedPositions)) {
    const after = commitsAfterPushedPosition(worktreePath, branch, pushedPosition);
    if ('detail' in after) continue;
    if (!closest || after.commitShas.length < closest.commitShas.length) {
      closest = { sha: pushedPosition, commitShas: after.commitShas };
    }
  }
  if (closest) {
    return closest.commitShas.length === 0
      ? { hasUnpushedCommits: false }
      : { hasUnpushedCommits: true, reason: 'unpreserved_commits', commitShas: closest.commitShas };
  }

  return unpreservedCommitsSinceDefaultBranch(worktreePath, branch);
}

export function hasUnpushedCommits(worktreePath: string, branch: string, knownPushedCommit?: string): boolean {
  return inspectUnpushedCommits(worktreePath, branch, knownPushedCommit).hasUnpushedCommits;
}

type CommitRelation = 'branch_contains_position' | 'position_contains_branch' | 'unrelated';

function commitRelation(worktreePath: string, branch: string, position: string): CommitRelation {
  const positionBeforeBranch = git(['merge-base', '--is-ancestor', position, branch], worktreePath);
  if (positionBeforeBranch.status === 0) return 'branch_contains_position';
  const branchBeforePosition = git(['merge-base', '--is-ancestor', branch, position], worktreePath);
  if (branchBeforePosition.status === 0) return 'position_contains_branch';
  return 'unrelated';
}

function commitsAfterPushedPosition(
  worktreePath: string,
  branch: string,
  pushedPosition: string,
): { commitShas: string[] } | { detail: string } {
  const exists = git(['rev-parse', '--verify', `${pushedPosition}^{commit}`], worktreePath);
  if (exists.status !== 0) return { detail: `push済みcommit ${pushedPosition.slice(0, 12)} を解決できません` };

  const relation = commitRelation(worktreePath, branch, pushedPosition);
  if (relation === 'position_contains_branch') return { commitShas: [] };
  if (relation === 'unrelated') {
    return { detail: `push済みcommit ${pushedPosition.slice(0, 12)} と作業ブランチの関係を確定できません` };
  }

  const commits = git(['rev-list', '--reverse', `${pushedPosition}..${branch}`], worktreePath);
  if (commits.status !== 0) return { detail: 'push済み位置より後のcommitを列挙できません' };
  return { commitShas: commits.stdout.split('\n').map((line) => line.trim()).filter(Boolean) };
}

function unpreservedCommitsSinceDefaultBranch(worktreePath: string, branch: string): UnpushedCommitCheck {
  let base: string;
  try {
    base = defaultBranch(worktreePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { hasUnpushedCommits: true, reason: 'indeterminate', detail };
  }
  const mergeBase = git(['merge-base', branch, base], worktreePath);
  if (mergeBase.status !== 0) {
    return {
      hasUnpushedCommits: true,
      reason: 'indeterminate',
      detail: 'ブランチとデフォルトブランチの分岐点を確認できません',
    };
  }
  const commits = git(['rev-list', '--reverse', `${mergeBase.stdout.trim()}..${branch}`], worktreePath);
  if (commits.status !== 0) {
    return { hasUnpushedCommits: true, reason: 'indeterminate', detail: 'ブランチ固有のcommitを列挙できません' };
  }
  const commitShas = commits.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  return commitShas.length === 0
    ? { hasUnpushedCommits: false }
    : { hasUnpushedCommits: true, reason: 'unpreserved_commits', commitShas };
}

/**
 * Issue worktree解決の共有実装。config/agent-skill-chain.yaml の worktree.path_pattern に
 * Issue番号を埋め込んだ正規表現で
 * `git worktree list --porcelain` の実体を照合する（standards/GIT_CONVENTIONS.md が定める
 * worktreeの正本の定義）。
 *
 * CI（actions/checkout）は `.worktrees/` 型レイアウトを作らず、単一の通常チェックアウトのみを行うため
 * 上記照合は常に空振りする。この場合、単一チェックアウト自体がそのIssueの作業対象であるとみなし
 * 以下の順でフォールバックする（いずれもAGENTS.md I4 分離不変条件と矛盾しない。単一チェックアウト =
 * そのブランチの作業状態そのものであるため）。
 *
 * 1. `git rev-parse --abbrev-ref HEAD` が実ブランチ名を返す通常チェックアウトなら、それを
 *    branch.pattern と照合する。
 * 2. `actions/checkout@v4` は pull_request イベントに対しPRのマージrefをdetached HEADで
 *    チェックアウトするため（switching to 'refs/remotes/pull/<n>/merge'）、上記1は "HEAD" という
 *    文字列しか得られず機能しない。この場合 GitHub Actions が設定する `GITHUB_HEAD_REF`
 *    （PRのheadブランチ名）を代替のブランチ名ソースとして branch.pattern と照合する。
 * 3. 1・2いずれでもブランチ名が一切得られない場合（detached HEADかつ `GITHUB_HEAD_REF` 未設定）、
 *    `git worktree list --porcelain` のエントリがちょうど1件（linked worktreeが存在しない = CI相当の
 *    単一checkout環境）であれば、ブランチ名照合を諦め、呼び出し元が渡したissueNumber自体を信頼して
 *    rootを返す（ローカル開発は通常複数worktreeが存在するため、この分岐が発火するのは実質CI相当の
 *    環境に限られる）。ブランチ名が判明していて単に一致しない場合（issueNumberの取り違え等）まで
 *    無条件で信頼すると誤爆の危険があるため対象外とする。
 */
function issueWorktreePathRegex(config: AgentSkillChainConfig, issueNumber: string): RegExp {
  const timestampSource = formatToRegex(config.worktree.timestamp.format).source.replace(/^\^|\$$/g, '');
  const patternSource = expandPattern(config.worktree.path_pattern, {
    issue_created_at: timestampSource,
    type: '[a-z]+',
    issue_id: issueNumber,
    slug: '[a-z0-9-]+',
  });
  return new RegExp(`^${patternSource}/?$`);
}

function findIssueWorktreeFallback(
  root: string,
  config: AgentSkillChainConfig,
  issueNumber: string,
  entries: WorktreeEntry[],
): WorktreeEntry | undefined {
  const branchPatternSource = expandPattern(config.branch.pattern, {
    type: '[a-z]+',
    issue_id: issueNumber,
    slug: '[a-z0-9-]+',
  });
  const branchRegex = new RegExp(`^${branchPatternSource}$`);

  const currentBranchInfo = resolveCurrentBranchInfo(root);
  if (!currentBranchInfo) return undefined;
  const { branch, detached: isDetached } = currentBranchInfo;

  const head = git(['rev-parse', 'HEAD'], root);
  if (head.status !== 0) return undefined;

  if (branch && branchRegex.test(branch)) {
    return { path: root, head: head.stdout.trim(), branch, detached: isDetached || undefined };
  }

  if (!branch && entries.length === 1) {
    return { path: root, head: head.stdout.trim(), branch: undefined, detached: isDetached || undefined };
  }

  return undefined;
}

export function findIssueWorktree(
  root: string,
  config: AgentSkillChainConfig,
  issueNumber: string,
): WorktreeEntry | undefined {
  const pathRegex = issueWorktreePathRegex(config, issueNumber);
  const entries = listWorktrees(root);
  const found = entries.find((w) => pathRegex.test(path.basename(w.path)));
  if (found) return found;
  return findIssueWorktreeFallback(root, config, issueNumber, entries);
}

/**
 * Issue番号に対応する実在worktreeを一意に解決する。既存の `findIssueWorktree` は最初の
 * path-pattern一致を返す互換挙動を維持する一方、worker起動経路では複数一致を明示的に拒否する。
 * `prunable` は既に実体を失った管理エントリなので候補へ数えない。ただしCI単一checkoutの判定は
 * 管理エントリが実際に1件だけの場合へ限定するため、フォールバックには未加工の一覧を渡す。
 */
export function resolveIssueWorktreeExactlyOne(
  root: string,
  config: AgentSkillChainConfig,
  issueNumber: string,
): IssueWorktreeResolution {
  const pathRegex = issueWorktreePathRegex(config, issueNumber);
  const entries = listWorktrees(root);
  const candidates = entries.filter((entry) => !entry.prunable && pathRegex.test(path.basename(entry.path)));

  if (candidates.length > 1) {
    return { status: 'ambiguous', candidatePaths: candidates.map((entry) => entry.path) };
  }
  if (candidates.length === 1) {
    return { status: 'found', worktree: candidates[0] };
  }

  const fallback = findIssueWorktreeFallback(root, config, issueNumber, entries);
  return fallback ? { status: 'found', worktree: fallback } : { status: 'not_found' };
}

/** 特定Issue番号に限定しない、worktree.path_pattern汎用の検証用正規表現。ci/verify-worktree-path.sh用。 */
export function worktreePathRegex(config: AgentSkillChainConfig): RegExp {
  const timestampSource = formatToRegex(config.worktree.timestamp.format).source.replace(/^\^|\$$/g, '');
  const patternSource = expandPattern(config.worktree.path_pattern, {
    issue_created_at: timestampSource,
    type: `(?:${config.issue.allowed_types.join('|')})`,
    issue_id: '[0-9]+',
    slug: `[a-z0-9-]{1,${config.worktree.slug_max_length}}`,
  });
  return new RegExp(`^${patternSource}/?$`);
}

/** branch.pattern汎用の検証用正規表現。ci/verify-branch-name.sh用。 */
export function branchNameRegex(config: AgentSkillChainConfig): RegExp {
  const patternSource = expandPattern(config.branch.pattern, {
    type: `(?:${config.issue.allowed_types.join('|')})`,
    issue_id: '[0-9]+',
    slug: `[a-z0-9-]{1,${config.worktree.slug_max_length}}`,
  });
  return new RegExp(`^${patternSource}$`);
}
