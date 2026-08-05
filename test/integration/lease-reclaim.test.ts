import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  allLeasesFor,
  releaseLeaseRef,
  renewLeaseRef,
  type WriterLease,
} from '../../src/lib/github-lease.js';
import { readLeaseCredential, removeLeaseCredential } from '../../src/lib/lease-credential.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';

function makeStub() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-lease-reclaim-'));
  const stub = createGhStub(scratch);
  return {
    stub,
    env: stub.env(process.env),
    cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }),
  };
}

function acquireAndExpire(
  repoDir: string,
  env: NodeJS.ProcessEnv,
  issueNumber: string,
  segment = 'implementation',
) {
  const acquired = runCli(['lease', 'acquire', `ISSUE-${issueNumber}`, segment], { cwd: repoDir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  const held = allLeasesFor(issueNumber, repoDir).find((entry) => entry.segment === segment);
  assert.ok(held);
  const expired: WriterLease = {
    ...held.lease,
    writer_lease: {
      ...held.lease.writer_lease,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    },
  };
  const outcome = renewLeaseRef(issueNumber, segment, expired, repoDir, held.sha);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return allLeasesFor(issueNumber, repoDir).find((entry) => entry.segment === segment)!;
}

test('lease reclaim: 期限切れleaseを回収し、同一Issue/segmentを再取得できる（AC-1, AC-6）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  acquireAndExpire(repo.dir, env, '51');

  const reclaimed = runCli(['lease', 'reclaim', 'ISSUE-51', 'implementation', '--confirm'], {
    cwd: repo.dir,
    env,
  });
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  assert.match(reclaimed.stdout, /issue_id=ISSUE-51.*segment=implementation.*previous_holder=/);
  assert.equal(allLeasesFor('51', repo.dir).length, 0);

  const reacquired = runCli(['lease', 'acquire', 'ISSUE-51', 'implementation'], { cwd: repo.dir, env });
  assert.equal(reacquired.status, 0, reacquired.stderr);
  assert.equal(allLeasesFor('51', repo.dir).length, 1);
});

test('lease reclaim: 期限内leaseは--confirm付きでも変更しない（AC-2）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const acquired = runCli(['lease', 'acquire', 'ISSUE-52', 'implementation'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  const before = allLeasesFor('52', repo.dir)[0];

  const reclaimed = runCli(['lease', 'reclaim', 'ISSUE-52', 'implementation', '--confirm'], {
    cwd: repo.dir,
    env,
  });
  assert.equal(reclaimed.status, 1);
  assert.match(reclaimed.stderr, /writer lease は期限内です/);
  assert.equal(allLeasesFor('52', repo.dir)[0]?.sha, before.sha);
});

test('lease reclaim: --confirmなしでは案内を表示しrefを変更しない（AC-3）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const before = acquireAndExpire(repo.dir, env, '53');

  const reclaimed = runCli(['lease', 'reclaim', 'ISSUE-53', 'implementation'], { cwd: repo.dir, env });
  assert.equal(reclaimed.status, 1);
  assert.match(reclaimed.stderr, /`--confirm` オプションを付けて再実行してください/);
  assert.equal(allLeasesFor('53', repo.dir)[0]?.sha, before.sha);
});

test('lease reclaim: actor・日時・Issue・segment・旧holderを監査コメントへ記録する（AC-4）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const before = acquireAndExpire(repo.dir, env, '54', 'design');

  const reclaimed = runCli(
    ['lease', 'reclaim', 'ISSUE-54', 'design', '--confirm', '--actor', 'release-manager'],
    { cwd: repo.dir, env },
  );
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  const audit = (stub.readState().comments['54'] ?? []).find((comment) =>
    comment.body.includes('<!-- agent-skill-chain:lease-reclaim -->'),
  );
  assert.ok(audit);
  assert.match(audit.body, /actor: release-manager/);
  assert.match(audit.body, /reclaimed_at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  assert.match(audit.body, /issue: ISSUE-54/);
  assert.match(audit.body, /segment: design/);
  assert.match(audit.body, new RegExp(`previous_holder: ${before.lease.writer_lease.holder}`));
});

test('lease reclaim: 検査時SHAよりrefが進んだ場合はCAS削除を拒否する（AC-5）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  const stale = acquireAndExpire(repo.dir, env, '55');
  const updatedLease: WriterLease = {
    ...stale.lease,
    writer_lease: {
      ...stale.lease.writer_lease,
      token: 'updated-token-with-same-expiry',
      expires_at: stale.lease.writer_lease.expires_at,
    },
  };
  const renewed = renewLeaseRef('55', 'implementation', updatedLease, repo.dir, stale.sha);
  assert.equal(renewed.ok, true, JSON.stringify(renewed));
  const updated = allLeasesFor('55', repo.dir)[0];
  assert.notEqual(updated.sha, stale.sha);
  assert.equal(updated.lease.writer_lease.expires_at, stale.lease.writer_lease.expires_at);

  const released = releaseLeaseRef('55', 'implementation', repo.dir, stale.sha);
  assert.equal(released.ok, false);
  if (!released.ok) assert.equal(released.reason, 'conflict');
  assert.equal(allLeasesFor('55', repo.dir)[0]?.sha, updated.sha);
});

test('lease reclaim: writer credentialが無くても回収でき、credentialを作成しない（AC-7）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  acquireAndExpire(repo.dir, env, '56');
  removeLeaseCredential(repo.dir, '56');
  assert.equal(readLeaseCredential(repo.dir, '56'), undefined);

  const reclaimed = runCli(['lease', 'reclaim', 'ISSUE-56', 'implementation', '--confirm'], {
    cwd: repo.dir,
    env,
  });
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  assert.equal(allLeasesFor('56', repo.dir).length, 0);
  assert.equal(readLeaseCredential(repo.dir, '56'), undefined);
});

test('lease reclaim: ref削除後の監査失敗と再実行時の状態を区別して報告する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  acquireAndExpire(repo.dir, env, '57');
  stub.seedIssueCommentFailure('57', { stderr: 'gh-stub: simulated issue comment failure' });

  const first = runCli(['lease', 'reclaim', 'ISSUE-57', 'implementation', '--confirm'], {
    cwd: repo.dir,
    env,
  });
  assert.equal(first.status, 1);
  assert.match(first.stderr, /ref削除は成功したが監査コメント投稿に失敗しました/);
  assert.equal(allLeasesFor('57', repo.dir).length, 0);
  assert.equal(
    (stub.readState().comments['57'] ?? []).filter((comment) =>
      comment.body.includes('<!-- agent-skill-chain:lease-reclaim -->'),
    ).length,
    0,
  );

  stub.seedIssueCommentFailure('57', { stderr: '' });
  const second = runCli(['lease', 'reclaim', 'ISSUE-57', 'implementation', '--confirm'], {
    cwd: repo.dir,
    env,
  });
  assert.equal(second.status, 1);
  assert.match(
    second.stderr,
    /対象の writer lease が見つかりません（既に回収済み、または issue_id\/segment 指定誤りの可能性があります）/,
  );
});
