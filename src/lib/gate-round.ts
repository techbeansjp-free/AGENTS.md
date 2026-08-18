import { gh } from './exec.js';
import {
  isEvidenceVerdict,
  parseReviewEvidence,
  REVIEW_EVIDENCE_MARKER,
  type GithubReviewRecord,
  type ReviewEvidence,
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
  | { status: 'available'; round: number; history: GateRoundRecord[] }
  | { status: 'unavailable'; reason: string };

function parseGhList<T>(stdout: string): T[] {
  const parsed = JSON.parse(stdout) as T[] | T[][];
  return Array.isArray(parsed[0]) ? (parsed as T[][]).flat() : (parsed as T[]);
}

function reviewId(review: GithubReviewRecord): number | undefined {
  const value = Number(review.id);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function evidenceFromReview(review: GithubReviewRecord): ReviewEvidence | undefined {
  if (!review.body.includes(REVIEW_EVIDENCE_MARKER)) return undefined;
  try {
    const evidence = parseReviewEvidence(review.body);
    if (
      evidence?.schema_version !== 'agent-skill-chain/gate-review-evidence/v3' ||
      !/^attempt-[A-Za-z0-9._-]+$/.test(evidence.attempt_id) ||
      ![1, 2].includes(evidence.reviewer?.slot) ||
      !isEvidenceVerdict(evidence.verdict)
    ) {
      return undefined;
    }
    return evidence;
  } catch {
    return undefined;
  }
}

function summarizeEvidence(evidence: string[]): string {
  const summary = evidence.join(' / ');
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
}): GateRoundContext {
  if (options.trustedActors.length === 0) {
    return { status: 'unavailable', reason: 'trusted recorder actor が登録されていません' };
  }
  const trustedActors = new Set(options.trustedActors);
  const candidates = options.reviews.flatMap((review) => {
    const id = reviewId(review);
    const evidence = evidenceFromReview(review);
    const actor = review.user?.login;
    if (
      id === undefined ||
      !evidence ||
      !actor ||
      !trustedActors.has(actor) ||
      evidence.issue_id !== options.issueId ||
      evidence.gate !== options.gate ||
      evidence.attempt_id === options.currentAttemptId
    ) {
      return [];
    }
    return [{ id, evidence }];
  });

  const grouped = new Map<string, { firstReviewId: number; targetSha: string; slots: GateRoundSlot[] }>();
  for (const candidate of candidates.sort((left, right) => left.id - right.id)) {
    const { evidence } = candidate;
    const existing = grouped.get(evidence.attempt_id) ?? {
      firstReviewId: candidate.id,
      targetSha: evidence.target_sha,
      slots: [],
    };
    existing.slots.push({
      slot: evidence.reviewer.slot,
      conformance: evidence.verdict.conformance,
      falsification: evidence.verdict.falsification,
      inconclusive: evidence.verdict.inconclusive,
      findings: evidence.verdict.blockers.map((finding) => ({
        severity: finding.severity,
        origin: finding.origin,
        code: finding.code,
        evidence_summary: summarizeEvidence(finding.evidence),
      })),
    });
    grouped.set(evidence.attempt_id, existing);
  }

  const history = [...grouped.entries()]
    .sort((left, right) => left[1].firstReviewId - right[1].firstReviewId)
    .map(([attemptId, record], round) => ({
      round,
      attempt_id: attemptId,
      target_sha: record.targetSha,
      slots: record.slots.sort((left, right) => left.slot - right.slot),
    }));
  return { status: 'available', round: history.length, history };
}

export function fetchGateRoundContext(options: {
  root: string;
  backend: 'github' | 'local';
  prNumber?: string;
  issueId: string;
  gate: ReviewEvidence['gate'];
  currentAttemptId?: string;
  trustedActors: string[];
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
}): string | undefined {
  return options.reviews
    .flatMap((review) => {
      const id = reviewId(review);
      const evidence = evidenceFromReview(review);
      return id !== undefined &&
        evidence?.issue_id === options.issueId &&
        evidence.gate === options.gate &&
        evidence.target_sha === options.targetSha
        ? [{ id, attemptId: evidence.attempt_id }]
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
