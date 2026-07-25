import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evidencePromptDigest,
  renderReviewEvidence,
  verifyGithubReviewEvidence,
  type GithubReviewRecord,
  type ReviewEvidence,
} from '../../src/lib/review-evidence.js';

const targetSha = 'a'.repeat(40);
const artifacts = [{ path: 'SPEC.md', digest: `sha256:${'b'.repeat(64)}` }];
const promptDigest = evidencePromptDigest('ISSUE-271', 'spec', targetSha, artifacts);

function evidence(slot: 1 | 2, overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  return {
    schema_version: 'agent-skill-chain/gate-review-evidence/v1',
    issue_id: 'ISSUE-271',
    gate: 'spec',
    profile: 'strict',
    target_sha: targetSha,
    reviewer: {
      run_id: `review-run-${slot}`,
      slot,
      adapter: 'codex',
      model: 'gpt-5.6-sol',
      reasoning: 'xhigh',
      capability: {
        model_tier: 'frontier_coding',
        reasoning_tier: 'maximum_reasoning',
        read_only: true,
      },
    },
    prompt_digest: promptDigest,
    verdict: {
      conformance: 'pass',
      falsification: 'pass',
      blockers: [],
      approved_artifacts: artifacts,
      inconclusive: false,
    },
    ...overrides,
  };
}

function review(id: number, slot: 1 | 2, overrides: Partial<GithubReviewRecord> = {}): GithubReviewRecord {
  return {
    id,
    body: renderReviewEvidence(evidence(slot)),
    commit_id: targetSha,
    state: 'COMMENTED',
    user: { login: 'trusted-reviewer' },
    ...overrides,
  };
}

function verify(reviews: GithubReviewRecord[], overrides: Record<string, unknown> = {}) {
  return verifyGithubReviewEvidence({
    reviews,
    issueId: 'ISSUE-271',
    gate: 'spec',
    profile: 'strict',
    targetSha,
    trustedActors: ['trusted-reviewer'],
    writerActors: ['segment-writer'],
    unresolvedWriterActor: false,
    expectedPromptDigest: promptDigest,
    expectedArtifacts: artifacts,
    coreReviewRequired: true,
    codexModel: 'gpt-5.6-sol',
    codexReasoning: 'xhigh',
    ...overrides,
  });
}

test('strict: trustedな独立slot 1/2だけがapprovedになる', () => {
  const result = verify([review(1, 1), review(2, 2)]);
  assert.equal(result.final, 'approved');
  assert.equal(result.reviewers.length, 2);
  assert.deepEqual(result.reviewers.map((entry) => entry.slot), [1, 2]);
});

test('strict: 1件不足またはslot重複はhuman_required', () => {
  assert.equal(verify([review(1, 1)]).final, 'human_required');
  assert.equal(verify([review(1, 1), review(2, 1)]).final, 'human_required');
});

test('provenance: writer actor、未登録actor、actor未解決を拒否する', () => {
  assert.equal(verify([review(1, 1, { user: { login: 'segment-writer' } }), review(2, 2)]).final, 'human_required');
  assert.equal(verify([review(1, 1, { user: { login: 'unknown' } }), review(2, 2)]).final, 'human_required');
  assert.equal(verify([review(1, 1), review(2, 2)], { unresolvedWriterActor: true }).final, 'human_required');
});

test('freshness: API commit SHA、本文target、prompt、artifact digest改変を拒否する', () => {
  assert.equal(verify([review(1, 1, { commit_id: 'c'.repeat(40) }), review(2, 2)]).final, 'human_required');
  const stale = evidence(1, { target_sha: 'c'.repeat(40) });
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(stale) }), review(2, 2)]).final, 'human_required');
  const badPrompt = evidence(1, { prompt_digest: `sha256:${'d'.repeat(64)}` });
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(badPrompt) }), review(2, 2)]).final, 'human_required');
  const badArtifact = evidence(1);
  badArtifact.verdict.approved_artifacts = [{ path: 'SPEC.md', digest: `sha256:${'e'.repeat(64)}` }];
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(badArtifact) }), review(2, 2)]).final, 'human_required');
});

test('capability: core Codex model/reasoning不一致を拒否し、blocking verdictはrejected', () => {
  const weak = evidence(1);
  weak.reviewer.model = 'other-model';
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(weak) }), review(2, 2)]).final, 'human_required');

  const blocked = evidence(2);
  blocked.verdict.falsification = 'fail';
  blocked.verdict.blockers = [{
    severity: 'blocking',
    origin: 'specification',
    code: 'COUNTEREXAMPLE',
    evidence: ['反例'],
  }];
  assert.equal(verify([review(1, 1), review(2, 2, { body: renderReviewEvidence(blocked) })]).final, 'rejected');
});
