export const INLINE_REPORT_MAX_BYTES = 48 * 1024;

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
}

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} は正の安全な整数である必要があります`);
  }
}

function targetSha(value: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error('target SHAは40桁の小文字hexである必要があります');
  }
}

export function compareWorkflowAttempts(left: WorkflowAttemptRef, right: WorkflowAttemptRef): number {
  return left.runNumber === right.runNumber
    ? left.runAttempt - right.runAttempt
    : left.runNumber - right.runNumber;
}

/** GitHub Actionsのrun tupleで最新を選び、古いsuccessへのfallbackを呼出側に許さない。 */
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
  if (
    schema !== 'asc-gate-v1' ||
    extra.length > 0 ||
    !['spec', 'design', 'implementation', 'validation'].includes(gate)
  ) {
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
