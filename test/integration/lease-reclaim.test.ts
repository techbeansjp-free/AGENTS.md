import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  allLeasesFor,
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

function activeLabelCount(stub: ReturnType<typeof createGhStub>): number {
  return Object.values(stub.readState().issueLabels).filter((labels) =>
    labels.includes('writer-lease:active'),
  ).length;
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
  const { stub, env, cleanup } = makeStub();
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

  const ref = 'refs/agent-skill-chain/leases/55-implementation';
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  execFileSync(realGit, ['--git-dir', repo.remoteDir, 'update-ref', ref, stale.sha, updated.sha]);

  const markerPath = path.join(path.dirname(stub.binDir), 'git-proxy-triggered');
  const gitProxyPath = path.join(stub.binDir, 'git');
  fs.writeFileSync(
    gitProxyPath,
    `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'push' && args.some((arg) => arg.startsWith('--force-with-lease=${ref}:'))) {
  const advanced = spawnSync(${JSON.stringify(realGit)}, [
    '--git-dir',
    ${JSON.stringify(repo.remoteDir)},
    'update-ref',
    ${JSON.stringify(ref)},
    ${JSON.stringify(updated.sha)},
    ${JSON.stringify(stale.sha)},
  ], { encoding: 'utf8' });
  if (advanced.status !== 0) {
    process.stderr.write(advanced.stderr || 'git proxy: ref更新に失敗しました\\n');
    process.exit(advanced.status || 1);
  }
  fs.writeFileSync(${JSON.stringify(markerPath)}, 'triggered');
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
`,
    { mode: 0o755 },
  );
  const raceEnv = { ...env, PATH: `${stub.binDir}${path.delimiter}${env.PATH}` };

  const reclaimed = runCli(['lease', 'reclaim', 'ISSUE-55', 'implementation', '--confirm'], {
    cwd: repo.dir,
    env: raceEnv,
  });
  assert.equal(reclaimed.status, 1);
  assert.match(reclaimed.stderr, /回収に失敗しました（検査後にrefが更新されています）/);
  assert.equal(fs.existsSync(markerPath), true, 'CLIの削除push直前に競合更新が実行されること');
  assert.equal(allLeasesFor('55', repo.dir)[0]?.sha, updated.sha);
});

test('lease reclaim: activeラベルと可視性コメントを除去しWIP枠を解放する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  for (const issueNumber of ['58', '59', '60']) {
    acquireAndExpire(repo.dir, env, issueNumber);
  }
  assert.equal(activeLabelCount(stub), 3);
  assert.ok((stub.readState().issueLabels['58'] ?? []).includes('writer-lease:active'));
  assert.ok(
    (stub.readState().comments['58'] ?? []).some((comment) =>
      comment.body.includes('<!-- agent-skill-chain:lease -->'),
    ),
  );

  const blocked = runCli(['lease', 'acquire', 'ISSUE-61', 'implementation'], { cwd: repo.dir, env });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /WIP上限/);

  const reclaimed = runCli(['lease', 'reclaim', 'ISSUE-58', 'implementation', '--confirm'], {
    cwd: repo.dir,
    env,
  });
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  const stateAfterReclaim = stub.readState();
  assert.equal(activeLabelCount(stub), 2);
  assert.equal(
    (stateAfterReclaim.issueLabels['58'] ?? []).includes('writer-lease:active'),
    false,
  );
  assert.equal(
    (stateAfterReclaim.comments['58'] ?? []).some((comment) =>
      comment.body.includes('<!-- agent-skill-chain:lease -->'),
    ),
    false,
  );
  assert.ok(
    (stateAfterReclaim.comments['58'] ?? []).some((comment) =>
      comment.body.includes('<!-- agent-skill-chain:lease-reclaim -->'),
    ),
  );

  const acquiredAfterReclaim = runCli(['lease', 'acquire', 'ISSUE-61', 'implementation'], {
    cwd: repo.dir,
    env,
  });
  assert.equal(acquiredAfterReclaim.status, 0, acquiredAfterReclaim.stderr);
  assert.equal(activeLabelCount(stub), 3);
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
