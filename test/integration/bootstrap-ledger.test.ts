import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bootstrapEvidenceDigest, type BootstrapPreparedRecord } from '../../src/lib/bootstrap-ledger.js';
import { digestOf } from '../../src/lib/digest.js';
import {
  canonicalJson,
  renderReviewEvidence,
  type ReviewEvidence,
} from '../../src/lib/review-evidence.js';
import { createGhStub } from '../helpers/gh-stub.js';
import { runCli } from '../helpers/cli.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';

const TARGET_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function evidence(slot: 1 | 2): ReviewEvidence {
  return {
    schema_version: 'agent-skill-chain/gate-review-evidence/v3',
    issue_id: 'ISSUE-271',
    gate: 'implementation',
    profile: 'strict',
    target_sha: TARGET_SHA,
    attempt_id: 'attempt-bootstrap-274',
    expected_count: 2,
    execution: {
      launcher: 'agent-skill-chain/gate-local-review/v1',
      trusted_base_sha: BASE_SHA,
      launcher_digest: `sha256:${'c'.repeat(64)}`,
      launcher_token_digest: `sha256:${'d'.repeat(64)}`,
      isolation: 'ephemeral_clone',
      sandbox: 'read_only',
    },
    reviewer: {
      run_id: `review-bootstrap-${slot}`,
      slot,
      adapter: 'codex',
      model: 'gpt-5.6-sol',
      reasoning: 'xhigh',
      capability: {
        model_tier: 'core_audit',
        reasoning_tier: 'xhigh',
        read_only: true,
      },
    },
    prompt_digest: `sha256:${'e'.repeat(64)}`,
    verdict: {
      conformance: 'pass',
      falsification: 'pass',
      blockers: [],
      approved_artifacts: [],
      inconclusive: false,
    },
  };
}

test('bootstrap ledger: API正本のowner/Sol xhigh/CIをprepared→merged completedへ一度だけ遷移する', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-bootstrap-ledger-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const stub = createGhStub(scratch);
  const ownerBody = 'Owner authorizes the exact #274 bootstrap target.';
  const reviewBodies = [renderReviewEvidence(evidence(1)), renderReviewEvidence(evidence(2))];
  const ownerAuthorization = {
    review_id: 100,
    actor: 'repository-owner',
    target_sha: TARGET_SHA,
    evidence_digest: digestOf(ownerBody),
  };
  const independentReviews = [
    {
      review_id: 101,
      run_id: 'review-bootstrap-1',
      model: 'gpt-5.6-sol' as const,
      reasoning: 'xhigh' as const,
      verdict: 'pass' as const,
      target_sha: TARGET_SHA,
      evidence_digest: digestOf(reviewBodies[0]),
    },
    {
      review_id: 102,
      run_id: 'review-bootstrap-2',
      model: 'gpt-5.6-sol' as const,
      reasoning: 'xhigh' as const,
      verdict: 'pass' as const,
      target_sha: TARGET_SHA,
      evidence_digest: digestOf(reviewBodies[1]),
    },
  ] as const;
  const nonGateChecks = [
    { check_id: 201, name: 'reconcile', conclusion: 'success' as const, target_sha: TARGET_SHA },
    { check_id: 202, name: 'verify', conclusion: 'success' as const, target_sha: TARGET_SHA },
  ];
  const prepared: BootstrapPreparedRecord = {
    schema_version: 'agent-skill-chain/bootstrap-ledger/v1',
    state: 'prepared',
    key: {
      repository: 'techbeansjp-free/AGENTS.md',
      pr_number: 274,
      target_sha: TARGET_SHA,
      review_digest: bootstrapEvidenceDigest({
        owner_authorization: ownerAuthorization,
        independent_reviews: [...independentReviews],
        non_gate_checks: nonGateChecks,
      }),
    },
    owner_authorization: ownerAuthorization,
    independent_reviews: [...independentReviews],
    non_gate_checks: nonGateChecks,
  };
  const recordPath = path.join(scratch, 'prepared.json');
  fs.writeFileSync(recordPath, `${canonicalJson(prepared)}\n`);

  const state = stub.readState();
  state.repositoryFullName = 'techbeansjp-free/AGENTS.md';
  state.apiActor = 'ledger-recorder';
  state.collaboratorPermissions = { 'repository-owner': 'admin' };
  state.pullMetadata = {
    number: 274,
    state: 'open',
    merged: false,
    merged_at: null,
    merge_commit_sha: null,
    head: { sha: TARGET_SHA },
    base: { ref: 'main' },
  };
  state.pullReviews = [
    { id: 100, body: ownerBody, commit_id: TARGET_SHA, state: 'COMMENTED', user: { login: 'repository-owner' } },
    { id: 101, body: reviewBodies[0], commit_id: TARGET_SHA, state: 'COMMENTED', user: { login: 'review-recorder' } },
    { id: 102, body: reviewBodies[1], commit_id: TARGET_SHA, state: 'COMMENTED', user: { login: 'review-recorder' } },
  ];
  state.checkRuns = [
    { id: 201, name: 'reconcile', head_sha: TARGET_SHA, status: 'completed', conclusion: 'success' },
    { id: 202, name: 'verify', head_sha: TARGET_SHA, status: 'completed', conclusion: 'success' },
    {
      id: 203,
      name: 'agent-skill-chain/spec-gate',
      head_sha: TARGET_SHA,
      status: 'completed',
      conclusion: 'failure',
    },
  ];
  stub.writeState(state);
  const env = stub.env(process.env);

  const first = runCli(['gate', 'bootstrap-ledger', 'prepare', recordPath], { cwd: repo.dir, env });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /resumed=false/);
  const resumed = runCli(['gate', 'bootstrap-ledger', 'prepare', recordPath], { cwd: repo.dir, env });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /resumed=true/);

  const mergedState = stub.readState();
  mergedState.pullMetadata = {
    ...(mergedState.pullMetadata as Record<string, unknown>),
    state: 'closed',
    merged: true,
    merged_at: '2026-07-26T00:00:00Z',
    merge_commit_sha: 'f'.repeat(40),
  };
  stub.writeState(mergedState);
  const completed = runCli(['gate', 'bootstrap-ledger', 'complete', recordPath], { cwd: repo.dir, env });
  assert.equal(completed.status, 0, completed.stderr);
  assert.match(completed.stdout, new RegExp(`merge_commit_sha=${'f'.repeat(40)}`));
  const repeated = runCli(['gate', 'bootstrap-ledger', 'complete', recordPath], { cwd: repo.dir, env });
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /completed済み/);
});
