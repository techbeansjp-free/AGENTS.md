import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FINAL_ROUND_BLOCKING_CATEGORIES,
  createFindingClassificationRecord,
  createRoundBudgetDeclaration,
  renderFindingClassificationRecord,
  renderRoundBudgetDeclaration,
  resolveDurableRoundBudgetDeclaration,
  roundBudgetDeclarationDigest,
  selectFindingClassificationComments,
  selectRoundBudgetDeclarationComments,
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
    trustedActors: ['trusted-recorder'],
    previousAttemptId: declaration.previous_attempt_id,
    finalRound: 4,
  };
  const comment = {
    id: 10,
    body: `<!-- agent-skill-chain:round-budget-declaration -->\n\`\`\`json\n${JSON.stringify(declaration)}\n\`\`\`\n`,
    createdAt: '2026-08-19T00:01:00.000Z',
    user: { login: 'trusted-recorder' },
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

// Issue #786: 宣言コメントはIssue単位に並ぶ。作成側がgateで絞らずに重複を数えると、
// spec-gateが宣言済みのIssueではdesign/implementation/validationの宣言を作れなくなり、
// 解決側（gateで絞る）は永久に actual=0 を返して当該gateのreviewが起動できなくなる。
test('宣言の重複検査: 別gateの宣言を重複と数えず、同一gateの再宣言だけを検出する', () => {
  const comment = (gate: 'spec' | 'design' | 'implementation' | 'validation', id: number) => ({
    id,
    body: renderRoundBudgetDeclaration(createRoundBudgetDeclaration({
      issueId: 'ISSUE-786',
      gate,
      previousAttemptId: `attempt-${gate}-before-final`,
      finalRound: 4,
    })),
    createdAt: '2026-08-19T00:01:00.000Z',
    user: { login: 'trusted-recorder' },
  });
  const comments = [comment('spec', 10)];
  const trustedActors = ['trusted-recorder'];

  const forImplementation = selectRoundBudgetDeclarationComments({
    comments,
    issueId: 'ISSUE-786',
    gate: 'implementation',
    trustedActors,
  });
  assert.equal(forImplementation.status, 'selected');
  assert.deepEqual(forImplementation.status === 'selected' ? forImplementation.matches : null, []);

  const forSpec = selectRoundBudgetDeclarationComments({ comments, issueId: 'ISSUE-786', gate: 'spec', trustedActors });
  assert.equal(forSpec.status === 'selected' ? forSpec.matches.length : -1, 1);

  const otherIssue = selectRoundBudgetDeclarationComments({ comments, issueId: 'ISSUE-787', gate: 'spec', trustedActors });
  assert.deepEqual(otherIssue.status === 'selected' ? otherIssue.matches : null, []);

  // spec-gate宣言が残ったままでも implementation-gate の宣言は解決できる。
  const resolved = resolveDurableRoundBudgetDeclaration({
    comments: [...comments, comment('implementation', 11)],
    issueId: 'ISSUE-786',
    gate: 'implementation',
    trustedActors,
    previousAttemptId: 'attempt-implementation-before-final',
    finalRound: 4,
  });
  assert.equal(resolved.status, 'available');
});

// Issue #786: declaration_digest は canonicalJson から秘密値なしに再計算できるため、
// digest一致だけでは信頼の根拠にならない。同じゲート判定を動かす PR review evidence が
// trusted recorder で actor を束縛している以上、Issueコメント経路だけを未束縛にしない。
test('制御レコードの信頼境界: 非trustedな投稿者の宣言を採用せず、単独でゲートも停止させない', () => {
  const declaration = fixture();
  const body = renderRoundBudgetDeclaration(declaration);
  const trustedActors = ['trusted-recorder'];
  const base = {
    issueId: 'ISSUE-786',
    gate: 'implementation' as const,
    trustedActors,
    previousAttemptId: declaration.previous_attempt_id,
    finalRound: 4,
  };

  // 第三者が正しいdigestの宣言を投稿しても採用しない（宣言なしと同じ帰結へ落ちる）。
  const forged = { id: 10, body, createdAt: '2026-08-19T00:01:00.000Z', user: { login: 'outsider' } };
  const forgedResult = resolveDurableRoundBudgetDeclaration({ comments: [forged], ...base });
  assert.equal(forgedResult.status, 'invalid');
  assert.match(forgedResult.status === 'invalid' ? forgedResult.reason : '', /1件だけ/);

  // 同じ内容を trusted recorder が投稿すれば採用する。
  const trusted = { ...forged, id: 11, user: { login: 'trusted-recorder' } };
  assert.equal(resolveDurableRoundBudgetDeclaration({ comments: [trusted], ...base }).status, 'available');

  // 非trustedな解釈不能コメントや重複投稿は、採用しないだけで当該gateを恒久停止させない。
  const junk = { id: 12, body: '<!-- agent-skill-chain:round-budget-declaration -->\n本文なし', user: { login: 'outsider' } };
  const duplicate = { ...trusted, id: 13, user: { login: 'outsider' } };
  const survived = resolveDurableRoundBudgetDeclaration({ comments: [junk, duplicate, trusted], ...base });
  assert.equal(survived.status, 'available');

  // 投稿者を解決できないコメントも採用しない。
  const anonymous = { id: 14, body, createdAt: '2026-08-19T00:01:00.000Z' };
  assert.equal(resolveDurableRoundBudgetDeclaration({ comments: [anonymous], ...base }).status, 'invalid');
});

// Issue #786: 分類recordの選択規則は作成側（gate classify-finding の重複検査）と
// 解決側（判定時の severity 差し替え）で同一でなければならない。片側だけを投稿者で絞ると、
// 第三者のコメント1件で trusted recorder の分類を作成不能にできる。
test('finding分類recordの選択: marker・issue_id・gate・投稿者の同一規則で採否を決める', () => {
  const finding = {
    severity: 'blocking' as const,
    origin: 'implementation' as const,
    code: 'NON_FINAL_CATEGORY',
    evidence: ['src/commands/gate.ts の限定4類型外の指摘'],
  };
  const record = (gate: 'spec' | 'implementation', sourceReviewId: string) =>
    createFindingClassificationRecord({
      issueId: 'ISSUE-786',
      gate,
      sourceReviewId,
      sourceFinding: finding,
      followUpIssueId: 'ISSUE-900',
      downgradeReason: '最終roundの限定4類型外であるため',
    });
  const comment = (id: number, gate: 'spec' | 'implementation', sourceReviewId: string, actor: string) => ({
    id,
    body: renderFindingClassificationRecord(record(gate, sourceReviewId)),
    createdAt: '2026-08-19T00:01:00.000Z',
    user: { login: actor },
  });
  const base = { issueId: 'ISSUE-786', gate: 'implementation' as const, trustedActors: ['trusted-recorder'] };

  const selected = selectFindingClassificationComments({
    comments: [
      comment(10, 'implementation', '101', 'trusted-recorder'),
      comment(11, 'spec', '102', 'trusted-recorder'),
      comment(12, 'implementation', '103', 'outsider'),
    ],
    ...base,
  });
  assert.equal(selected.status, 'selected');
  assert.deepEqual(
    selected.status === 'selected' ? selected.matches.map(({ record: value }) => value.source_review_id) : null,
    ['101'],
  );

  // 非trustedな解釈不能コメントは採用もせず、当該gateを停止もさせない。
  const junk = { id: 13, body: '<!-- agent-skill-chain:finding-classification -->\n本文なし', user: { login: 'outsider' } };
  const survived = selectFindingClassificationComments({
    comments: [junk, comment(14, 'implementation', '101', 'trusted-recorder')],
    ...base,
  });
  assert.equal(survived.status, 'selected');

  // trusted recorderが投稿した解釈不能・digest不正なrecordは従来どおり不正として扱う。
  const trustedJunk = { ...junk, id: 15, user: { login: 'trusted-recorder' } };
  assert.equal(selectFindingClassificationComments({ comments: [trustedJunk], ...base }).status, 'invalid');
  const tampered = {
    id: 16,
    body: renderFindingClassificationRecord({
      ...record('implementation', '101'),
      source_review_id: '999',
    }),
    user: { login: 'trusted-recorder' },
  };
  assert.equal(selectFindingClassificationComments({ comments: [tampered], ...base }).status, 'invalid');
});
