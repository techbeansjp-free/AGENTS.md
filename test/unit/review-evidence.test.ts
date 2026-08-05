import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evidencePromptDigest,
  renderReviewEvidence,
  verifyGithubReviewEvidence,
  type GithubReviewRecord,
  type LightReviewEvidence,
  type ReviewEvidence,
} from '../../src/lib/review-evidence.js';

const targetSha = 'a'.repeat(40);
const baseSha = 'c'.repeat(40);
const artifacts = [{ path: 'SPEC.md', digest: `sha256:${'b'.repeat(64)}` }];
const promptDigest = evidencePromptDigest('canonical reviewer prompt');
const launcherDigest = `sha256:${'d'.repeat(64)}`;
const launcherTokenDigest = `sha256:${'e'.repeat(64)}`;

function evidence(slot: 1 | 2, overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  return {
    schema_version: 'agent-skill-chain/gate-review-evidence/v3',
    issue_id: 'ISSUE-271',
    gate: 'spec',
    profile: 'strict',
    target_sha: targetSha,
    attempt_id: 'attempt-current',
    expected_count: 2,
    execution: {
      launcher: 'agent-skill-chain/gate-local-review/v1',
      trusted_base_sha: baseSha,
      launcher_digest: launcherDigest,
      launcher_token_digest: launcherTokenDigest,
      isolation: 'ephemeral_clone',
      sandbox: 'read_only',
    },
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
      approved_artifacts: [...artifacts],
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
    expectedTrustedBaseSha: baseSha,
    expectedLauncherDigest: launcherDigest,
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
  assert.equal(result.review_attempt?.attempt_id, 'attempt-current');
  assert.match(result.review_attempt?.evidence_digest ?? '', /^sha256:[0-9a-f]{64}$/);
});

test('strict: 1件不足またはslot重複はhuman_required', () => {
  assert.equal(verify([review(1, 1)]).final, 'human_required');
  assert.equal(verify([review(1, 1), review(2, 1)]).final, 'human_required');
  assert.equal(verify([review(1, 1)], { profile: 'standard' }).final, 'human_required');
});

test('retry: same-SHAの旧complete attemptを無視して最新attemptだけを採用し、最新不完全時はfallbackしない', () => {
  const oldOne = evidence(1, { attempt_id: 'attempt-old' });
  const oldTwo = evidence(2, { attempt_id: 'attempt-old' });
  const newOne = evidence(1, { attempt_id: 'attempt-new' });
  const newTwo = evidence(2, { attempt_id: 'attempt-new' });
  const complete = verify([
    review(1, 1, { body: renderReviewEvidence(oldOne) }),
    review(2, 2, { body: renderReviewEvidence(oldTwo) }),
    review(3, 1, { body: renderReviewEvidence(newOne) }),
    review(4, 2, { body: renderReviewEvidence(newTwo) }),
  ]);
  assert.equal(complete.final, 'approved');
  assert.equal(complete.review_attempt?.attempt_id, 'attempt-new');
  const incomplete = verify([
    review(1, 1, { body: renderReviewEvidence(oldOne) }),
    review(2, 2, { body: renderReviewEvidence(oldTwo) }),
    review(3, 1, { body: renderReviewEvidence(newOne) }),
  ]);
  assert.equal(incomplete.final, 'human_required');
  const malformedOld = evidence(1, { attempt_id: 'attempt-old' });
  delete (malformedOld.execution as Partial<ReviewEvidence['execution']>).launcher_token_digest;
  const validAfterMalformedHistory = verify([
    review(1, 1, { body: renderReviewEvidence(malformedOld) }),
    review(2, 1, { body: renderReviewEvidence(newOne) }),
    review(3, 2, { body: renderReviewEvidence(newTwo) }),
  ]);
  assert.equal(validAfterMalformedHistory.final, 'approved');
});

test('provenance: 同一actorのtrusted recorderをrun attestationで区別し、未登録・actor未解決は拒否する', () => {
  const sameActor = verify(
    [
      review(1, 1, { user: { login: 'segment-writer' } }),
      review(2, 2, { user: { login: 'segment-writer' } }),
    ],
    { trustedActors: ['segment-writer'] },
  );
  assert.equal(sameActor.final, 'approved');
  assert.deepEqual(sameActor.reviewers.map((entry) => entry.actor_relation), ['same_as_writer', 'same_as_writer']);
  assert.equal(verify([review(1, 1, { user: { login: 'unknown' } }), review(2, 2)]).final, 'human_required');
  assert.equal(verify([review(1, 1), review(2, 2)], { unresolvedWriterActor: true }).final, 'human_required');
});

test('freshness: API commit SHA、本文target、prompt、artifact digest改変を拒否する', () => {
  assert.equal(verify([review(1, 1, { commit_id: 'c'.repeat(40) }), review(2, 2)]).final, 'human_required');
  const stale = evidence(1, { target_sha: 'c'.repeat(40) });
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(stale) }), review(2, 2)]).final, 'human_required');
  const badPrompt = evidence(1, { prompt_digest: `sha256:${'d'.repeat(64)}` });
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(badPrompt) }), review(2, 2)]).final, 'human_required');
  const badExecution = evidence(1);
  badExecution.execution.launcher_digest = `sha256:${'e'.repeat(64)}`;
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(badExecution) }), review(2, 2)]).final, 'human_required');
  const mismatchedToken = evidence(2);
  mismatchedToken.execution.launcher_token_digest = `sha256:${'f'.repeat(64)}`;
  assert.equal(
    verify([review(1, 1), review(2, 2, { body: renderReviewEvidence(mismatchedToken) })]).final,
    'human_required',
  );
  const badRun = evidence(1);
  badRun.reviewer.run_id = 'run-writer-1';
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(badRun) }), review(2, 2)]).final, 'human_required');
  const badArtifact = evidence(1);
  badArtifact.verdict.approved_artifacts = [{ path: 'SPEC.md', digest: `sha256:${'e'.repeat(64)}` }];
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(badArtifact) }), review(2, 2)]).final, 'human_required');
  const extraArtifact = evidence(1);
  extraArtifact.verdict.approved_artifacts.push({ path: 'EXTRA.md', digest: `sha256:${'f'.repeat(64)}` });
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(extraArtifact) }), review(2, 2)]).final, 'human_required');
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

test('schema: 不正なfinding enumをpass/passに添えてもapprovedへ倒れない', () => {
  const malformed = evidence(1) as unknown as {
    verdict: ReviewEvidence['verdict'];
  };
  malformed.verdict.blockers = [{
    severity: 'critical',
    origin: 'implementation',
    code: 'MALFORMED',
    evidence: ['unknown severity'],
  } as unknown as ReviewEvidence['verdict']['blockers'][number]];
  assert.equal(
    verify([
      review(1, 1, { body: renderReviewEvidence(malformed as unknown as ReviewEvidence) }),
      review(2, 2),
    ]).final,
    'human_required',
  );
});

test('light review証跡: prompt digestへ結線して保持し、同一attempt内の不一致を拒否する', () => {
  const lightReview: LightReviewEvidence = {
    requested: true,
    applied: false,
    disabled_reasons: ['変更差分がcore_reviewの対象パスに該当します'],
    remediation_round: 1,
    strict_locked: true,
  };
  const lightPromptDigest = evidencePromptDigest(`canonical reviewer prompt:${JSON.stringify(lightReview)}`);
  const first = evidence(1, { light_review: lightReview, prompt_digest: lightPromptDigest });
  const second = evidence(2, { light_review: lightReview, prompt_digest: lightPromptDigest });
  const expectedPromptDigest = (actual?: LightReviewEvidence) =>
    evidencePromptDigest(`canonical reviewer prompt:${JSON.stringify(actual)}`);
  const approved = verify(
    [
      review(1, 1, { body: renderReviewEvidence(first) }),
      review(2, 2, { body: renderReviewEvidence(second) }),
    ],
    {
      expectedPromptDigest: expectedPromptDigest(lightReview),
      expectedLightReview: lightReview,
      profile: 'strict',
      coreReviewRequired: false,
    },
  );
  assert.equal(approved.final, 'approved');
  assert.deepEqual(approved.light_review, lightReview);

  const inconsistent = evidence(2, {
    light_review: { ...lightReview, remediation_round: 2 },
    prompt_digest: expectedPromptDigest({ ...lightReview, remediation_round: 2 }),
  });
  assert.equal(
    verify(
      [
        review(1, 1, { body: renderReviewEvidence(first) }),
        review(2, 2, { body: renderReviewEvidence(inconsistent) }),
      ],
      {
        expectedPromptDigest: expectedPromptDigest(lightReview),
        expectedLightReview: lightReview,
        profile: 'strict',
        coreReviewRequired: false,
      },
    ).final,
    'human_required',
  );

  const malformed = evidence(1, {
    light_review: { ...lightReview, remediation_round: -1 },
    prompt_digest: lightPromptDigest,
  });
  assert.equal(
    verify(
      [
        review(1, 1, { body: renderReviewEvidence(malformed) }),
        review(2, 2, { body: renderReviewEvidence(second) }),
      ],
      {
        expectedPromptDigest: expectedPromptDigest(lightReview),
        expectedLightReview: lightReview,
        profile: 'strict',
        coreReviewRequired: false,
      },
    ).final,
    'human_required',
  );
});

test('trusted Strict profileをlight_review.applied自己申告でStandardへ降格できない', () => {
  const forgedLightReview: LightReviewEvidence = {
    requested: true,
    applied: true,
    disabled_reasons: [],
    remediation_round: 0,
    strict_locked: false,
  };
  const forged = evidence(1, {
    profile: 'standard',
    expected_count: 1,
    light_review: forgedLightReview,
  });
  const result = verify(
    [review(1, 1, { body: renderReviewEvidence(forged) })],
    {
      profile: 'strict',
      coreReviewRequired: false,
      expectedLightReview: forgedLightReview,
    },
  );
  assert.equal(result.final, 'human_required');
  assert.match(result.reason ?? '', /profile.*trusted/);
});
