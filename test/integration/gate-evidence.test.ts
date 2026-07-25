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
import { digestOf } from '../../src/lib/digest.js';
import {
  canonicalJson,
  evidencePromptDigest,
  parseReviewEvidence,
  renderReviewEvidence,
  type ReviewEvidence,
} from '../../src/lib/review-evidence.js';
import { encodeGateCheckExternalId } from '../../src/lib/gate-provenance.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('local review完了dispatchはexact payloadをPOSTし、API失敗を非0へ保つ', (t) => {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-gate-dispatch-'));
  const stub = createGhStub(stubDir);
  const env = stub.env(process.env);
  t.after(() => fs.rmSync(stubDir, { recursive: true, force: true }));

  const payload = {
    event_type: 'agent-skill-chain-gate-record',
    client_payload: {
      pr_number: 274,
      gate: 'implementation',
      target_sha: 'a'.repeat(40),
    },
  };
  const dispatched = spawnSync(
    'gh',
    ['api', '-X', 'POST', 'repos/{owner}/{repo}/dispatches', '--input', '-'],
    { env, input: JSON.stringify(payload), encoding: 'utf8' },
  );
  assert.equal(dispatched.status, 0, dispatched.stderr);
  assert.deepEqual(stub.readState().repositoryDispatches, [payload]);

  const failingState = stub.readState();
  failingState.failRepositoryDispatch = true;
  stub.writeState(failingState);
  const failed = spawnSync(
    'gh',
    ['api', '-X', 'POST', 'repos/{owner}/{repo}/dispatches', '--input', '-'],
    { env, input: JSON.stringify(payload), encoding: 'utf8' },
  );
  assert.notEqual(failed.status, 0);
  assert.deepEqual(stub.readState().repositoryDispatches, [payload]);
});

test('GitHub evidence: Review API由来のStrict 2件を検証してsuccess Check Runへ結線する', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
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
  git(repo.dir, ['add', 'SPEC.md']);
  git(repo.dir, ['commit', '-m', 'test: add evidence target']);
  const targetSha = git(repo.dir, ['rev-parse', 'HEAD']);
  git(repo.dir, ['checkout', 'main']);

  const artifact = {
    path: 'SPEC.md',
    // CLIのgit wrapperと同じく末尾改行を保持したblob内容でdigestする。
    digest: digestOf(execFileSync('git', ['show', `${targetSha}:SPEC.md`], { cwd: repo.dir, encoding: 'utf8' })),
  };
  const prompt = runCli(['gate', 'reviewer-prompt', 'ISSUE-271', 'spec', targetSha, baseSha], {
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
  stub.writeState(state);

  const rawVerdict = {
    conformance: 'pass',
    falsification: 'pass',
    acceptance_criteria: [{ ac_id: 'AC-1', conformance: 'pass', evidence: ['SPEC.md AC-1'] }],
    blockers: [],
    approved_artifacts: [{ path: 'SPEC.md' }],
    inconclusive: false,
  };
  const attemptId = 'attempt-integration-1';
  fs.writeFileSync(tokenPath, `${JSON.stringify({
    schema_version: 'agent-skill-chain/launcher-token/v1',
    attempt_id: attemptId,
    expected_count: 2,
    profile: 'strict',
    target_sha: targetSha,
    base_sha: baseSha,
    pr_number: '274',
    nonce: 'e'.repeat(48),
    slots: [
      { slot: 1, run_id: 'review-integration-submit' },
      { slot: 2, run_id: 'review-integration-submit-2' },
    ],
    consumed_slots: [],
  })}\n`, { mode: 0o600 });
  const directSubmit = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, baseSha, '274',
      attemptId, '2', 'review-integration-submit', '1', 'codex', 'gpt-5.6-sol', 'xhigh',
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
      attemptId, '2', 'review-integration-submit', '1', 'codex', 'gpt-5.6-sol', 'xhigh',
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
      attemptId, '2', 'review-integration-submit', '1', 'codex', 'gpt-5.6-sol', 'xhigh',
    ],
    { cwd: repo.dir, env: { ...env, ASC_LAUNCHER_TOKEN_FILE: tokenPath }, input: JSON.stringify(rawVerdict) },
  );
  assert.equal(submitted.status, 0, submitted.stderr);
  assert.equal(stub.readState().pullReviews?.length, 1);
  const replayedSlot = runCli(
    [
      'gate', 'submit-evidence', 'ISSUE-271', 'spec', 'strict', targetSha, baseSha, baseSha, '274',
      attemptId, '2', 'review-integration-submit', '1', 'codex', 'gpt-5.6-sol', 'xhigh',
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
  const makeEvidence = (slot: 1 | 2): ReviewEvidence => ({
    ...submittedEvidence,
    reviewer: {
      ...submittedEvidence.reviewer,
      run_id: `review-integration-${slot}`,
      slot,
    },
  });
  stateAfterSubmit.pullReviews = [1, 2].map((slot) => ({
    id: slot,
    body: renderReviewEvidence(makeEvidence(slot as 1 | 2)),
    commit_id: targetSha,
    state: 'COMMENTED',
    user: { login: 'adachi-tatsuru' },
  }));
  stub.writeState(stateAfterSubmit);

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
