import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// `report status <issue_id> <role> <segment> <status> <target_sha> [blocked_reason]`
// （src/commands/report.ts）を検証する。作業ワーカーが完了・blocked時に固定スキーマ
// （worker-report.schema.yaml）で進行役へ報告するコマンド。

interface WorkerReport {
  schema_version: string;
  issue_id: string;
  role: string;
  segment: string;
  status: string;
  target_sha: string;
  blocked_reason?: string;
}

test('report status (local backend): completedはissues/<n>/.agent-skill-chain/reports/<segment>.yamlへ書き込まれる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(
    ['report', 'status', 'ISSUE-1', 'spec_worker', 'spec', 'completed', 'abc123'],
    { cwd: repo.dir },
  );

  assert.equal(result.status, 0, result.stderr);
  const dest = result.stdout.trim();
  assert.ok(fs.existsSync(dest));
  const report = parse(fs.readFileSync(dest, 'utf8')) as WorkerReport;
  assert.equal(report.schema_version, 'agent-skill-chain/worker-report/v1');
  assert.equal(report.issue_id, 'ISSUE-1');
  assert.equal(report.role, 'spec_worker');
  assert.equal(report.segment, 'spec');
  assert.equal(report.status, 'completed');
  assert.equal(report.target_sha, 'abc123');
  assert.equal(report.blocked_reason, undefined);
});

test('report status (local backend): blockedはblocked_reason必須。省略時は推測で補完せず拒否する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const missing = runCli(['report', 'status', 'ISSUE-1', 'implementation_worker', 'implementation', 'blocked', 'def456'], {
    cwd: repo.dir,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /blocked_reason は必須/);

  const withReason = runCli(
    [
      'report',
      'status',
      'ISSUE-1',
      'implementation_worker',
      'implementation',
      'blocked',
      'def456',
      'PLAN.mdの変更単位3が依存する外部APIの仕様が未確定',
    ],
    { cwd: repo.dir },
  );
  assert.equal(withReason.status, 0, withReason.stderr);
  const report = parse(fs.readFileSync(withReason.stdout.trim(), 'utf8')) as WorkerReport;
  assert.equal(report.status, 'blocked');
  assert.equal(report.blocked_reason, 'PLAN.mdの変更単位3が依存する外部APIの仕様が未確定');
});

test('report status: statusがcompleted|blocked以外は使い方エラーとして拒否する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['report', 'status', 'ISSUE-1', 'spec_worker', 'spec', 'in_progress', 'abc123'], { cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /status は completed\|blocked/);
});

test('report status (github backend): Issueコメントとして固定スキーマのworker reportを投稿する', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-report-'));
  const stub = createGhStub(scratchDir);
  const env = stub.env(process.env);
  t.after(() => {
    repo.cleanup();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  const result = runCli(['report', 'status', 'ISSUE-2', 'validation_worker', 'validation', 'completed', 'aaa111'], {
    cwd: repo.dir,
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /issuecomment-\d+/);

  const comments = stub.readState().comments['2'] ?? [];
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /<!-- agent-skill-chain:worker-report -->/);
  assert.match(comments[0].body, /status: completed/);
});
