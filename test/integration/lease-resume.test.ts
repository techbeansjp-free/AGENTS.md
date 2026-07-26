import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { allLeasesFor, renewLeaseRef, type WriterLease } from '../../src/lib/github-lease.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';

function makeStub() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-lease-resume-'));
  const stub = createGhStub(scratch);
  return {
    stub,
    env: stub.env(process.env),
    cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }),
  };
}

function expireLease(repoDir: string, issueNumber: string, segment: string): ReturnType<typeof allLeasesFor>[number] {
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

test('lease resume: 同一holderのcredentialとdirty worktreeだけをCAS更新し、tokenを全表示経路から除外する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const started = runCli(['issue', 'start', 'ISSUE-42', 'bugfix', 'resume-safe', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(started.status, 0, started.stderr);
  const [, worktreePath] = started.stdout.trim().split('\n');
  const acquired = runCli(['lease', 'acquire', 'ISSUE-42', 'implementation'], { cwd: repo.dir, env });
  assert.equal(acquired.status, 0, acquired.stderr);
  assert.doesNotMatch(acquired.stdout + acquired.stderr, /token:/);

  const expired = expireLease(repo.dir, '42', 'implementation');
  const oldToken = expired.lease.writer_lease.token;
  fs.writeFileSync(path.join(worktreePath, 'dirty.txt'), 'preserve me\n');

  const resumed = runCli(['lease', 'resume', 'ISSUE-42', 'implementation'], { cwd: repo.dir, env });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.doesNotMatch(resumed.stdout + resumed.stderr, /token:/);
  assert.doesNotMatch(resumed.stdout + resumed.stderr, new RegExp(oldToken));
  assert.equal(fs.readFileSync(path.join(worktreePath, 'dirty.txt'), 'utf8'), 'preserve me\n');

  const after = allLeasesFor('42', repo.dir).find((entry) => entry.segment === 'implementation');
  assert.ok(after);
  assert.notEqual(after.lease.writer_lease.token, oldToken, 'resume時に旧bearer tokenを失効させること');
  assert.equal(after.lease.writer_lease.holder, expired.lease.writer_lease.holder);
  assert.equal(after.legacy, false);
  const message = execFileSync('git', ['log', '-1', '--format=%B', after.sha], {
    cwd: repo.dir,
    encoding: 'utf8',
  });
  assert.doesNotMatch(message, /token:/);
  assert.doesNotMatch(message, new RegExp(after.lease.writer_lease.token));
  for (const comment of stub.readState().comments['42'] ?? []) {
    assert.doesNotMatch(comment.body, /token:/);
    assert.doesNotMatch(comment.body, new RegExp(after.lease.writer_lease.token));
  }

  const credentialPath = path.join(repo.dir, '.git', 'agent-skill-chain', 'lease-credentials', '42.yaml');
  assert.equal(fs.statSync(credentialPath).mode & 0o777, 0o600, 'credentialはownerだけが読めること');
});

test('lease resume: holder・Issue・segment・worktree・branchの各不一致はrefとdirty worktreeを変更しない', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const started = runCli(['issue', 'start', 'ISSUE-43', 'bugfix', 'resume-mismatch', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(started.status, 0, started.stderr);
  const [, worktreePath] = started.stdout.trim().split('\n');
  assert.equal(
    runCli(['lease', 'acquire', 'ISSUE-43', 'implementation'], { cwd: repo.dir, env }).status,
    0,
  );
  const expired = expireLease(repo.dir, '43', 'implementation');
  const dirtyPath = path.join(worktreePath, 'dirty.txt');
  fs.writeFileSync(dirtyPath, 'do not touch\n');

  const credentialPath = path.join(repo.dir, '.git', 'agent-skill-chain', 'lease-credentials', '43.yaml');
  const credential = parse(fs.readFileSync(credentialPath, 'utf8')) as Record<string, string>;
  const mismatches: [string, string][] = [
    ['holder', 'run-different-holder'],
    ['issue_id', 'ISSUE-999'],
    ['segment', 'validation'],
    ['worktree_path', `${credential.worktree_path}-different`],
    ['branch', 'bugfix/999-different'],
  ];
  for (const [field, value] of mismatches) {
    fs.writeFileSync(
      credentialPath,
      stringify({ ...credential, [field]: value }),
      { encoding: 'utf8', mode: 0o600 },
    );
    const resumed = runCli(['lease', 'resume', 'ISSUE-43', 'implementation'], { cwd: repo.dir, env });
    assert.equal(resumed.status, 1, `${field} mismatch`);
    assert.match(resumed.stderr, /human_required/, `${field} mismatch`);
    assert.doesNotMatch(resumed.stdout + resumed.stderr, new RegExp(expired.lease.writer_lease.token));
    const after = allLeasesFor('43', repo.dir).find((entry) => entry.segment === 'implementation');
    assert.equal(after?.sha, expired.sha, `${field} mismatch時はlease refを更新しないこと`);
    assert.equal(fs.readFileSync(dirtyPath, 'utf8'), 'do not touch\n', 'dirty worktreeを変更しないこと');
  }
});

test('lease resume: tokenをsubjectに含むlegacy leaseを非表示payloadへ移行し、旧tokenを失効させる', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const started = runCli(['issue', 'start', 'ISSUE-44', 'bugfix', 'resume-legacy', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(started.status, 0, started.stderr);
  const [, worktreePath] = started.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktreePath, 'legacy-dirty.txt'), 'legacy work\n');

  const legacyToken = 'legacy-secret-token-value';
  const legacyLease: WriterLease = {
    schema_version: 'agent-skill-chain/lease/v1',
    writer_lease: {
      issue_id: 'ISSUE-44',
      holder: 'run-legacy-holder',
      segment: 'implementation',
      acquired_at: new Date(Date.now() - 7_200_000).toISOString(),
      expires_at: new Date(Date.now() - 3_600_000).toISOString(),
      token: legacyToken,
    },
  };
  const legacySha = execFileSync(
    'git',
    ['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', stringify(legacyLease)],
    { cwd: repo.dir, encoding: 'utf8' },
  ).trim();
  execFileSync(
    'git',
    ['push', 'origin', `${legacySha}:refs/agent-skill-chain/leases/44-implementation`],
    { cwd: repo.dir, stdio: 'pipe' },
  );
  assert.equal(allLeasesFor('44', repo.dir)[0]?.legacy, true);

  const resumed = runCli(['lease', 'resume', 'ISSUE-44', 'implementation'], {
    cwd: repo.dir,
    env: { ...env, AGENT_SKILL_CHAIN_LEASE_TOKEN: legacyToken },
  });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.doesNotMatch(resumed.stdout + resumed.stderr, new RegExp(legacyToken));
  assert.doesNotMatch(resumed.stdout + resumed.stderr, /token:/);

  const migrated = allLeasesFor('44', repo.dir)[0];
  assert.equal(migrated.legacy, false);
  assert.notEqual(migrated.lease.writer_lease.token, legacyToken);
  const message = execFileSync('git', ['log', '-1', '--format=%B', migrated.sha], {
    cwd: repo.dir,
    encoding: 'utf8',
  });
  assert.doesNotMatch(message, /token:|legacy-secret-token-value/);
});
