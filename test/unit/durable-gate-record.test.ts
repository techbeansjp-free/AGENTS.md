import assert from 'node:assert/strict';
import test from 'node:test';
import { digestOf } from '../../src/lib/digest.js';
import {
  buildDurableGateCheckOutput,
  collectDurableReportChunks,
  materializeDurableGateOutput,
  parseDurableGateCheckOutput,
  renderDurableReportComments,
} from '../../src/lib/durable-gate-record.js';
import {
  buildReportStorage,
  INLINE_REPORT_MAX_BYTES,
  type GateAttestationEnvelope,
  type ReportStorage,
} from '../../src/lib/gate-provenance.js';
import { canonicalJson } from '../../src/lib/review-evidence.js';

const SHA = 'a'.repeat(40);
const EVIDENCE_DIGEST = `sha256:${'b'.repeat(64)}`;

function attestation(storage: ReportStorage): GateAttestationEnvelope {
  return {
    schema_version: 'agent-skill-chain/gate-attestation/v1',
    repository: { id: 77, full_name: 'test/repo' },
    pr_number: 284,
    target_sha: SHA,
    gate: 'implementation',
    review_attempt: {
      attempt_id: 'attempt-current',
      expected_count: 2,
      evidence_digest: EVIDENCE_DIGEST,
    },
    workflow: {
      path: '.github/workflows/agent-skill-chain-trusted-gate.yml',
      ref: 'refs/heads/main',
      sha: SHA,
      run_id: 9001,
      run_number: 42,
      run_attempt: 1,
    },
    check: { id: 501, name: 'agent-skill-chain/implementation-gate', app_id: 12345 },
    report_digest: storage.report_digest,
    storage_manifest_digest: digestOf(canonicalJson(storage)),
  };
}

function expected(storage: ReportStorage) {
  return {
    repositoryId: 77,
    repository: 'test/repo',
    prNumber: 284,
    targetSha: SHA,
    gate: 'implementation' as const,
    checkId: 501,
    checkName: 'agent-skill-chain/implementation-gate',
    appId: 12345,
    workflowPath: '.github/workflows/agent-skill-chain-trusted-gate.yml',
    workflowSha: SHA,
    runId: 9001,
    runNumber: 42,
    runAttempt: 1,
    reportDigest: storage.report_digest,
    storageManifestDigest: digestOf(canonicalJson(storage)),
    reviewAttemptId: 'attempt-current',
    reviewerExpectedCount: 2,
    evidenceDigest: EVIDENCE_DIGEST,
  };
}

test('inline v2 outputをcanonical保存しattestation bindingから復元する', () => {
  const report = { gate: { final: 'approved' } };
  const storage = buildReportStorage(report);
  const envelope = attestation(storage.manifest);
  const output = buildDurableGateCheckOutput({
    report,
    storage: storage.manifest,
    chunks: storage.chunks,
    attestation: envelope,
  });
  const encoded = canonicalJson(output);
  assert.deepEqual(parseDurableGateCheckOutput(encoded), output);
  assert.deepEqual(
    materializeDurableGateOutput({ output, commentBodies: [], expected: expected(storage.manifest) }),
    report,
  );
  assert.throws(() => parseDurableGateCheckOutput(`${encoded}\n`), /canonical形式/);
});

test('inline reportは別Checkのchunkを無視し同一Checkの余分なchunkを拒否する', () => {
  const report = { gate: { final: 'approved' } };
  const storage = buildReportStorage(report);
  const envelope = attestation(storage.manifest);
  const unrelatedStorage = buildReportStorage({
    gate: { details: 'x'.repeat(INLINE_REPORT_MAX_BYTES + 1) },
  });
  const unrelatedEnvelope = {
    ...attestation(unrelatedStorage.manifest),
    check: { ...envelope.check, id: envelope.check.id + 1 },
  };
  const unrelatedComments = renderDurableReportComments({
    checkId: unrelatedEnvelope.check.id,
    attestation: unrelatedEnvelope,
    chunks: unrelatedStorage.chunks,
  });
  assert.deepEqual(
    collectDurableReportChunks({
      commentBodies: unrelatedComments,
      checkId: envelope.check.id,
      attestation: envelope,
      storage: storage.manifest,
    }),
    [],
  );
  const replayed = renderDurableReportComments({
    checkId: envelope.check.id,
    attestation: envelope,
    chunks: unrelatedStorage.chunks,
  });
  assert.throws(
    () => collectDurableReportChunks({
      commentBodies: replayed,
      checkId: envelope.check.id,
      attestation: envelope,
      storage: storage.manifest,
    }),
    /inline report/,
  );
});

test('48KiB超reportをCheck manifestとCheck/envelope固定commentから復元する', () => {
  const report = { gate: { details: 'x'.repeat(INLINE_REPORT_MAX_BYTES + 50_000) } };
  const storage = buildReportStorage(report);
  const envelope = attestation(storage.manifest);
  const output = buildDurableGateCheckOutput({
    report,
    storage: storage.manifest,
    chunks: storage.chunks,
    attestation: envelope,
  });
  const comments = renderDurableReportComments({
    checkId: envelope.check.id,
    attestation: envelope,
    chunks: storage.chunks,
  });
  assert.deepEqual(
    materializeDurableGateOutput({ output, commentBodies: comments, expected: expected(storage.manifest) }),
    report,
  );
  assert.throws(
    () => collectDurableReportChunks({
      commentBodies: comments.slice(1),
      checkId: envelope.check.id,
      attestation: envelope,
      storage: storage.manifest,
    }),
    /件数/,
  );
  assert.throws(
    () => collectDurableReportChunks({
      commentBodies: [comments[0], comments[0], ...comments.slice(1)],
      checkId: envelope.check.id,
      attestation: envelope,
      storage: storage.manifest,
    }),
    /件数/,
  );
});

test('別Check replay、manifest改変、曖昧chunk commentをfail-closed拒否する', () => {
  const report = { gate: { details: 'x'.repeat(INLINE_REPORT_MAX_BYTES + 1) } };
  const storage = buildReportStorage(report);
  const envelope = attestation(storage.manifest);
  const output = buildDurableGateCheckOutput({
    report,
    storage: storage.manifest,
    chunks: storage.chunks,
    attestation: envelope,
  });
  const comments = renderDurableReportComments({
    checkId: envelope.check.id,
    attestation: envelope,
    chunks: storage.chunks,
  });
  assert.throws(
    () => materializeDurableGateOutput({
      output,
      commentBodies: comments,
      expected: { ...expected(storage.manifest), checkId: 502 },
    }),
    /期待context/,
  );
  assert.throws(
    () => buildDurableGateCheckOutput({
      report,
      storage: { ...storage.manifest, report_bytes: storage.manifest.report_bytes + 1 },
      chunks: storage.chunks,
      attestation: envelope,
    }),
    /size|manifest/,
  );
  assert.throws(
    () => collectDurableReportChunks({
      commentBodies: [`${comments[0]}\nignored`, ...comments.slice(1)],
      checkId: envelope.check.id,
      attestation: envelope,
      storage: storage.manifest,
    }),
    /形式/,
  );
});
