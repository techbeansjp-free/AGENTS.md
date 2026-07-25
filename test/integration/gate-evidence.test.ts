import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { digestOf } from '../../src/lib/digest.js';
import {
  evidencePromptDigest,
  parseReviewEvidence,
  renderReviewEvidence,
  type ReviewEvidence,
} from '../../src/lib/review-evidence.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

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
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha },
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
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha },
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
    user: { login: 'adachi-tatsuru' },
    head: { sha: targetSha },
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
  const materialized = runCli(
    ['gate', 'materialize-check-report', 'ISSUE-271', 'spec', targetSha, reportPath],
    { cwd: repo.dir, env },
  );
  assert.equal(materialized.status, 0, materialized.stderr);
  assert.equal((parse(fs.readFileSync(reportPath, 'utf8')) as { gate: { final: string } }).gate.final, 'approved');
  const stateAfterMaterialize = stub.readState();
  const previousRun = (stateAfterMaterialize.checkRuns as {
    name: string;
    head_sha: string;
    output: { text: string };
  }[])[0];
  stateAfterMaterialize.checkRuns?.push({
    ...previousRun,
    id: stateAfterMaterialize.nextId++,
    status: 'completed',
    conclusion: 'action_required',
    app: { slug: 'github-actions' },
  });
  stub.writeState(stateAfterMaterialize);
  fs.unlinkSync(reportPath);
  const staleSuccess = runCli(
    ['gate', 'materialize-check-report', 'ISSUE-271', 'spec', targetSha, reportPath],
    { cwd: repo.dir, env },
  );
  assert.notEqual(staleSuccess.status, 0);
  assert.match(staleSuccess.stderr, /latest expected-App Check Run/);

  const weakProfile = runCli(
    ['gate', 'verify-evidence', 'ISSUE-271', 'spec', 'standard', targetSha, baseSha, '274', reportPath, 'core_audit'],
    { cwd: repo.dir, env },
  );
  assert.notEqual(weakProfile.status, 0);
  assert.match(weakProfile.stderr, /Strict profile/);

  const missingState = stub.readState();
  missingState.pullMetadata = {
    user: { login: 'adachi-tatsuru' },
    head: { sha: baseSha },
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
