import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateGateAttempt, type GateVerdictLike } from '../../src/lib/gate-verdict-aggregation.js';

interface Finding {
  severity: 'blocking' | 'warning';
  code: string;
}

type Verdict = GateVerdictLike<Finding>;

const pass: Verdict = { conformance: 'pass', falsification: 'pass', blockers: [] };
const fail: Verdict = {
  conformance: 'pass',
  falsification: 'fail',
  blockers: [{ severity: 'blocking', code: 'counterexample' }],
};
const pending: Verdict = { conformance: 'pass', falsification: 'pending', blockers: [] };

function aggregate(
  requiredReviewerCount: number | undefined,
  launchedSlots: number[],
  entries: [number, Verdict | undefined][],
) {
  return aggregateGateAttempt<Finding, Verdict>({
    requiredReviewerCount,
    launchedSlots,
    verdictBySlot: new Map(entries.map(([slot, verdict]) => [
      slot,
      verdict
        ? { status: 'resolved' as const, verdict }
        : { status: 'unresolved' as const },
    ])),
  });
}

test('ISSUE-733 AC-24: 要求体数を解決できない場合とレビュア未起動はhuman_requiredになる', () => {
  assert.equal(aggregate(undefined, [1], [[1, pass]]).final, 'human_required');
  assert.equal(aggregate(1, [], []).final, 'human_required');
});

test('ISSUE-733 AC-24: 起動体数不足は返された判定の内容によらずhuman_requiredになる', () => {
  for (const verdict of [pass, fail, pending]) {
    const result = aggregate(2, [1], [[1, verdict]]);
    assert.equal(result.final, 'human_required');
    assert.equal(result.conformance, 'pending');
    assert.equal(result.falsification, 'pending');
  }
});

test('ISSUE-733 AC-24: 起動済みslotの判定が一部または全部未確定ならhuman_requiredになる', () => {
  assert.equal(aggregate(2, [1, 2], [[1, pass], [2, undefined]]).final, 'human_required');
  assert.equal(aggregate(2, [1, 2], [[1, undefined], [2, undefined]]).final, 'human_required');
  assert.equal(aggregate(1, [1, 2], [[1, pass], [2, undefined]]).final, 'human_required');
});

test('ISSUE-733 AC-15/AC-16: 判定が全件そろった後はfail・blockingをpendingより優先する', () => {
  const result = aggregate(2, [1, 2], [[1, fail], [2, pending]]);
  assert.equal(result.final, 'rejected');
  assert.equal(result.falsification, 'fail');
  assert.deepEqual(result.blockers.map((finding) => finding.code), ['counterexample']);
});

test('ISSUE-733 AC-14/AC-15: 全slotが両観点passの場合だけapprovedになる', () => {
  assert.equal(aggregate(1, [1], [[1, pass]]).final, 'approved');
  assert.equal(aggregate(2, [1, 2], [[1, pass], [2, pass]]).final, 'approved');
  assert.equal(aggregate(2, [1, 2], [[1, pass], [2, pending]]).final, 'human_required');
});

test('ISSUE-733 AC-14/AC-15/AC-24: 要求体数を超えたslotも全件を集約対象にする', () => {
  assert.equal(aggregate(1, [1, 2], [[1, pass], [2, pass]]).final, 'approved');
  assert.equal(aggregate(1, [1, 2], [[1, pass], [2, fail]]).final, 'rejected');
});

test('ISSUE-733 AC-24: 要求体数だけを変えると同じ起動済みslotでもquorum判定が変わる', () => {
  assert.equal(aggregate(1, [1], [[1, pass]]).final, 'approved');
  assert.equal(aggregate(2, [1], [[1, pass]]).final, 'human_required');
});
