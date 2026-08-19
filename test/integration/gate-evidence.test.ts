import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { packageRoot } from '../../src/lib/paths.js';
import { digestOf, artifactDigestOf } from '../../src/lib/digest.js';
import {
  canonicalJson,
  evidencePromptDigest,
  parseReviewEvidence,
  renderReviewEvidence,
  type ReviewEvidence,
} from '../../src/lib/review-evidence.js';
import { encodeGateCheckExternalId } from '../../src/lib/gate-provenance.js';

const MAX_INJECTED_OBJECTS = 20_000;
const OBJECT_BATCH_SIZE = 1_000;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitObjectCount(cwd: string): number {
  const fields = new Map(
    git(cwd, ['count-objects', '-v'])
      .split('\n')
      .map((line) => line.split(': ', 2) as [string, string]),
  );
  return Number(fields.get('count') ?? 0) + Number(fields.get('in-pack') ?? 0);
}

function injectBlobBatch(repoDir: string, start: number, count: number): void {
  const records: string[] = [];
  for (let index = start; index < start + count; index += 1) {
    const body = `gate-evidence-object-${index}\n`;
    records.push(`blob\ndata ${Buffer.byteLength(body)}\n${body}`);
  }
  const imported = spawnSync('git', ['fast-import', '--quiet'], {
    cwd: repoDir,
    encoding: 'utf8',
    input: records.join(''),
  });
  if (imported.error) throw imported.error;
  assert.equal(imported.status, 0, imported.stderr);
}

test('GitHub evidence: Review API由来のStrict 2件と変更前形式の証跡を検証してsuccess Check Runへ結線する（Issue #703 AC-8）', (t) => {
  const repo = createTmpRepo({ backend: 'github', selfPackage: true });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-evidence-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-local-review.'));
  fs.chmodSync(tokenDir, 0o700);
  const tokenPath = path.join(tokenDir, 'launcher-token.json');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(tokenDir, { recursive: true, force: true });
  });

  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-b', 'process/271-evidence-test']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: evidence\n');
  const configPath = path.join(repo.dir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const baseConfig = fs.readFileSync(configPath, 'utf8');
  const targetConfig = baseConfig.replace(
    'round_limit: {narrowing_threshold: 2, cutoff_threshold: 4}',
    'round_limit: {narrowing_threshold: 1, cutoff_threshold: 3}',
  );
  assert.notEqual(targetConfig, baseConfig);
  fs.writeFileSync(configPath, targetConfig);
  git(repo.dir, ['add', 'SPEC.md', '.agent-skill-chain/config/agent-skill-chain.yaml']);
  git(repo.dir, ['commit', '-m', 'test: add evidence target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  const artifact = {
    path: 'SPEC.md',
    // CLIのgit wrapperと同じく末尾改行を保持したblob内容でdigestする。
    digest: artifactDigestOf(execFileSync('git', ['show', `${targetSha}:SPEC.md`], { cwd: repo.dir, encoding: 'utf8' })),
  };
  const attemptId = 'attempt-integration-1';
  const prompt = runCli(['gate', 'reviewer-prompt', 'ISSUE-271', 'spec', targetSha, baseSha, '274', attemptId], {
    cwd: repo.dir,
    env,
  });
  assert.equal(prompt.status, 0, prompt.stderr);
  const promptDigest = evidencePromptDigest(prompt.stdout.trimEnd());
  const state = stub.readState();
  state.pullMetadata = {
    number: 274,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'process/271-evidence-test' },
    base: { sha: baseSha, ref: 'main' },
  };
  state.pullCommits = [{
    author: { login: 'adachi-tatsuru' },
    committer: { login: 'adachi-tatsuru' },
  }];
  state.apiActor = 'adachi-tatsuru';
  stub.writeState(state);

  const rawVerdict = {
    conformance: 'pass',
    falsification: 'pass',
    blockers: [],
    approved_artifacts: [{ path: 'SPEC.md' }],
    inconclusive: false,
  };
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 'agent-skill-chain/launcher-token/v1',
    attempt_id: attemptId,
    expected_count: 2,
    profile: 'strict',
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: '274',
    nonce: 'e'.repeat(48),
    // Issue #759: 準備段が隔離cloneのパスと調達の事実をtoken経由で運ぶ。
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
    slots: [
      { slot: 1, run_id: 'review-integration-submit' },
      { slot: 2, run_id: 'review-integration-submit-2' },
    ],
    consumed_slots: [],
  })}\n`, { mode: 0o600 });
  const directSubmit = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, baseSha, '274',
      attemptId, '2', 'review-integration-submit', '1', 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
    ],
    { cwd: repo.dir, env, input: JSON.stringify(rawVerdict) },
  );
  assert.notEqual(directSubmit.status, 0);
  assert.match(directSubmit.stderr, /launcher token file/);
  const wrongBaseState = stub.readState();
  wrongBaseState.pullMetadata = {
    number: 274,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'process/271-evidence-test' },
    base: { sha: baseSha, ref: 'unprotected-review-base' },
  };
  stub.writeState(wrongBaseState);
  const wrongBase = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, baseSha, '274',
      attemptId, '2', 'review-integration-submit', '1', 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
    ],
    { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
  );
  assert.notEqual(wrongBase.status, 0);
  assert.match(wrongBase.stderr, /default branch/);
  wrongBaseState.pullMetadata = {
    number: 274,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'process/271-evidence-test' },
    base: { sha: baseSha, ref: 'main' },
  };
  stub.writeState(wrongBaseState);
  const submitted = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, baseSha, '274',
      attemptId, '2', 'review-integration-submit', '1', 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
    ],
    { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
  );
  assert.equal(submitted.status, 0, submitted.stderr);
  assert.equal(stub.readState().pullReviews?.length, 1);
  const replayedSlot = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, baseSha, '274',
      attemptId, '2', 'review-integration-submit', '1', 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
    ],
    { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
  );
  assert.notEqual(replayedSlot.status, 0);
  assert.match(replayedSlot.stderr, /消費済み/);

  const stateAfterSubmit = stub.readState();
  const submittedEvidence = parseReviewEvidence(
    (stateAfterSubmit.pullReviews?.[0] as { body: string }).body,
  );
  assert.ok(submittedEvidence);
  assert.equal(submittedEvidence.schema_version, 'agent-skill-chain/gate-review-evidence/v3');
  const slotTwoPrompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-271', 'spec', targetSha, baseSha, '274', attemptId],
    { cwd: repo.dir, env },
  );
  assert.equal(slotTwoPrompt.status, 0, slotTwoPrompt.stderr);
  assert.equal(evidencePromptDigest(slotTwoPrompt.stdout.trimEnd()), submittedEvidence.prompt_digest);
  const submittedSlotTwo = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, baseSha, '274',
      attemptId, '2', 'review-integration-submit-2', '2', 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
    ],
    { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
  );
  assert.equal(submittedSlotTwo.status, 0, submittedSlotTwo.stderr);
  const completedAttempt = stub.readState().pullReviews ?? [];
  assert.equal(completedAttempt.length, 2);
  for (const submittedReview of completedAttempt) {
    assert.equal(parseReviewEvidence((submittedReview as { body: string }).body)?.prompt_digest, promptDigest);
  }
  const legacyState = stub.readState();
  legacyState.pullReviews = (legacyState.pullReviews ?? []).map((submittedReview) => {
    const reviewRecord = submittedReview as { body: string } & Record<string, unknown>;
    const legacyEvidence = parseReviewEvidence(reviewRecord.body);
    assert.ok(legacyEvidence);
    legacyEvidence.verdict.blockers = [{
      severity: 'warning',
      origin: 'specification',
      code: 'legacy-v3-finding',
      evidence: ['反例'],
    }];
    // 変更前のprompt生成ロジックが記録したdigestを模擬する。現行promptからは再生成できない。
    legacyEvidence.prompt_digest = `sha256:${'9'.repeat(64)}`;
    return { ...reviewRecord, body: renderReviewEvidence(legacyEvidence) };
  });
  stub.writeState(legacyState);
  for (const legacyReview of stub.readState().pullReviews ?? []) {
    const legacyEvidence = parseReviewEvidence((legacyReview as { body: string }).body);
    assert.equal(legacyEvidence?.attempt_id, attemptId);
    assert.deepEqual(legacyEvidence?.verdict.blockers[0].evidence, ['反例']);
    assert.equal(legacyEvidence?.prompt_digest, `sha256:${'9'.repeat(64)}`);
  }

  const secondAttemptId = 'attempt-integration-2';
  const secondRoundPrompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-271', 'spec', targetSha, baseSha, '274', secondAttemptId],
    { cwd: repo.dir, env },
  );
  assert.equal(secondRoundPrompt.status, 0, secondRoundPrompt.stderr);
  assert.match(secondRoundPrompt.stdout, /現在のラウンド番号: 1/);
  assert.match(secondRoundPrompt.stdout, /高ラウンドの反証追加要件/);
  const secondPromptDigest = evidencePromptDigest(secondRoundPrompt.stdout.trimEnd());
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 'agent-skill-chain/launcher-token/v1',
    attempt_id: secondAttemptId,
    expected_count: 2,
    profile: 'strict',
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: '274',
    nonce: 'f'.repeat(48),
    // Issue #759: 準備段が隔離cloneのパスと調達の事実をtoken経由で運ぶ。
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
    slots: [
      { slot: 1, run_id: 'review-integration-second-submit' },
      { slot: 2, run_id: 'review-integration-second-submit-2' },
    ],
    consumed_slots: [],
  })}\n`, { mode: 0o600 });
  for (const [runId, slot] of [
    ['review-integration-second-submit', '1'],
    ['review-integration-second-submit-2', '2'],
  ] as const) {
    const secondSubmitted = runCli(
      [
        'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, baseSha, '274',
        secondAttemptId, '2', runId, slot, 'codex', 'gpt-5.6-sol', 'xhigh', secondPromptDigest,
      ],
      { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
    );
    assert.equal(secondSubmitted.status, 0, secondSubmitted.stderr);
  }

  const targetConfigChangedPrompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-271', 'spec', targetSha, baseSha, '274', 'attempt-integration-3'],
    { cwd: repo.dir, env },
  );
  assert.equal(targetConfigChangedPrompt.status, 0, targetConfigChangedPrompt.stderr);
  assert.match(targetConfigChangedPrompt.stdout, /現在のラウンド番号: 2/);

  const forgedState = stub.readState();
  const sourceReviews = forgedState.pullReviews ?? [];
  const forgedReviews = sourceReviews.slice(0, 2).map((sourceReview, index) => {
    const source = sourceReview as { body: string; commit_id: string; state: string; user: { login: string } };
    const forged = parseReviewEvidence(source.body);
    assert.ok(forged);
    forged.attempt_id = 'attempt-form-only';
    forged.reviewer.run_id = `review-form-only-${index + 1}`;
    forged.execution.launcher_digest = `sha256:${'f'.repeat(64)}`;
    return {
      ...source,
      id: sourceReviews.length + index + 1,
      body: renderReviewEvidence(forged),
    };
  });
  forgedState.pullReviews = [...sourceReviews, ...forgedReviews];
  stub.writeState(forgedState);
  const forgedHistoryPrompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-271', 'spec', targetSha, baseSha, '274', 'attempt-integration-3'],
    { cwd: repo.dir, env },
  );
  assert.equal(forgedHistoryPrompt.status, 0, forgedHistoryPrompt.stderr);
  assert.match(forgedHistoryPrompt.stdout, /現在のラウンド番号: 2/);
  assert.match(forgedHistoryPrompt.stdout, /attempt attempt-form-only をラウンド計数から除外/);
  forgedState.pullReviews = sourceReviews;
  stub.writeState(forgedState);

  const reportPath = path.join(repo.dir, 'verified-gate.yaml');
  const verified = runCli(
    ['gate', 'verify-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, '274', reportPath, 'ordinary'],
    { cwd: repo.dir, env },
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /final: approved/);
  const report = parse(fs.readFileSync(reportPath, 'utf8')) as {
    gate: { final: string; reviewers: { actor_relation: string }[] };
  };
  assert.equal(report.gate.final, 'approved');
  assert.equal(report.gate.reviewers.length, 2);
  assert.deepEqual(report.gate.reviewers.map((reviewer) => reviewer.actor_relation), [
    'same_as_writer',
    'same_as_writer',
  ]);

  const originalConfig = fs.readFileSync(configPath, 'utf8');
  const changedConfig = originalConfig.replace(
    'round_limit: {narrowing_threshold: 2, cutoff_threshold: 4}',
    'round_limit: {narrowing_threshold: 1, cutoff_threshold: 3}',
  );
  assert.notEqual(changedConfig, originalConfig);
  fs.writeFileSync(configPath, changedConfig);
  const nextRoundPrompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-271', 'spec', targetSha, baseSha, '274', 'attempt-integration-3'],
    { cwd: repo.dir, env },
  );
  assert.equal(nextRoundPrompt.status, 0, nextRoundPrompt.stderr);
  assert.match(nextRoundPrompt.stdout, /現在のラウンド番号: 2/);
  fs.writeFileSync(configPath, originalConfig);

  const published = runCli(['gate', 'publish', 'ISSUE-271', reportPath], { cwd: repo.dir, env });
  assert.equal(published.status, 0, published.stderr);
  assert.equal((stub.readState() as unknown as { checkRuns: { conclusion: string }[] }).checkRuns[0].conclusion, 'success');
  fs.unlinkSync(reportPath);
  const standardActionsRejected = runCli(
    ['gate', 'materialize-check-report', 'ISSUE-271', 'spec', targetSha, reportPath],
    { cwd: repo.dir, env: { ...env, ASC_GATE_APP_ID: '12345' } },
  );
  assert.notEqual(standardActionsRejected.status, 0);
  assert.match(standardActionsRejected.stderr, /専用App Check output/);

  const durableReport = report as unknown as {
    schema_version: string;
    gate: {
      review_attempt: { attempt_id: string; expected_count: number; evidence_digest: string };
    };
  };
  const workflow = {
    path: '.github/workflows/agent-skill-chain-trusted-gate.yml',
    ref: 'refs/heads/main' as const,
    sha: baseSha,
    run_id: 9001,
    run_number: 42,
    run_attempt: 1,
  };
  const externalId = encodeGateCheckExternalId({
    workflowRunId: workflow.run_id,
    runNumber: workflow.run_number,
    runAttempt: workflow.run_attempt,
    prNumber: 274,
    gate: 'spec',
    targetSha,
  });
  const attestation = {
    schema_version: 'agent-skill-chain/gate-attestation/v1',
    repository: { id: 77, full_name: 'test/repo' },
    pr_number: 274,
    target_sha: targetSha,
    gate: 'spec',
    review_attempt: durableReport.gate.review_attempt,
    workflow,
    check: { id: 700, name: 'agent-skill-chain/spec-gate', app_id: 12345 },
    report_digest: digestOf(canonicalJson(durableReport)),
  };
  const recorderState = stub.readState();
  recorderState.issueMetadata = { number: 271, state: 'open', labels: [] };
  recorderState.checkRuns = [{
    id: 700,
    name: 'agent-skill-chain/spec-gate',
    head_sha: targetSha,
    external_id: externalId,
    status: 'completed',
    conclusion: 'success',
    app: { id: 12345, name: 'Agent Skill Chain Gate', slug: 'agent-skill-chain-gate' },
    output: {
      text: canonicalJson({
        schema_version: 'agent-skill-chain/check-output/v1',
        report: durableReport,
        attestation,
      }),
    },
  }];
  recorderState.actionRuns = [{
    id: workflow.run_id,
    run_number: workflow.run_number,
    run_attempt: workflow.run_attempt,
    path: workflow.path,
    head_sha: workflow.sha,
    head_branch: 'main',
    event: 'repository_dispatch',
    display_title: `gate-record-274-spec-${targetSha}`,
    status: 'completed',
    conclusion: 'success',
  }];
  stub.writeState(recorderState);
  const materialized = runCli(
    ['gate', 'materialize-check-report', 'ISSUE-271', 'spec', targetSha, reportPath],
    { cwd: repo.dir, env: { ...env, ASC_GATE_APP_ID: '12345' } },
  );
  assert.equal(materialized.status, 0, materialized.stderr);
  assert.equal((parse(fs.readFileSync(reportPath, 'utf8')) as { gate: { final: string } }).gate.final, 'approved');
  const stateAfterMaterialize = stub.readState();
  stateAfterMaterialize.actionRuns?.push({
    ...(stateAfterMaterialize.actionRuns[0] as Record<string, unknown>),
    id: 9002,
    run_attempt: 2,
    status: 'completed',
    conclusion: 'failure',
  });
  stub.writeState(stateAfterMaterialize);
  fs.unlinkSync(reportPath);
  const staleSuccess = runCli(
    ['gate', 'materialize-check-report', 'ISSUE-271', 'spec', targetSha, reportPath],
    { cwd: repo.dir, env: { ...env, ASC_GATE_APP_ID: '12345' } },
  );
  assert.notEqual(staleSuccess.status, 0);
  assert.match(staleSuccess.stderr, /latest trusted recorder Actions run/);

  const weakProfile = runCli(
    ['gate', 'verify-evidence', 'ISSUE-271', 'spec', 'standard', targetSha, baseSha, '274', reportPath, 'core_audit'],
    { cwd: repo.dir, env },
  );
  assert.notEqual(weakProfile.status, 0);
  assert.match(weakProfile.stderr, /Strict profile/);

  const missingState = stub.readState();
  missingState.pullMetadata = {
    number: 274,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: baseSha, ref: 'process/271-evidence-test' },
    base: { sha: baseSha, ref: 'main' },
  };
  missingState.pullReviews = [];
  stub.writeState(missingState);
  const missingRequired = runCli(
    [
      'gate', 'verify-evidence', 'ISSUE-271', 'spec', 'strict', baseSha, baseSha, '274',
      path.join(repo.dir, 'missing-required.yaml'), 'ordinary',
    ],
    { cwd: repo.dir, env },
  );
  assert.notEqual(missingRequired.status, 0);
  assert.match(missingRequired.stderr, /必須成果物を読めません: SPEC\.md/);
});

test('GitHub evidence: implementation対象成果物が空集合でも投稿とgate-report生成を完了する', (t) => {
  // Issue #759: 証跡投稿は base SHA から再導出した調達モードと launcher token の一致を要求する。
  // 自リポジトリ形状にすることで clone_build へ解決させ、本テストの主題（空集合の成果物）を保つ。
  const repo = createTmpRepo({ backend: 'github', selfPackage: true });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-empty-implementation-evidence-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-local-review.'));
  fs.chmodSync(tokenDir, 0o700);
  const tokenPath = path.join(tokenDir, 'launcher-token.json');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(tokenDir, { recursive: true, force: true });
  });

  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-b', 'bugfix/733-empty-implementation-evidence']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: implementation evidence\n');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add non-implementation target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  const state = stub.readState();
  state.pullMetadata = {
    number: 742,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'bugfix/733-empty-implementation-evidence' },
    base: { sha: baseSha, ref: 'main' },
  };
  state.pullCommits = [{
    author: { login: 'adachi-tatsuru' },
    committer: { login: 'adachi-tatsuru' },
  }];
  state.apiActor = 'adachi-tatsuru';
  stub.writeState(state);

  const attemptId = 'attempt-empty-implementation-evidence';
  const reviewerRunId = 'review-empty-implementation-evidence';
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 'agent-skill-chain/launcher-token/v1',
    attempt_id: attemptId,
    expected_count: 1,
    profile: 'standard',
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: '742',
    nonce: 'a'.repeat(48),
    // Issue #759: 準備段が隔離cloneのパスと調達の事実をtoken経由で運ぶ。
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
    slots: [{ slot: 1, run_id: reviewerRunId }],
    consumed_slots: [],
  })}\n`, { mode: 0o600 });

  const verdict = {
    conformance: 'pass',
    falsification: 'pass',
    blockers: [],
    approved_artifacts: [],
    inconclusive: false,
  };
  const prompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-733', 'implementation', targetSha, baseSha, '742', attemptId],
    { cwd: repo.dir, env },
  );
  assert.equal(prompt.status, 0, prompt.stderr);
  const promptDigest = evidencePromptDigest(prompt.stdout.trimEnd());
  const submitted = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-733', 'implementation', 'standard', targetSha, baseSha, baseSha, '742',
      attemptId, '1', reviewerRunId, '1', 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
    ],
    {
      cwd: repo.dir,
      env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath },
      input: JSON.stringify(verdict),
    },
  );
  assert.equal(submitted.status, 0, submitted.stderr);
  const submittedReview = stub.readState().pullReviews?.[0] as { body: string } | undefined;
  assert.ok(submittedReview);
  const submittedEvidence = parseReviewEvidence(submittedReview.body);
  assert.ok(submittedEvidence);
  assert.deepEqual(submittedEvidence.verdict.approved_artifacts, []);

  const reportPath = path.join(repo.dir, 'verified-empty-implementation.yaml');
  const verified = runCli(
    [
      'gate', 'verify-evidence', 'ISSUE-733', 'implementation', 'standard', targetSha, baseSha, '742',
      reportPath, 'ordinary',
    ],
    { cwd: repo.dir, env },
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /final: approved/);
  const report = parse(fs.readFileSync(reportPath, 'utf8')) as {
    gate: { final: string; approved_artifacts: { path: string; digest: string }[] };
  };
  assert.equal(report.gate.final, 'approved');
  assert.deepEqual(report.gate.approved_artifacts, []);

  const invalidAttemptId = 'attempt-invalid-implementation-evidence';
  const invalidRunId = 'review-invalid-implementation-evidence';
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 'agent-skill-chain/launcher-token/v1',
    attempt_id: invalidAttemptId,
    expected_count: 1,
    profile: 'standard',
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: '742',
    nonce: 'b'.repeat(48),
    // Issue #759: 準備段が隔離cloneのパスと調達の事実をtoken経由で運ぶ。
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
    slots: [{ slot: 1, run_id: invalidRunId }],
    consumed_slots: [],
  })}\n`, { mode: 0o600 });
  const invalidSubmitted = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-733', 'implementation', 'standard', targetSha, baseSha, baseSha, '742',
      invalidAttemptId, '1', invalidRunId, '1', 'codex', 'gpt-5.6-sol', 'xhigh', promptDigest,
    ],
    {
      cwd: repo.dir,
      env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath },
      input: JSON.stringify({ ...verdict, inconclusive: 'true' }),
    },
  );
  assert.equal(invalidSubmitted.status, 0, invalidSubmitted.stderr);
  const invalidReview = stub.readState().pullReviews?.at(-1) as { body: string } | undefined;
  assert.ok(invalidReview);
  assert.deepEqual(parseReviewEvidence(invalidReview.body)?.verdict, {
    conformance: 'pending',
    falsification: 'pending',
    blockers: [],
    approved_artifacts: [],
    inconclusive: true,
  });

  const invalidReportPath = path.join(repo.dir, 'verified-invalid-implementation.yaml');
  const invalidVerified = runCli(
    [
      'gate', 'verify-evidence', 'ISSUE-733', 'implementation', 'standard', targetSha, baseSha, '742',
      invalidReportPath, 'ordinary',
    ],
    { cwd: repo.dir, env },
  );
  assert.equal(invalidVerified.status, 0, invalidVerified.stderr);
  assert.match(invalidVerified.stdout, /final: human_required/);
  assert.equal(
    (parse(fs.readFileSync(invalidReportPath, 'utf8')) as { gate: { final: string } }).gate.final,
    'human_required',
  );
});

test('gate evidence: reviewer-prompt生成cloneと検証cloneのauto abbrev桁数が異なっても往復に成功する', (t) => {
  const repo = createTmpRepo({ backend: 'github', selfPackage: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-evidence-clone-roundtrip-'));
  const generationDir = path.join(root, 'generation');
  const verificationDir = path.join(root, 'verification');
  const stubDir = path.join(root, 'gh-stub');
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-local-review.'));
  fs.chmodSync(tokenDir, 0o700);
  const tokenPath = path.join(tokenDir, 'launcher-token.json');
  t.after(() => {
    repo.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(tokenDir, { recursive: true, force: true });
  });

  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-b', 'process/369-clone-roundtrip']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: clone-independent evidence\n');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add clone roundtrip target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  execFileSync('git', ['clone', '--quiet', '--no-local', repo.dir, generationDir], { stdio: 'pipe' });
  execFileSync('git', ['clone', '--quiet', '--no-local', repo.dir, verificationDir], { stdio: 'pipe' });

  const generationAbbrevLength = git(generationDir, ['rev-parse', '--short', targetSha]).length;
  let verificationAbbrevLength = generationAbbrevLength;
  let injectedObjects = 0;
  while (verificationAbbrevLength <= generationAbbrevLength && injectedObjects < MAX_INJECTED_OBJECTS) {
    const batchSize = Math.min(OBJECT_BATCH_SIZE, MAX_INJECTED_OBJECTS - injectedObjects);
    injectBlobBatch(verificationDir, injectedObjects, batchSize);
    injectedObjects += batchSize;
    verificationAbbrevLength = git(verificationDir, ['rev-parse', '--short', targetSha]).length;
  }

  assert.ok(
    verificationAbbrevLength > generationAbbrevLength,
    `${MAX_INJECTED_OBJECTS}個以内のblob投入で検証cloneのauto abbrevが生成cloneより伸長すること ` +
      `(generation=${generationAbbrevLength}, verification=${verificationAbbrevLength})`,
  );
  assert.ok(gitObjectCount(verificationDir) > gitObjectCount(generationDir));

  const attemptId = 'attempt-clone-roundtrip-1';
  const generatedPrompt = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-369', 'spec', targetSha, baseSha, '369', attemptId],
    { cwd: generationDir, env },
  );
  assert.equal(generatedPrompt.status, 0, generatedPrompt.stderr);
  const generatedPromptDigest = evidencePromptDigest(generatedPrompt.stdout.trimEnd());

  const state = stub.readState();
  state.pullMetadata = {
    number: 369,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'process/369-clone-roundtrip' },
    base: { sha: baseSha, ref: 'main' },
  };
  state.pullCommits = [{
    author: { login: 'adachi-tatsuru' },
    committer: { login: 'adachi-tatsuru' },
  }];
  state.apiActor = 'adachi-tatsuru';
  stub.writeState(state);

  const reviewerRunId = 'review-clone-roundtrip-1';
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 'agent-skill-chain/launcher-token/v1',
    attempt_id: attemptId,
    expected_count: 1,
    profile: 'standard',
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: '369',
    nonce: 'c'.repeat(48),
    // Issue #759: 準備段が隔離cloneのパスと調達の事実をtoken経由で運ぶ。
    trusted_root: packageRoot(),
    procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
    slots: [{ slot: 1, run_id: reviewerRunId }],
    consumed_slots: [],
  })}\n`, { mode: 0o600 });
  const verdict = {
    conformance: 'pass',
    falsification: 'pass',
    blockers: [],
    approved_artifacts: [{ path: 'SPEC.md' }],
    inconclusive: false,
  };
  const submitted = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-369', 'spec', 'standard', targetSha, baseSha, baseSha, '369',
      attemptId, '1', reviewerRunId, '1', 'codex', 'gpt-5.6-sol', 'xhigh', generatedPromptDigest,
    ],
    {
      cwd: generationDir,
      env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath },
      input: JSON.stringify(verdict),
    },
  );
  assert.equal(submitted.status, 0, submitted.stderr);
  const submittedReview = stub.readState().pullReviews?.[0] as { body: string } | undefined;
  assert.ok(submittedReview);
  const submittedEvidence = parseReviewEvidence(submittedReview.body);
  assert.ok(submittedEvidence);
  assert.equal(submittedEvidence.prompt_digest, generatedPromptDigest);

  const reportPath = path.join(verificationDir, 'verified-clone-roundtrip.yaml');
  const verified = runCli(
    [
      'gate', 'verify-evidence', 'ISSUE-369', 'spec', 'standard', targetSha, baseSha, '369',
      reportPath, 'ordinary',
    ],
    { cwd: verificationDir, env },
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.doesNotMatch(verified.stderr, /prompt digestが一致しません/);
  assert.match(verified.stdout, /final: approved/);
  assert.equal((parse(fs.readFileSync(reportPath, 'utf8')) as { gate: { final: string } }).gate.final, 'approved');
  fs.unlinkSync(reportPath);
});

test('gate submit-evidence: レビュアCLI出力がMarkdownコードフェンスで囲まれていても内部のJSONを解釈する（Issue #303）', (t) => {
  const repo = createTmpRepo({ backend: 'github', selfPackage: true });
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-evidence-fence-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-local-review.'));
  fs.chmodSync(tokenDir, 0o700);
  t.after(() => {
    repo.cleanup();
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(tokenDir, { recursive: true, force: true });
  });

  const baseSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', '-b', 'process/303-fence-test']);
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\nAC-1: evidence\n');
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add evidence target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  const state = stub.readState();
  state.pullMetadata = {
    number: 275,
    state: 'open',
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha, ref: 'process/303-fence-test' },
    base: { sha: baseSha, ref: 'main' },
  };
  state.pullCommits = [{ author: { login: 'adachi-tatsuru' }, committer: { login: 'adachi-tatsuru' } }];
  stub.writeState(state);

  const rawVerdict = {
    conformance: 'pass',
    falsification: 'pass',
    blockers: [],
    approved_artifacts: [{ path: 'SPEC.md' }],
    inconclusive: false,
  };
  const submittedPromptDigest = evidencePromptDigest('gate evidence fence extraction fixture');

  // slot毎に独立したlauncher tokenを用意し、1件ずつ standard profile（expected_count: 1）で
  // submit-evidence を呼ぶ。目的はfence除去の可否のみの検証であり、Strictの2体集約・
  // Check Run結線までは検証しない（それは既存の「GitHub evidence: ...」テストが担う）。
  function submitWithBody(runId: string, body: string): ReturnType<typeof runCli> {
    const tokenPath = path.join(tokenDir, `${runId}.json`);
    fs.writeFileSync(tokenPath, `${JSON.stringify({
      schema_version: 'agent-skill-chain/launcher-token/v1',
      attempt_id: `attempt-${runId}`,
      expected_count: 1,
      profile: 'standard',
      target_sha: targetSha,
      base_sha: baseSha,
      pr_number: '275',
      nonce: 'f'.repeat(48),
      // Issue #759: 準備段が隔離cloneのパスと調達の事実をtoken経由で運ぶ。
      trusted_root: packageRoot(),
      procurement: { mode: 'clone_build', source: `clone_build:${baseSha}` },
      slots: [{ slot: 1, run_id: runId }],
      consumed_slots: [],
    })}\n`, { mode: 0o600 });
    return runCli(
      [
        'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'standard', targetSha, baseSha, baseSha, '275',
        `attempt-${runId}`, '1', runId, '1', 'codex', 'gpt-5.6-sol', 'xhigh', submittedPromptDigest,
      ],
      { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: body },
    );
  }

  // AC-1: フェンス無しの素のJSONは従来通り解釈できる。
  const plain = submitWithBody('review-fence-plain', JSON.stringify(rawVerdict));
  assert.equal(plain.status, 0, plain.stderr);

  // AC-2: ```json フェンス付きでも解釈できる。
  const fencedJson = submitWithBody(
    'review-fence-json',
    `\`\`\`json\n${JSON.stringify(rawVerdict)}\n\`\`\`\n`,
  );
  assert.equal(fencedJson.status, 0, fencedJson.stderr);

  // AC-3: 言語指定無しの ``` フェンスでも解釈できる。
  const fencedPlain = submitWithBody(
    'review-fence-bare',
    `\`\`\`\n${JSON.stringify(rawVerdict)}\n\`\`\`\n`,
  );
  assert.equal(fencedPlain.status, 0, fencedPlain.stderr);

  // AC-4: フェンスを除去しても不正なJSONはエラーのまま（曖昧に成功扱いにしない）。
  const fencedInvalid = submitWithBody(
    'review-fence-invalid',
    '```json\n{not valid json\n```\n',
  );
  assert.notEqual(fencedInvalid.status, 0);
  assert.match(fencedInvalid.stderr, /verdict JSONを解釈できません/);

  // Issue #312 AC-3: JSON本体の前にtool-call試行らしきテキストや説明文があっても解釈できる。
  const toolCallPrefixed = submitWithBody(
    'review-prefix-toolcall',
    `ReportFindings(${JSON.stringify(rawVerdict)})`,
  );
  assert.equal(toolCallPrefixed.status, 0, toolCallPrefixed.stderr);

  const prosePrefixed = submitWithBody(
    'review-prefix-prose',
    `この変更を確認しました。以下がverdictです。\n${JSON.stringify(rawVerdict)}`,
  );
  assert.equal(prosePrefixed.status, 0, prosePrefixed.stderr);

  // Issue #312 AC-4: JSON本体の後に説明文があっても解釈できる。
  const proseSuffixed = submitWithBody(
    'review-suffix-prose',
    `${JSON.stringify(rawVerdict)}\n以上がverdictです。`,
  );
  assert.equal(proseSuffixed.status, 0, proseSuffixed.stderr);

  // Issue #312 AC-5: verdict JSONの文字列リテラル内に中括弧を含んでいても、対応関係の検出が
  // 誤動作せず全体を正しく抽出・解釈する。
  const verdictWithBraceInLiteral = {
    ...rawVerdict,
    blockers: [
      {
        severity: 'info' as const,
        origin: 'specification' as const,
        code: 'literal-brace-test',
        evidence: ['SPEC.md の config value `{key: value}` を含む説明文'],
      },
    ],
  };
  const literalBraces = submitWithBody(
    'review-literal-braces',
    JSON.stringify(verdictWithBraceInLiteral),
  );
  assert.equal(literalBraces.status, 0, literalBraces.stderr);

  // Issue #312 AC-6: 抽出候補が構文的に不正な場合は従来通りエラーのまま。
  const proseOnly = submitWithBody('review-prose-only', 'JSONを生成できませんでした。');
  assert.notEqual(proseOnly.status, 0);
  assert.match(proseOnly.stderr, /verdict JSONを解釈できません/);

  const emptyFindingEvidence = submitWithBody('review-empty-finding-evidence', JSON.stringify({
    ...rawVerdict,
    falsification: 'fail',
    blockers: [{
      severity: 'blocking',
      origin: 'implementation',
      code: 'EMPTY-EVIDENCE',
      evidence: [],
    }],
  }));
  assert.equal(emptyFindingEvidence.status, 0, emptyFindingEvidence.stderr);
  const safeReview = stub.readState().pullReviews?.at(-1) as { body: string } | undefined;
  const safeEvidence = parseReviewEvidence(safeReview?.body ?? '');
  assert.equal(safeEvidence?.verdict.conformance, 'pending');
  assert.equal(safeEvidence?.verdict.falsification, 'pending');
  assert.deepEqual(safeEvidence?.verdict.blockers, []);
  assert.equal(safeEvidence?.verdict.inconclusive, true);
  assert.deepEqual(safeEvidence?.verdict.approved_artifacts.map(({ path: artifactPath }) => artifactPath), ['SPEC.md']);
});
