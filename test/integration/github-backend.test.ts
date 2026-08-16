import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

function prepareReviewStatusSegment(
  t: { after(callback: () => void): void },
  issueNumber: number,
  options: { seedPr?: boolean } = {},
) {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  const branch = `bugfix/${issueNumber}-review-status`;
  execFileSync('git', ['checkout', '-b', branch], { cwd: repo.dir, stdio: 'pipe' });
  if (options.seedPr !== false) {
    stub.seedOpenPr({ number: issueNumber + 1000, headRefName: branch, body: '' });
  }
  const acquire = runCli(['lease', 'acquire', `ISSUE-${issueNumber}`, 'spec'], { cwd: repo.dir, env });
  assert.equal(acquire.status, 0, acquire.stderr);
  t.after(() => {
    repo.cleanup();
    cleanup();
  });
  return { repo, stub, env, branch, prNumber: issueNumber + 1000 };
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
  // Then: tokenを除いたwriter_leaseが標準出力・Issueコメントへ書き込まれる
  const acquire = runCli(['lease', 'acquire', 'ISSUE-9', 'spec'], { cwd: repo.dir, env });
  assert.equal(acquire.status, 0, acquire.stderr);
  assert.doesNotMatch(acquire.stdout + acquire.stderr, /token:/, 'CLI出力へtokenを露出しないこと');
  const firstHolder = /holder:\s*(\S+)/.exec(acquire.stdout)?.[1];
  assert.ok(firstHolder);

  const commentsAfterAcquire = stub.readState().comments['9'] ?? [];
  assert.equal(commentsAfterAcquire.length, 1, 'acquireはIssueコメントを1件書き込むこと');
  assert.match(commentsAfterAcquire[0].body, /<!-- agent-skill-chain:lease -->/);
  assert.doesNotMatch(commentsAfterAcquire[0].body, /token:/);

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
  const release = runCli(['lease', 'release', 'ISSUE-9'], { cwd: repo.dir, env });
  assert.equal(release.status, 0, release.stderr);
  assert.equal(release.stdout.trim(), 'ISSUE-9');
  assert.equal((stub.readState().comments['9'] ?? []).length, 0, 'release後はleaseコメントが削除されること');

  // When: release後に再acquireする
  // Then: 新しいholderで成功すること（credentialを使うacquire→release→再acquireが通る）
  const reacquire = runCli(['lease', 'acquire', 'ISSUE-9', 'spec'], { cwd: repo.dir, env });
  assert.equal(reacquire.status, 0, reacquire.stderr);
  assert.doesNotMatch(reacquire.stdout + reacquire.stderr, /token:/);
  const secondHolder = /holder:\s*(\S+)/.exec(reacquire.stdout)?.[1];
  assert.ok(secondHolder);
  assert.notEqual(secondHolder, firstHolder, '再acquireは新しいholderを発行すること');

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

  const release2 = runCli(['lease', 'release', 'ISSUE-9'], { cwd: repo.dir, env });
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

test('segment start (github backend): size:quick のimplementation契約はIssue本文を入力にして免除成果物を要求しない（Issue #690）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const start = runCli(['issue', 'start', 'ISSUE-690', 'bugfix', 'quick-contract', FIXED_TIMESTAMP], {
    cwd: repo.dir,
    env,
  });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  assert.equal(fs.existsSync(path.join(worktreePath, 'SPEC.md')), false);
  assert.equal(fs.existsSync(path.join(worktreePath, 'DESIGN.md')), false);
  assert.equal(fs.existsSync(path.join(worktreePath, 'PLAN.md')), false);

  stub.seedIssueLabels('690', ['type:bugfix', 'risk:normal', 'size:quick']);
  stub.seedIssueBody('690', 'quick契約だけで実装対象を確定できる要求本文');
  const acquire = runCli(['lease', 'acquire', 'ISSUE-690', 'implementation'], { cwd: repo.dir, env });
  assert.equal(acquire.status, 0, acquire.stderr);

  const result = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /request: quick契約だけで実装対象を確定できる要求本文/);

  const contract = result.stdout.slice(result.stdout.indexOf('inputs:'), result.stdout.indexOf('worker_completion_report:'));
  assert.match(contract, /inputs:\n\s+- Issue/);
  assert.doesNotMatch(contract, /\n\s+- (?:SPEC\.md|DESIGN\.md|PLAN\.md)\s*$/m);
  assert.doesNotMatch(contract, /\n\s+- accepted ADR\s*$/m);
  assert.match(contract, /related accepted ADR（存在する場合）/);
  assert.doesNotMatch(contract, /PLANの順序に従う/);
  assert.match(contract, /Issue内容から実装範囲を確定できない場合は推測で補完せずblockedを報告する/);
  assert.match(contract, /gate-reportを書き換えない/);
  assert.match(contract, /自worktree内でのみ作業する/);
  assert.match(contract, /必須チェック（lint\/test\/build）実行済み/);
  assert.match(contract, /commit \+ push済み/);

  stub.seedIssueLabels('690', ['type:bugfix', 'risk:high', 'size:quick']);
  const guarded = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir, env });
  assert.equal(guarded.status, 0, guarded.stderr);
  assert.match(guarded.stderr, /risk が normal ではありません（現在: high）/);
  assert.match(guarded.stdout, /inputs:\n\s+- SPEC\.md\n\s+- DESIGN\.md\n\s+- PLAN\.md/);
  assert.match(guarded.stdout, /PLANの順序に従う/);
  assert.doesNotMatch(guarded.stdout, /quick契約だけで実装対象を確定できる要求本文/);
});

test('segment start (github backend): CHANGES_REQUESTEDレビューをrole contractへ同梱する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 440);
  stub.seedPrReviews(prNumber, [
    {
      state: 'CHANGES_REQUESTED',
      author: { login: 'reviewer' },
      body: 'null時のフォールバックを追加してください',
      submittedAt: '2099-01-01T00:00:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-440', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^review_status:/m);
  assert.match(result.stdout, /state: CHANGES_REQUESTED/);
  assert.match(result.stdout, /null時のフォールバックを追加してください/);
});

test('segment start (github backend): 時刻カットオフ無しでPR/Issueコメントをrole contractへ同梱する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 441);
  const createdAt = '2000-01-01T00:00:00Z';
  stub.seedPrComments(prNumber, [
    { author: { login: 'maintainer' }, body: 'PR側の修正依頼です', createdAt },
  ]);
  const state = stub.readState();
  state.comments['441'] = [
    ...(state.comments['441'] ?? []),
    { id: 'feedback-1', url: 'https://example.test/issues/441', body: 'Issue側の修正依頼です', createdAt },
  ];
  stub.writeState(state);

  const result = runCli(['segment', 'start', 'ISSUE-441', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /source: pr_comment/);
  assert.match(result.stdout, /PR側の修正依頼です/);
  assert.match(result.stdout, /source: issue_comment/);
  assert.match(result.stdout, /Issue側の修正依頼です/);
});

test('segment start (github backend): APPROVEDで未対応コメント無しならreview_statusを誤検出しない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 442);
  stub.seedPrReviews(prNumber, [{ state: 'APPROVED', author: { login: 'reviewer' }, body: 'approved' }]);

  const result = runCli(['segment', 'start', 'ISSUE-442', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^review_status:/m);
  assert.match(result.stdout, /作業再開時は対象Issue\/PRの最新レビュー・コメント/);
});

test('segment start (github backend): Issue側とPR側の取得が両方失敗してもdetection failedを同梱し起動を継続する', (t) => {
  const { repo, stub, env, branch } = prepareReviewStatusSegment(t, 443);
  stub.seedIssueViewFailure('443', { stderr: 'issue API unavailable\n' });
  stub.seedPrViewFailure(branch, { stderr: 'review API unavailable\n' });

  const result = runCli(['segment', 'start', 'ISSUE-443', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^review_status:/m);
  assert.match(result.stdout, /detection: failed/);
  assert.match(result.stdout, /issue API unavailable/);
  assert.match(result.stdout, /review API unavailable/);
  assert.match(result.stdout, /作業再開時は対象Issue\/PRの最新レビュー・コメント/);
});

test('segment start (github backend): Draft PR作成前でもIssueコメントをrole contractへ同梱する', (t) => {
  const { repo, stub, env } = prepareReviewStatusSegment(t, 444, { seedPr: false });
  const state = stub.readState();
  state.comments['444'] = [
    ...(state.comments['444'] ?? []),
    {
      id: 'feedback-before-pr',
      url: 'https://example.test/issues/444',
      body: 'Draft PR作成前の修正依頼です',
      createdAt: '2000-01-01T00:00:00Z',
    },
  ];
  stub.writeState(state);

  const result = runCli(['segment', 'start', 'ISSUE-444', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /source: issue_comment/);
  assert.match(result.stdout, /Draft PR作成前の修正依頼です/);
  assert.doesNotMatch(result.stdout, /partial_failures:/);
});

test('segment start (github backend): PR側だけ取得失敗してもIssueコメントとpartial failureを同梱する', (t) => {
  const { repo, stub, env, branch } = prepareReviewStatusSegment(t, 445);
  stub.seedPrViewFailure(branch, { stderr: 'authentication required\n' });
  const state = stub.readState();
  state.comments['445'] = [
    ...(state.comments['445'] ?? []),
    {
      id: 'feedback-partial',
      url: 'https://example.test/issues/445',
      body: '取得済みのIssue側修正依頼です',
      createdAt: '2000-01-01T00:00:00Z',
    },
  ];
  stub.writeState(state);

  const result = runCli(['segment', 'start', 'ISSUE-445', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /取得済みのIssue側修正依頼です/);
  assert.match(result.stdout, /partial_failures:/);
  assert.match(result.stdout, /side: pr/);
  assert.match(result.stdout, /authentication\s+required/);
});

test('segment start (github backend): 対象Issueと不一致のbranchではPR取得せずIssueコメントと失敗通知を同梱する', (t) => {
  const { repo, stub, env } = prepareReviewStatusSegment(t, 446);
  execFileSync('git', ['checkout', '-b', 'bugfix/999-unrelated'], { cwd: repo.dir, stdio: 'pipe' });
  const state = stub.readState();
  state.comments['446'] = [
    ...(state.comments['446'] ?? []),
    {
      id: 'feedback-correct-issue',
      url: 'https://example.test/issues/446',
      body: '対象Issue側の修正依頼です',
      createdAt: '2000-01-01T00:00:00Z',
    },
  ];
  stub.writeState(state);
  const prViewCallsBefore = stub.readState().prViewCalls?.length ?? 0;

  const result = runCli(['segment', 'start', 'ISSUE-446', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /対象Issue側の修正依頼です/);
  assert.match(result.stdout, /partial_failures:/);
  assert.match(result.stdout, /side: pr/);
  assert.match(result.stdout, /一致しません/);
  assert.equal(stub.readState().prViewCalls?.length ?? 0, prViewCallsBefore);
});

test('segment start (github backend): CLOSED PRのレビュー履歴・補足本文・インラインコメントを同梱する', (t) => {
  const { repo, stub, env, branch, prNumber } = prepareReviewStatusSegment(t, 447, { seedPr: false });
  stub.seedOpenPr({ number: prNumber, headRefName: branch, body: '', state: 'CLOSED' });
  stub.seedPrReviews(prNumber, [
    {
      state: 'CHANGES_REQUESTED',
      author: { login: 'reviewer' },
      body: 'closed PR blocking',
      submittedAt: '2026-08-05T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'reviewer' },
      body: '追加指摘1',
      submittedAt: '2026-08-05T00:01:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'reviewer' },
      body: '追加指摘2',
      submittedAt: '2026-08-05T00:02:00Z',
    },
  ]);
  stub.seedPrReviewThreadComments(prNumber, [
    {
      user: { login: 'inline-reviewer' },
      body: '差分行の指摘',
      created_at: '2026-08-05T00:03:00Z',
      html_url: 'https://example.test/pull/1447#discussion_r1',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-447', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /closed PR blocking/);
  assert.match(result.stdout, /comment_bodies:/);
  assert.match(result.stdout, /追加指摘1/);
  assert.match(result.stdout, /追加指摘2/);
  assert.match(result.stdout, /source: review_thread_comment/);
  assert.match(result.stdout, /差分行の指摘/);
});

test('segment start (github backend): インラインコメント取得だけ失敗してもPRレビューを保持する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 448);
  stub.seedPrReviews(prNumber, [
    {
      state: 'CHANGES_REQUESTED',
      author: { login: 'reviewer' },
      body: '取得済みレビューを保持',
      submittedAt: '2026-08-05T00:00:00Z',
    },
  ]);
  stub.seedPrReviewThreadCommentsFailure(prNumber, { stderr: 'inline API unavailable\n' });

  const result = runCli(['segment', 'start', 'ISSUE-448', 'spec'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /取得済みレビューを保持/);
  assert.match(result.stdout, /side: pr_review_thread_comments/);
  assert.match(result.stdout, /inline API unavailable/);
  assert.doesNotMatch(result.stdout, /detection: failed/);
});

test('segment start (github backend): linked worktree自身のbranchでPR側レビューを解決する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  const branch = 'bugfix/449-linked-worktree-review-status';
  const linkedWorktree = path.join(repo.dir, '.worktrees', 'linked-review-status');
  fs.mkdirSync(path.dirname(linkedWorktree), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-b', branch, linkedWorktree], { cwd: repo.dir, stdio: 'pipe' });
  stub.seedOpenPr({ number: 1449, headRefName: branch, body: '' });
  stub.seedPrReviews(1449, [
    {
      state: 'CHANGES_REQUESTED',
      author: { login: 'reviewer' },
      body: 'linked worktree review',
      submittedAt: '2026-08-05T00:00:00Z',
    },
  ]);
  const acquire = runCli(['lease', 'acquire', 'ISSUE-449', 'spec'], { cwd: linkedWorktree, env });
  assert.equal(acquire.status, 0, acquire.stderr);
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const result = runCli(['segment', 'start', 'ISSUE-449', 'spec'], { cwd: linkedWorktree, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /linked worktree review/);
  assert.doesNotMatch(result.stdout, /ブランチ命名規則.*一致しません/);
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

// Issue #174 AC-10: pr create（githubモード）がPRテンプレートの5節を反映した本文を組み立てることを
// gh-stub が記録する --body の内容から検証する。

test('pr create (github backend): SPEC.mdのみが存在する場合、変更概要・理由・成果物リンクが自動充填され、影響範囲・ロールバック方針はプレースホルダのまま残る', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const start = runCli(['issue', 'start', 'ISSUE-20', 'feature', 'pr-template-flow', FIXED_TIMESTAMP], { cwd: repo.dir, env });
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(
    path.join(worktreePath, 'SPEC.md'),
    ['# SPEC: サンプル機能のテンプレート反映', '', '## 目的・背景', '', 'これはテスト用の目的説明です。', '', '## スコープ外', '', '- なし', ''].join('\n'),
  );
  const checkpoint = runCli(['checkpoint', 'wip: SPEC.md追加'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  const prCreate = runCli(['pr', 'create', 'ISSUE-20', branch], { cwd: repo.dir, env });
  assert.equal(prCreate.status, 0, prCreate.stderr);

  const calls = stub.readState().prCreateCalls ?? [];
  assert.equal(calls.length, 1, 'gh pr create が1回呼ばれること');
  const body = calls[0].body ?? '';

  assert.match(body, /Closes #20/);
  assert.match(body, /## 変更概要\n\nサンプル機能のテンプレート反映/);
  assert.match(body, /## 理由\n\nこれはテスト用の目的説明です。/);
  assert.match(body, /## 影響範囲\n\n<影響範囲をここに記述>/, '影響範囲はDESIGN.md未作成のためプレースホルダのまま残ること');
  assert.match(body, /## ロールバック方針\n\n<ロールバック方針をここに記述>/, 'ロールバック方針はDESIGN.md未作成のためプレースホルダのまま残ること');
  assert.match(body, /## 成果物リンク\n\n- `SPEC\.md`/);
  assert.match(body, /## このPRに含まれるセグメント/, '既存の2節（セグメント・自己完結性チェック）はそのまま維持されること');
});

test('pr create (github backend): DESIGN.mdも存在する場合、影響範囲・ロールバック方針も自動充填される', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const start = runCli(['issue', 'start', 'ISSUE-21', 'feature', 'pr-template-design', FIXED_TIMESTAMP], { cwd: repo.dir, env });
  assert.equal(start.status, 0, start.stderr);
  const [branch, worktreePath] = start.stdout.trim().split('\n');

  fs.writeFileSync(
    path.join(worktreePath, 'SPEC.md'),
    ['# SPEC: DESIGN反映確認用', '', '## 目的・背景', '', '目的の本文。', ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(worktreePath, 'DESIGN.md'),
    [
      '# DESIGN: DESIGN反映確認用',
      '',
      '## 障害・ロールバック考慮',
      '',
      '- 想定される失敗モード: サンプルの失敗モード',
      '- ロールバック手順: ロールバック手順のテスト値',
      '- 影響を受ける既存機能: 影響範囲のテスト値',
      '',
    ].join('\n'),
  );
  const checkpoint = runCli(['checkpoint', 'wip: SPEC.md/DESIGN.md追加'], { cwd: worktreePath, env });
  assert.equal(checkpoint.status, 0, checkpoint.stderr);

  const prCreate = runCli(['pr', 'create', 'ISSUE-21', branch], { cwd: repo.dir, env });
  assert.equal(prCreate.status, 0, prCreate.stderr);

  const calls = stub.readState().prCreateCalls ?? [];
  const body = calls[calls.length - 1].body ?? '';

  assert.match(body, /## 影響範囲\n\n影響範囲のテスト値/);
  assert.match(body, /## ロールバック方針\n\nロールバック手順のテスト値/);
  assert.match(body, /## 成果物リンク\n\n- `SPEC\.md`\n- `DESIGN\.md`/);
});

test('pr create (github backend): PRテンプレートが読めない場合はIssue #174着手前と同一のCloses #<id>のみの本文にフォールバックする', async (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  const { stub, env, cleanup } = makeStub();
  t.after(() => {
    repo.cleanup();
    cleanup();
  });

  const start = runCli(['issue', 'start', 'ISSUE-22', 'feature', 'pr-template-fallback', FIXED_TIMESTAMP], { cwd: repo.dir, env });
  assert.equal(start.status, 0, start.stderr);
  const [branch] = start.stdout.trim().split('\n');

  // Given: 対象リポジトリ側のテンプレートファイルパスをディレクトリに差し替える。
  // resolveAsset は target_root 側の .agent-skill-chain 配下を優先して existsSync のみで判定するため、
  // ファイルではなくディレクトリが存在する状態を作ると readFileSync が例外を投げ、
  // 「テンプレートが読めない」状態（配布同期前・パッケージ側にも同ファイルが無い状態と同種の失敗）を
  // 安全に再現できる（パッケージ本体の実ファイルには一切触れない）。
  const templatePath = path.join(repo.dir, '.agent-skill-chain', 'templates', 'github', '.github', 'pull_request_template.md');
  fs.rmSync(templatePath);
  fs.mkdirSync(templatePath);

  const prCreate = runCli(['pr', 'create', 'ISSUE-22', branch], { cwd: repo.dir, env });
  assert.equal(prCreate.status, 0, prCreate.stderr);

  const calls = stub.readState().prCreateCalls ?? [];
  const body = calls[calls.length - 1].body ?? '';
  assert.equal(body, 'Closes #22');
});
