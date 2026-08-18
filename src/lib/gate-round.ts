import { gh } from './exec.js';
import {
  validateGithubReviewEvidenceAttempt,
  validateGithubReviewEvidenceRecord,
  type GithubReviewRecord,
  type ReviewEvidence,
  type ValidatedGithubReviewEvidence,
} from './review-evidence.js';

export const DEFAULT_GATE_ROUND_LIMIT = {
  narrowing_threshold: 2,
  cutoff_threshold: 4,
} as const;

export const GATE_ROUND_FINDING_SUMMARY_LIMIT = 600;
export const GATE_ROUND_HISTORY_SECTION_LIMIT = 24_000;

export interface GateRoundLimit {
  narrowing_threshold: number;
  cutoff_threshold: number;
}

export interface GateRoundFinding {
  severity: 'blocking' | 'warning' | 'info';
  origin: 'specification' | 'design' | 'implementation' | 'validation';
  code: string;
  evidence_summary: string;
}

export interface GateRoundSlot {
  slot: 1 | 2;
  conformance: 'pass' | 'fail' | 'pending';
  falsification: 'pass' | 'fail' | 'pending';
  inconclusive: boolean;
  findings: GateRoundFinding[];
}

export interface GateRoundRecord {
  round: number;
  attempt_id: string;
  target_sha: string;
  slots: GateRoundSlot[];
}

export type GateRoundContext =
  | { status: 'available'; round: number; history: GateRoundRecord[]; diagnostics?: string[] }
  | { status: 'unavailable'; reason: string };

function parseGhList<T>(stdout: string): T[] {
  const parsed = JSON.parse(stdout) as T[] | T[][];
  return Array.isArray(parsed[0]) ? (parsed as T[][]).flat() : (parsed as T[]);
}

export function summarizeFindingEvidence(evidence: string[]): string {
  const summary = evidence.join(' / ');
  if (summary.trim().length === 0) return '（根拠要約を生成できません: evidence が空です）';
  if (summary.length <= GATE_ROUND_FINDING_SUMMARY_LIMIT) return summary;
  const marker = '…（600文字上限により切り詰め）';
  return summary.slice(0, GATE_ROUND_FINDING_SUMMARY_LIMIT - marker.length) + marker;
}

export function validateGateRoundLimit(limit: GateRoundLimit): string | undefined {
  if (!Number.isInteger(limit.narrowing_threshold) || limit.narrowing_threshold < 1) {
    return 'review.round_limit.narrowing_threshold は1以上の整数である必要があります';
  }
  if (!Number.isInteger(limit.cutoff_threshold) || limit.cutoff_threshold < 2) {
    return 'review.round_limit.cutoff_threshold は2以上の整数である必要があります';
  }
  if (limit.narrowing_threshold >= limit.cutoff_threshold) {
    return 'review.round_limit.narrowing_threshold は cutoff_threshold より真に小さい必要があります';
  }
  return undefined;
}

export function resolveGateRoundLimit(limit?: GateRoundLimit): GateRoundLimit {
  return limit ?? { ...DEFAULT_GATE_ROUND_LIMIT };
}

export function deriveGateRoundContext(options: {
  reviews: GithubReviewRecord[];
  issueId: string;
  gate: ReviewEvidence['gate'];
  currentAttemptId: string;
  trustedActors: string[];
  verifyAttempt: (attempt: ValidatedGithubReviewEvidence[], priorHistory: GateRoundRecord[]) => boolean;
}): GateRoundContext {
  if (options.trustedActors.length === 0) {
    return { status: 'unavailable', reason: 'trusted recorder actor が登録されていません' };
  }
  const trustedActors = new Set(options.trustedActors);
  const diagnostics: string[] = [];
  const candidates = options.reviews.flatMap((review) => {
    if (!review.body.includes('<!-- agent-skill-chain:gate-review-evidence -->')) return [];
    const validation = validateGithubReviewEvidenceRecord(review, {
      issueId: options.issueId,
      gate: options.gate,
      trustedActors: [...trustedActors],
      findingValidation: 'historical_v3',
    });
    if (!validation.valid) {
      diagnostics.push(`ラウンド計数から除外: ${validation.reason}`);
      return [];
    }
    if (validation.value.evidence.attempt_id === options.currentAttemptId) return [];
    return [validation.value];
  });

  const grouped = new Map<string, ValidatedGithubReviewEvidence[]>();
  for (const candidate of candidates.sort((left, right) => left.reviewId - right.reviewId)) {
    const existing = grouped.get(candidate.evidence.attempt_id) ?? [];
    existing.push(candidate);
    grouped.set(candidate.evidence.attempt_id, existing);
  }

  const verifiedAttempts = [...grouped.entries()]
    .flatMap(([attemptId, attempt]) => {
      const validation = validateGithubReviewEvidenceAttempt(attempt);
      if (!validation.valid) {
        diagnostics.push(`attempt ${attemptId} をラウンド計数から除外: ${validation.reason}`);
        return [];
      }
      return [{
        attemptId,
        firstReviewId: Math.min(...validation.values.map((entry) => entry.reviewId)),
        targetSha: validation.values[0].evidence.target_sha,
        slots: validation.values.map(({ evidence }) => ({
          slot: evidence.reviewer.slot,
          conformance: evidence.verdict.conformance,
          falsification: evidence.verdict.falsification,
          inconclusive: evidence.verdict.inconclusive,
          findings: evidence.verdict.blockers.map((finding) => ({
            severity: finding.severity,
            origin: finding.origin,
            code: finding.code,
            evidence_summary: summarizeFindingEvidence(finding.evidence),
          })),
        })),
      }];
    })
    .sort((left, right) => left.firstReviewId - right.firstReviewId);
  const history: GateRoundRecord[] = [];
  for (const record of verifiedAttempts) {
    const attempt = grouped.get(record.attemptId) ?? [];
    if (!options.verifyAttempt(attempt, history)) {
      diagnostics.push(`attempt ${record.attemptId} をラウンド計数から除外: trusted verifierの検証に失敗しました`);
      continue;
    }
    history.push({
      round: history.length,
      attempt_id: record.attemptId,
      target_sha: record.targetSha,
      slots: record.slots,
    });
  }
  return {
    status: 'available',
    round: history.length,
    history,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export function fetchGateRoundContext(options: {
  root: string;
  backend: 'github' | 'local';
  prNumber?: string;
  issueId: string;
  gate: ReviewEvidence['gate'];
  currentAttemptId?: string;
  trustedActors: string[];
  verifyAttempt: (attempt: ValidatedGithubReviewEvidence[], priorHistory: GateRoundRecord[]) => boolean;
  fetchReviews?: () => { status: number; stdout: string };
}): GateRoundContext {
  if (options.backend !== 'github') {
    return { status: 'unavailable', reason: 'ローカルモードでは耐久 review evidence を参照できません' };
  }
  if (!options.prNumber) return { status: 'unavailable', reason: 'PR番号が指定されていません' };
  if (!options.currentAttemptId) return { status: 'unavailable', reason: '当該反復の attempt_id が指定されていません' };
  if (options.trustedActors.length === 0) {
    return { status: 'unavailable', reason: 'trusted recorder actor が登録されていません' };
  }
  const response = options.fetchReviews?.() ?? gh(
      ['api', `repos/{owner}/{repo}/pulls/${options.prNumber}/reviews?per_page=100`, '--paginate', '--slurp'],
      options.root,
    );
  if (response.status !== 0) {
    return { status: 'unavailable', reason: 'PR review evidence の取得に失敗しました' };
  }
  try {
    return deriveGateRoundContext({
      reviews: parseGhList<GithubReviewRecord>(response.stdout),
      issueId: options.issueId,
      gate: options.gate,
      currentAttemptId: options.currentAttemptId,
      trustedActors: options.trustedActors,
      verifyAttempt: options.verifyAttempt,
    });
  } catch {
    return { status: 'unavailable', reason: 'PR review evidence の応答を解釈できませんでした' };
  }
}

export function latestGateAttemptId(options: {
  reviews: GithubReviewRecord[];
  issueId: string;
  gate: ReviewEvidence['gate'];
  targetSha: string;
  trustedActors: string[];
}): string | undefined {
  return options.reviews
    .flatMap((review) => {
      const validation = validateGithubReviewEvidenceRecord(review, {
        issueId: options.issueId,
        gate: options.gate,
        trustedActors: options.trustedActors,
      });
      return validation.valid && validation.value.evidence.target_sha === options.targetSha
        ? [{ id: validation.value.reviewId, attemptId: validation.value.evidence.attempt_id }]
        : [];
    })
    .sort((left, right) => right.id - left.id)[0]?.attemptId;
}

function renderRound(record: GateRoundRecord): string {
  const lines = [
    `### ラウンド ${record.round}`,
    `- attempt_id: ${JSON.stringify(record.attempt_id)}`,
    `- target_sha: ${JSON.stringify(record.target_sha)}`,
  ];
  for (const slot of record.slots) {
    lines.push(
      `- slot ${slot.slot}: conformance=${slot.conformance}, falsification=${slot.falsification}, inconclusive=${slot.inconclusive}`,
    );
    for (const finding of slot.findings) {
      lines.push(
        `  - finding: severity=${finding.severity}, origin=${finding.origin}, code=${JSON.stringify(finding.code)}`,
        `    - 根拠要約: ${JSON.stringify(finding.evidence_summary)}`,
      );
    }
  }
  return lines.join('\n');
}

export function renderGateRoundHistory(history: GateRoundRecord[]): string {
  const rendered = history.map((record) => ({ round: record.round, text: renderRound(record) }));
  const included: typeof rendered = [];
  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    const candidate = [rendered[index], ...included];
    const omitted = rendered.slice(0, index).map((entry) => entry.round);
    const prefix = omitted.length > 0
      ? `（分量上限により古いラウンド ${omitted.join(', ')} を省略）\n`
      : '';
    // 見出し・現在ラウンド番号・蒸し返し禁止指示の分を確保し、節全体を上限内に収める。
    if ((prefix + candidate.map((entry) => entry.text).join('\n\n')).length <= GATE_ROUND_HISTORY_SECTION_LIMIT - 1_000) {
      included.unshift(rendered[index]);
    } else {
      break;
    }
  }
  const omitted = rendered.slice(0, rendered.length - included.length).map((entry) => entry.round);
  const prefix = omitted.length > 0
    ? `（分量上限により古いラウンド ${omitted.join(', ')} を省略）`
    : '';
  return [prefix, ...included.map((entry) => entry.text)].filter(Boolean).join('\n\n');
}
