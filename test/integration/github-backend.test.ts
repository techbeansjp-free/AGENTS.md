import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { renderReviewEvidence, type ReviewEvidence } from '../../src/lib/review-evidence.js';

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

function gateEvidence(options: {
  issueId: string;
  gate: ReviewEvidence['gate'];
  targetSha: string;
  attemptId: string;
  expectedCount?: ReviewEvidence['expected_count'];
  profile?: ReviewEvidence['profile'];
  reviewerSlot?: ReviewEvidence['reviewer']['slot'];
  promptDigest?: string;
  conformance?: ReviewEvidence['verdict']['conformance'];
  falsification?: ReviewEvidence['verdict']['falsification'];
  inconclusive?: boolean;
  blockers: ReviewEvidence['verdict']['blockers'];
}): string {
  const expectedCount = options.expectedCount ?? 1;
  const reviewerSlot = options.reviewerSlot ?? 1;
  return renderReviewEvidence({
    schema_version: 'agent-skill-chain/gate-review-evidence/v3',
    issue_id: options.issueId,
    gate: options.gate,
    profile: options.profile ?? (expectedCount === 2 ? 'strict' : 'standard'),
    target_sha: options.targetSha,
    attempt_id: options.attemptId,
    expected_count: expectedCount,
    execution: {
      launcher: 'agent-skill-chain/gate-local-review/v1',
      trusted_base_sha: 'a'.repeat(40),
      launcher_digest: `sha256:${'b'.repeat(64)}`,
      launcher_token_digest: `sha256:${'c'.repeat(64)}`,
      isolation: 'ephemeral_clone',
      sandbox: 'read_only',
    },
    reviewer: {
      run_id: `review-${options.attemptId}-${reviewerSlot}`,
      slot: reviewerSlot,
      adapter: 'codex',
      model: 'test-model',
      reasoning: 'high',
      capability: { model_tier: 'test', reasoning_tier: 'test', read_only: true },
    },
    prompt_digest: options.promptDigest ?? `sha256:${'d'.repeat(64)}`,
    verdict: {
      conformance: options.conformance ?? (options.blockers.length > 0 ? 'fail' : 'pass'),
      falsification: options.falsification ?? 'pass',
      blockers: options.blockers,
      approved_artifacts: [],
      inconclusive: options.inconclusive ?? false,
    },
  });
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

test('segment start (github backend): size:quick のimplementation契約はIssue本文と存在する成果物だけを使う（Issue #690）', (t) => {
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

  fs.writeFileSync(path.join(worktreePath, 'PLAN.md'), '# PLAN\n\n1. 既存の計画を実行する\n');
  const withPlan = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir, env });
  assert.equal(withPlan.status, 0, withPlan.stderr);
  const contractWithPlan = withPlan.stdout.slice(
    withPlan.stdout.indexOf('inputs:'),
    withPlan.stdout.indexOf('worker_completion_report:'),
  );
  assert.match(contractWithPlan, /\n\s+- PLAN\.md\s*$/m);
  assert.match(contractWithPlan, /PLANの順序に従う/);

  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nquick要求\n');
  fs.writeFileSync(path.join(worktreePath, 'DESIGN.md'), '# DESIGN\n\nquick設計\n');
  const withAllArtifacts = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir, env });
  assert.equal(withAllArtifacts.status, 0, withAllArtifacts.stderr);
  const contractWithAllArtifacts = withAllArtifacts.stdout.slice(
    withAllArtifacts.stdout.indexOf('inputs:'),
    withAllArtifacts.stdout.indexOf('worker_completion_report:'),
  );
  assert.match(contractWithAllArtifacts, /inputs:\n\s+- Issue\n\s+- SPEC\.md\n\s+- DESIGN\.md\n\s+- PLAN\.md/);
  assert.match(contractWithAllArtifacts, /承認済みSPEC\/DESIGNを変更しない/);
  assert.match(contractWithAllArtifacts, /PLANの順序に従う/);

  for (const payload of [
    { number: 690, title: '', body: '' },
    { number: 690, title: ' \n\t', body: ' \n\t' },
    { number: 690, title: 'quick契約のGitHub検証', body: '' },
    { number: 690, title: 'quick契約のGitHub検証', body: ' \n\t' },
  ]) {
    stub.seedIssueContentResponse('690', { stdout: JSON.stringify(payload) });
    const emptyIssue = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir, env });
    assert.equal(emptyIssue.status, 1);
    assert.match(emptyIssue.stderr, /Issue内容を取得できないためsize:quick用のimplementation契約を生成できません/);
    assert.doesNotMatch(emptyIssue.stdout, /^role: implementation_worker/m);
  }

  stub.seedIssueContentResponse('690', { status: 1, stderr: 'issue API unavailable\n' });
  const unavailableIssue = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir, env });
  assert.equal(unavailableIssue.status, 1);
  assert.match(unavailableIssue.stderr, /Issue内容を取得できないためsize:quick用のimplementation契約を生成できません/);

  stub.seedIssueContentResponse('690', { stdout: '{invalid json' });
  const malformedIssue = runCli(['segment', 'start', 'ISSUE-690', 'implementation'], { cwd: repo.dir, env });
  assert.equal(malformedIssue.status, 1);
  assert.match(malformedIssue.stderr, /Issue内容を取得できないためsize:quick用のimplementation契約を生成できません/);

  stub.seedIssueContentResponse('690');

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

test('segment start (github backend): COMMENTEDのgate evidenceにあるblocking findingをrole contractへ同梱する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 680);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-680',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-680-blocking',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'SPEC-MISSING-CONTRACT',
          evidence: ['ワーカー契約へblocking findingが含まれていません'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-680', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^review_status:/m);
  assert.match(result.stdout, /unresolved_blocking_findings:/);
  assert.match(result.stdout, /SPEC-MISSING-CONTRACT/);
  assert.match(result.stdout, /ワーカー契約へblocking findingが含まれていません/);
  assert.match(result.stdout, /source_segment: spec/);
});

test('segment start (github backend): local HEADと異なるPR head SHAのblocking evidenceを同梱する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 700);
  const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const prHeadSha = 'f'.repeat(40);
  assert.notEqual(localHead, prHeadSha);
  const state = stub.readState();
  const pr = Object.values(state.prsByBranch ?? {}).find((candidate) => candidate.number === prNumber);
  assert.ok(pr);
  pr.headRefOid = prHeadSha;
  stub.writeState(state);
  stub.seedPrReviews(prNumber, [{
    state: 'COMMENTED',
    author: { login: 'adachi-tatsuru' },
    body: gateEvidence({
      issueId: 'ISSUE-700',
      gate: 'spec',
      targetSha: prHeadSha,
      attemptId: 'attempt-700-pr-head',
      blockers: [{
        severity: 'blocking',
        origin: 'specification',
        code: 'PR-HEAD-BLOCKER',
        evidence: ['PR headを対象とする最新findingです'],
      }],
    }),
    submittedAt: '2026-08-15T00:00:00Z',
  }]);

  const result = runCli(['segment', 'start', 'ISSUE-700', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR-HEAD-BLOCKER/);
  assert.match(result.stdout, /PR headを対象とする最新findingです/);
  assert.doesNotMatch(result.stdout, /gate_review_target_sha/);
});

test('segment start (github backend): strictでexpected_count=1のattemptは過去のblocking findingを消さない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 703);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-703',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-703-blocking-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'PROFILE-COUNT-PREVIOUS-BLOCKER',
          evidence: ['profileとexpected_countが整合しないattemptより前のfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-703',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-703-profile-count-mismatch',
        profile: 'strict',
        expectedCount: 1,
        blockers: [],
      }),
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-703', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCOMPLETE/);
  assert.match(result.stdout, /PROFILE-COUNT-PREVIOUS-BLOCKER/);
  assert.match(result.stdout, /profileとexpected_countが整合しないattemptより前のfindingです/);
});

test('segment start (github backend): 後発standard attemptはstrict attemptのblocking findingを消さない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 706);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    ...([1, 2] as const).map((slot) => ({
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-706',
        gate: 'spec' as const,
        targetSha,
        attemptId: 'attempt-706-strict-blocking-old',
        expectedCount: 2 as const,
        reviewerSlot: slot,
        blockers: slot === 1 ? [{
          severity: 'blocking' as const,
          origin: 'specification' as const,
          code: 'STRICT-PROFILE-BLOCKER',
          evidence: ['standard profileでは解消できないstrict attemptのfindingです'],
        }] : [],
      }),
      submittedAt: `2026-08-15T00:0${slot - 1}:00Z`,
    })),
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-706',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-706-standard-clear-new',
        blockers: [],
      }),
      submittedAt: '2026-08-15T00:02:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-706', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /STRICT-PROFILE-BLOCKER/);
  assert.match(result.stdout, /standard profileでは解消できないstrict attemptのfindingです/);
});

test('segment start (github backend): 後発strict attemptはstandard attemptのblocking findingを解消する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 707);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-707',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-707-standard-blocking-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'STANDARD-PROFILE-RESOLVED',
          evidence: ['strict profileにより解消されるstandard attemptのfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    ...([1, 2] as const).map((slot) => ({
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-707',
        gate: 'spec' as const,
        targetSha,
        attemptId: 'attempt-707-strict-clear-new',
        expectedCount: 2 as const,
        reviewerSlot: slot,
        blockers: [],
      }),
      submittedAt: `2026-08-15T00:0${slot}:00Z`,
    })),
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-707', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /STANDARD-PROFILE-RESOLVED/);
  assert.doesNotMatch(result.stdout, /strict profileにより解消されるstandard attemptのfindingです/);
});

test('segment start (github backend): required_profileがstrictならstandard attemptはblocking findingを消さない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 708);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-708',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-708-standard-blocking-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'REQUIRED-STRICT-BLOCKER',
          evidence: ['required_profileを下回るattemptでは解消できないfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-708',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-708-standard-clear-new',
        blockers: [],
      }),
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-708', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REQUIRED-STRICT-BLOCKER/);
  assert.match(result.stdout, /required_profileを下回るattemptでは解消できないfindingです/);
});

test('segment start (github backend): PR head前進後も旧SHAのblocking findingを未再判定として保持する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 704);
  const previousSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const currentSha = 'e'.repeat(40);
  const state = stub.readState();
  const pr = Object.values(state.prsByBranch ?? {}).find((candidate) => candidate.number === prNumber);
  assert.ok(pr);
  pr.headRefOid = currentSha;
  stub.writeState(state);
  stub.seedPrReviews(prNumber, [{
    state: 'COMMENTED',
    author: { login: 'adachi-tatsuru' },
    body: gateEvidence({
      issueId: 'ISSUE-704',
      gate: 'spec',
      targetSha: previousSha,
      attemptId: 'attempt-704-previous-head',
      blockers: [{
        severity: 'blocking',
        origin: 'specification',
        code: 'PREVIOUS-SHA-BLOCKER',
        evidence: ['PR head前進前に確認されたfindingです'],
      }],
    }),
    submittedAt: '2026-08-15T00:00:00Z',
  }]);

  const result = runCli(['segment', 'start', 'ISSUE-704', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PREVIOUS-SHA-BLOCKER/);
  assert.match(result.stdout, /PR head前進前に確認されたfindingです/);
  assert.match(result.stdout, /現在のPR head .* と異なるため未再判定です/);
});

test('segment start (github backend): 現在のPR headに対する確定attemptで旧SHAのblocking findingを置換する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 705);
  const previousSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const currentSha = 'e'.repeat(40);
  const state = stub.readState();
  const pr = Object.values(state.prsByBranch ?? {}).find((candidate) => candidate.number === prNumber);
  assert.ok(pr);
  pr.headRefOid = currentSha;
  stub.writeState(state);
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-705',
        gate: 'spec',
        targetSha: previousSha,
        attemptId: 'attempt-705-previous-head',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'SUPERSEDED-PREVIOUS-SHA-BLOCKER',
          evidence: ['現在のPR headに対する確定attemptで解消されるfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    ...([1, 2] as const).map((slot) => ({
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-705',
        gate: 'spec' as const,
        targetSha: currentSha,
        attemptId: 'attempt-705-current-head',
        expectedCount: 2 as const,
        reviewerSlot: slot,
        blockers: [],
      }),
      submittedAt: `2026-08-15T00:0${slot}:00Z`,
    })),
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-705', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /SUPERSEDED-PREVIOUS-SHA-BLOCKER/);
  assert.doesNotMatch(result.stdout, /現在のPR headに対する確定attemptで解消されるfindingです/);
  assert.doesNotMatch(result.stdout, /未再判定/);
});

test('segment start (github backend): PR head SHAを取得できない場合はlocal HEADへfallbackしない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 701);
  const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const state = stub.readState();
  const pr = Object.values(state.prsByBranch ?? {}).find((candidate) => candidate.number === prNumber);
  assert.ok(pr);
  pr.headRefOid = null;
  stub.writeState(state);
  stub.seedPrReviews(prNumber, [{
    state: 'COMMENTED',
    author: { login: 'adachi-tatsuru' },
    body: gateEvidence({
      issueId: 'ISSUE-701',
      gate: 'spec',
      targetSha: localHead,
      attemptId: 'attempt-701-local-head',
      blockers: [{
        severity: 'blocking',
        origin: 'specification',
        code: 'LOCAL-HEAD-BLOCKER',
        evidence: ['local HEADへfallbackした場合だけ現れるfindingです'],
      }],
    }),
    submittedAt: '2026-08-15T00:00:00Z',
  }]);

  const result = runCli(['segment', 'start', 'ISSUE-701', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /LOCAL-HEAD-BLOCKER/);
  assert.match(result.stdout, /GATE_REVIEW_TARGET_SHA_UNVERIFIED/);
  assert.match(result.stdout, /side: gate_review_target_sha/);
  assert.match(result.stdout, /head SHAを取得できません/);
});

test('segment start (github backend): trusted actorの解釈不能evidenceを部分障害と未確定blockerとして同梱する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 702);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-702',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-702-conclusive-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'MALFORMED-PREVIOUS-BLOCKER',
          evidence: ['解釈不能evidenceより前に確認されたfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: '<!-- agent-skill-chain:gate-review-evidence -->\n```json\n{ invalid json\n```\n',
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-702', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GATE_REVIEW_EVIDENCE_MALFORMED/);
  assert.match(result.stdout, /MALFORMED-PREVIOUS-BLOCKER/);
  assert.match(result.stdout, /解釈不能evidenceより前に確認されたfindingです/);
  assert.match(result.stdout, /trusted actorのゲートレビューevidenceを解釈できません/);
  assert.match(result.stdout, /side: gate_review_evidence/);
  assert.match(result.stdout, /partial_failures:/);
});

test('segment start (github backend): 未登録actorのgate evidenceをrole contractへ同梱しない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 681);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'untrusted-recorder' },
      body: gateEvidence({
        issueId: 'ISSUE-681',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-681-forged',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'FORGED-BLOCKER',
          evidence: ['未登録actorが投稿した偽造findingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-681', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /FORGED-BLOCKER/);
  assert.doesNotMatch(result.stdout, /未登録actorが投稿した偽造findingです/);
});

test('segment start (github backend): 未登録actorの新しいattemptで登録済みactorのattemptを置換しない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 682);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-682',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-682-trusted',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'TRUSTED-BLOCKER',
          evidence: ['登録済みactorによるfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'untrusted-recorder' },
      body: gateEvidence({
        issueId: 'ISSUE-682',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-682-forged-newer',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'FORGED-NEWER-BLOCKER',
          evidence: ['未登録actorによる新しいattemptです'],
        }],
      }),
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-682', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TRUSTED-BLOCKER/);
  assert.match(result.stdout, /登録済みactorによるfindingです/);
  assert.doesNotMatch(result.stdout, /FORGED-NEWER-BLOCKER/);
  assert.doesNotMatch(result.stdout, /未登録actorによる新しいattemptです/);
});

test('segment start (github backend): 候補branchで追加したactorをtrusted actorとして扱わない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 688);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const manifestPath = path.join(repo.dir, '.agent-skill-chain', 'project', 'manifest.yaml');
  const originalManifest = fs.readFileSync(manifestPath, 'utf8');
  const manifest = originalManifest.replace(
    '      trusted_reviewer_actors:\n        - adachi-tatsuru',
    '      trusted_reviewer_actors:\n        - adachi-tatsuru\n        - candidate-recorder',
  );
  assert.notEqual(manifest, originalManifest, '候補branchのtrusted actor登録を書き換えられること');
  fs.writeFileSync(manifestPath, manifest);
  stub.seedPrReviews(prNumber, [{
    state: 'COMMENTED',
    author: { login: 'candidate-recorder' },
    body: gateEvidence({
      issueId: 'ISSUE-688',
      gate: 'spec',
      targetSha,
      attemptId: 'attempt-688-candidate-policy',
      blockers: [{
        severity: 'blocking',
        origin: 'specification',
        code: 'CANDIDATE-POLICY-BLOCKER',
        evidence: ['候補branchだけが登録したactorによるfindingです'],
      }],
    }),
    submittedAt: '2026-08-15T00:00:00Z',
  }]);

  const result = runCli(['segment', 'start', 'ISSUE-688', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /CANDIDATE-POLICY-BLOCKER/);
  assert.doesNotMatch(result.stdout, /候補branchだけが登録したactorによるfindingです/);
});

test('segment start (github backend): 候補branchのmanifest削除後もdefault branchのtrusted actor登録を使う', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 689);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  fs.rmSync(path.join(repo.dir, '.agent-skill-chain', 'project', 'manifest.yaml'));
  stub.seedPrReviews(prNumber, [{
    state: 'COMMENTED',
    author: { login: 'adachi-tatsuru' },
    body: gateEvidence({
      issueId: 'ISSUE-689',
      gate: 'spec',
      targetSha,
      attemptId: 'attempt-689-protected-policy',
      blockers: [{
        severity: 'blocking',
        origin: 'specification',
        code: 'PROTECTED-POLICY-BLOCKER',
        evidence: ['default branchの登録済みactorによるfindingです'],
      }],
    }),
    submittedAt: '2026-08-15T00:00:00Z',
  }]);

  const result = runCli(['segment', 'start', 'ISSUE-689', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PROTECTED-POLICY-BLOCKER/);
  assert.match(result.stdout, /default branchの登録済みactorによるfindingです/);
  assert.doesNotMatch(result.stdout, /gate_review_trust_policy/);
});

test('segment start (github backend): localのremote-tracking refを書き換えてもGitHubのtrusted actor登録を使う', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 694);
  const manifestPath = path.join(repo.dir, '.agent-skill-chain', 'project', 'manifest.yaml');
  const originalManifest = fs.readFileSync(manifestPath, 'utf8');
  const manifest = originalManifest.replace(
    '      trusted_reviewer_actors:\n        - adachi-tatsuru',
    '      trusted_reviewer_actors:\n        - adachi-tatsuru\n        - candidate-recorder',
  );
  assert.notEqual(manifest, originalManifest, '候補branchのtrusted actor登録を書き換えられること');
  fs.writeFileSync(manifestPath, manifest);
  execFileSync('git', ['add', manifestPath], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'test: mutate candidate trust policy'], { cwd: repo.dir, stdio: 'pipe' });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', targetSha], { cwd: repo.dir, stdio: 'pipe' });
  stub.seedPrReviews(prNumber, [{
    state: 'COMMENTED',
    author: { login: 'candidate-recorder' },
    body: gateEvidence({
      issueId: 'ISSUE-694',
      gate: 'spec',
      targetSha,
      attemptId: 'attempt-694-mutable-ref',
      blockers: [{
        severity: 'blocking',
        origin: 'specification',
        code: 'MUTABLE-REF-BLOCKER',
        evidence: ['書き換えたremote-tracking refだけが登録したactorによるfindingです'],
      }],
    }),
    submittedAt: '2026-08-15T00:00:00Z',
  }]);

  const result = runCli(['segment', 'start', 'ISSUE-694', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /MUTABLE-REF-BLOCKER/);
  assert.doesNotMatch(result.stdout, /書き換えたremote-tracking refだけが登録したactorによるfindingです/);
});

test('segment start (github backend): slot不足の新しいattemptで完備した過去attemptを置換しない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 684);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-684',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-684-complete',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'PREVIOUS-COMPLETE-BLOCKER',
          evidence: ['完備した過去attemptのfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-684',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-684-incomplete',
        expectedCount: 2,
        reviewerSlot: 1,
        blockers: [],
      }),
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-684', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PREVIOUS-COMPLETE-BLOCKER/);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCOMPLETE/);
});

test('segment start (github backend): slot重複の新しいattemptで完備した過去attemptを置換しない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 685);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-685',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-685-complete',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'DUPLICATE-SLOT-PREVIOUS-BLOCKER',
          evidence: ['slot重複より前の完備したfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    ...[1, 2].map((minute) => ({
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-685',
        gate: 'spec' as const,
        targetSha,
        attemptId: 'attempt-685-duplicate-slot',
        expectedCount: 2 as const,
        reviewerSlot: 1 as const,
        blockers: [],
      }),
      submittedAt: `2026-08-15T00:0${minute}:00Z`,
    })),
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-685', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DUPLICATE-SLOT-PREVIOUS-BLOCKER/);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCOMPLETE/);
});

test('segment start (github backend): 新しい不完備attemptのblocking findingを完備した過去attemptと併記する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 691);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-691',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-691-complete',
        blockers: [],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-691',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-691-incomplete',
        expectedCount: 2,
        reviewerSlot: 1,
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'INCOMPLETE-ATTEMPT-BLOCKER',
          evidence: ['不完備attemptの投稿済みslotが検出したfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-691', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCOMPLETE/);
  assert.match(result.stdout, /INCOMPLETE-ATTEMPT-BLOCKER/);
  assert.match(result.stdout, /不完備attemptの投稿済みslotが検出したfindingです/);
});

test('segment start (github backend): 新しい完備attemptで古い不完備attemptを解消する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 692);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-692',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-692-incomplete-old',
        expectedCount: 2,
        reviewerSlot: 1,
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'STALE-INCOMPLETE-BLOCKER',
          evidence: ['新しい完備attemptにより解消された古いfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    ...([1, 2] as const).map((slot) => ({
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-692',
        gate: 'spec' as const,
        targetSha,
        attemptId: 'attempt-692-complete-new',
        expectedCount: 2 as const,
        reviewerSlot: slot,
        blockers: [],
      }),
      submittedAt: `2026-08-15T00:0${slot}:00Z`,
    })),
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-692', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /GATE_REVIEW_ATTEMPT_INCOMPLETE/);
  assert.doesNotMatch(result.stdout, /STALE-INCOMPLETE-BLOCKER/);
  assert.doesNotMatch(result.stdout, /新しい完備attemptにより解消された古いfindingです/);
});

test('segment start (github backend): メタデータ不整合attemptで完備した過去attemptを置換しない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 693);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-693',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-693-complete-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'COHERENT-PREVIOUS-BLOCKER',
          evidence: ['整合した過去attemptのfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    ...([1, 2] as const).map((slot) => ({
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-693',
        gate: 'spec' as const,
        targetSha,
        attemptId: 'attempt-693-incoherent-new',
        expectedCount: 2 as const,
        reviewerSlot: slot,
        promptDigest: `sha256:${(slot === 1 ? 'd' : 'e').repeat(64)}`,
        blockers: [],
      }),
      submittedAt: `2026-08-15T00:0${slot}:00Z`,
    })),
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-693', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCOMPLETE/);
  assert.match(result.stdout, /COHERENT-PREVIOUS-BLOCKER/);
  assert.match(result.stdout, /整合した過去attemptのfindingです/);
});

test('segment start (github backend): 完備した新しいattemptで過去attemptを置換する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 686);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-686',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-686-previous',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'SUPERSEDED-BLOCKER',
          evidence: ['新しい完備attemptにより置換されるfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    ...([1, 2] as const).map((slot) => ({
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-686',
        gate: 'spec' as const,
        targetSha,
        attemptId: 'attempt-686-complete-new',
        expectedCount: 2 as const,
        reviewerSlot: slot,
        blockers: slot === 1 ? [{
          severity: 'blocking' as const,
          origin: 'specification' as const,
          code: 'LATEST-COMPLETE-BLOCKER',
          evidence: ['新しい完備attemptのfindingです'],
        }] : [],
      }),
      submittedAt: `2026-08-15T00:0${slot}:00Z`,
    })),
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-686', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /SUPERSEDED-BLOCKER/);
  assert.match(result.stdout, /LATEST-COMPLETE-BLOCKER/);
});

test('segment start (github backend): 判定済みでblockerのない新しい完備attemptは過去のblocking findingを解消する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 697);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-697',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-697-blocking-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'RESOLVED-PREVIOUS-BLOCKER',
          evidence: ['判定済みの新しいattemptにより解消されるfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    ...([1, 2] as const).map((slot) => ({
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-697',
        gate: 'spec' as const,
        targetSha,
        attemptId: 'attempt-697-clear-new',
        expectedCount: 2 as const,
        reviewerSlot: slot,
        blockers: [],
      }),
      submittedAt: `2026-08-15T00:0${slot}:00Z`,
    })),
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-697', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /RESOLVED-PREVIOUS-BLOCKER/);
  assert.doesNotMatch(result.stdout, /GATE_REVIEW_ATTEMPT_INCONCLUSIVE/);
});

test('segment start (github backend): inconclusiveな新しい完備attemptは過去のblocking findingを消さない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 695);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-695',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-695-conclusive-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'INCONCLUSIVE-PREVIOUS-BLOCKER',
          evidence: ['判定不能attemptより前に確認されたfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-695',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-695-inconclusive-new',
        inconclusive: true,
        blockers: [],
      }),
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-695', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCONCLUSIVE/);
  assert.match(result.stdout, /INCONCLUSIVE-PREVIOUS-BLOCKER/);
  assert.match(result.stdout, /判定不能attemptより前に確認されたfindingです/);
});

test('segment start (github backend): pendingな新しい完備attemptは過去のblocking findingを消さない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 696);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-696',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-696-conclusive-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'PENDING-PREVIOUS-BLOCKER',
          evidence: ['pending attemptより前に確認されたfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-696',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-696-pending-new',
        conformance: 'pending',
        blockers: [],
      }),
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-696', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCONCLUSIVE/);
  assert.match(result.stdout, /PENDING-PREVIOUS-BLOCKER/);
  assert.match(result.stdout, /pending attemptより前に確認されたfindingです/);
});

test('segment start (github backend): falsification pendingな新しい完備attemptは過去のblocking findingを消さない', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 698);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-698',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-698-conclusive-old',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'FALSIFICATION-PENDING-PREVIOUS-BLOCKER',
          evidence: ['falsification pendingより前に確認されたfindingです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-698',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-698-pending-new',
        falsification: 'pending',
        blockers: [],
      }),
      submittedAt: '2026-08-15T00:01:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-698', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCONCLUSIVE/);
  assert.match(result.stdout, /FALSIFICATION-PENDING-PREVIOUS-BLOCKER/);
  assert.match(result.stdout, /falsification pendingより前に確認されたfindingです/);
});

test('segment start (github backend): 完備したattemptがなければ判定不能をblocking findingとして同梱する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 687);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  stub.seedPrReviews(prNumber, [{
    state: 'COMMENTED',
    author: { login: 'adachi-tatsuru' },
    body: gateEvidence({
      issueId: 'ISSUE-687',
      gate: 'spec',
      targetSha,
      attemptId: 'attempt-687-incomplete-only',
      expectedCount: 2,
      reviewerSlot: 1,
      blockers: [],
    }),
    submittedAt: '2026-08-15T00:00:00Z',
  }]);

  const result = runCli(['segment', 'start', 'ISSUE-687', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GATE_REVIEW_ATTEMPT_INCOMPLETE/);
  assert.match(result.stdout, /不完備なゲートレビューattemptがあり/);
});

test('segment start (github backend): trusted actor登録を解決できない場合も未検証evidenceと部分障害を通知して起動を継続する', (t) => {
  const { repo, stub, env, prNumber } = prepareReviewStatusSegment(t, 683);
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const state = stub.readState();
  state.failApiPaths = ['contents/.agent-skill-chain/project/manifest.yaml'];
  stub.writeState(state);
  stub.seedPrReviews(prNumber, [
    {
      state: 'COMMENTED',
      author: { login: 'adachi-tatsuru' },
      body: gateEvidence({
        issueId: 'ISSUE-683',
        gate: 'spec',
        targetSha,
        attemptId: 'attempt-683-unresolved-policy',
        blockers: [{
          severity: 'blocking',
          origin: 'specification',
          code: 'UNRESOLVED-POLICY-BLOCKER',
          evidence: ['登録元を解決できないevidenceです'],
        }],
      }),
      submittedAt: '2026-08-15T00:00:00Z',
    },
  ]);

  const result = runCli(['segment', 'start', 'ISSUE-683', 'spec'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /UNRESOLVED-POLICY-BLOCKER/);
  assert.doesNotMatch(result.stdout, /登録元を解決できないevidenceです/);
  assert.match(result.stdout, /GATE_REVIEW_EVIDENCE_UNVERIFIED/);
  assert.match(result.stdout, /blocking findingがありますが、trusted\s+actor登録を解決できないため内容を検証できません/);
  assert.match(result.stdout, /partial_failures:/);
  assert.match(result.stdout, /side: gate_review_trust_policy/);
  assert.match(result.stdout, /GitHubのrepository default\s+branchからproject policy manifestを取得できません/);
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
