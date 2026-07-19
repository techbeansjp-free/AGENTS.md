import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// coordination.backend: github での中核フロー（issue start → lease acquire/release/re-acquire →
// segment start → gate review/publish(Check Run) → checkpoint → pr create → cleanup）と
// issue resume を、gh CLI を偽装する gh-stub 経由で素通し検証する。
// gh-stub は PATH 注入で差し替わるため、stub 用の実行可能ファイル・状態ファイルは
// 対象リポジトリ（repo.dir）とは別のスクラッチディレクトリに置く
// （repo.dir に置くと checkpoint の `git add -A` に巻き込まれてしまうため）。

function makeStub() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-integration-'));
  const stub = createGhStub(scratchDir);
  return { stub, env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

interface CheckRunRecord {
  name: string;
  head_sha: string;
  conclusion: string;
}

test('issue lifecycle (github backend): lease acquire/release/re-acquire -> gate publish(Check Run) -> pr create -> cleanup', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  // Given: githubバックエンドでは issue start はworktreeのみ作成し、ローカルstate.yamlは作らない
  // （coordination.backend === 'local' の場合のみ state.yaml を書く分岐が issue.ts start にある）。
  const start = runCli(['issue', 'start', 'ISSUE-9', 'feature', 'gh-flow', FIXED_TIMESTAMP], { cwd: repo.dir, env });
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');
  assert.equal(branch, 'feature/9-gh-flow');
  assert.ok(fs.existsSync(worktreePath), `worktree が作成されていること: ${worktreePath}`);
  assert.ok(
    !fs.existsSync(path.join(repo.dir, 'issues', '9', '.agent-skill-chain', 'state.yaml')),
    'githubモードではローカル state.yaml を作らないこと',
  );

  // When: lease acquire を実行する
  // Then: writer_lease（token含む）が標準出力へ、かつIssueコメントとして書き込まれる
  const acquire = runCli(['lease', 'acquire', 'ISSUE-9', 'spec'], { cwd: repo.dir, env });
  assert.equal(acquire.status, 0, acquire.stderr);
  const tokenMatch = /token:\s*(\S+)/.exec(acquire.stdout);
  assert.ok(tokenMatch, 'lease acquire は token を含む writer_lease YAML を出力すること');
  const token = tokenMatch![1];

  const commentsAfterAcquire = stub.readState().comments['9'] ?? [];
  assert.equal(commentsAfterAcquire.length, 1, 'acquireはIssueコメントを1件書き込むこと');
  assert.match(commentsAfterAcquire[0].body, /<!-- agent-skill-chain:lease -->/);
  assert.match(commentsAfterAcquire[0].body, new RegExp(`token: ${token}`));

  // When: 有効なleaseが存在する状態で（別tokenで）再度acquireを試みる
  // Then: 競合として拒否され、コメント数は増えない（先着優先。src/commands/lease.ts の acquire()
  // は投稿前に activeLeaseFor で既存アクティブleaseを検出し、この事前チェックの時点で拒否する。
  // 投稿後に再確認して撤回する楽観的排他制御パス（同ファイル90-106行目）は、真の並行実行時の
  // レース条件専用であり、決定的なCLI呼び出し2回では到達しない — 詳細は最終報告に記載）。
  const conflictAcquire = runCli(['lease', 'acquire', 'ISSUE-9', 'spec'], { cwd: repo.dir, env });
  assert.equal(conflictAcquire.status, 1, '有効な既存leaseと競合する再取得は失敗すること');
  assert.match(conflictAcquire.stderr, /競合/);
  assert.equal((stub.readState().comments['9'] ?? []).length, 1, '競合したacquireはコメントを増やさないこと');

  // When: releaseする
  // Then: 成功し、Issueコメントが削除される
  const release = runCli(['lease', 'release', 'ISSUE-9', token], { cwd: repo.dir, env });
  assert.equal(release.status, 0, release.stderr);
  assert.equal(release.stdout.trim(), 'ISSUE-9');
  assert.equal((stub.readState().comments['9'] ?? []).length, 0, 'release後はleaseコメントが削除されること');

  // When: release後に再acquireする
  // Then: 新しいtokenで成功すること（acquire→release→再acquireが通る）
  const reacquire = runCli(['lease', 'acquire', 'ISSUE-9', 'spec'], { cwd: repo.dir, env });
  assert.equal(reacquire.status, 0, reacquire.stderr);
  const token2Match = /token:\s*(\S+)/.exec(reacquire.stdout);
  assert.ok(token2Match);
  const token2 = token2Match![1];
  assert.notEqual(token2, token, '再acquireは新しいtokenを発行すること');

  // segment start はgithubバックエンドでも activeLeaseFor 経由で有効leaseを検出する
  const segmentStart = runCli(['segment', 'start', 'ISSUE-9', 'spec'], { cwd: repo.dir, env });
  assert.equal(segmentStart.status, 0, segmentStart.stderr);
  assert.match(segmentStart.stdout, /role: spec_worker/);

  // gate review はバックエンドを問わずworktree内のtarget_shaからgate-reportスキャフォールドを作る
  const gateReview = runCli(['gate', 'review', 'ISSUE-9', 'spec', 'standard'], { cwd: worktreePath, env });
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

  // When: gate publish する（githubブランチ）
  // Then: gh api repos/{owner}/{repo}/check-runs へ `-X POST --input -` でPOSTされ、
  // html_urlが標準出力に出る（以前は `-X POST` が抜けており既定のGETとして送信され、
  // gh-stub上もunhandledで必ず失敗していたが、src/commands/gate.ts で修正済み）。
  const gatePublish = runCli(['gate', 'publish', 'ISSUE-9', gateReportPath], { cwd: repo.dir, env });
  assert.equal(gatePublish.status, 0, gatePublish.stderr);
  assert.match(gatePublish.stdout.trim(), /^https:\/\/github\.com\/test\/repo\/runs\/\d+$/);
  assert.equal(
    ((stub.readState() as unknown as { checkRuns?: CheckRunRecord[] }).checkRuns ?? []).length,
    1,
    'Check Runが1件作成されること',
  );

  const release2 = runCli(['lease', 'release', 'ISSUE-9', token2], { cwd: repo.dir, env });
  assert.equal(release2.status, 0, release2.stderr);

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: サンプル\n');
  const checkpoint = runCli(['checkpoint', 'wip: SPEC.md追加'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  assert.match(checkpoint.stdout.trim(), /^[0-9a-f]{40}$/);

  // When: pr create する（githubブランチ）
  // Then: gh pr create --draft ... が呼ばれ、PR URLが標準出力に出ること
  const prCreate = runCli(['pr', 'create', 'ISSUE-9', branch], { cwd: repo.dir, env });
  assert.equal(prCreate.status, 0, prCreate.stderr);
  assert.equal(prCreate.stdout.trim(), 'https://github.com/test/repo/pull/1');

  // When: PRがまだmerged/closedではない状態でcleanupする
  // Then: 削除拒否される
  const cleanupBeforeMerge = runCli(['cleanup', 'ISSUE-9'], { cwd: repo.dir, env });
  assert.equal(cleanupBeforeMerge.status, 1);
  assert.match(cleanupBeforeMerge.stderr, /PR.*Integration Record|完了済み/);

  // When: gh pr list --head <branch> --state all --json state の結果がMERGEDになるよう仕込んでからcleanupする
  // Then: worktreeが削除される
  stub.seedPrList(branch, [{ state: 'MERGED' }]);
  const cleanupAfterMerge = runCli(['cleanup', 'ISSUE-9'], { cwd: repo.dir, env });
  assert.equal(cleanupAfterMerge.status, 0, cleanupAfterMerge.stderr);
  assert.equal(cleanupAfterMerge.stdout.trim(), worktreePath);
  assert.ok(!fs.existsSync(worktreePath), 'cleanup後はworktreeが削除されていること');
});

test('issue resume (github backend): PRが見つからない場合とgh pr listの結果を含む場合', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const start = runCli(['issue', 'start', 'ISSUE-11', 'feature', 'resume-flow', FIXED_TIMESTAMP], { cwd: repo.dir, env });
  assert.equal(start.status, 0, start.stderr);
  const [branch] = start.stdout.trim().split('\n');

  // When: 対応するDraft PRがまだ無い状態でresumeする
  // Then: 見つからない旨のメッセージが出る
  const resumeNoPr = runCli(['issue', 'resume', 'ISSUE-11'], { cwd: repo.dir, env });
  assert.equal(resumeNoPr.status, 0, resumeNoPr.stderr);
  assert.match(resumeNoPr.stdout, /gh pr: 見つかりません/);

  // When: gh pr list --head <branch> --json url,number,state,statusCheckRollup の結果を仕込んでresumeする
  // Then: その結果が出力に含まれる
  stub.seedPrList(branch, [{ url: 'https://github.com/test/repo/pull/5', number: 5, state: 'OPEN', statusCheckRollup: [] }]);
  const resumeWithPr = runCli(['issue', 'resume', 'ISSUE-11'], { cwd: repo.dir, env });
  assert.equal(resumeWithPr.status, 0, resumeWithPr.stderr);
  assert.match(resumeWithPr.stdout, /gh pr:/);
  assert.match(resumeWithPr.stdout, /"number":5/);
  assert.match(resumeWithPr.stdout, /"state":"OPEN"/);
});
