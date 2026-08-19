import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FINAL_ROUND_BLOCKING_CATEGORIES,
  createFindingClassificationRecord,
  createRoundBudgetDeclaration,
  resolveDurableRoundBudgetDeclaration,
  roundBudgetDeclarationDigest,
  validateFindingReclassification,
  validateFindingClassificationRecord,
  validateRoundBudgetDeclaration,
} from '../../src/lib/round-budget-policy.js';

function fixture() {
  return createRoundBudgetDeclaration({
    issueId: 'ISSUE-786',
    gate: 'implementation',
    previousAttemptId: 'attempt-implementation-before-final',
    finalRound: 4,
  });
}

test('round budget宣言: 既存round導出のsnapshotとして既定4類型とcanonical digestを固定する', () => {
  const declaration = fixture();
  assert.deepEqual(declaration.blocking_categories, FINAL_ROUND_BLOCKING_CATEGORIES);
  assert.equal(validateRoundBudgetDeclaration(declaration), true);
  const { declaration_digest: _digest, ...payload } = declaration;
  assert.equal(declaration.declaration_digest, roundBudgetDeclarationDigest(payload));
});

test('GitHub finding分類記録: source review・current finding・canonical digestを同じrecordに固定する', () => {
  const record = createFindingClassificationRecord({
    issueId: 'ISSUE-786', gate: 'implementation', sourceReviewId: '1234',
    sourceFinding: {
      severity: 'blocking', origin: 'implementation', code: 'NEW_NONBLOCKING',
      evidence: ['src/example.ts のraw evidence原文'],
    },
    followUpIssueId: 'ISSUE-900', downgradeReason: '限定4類型外',
  });
  assert.equal(validateFindingClassificationRecord(record), true);
  assert.equal(validateFindingClassificationRecord({
    ...record,
    finding: { ...record.finding, evidence: ['改変'] },
  }), false);
});

test('round budget宣言: digest改変・直前attempt不一致・複数宣言・上書き・review開始後追加を拒否する', () => {
  const declaration = fixture();
  assert.equal(validateRoundBudgetDeclaration({ ...declaration, final_round: 5 }), false);
  const base = {
    issueId: 'ISSUE-786',
    gate: 'implementation' as const,
    previousAttemptId: declaration.previous_attempt_id,
    finalRound: 4,
  };
  const comment = {
    id: 10,
    body: `<!-- agent-skill-chain:round-budget-declaration -->\n\`\`\`json\n${JSON.stringify(declaration)}\n\`\`\`\n`,
    createdAt: '2026-08-19T00:01:00.000Z',
  };
  assert.equal(resolveDurableRoundBudgetDeclaration({ comments: [comment], ...base }).status, 'available');
  const reason = (result: ReturnType<typeof resolveDurableRoundBudgetDeclaration>) => {
    assert.equal(result.status, 'invalid');
    return result.status === 'invalid' ? result.reason : '';
  };
  assert.match(reason(resolveDurableRoundBudgetDeclaration({ comments: [], ...base })), /1件だけ/);
  assert.match(reason(resolveDurableRoundBudgetDeclaration({ comments: [comment, { ...comment, id: 11 }], ...base })), /1件だけ/);
  assert.match(reason(resolveDurableRoundBudgetDeclaration({ comments: [{ ...comment, updatedAt: '2026-08-19T00:02:00.000Z' }], ...base })), /上書き/);
  assert.match(reason(resolveDurableRoundBudgetDeclaration({ comments: [comment], ...base, previousAttemptId: 'attempt-other' })), /直前attempt/);
  assert.match(reason(resolveDurableRoundBudgetDeclaration({ comments: [comment], ...base, reviewStartedAt: '2026-08-19T00:00:30.000Z' })), /review開始後/);
  assert.match(reason(resolveDurableRoundBudgetDeclaration({ comments: [comment], ...base, previousEvidenceCompletedAt: '2026-08-19T00:01:30.000Z' })), /結果確定前/);
});

test('finding再分類: 同一current recordのraw evidence完全一致と4類型外根拠を要求する', () => {
  const finding = {
    severity: 'warning',
    evidence: ['SPEC.md の反例原文を改変せず保持する'],
    reclassification: {
      original_severity: 'blocking' as const,
      classified_severity: 'warning' as const,
      downgrade_reason: '最終roundの限定4類型外であるため',
      outside_blocking_categories: {
        previous_blocking_unresolved: false as const,
        issue_purpose_blocked: false as const,
        test_build_regression: false as const,
        data_loss_or_security: false as const,
      },
      raw_evidence: ['SPEC.md の反例原文を改変せず保持する'],
      follow_up_issue_id: 'ISSUE-900',
    },
  };
  assert.equal(validateFindingReclassification(finding), undefined);
  assert.match(
    validateFindingReclassification({
      ...finding,
      reclassification: { ...finding.reclassification, raw_evidence: ['要約へ改変'] },
    }) ?? '',
    /完全一致/,
  );
  assert.match(
    validateFindingReclassification({
      ...finding,
      reclassification: {
        ...finding.reclassification,
        outside_blocking_categories: { ...finding.reclassification.outside_blocking_categories, data_loss_or_security: true as never },
      },
    }) ?? '',
    /4類型すべて/,
  );
});
