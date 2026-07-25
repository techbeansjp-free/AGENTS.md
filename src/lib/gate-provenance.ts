import { digestOf } from './digest.js';
import { canonicalJson } from './review-evidence.js';

export const INLINE_REPORT_MAX_BYTES = 48 * 1024;
export const REPORT_CHUNK_BYTES = 45_000;
export const REPORT_MAX_BYTES = 4 * 1024 * 1024;
export const REPORT_CHUNK_MARKER = '<!-- agent-skill-chain:gate-report-chunk/v1 -->';

export type GateId = 'spec' | 'design' | 'implementation' | 'validation';

export interface WorkflowAttemptRef {
  runId: number;
  runNumber: number;
  runAttempt: number;
  workflowPath: string;
  event: 'repository_dispatch' | 'pull_request_target';
  status: string;
  conclusion: string | null;
}

export interface GateCheckExternalId {
  workflowRunId: number;
  runNumber: number;
  runAttempt: number;
  prNumber: number;
  gate: GateId;
  targetSha: string;
}

export interface ReportChunkDescriptor {
  index: number;
  bytes: number;
  digest: string;
}

export interface ReportStorage {
  schema_version: 'agent-skill-chain/gate-report-storage/v1';
  encoding: 'canonical-json';
  storage: 'inline' | 'pr-comment-chunks';
  report_bytes: number;
  report_digest: string;
  inline_report?: unknown;
  chunks?: ReportChunkDescriptor[];
}

export interface ReportChunk {
  descriptor: ReportChunkDescriptor;
  body: string;
}

export interface GateAttestationEnvelope {
  schema_version: 'agent-skill-chain/gate-attestation/v1';
  repository: { id: number; full_name: string };
  pr_number: number;
  target_sha: string;
  gate: GateId;
  review_attempt: { attempt_id: string; expected_count: number; evidence_digest: string };
  workflow: {
    path: string;
    ref: 'refs/heads/main';
    sha: string;
    run_id: number;
    run_number: number;
    run_attempt: number;
  };
  check: { id: number; name: string; app_id: number };
  report_digest: string;
  storage_manifest_digest: string;
}

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} は正の安全な整数である必要があります`);
}

function sha256(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error(`${label} はsha256 digestである必要があります`);
}

function targetSha(value: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error('target SHAは40桁の小文字hexである必要があります');
}

export function compareWorkflowAttempts(left: WorkflowAttemptRef, right: WorkflowAttemptRef): number {
  return left.runNumber === right.runNumber
    ? left.runAttempt - right.runAttempt
    : left.runNumber - right.runNumber;
}

/**
 * API配列順、Check ID、completed_atへ依存せず、GitHub Actionsが採番するrun tupleで最新を選ぶ。
 * status/conclusionの検証は選択後に呼出側が行い、古いsuccessへfallbackしない。
 */
export function selectLatestWorkflowAttempt(attempts: WorkflowAttemptRef[]): WorkflowAttemptRef {
  if (attempts.length === 0) throw new Error('対象workflow attemptがありません');
  for (const attempt of attempts) {
    positiveSafeInteger(attempt.runId, 'workflow run ID');
    positiveSafeInteger(attempt.runNumber, 'workflow run number');
    positiveSafeInteger(attempt.runAttempt, 'workflow run attempt');
  }
  return attempts.reduce((latest, candidate) =>
    compareWorkflowAttempts(candidate, latest) > 0 ? candidate : latest,
  );
}

export function encodeGateCheckExternalId(value: GateCheckExternalId): string {
  positiveSafeInteger(value.workflowRunId, 'workflow run ID');
  positiveSafeInteger(value.runNumber, 'workflow run number');
  positiveSafeInteger(value.runAttempt, 'workflow run attempt');
  positiveSafeInteger(value.prNumber, 'PR number');
  targetSha(value.targetSha);
  const encoded = [
    'asc-gate-v1',
    value.workflowRunId,
    value.runNumber,
    value.runAttempt,
    value.prNumber,
    value.gate,
    value.targetSha,
  ].join(':');
  if (encoded.length > 255) throw new Error('Check external IDがGitHub上限を超えています');
  return encoded;
}

export function decodeGateCheckExternalId(value: string): GateCheckExternalId {
  const [schema, runId, runNumber, runAttempt, prNumber, gate, sha, ...extra] = value.split(':');
  if (schema !== 'asc-gate-v1' || extra.length > 0 || !['spec', 'design', 'implementation', 'validation'].includes(gate)) {
    throw new Error('Check external ID形式が不正です');
  }
  const decoded: GateCheckExternalId = {
    workflowRunId: Number(runId),
    runNumber: Number(runNumber),
    runAttempt: Number(runAttempt),
    prNumber: Number(prNumber),
    gate: gate as GateId,
    targetSha: sha,
  };
  encodeGateCheckExternalId(decoded);
  return decoded;
}

export function buildReportStorage(report: unknown): { manifest: ReportStorage; chunks: ReportChunk[] } {
  const canonical = canonicalJson(report);
  const bytes = Buffer.from(canonical);
  if (bytes.length > REPORT_MAX_BYTES) throw new Error(`gate-reportが${REPORT_MAX_BYTES} bytesを超えています`);
  const common = {
    schema_version: 'agent-skill-chain/gate-report-storage/v1' as const,
    encoding: 'canonical-json' as const,
    report_bytes: bytes.length,
    report_digest: digestOf(bytes),
  };
  if (bytes.length <= INLINE_REPORT_MAX_BYTES) {
    return { manifest: { ...common, storage: 'inline', inline_report: report }, chunks: [] };
  }
  const chunks: ReportChunk[] = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += REPORT_CHUNK_BYTES, index += 1) {
    const value = bytes.subarray(offset, Math.min(offset + REPORT_CHUNK_BYTES, bytes.length));
    const descriptor = { index, bytes: value.length, digest: digestOf(value) };
    chunks.push({ descriptor, body: value.toString('base64') });
  }
  return {
    manifest: { ...common, storage: 'pr-comment-chunks', chunks: chunks.map((chunk) => chunk.descriptor) },
    chunks,
  };
}

export function renderReportChunk(checkId: number, envelopeDigest: string, chunk: ReportChunk): string {
  positiveSafeInteger(checkId, 'Check ID');
  sha256(envelopeDigest, 'attestation envelope digest');
  return [
    REPORT_CHUNK_MARKER,
    `check_id: ${checkId}`,
    `envelope_digest: ${envelopeDigest}`,
    `index: ${chunk.descriptor.index}`,
    `bytes: ${chunk.descriptor.bytes}`,
    `digest: ${chunk.descriptor.digest}`,
    '```base64',
    chunk.body,
    '```',
  ].join('\n');
}

export function parseReportChunk(body: string): { checkId: number; envelopeDigest: string; chunk: ReportChunk } {
  if (!body.startsWith(REPORT_CHUNK_MARKER)) throw new Error('report chunk markerがありません');
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}: (.+)$`, 'm').exec(body)?.[1];
  const encoded = /```base64\n([A-Za-z0-9+/=]+)\n```/.exec(body)?.[1];
  if (!encoded) throw new Error('report chunk bodyがありません');
  const value = Buffer.from(encoded, 'base64');
  const checkId = Number(field('check_id'));
  const envelopeDigest = field('envelope_digest') ?? '';
  const descriptor = {
    index: Number(field('index')),
    bytes: Number(field('bytes')),
    digest: field('digest') ?? '',
  };
  positiveSafeInteger(checkId, 'Check ID');
  sha256(envelopeDigest, 'attestation envelope digest');
  if (!Number.isSafeInteger(descriptor.index) || descriptor.index < 0) throw new Error('chunk indexが不正です');
  if (descriptor.bytes !== value.length || descriptor.bytes > REPORT_CHUNK_BYTES) {
    throw new Error('chunk byte数が不正です');
  }
  if (digestOf(value) !== descriptor.digest) throw new Error('chunk digestが一致しません');
  return { checkId, envelopeDigest, chunk: { descriptor, body: encoded } };
}

export function materializeReport(manifest: ReportStorage, chunks: ReportChunk[]): unknown {
  sha256(manifest.report_digest, 'report digest');
  if (!Number.isSafeInteger(manifest.report_bytes) || manifest.report_bytes < 0 || manifest.report_bytes > REPORT_MAX_BYTES) {
    throw new Error('report byte数が不正です');
  }
  if (manifest.storage === 'inline') {
    if (manifest.chunks || manifest.inline_report === undefined) throw new Error('inline manifestが不正です');
    const canonical = canonicalJson(manifest.inline_report);
    if (Buffer.byteLength(canonical) !== manifest.report_bytes || digestOf(canonical) !== manifest.report_digest) {
      throw new Error('inline reportのsizeまたはdigestが一致しません');
    }
    return manifest.inline_report;
  }
  if (manifest.inline_report !== undefined || !manifest.chunks || manifest.chunks.length !== chunks.length) {
    throw new Error('chunk manifestまたはchunk件数が不正です');
  }
  const byIndex = new Map(chunks.map((chunk) => [chunk.descriptor.index, chunk]));
  if (byIndex.size !== chunks.length) throw new Error('chunk indexが重複しています');
  const buffers = manifest.chunks.map((descriptor, expectedIndex) => {
    if (descriptor.index !== expectedIndex) throw new Error('manifest chunk順が不正です');
    const chunk = byIndex.get(expectedIndex);
    if (
      !chunk ||
      chunk.descriptor.bytes !== descriptor.bytes ||
      chunk.descriptor.digest !== descriptor.digest
    ) {
      throw new Error(`chunk ${expectedIndex} がmanifestと一致しません`);
    }
    const value = Buffer.from(chunk.body, 'base64');
    if (value.length !== descriptor.bytes || digestOf(value) !== descriptor.digest) {
      throw new Error(`chunk ${expectedIndex} の内容が不正です`);
    }
    return value;
  });
  const canonical = Buffer.concat(buffers).toString('utf8');
  if (Buffer.byteLength(canonical) !== manifest.report_bytes || digestOf(canonical) !== manifest.report_digest) {
    throw new Error('再構成reportのsizeまたはdigestが一致しません');
  }
  const report = JSON.parse(canonical) as unknown;
  if (canonicalJson(report) !== canonical) throw new Error('再構成reportがcanonical JSONではありません');
  return report;
}

export function validateGateAttestationEnvelope(
  envelope: GateAttestationEnvelope,
  expected: {
    repositoryId: number;
    repository: string;
    prNumber: number;
    targetSha: string;
    gate: GateId;
    checkId: number;
    checkName: string;
    appId: number;
    workflowPath: string;
    workflowSha: string;
    runId: number;
    runNumber: number;
    runAttempt: number;
    reportDigest: string;
    storageManifestDigest: string;
  },
): void {
  if (envelope.schema_version !== 'agent-skill-chain/gate-attestation/v1') throw new Error('attestation schemaが不正です');
  targetSha(envelope.target_sha);
  sha256(envelope.report_digest, 'report digest');
  sha256(envelope.storage_manifest_digest, 'storage manifest digest');
  const actual = canonicalJson({
    repositoryId: envelope.repository.id,
    repository: envelope.repository.full_name,
    prNumber: envelope.pr_number,
    targetSha: envelope.target_sha,
    gate: envelope.gate,
    checkId: envelope.check.id,
    checkName: envelope.check.name,
    appId: envelope.check.app_id,
    workflowPath: envelope.workflow.path,
    workflowSha: envelope.workflow.sha,
    runId: envelope.workflow.run_id,
    runNumber: envelope.workflow.run_number,
    runAttempt: envelope.workflow.run_attempt,
    reportDigest: envelope.report_digest,
    storageManifestDigest: envelope.storage_manifest_digest,
  });
  if (actual !== canonicalJson(expected)) throw new Error('attestation envelopeが期待contextと一致しません');
  if (envelope.workflow.ref !== 'refs/heads/main') throw new Error('attestation workflow refがmainではありません');
  if (!/^attempt-[A-Za-z0-9._-]+$/.test(envelope.review_attempt.attempt_id)) {
    throw new Error('attestation review attempt IDが不正です');
  }
  if (![1, 2].includes(envelope.review_attempt.expected_count)) {
    throw new Error('reviewer expected countは1または2である必要があります');
  }
  sha256(envelope.review_attempt.evidence_digest, 'review evidence digest');
}
