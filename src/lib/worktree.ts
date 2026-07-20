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
}

/**
 * worktree の正本は `git worktree list --porcelain` であり、.worktrees/ 配下の
 * ディレクトリ走査ではない（standards/GIT_CONVENTIONS.md §worktreeの正本）。
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
 */
export function defaultBranch(repoRoot: string): string {
  const symbolic = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot);
  if (symbolic.status === 0) {
    return symbolic.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
  }
  for (const candidate of ['main', 'master']) {
    if (git(['rev-parse', '--verify', candidate], repoRoot).status === 0) return candidate;
  }
  if (process.env.GITHUB_BASE_REF) return process.env.GITHUB_BASE_REF;
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

export function hasUnpushedCommits(worktreePath: string, branch: string): boolean {
  const upstream = git(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], worktreePath);
  if (upstream.status !== 0) {
    // upstream 未設定 = push実績なしとみなす（安全側）。
    return true;
  }
  const ahead = git(['rev-list', '--count', `${upstream.stdout.trim()}..${branch}`], worktreePath);
  return ahead.status === 0 && Number.parseInt(ahead.stdout.trim() || '0', 10) > 0;
}

/**
 * config/agent-skill-chain.yaml の worktree.path_pattern に issue番号を埋め込んだ正規表現で
 * `git worktree list --porcelain` の実体を照合する（standards/GIT_CONVENTIONS.md §worktreeの正本）。
 *
 * CI（actions/checkout）は `.worktrees/` 型レイアウトを作らず、単一の通常チェックアウトのみを行うため
 * 上記照合は常に空振りする。この場合、単一チェックアウト自体がそのissueの作業対象であるとみなし
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
export function findIssueWorktree(
  root: string,
  config: AgentSkillChainConfig,
  issueNumber: string,
): WorktreeEntry | undefined {
  const timestampSource = formatToRegex(config.worktree.timestamp.format).source.replace(/^\^|\$$/g, '');
  const patternSource = expandPattern(config.worktree.path_pattern, {
    issue_created_at: timestampSource,
    type: '[a-z]+',
    issue_id: issueNumber,
    slug: '[a-z0-9-]+',
  });
  const pathRegex = new RegExp(`^${patternSource}/?$`);
  const entries = listWorktrees(root);
  const found = entries.find((w) => pathRegex.test(path.basename(w.path)));
  if (found) return found;

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
