import { digestOf } from './digest.js';

export const ROUND_BUDGET_DECLARATION_MARKER = '<!-- agent-skill-chain:round-budget-declaration -->';
export const FINDING_CLASSIFICATION_MARKER = '<!-- agent-skill-chain:finding-classification -->';

export const FINAL_ROUND_BLOCKING_CATEGORIES = [
  'previous_blocking_unresolved',
  'issue_purpose_blocked',
  'test_build_regression',
  'data_loss_or_security',
] as const;

export type FinalRoundBlockingCategory = typeof FINAL_ROUND_BLOCKING_CATEGORIES[number];

export interface RoundBudgetDeclarationPayload {
  schema_version: 'agent-skill-chain/round-budget-declaration/v1';
  issue_id: string;
  gate: 'spec' | 'design' | 'implementation' | 'validation';
  previous_attempt_id: string;
  final_round: number;
  blocking_categories: FinalRoundBlockingCategory[];
  nonblocking_action: 'warning_with_persisted_follow_up';
}

export interface RoundBudgetDeclaration extends RoundBudgetDeclarationPayload {
  declaration_digest: string;
}

export interface DurableRoundBudgetDeclaration extends RoundBudgetDeclaration {
  declared_at: string;
  record_id: string;
}

export interface RoundBudgetCommentRecord {
  id: number | string;
  body: string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function payloadOf(value: RoundBudgetDeclaration): RoundBudgetDeclarationPayload {
  return {
    schema_version: value.schema_version,
    issue_id: value.issue_id,
    gate: value.gate,
    previous_attempt_id: value.previous_attempt_id,
    final_round: value.final_round,
    blocking_categories: value.blocking_categories,
    nonblocking_action: value.nonblocking_action,
  };
}

export function roundBudgetDeclarationDigest(value: RoundBudgetDeclarationPayload): string {
  return digestOf(canonicalJson(value));
}

export function createRoundBudgetDeclaration(options: {
  issueId: string;
  gate: RoundBudgetDeclarationPayload['gate'];
  previousAttemptId: string;
  finalRound: number;
}): RoundBudgetDeclaration {
  const payload: RoundBudgetDeclarationPayload = {
    schema_version: 'agent-skill-chain/round-budget-declaration/v1',
    issue_id: options.issueId,
    gate: options.gate,
    previous_attempt_id: options.previousAttemptId,
    final_round: options.finalRound,
    blocking_categories: [...FINAL_ROUND_BLOCKING_CATEGORIES],
    nonblocking_action: 'warning_with_persisted_follow_up',
  };
  return { ...payload, declaration_digest: roundBudgetDeclarationDigest(payload) };
}

export function renderRoundBudgetDeclaration(value: RoundBudgetDeclaration): string {
  return `${ROUND_BUDGET_DECLARATION_MARKER}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

export function parseRoundBudgetDeclaration(body: string): RoundBudgetDeclaration | undefined {
  if (!body.includes(ROUND_BUDGET_DECLARATION_MARKER)) return undefined;
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(body);
  if (!match) throw new Error('round budget宣言のJSON blockがありません');
  return JSON.parse(match[1]) as RoundBudgetDeclaration;
}

export function validateRoundBudgetDeclaration(value: unknown): value is RoundBudgetDeclaration {
  if (!value || typeof value !== 'object') return false;
  const declaration = value as Partial<RoundBudgetDeclaration>;
  if (
    declaration.schema_version !== 'agent-skill-chain/round-budget-declaration/v1' ||
    !/^ISSUE-[0-9]+$/.test(declaration.issue_id ?? '') ||
    !['spec', 'design', 'implementation', 'validation'].includes(declaration.gate ?? '') ||
    !/^attempt-[A-Za-z0-9._-]+$/.test(declaration.previous_attempt_id ?? '') ||
    !Number.isInteger(declaration.final_round) ||
    (declaration.final_round ?? 0) < 2 ||
    declaration.nonblocking_action !== 'warning_with_persisted_follow_up' ||
    !Array.isArray(declaration.blocking_categories) ||
    canonicalJson(declaration.blocking_categories) !== canonicalJson(FINAL_ROUND_BLOCKING_CATEGORIES) ||
    !/^sha256:[0-9a-f]{64}$/.test(declaration.declaration_digest ?? '')
  ) return false;
  return declaration.declaration_digest === roundBudgetDeclarationDigest(payloadOf(declaration as RoundBudgetDeclaration));
}

export function validateDurableRoundBudgetDeclaration(value: unknown): value is DurableRoundBudgetDeclaration {
  if (!validateRoundBudgetDeclaration(value)) return false;
  const durable = value as Partial<DurableRoundBudgetDeclaration>;
  return typeof durable.record_id === 'string' && durable.record_id.length > 0 &&
    typeof durable.declared_at === 'string' && !Number.isNaN(Date.parse(durable.declared_at));
}

function commentTime(value: RoundBudgetCommentRecord, key: 'created' | 'updated'): string | undefined {
  return key === 'created' ? value.createdAt ?? value.created_at : value.updatedAt ?? value.updated_at;
}

/**
 * 対象Issue・対象gateの宣言recordだけを選ぶ。
 * Issue #786: 宣言コメントはIssue単位に並ぶため、gateで絞らずに数えると別gateの宣言を
 * 重複と誤認し、当該gateの宣言を永久に作成できなくする。作成側と解決側は同じ選択規則を使う。
 */
export function selectRoundBudgetDeclarationComments(options: {
  comments: RoundBudgetCommentRecord[];
  issueId: string;
  gate: RoundBudgetDeclaration['gate'];
}):
  | { status: 'selected'; matches: { comment: RoundBudgetCommentRecord; declaration: RoundBudgetDeclaration }[] }
  | { status: 'invalid'; reason: string } {
  const matches: { comment: RoundBudgetCommentRecord; declaration: RoundBudgetDeclaration }[] = [];
  for (const comment of options.comments) {
    if (!comment.body.includes(ROUND_BUDGET_DECLARATION_MARKER)) continue;
    let declaration: RoundBudgetDeclaration | undefined;
    try {
      declaration = parseRoundBudgetDeclaration(comment.body);
    } catch {
      return { status: 'invalid', reason: `宣言record ${comment.id}を解釈できません` };
    }
    if (declaration?.issue_id === options.issueId && declaration.gate === options.gate) {
      matches.push({ comment, declaration });
    }
  }
  return { status: 'selected', matches };
}

export function resolveDurableRoundBudgetDeclaration(options: {
  comments: RoundBudgetCommentRecord[];
  issueId: string;
  gate: RoundBudgetDeclaration['gate'];
  previousAttemptId: string;
  finalRound: number;
  previousEvidenceCompletedAt?: string;
  reviewStartedAt?: string;
}): { status: 'available'; declaration: DurableRoundBudgetDeclaration } | { status: 'invalid'; reason: string } {
  const selection = selectRoundBudgetDeclarationComments(options);
  if (selection.status === 'invalid') return selection;
  const candidates = selection.matches;
  if (candidates.length !== 1) {
    return { status: 'invalid', reason: `対象gateの不変宣言は1件だけ必要です: actual=${candidates.length}` };
  }
  const { comment, declaration } = candidates[0];
  if (!validateRoundBudgetDeclaration(declaration)) {
    return { status: 'invalid', reason: '宣言payloadまたはcanonical digestが不正です' };
  }
  if (
    declaration.previous_attempt_id !== options.previousAttemptId ||
    declaration.final_round !== options.finalRound
  ) {
    return { status: 'invalid', reason: '宣言の直前attemptまたは解決済み最終roundが一致しません' };
  }
  const createdAt = commentTime(comment, 'created');
  const updatedAt = commentTime(comment, 'updated');
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
    return { status: 'invalid', reason: '宣言のAPI作成時刻を解決できません' };
  }
  if (updatedAt && updatedAt !== createdAt) {
    return { status: 'invalid', reason: '宣言recordは作成後に上書きされています' };
  }
  if (options.previousEvidenceCompletedAt && Date.parse(createdAt) <= Date.parse(options.previousEvidenceCompletedAt)) {
    return { status: 'invalid', reason: '宣言が直前attemptの結果確定前に作成されています' };
  }
  if (options.reviewStartedAt && Date.parse(createdAt) >= Date.parse(options.reviewStartedAt)) {
    return { status: 'invalid', reason: '宣言が最終roundのreview開始後または結果後に追加されています' };
  }
  return {
    status: 'available',
    declaration: { ...declaration, declared_at: createdAt, record_id: String(comment.id) },
  };
}

export interface FindingReclassification {
  original_severity: 'blocking' | 'warning' | 'info';
  classified_severity: 'warning';
  downgrade_reason: string;
  outside_blocking_categories: Record<FinalRoundBlockingCategory, false>;
  raw_evidence: string[];
  follow_up_issue_id: string;
}

export interface ClassifiedFinding {
  severity: 'warning';
  origin: 'specification' | 'design' | 'implementation' | 'validation';
  code: string;
  evidence: string[];
  reclassification: FindingReclassification;
}

export interface FindingClassificationRecord {
  schema_version: 'agent-skill-chain/finding-classification/v1';
  issue_id: string;
  gate: 'spec' | 'design' | 'implementation' | 'validation';
  source_review_id: string;
  finding: ClassifiedFinding;
  classification_digest: string;
}

function classificationPayload(value: FindingClassificationRecord): Omit<FindingClassificationRecord, 'classification_digest'> {
  const { classification_digest: _digest, ...payload } = value;
  return payload;
}

export function createFindingClassificationRecord(options: {
  issueId: string;
  gate: FindingClassificationRecord['gate'];
  sourceReviewId: string;
  sourceFinding: { severity: 'blocking' | 'warning' | 'info'; origin: ClassifiedFinding['origin']; code: string; evidence: string[] };
  followUpIssueId: string;
  downgradeReason: string;
}): FindingClassificationRecord {
  const payload: Omit<FindingClassificationRecord, 'classification_digest'> = {
    schema_version: 'agent-skill-chain/finding-classification/v1',
    issue_id: options.issueId,
    gate: options.gate,
    source_review_id: options.sourceReviewId,
    finding: {
      severity: 'warning',
      origin: options.sourceFinding.origin,
      code: options.sourceFinding.code,
      evidence: [...options.sourceFinding.evidence],
      reclassification: {
        original_severity: options.sourceFinding.severity,
        classified_severity: 'warning',
        downgrade_reason: options.downgradeReason,
        outside_blocking_categories: {
          previous_blocking_unresolved: false,
          issue_purpose_blocked: false,
          test_build_regression: false,
          data_loss_or_security: false,
        },
        raw_evidence: [...options.sourceFinding.evidence],
        follow_up_issue_id: options.followUpIssueId,
      },
    },
  };
  return { ...payload, classification_digest: digestOf(canonicalJson(payload)) };
}

export function renderFindingClassificationRecord(value: FindingClassificationRecord): string {
  return `${FINDING_CLASSIFICATION_MARKER}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

export function parseFindingClassificationRecord(body: string): FindingClassificationRecord | undefined {
  if (!body.includes(FINDING_CLASSIFICATION_MARKER)) return undefined;
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(body);
  if (!match) throw new Error('finding分類記録のJSON blockがありません');
  return JSON.parse(match[1]) as FindingClassificationRecord;
}

export function validateFindingClassificationRecord(value: unknown): value is FindingClassificationRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<FindingClassificationRecord>;
  if (
    record.schema_version !== 'agent-skill-chain/finding-classification/v1' ||
    !/^ISSUE-[0-9]+$/.test(record.issue_id ?? '') ||
    !['spec', 'design', 'implementation', 'validation'].includes(record.gate ?? '') ||
    !/^[1-9][0-9]*$/.test(record.source_review_id ?? '') ||
    !record.finding ||
    typeof record.classification_digest !== 'string'
  ) return false;
  if (validateFindingReclassification(record.finding) !== undefined) return false;
  return record.classification_digest === digestOf(canonicalJson(classificationPayload(record as FindingClassificationRecord)));
}

export function validateFindingReclassification(
  finding: { severity: string; evidence: string[]; reclassification?: FindingReclassification },
): string | undefined {
  const reclassification = finding.reclassification;
  if (!reclassification) return undefined;
  if (finding.severity !== 'warning' || reclassification.classified_severity !== 'warning') {
    return '再分類後severityはfindingとreclassificationの双方でwarningである必要があります';
  }
  if (!reclassification.downgrade_reason.trim() || !/^ISSUE-[0-9]+$/.test(reclassification.follow_up_issue_id)) {
    return '降格理由と永続化済みfollow-up Issue番号が必要です';
  }
  if (canonicalJson(finding.evidence) !== canonicalJson(reclassification.raw_evidence)) {
    return 'raw evidence原文が同じfinding内のevidenceと完全一致しません';
  }
  if (FINAL_ROUND_BLOCKING_CATEGORIES.some((category) => reclassification.outside_blocking_categories[category] !== false)) {
    return '4類型すべてに該当しない根拠が必要です';
  }
  return undefined;
}
