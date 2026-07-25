import { canonicalJson } from './review-evidence.js';

export const BOOTSTRAP_LEDGER_MARKER = '<!-- agent-skill-chain:bootstrap-ledger/v1 -->';

export interface BootstrapKey {
  repository: string;
  pr_number: number;
  target_sha: string;
  review_digest: string;
}

export interface BootstrapReviewEvidence {
  review_id: number;
  run_id: string;
  model: 'gpt-5.6-sol';
  reasoning: 'xhigh';
  verdict: 'pass';
  target_sha: string;
  evidence_digest: string;
}

export interface BootstrapCheckEvidence {
  check_id: number;
  name: string;
  conclusion: 'success';
  target_sha: string;
}

export interface BootstrapPreparedRecord {
  schema_version: 'agent-skill-chain/bootstrap-ledger/v1';
  state: 'prepared';
  key: BootstrapKey;
  owner_authorization: {
    review_id: number;
    actor: string;
    target_sha: string;
    evidence_digest: string;
  };
  independent_reviews: [BootstrapReviewEvidence, BootstrapReviewEvidence];
  non_gate_checks: BootstrapCheckEvidence[];
}

export interface BootstrapCompletedRecord {
  schema_version: 'agent-skill-chain/bootstrap-ledger/v1';
  state: 'completed';
  key: BootstrapKey;
  prepared_review_id: number;
  merge: {
    commit_sha: string;
    merged_at: string;
  };
}

export type BootstrapLedgerRecord = BootstrapPreparedRecord | BootstrapCompletedRecord;

export interface BootstrapReviewComment {
  id: number;
  body: string;
  commit_id: string;
}

export interface BootstrapLedgerState {
  prepared?: { review_id: number; record: BootstrapPreparedRecord };
  completed?: { review_id: number; record: BootstrapCompletedRecord };
}

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}の許可フィールドは${expected.join(',')}だけです`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}がobjectではありません`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}は正の安全な整数である必要があります`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${label}は40桁のlowercase SHAである必要があります`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label}はsha256 digestである必要があります`);
  }
  return value;
}

function actor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]+$/.test(value)) {
    throw new Error(`${label}はGitHub actor形式である必要があります`);
  }
  return value;
}

function validateKey(value: unknown): BootstrapKey {
  const key = object(value, 'bootstrap key');
  exactKeys(key, ['repository', 'pr_number', 'target_sha', 'review_digest'], 'bootstrap key');
  if (
    key.repository !== 'techbeansjp-free/AGENTS.md' ||
    positiveInteger(key.pr_number, 'bootstrap PR番号') !== 274
  ) {
    throw new Error('bootstrap keyはtechbeansjp-free/AGENTS.md PR #274だけを許可します');
  }
  sha(key.target_sha, 'bootstrap target SHA');
  digest(key.review_digest, 'bootstrap review digest');
  return key as unknown as BootstrapKey;
}

function validatePrepared(value: Record<string, unknown>): BootstrapPreparedRecord {
  exactKeys(
    value,
    ['schema_version', 'state', 'key', 'owner_authorization', 'independent_reviews', 'non_gate_checks'],
    'bootstrap prepared record',
  );
  const key = validateKey(value.key);
  const authorization = object(value.owner_authorization, 'owner authorization');
  exactKeys(authorization, ['review_id', 'actor', 'target_sha', 'evidence_digest'], 'owner authorization');
  positiveInteger(authorization.review_id, 'owner authorization review ID');
  actor(authorization.actor, 'owner authorization actor');
  if (sha(authorization.target_sha, 'owner authorization target SHA') !== key.target_sha) {
    throw new Error('owner authorizationがbootstrap target SHAと一致しません');
  }
  digest(authorization.evidence_digest, 'owner authorization evidence digest');

  if (!Array.isArray(value.independent_reviews) || value.independent_reviews.length !== 2) {
    throw new Error('bootstrapにはexactly twoの独立Sol/xhigh reviewが必要です');
  }
  const reviews = value.independent_reviews.map((entry, index) => {
    const review = object(entry, `independent review ${index + 1}`);
    exactKeys(
      review,
      ['review_id', 'run_id', 'model', 'reasoning', 'verdict', 'target_sha', 'evidence_digest'],
      `independent review ${index + 1}`,
    );
    positiveInteger(review.review_id, `independent review ${index + 1} ID`);
    if (
      typeof review.run_id !== 'string' ||
      !/^review-[A-Za-z0-9._-]+$/.test(review.run_id) ||
      review.model !== 'gpt-5.6-sol' ||
      review.reasoning !== 'xhigh' ||
      review.verdict !== 'pass'
    ) {
      throw new Error(`independent review ${index + 1}がSol/xhigh PASS契約と一致しません`);
    }
    if (sha(review.target_sha, `independent review ${index + 1} target SHA`) !== key.target_sha) {
      throw new Error(`independent review ${index + 1}がbootstrap target SHAと一致しません`);
    }
    digest(review.evidence_digest, `independent review ${index + 1} evidence digest`);
    return review;
  });
  if (
    new Set(reviews.map((review) => review.review_id)).size !== 2 ||
    new Set(reviews.map((review) => review.run_id)).size !== 2 ||
    new Set(reviews.map((review) => review.evidence_digest)).size !== 2
  ) {
    throw new Error('独立reviewのreview ID、run ID、evidence digestは相互に一意である必要があります');
  }

  if (!Array.isArray(value.non_gate_checks) || value.non_gate_checks.length === 0) {
    throw new Error('bootstrapの非gate CI証跡がありません');
  }
  const checks = value.non_gate_checks.map((entry, index) => {
    const check = object(entry, `non-gate check ${index + 1}`);
    exactKeys(check, ['check_id', 'name', 'conclusion', 'target_sha'], `non-gate check ${index + 1}`);
    positiveInteger(check.check_id, `non-gate check ${index + 1} ID`);
    if (typeof check.name !== 'string' || check.name.length === 0 || check.conclusion !== 'success') {
      throw new Error(`non-gate check ${index + 1}がsuccess証跡ではありません`);
    }
    if (sha(check.target_sha, `non-gate check ${index + 1} target SHA`) !== key.target_sha) {
      throw new Error(`non-gate check ${index + 1}がbootstrap target SHAと一致しません`);
    }
    return check;
  });
  if (
    new Set(checks.map((check) => check.check_id)).size !== checks.length ||
    new Set(checks.map((check) => check.name)).size !== checks.length
  ) {
    throw new Error('非gate CIのCheck IDとnameは一意である必要があります');
  }
  return value as unknown as BootstrapPreparedRecord;
}

function validateCompleted(value: Record<string, unknown>): BootstrapCompletedRecord {
  exactKeys(value, ['schema_version', 'state', 'key', 'prepared_review_id', 'merge'], 'bootstrap completed record');
  validateKey(value.key);
  positiveInteger(value.prepared_review_id, 'prepared review ID');
  const merge = object(value.merge, 'bootstrap merge');
  exactKeys(merge, ['commit_sha', 'merged_at'], 'bootstrap merge');
  sha(merge.commit_sha, 'bootstrap merge commit SHA');
  if (
    typeof merge.merged_at !== 'string' ||
    Number.isNaN(Date.parse(merge.merged_at)) ||
    new Date(merge.merged_at).toISOString() !== merge.merged_at
  ) {
    throw new Error('bootstrap merged_atはcanonical ISO timestampである必要があります');
  }
  return value as unknown as BootstrapCompletedRecord;
}

export function validateBootstrapLedgerRecord(value: unknown): BootstrapLedgerRecord {
  const record = object(value, 'bootstrap ledger record');
  if (record.schema_version !== 'agent-skill-chain/bootstrap-ledger/v1') {
    throw new Error('bootstrap ledger schemaが不正です');
  }
  if (record.state === 'prepared') return validatePrepared(record);
  if (record.state === 'completed') return validateCompleted(record);
  throw new Error('bootstrap ledger stateはprepared|completedだけです');
}

export function renderBootstrapLedgerRecord(record: BootstrapLedgerRecord): string {
  validateBootstrapLedgerRecord(record);
  return `${BOOTSTRAP_LEDGER_MARKER}\n${canonicalJson(record)}`;
}

export function parseBootstrapLedgerRecord(body: string): BootstrapLedgerRecord | undefined {
  if (!body.includes(BOOTSTRAP_LEDGER_MARKER)) return undefined;
  const prefix = `${BOOTSTRAP_LEDGER_MARKER}\n`;
  if (!body.startsWith(prefix)) throw new Error('bootstrap ledger markerが本文先頭にありません');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(prefix.length));
  } catch {
    throw new Error('bootstrap ledger JSONを解釈できません');
  }
  const record = validateBootstrapLedgerRecord(parsed);
  if (renderBootstrapLedgerRecord(record) !== body) {
    throw new Error('bootstrap ledger recordがcanonical形式ではありません');
  }
  return record;
}

export function resolveBootstrapLedgerState(
  comments: BootstrapReviewComment[],
  requestedKey: BootstrapKey,
): BootstrapLedgerState {
  validateKey(requestedKey);
  const records = comments.flatMap((comment) => {
    positiveInteger(comment.id, 'bootstrap PR Review ID');
    const record = parseBootstrapLedgerRecord(comment.body);
    if (!record) return [];
    if (comment.commit_id !== record.key.target_sha) {
      throw new Error('bootstrap PR Reviewのcommit_idがledger target SHAと一致しません');
    }
    if (canonicalJson(record.key) !== canonicalJson(requestedKey)) {
      throw new Error('別keyのbootstrap ledger recordが既に存在します');
    }
    return [{ review_id: comment.id, record }];
  });
  const prepared = records.filter(
    (entry): entry is { review_id: number; record: BootstrapPreparedRecord } =>
      entry.record.state === 'prepared',
  );
  const completed = records.filter(
    (entry): entry is { review_id: number; record: BootstrapCompletedRecord } =>
      entry.record.state === 'completed',
  );
  if (prepared.length > 1 || completed.length > 1) {
    throw new Error('bootstrap ledger stateが重複しています');
  }
  if (completed.length === 1) {
    if (prepared.length !== 1 || completed[0].record.prepared_review_id !== prepared[0].review_id) {
      throw new Error('completed recordがexact prepared PR Reviewへ結線されていません');
    }
  }
  return { ...(prepared[0] ? { prepared: prepared[0] } : {}), ...(completed[0] ? { completed: completed[0] } : {}) };
}

export function buildBootstrapCompletedRecord(options: {
  key: BootstrapKey;
  preparedReviewId: number;
  mergeCommitSha: string;
  mergedAt: string;
}): BootstrapCompletedRecord {
  const record: BootstrapCompletedRecord = {
    schema_version: 'agent-skill-chain/bootstrap-ledger/v1',
    state: 'completed',
    key: options.key,
    prepared_review_id: options.preparedReviewId,
    merge: {
      commit_sha: options.mergeCommitSha,
      merged_at: options.mergedAt,
    },
  };
  return validateBootstrapLedgerRecord(record) as BootstrapCompletedRecord;
}
