import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapEvidenceDigest,
  buildBootstrapCompletedRecord,
  parseBootstrapLedgerRecord,
  renderBootstrapLedgerRecord,
  resolveBootstrapLedgerState,
  type BootstrapKey,
  type BootstrapLedgerEntry,
  type BootstrapPreparedEvidence,
  type BootstrapPreparedRecord,
} from '../../src/lib/bootstrap-ledger.js';

const SHA = 'a'.repeat(40);
const DIGEST = (value: string): string => `sha256:${value.repeat(64)}`;

function prepared(): BootstrapPreparedRecord {
  const evidence: BootstrapPreparedEvidence = {
    owner_authorization: {
      review_id: 100,
      actor: 'repository-owner',
      target_sha: SHA,
      evidence_digest: DIGEST('c'),
    },
    independent_reviews: [
      {
        review_id: 101,
        run_id: 'review-sol-xhigh-1',
        model: 'gpt-5.6-sol',
        reasoning: 'xhigh',
        verdict: 'pass',
        target_sha: SHA,
        evidence_digest: DIGEST('d'),
      },
      {
        review_id: 102,
        run_id: 'review-sol-xhigh-2',
        model: 'gpt-5.6-sol',
        reasoning: 'xhigh',
        verdict: 'pass',
        target_sha: SHA,
        evidence_digest: DIGEST('e'),
      },
    ],
    non_gate_checks: [
      { check_id: 201, name: 'verify', conclusion: 'success', target_sha: SHA },
      { check_id: 202, name: 'reconcile', conclusion: 'success', target_sha: SHA },
    ],
  };
  return {
    schema_version: 'agent-skill-chain/bootstrap-ledger/v1',
    state: 'prepared',
    key: {
      repository: 'techbeansjp-free/AGENTS.md',
      pr_number: 274,
      target_sha: SHA,
      review_digest: bootstrapEvidenceDigest(evidence),
    },
    ...evidence,
  };
}

const KEY: BootstrapKey = prepared().key;

function comment(id: number, record: ReturnType<typeof prepared>): BootstrapLedgerEntry {
  return { id, body: renderBootstrapLedgerRecord(record), source: 'pr_review', commit_id: SHA };
}

test('Given 固定#274証跡 When preparedをcanonical化 Then Sol/xhigh二重reviewとCIを復元する', () => {
  const record = prepared();
  const body = renderBootstrapLedgerRecord(record);
  assert.deepEqual(parseBootstrapLedgerRecord(body), record);
  assert.deepEqual(resolveBootstrapLedgerState([comment(301, record)], KEY), {
    prepared: { review_id: 301, record },
  });
  assert.throws(() => parseBootstrapLedgerRecord(`${body}\n`), /canonical形式/);
});

test('Given prepared When merge後completedを記録 Then exact prepared IDへ結線し再開状態を復元する', () => {
  const preparedRecord = prepared();
  const completed = buildBootstrapCompletedRecord({
    key: KEY,
    preparedReviewId: 301,
    mergeCommitSha: 'f'.repeat(40),
    mergedAt: '2026-07-26T00:00:00.000Z',
  });
  assert.deepEqual(
    resolveBootstrapLedgerState([
      comment(301, preparedRecord),
      { id: 302, body: renderBootstrapLedgerRecord(completed), source: 'issue_comment' },
    ], KEY),
    {
      prepared: { review_id: 301, record: preparedRecord },
      completed: { review_id: 302, record: completed },
    },
  );
});

test('Given 別SHA・別PR・重複・孤児completed When resolve Then 二回目bootstrapを拒否する', () => {
  const preparedRecord = prepared();
  const otherKey = { ...KEY, target_sha: '9'.repeat(40) };
  assert.throws(
    () => resolveBootstrapLedgerState([comment(301, preparedRecord)], otherKey),
    /別key/,
  );
  assert.throws(
    () => renderBootstrapLedgerRecord({
      ...preparedRecord,
      key: { ...KEY, pr_number: 275 },
    }),
    /PR #274/,
  );
  assert.throws(
    () => resolveBootstrapLedgerState([comment(301, preparedRecord), comment(302, preparedRecord)], KEY),
    /重複/,
  );
  const completed = buildBootstrapCompletedRecord({
    key: KEY,
    preparedReviewId: 301,
    mergeCommitSha: 'f'.repeat(40),
    mergedAt: '2026-07-26T00:00:00.000Z',
  });
  assert.throws(
    () => resolveBootstrapLedgerState([
      { id: 302, body: renderBootstrapLedgerRecord(completed), source: 'issue_comment' },
    ], KEY),
    /exact prepared/,
  );
  assert.throws(
    () => resolveBootstrapLedgerState([
      comment(301, preparedRecord),
      { id: 302, body: renderBootstrapLedgerRecord(completed), source: 'pr_review', commit_id: SHA },
    ], KEY),
    /record source/,
  );
});

test('Given 不正review/CI/marker When parse Then fail-closedで拒否する', () => {
  const record = prepared();
  assert.throws(
    () => renderBootstrapLedgerRecord({
      ...record,
      independent_reviews: [
        record.independent_reviews[0],
        { ...record.independent_reviews[0] },
      ],
    }),
    /相互に一意/,
  );
  assert.throws(
    () => renderBootstrapLedgerRecord({
      ...record,
      non_gate_checks: [{ ...record.non_gate_checks[0], conclusion: 'failure' as 'success' }],
    }),
    /success証跡/,
  );
  assert.throws(
    () => parseBootstrapLedgerRecord(
      `prefix\n${renderBootstrapLedgerRecord(record)}`,
    ),
    /本文先頭/,
  );
});
