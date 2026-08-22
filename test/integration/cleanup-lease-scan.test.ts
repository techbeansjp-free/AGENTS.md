// ISSUE-798 / AC-8 / DESIGN D11: worktree削除（`cleanup`）が有効leaseを探す走査を、segment名の
// 直書き列挙からIssue単位のprefix走査へ置き換えても既存の停止条件が緩まないこと。あわせて、
// lease schema の segment enum へ値を1つ加えても既存lease文書が有効なまま検証を通ること。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, FIXED_TIMESTAMP, type TmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

const EXISTING_SEGMENTS = ['spec', 'design', 'implementation', 'validation', 'adr_finalization'] as const;

function makeGhStub(): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-cleanup-lease-'));
  const stub = createGhStub(scratchDir);
  return { env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

function startIssue(repo: TmpRepo, issueId: string, env: NodeJS.ProcessEnv): string {
  const result = runCli(['issue', 'start', issueId, 'bugfix', 'lease-scan', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n')[1];
}

test('AC-8 (D11): cleanup は新segment root_artifact_cleanup の有効leaseを検出して削除を拒否する', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const { env, cleanup } = makeGhStub();
  t.after(cleanup);

  const worktree = startIssue(repo, 'ISSUE-798', env);
  assert.equal(fs.existsSync(worktree), true);

  const acquired = runCli(['lease', 'acquire', 'ISSUE-798', 'root_artifact_cleanup'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  assert.match(acquired.stdout, /segment: root_artifact_cleanup/);

  const blocked = runCli(['cleanup', 'ISSUE-798'], { cwd: repo.dir, env });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /有効な writer lease が存在するため削除できません/);
  assert.equal(fs.existsSync(worktree), true, 'worktreeが削除されないこと');

  // 解放後は lease を理由に止まらない（別の未完了条件で止まる）。
  const released = runCli(['lease', 'release', 'ISSUE-798'], { cwd: repo.dir, env });
  assert.equal(released.status, 0, released.stderr);
  const afterRelease = runCli(['cleanup', 'ISSUE-798'], { cwd: repo.dir, env });
  assert.notEqual(afterRelease.status, 0, 'PR未完了のため別理由で止まること');
  assert.doesNotMatch(afterRelease.stderr, /有効な writer lease/);
});

test('AC-8 (D11): cleanup は既存segmentの有効leaseも従来どおり検出する', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const { env, cleanup } = makeGhStub();
  t.after(cleanup);

  for (const segment of EXISTING_SEGMENTS) {
    const issueId = `ISSUE-${900 + EXISTING_SEGMENTS.indexOf(segment)}`;
    const result = runCli(['issue', 'start', issueId, 'bugfix', `lease-scan-${segment.replace(/_/g, '-')}`, FIXED_TIMESTAMP], {
      cwd: repo.dir,
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    const worktree = result.stdout.trim().split('\n')[1];

    const acquired = runCli(['lease', 'acquire', issueId, segment], { cwd: repo.dir, env });
    assert.equal(acquired.status, 0, `${segment}: ${acquired.stderr}`);

    const blocked = runCli(['cleanup', issueId], { cwd: repo.dir, env });
    assert.notEqual(blocked.status, 0, segment);
    assert.match(blocked.stderr, /有効な writer lease が存在するため削除できません/, segment);
    assert.equal(fs.existsSync(worktree), true, segment);

    const released = runCli(['lease', 'release', issueId], { cwd: repo.dir, env });
    assert.equal(released.status, 0, released.stderr);
  }
});

test('AC-8 (D11): 期限切れleaseは cleanup の停止理由にならない（既存挙動を緩めも強めもしない）', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const { env, cleanup } = makeGhStub();
  t.after(cleanup);

  startIssue(repo, 'ISSUE-798', env);
  const acquired = runCli(['lease', 'acquire', 'ISSUE-798', 'implementation'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);

  // ref上のleaseを期限切れへ差し替える（`activeLeasesFor` の有効期限フィルタの対象そのもの）。
  const refName = 'refs/agent-skill-chain/leases/798-implementation';
  const localRef = execFileSync('git', ['ls-remote', 'origin', refName], { cwd: repo.dir, encoding: 'utf8' })
    .trim()
    .split(/\s+/)[0];
  assert.ok(localRef, '前提: lease refが存在すること');
  execFileSync('git', ['fetch', 'origin', `+${refName}:${refName}`], { cwd: repo.dir, stdio: 'pipe' });
  const payload = execFileSync('git', ['show', `${localRef}:lease.yaml`], { cwd: repo.dir, encoding: 'utf8' }).replace(
    /expires_at: .*/,
    "expires_at: '2000-01-01T00:00:00.000Z'",
  );
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo.dir,
    encoding: 'utf8',
    input: payload,
  }).trim();
  const tree = execFileSync('git', ['mktree'], {
    cwd: repo.dir,
    encoding: 'utf8',
    input: `100600 blob ${blob}\tlease.yaml\n`,
  }).trim();
  const commit = execFileSync('git', ['commit-tree', tree, '-m', 'expired'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  execFileSync('git', ['push', '--force', 'origin', `${commit}:${refName}`], { cwd: repo.dir, stdio: 'pipe' });

  const afterExpiry = runCli(['cleanup', 'ISSUE-798'], { cwd: repo.dir, env });
  assert.notEqual(afterExpiry.status, 0, 'PR未完了のため別理由で止まること');
  assert.doesNotMatch(afterExpiry.stderr, /有効な writer lease/, '期限切れleaseはcleanupの停止理由にならないこと');
});
