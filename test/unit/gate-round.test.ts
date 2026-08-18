import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveGateRoundContext,
  fetchGateRoundContext,
  latestGateAttemptId,
  renderGateRoundHistory,
  resolveGateRoundLimit,
  validateGateRoundLimit,
} from '../../src/lib/gate-round.js';
import { renderReviewEvidence, type GithubReviewRecord, type ReviewEvidence } from '../../src/lib/review-evidence.js';

function evidence(options: {
  attempt: string;
  slot: 1 | 2;
  target?: string;
  evidenceText?: string;
}): ReviewEvidence {
  return {
    schema_version: 'agent-skill-chain/gate-review-evidence/v3',
    issue_id: 'ISSUE-729',
    gate: 'implementation',
    profile: options.slot === 2 ? 'strict' : 'standard',
    target_sha: options.target ?? options.attempt.padEnd(40, 'a').slice(0, 40),
    attempt_id: options.attempt,
    expected_count: options.slot === 2 ? 2 : 1,
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
        evidence: [options.evidenceText ?? `対象記述 ${options.attempt} に未処理経路がある`],
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

test('ラウンド導出: Strictの2 slotをattempt_idで畳み、target_sha変更後もStandardと同じ反復数になる', () => {
  const reviews = [
    review(1, evidence({ attempt: 'attempt-old-1', slot: 1, target: '1'.repeat(40) })),
    review(2, evidence({ attempt: 'attempt-old-1', slot: 2, target: '1'.repeat(40) })),
    review(3, evidence({ attempt: 'attempt-old-2', slot: 1, target: '2'.repeat(40) })),
    review(4, evidence({ attempt: 'attempt-old-2', slot: 2, target: '2'.repeat(40) })),
  ];
  const strict = deriveGateRoundContext({
    reviews,
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
  });
  assert.equal(strict.status, 'available');
  if (strict.status === 'available') {
    assert.equal(strict.round, 2);
    assert.deepEqual(strict.history.map((entry) => entry.slots.length), [2, 2]);
    assert.deepEqual(strict.history.map((entry) => entry.target_sha), ['1'.repeat(40), '2'.repeat(40)]);
  }

  const standard = deriveGateRoundContext({
    reviews: [reviews[0], reviews[2]],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
  });
  assert.equal(standard.status === 'available' ? standard.round : -1, 2);
});

test('ラウンド導出: 当該attemptと未登録actorを除外し、根拠要約を600文字で明示的に切り詰める', () => {
  const context = deriveGateRoundContext({
    reviews: [
      review(1, evidence({ attempt: 'attempt-old', slot: 1, evidenceText: '根'.repeat(700) })),
      review(2, evidence({ attempt: 'attempt-untrusted', slot: 1 }), 'intruder'),
      review(3, evidence({ attempt: 'attempt-current', slot: 1 })),
    ],
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
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

test('ラウンド導出: ローカル・PR無し・trusted actor無し・attempt無しを初回と区別して導出不能にする', () => {
  const base = {
    root: process.cwd(),
    backend: 'github' as const,
    prNumber: '756',
    issueId: 'ISSUE-729',
    gate: 'implementation' as const,
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
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

test('ラウンド履歴: 節全体が24000文字以内になり、古いラウンドの省略番号を明示する', () => {
  const context = deriveGateRoundContext({
    reviews: Array.from({ length: 60 }, (_, index) =>
      review(index + 1, evidence({
        attempt: `attempt-${index}`,
        slot: 1,
        evidenceText: `${index}:` + '長'.repeat(590),
      }))),
    issueId: 'ISSUE-729',
    gate: 'implementation',
    currentAttemptId: 'attempt-current',
    trustedActors: ['trusted'],
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
  }), 'attempt-current');
});
