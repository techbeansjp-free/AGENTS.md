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

export function defaultBranch(repoRoot: string): string {
  const symbolic = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot);
  if (symbolic.status === 0) {
    return symbolic.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
  }
  for (const candidate of ['main', 'master']) {
    if (git(['rev-parse', '--verify', candidate], repoRoot).status === 0) return candidate;
  }
  throw new Error('デフォルトブランチを特定できません（origin/HEAD 未設定・main/master 不在）');
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
 * 上記照合は常に空振りする。この場合、現在のHEADブランチ名が対象issueの branch.pattern に一致するなら、
 * 単一チェックアウト自体がそのissueの作業対象であるとみなしフォールバックする（現在のチェックアウト =
 * そのブランチの作業状態そのものであるため、AGENTS.md I4 分離不変条件と矛盾しない）。
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
  const found = listWorktrees(root).find((w) => pathRegex.test(path.basename(w.path)));
  if (found) return found;

  const branchPatternSource = expandPattern(config.branch.pattern, {
    type: '[a-z]+',
    issue_id: issueNumber,
    slug: '[a-z0-9-]+',
  });
  const branchRegex = new RegExp(`^${branchPatternSource}$`);
  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  if (currentBranch.status !== 0) return undefined;
  const branch = currentBranch.stdout.trim();
  if (!branchRegex.test(branch)) return undefined;

  const head = git(['rev-parse', 'HEAD'], root);
  if (head.status !== 0) return undefined;
  return { path: root, head: head.stdout.trim(), branch };
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
