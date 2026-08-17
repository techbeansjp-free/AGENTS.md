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

/** Issue #692: cleanup前に既知の保全位置を起点として到達可能性と別SHAでの統合を検査する。 */
export type UnpushedCommitCheck =
  | { hasUnpushedCommits: false }
  | { hasUnpushedCommits: true; reason: 'unpreserved_commits'; commitShas: string[] }
  | { hasUnpushedCommits: true; reason: 'indeterminate'; detail: string };

export type KnownPreservedCommit =
  | { sha: string; source: 'github_pr' }
  | { sha: string; source: 'integration_record'; verificationRef: string };

export type CommitReachabilityCheck =
  | { reachable: true }
  | { reachable: false; reason: 'unreachable' }
  | { reachable: false; reason: 'indeterminate'; detail: string };

/** local backendの統合完了遷移が、確認済みの保全位置を記録するref。 */
export function integrationPreservationRef(issueNumber: string): string {
  return `refs/agent-skill-chain/integrations/${issueNumber}`;
}

/** commit自身が統合先または実remoteのheadから到達可能かを検査する。内容一致は根拠にしない。 */
export function inspectCommitReachability(worktreePath: string, commitSha: string): CommitReachabilityCheck {
  if (git(['rev-parse', '--verify', `${commitSha}^{commit}`], worktreePath).status !== 0) {
    return { reachable: false, reason: 'indeterminate', detail: `commit ${commitSha.slice(0, 12)} が存在しません` };
  }

  let baseError: string | undefined;
  try {
    const base = defaultBranch(worktreePath);
    if (git(['merge-base', '--is-ancestor', commitSha, base], worktreePath).status === 0) {
      return { reachable: true };
    }
  } catch (error) {
    baseError = error instanceof Error ? error.message : String(error);
  }

  const remotes = git(['remote'], worktreePath);
  if (remotes.status !== 0) {
    return { reachable: false, reason: 'indeterminate', detail: 'リモート一覧を取得できません' };
  }
  let remoteError: string | undefined;
  for (const remote of remotes.stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
    const live = git(['ls-remote', '--heads', remote], worktreePath);
    if (live.status !== 0) {
      remoteError ??= `実リモート ${remote} を確認できません`;
      continue;
    }
    for (const line of live.stdout.split('\n').filter(Boolean)) {
      const [remoteSha] = line.split(/\s+/);
      if (git(['rev-parse', '--verify', `${remoteSha}^{commit}`], worktreePath).status !== 0) {
        const fetch = git(['fetch', '--no-tags', remote, remoteSha], worktreePath);
        if (
          fetch.status !== 0 ||
          git(['rev-parse', '--verify', `${remoteSha}^{commit}`], worktreePath).status !== 0
        ) {
          remoteError ??= `実リモート ${remote} のcommit ${remoteSha.slice(0, 12)} を取得できません`;
          continue;
        }
      }
      if (git(['merge-base', '--is-ancestor', commitSha, remoteSha], worktreePath).status === 0) {
        return { reachable: true };
      }
    }
  }

  if (remoteError) return { reachable: false, reason: 'indeterminate', detail: remoteError };
  if (baseError) return { reachable: false, reason: 'indeterminate', detail: baseError };
  return { reachable: false, reason: 'unreachable' };
}

export function inspectUnpushedCommits(
  worktreePath: string,
  branch: string,
  knownPreservedCommit?: KnownPreservedCommit,
): UnpushedCommitCheck {
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
  const mergeBaseSha = mergeBase.stdout.trim();
  const commits = git(['rev-list', '--reverse', `${mergeBaseSha}..${branch}`], worktreePath);
  if (commits.status !== 0) {
    return { hasUnpushedCommits: true, reason: 'indeterminate', detail: 'ブランチ固有のcommitを列挙できません' };
  }
  const branchCommits = commits.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (branchCommits.length === 0) return { hasUnpushedCommits: false };

  const pushedPositions: string[] = [];
  const reachableRefs = [base];
  let remoteEvidenceError: string | undefined;

  const remoteRefs = git(['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/remotes'], worktreePath);
  if (remoteRefs.status !== 0) remoteEvidenceError = 'remote-tracking refを列挙できません';

  const remotes = git(['remote'], worktreePath);
  if (remotes.status !== 0) remoteEvidenceError ??= 'リモート一覧を取得できません';

  if (!remoteEvidenceError) {
    const trackingRefs = new Map(
      remoteRefs.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t') as [string, string]),
    );
    for (const remote of remotes.stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
      const live = git(['ls-remote', '--heads', remote], worktreePath);
      if (live.status !== 0) {
        remoteEvidenceError ??= `実リモート ${remote} を確認できません`;
        continue;
      }
      const liveHeads = new Map(
        live.stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [sha, refName] = line.split(/\s+/);
            return [refName, sha] as const;
          }),
      );
      for (const [refName, sha] of liveHeads) {
        if (git(['rev-parse', '--verify', `${sha}^{commit}`], worktreePath).status !== 0) {
          if (refName !== `refs/heads/${branch}`) continue;
          const fetch = git(['fetch', '--no-tags', remote, sha], worktreePath);
          if (
            fetch.status !== 0 ||
            git(['rev-parse', '--verify', `${sha}^{commit}`], worktreePath).status !== 0
          ) {
            remoteEvidenceError ??= `実リモート ${remote} のcommit ${sha.slice(0, 12)} を取得できません`;
            continue;
          }
        }
        reachableRefs.push(sha);
        if (refName === `refs/heads/${branch}`) pushedPositions.push(sha);
      }
      for (const [refName, localSha] of trackingRefs) {
        const prefix = `refs/remotes/${remote}/`;
        if (!refName.startsWith(prefix)) continue;
        const remoteBranch = refName.slice(prefix.length);
        if (!remoteBranch || remoteBranch === 'HEAD') continue;
        if (liveHeads.get(`refs/heads/${remoteBranch}`) !== localSha) continue;

        reachableRefs.push(refName);
        if (remoteBranch !== branch) continue;
        pushedPositions.push(localSha);
        const reflog = git(['reflog', 'show', '--format=%H%x09%gs', refName], worktreePath);
        if (reflog.status !== 0) continue;
        pushedPositions.push(
          ...reflog.stdout
            .split('\n')
            .map((entry) => entry.split('\t'))
            .filter((entry) => entry.length >= 2 && entry.slice(1).join('\t').includes('update by push'))
            .map(([sha]) => sha),
        );
      }
    }
  }

  if (knownPreservedCommit) {
    const knownSha = knownPreservedCommit.sha;
    const knownCommitExists = git(['rev-parse', '--verify', `${knownSha}^{commit}`], worktreePath).status === 0;
    if (knownCommitExists && knownPreservedCommit.source === 'github_pr') {
      // GitHubが返す完了済みPRのheadRefOidは、過去にremoteへpushされた位置そのものである。
      pushedPositions.push(knownSha);
    } else if (knownCommitExists && knownPreservedCommit.source === 'integration_record') {
      const currentlyPreserved = isReachableFromAny(worktreePath, knownSha, reachableRefs);
      const recorded = git(
        ['rev-parse', '--verify', `${knownPreservedCommit.verificationRef}^{commit}`],
        worktreePath,
      );
      const transitionWasVerified = recorded.status === 0 && recorded.stdout.trim() === knownSha;
      if (currentlyPreserved || transitionWasVerified) pushedPositions.push(knownSha);
    }
  }

  const existingPushedPositions = [...new Set(pushedPositions)].filter(
    (sha) => git(['rev-parse', '--verify', `${sha}^{commit}`], worktreePath).status === 0,
  );
  const unpreserved: string[] = [];
  for (const commitSha of branchCommits) {
    if (
      isReachableFromAny(worktreePath, commitSha, existingPushedPositions) ||
      isReachableFromAny(worktreePath, commitSha, reachableRefs)
    ) {
      continue;
    }
    if (existingPushedPositions.length > 0) {
      const paths = commitPaths(worktreePath, commitSha);
      if ('detail' in paths) {
        return { hasUnpushedCommits: true, reason: 'indeterminate', detail: paths.detail };
      }
      if (paths.paths.length > 0) {
        const commitContent = git(
          ['--literal-pathspecs', 'diff', '--quiet', commitSha, base, '--', ...paths.paths],
          worktreePath,
        );
        if (commitContent.status === 0) continue;
        if (commitContent.status !== 1) {
          return {
            hasUnpushedCommits: true,
            reason: 'indeterminate',
            detail: `commit ${commitSha.slice(0, 12)} の統合内容を確認できません`,
          };
        }
      }
    }
    unpreserved.push(commitSha);
  }

  if (remoteEvidenceError) {
    return { hasUnpushedCommits: true, reason: 'indeterminate', detail: remoteEvidenceError };
  }
  if (unpreserved.length === 0) return { hasUnpushedCommits: false };
  return { hasUnpushedCommits: true, reason: 'unpreserved_commits', commitShas: unpreserved };
}

export function hasUnpushedCommits(
  worktreePath: string,
  branch: string,
  knownPreservedCommit?: KnownPreservedCommit,
): boolean {
  return inspectUnpushedCommits(worktreePath, branch, knownPreservedCommit).hasUnpushedCommits;
}

function isReachableFromAny(worktreePath: string, commitSha: string, refs: string[]): boolean {
  return refs.some((ref) => git(['merge-base', '--is-ancestor', commitSha, ref], worktreePath).status === 0);
}

function commitPaths(worktreePath: string, commitSha: string): { paths: string[] } | { detail: string } {
  const changed = git(
    ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '-z', commitSha],
    worktreePath,
  );
  if (changed.status !== 0) return { detail: `commit ${commitSha.slice(0, 12)} の変更pathを列挙できません` };
  return { paths: [...new Set(changed.stdout.split('\0').filter(Boolean))] };
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
