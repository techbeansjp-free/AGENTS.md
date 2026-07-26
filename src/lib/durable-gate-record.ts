import { digestOf } from './digest.js';
import {
  materializeReport,
  parseReportChunk,
  renderReportChunk,
  validateGateAttestationEnvelope,
  type GateAttestationEnvelope,
  type ReportChunk,
  type ReportStorage,
} from './gate-provenance.js';
import { canonicalJson } from './review-evidence.js';

export interface DurableGateCheckOutput {
  schema_version: 'agent-skill-chain/check-output/v2';
  storage: ReportStorage;
  attestation: GateAttestationEnvelope;
}

const MAX_CHECK_OUTPUT_BYTES = 65_535;

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}の許可フィールドは${expected.join(',')}だけです`);
  }
}

export function buildDurableGateCheckOutput(options: {
  report: unknown;
  storage: ReportStorage;
  chunks: ReportChunk[];
  attestation: GateAttestationEnvelope;
}): DurableGateCheckOutput {
  const materialized = materializeReport(options.storage, options.chunks);
  if (canonicalJson(materialized) !== canonicalJson(options.report)) {
    throw new Error('storageから復元したreportが入力reportと一致しません');
  }
  if (
    options.attestation.report_digest !== options.storage.report_digest ||
    options.attestation.storage_manifest_digest !== digestOf(canonicalJson(options.storage))
  ) {
    throw new Error('attestationのreport/storage digestがmanifestと一致しません');
  }
  const output: DurableGateCheckOutput = {
    schema_version: 'agent-skill-chain/check-output/v2',
    storage: options.storage,
    attestation: options.attestation,
  };
  if (Buffer.byteLength(canonicalJson(output), 'utf8') > MAX_CHECK_OUTPUT_BYTES) {
    throw new Error('durable Check outputがGitHub上限を超えています');
  }
  return output;
}

export function parseDurableGateCheckOutput(text: string): DurableGateCheckOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('durable Check outputを解釈できません');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('durable Check outputがobjectではありません');
  }
  exactKeys(parsed, ['schema_version', 'storage', 'attestation'], 'durable Check output');
  const output = parsed as DurableGateCheckOutput;
  if (
    output.schema_version !== 'agent-skill-chain/check-output/v2' ||
    canonicalJson(output) !== text ||
    Buffer.byteLength(text, 'utf8') > MAX_CHECK_OUTPUT_BYTES
  ) {
    throw new Error('durable Check outputがcheck-output/v2 canonical形式ではありません');
  }
  return output;
}

export function renderDurableReportComments(options: {
  checkId: number;
  attestation: GateAttestationEnvelope;
  chunks: ReportChunk[];
}): string[] {
  const envelopeDigest = digestOf(canonicalJson(options.attestation));
  return options.chunks.map((chunk) =>
    renderReportChunk(options.checkId, envelopeDigest, chunk),
  );
}

export function collectDurableReportChunks(options: {
  commentBodies: string[];
  checkId: number;
  attestation: GateAttestationEnvelope;
  storage: ReportStorage;
}): ReportChunk[] {
  const envelopeDigest = digestOf(canonicalJson(options.attestation));
  if (options.storage.storage === 'inline') {
    for (const body of options.commentBodies) {
      if (!body.includes('agent-skill-chain:gate-report-chunk/v1')) continue;
      const parsed = parseReportChunk(body);
      if (parsed.checkId === options.checkId && parsed.envelopeDigest === envelopeDigest) {
        throw new Error('inline reportに同一Check/envelopeのchunk commentが存在します');
      }
    }
    return [];
  }
  const matching: ReportChunk[] = [];
  for (const body of options.commentBodies) {
    if (!body.includes('agent-skill-chain:gate-report-chunk/v1')) continue;
    const parsed = parseReportChunk(body);
    if (parsed.checkId === options.checkId && parsed.envelopeDigest === envelopeDigest) {
      matching.push(parsed.chunk);
    }
  }
  const expectedCount = options.storage.chunks?.length ?? 0;
  if (matching.length !== expectedCount) {
    throw new Error(`durable report chunk件数が一致しません: expected=${expectedCount}, actual=${matching.length}`);
  }
  return matching;
}

export function materializeDurableGateOutput(options: {
  output: DurableGateCheckOutput;
  commentBodies: string[];
  expected: Parameters<typeof validateGateAttestationEnvelope>[1];
}): unknown {
  validateGateAttestationEnvelope(options.output.attestation, options.expected);
  if (
    options.output.storage.report_digest !== options.output.attestation.report_digest ||
    digestOf(canonicalJson(options.output.storage)) !== options.output.attestation.storage_manifest_digest
  ) {
    throw new Error('durable outputのreport/storage digest bindingが一致しません');
  }
  const chunks = collectDurableReportChunks({
    commentBodies: options.commentBodies,
    checkId: options.output.attestation.check.id,
    attestation: options.output.attestation,
    storage: options.output.storage,
  });
  return materializeReport(options.output.storage, chunks);
}
