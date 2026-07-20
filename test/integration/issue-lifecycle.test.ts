import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// coordination.backend: local での中核フロー（issue start → lease acquire → segment start →
// gate review/publish → checkpoint → pr create → cleanup）を素通しで検証する。
// bin/agents-md.js（ビルド後の実体）に対してsubprocess実行するため、実際にnpx経由で使われる
// 挙動そのものを確認する。

test('issue lifecycle (local backend): start -> lease -> segment -> gate -> checkpoint -> pr -> cleanup', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');
  assert.equal(branch, 'feature/1-sample-feature');
  assert.ok(fs.existsSync(worktreePath), `worktree が作成されていること: ${worktreePath}`);
  assert.ok(
    fs.existsSync(path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'state.yaml')),
    'ローカルモードでは issues/<n>/.agent-skill-chain/state.yaml が作成されること',
  );

  const resume = runCli(['issue', 'resume', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(resume.status, 0, resume.stderr);
  assert.match(resume.stdout, /segment: spec \(pending\)/);

  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  const tokenMatch = /token:\s*(\S+)/.exec(acquire.stdout);
  assert.ok(tokenMatch, 'lease acquire は token を含む writer_lease YAML を出力すること');
  const token = tokenMatch![1];

  const acquireConflict = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquireConflict.status, 1, '有効な既存leaseと競合する再取得は失敗すること');
  assert.match(acquireConflict.stderr, /競合/);

  const segmentStart = runCli(['segment', 'start', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(segmentStart.status, 0, segmentStart.stderr);
  assert.match(segmentStart.stdout, /role: spec_worker/);

  const gateReview = runCli(['gate', 'review', 'ISSUE-1', 'spec', 'standard'], { cwd: worktreePath });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(gateReportPathMatch);
  const gateReportPath = gateReportPathMatch![1];
  assert.ok(fs.existsSync(gateReportPath));

  const reportText = fs
    .readFileSync(gateReportPath, 'utf8')
    .replace('conformance: pending', 'conformance: pass')
    .replace('falsification: pending', 'falsification: pass')
    .replace('final: pending', 'final: approved');
  fs.writeFileSync(gateReportPath, reportText);

  const gatePublish = runCli(['gate', 'publish', 'ISSUE-1', gateReportPath], { cwd: repo.dir });
  assert.equal(gatePublish.status, 0, gatePublish.stderr);

  const release = runCli(['lease', 'release', 'ISSUE-1', token], { cwd: repo.dir });
  assert.equal(release.status, 0, release.stderr);
  assert.equal(release.stdout.trim(), 'ISSUE-1');

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC.md追加'], { cwd: worktreePath });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  assert.match(checkpoint.stdout.trim(), /^[0-9a-f]{40}$/);

  const prCreate = runCli(['pr', 'create', 'ISSUE-1', branch], { cwd: repo.dir });
  assert.equal(prCreate.status, 0, prCreate.stderr);
  const integrationPath = prCreate.stdout.trim();
  assert.ok(fs.existsSync(integrationPath));

  // cleanup: 有効leaseは解放済み・commitはpush済みだが、Integration Recordが merged/closed で
  // なければ拒否される。
  const cleanupBeforeMerge = runCli(['cleanup', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(cleanupBeforeMerge.status, 1);
  assert.match(cleanupBeforeMerge.stderr, /Integration Record/);

  const integrationText = fs.readFileSync(integrationPath, 'utf8').replace('status: draft', 'status: merged');
  fs.writeFileSync(integrationPath, integrationText);

  const cleanup = runCli(['cleanup', 'ISSUE-1'], { cwd: repo.dir });
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.equal(cleanup.stdout.trim(), worktreePath);
  assert.ok(!fs.existsSync(worktreePath), 'cleanup後はworktreeが削除されていること');
});

test('gate review (CI単一checkout): .worktrees/ レイアウト無しでも、現在のブランチがissue_idに一致すればrootを対象に動作する', async (t) => {
  // GitHub Actions の actions/checkout は git worktree add を一切使わず、対象ブランチを
  // リポジトリルートへ直接チェックアウトするだけの単一チェックアウトを行う（Issue #171 実地障害の再現）。
  // findIssueWorktree の .worktrees/ 型レイアウト照合は空振りするため、rootへのフォールバックで
  // gate review が動作することを確認する。
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  execFileSync('git', ['checkout', '-b', 'feature/171-ci-gate-dogfood'], { cwd: repo.dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n');
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'wip: SPEC追加'], { cwd: repo.dir, stdio: 'pipe' });

  const gateReview = runCli(['gate', 'review', 'ISSUE-171', 'spec', 'strict'], { cwd: repo.dir });
  assert.equal(gateReview.status, 0, gateReview.stderr);
  const gateReportPathMatch = /gate_report_path:\s*(\S+)/.exec(gateReview.stdout);
  assert.ok(gateReportPathMatch, 'gate_report_path が出力されること');
  assert.ok(fs.existsSync(gateReportPathMatch![1]));
});

test('doctor (local backend): git/リポジトリ/configの検査がすべてOKになる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK {2}git\n/);
  assert.doesNotMatch(result.stdout, /gh CLI/);
});
