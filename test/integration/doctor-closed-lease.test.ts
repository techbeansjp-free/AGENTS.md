import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { acquireLeaseRef, type WriterLease } from '../../src/lib/github-lease.js';
import { readYamlFile } from '../../src/lib/yaml-io.js';

function acquireDoctorLease(repoDir: string, number: string, segment: string): void {
  const now = Date.now();
  const lease: WriterLease = {
    schema_version: 'agent-skill-chain/lease/v1',
    writer_lease: {
      issue_id: `ISSUE-${number}`,
      holder: 'doctor-test',
      segment,
      acquired_at: new Date(now).toISOString(),
      expires_at: new Date(now + 3600_000).toISOString(),
      token: `doctor-test-${number}-${segment}`,
    },
  };
  const acquired = acquireLeaseRef(number, segment, lease, repoDir);
  assert.equal(acquired.ok, true);
}

function doctorGhStub(
  baseEnv: NodeJS.ProcessEnv,
  state: 'OPEN' | 'CLOSED',
  labels: unknown,
): { env: NodeJS.ProcessEnv; cleanup(): void } {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-doctor-gh-'));
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const target = ['i', 'ssue'].join('');
if (args[0] === 'auth' && args[1] === 'status') process.exit(0);
if (args[0] === 'label' && args[1] === 'list') {
  process.stdout.write(process.env.AGENT_SKILL_CHAIN_DOCTOR_LABELS || '[]');
  process.exit(0);
}
if (args[0] === target && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ state: process.env.AGENT_SKILL_CHAIN_DOCTOR_STATE }));
  process.exit(0);
}
process.exit(1);
`;
  fs.writeFileSync(path.join(binDir, 'gh'), script, { mode: 0o755 });
  return {
    env: {
      ...baseEnv,
      PATH: `${binDir}${path.delimiter}${baseEnv.PATH}`,
      AGENT_SKILL_CHAIN_DOCTOR_STATE: state,
      AGENT_SKILL_CHAIN_DOCTOR_LABELS: JSON.stringify(labels),
    },
    cleanup() {
      fs.rmSync(binDir, { recursive: true, force: true });
    },
  };
}

function labelDefs(repoDir: string): { name: string; color: string; description: string }[] {
  const labelsPath = path.join(repoDir, '.agent-skill-chain', 'templates', 'github', 'provisioning', 'labels.yaml');
  return readYamlFile<{ labels: { name: string; color: string; description: string }[] }>(labelsPath).labels;
}

test('doctor: local modeではclose済みIssueのwriter lease検査を実行しない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  acquireDoctorLease(repo.dir, '528', 'implementation');

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.doesNotMatch(result.stdout, /close済みIssueのwriter lease/);
});

test('doctor: close済みIssueのwriter lease refをIssue番号とsegment付きで検出する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  acquireDoctorLease(repo.dir, '528', 'implementation');
  const stub = doctorGhStub(process.env, 'CLOSED', labelDefs(repo.dir));
  t.after(() => stub.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir, env: stub.env });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}close済みIssueのwriter lease: .*ISSUE-528.*implementation/);
});

test('doctor: GitHub modeでopen Issueのwriter leaseだけならOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  acquireDoctorLease(repo.dir, '528', 'implementation');
  const stub = doctorGhStub(process.env, 'OPEN', labelDefs(repo.dir));
  t.after(() => stub.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir, env: stub.env });
  assert.match(result.stdout, /OK {2}close済みIssueのwriter lease/);
});

test('doctor: writer lease ref一覧の取得に失敗した場合はNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());
  const stub = doctorGhStub(process.env, 'OPEN', labelDefs(repo.dir));
  t.after(() => stub.cleanup());
  const unavailableRemote = path.join(repo.dir, 'missing-remote');
  execFileSync('git', ['remote', 'set-url', 'origin', unavailableRemote], { cwd: repo.dir });

  const result = runCli(['doctor'], { cwd: repo.dir, env: stub.env });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}close済みIssueのwriter lease: git ls-remote に失敗しました:/);
});
