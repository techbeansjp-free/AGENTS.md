import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evidencePromptDigest,
  isEvidenceVerdict,
  renderReviewEvidence,
  verifyGithubReviewEvidence,
  type EvidenceFinding,
  type GithubReviewRecord,
  type LightReviewEvidence,
  type ReviewEvidence,
} from '../../src/lib/review-evidence.js';
import {
  createFindingClassificationRecord,
  createRoundBudgetDeclaration,
  renderFindingClassificationRecord,
} from '../../src/lib/round-budget-policy.js';

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

test('ラウンド打ち切り: 閾値到達時のblockingをrejectedより先にhuman_requiredへ移し、未到達・導出不能・blocker無しは既存判定を保つ', () => {
  const blockingVerdict: ReviewEvidence['verdict'] = {
    conformance: 'pass',
    falsification: 'fail',
    blockers: [{
      severity: 'blocking',
      origin: 'implementation',
      code: 'still-blocking',
      evidence: ['src/commands/gate.ts に未解消経路が残る'],
    }],
    approved_artifacts: [...artifacts],
    inconclusive: false,
  };
  const blockingReviews = [
    review(1, 1, { body: renderReviewEvidence(evidence(1, { verdict: blockingVerdict })) }),
    review(2, 2, { body: renderReviewEvidence(evidence(2, { verdict: blockingVerdict })) }),
  ];

  const cutoff = verify(blockingReviews, { gateRound: { round: 4, cutoffThreshold: 4 } });
  assert.equal(cutoff.final, 'human_required');
  assert.equal(cutoff.inconclusive, true);
  assert.match(cutoff.reason ?? '', /round=4/);
  assert.match(cutoff.reason ?? '', /cutoff_threshold=4/);
  assert.match(cutoff.reason ?? '', /unresolved_blocking=2/);

  assert.equal(
    verify(blockingReviews, { gateRound: { round: 3, cutoffThreshold: 4 } }).inconclusive,
    false,
  );
  assert.equal(
    verify(blockingReviews, { gateRound: { round: 3, cutoffThreshold: 4 } }).final,
    'rejected',
  );
  assert.equal(verify(blockingReviews).final, 'rejected');
  assert.equal(
    verify([review(1, 1), review(2, 2)], { gateRound: { round: 4, cutoffThreshold: 4 } }).final,
    'approved',
  );
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

test('freshness: API commit SHA、本文target、引き渡されたprompt digest、artifact digest改変を拒否する', () => {
  assert.equal(verify([review(1, 1, { commit_id: 'c'.repeat(40) }), review(2, 2)]).final, 'human_required');
  const stale = evidence(1, { target_sha: 'c'.repeat(40) });
  assert.equal(verify([review(1, 1, { body: renderReviewEvidence(stale) }), review(2, 2)]).final, 'human_required');
  const badPrompt = evidence(1, { prompt_digest: `sha256:${'d'.repeat(64)}` });
  const badPromptSlotTwo = evidence(2, { prompt_digest: badPrompt.prompt_digest });
  const promptMismatch = verify([
    review(1, 1, { body: renderReviewEvidence(badPrompt) }),
    review(2, 2, { body: renderReviewEvidence(badPromptSlotTwo) }),
  ]);
  assert.equal(promptMismatch.final, 'human_required');
  assert.match(promptMismatch.reason ?? '', /prompt digestが一致しません/);
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
    evidence: ['SPEC.md の要求と実装が一致しない'],
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

test('schema: finding.evidence の空・短すぎる要約・対象識別子の欠落を拒否する', () => {
  const emptyEvidence = evidence(1).verdict;
  emptyEvidence.blockers = [{
    severity: 'blocking',
    origin: 'implementation',
    code: 'EMPTY-EVIDENCE',
    evidence: [],
  }];
  assert.equal(isEvidenceVerdict(emptyEvidence), false);

  const blankEvidence = evidence(1).verdict;
  blankEvidence.blockers = [{
    severity: 'blocking',
    origin: 'implementation',
    code: 'BLANK-EVIDENCE',
    evidence: ['   '],
  }];
  assert.equal(isEvidenceVerdict(blankEvidence), false);

  const shortEvidence = evidence(1).verdict;
  shortEvidence.blockers = [{
    severity: 'blocking',
    origin: 'implementation',
    code: 'SHORT-EVIDENCE',
    evidence: ['反例'],
  }];
  assert.equal(isEvidenceVerdict(shortEvidence), false);

  const unidentifiedEvidence = evidence(1).verdict;
  unidentifiedEvidence.blockers = [{
    severity: 'blocking',
    origin: 'implementation',
    code: 'NO-TARGET',
    evidence: ['対象の記述に未解消の失敗経路が残っています'],
  }];
  assert.equal(isEvidenceVerdict(unidentifiedEvidence), false);

  const artifactPathEvidence = evidence(1).verdict;
  artifactPathEvidence.blockers = [{
    severity: 'blocking',
    origin: 'implementation',
    code: 'PATH-TARGET',
    evidence: ['src/commands/gate.ts の対象記述に未解消の失敗経路が残る'],
  }];
  assert.equal(isEvidenceVerdict(artifactPathEvidence), true);

  const acIdEvidence = evidence(1).verdict;
  acIdEvidence.blockers = [{
    severity: 'blocking',
    origin: 'implementation',
    code: 'AC-TARGET',
    evidence: ['AC-3 の要求に対する検証証跡が不足している'],
  }];
  assert.equal(isEvidenceVerdict(acIdEvidence), true);
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

// Issue #786: 分類後の判定集約（D3）の両方向を固定する。
// ラウンド1の欠陥は「blocking が0件なら conformance/falsification/final/inconclusive を無条件に
// 上書きして approved へ倒す」、ラウンド2の欠陥は「severity だけ差し替えて sub-verdict に一切
// 反映せず rejected が永久に確定する」であり、正反対の両方が blocking と判定された。
// 有効 sub-verdict は raw を書き換えず、4条件がすべて成立するレビュアの raw 'fail' だけを
// 'pass' として扱う派生値であり、判定値は順序評価で決まる。
const finalRoundDeclaration = {
  ...createRoundBudgetDeclaration({
    issueId: 'ISSUE-271',
    gate: 'spec',
    previousAttemptId: 'attempt-before-final',
    finalRound: 4,
  }),
  declared_at: '2026-08-19T00:00:00.000Z',
  record_id: '11',
};
const finalRound = { round: 4, cutoffThreshold: 4 };

function blockingFinding(code: string): EvidenceFinding {
  return {
    severity: 'blocking',
    origin: 'implementation',
    code,
    evidence: [`src/commands/gate.ts の限定4類型外の指摘 (${code})`],
  };
}

function verdictOf(overrides: Partial<ReviewEvidence['verdict']>): ReviewEvidence['verdict'] {
  return {
    conformance: 'pass',
    falsification: 'pass',
    blockers: [],
    approved_artifacts: [...artifacts],
    inconclusive: false,
    ...overrides,
  };
}

function declaredReviews(
  first: ReviewEvidence['verdict'],
  second: ReviewEvidence['verdict'],
  declared = true,
): GithubReviewRecord[] {
  const attach = (slot: 1 | 2, verdict: ReviewEvidence['verdict']) =>
    review(slot, slot, {
      body: renderReviewEvidence(evidence(slot, {
        verdict,
        ...(declared ? { round_budget_declaration: finalRoundDeclaration } : {}),
      })),
    });
  return [attach(1, first), attach(2, second)];
}

function classificationComment(
  id: number,
  sourceReviewId: string,
  finding: EvidenceFinding,
  actor = 'trusted-reviewer',
) {
  return {
    id,
    body: renderFindingClassificationRecord(createFindingClassificationRecord({
      issueId: 'ISSUE-271',
      gate: 'spec',
      sourceReviewId,
      sourceFinding: finding,
      followUpIssueId: 'ISSUE-900',
      downgradeReason: '最終roundの限定4類型外であるため',
    })),
    createdAt: '2026-08-19T00:01:00.000Z',
    user: { login: actor },
  };
}

// ラウンド2の回帰（`CLASSIFICATION_NEUTRALIZED_BY_FAIL_SUBVERDICT` /
// `FINDING_CLASSIFICATION_NEVER_UNBLOCKS_FINAL_ROUND`）を固定する。
// 配布ルーブリックは blocking finding に同じレビュアの fail sub-verdict を伴わせるため、
// severity だけを差し替えると最終roundが永久に rejected へ固定され、進行役に次手が無くなる。
test('D3: 4条件が揃う最終roundは、raw failを保持したまま有効sub-verdictでapprovedになる', () => {
  const first = blockingFinding('NON_FINAL_CATEGORY_ONE');
  const second = blockingFinding('NON_FINAL_CATEGORY_TWO');
  const reviews = declaredReviews(
    verdictOf({ conformance: 'fail', falsification: 'fail', blockers: [first] }),
    verdictOf({ conformance: 'pass', falsification: 'fail', blockers: [second] }),
  );

  const withoutClassification = verify(reviews, {
    gateRound: finalRound,
    expectedRoundBudgetDeclaration: finalRoundDeclaration,
  });
  assert.equal(withoutClassification.final, 'human_required');

  const result = verify(reviews, {
    gateRound: finalRound,
    expectedRoundBudgetDeclaration: finalRoundDeclaration,
    findingClassifications: [
      classificationComment(21, '1', first),
      classificationComment(22, '2', second),
    ],
  });
  assert.equal(result.final, 'approved');
  assert.equal(result.conformance, 'pass');
  assert.equal(result.falsification, 'pass');
  assert.equal(result.inconclusive, false);
  // raw値は失われず、同じ現行記録へ併記される。
  assert.deepEqual(result.subverdict_reclassification, {
    original_conformance: 'fail',
    original_falsification: 'fail',
    basis: 'all_blocking_findings_reclassified',
  });
  // findingは削除されず、原文evidenceとfollow-up追跡を保ったwarningとして残る。
  assert.deepEqual(result.blockers.map((finding) => finding.severity), ['warning', 'warning']);
  assert.deepEqual(result.blockers[0].evidence, first.evidence);
  assert.equal(result.blockers[0].reclassification?.original_severity, 'blocking');
  assert.equal(result.blockers[0].reclassification?.follow_up_issue_id, 'ISSUE-900');
});

// ラウンド1の回帰（`FINAL_ROUND_CLASSIFICATION_FORCES_APPROVAL` /
// `CLASSIFICATION_FORCES_APPROVED_OVER_INCONCLUSIVE`）を固定する。
// blocking が0件になったことだけを根拠に判定値と inconclusive を直接代入すると、
// レビュアが「検証不能」と表明した attempt が承認として記録される。
test('D3: 4条件を単独で崩した入力はいずれもapprovedにならず、最終roundではrejectedでなくhuman_requiredへ収束する', () => {
  const first = blockingFinding('NON_FINAL_CATEGORY_ONE');
  const second = blockingFinding('NON_FINAL_CATEGORY_TWO');
  const classifications = [classificationComment(21, '1', first), classificationComment(22, '2', second)];

  // (a) 宣言が成立していない: 分類は判定へ届かず、既存の打ち切り挙動のまま。
  const withoutDeclaration = verify(
    declaredReviews(
      verdictOf({ conformance: 'fail', falsification: 'fail', blockers: [first] }),
      verdictOf({ conformance: 'pass', falsification: 'fail', blockers: [second] }),
      false,
    ),
    { gateRound: finalRound, findingClassifications: classifications },
  );
  assert.equal(withoutDeclaration.final, 'human_required');
  assert.equal(withoutDeclaration.blockers[0].severity, 'blocking');
  assert.equal(withoutDeclaration.subverdict_reclassification, undefined);

  // (b) レビュアがrawで inconclusive を表明している: 推測による承認を記録しない。
  const inconclusive = verify(
    declaredReviews(
      verdictOf({ conformance: 'pending', falsification: 'pending', blockers: [first], inconclusive: true }),
      verdictOf({ conformance: 'pass', falsification: 'fail', blockers: [second] }),
    ),
    {
      gateRound: finalRound,
      expectedRoundBudgetDeclaration: finalRoundDeclaration,
      findingClassifications: classifications,
    },
  );
  assert.equal(inconclusive.final, 'human_required');
  assert.equal(inconclusive.inconclusive, true);
  // 判定不能を表明したレビュアのraw値は差し替えられず、そのまま集約へ残る。
  assert.equal(inconclusive.conformance, 'pending');
  assert.equal(inconclusive.subverdict_reclassification?.original_conformance, 'pending');

  // (c) 未分類のblockingが残る: 差し替え漏れをapprovedへ倒さない。
  const partial = verify(
    declaredReviews(
      verdictOf({ conformance: 'fail', falsification: 'fail', blockers: [first] }),
      verdictOf({ conformance: 'pass', falsification: 'fail', blockers: [second] }),
    ),
    {
      gateRound: finalRound,
      expectedRoundBudgetDeclaration: finalRoundDeclaration,
      findingClassifications: [classifications[0]],
    },
  );
  assert.equal(partial.final, 'human_required');
  assert.equal(partial.subverdict_reclassification, undefined);
  assert.equal(partial.blockers.filter((finding) => finding.severity === 'blocking').length, 1);

  // (d) blocking findingを1件も提出していないレビュアの fail は差し替えの裏付けを持たない。
  const unbackedFail = verify(
    declaredReviews(
      verdictOf({ conformance: 'fail', falsification: 'fail', blockers: [first] }),
      verdictOf({ conformance: 'pass', falsification: 'fail' }),
    ),
    {
      gateRound: finalRound,
      expectedRoundBudgetDeclaration: finalRoundDeclaration,
      findingClassifications: [classifications[0]],
    },
  );
  assert.equal(unbackedFail.final, 'human_required');
  assert.equal(unbackedFail.falsification, 'fail');
  assert.match(unbackedFail.reason ?? '', /最終roundの承認条件/);
});

// D3: 最終ラウンド以外は従来どおり rejected を返す。導入前の判定を変えない経路を固定する。
test('D3: 最終round以外と宣言なし経路は導入前と同じrejectedを維持する', () => {
  const finding = blockingFinding('STILL_BLOCKING');
  const rejecting = declaredReviews(
    verdictOf({ conformance: 'pass', falsification: 'fail', blockers: [finding] }),
    verdictOf({ conformance: 'pass', falsification: 'fail', blockers: [finding] }),
    false,
  );
  assert.equal(verify(rejecting, { gateRound: { round: 3, cutoffThreshold: 4 } }).final, 'rejected');
  assert.equal(verify(rejecting).final, 'rejected');

  // 宣言が成立していても最終round以外で未分類blockingが残れば rejected のまま。
  const declaredNonFinal = verify(
    declaredReviews(
      verdictOf({ conformance: 'pass', falsification: 'fail', blockers: [finding] }),
      verdictOf({ conformance: 'pass', falsification: 'fail', blockers: [finding] }),
    ),
    {
      gateRound: { round: 3, cutoffThreshold: 4 },
      expectedRoundBudgetDeclaration: finalRoundDeclaration,
    },
  );
  assert.equal(declaredNonFinal.final, 'rejected');
});

// Issue #786 D4: 分類recordのdigestは公開情報から再計算できるため、digest一致は信頼の根拠にならない。
// PR review evidence が trustedActors で actor を束縛している以上、Issueコメント経路だけを
// 未束縛にしない。非trustedな投稿は採用しないだけで、ゲートを停止もさせない。
test('D4: 非trustedな投稿者のfinding分類recordを採用せず、単独でゲートも停止させない', () => {
  const finding = blockingFinding('NON_FINAL_CATEGORY_ONE');
  const reviews = declaredReviews(
    verdictOf({ conformance: 'fail', falsification: 'fail', blockers: [finding] }),
    verdictOf({ conformance: 'pass', falsification: 'pass' }),
  );
  const options = { gateRound: finalRound, expectedRoundBudgetDeclaration: finalRoundDeclaration };

  const forged = verify(reviews, {
    ...options,
    findingClassifications: [classificationComment(21, '1', finding, 'outsider')],
  });
  assert.equal(forged.final, 'human_required');
  assert.equal(forged.blockers[0].severity, 'blocking');

  const trusted = verify(reviews, {
    ...options,
    findingClassifications: [classificationComment(21, '1', finding)],
  });
  assert.equal(trusted.final, 'approved');

  // 第三者が解釈不能なmarker付きコメントを投稿しても、当該ゲートを恒久停止させない。
  const junk = { id: 22, body: `${'<!-- agent-skill-chain:finding-classification -->'}\n本文なし`, createdAt: '2026-08-19T00:02:00.000Z', user: { login: 'outsider' } };
  const survived = verify(reviews, {
    ...options,
    findingClassifications: [classificationComment(21, '1', finding), junk],
  });
  assert.equal(survived.final, 'approved');
});

// Issue #786 D4-4: 分類recordへの上書き検知（`CLASSIFICATION_RECORD_EDIT_NOT_DETECTED` の回帰）。
// classification_digestは秘密値を含まず公開されたsource review本文から再計算できるため、
// write権限保有者が trusted recorder の既存コメント本文を差し替えれば、投稿者束縛もdigest検査も
// 素通りする偽造recordを注入できる。上書きを検知しないと、4類型に該当するblockingまで
// warningへ差し替わり、レビュアのfailもpassへ差し替わって最終roundがapprovedとして記録される。
test('D4: 作成後に上書きされたfinding分類recordを採用せず、4類型のblockingをwarningへ差し替えない', () => {
  const outside = blockingFinding('NON_FINAL_CATEGORY_ONE');
  const dataLoss = blockingFinding('DATA_LOSS_FINDING');
  const reviews = declaredReviews(
    verdictOf({ conformance: 'fail', falsification: 'fail', blockers: [outside, dataLoss] }),
    verdictOf({ conformance: 'pass', falsification: 'pass' }),
  );
  const options = { gateRound: finalRound, expectedRoundBudgetDeclaration: finalRoundDeclaration };

  // trusted recorderは4類型外のoutsideだけを分類する。dataLossはblockingのまま残り、
  // 上限到達により人間判断へ移行する。これが偽造前の正しい帰結である。
  const classified = verify(reviews, {
    ...options,
    findingClassifications: [classificationComment(21, '1', outside)],
  });
  assert.equal(classified.final, 'human_required');
  assert.deepEqual(
    classified.blockers.filter((entry) => entry.severity === 'blocking').map((entry) => entry.code),
    ['DATA_LOSS_FINDING'],
  );

  // 反例経路: 同じ trusted recorder が過去に投稿したコメント1件を編集し、dataLossの
  // source_review_id・origin・evidence・raw_evidenceを公開本文から複写した偽造recordを注入する。
  // 投稿者もdigestも正しいが、API上のcreated_atとupdated_atが一致しない。
  const injected = { ...classificationComment(22, '1', dataLoss), updatedAt: '2026-08-19T00:05:00.000Z' };
  const forged = verify(reviews, {
    ...options,
    findingClassifications: [classificationComment(21, '1', outside), injected],
  });
  assert.equal(forged.final, 'human_required');
  assert.match(forged.reason ?? '', /上書き/);
  // 分類は1件も適用されず、両findingがblockingのまま残る。
  assert.deepEqual(forged.blockers.map((entry) => entry.severity), ['blocking', 'blocking']);
  // レビュアのraw failもpassへ差し替わらない。
  assert.equal(forged.conformance, 'fail');
  assert.equal(forged.falsification, 'fail');
  assert.equal(forged.subverdict_reclassification, undefined);
  assert.equal(forged.inconclusive, true);
});

// Issue #759 要件7(c)・AC-13 / DESIGN E8: 調達元識別子と実体 digest の記録を必須とする対象は
// 「本要件の充足によって新規に投稿される証跡」に限り、本機構の導入より前に投稿済みの既存証跡が
// 当該記録を持たないことを形式不適合として扱うことは求めない。したがって証跡形式（本ファイルが
// 対象とする層）では任意フィールドとし、必須性は記録経路の側で担保する。
//
// 記録経路の側での必須性は test/integration/gate-procurement-evidence.test.ts が固定する
// （調達情報を欠く launcher token では新規投稿できず、新規投稿の証跡は調達元識別子を必ず持つ）。
// 本テストが固定するのはその補集合、すなわち「導入前に投稿済みの証跡を後から形式不適合にしない」
// 側の境界と、記録がある場合の形式検査・attempt 内一致である。
test('procurement: 導入前の投稿済み証跡は受理し、記録済みは形式検査したうえでattempt内一致を要求する', () => {
  // 本機構の導入より前に投稿済みの証跡（procurement 無し）は引き続き approved へ到達する。
  // 新規投稿でこの形が生じ得ないことは上記の統合テストが別途固定する。
  assert.equal(verify([review(1, 1), review(2, 2)]).final, 'approved');

  const procurement = {
    mode: 'package_copy' as const,
    source: 'candidate-a:/consumer/node_modules/agent-skill-chain#agent-skill-chain@1.2.3',
    digest: `sha256:${'1'.repeat(64)}`,
  };
  const recordedOne = evidence(1);
  recordedOne.execution.procurement = procurement;
  const recordedTwo = evidence(2);
  recordedTwo.execution.procurement = procurement;
  assert.equal(
    verify([
      review(1, 1, { body: renderReviewEvidence(recordedOne) }),
      review(2, 2, { body: renderReviewEvidence(recordedTwo) }),
    ]).final,
    'approved',
  );

  // 片側だけが調達の事実を持つ attempt は、実行attestationの不一致として拒否する。
  assert.equal(
    verify([review(1, 1, { body: renderReviewEvidence(recordedOne) }), review(2, 2)]).final,
    'human_required',
  );

  // package_copy は実体 digest を必須にする（形式不適合は証跡として受理しない）。
  const malformed = evidence(1);
  malformed.execution.procurement = { mode: 'package_copy', source: 'candidate-a:/x#y@1' };
  assert.equal(
    verify([review(1, 1, { body: renderReviewEvidence(malformed) }), review(2, 2)]).final,
    'human_required',
  );

  // 調達元識別子が空値の証跡も受理しない。
  const emptySource = evidence(1);
  emptySource.execution.procurement = { mode: 'clone_build', source: '' };
  assert.equal(
    verify([review(1, 1, { body: renderReviewEvidence(emptySource) }), review(2, 2)]).final,
    'human_required',
  );
});
