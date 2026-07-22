import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
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

// Issue #185 AC-3: repoRoot()のworktree一貫化（ADR-0004）により、linked worktree内から
// 実行した`report status`が書くcoordination状態ファイルと、メイン作業ツリー側が読む
// coordination状態ファイルが同一実体（同一絶対パス）を指すことを検証する。修正前は
// worktree内へ分裂して書かれ、メイン作業ツリー側（launch_workerの完了確認）から不可視だった。
test('report status (local backend, AC-3): worktree内から実行したreportがメイン作業ツリー側から同一実体として読める（worktree分裂の解消）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], {
    cwd: repo.dir,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  assert.notEqual(path.resolve(worktreePath), path.resolve(repo.dir), '前提: worktreePathはrepo.dirとは別の実ディレクトリであること');

  // Given/When: worktree内（cwd=worktreePath）から report status を実行する
  //             （ワーカーが自worktree内から報告する実際の経路を再現する）。
  const result = runCli(
    ['report', 'status', 'ISSUE-1', 'spec_worker', 'spec', 'completed', 'deadbeef00000000'],
    { cwd: worktreePath },
  );
  assert.equal(result.status, 0, result.stderr);
  const dest = result.stdout.trim();

  // Then: 書込み先はworktreePath配下ではなく、repoRoot()が一貫して返すメイン作業ツリー
  //       （repo.dir）配下であること（worktree内へ分裂しないこと）。
  const expectedDest = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'reports', 'spec.yaml');
  assert.equal(path.resolve(dest), expectedDest);
  assert.equal(fs.existsSync(path.join(worktreePath, 'issues', '1', '.agent-skill-chain', 'reports', 'spec.yaml')), false, 'worktree側には分裂して書かれないこと');

  // Then: メイン作業ツリー側（cwd=repo.dir）の `report latest` が、worktree側から書いた
  //       内容を同一実体として読めること（AC-3）。
  const latest = runCli(['report', 'latest', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(latest.status, 0, latest.stderr);
  assert.match(latest.stdout, /status=completed/);
  assert.match(latest.stdout, /target_sha=deadbeef00000000/);
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
