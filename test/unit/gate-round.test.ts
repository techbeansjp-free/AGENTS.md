import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveGateRoundContext,
  fetchGateRoundContext,
  gateRoundFailureDiagnostic,
  latestGateAttemptId,
  renderGateRoundHistory,
  resolveGateRoundLimit,
  summarizeFindingEvidence,
  validateGateRoundLimit,
} from '../../src/lib/gate-round.js';
import {
  renderReviewAttemptStart,
  renderReviewEvidence,
  type GithubReviewRecord,
  type ReviewAttemptStart,
  type ReviewEvidence,
} from '../../src/lib/review-evidence.js';

function evidence(options: {
  attempt: string;
  slot: 1 | 2;
  target?: string;
  evidenceText?: string;
  profile?: 'standard' | 'strict';
}): ReviewEvidence {
  const profile = options.profile ?? (options.slot === 2 ? 'strict' : 'standard');
  return {
    schema_version: 'agent-skill-chain/gate-review-evidence/v3',
    issue_id: 'ISSUE-729',
    gate: 'implementation',
    profile,
    target_sha: options.target ?? options.attempt.padEnd(40, 'a').slice(0, 40),
    attempt_id: options.attempt,
    expected_count: profile === 'strict' ? 2 : 1,
    execution: {
      launcher: 'agent-skill-chain/gate-local-review/v1',
      trusted_base_sha: 'b'.repeat(40),
      launcher_digest: `sha256:${'c'.repeat(64)}`,
      launcher_token_digest: `sha256:${'d'.repeat(64)}`,
      isolation: 'ephemeral_clone',
      sandbox: 'read_only',
    },
    reviewer: {
      run_id: `review-${options.attempt}-${options.slot}`,
      slot: options.slot,
      adapter: 'codex',
      model: 'model',
      reasoning: 'high',
      capability: { model_tier: 'tier', reasoning_tier: 'reasoning', read_only: true },
    },
    prompt_digest: `sha256:${'e'.repeat(64)}`,
    verdict: {
      conformance: 'pass',
      falsification: 'fail',
      blockers: [{
        severity: 'blocking',
        origin: 'implementation',
        code: `finding-${options.attempt}-${options.slot}`,
        evidence: [options.evidenceText ?? `SPEC.md の対象記述 ${options.attempt} に未処理経路がある`],
      }],
      approved_artifacts: [],
      inconclusive: false,
    },
  };
}

function review(id: number, value: ReviewEvidence, actor = 'trusted'): GithubReviewRecord {
  return {
    id,
    body: renderReviewEvidence(value),
    commit_id: value.target_sha,
    state: 'COMMENTED',
    user: { login: actor },
  };
}

const acceptVerifiedAttempt = () => true;

test('ラウンド導出: Strictの2 slotをattempt_idで畳み、target_sha変更後もStandardと同じ反復数になる', () => {
  const reviews = [
    review(1, evidence({ attempt: 'attempt-old-1', slot: 1, target: '1'.repeat(40), profile: 'strict' })),
    review(2, evidence({ attempt: 'attempt-old-1', slot: 2, target: '1'.repeat(40), profile: 'strict' })),
    review(3, evidence({ attempt: 'attempt-old-2', slot: 1, target: '2'.repeat(40), profile: 'strict' })),
    review(4, evidence({ attempt: 'attempt-old-2', slot: 2, target: '2'.repeat(40), profile: 'strict' })),
  ];
  const strict = deriveGateRoundContext({
    reviews,
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  });
  assert.equal(strict.status, 'available');
  if (strict.status === 'available') {
    assert.equal(strict.round, 2);
    assert.deepEqual(strict.history.map((entry) => entry.slots.length), [2, 2]);
    assert.deepEqual(strict.history.map((entry) => entry.target_sha), ['1'.repeat(40), '2'.repeat(40)]);
  }

  const standard = deriveGateRoundContext({
    reviews: [
      review(1, evidence({ attempt: 'attempt-old-1', slot: 1, target: '1'.repeat(40) })),
      review(3, evidence({ attempt: 'attempt-old-2', slot: 1, target: '2'.repeat(40) })),
    ],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  });
  assert.equal(standard.status === 'available' ? standard.round : -1, 2);
});

test('ラウンド導出: 当該attemptと未登録actorを除外し、根拠要約を600文字で明示的に切り詰める', () => {
  const context = deriveGateRoundContext({
    reviews: [
      review(1, evidence({ attempt: 'attempt-old', slot: 1, evidenceText: `SPEC.md: ${'根'.repeat(700)}` })),
      review(2, evidence({ attempt: 'attempt-untrusted', slot: 1 }), 'intruder'),
      review(3, evidence({ attempt: 'attempt-current', slot: 1 })),
    ],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  });
  assert.equal(context.status, 'available');
  if (context.status === 'available') {
    assert.equal(context.round, 1);
    assert.equal(context.history[0].attempt_id, 'attempt-old');
    const summary = context.history[0].slots[0].findings[0].evidence_summary;
    assert.equal(summary.length, 600);
    assert.match(summary, /切り詰め/);
  }
});

test('ラウンド導出: API metadataまたはattempt attestationが不正なreviewを計数しない', () => {
  const apiMismatch = review(1, evidence({ attempt: 'attempt-api-mismatch', slot: 1 }));
  apiMismatch.commit_id = 'f'.repeat(40);
  const first = evidence({ attempt: 'attempt-prompt-mismatch', slot: 1, profile: 'strict' });
  const second = evidence({ attempt: 'attempt-prompt-mismatch', slot: 2, profile: 'strict' });
  second.prompt_digest = `sha256:${'f'.repeat(64)}`;
  const context = deriveGateRoundContext({
    reviews: [apiMismatch, review(2, first), review(3, second)],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  });
  assert.equal(context.status, 'available');
  if (context.status === 'available') {
    assert.equal(context.round, 0);
    assert.equal(context.history.length, 0);
    assert.match(context.diagnostics?.join('\n') ?? '', /ラウンド計数から除外/);
  }
});

test('ラウンド導出: trusted verifierが真正性を確認できない完備attemptを計数しない', () => {
  const context = deriveGateRoundContext({
    reviews: [review(1, evidence({ attempt: 'attempt-form-only', slot: 1 }))],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: () => false,
  });
  assert.equal(context.status, 'available');
  if (context.status === 'available') {
    assert.equal(context.round, 0);
    assert.match(context.diagnostics?.join('\n') ?? '', /trusted verifierの検証に失敗/);
  }
});

test('ラウンド導出: 現行検査より前に有効だったv3 findingも履歴として計数する', () => {
  const legacy = evidence({ attempt: 'attempt-legacy-v3', slot: 1 });
  legacy.verdict.blockers[0].evidence = ['反例'];
  const context = deriveGateRoundContext({
    reviews: [review(1, legacy)],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  });
  assert.equal(context.status, 'available');
  if (context.status === 'available') {
    assert.equal(context.round, 1);
    assert.equal(context.history[0].slots[0].findings[0].evidence_summary, '反例');
    assert.equal(context.diagnostics, undefined);
  }
});

test('根拠要約: 防御的に空配列からも空文字を生成しない', () => {
  assert.match(summarizeFindingEvidence([]), /evidence が空/);
});

test('ラウンド導出: ローカル・PR無し・trusted actor無し・attempt無しを初回と区別して導出不能にする', () => {
  const base = {
    root: process.cwd(),
    backend: 'github' as const,
    prNumber: '756',
    issueId: 'ISSUE-729',
    gate: 'implementation' as const,
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  };
  assert.equal(fetchGateRoundContext({ ...base, backend: 'local' }).status, 'unavailable');
  assert.equal(fetchGateRoundContext({ ...base, prNumber: undefined }).status, 'unavailable');
  assert.equal(fetchGateRoundContext({ ...base, currentAttemptId: undefined }).status, 'unavailable');
  assert.equal(fetchGateRoundContext({ ...base, trustedActors: [] }).status, 'unavailable');
  assert.equal(fetchGateRoundContext({
    ...base,
    fetchReviews: () => ({ status: 1, stdout: '' }),
  }).status, 'unavailable');
});

test('ラウンド診断: 取得・解釈の失敗だけを診断対象とし、正常な運用形態では診断を出さない', () => {
  const base = {
    root: process.cwd(),
    backend: 'github' as const,
    prNumber: '756',
    issueId: 'ISSUE-729',
    gate: 'implementation' as const,
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  };
  // 正常な運用形態（失敗ではない）: 診断を出さない。
  for (const normal of [
    fetchGateRoundContext({ ...base, backend: 'local' }),
    fetchGateRoundContext({ ...base, prNumber: undefined }),
    fetchGateRoundContext({ ...base, currentAttemptId: undefined }),
    fetchGateRoundContext({ ...base, trustedActors: [] }),
  ]) {
    assert.equal(normal.status, 'unavailable');
    assert.equal(gateRoundFailureDiagnostic(normal), undefined);
  }

  // gh の非 0 終了・JSON として解釈できない応答: 理由付きの診断を出す。
  const ghFailed = fetchGateRoundContext({ ...base, fetchReviews: () => ({ status: 1, stdout: '' }) });
  const unparsable = fetchGateRoundContext({ ...base, fetchReviews: () => ({ status: 0, stdout: '' }) });
  for (const failure of [ghFailed, unparsable]) {
    assert.equal(failure.status, 'unavailable');
    const diagnostic = gateRoundFailureDiagnostic(failure);
    assert.ok(diagnostic, '失敗経路では診断行が生成されること');
    assert.match(diagnostic, /過去ラウンドの判定記録を取得できませんでした/);
    assert.match(diagnostic, /ラウンド予算による限定は適用されません/);
  }
  assert.match(gateRoundFailureDiagnostic(ghFailed)!, /取得に失敗/);
  assert.match(gateRoundFailureDiagnostic(unparsable)!, /解釈できませんでした/);

  // 取得できた場合は診断対象にならない。
  assert.equal(
    gateRoundFailureDiagnostic({ status: 'available', round: 0, history: [] }),
    undefined,
  );
});

test('ラウンド履歴: 出力形の違いを吸収し、空応答を過去ラウンド0件として扱わない', () => {
  const base = {
    root: process.cwd(),
    backend: 'github' as const,
    prNumber: '756',
    issueId: 'ISSUE-729',
    gate: 'implementation' as const,
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  };
  const records = [review(1, evidence({ attempt: 'attempt-past', slot: 1 }))];
  const shapes = {
    single: JSON.stringify(records),
    concatenated: `${JSON.stringify(records)}\n${JSON.stringify([])}`,
    pages: JSON.stringify([records, []]),
  };
  for (const [name, stdout] of Object.entries(shapes)) {
    const context = fetchGateRoundContext({ ...base, fetchReviews: () => ({ status: 0, stdout }) });
    assert.equal(context.status, 'available', name);
    if (context.status === 'available') assert.equal(context.round, 1, name);
  }
  // 空出力は「過去ラウンド0件」ではなく取得不能とする。
  const empty = fetchGateRoundContext({ ...base, fetchReviews: () => ({ status: 0, stdout: '   ' }) });
  assert.equal(empty.status, 'unavailable');
  if (empty.status === 'unavailable') assert.equal(empty.failed, true);
});

test('ラウンド履歴: 節全体が24000文字以内になり、古いラウンドの省略番号を明示する', () => {
  const context = deriveGateRoundContext({
    reviews: Array.from({ length: 60 }, (_, index) =>
      review(index + 1, evidence({
        attempt: `attempt-${index}`,
        slot: 1,
        evidenceText: `SPEC.md ${index}:` + '長'.repeat(590),
      }))),
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
    verifyAttempt: acceptVerifiedAttempt,
  });
  assert.equal(context.status, 'available');
  if (context.status === 'available') {
    const rendered = renderGateRoundHistory(context.history);
    assert.ok(rendered.length <= 24_000);
    assert.match(rendered, /分量上限により古いラウンド/);
    assert.match(rendered, /ラウンド 59/);
  }
});

test('閾値: 既定値は2<4で、省略時も解決され、大なり・等号・下限違反を拒否する', () => {
  assert.deepEqual(resolveGateRoundLimit(), { narrowing_threshold: 2, cutoff_threshold: 4 });
  assert.equal(validateGateRoundLimit(resolveGateRoundLimit()), undefined);
  assert.match(validateGateRoundLimit({ narrowing_threshold: 5, cutoff_threshold: 4 }) ?? '', /真に小さい/);
  assert.match(validateGateRoundLimit({ narrowing_threshold: 4, cutoff_threshold: 4 }) ?? '', /真に小さい/);
  assert.match(validateGateRoundLimit({ narrowing_threshold: 0, cutoff_threshold: 4 }) ?? '', /1以上/);
  assert.match(validateGateRoundLimit({ narrowing_threshold: 1, cutoff_threshold: 1 }) ?? '', /2以上/);
});

test('最新attempt選択: 同一Issue・gate・targetの最大review IDだけを返す', () => {
  const old = evidence({ attempt: 'attempt-old', slot: 1, target: 'f'.repeat(40) });
  const current = evidence({ attempt: 'attempt-current', slot: 1, target: 'f'.repeat(40) });
  assert.equal(latestGateAttemptId({
    reviews: [review(1, old), review(3, current), review(4, evidence({ attempt: 'attempt-other-target', slot: 1 }))],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    targetSha: 'f'.repeat(40),
    trustedActors: ['trusted'],
  }), 'attempt-current');
});

test('最新attempt選択: evidenceがまだ無いdurable attemptを旧complete evidenceより優先する', () => {
  const targetSha = 'f'.repeat(40);
  const old = evidence({ attempt: 'attempt-old', slot: 1, target: targetSha });
  const attempt: ReviewAttemptStart = {
    schema_version: 'agent-skill-chain/gate-review-attempt/v1',
    issue_id: 'ISSUE-729',
    gate: 'implementation',
    profile: 'strict',
    target_sha: targetSha,
    attempt_id: 'attempt-current-zero',
    expected_count: 2,
    execution: {
      trusted_base_sha: 'b'.repeat(40),
      launcher_token_digest: `sha256:${'d'.repeat(64)}`,
    },
    reviewers: [
      { slot: 1, run_id: 'review-current-zero-1' },
      { slot: 2, run_id: 'review-current-zero-2' },
    ],
  };
  assert.equal(latestGateAttemptId({
    reviews: [
      review(1, old),
      {
        id: 2,
        body: renderReviewAttemptStart(attempt),
        commit_id: targetSha,
        state: 'COMMENTED',
        user: { login: 'trusted' },
      },
    ],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    targetSha,
    trustedActors: ['trusted'],
  }), 'attempt-current-zero');
});
