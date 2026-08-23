import fs from 'node:fs';
import { run } from '../lib/process.js';

/** @param {string} repository @param {string} cwd @param {'read'|'write'} access */
function verifyRepository(repository, cwd, access) {
  run('gh', ['auth', 'status'], cwd);
  let observed;
  try {
    observed = JSON.parse(run('gh', ['repo', 'view', repository, '--json', 'nameWithOwner,viewerPermission'], cwd).stdout);
  } catch {
    throw new Error('GitHubリポジトリと権限の観測結果を検証できません');
  }
  if (observed.nameWithOwner !== repository) throw new Error(`GitHubリポジトリが一致しません: 期待値=${repository} 観測値=${observed.nameWithOwner || '不明'}`);
  const levels = ['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'];
  const observedLevel = levels.indexOf(observed.viewerPermission);
  const requiredLevel = access === 'write' ? levels.indexOf('WRITE') : levels.indexOf('READ');
  if (observedLevel < requiredLevel) throw new Error(`対象GitHubリポジトリの${access === 'write' ? '書き込み' : '読み取り'}権限が不足しています`);
}

/**
 * The only GitHub CLI process boundary. Domain code and skills never invoke gh.
 * @param {string} operation @param {any} input @param {string} cwd
 */
export function github(operation, input, cwd) {
  if (operation === 'issue.sync') {
    verifyRepository(input.repository, cwd, 'write');
    const args = ['issue', 'edit', String(input.issue), '--repo', input.repository, '--body-file', input.bodyFile];
    run('gh', args, cwd);
    const expected = fs.readFileSync(input.bodyFile, 'utf8').replace(/\r\n/g, '\n').trimEnd();
    const observed = run('gh', ['issue', 'view', String(input.issue), '--repo', input.repository, '--json', 'body', '--jq', '.body'], cwd).stdout.replace(/\r\n/g, '\n').trimEnd();
    if (observed !== expected) throw new Error('Issue同期後の読み取り検証に失敗しました');
    return { url: `https://github.com/${input.repository}/issues/${input.issue}` };
  }
  if (operation === 'issue.create') {
    verifyRepository(input.repository, cwd, 'write');
    const result = run('gh', ['issue', 'create', '--repo', input.repository, '--title', input.title, '--body-file', input.bodyFile], cwd);
    return { url: result.stdout.trim() };
  }
  if (operation === 'pr.create') {
    verifyRepository(input.repository, cwd, 'write');
    if (!/^[a-f0-9]{40}$/i.test(input.headSha ?? '')) throw new Error('PR対象HEAD SHAが不正です');
    const remoteHead = run('gh', ['api', `repos/${input.repository}/commits/${encodeURIComponent(input.head)}`, '--jq', '.sha'], cwd).stdout.trim();
    if (remoteHead !== input.headSha) throw new Error('PR作成前にremote branchのHEAD SHAが証拠と一致しません');
    const result = run('gh', [
      'pr', 'create', '--repo', input.repository, '--head', input.head, '--base', input.base,
      '--title', input.title ?? `Issue #${input.issue}`, '--body', input.bodyLink,
    ], cwd);
    const url = result.stdout.trim();
    if (!new RegExp(`^https://github\\.com/${input.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/\\d+$`).test(url)) throw new Error('PR作成結果のURLが対象リポジトリと一致しません');
    const observed = JSON.parse(run('gh', ['pr', 'view', url, '--repo', input.repository, '--json', 'url,headRefName,baseRefName,headRefOid'], cwd).stdout);
    if (observed.url !== url || observed.headRefName !== input.head || observed.baseRefName !== input.base || observed.headRefOid !== input.headSha) {
      throw new Error('PR作成後の読み取り検証に失敗しました');
    }
    return { url };
  }
  if (operation === 'pr.inspect') {
    verifyRepository(input.repository, cwd, 'read');
    const result = run('gh', ['pr', 'view', String(input.pr), '--repo', input.repository, '--json',
      'number,url,headRefName,baseRefName,headRefOid,baseRefOid,mergeStateStatus,reviewDecision,latestReviews,statusCheckRollup'], cwd);
    return JSON.parse(result.stdout);
  }
  if (operation === 'review.evidence') {
    verifyRepository(input.repository, cwd, 'read');
    const pr = JSON.parse(run('gh', ['pr', 'view', String(input.pr), '--repo', input.repository, '--json', 'number,headRefOid,author'], cwd).stdout);
    const implementation = JSON.parse(run('gh', ['api', `repos/${input.repository}/commits/${input.implementationCommitSha}`], cwd).stdout);
    const ci = JSON.parse(run('gh', ['api', `repos/${input.repository}/actions/runs/${input.runId}`], cwd).stdout);
    const review = JSON.parse(run('gh', ['api', `repos/${input.repository}/pulls/${input.pr}/reviews/${input.reviewId}`], cwd).stdout);
    return {
      provenance: { source: 'github', repository: input.repository, prNumber: input.pr, runId: String(input.runId), reviewId: String(input.reviewId) },
      implementation: { repository: input.repository, commitSha: implementation.sha, authorActorId: implementation.author?.node_id },
      pr: { repository: input.repository, number: pr.number, headSha: pr.headRefOid, authorActorId: pr.author?.id },
      ci: { repository: ci.repository?.full_name, runId: String(ci.id ?? ''), event: ci.event, headSha: ci.head_sha, conclusion: String(ci.conclusion ?? '').toLowerCase(), pullRequestNumbers: Array.isArray(ci.pull_requests) ? ci.pull_requests.map((/** @type {any} */ item) => item.number) : [] },
      review: { repository: input.repository, prNumber: pr.number, reviewId: String(review.id ?? ''), commitSha: review.commit_id, actorId: review.user?.node_id, submittedAt: review.submitted_at, verdict: String(review.state ?? '').toLowerCase() },
    };
  }
  if (operation === 'branch.protection') {
    verifyRepository(input.repository, cwd, 'read');
    const result = run('gh', ['api', `repos/${input.repository}/branches/${encodeURIComponent(input.branch)}/protection`], cwd, { allowFailure: true });
    if (result.status === 0) return { known: true, protected: true, value: JSON.parse(result.stdout) };
    if (result.status === 1 && /404|Branch not protected/i.test(result.stderr)) return { known: true, protected: false };
    return { known: false, protected: false, error: result.stderr };
  }
  if (operation === 'pr.merge') {
    verifyRepository(input.repository, cwd, 'write');
    const methodFlag = input.method === 'rebase' ? '--rebase' : input.method === 'merge' ? '--merge' : '--squash';
    run('gh', ['pr', 'merge', String(input.pr), '--repo', input.repository, methodFlag, '--auto'], cwd);
    return { state: 'merge_or_native_auto_merge_requested' };
  }
  throw new Error(`未対応のGitHub操作です: ${operation}`);
}
