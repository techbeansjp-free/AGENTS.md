import fs from 'node:fs';
import path from 'node:path';
import { git } from '../lib/process.js';
import { safeSlug } from '../lib/security.js';

/** @param {string} remote */
function githubRepository(remote) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote.trim());
  return match?.[1];
}

/** @param {{repoRoot: string, worktreePath: string, branch: string, base: string, expectedRepository?: string}} input */
export function createWorktree(input) {
  const actualRoot = git(['rev-parse', '--show-toplevel'], input.repoRoot).stdout.trim();
  if (fs.realpathSync(actualRoot) !== fs.realpathSync(input.repoRoot)) throw new Error('リポジトリ直下パスが一致しません');
  const branchParts = input.branch.split('/');
  if (branchParts.length < 2 || branchParts.some((part) => safeSlug(part) !== part)) throw new Error('ブランチは名前空間を持つ安全で長さ制限内の名前にしてください');
  const destination = path.resolve(input.worktreePath);
  if (destination === fs.realpathSync(input.repoRoot) || fs.existsSync(destination)) throw new Error('worktree作成先は未作成の専用パスにしてください');
  if (input.expectedRepository) {
    const remote = git(['remote', 'get-url', 'origin'], input.repoRoot, { allowFailure: true });
    if (remote.status !== 0 || githubRepository(remote.stdout) !== input.expectedRepository) throw new Error('originのリポジトリ同一性が一致しません');
  }
  const baseCheck = git(['rev-parse', '--verify', `${input.base}^{commit}`], input.repoRoot, { allowFailure: true });
  if (baseCheck.status !== 0) throw new Error('基点コミットを検証できません');
  const dirtyBefore = git(['status', '--porcelain=v1', '--untracked-files=all'], input.repoRoot).stdout;
  git(['worktree', 'add', '-b', input.branch, destination, input.base], input.repoRoot);
  const dirtyAfter = git(['status', '--porcelain=v1', '--untracked-files=all'], input.repoRoot).stdout;
  if (dirtyAfter !== dirtyBefore) throw new Error('作業元worktreeの状態が予期せず変化しました。復旧のため両方のworktreeを保持してください');
  return { path: destination, branch: input.branch, base: baseCheck.stdout.trim(), sourceDirtyPreserved: true };
}

/** @param {string} repoRoot @param {string} worktreePath @param {{repository: string, base: string, specConsistent: boolean|'unknown', testsPassed: boolean|'unknown', reviewApproved: boolean|'unknown', prMerged: boolean|'unknown'}} evidence */
export function inspectFinalizeState(repoRoot, worktreePath, evidence) {
  const listed = git(['worktree', 'list', '--porcelain'], repoRoot).stdout;
  const exact = `worktree ${path.resolve(worktreePath)}\n`;
  if (!listed.includes(exact)) throw new Error('対象は登録済みworktreeではありません');
  const branch = git(['branch', '--show-current'], worktreePath).stdout.trim();
  const headSha = git(['rev-parse', 'HEAD'], worktreePath).stdout.trim();
  const baseSha = git(['rev-parse', evidence.base], worktreePath).stdout.trim();
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'], worktreePath).stdout.split('\n').filter(Boolean);
  const untracked = status.filter((line) => line.startsWith('?? ')).map((line) => line.slice(3));
  const ignoredArtifacts = git(['ls-files', '--others', '--ignored', '--exclude-standard'], worktreePath).stdout.split('\n').filter(Boolean);
  const temporaryArtifacts = [...untracked, ...ignoredArtifacts].filter((file) => /(^|\/)(\.pending-|.*\.tmp-|tmp\/|.*\.log$)/.test(file));
  const stashes = git(['stash', 'list'], worktreePath).stdout.split('\n').filter(Boolean);
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], worktreePath, { allowFailure: true });
  const remoteSha = upstream.status === 0 ? git(['rev-parse', '@{upstream}'], worktreePath, { allowFailure: true }) : { status: 1, stdout: '' };
  const recoveryRef = upstream.status === 0 ? upstream.stdout.trim() : undefined;
  const recoveryReachable = Boolean(recoveryRef) && remoteSha.status === 0 && remoteSha.stdout.trim() === headSha;
  return {
    repository: evidence.repository, worktree: path.resolve(worktreePath), branch, base: evidence.base, headSha, baseSha,
    dirty: status.some((line) => !line.startsWith('?? ')), untracked, stashes, temporaryArtifacts, ignoredArtifacts,
    pushed: remoteSha.status === 0 && remoteSha.stdout.trim() === headSha, remoteBranch: upstream.status === 0,
    prMerged: evidence.prMerged, specConsistent: evidence.specConsistent, testsPassed: evidence.testsPassed,
    reviewApproved: evidence.reviewApproved, recoveryRef, recoveryReachable,
  };
}

export { githubRepository };
