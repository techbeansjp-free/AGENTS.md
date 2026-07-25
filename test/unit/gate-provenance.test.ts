import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INLINE_REPORT_MAX_BYTES,
  REPORT_MAX_BYTES,
  artifactSetsEqual,
  buildReportStorage,
  decodeGateCheckExternalId,
  encodeGateCheckExternalId,
  materializeReport,
  parseReportChunk,
  renderReportChunk,
  selectLatestWorkflowAttempt,
  validateGateAttestationEnvelope,
  type GateAttestationEnvelope,
  type WorkflowAttemptRef,
} from '../../src/lib/gate-provenance.js';
import { digestOf } from '../../src/lib/digest.js';
import { canonicalJson } from '../../src/lib/review-evidence.js';

const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

function attempt(runNumber: number, runAttempt: number, status: string, conclusion: string | null): WorkflowAttemptRef {
  return {
    runId: runNumber * 100 + runAttempt,
    runNumber,
    runAttempt,
    workflowPath: '.github/workflows/agent-skill-chain-trusted-gate.yml',
    event: 'repository_dispatch',
    status,
    conclusion,
  };
}

test('latest attemptは配列順・時刻・conclusionでなくrun tuple最大を選ぶ', () => {
  const latest = selectLatestWorkflowAttempt([
    attempt(8, 1, 'completed', 'success'),
    attempt(9, 1, 'in_progress', null),
    attempt(8, 2, 'completed', 'failure'),
  ]);
  assert.equal(latest.runNumber, 9);
  assert.equal(latest.status, 'in_progress');
});

test('Check external IDはworkflow tuple・PR・gate・SHAを可逆に束縛する', () => {
  const value = {
    workflowRunId: 123456789,
    runNumber: 44,
    runAttempt: 2,
    prNumber: 284,
    gate: 'design' as const,
    targetSha: SHA,
  };
  const encoded = encodeGateCheckExternalId(value);
  assert.ok(encoded.length <= 255);
  assert.deepEqual(decodeGateCheckExternalId(encoded), value);
  assert.throws(() => decodeGateCheckExternalId(encoded.replace(':design:', ':unknown:')), /形式/);
});

test('48 KiB以下はinlineでdigest検証してmaterializeする', () => {
  const report = { gate: { id: 'spec', details: 'x'.repeat(INLINE_REPORT_MAX_BYTES - 200) } };
  const storage = buildReportStorage(report);
  assert.equal(storage.manifest.storage, 'inline');
  assert.deepEqual(materializeReport(storage.manifest, storage.chunks), report);
  assert.throws(
    () => materializeReport({ ...storage.manifest, encoding: 'canonical-json-v2' as 'canonical-json' }, []),
    /schema・encoding・storage/,
  );
  assert.throws(
    () => materializeReport({ ...storage.manifest, report_bytes: INLINE_REPORT_MAX_BYTES + 1 }, []),
    /inline reportが上限/,
  );
  assert.throws(() => materializeReport(storage.manifest, [{
    descriptor: { index: 0, bytes: 1, digest: digestOf('x') },
    body: Buffer.from('x').toString('base64'),
  }]), /不要なchunk/);
});

test('48 KiB超は順序付きchunkへ分割し、欠落・改変・重複を拒否する', () => {
  const report = { gate: { id: 'implementation', details: 'x'.repeat(INLINE_REPORT_MAX_BYTES + 50_000) } };
  const storage = buildReportStorage(report);
  assert.equal(storage.manifest.storage, 'pr-comment-chunks');
  assert.ok(storage.chunks.length >= 2);
  assert.deepEqual(materializeReport(storage.manifest, [...storage.chunks].reverse()), report);
  assert.throws(() => materializeReport(storage.manifest, storage.chunks.slice(1)), /件数/);
  assert.throws(
    () =>
      materializeReport(storage.manifest, [
        { ...storage.chunks[0], body: Buffer.from('tampered').toString('base64') },
        ...storage.chunks.slice(1),
      ]),
    /内容が不正/,
  );
  assert.throws(
    () => materializeReport(storage.manifest, [storage.chunks[0], storage.chunks[0], ...storage.chunks.slice(2)]),
    /重複/,
  );
  assert.throws(
    () => materializeReport(storage.manifest, [
      { ...storage.chunks[0], body: `${storage.chunks[0].body.slice(0, -1)}!` },
      ...storage.chunks.slice(1),
    ]),
    /canonical base64/,
  );
  assert.throws(
    () => materializeReport({ ...storage.manifest, report_bytes: INLINE_REPORT_MAX_BYTES }, storage.chunks),
    /chunk storage/,
  );
});

test('chunk commentはCheck ID・envelope digest・descriptorを検証する', () => {
  const storage = buildReportStorage({ details: 'x'.repeat(INLINE_REPORT_MAX_BYTES + 1) });
  const body = renderReportChunk(987, DIGEST, storage.chunks[0]);
  const parsed = parseReportChunk(body);
  assert.equal(parsed.checkId, 987);
  assert.equal(parsed.envelopeDigest, DIGEST);
  assert.deepEqual(parsed.chunk.descriptor, storage.chunks[0].descriptor);
  assert.throws(() => parseReportChunk(body.replace(storage.chunks[0].descriptor.digest, DIGEST)), /digest/);
  assert.throws(
    () => renderReportChunk(987, DIGEST, { ...storage.chunks[0], body: 'not-base64!' }),
    /canonical base64/,
  );
});

test('4 MiB超reportを作成前に拒否する', () => {
  assert.throws(() => buildReportStorage({ details: 'x'.repeat(REPORT_MAX_BYTES + 1) }), /超えています/);
});

test('attestation envelopeは別Check・別workflow runへのreplayを拒否する', () => {
  const manifest = buildReportStorage({ gate: { id: 'spec' } }).manifest;
  const expected = {
    repositoryId: 1,
    repository: 'techbeansjp-free/AGENTS.md',
    prNumber: 284,
    targetSha: SHA,
    gate: 'spec' as const,
    checkId: 987,
    checkName: 'agent-skill-chain/spec-gate',
    appId: 123,
    workflowPath: '.github/workflows/agent-skill-chain-trusted-gate.yml',
    workflowSha: SHA,
    runId: 2001,
    runNumber: 20,
    runAttempt: 1,
    reportDigest: manifest.report_digest,
    storageManifestDigest: digestOf(canonicalJson(manifest)),
    reviewAttemptId: 'attempt-1',
    reviewerExpectedCount: 1,
    evidenceDigest: DIGEST,
  };
  const envelope: GateAttestationEnvelope = {
    schema_version: 'agent-skill-chain/gate-attestation/v1',
    repository: { id: expected.repositoryId, full_name: expected.repository },
    pr_number: expected.prNumber,
    target_sha: expected.targetSha,
    gate: expected.gate,
    review_attempt: { attempt_id: 'attempt-1', expected_count: 1, evidence_digest: DIGEST },
    workflow: {
      path: expected.workflowPath,
      ref: 'refs/heads/main',
      sha: expected.workflowSha,
      run_id: expected.runId,
      run_number: expected.runNumber,
      run_attempt: expected.runAttempt,
    },
    check: { id: expected.checkId, name: expected.checkName, app_id: expected.appId },
    report_digest: expected.reportDigest,
    storage_manifest_digest: expected.storageManifestDigest,
  };
  assert.doesNotThrow(() => validateGateAttestationEnvelope(envelope, expected));
  assert.throws(() => validateGateAttestationEnvelope(envelope, { ...expected, checkId: 988 }), /期待context/);
  assert.throws(() => validateGateAttestationEnvelope(envelope, { ...expected, runAttempt: 2 }), /期待context/);
  assert.throws(
    () => validateGateAttestationEnvelope(
      { ...envelope, review_attempt: { ...envelope.review_attempt, attempt_id: 'attempt-replay' } },
      expected,
    ),
    /期待context/,
  );
});

test('artifact集合は順序に依存せず、追加・削除・重複・digest差異を変更とする', () => {
  const first = [
    { path: 'src/a.ts', digest: DIGEST },
    { path: 'src/b.ts', digest: `sha256:${'c'.repeat(64)}` },
  ];
  assert.equal(artifactSetsEqual(first, [...first].reverse()), true);
  assert.equal(artifactSetsEqual(first, first.slice(1)), false);
  assert.equal(artifactSetsEqual(first, [...first, { path: 'src/c.ts', digest: DIGEST }]), false);
  assert.equal(artifactSetsEqual(first, [{ ...first[0], digest: `sha256:${'d'.repeat(64)}` }, first[1]]), false);
  assert.equal(artifactSetsEqual(first, [first[0], first[0], first[1]]), false);
  assert.equal(artifactSetsEqual(first, [{ path: '../escape', digest: DIGEST }, first[1]]), false);
});
