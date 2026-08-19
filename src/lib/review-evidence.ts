import { digestOf } from './digest.js';

export const REVIEW_EVIDENCE_MARKER = '<!-- agent-skill-chain:gate-review-evidence -->';

const FINDING_EVIDENCE_MIN_LENGTH = 16;
const AC_ID_PATTERN = /(?:^|[^A-Za-z0-9])AC-[0-9]+(?:$|[^A-Za-z0-9])/i;
const ARTIFACT_PATH_PATTERN = /(?:^|[\s"'`(（])(?:\.?[A-Za-z0-9_-]+\/)*\.?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[\s"'`:：,，。)）\]])/;

export interface EvidenceFinding {
  severity: 'blocking' | 'warning' | 'info';
  origin: 'specification' | 'design' | 'implementation' | 'validation';
  code: string;
  evidence: string[];
}

export interface EvidenceVerdict {
  conformance: 'pass' | 'fail' | 'pending';
  falsification: 'pass' | 'fail' | 'pending';
  blockers: EvidenceFinding[];
  approved_artifacts: { path: string; digest: string }[];
  inconclusive: boolean;
}

export interface LightReviewEvidence {
  requested: boolean;
  applied: boolean;
  disabled_reasons: string[];
  remediation_round: number;
  strict_locked: boolean;
}

/**
 * 調達の事実（Issue #759）。準備段が隔離 clone の外から実行コードを調達した場合に、
 * 調達元の識別子と調達した実体の digest を証跡へ残す。
 *
 * 既に投稿済みの証跡を形式不適合にしないため、`ReviewEvidence['execution']` では任意フィールド
 * として扱い、存在する場合のみ形式を検査する（スキーマ識別子は据え置く）。
 */
export interface EvidenceProcurement {
  mode: 'clone_build' | 'package_copy';
  /** 何をどこから取得したかを一意に示す値。`clone_build` では隔離 clone の base SHA を指す。 */
  source: string;
  /** `package_copy` のときの調達実体の正準ツリー digest。 */
  digest?: string;
}

export function isEvidenceProcurement(value: unknown): value is EvidenceProcurement {
  if (!value || typeof value !== 'object') return false;
  const procurement = value as Partial<EvidenceProcurement>;
  if (procurement.mode !== 'clone_build' && procurement.mode !== 'package_copy') return false;
  if (typeof procurement.source !== 'string' || procurement.source.length === 0) return false;
  if (procurement.mode === 'package_copy') {
    return typeof procurement.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(procurement.digest);
  }
  return (
    procurement.digest === undefined ||
    (typeof procurement.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(procurement.digest))
  );
}

export interface ReviewEvidence {
  schema_version: 'agent-skill-chain/gate-review-evidence/v3';
  issue_id: string;
  gate: 'spec' | 'design' | 'implementation' | 'validation';
  profile: 'standard' | 'strict';
  target_sha: string;
  attempt_id: string;
  expected_count: 1 | 2;
  execution: {
    launcher: 'agent-skill-chain/gate-local-review/v1';
    trusted_base_sha: string;
    launcher_digest: string;
    launcher_token_digest: string;
    isolation: 'ephemeral_clone';
    sandbox: 'read_only';
    procurement?: EvidenceProcurement;
  };
  reviewer: {
    run_id: string;
    slot: 1 | 2;
    adapter: 'codex' | 'claude' | 'human';
    model: string;
    reasoning: string;
    capability: {
      model_tier: string;
      reasoning_tier: string;
      read_only: boolean;
    };
  };
  prompt_digest: string;
  light_review?: LightReviewEvidence;
  verdict: EvidenceVerdict;
}

export interface GithubReviewRecord {
  id: number | string;
  body: string;
  commit_id: string;
  state: string;
  user: { login: string | null } | null;
}

export interface VerifiedReviewer {
  source: 'github_pr_review';
  review_id: string;
  actor: string;
  run_id: string;
  slot: number;
  adapter: string;
  model: string;
  reasoning: string;
  prompt_digest: string;
  actor_relation: 'same_as_writer' | 'distinct_from_writer';
  trusted_base_sha: string;
  launcher_digest: string;
  launcher_token_digest: string;
  isolation: 'ephemeral_clone';
  sandbox: 'read_only';
}

export interface VerifiedReviewAttempt {
  attempt_id: string;
  expected_count: number;
  evidence_digest: string;
}

export interface EvidenceVerification {
  final: 'approved' | 'rejected' | 'human_required';
  conformance: 'pass' | 'fail' | 'pending';
  falsification: 'pass' | 'fail' | 'pending';
  inconclusive: boolean;
  blockers: EvidenceFinding[];
  approved_artifacts: { path: string; digest: string }[];
  reviewers: VerifiedReviewer[];
  review_attempt?: VerifiedReviewAttempt;
  light_review?: LightReviewEvidence;
  reason?: string;
}

export function evidencePromptDigest(prompt: string): string {
  return digestOf(prompt);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function renderReviewEvidence(evidence: ReviewEvidence): string {
  return `${REVIEW_EVIDENCE_MARKER}\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`;
}

export function parseReviewEvidence(body: string): ReviewEvidence | undefined {
  if (!body.includes(REVIEW_EVIDENCE_MARKER)) return undefined;
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(body);
  if (!match) throw new Error('構造化review evidenceのJSON blockがありません');
  return JSON.parse(match[1]) as ReviewEvidence;
}

function fail(reason: string, blockers: EvidenceFinding[] = []): EvidenceVerification {
  return {
    final: 'human_required',
    conformance: 'pending',
    falsification: 'pending',
    inconclusive: true,
    blockers,
    approved_artifacts: [],
    reviewers: [],
    reason,
  };
}

type FindingValidation = 'current' | 'historical_v3';

function isFindingShape(value: unknown, validation: FindingValidation): value is EvidenceFinding {
  if (!value || typeof value !== 'object') return false;
  const finding = value as Partial<EvidenceFinding>;
  const legacyEvidence =
    Array.isArray(finding.evidence) && finding.evidence.every((entry) => typeof entry === 'string');
  const evidence = Array.isArray(finding.evidence) &&
    finding.evidence.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
      ? finding.evidence.join(' / ').trim()
      : '';
  return (
    ['blocking', 'warning', 'info'].includes(finding.severity ?? '') &&
    ['specification', 'design', 'implementation', 'validation'].includes(finding.origin ?? '') &&
    typeof finding.code === 'string' &&
    finding.code.length > 0 &&
    (validation === 'historical_v3'
      ? legacyEvidence
      : evidence.length >= FINDING_EVIDENCE_MIN_LENGTH &&
        (AC_ID_PATTERN.test(evidence) || ARTIFACT_PATH_PATTERN.test(evidence)))
  );
}

function isArtifactShape(value: unknown, digestRequired: boolean): boolean {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as { path?: unknown; digest?: unknown };
  return (
    typeof artifact.path === 'string' &&
    artifact.path.length > 0 &&
    (digestRequired
      ? typeof artifact.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(artifact.digest)
      : artifact.digest === undefined ||
        (typeof artifact.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(artifact.digest)))
  );
}

function isLightReviewShape(value: unknown): value is LightReviewEvidence {
  if (!value || typeof value !== 'object') return false;
  const light = value as Partial<LightReviewEvidence>;
  return (
    typeof light.requested === 'boolean' &&
    typeof light.applied === 'boolean' &&
    Array.isArray(light.disabled_reasons) &&
    light.disabled_reasons.every((reason) => typeof reason === 'string') &&
    typeof light.remediation_round === 'number' &&
    Number.isInteger(light.remediation_round) &&
    light.remediation_round >= 0 &&
    typeof light.strict_locked === 'boolean'
  );
}

export function isEvidenceVerdict(
  value: unknown,
  digestRequired = true,
  findingValidation: FindingValidation = 'current',
): value is EvidenceVerdict {
  if (!value || typeof value !== 'object') return false;
  const verdict = value as Partial<EvidenceVerdict>;
  return (
    ['pass', 'fail', 'pending'].includes(verdict.conformance ?? '') &&
    ['pass', 'fail', 'pending'].includes(verdict.falsification ?? '') &&
    Array.isArray(verdict.blockers) &&
    verdict.blockers.every((finding) => isFindingShape(finding, findingValidation)) &&
    Array.isArray(verdict.approved_artifacts) &&
    verdict.approved_artifacts.every((artifact) => isArtifactShape(artifact, digestRequired)) &&
    typeof verdict.inconclusive === 'boolean'
  );
}

function isEvidenceShape(value: ReviewEvidence, findingValidation: FindingValidation): boolean {
  return (
    value.schema_version === 'agent-skill-chain/gate-review-evidence/v3' &&
    /^ISSUE-[0-9]+$/.test(value.issue_id) &&
    ['spec', 'design', 'implementation', 'validation'].includes(value.gate) &&
    ['standard', 'strict'].includes(value.profile) &&
    typeof value.target_sha === 'string' &&
    typeof value.attempt_id === 'string' &&
    /^attempt-[A-Za-z0-9._-]+$/.test(value.attempt_id) &&
    [1, 2].includes(value.expected_count) &&
    !!value.execution &&
    value.execution.launcher === 'agent-skill-chain/gate-local-review/v1' &&
    typeof value.execution.trusted_base_sha === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(value.execution.launcher_digest) &&
    /^sha256:[0-9a-f]{64}$/.test(value.execution.launcher_token_digest) &&
    value.execution.isolation === 'ephemeral_clone' &&
    value.execution.sandbox === 'read_only' &&
    (value.execution.procurement === undefined || isEvidenceProcurement(value.execution.procurement)) &&
    !!value.reviewer &&
    typeof value.reviewer.run_id === 'string' &&
    /^review-[A-Za-z0-9._-]+$/.test(value.reviewer.run_id) &&
    [1, 2].includes(value.reviewer.slot) &&
    ['codex', 'claude', 'human'].includes(value.reviewer.adapter) &&
    typeof value.reviewer.model === 'string' &&
    value.reviewer.model.length > 0 &&
    typeof value.reviewer.reasoning === 'string' &&
    value.reviewer.reasoning.length > 0 &&
    !!value.reviewer.capability &&
    typeof value.reviewer.capability.model_tier === 'string' &&
    typeof value.reviewer.capability.reasoning_tier === 'string' &&
    typeof value.reviewer.capability.read_only === 'boolean' &&
    typeof value.prompt_digest === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(value.prompt_digest) &&
    (value.light_review === undefined || isLightReviewShape(value.light_review)) &&
    isEvidenceVerdict(value.verdict, true, findingValidation)
  );
}

export interface ValidatedGithubReviewEvidence {
  api: GithubReviewRecord;
  evidence: ReviewEvidence;
  reviewId: number;
  actor: string;
}

export type GithubReviewEvidenceValidation =
  | { valid: true; value: ValidatedGithubReviewEvidence }
  | { valid: false; reason: string };

/**
 * PR review 1件の証跡形式と GitHub API metadata の結線を検証する。
 * 最新attemptの最終判定と過去ラウンド導出が同じ信頼境界を使うための共通入口。
 */
export function validateGithubReviewEvidenceRecord(
  review: GithubReviewRecord,
  options: {
    issueId: string;
    gate: ReviewEvidence['gate'];
    trustedActors: string[];
    findingValidation?: FindingValidation;
  },
): GithubReviewEvidenceValidation {
  let parsed: unknown;
  try {
    parsed = parseReviewEvidence(review.body);
  } catch {
    return { valid: false, reason: `review ${review.id} のevidence JSONを検証できません` };
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !isEvidenceShape(parsed as ReviewEvidence, options.findingValidation ?? 'current')
  ) {
    return { valid: false, reason: `review ${review.id} のevidence形式が不正です` };
  }
  const evidence = parsed as ReviewEvidence;
  if (evidence.issue_id !== options.issueId || evidence.gate !== options.gate) {
    return { valid: false, reason: `review ${review.id} は対象Issue/gateのevidenceではありません` };
  }
  const reviewId = Number(review.id);
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) {
    return { valid: false, reason: `review ${review.id} のAPI IDが不正です` };
  }
  const actor = review.user?.login ?? '';
  if (!actor) return { valid: false, reason: `review ${review.id} のactorを解決できません` };
  if (!options.trustedActors.includes(actor)) {
    return { valid: false, reason: `review ${review.id} のactorはtrusted recorderではありません` };
  }
  if (review.state.toUpperCase() === 'DISMISSED') {
    return { valid: false, reason: `review ${review.id} はdismiss済みです` };
  }
  if (review.commit_id !== evidence.target_sha) {
    return { valid: false, reason: `review ${review.id} のAPI commit SHAがevidenceと一致しません` };
  }
  const expectedCount = evidence.profile === 'strict' ? 2 : 1;
  if (evidence.expected_count !== expectedCount) {
    return { valid: false, reason: `review ${review.id} のexpected_countがprofileと一致しません` };
  }
  if (evidence.reviewer.slot > expectedCount) {
    return { valid: false, reason: `review ${review.id} のslotがprofileと一致しません` };
  }
  return { valid: true, value: { api: review, evidence, reviewId, actor } };
}

export type GithubReviewAttemptValidation =
  | { valid: true; values: ValidatedGithubReviewEvidence[] }
  | { valid: false; reason: string };

/** 完備attemptのslot・run・digest・実行attestationの一貫性を検証する。 */
export function validateGithubReviewEvidenceAttempt(
  candidates: ValidatedGithubReviewEvidence[],
): GithubReviewAttemptValidation {
  if (candidates.length === 0) return { valid: false, reason: 'review evidenceがありません' };
  const first = candidates[0].evidence;
  const expectedCount = first.profile === 'strict' ? 2 : 1;
  const expectedSlots = expectedCount === 2 ? [1, 2] : [1];
  if (candidates.length !== expectedCount) {
    return {
      valid: false,
      reason: `独立review evidence件数が不足または過剰です: expected=${expectedCount}, actual=${candidates.length}`,
    };
  }
  if (candidates.some(({ evidence }) =>
    evidence.attempt_id !== first.attempt_id ||
    evidence.target_sha !== first.target_sha ||
    evidence.profile !== first.profile ||
    evidence.expected_count !== first.expected_count ||
    evidence.prompt_digest !== first.prompt_digest ||
    canonicalJson(evidence.light_review ?? null) !== canonicalJson(first.light_review ?? null) ||
    evidence.execution.trusted_base_sha !== first.execution.trusted_base_sha ||
    evidence.execution.launcher_digest !== first.execution.launcher_digest ||
    evidence.execution.launcher_token_digest !== first.execution.launcher_token_digest ||
    canonicalJson(evidence.execution.procurement ?? null) !== canonicalJson(first.execution.procurement ?? null)
  )) {
    return { valid: false, reason: 'review attempt内の証跡・実行attestationが一致しません' };
  }
  const runIds = new Set(candidates.map(({ evidence }) => evidence.reviewer.run_id));
  const slots = new Set(candidates.map(({ evidence }) => evidence.reviewer.slot));
  if (runIds.size !== candidates.length || slots.size !== candidates.length) {
    return { valid: false, reason: 'reviewer run IDまたはslotが重複しています' };
  }
  if (expectedSlots.some((slot) => !slots.has(slot as 1 | 2))) {
    return { valid: false, reason: '必要なreviewer slotが揃っていません' };
  }
  return {
    valid: true,
    values: [...candidates].sort((left, right) => left.evidence.reviewer.slot - right.evidence.reviewer.slot),
  };
}

export function verifyGithubReviewEvidence(options: {
  reviews: GithubReviewRecord[];
  issueId: string;
  gate: ReviewEvidence['gate'];
  profile: ReviewEvidence['profile'];
  targetSha: string;
  trustedActors: string[];
  writerActors: string[];
  unresolvedWriterActor: boolean;
  expectedLightReview?: LightReviewEvidence;
  expectedArtifacts: { path: string; digest: string }[];
  expectedTrustedBaseSha: string;
  expectedLauncherDigest: string;
  coreReviewRequired: boolean;
  codexModel: string;
  codexReasoning: string;
  gateRound?: { round: number; cutoffThreshold: number };
  findingValidation?: FindingValidation;
} & (
  | { promptDigestVerification?: 'match_expected'; expectedPromptDigest: string }
  | { promptDigestVerification: 'record_only'; expectedPromptDigest?: never }
)): EvidenceVerification {
  if (options.unresolvedWriterActor || options.writerActors.length === 0) {
    return fail('PR/commitのwriter actorを完全に解決できません');
  }
  const expectedByPath = new Map(options.expectedArtifacts.map((artifact) => [artifact.path, artifact.digest]));
  const matching: {
    api: GithubReviewRecord;
    evidence: Partial<ReviewEvidence>;
    reviewId: number;
  }[] = [];

  for (const review of options.reviews) {
    if (!review.body.includes(REVIEW_EVIDENCE_MARKER)) continue;
    let parsed: unknown;
    try {
      parsed = parseReviewEvidence(review.body);
    } catch {
      return fail(`review ${review.id} のevidence JSONを検証できません`);
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const routed = parsed as Partial<ReviewEvidence>;
    // 過去schemaと別Issue/gate/targetの監査履歴は候補にしない。同一targetのv3だけを
    // 最新attempt選択へ進め、profile遷移後に旧profileへfallbackできないようにする。
    if (routed.schema_version !== 'agent-skill-chain/gate-review-evidence/v3') continue;
    if (
      routed.issue_id !== options.issueId ||
      routed.gate !== options.gate ||
      routed.target_sha !== options.targetSha
    ) {
      continue;
    }
    const reviewId = Number(review.id);
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return fail(`review ${review.id} のAPI IDが不正です`);
    matching.push({ api: review, evidence: routed, reviewId });
  }

  if (matching.length === 0) return fail('現在のtarget SHA用review evidenceがありません');
  const latest = matching.reduce((current, candidate) => candidate.reviewId > current.reviewId ? candidate : current);
  const latestValidation = validateGithubReviewEvidenceRecord(latest.api, {
    issueId: options.issueId,
    gate: options.gate,
    trustedActors: options.trustedActors,
    findingValidation: options.findingValidation,
  });
  if (!latestValidation.valid) return fail(latestValidation.reason);
  const latestEvidence = latestValidation.value.evidence;
  const expectedLightReview = canonicalJson(options.expectedLightReview ?? null);
  if (canonicalJson(latestEvidence.light_review ?? null) !== expectedLightReview) {
    return fail(`最新review attemptのlight_reviewがtrusted再評価値と一致しません: ${latestEvidence.attempt_id}`);
  }
  if (latestEvidence.profile !== options.profile) {
    return fail(`最新review attemptのprofileがtrusted profileと一致しません: ${latestEvidence.attempt_id}`);
  }
  if (options.coreReviewRequired && options.profile !== 'strict') {
    return fail('コア対象にはStrict profileが必要です');
  }
  const selected = matching.filter((candidate) => candidate.evidence.attempt_id === latestEvidence.attempt_id);
  const validatedCandidates: ValidatedGithubReviewEvidence[] = [];
  for (const candidate of selected) {
    const validation = validateGithubReviewEvidenceRecord(candidate.api, {
      issueId: options.issueId,
      gate: options.gate,
      trustedActors: options.trustedActors,
      findingValidation: options.findingValidation,
    });
    if (!validation.valid) return fail(validation.reason);
    validatedCandidates.push(validation.value);
  }
  const attemptValidation = validateGithubReviewEvidenceAttempt(validatedCandidates);
  if (!attemptValidation.valid) return fail(attemptValidation.reason);
  const candidates = attemptValidation.values;

  const expectedCount = options.profile === 'strict' ? 2 : 1;
  if (latestEvidence.expected_count !== expectedCount) {
    return fail(`最新review attemptのexpected_countがprofileと一致しません: ${latestEvidence.attempt_id}`);
  }

  for (const candidate of candidates) {
    const { api: review, evidence, actor } = candidate;
    if (review.commit_id !== options.targetSha) {
      return fail(`review ${review.id} のAPI commit SHAが現在のPR headと一致しません`);
    }
    if (evidence.profile !== options.profile) return fail(`review ${review.id} のprofileが一致しません`);
    if (evidence.expected_count !== expectedCount) return fail(`review ${review.id} のexpected_countが一致しません`);
    if (canonicalJson(evidence.light_review ?? null) !== expectedLightReview) {
      return fail(`review ${review.id} のlight_reviewがtrusted再評価値と一致しません`);
    }
    if (
      options.promptDigestVerification !== 'record_only' &&
      evidence.prompt_digest !== options.expectedPromptDigest
    ) {
      return fail(`review ${review.id} のprompt digestが一致しません`);
    }
    if (
      evidence.execution.trusted_base_sha !== options.expectedTrustedBaseSha ||
      evidence.execution.launcher_digest !== options.expectedLauncherDigest ||
      evidence.execution.launcher !== 'agent-skill-chain/gate-local-review/v1' ||
      evidence.execution.isolation !== 'ephemeral_clone' ||
      evidence.execution.sandbox !== 'read_only'
    ) {
      return fail(`review ${review.id} のprotected-base実行attestationが一致しません`);
    }
    if (!evidence.reviewer.capability.read_only) return fail(`review ${review.id} はread-onlyを証明していません`);
    if (options.coreReviewRequired) {
      if (
        evidence.reviewer.capability.model_tier !== 'frontier_coding' ||
        evidence.reviewer.capability.reasoning_tier !== 'maximum_reasoning'
      ) {
        return fail(`review ${review.id} はコア必須能力を証明していません`);
      }
      if (
        evidence.reviewer.adapter === 'codex' &&
        (evidence.reviewer.model !== options.codexModel || evidence.reviewer.reasoning !== options.codexReasoning)
      ) {
        return fail(`review ${review.id} のCodex model/reasoningがpolicyと一致しません`);
      }
      if (evidence.reviewer.adapter === 'human') return fail(`review ${review.id} はコアAI能力を証明できません`);
    }
    const actualByPath = new Map(evidence.verdict.approved_artifacts.map((artifact) => [artifact.path, artifact.digest]));
    if (
      actualByPath.size !== evidence.verdict.approved_artifacts.length ||
      actualByPath.size !== expectedByPath.size
    ) {
      return fail(`review ${review.id} の成果物集合が一致しません`);
    }
    for (const [artifactPath, digest] of expectedByPath) {
      if (actualByPath.get(artifactPath) !== digest) {
        return fail(`review ${review.id} の成果物digestが一致しません: ${artifactPath}`);
      }
    }
  }

  const verdicts = candidates.map((candidate) => candidate.evidence.verdict);
  const blockers = verdicts.flatMap((verdict) => verdict.blockers);
  const hasBlocking = blockers.some((finding) => finding.severity === 'blocking');
  const cutoffReached =
    options.gateRound !== undefined &&
    options.gateRound.round >= options.gateRound.cutoffThreshold &&
    hasBlocking;
  const rejected = verdicts.some(
    (verdict) => verdict.conformance === 'fail' || verdict.falsification === 'fail',
  ) || hasBlocking;
  const approved = verdicts.every(
    (verdict) =>
      verdict.conformance === 'pass' &&
      verdict.falsification === 'pass' &&
      verdict.inconclusive === false,
  ) && !hasBlocking;
  const trustedInconclusive = cutoffReached;
  const final = trustedInconclusive
    ? 'human_required'
    : rejected
      ? 'rejected'
      : approved
        ? 'approved'
        : 'human_required';
  return {
    final,
    conformance: rejected
      ? verdicts.some((verdict) => verdict.conformance === 'fail')
        ? 'fail'
        : verdicts.every((verdict) => verdict.conformance === 'pass')
          ? 'pass'
          : 'pending'
      : approved
        ? 'pass'
        : 'pending',
    inconclusive: trustedInconclusive || verdicts.some((verdict) => verdict.inconclusive),
    falsification: rejected
      ? verdicts.some((verdict) => verdict.falsification === 'fail')
        ? 'fail'
        : verdicts.every((verdict) => verdict.falsification === 'pass')
          ? 'pass'
          : 'pending'
      : approved
        ? 'pass'
        : 'pending',
    blockers,
    approved_artifacts: options.expectedArtifacts,
    reviewers: candidates.map(({ api, evidence, actor }) => ({
      source: 'github_pr_review',
      review_id: String(api.id),
      actor,
      run_id: evidence.reviewer.run_id,
      slot: evidence.reviewer.slot,
      adapter: evidence.reviewer.adapter,
      model: evidence.reviewer.model,
      reasoning: evidence.reviewer.reasoning,
      prompt_digest: evidence.prompt_digest,
      actor_relation: options.writerActors.includes(actor) ? 'same_as_writer' : 'distinct_from_writer',
      trusted_base_sha: evidence.execution.trusted_base_sha,
      launcher_digest: evidence.execution.launcher_digest,
      launcher_token_digest: evidence.execution.launcher_token_digest,
      isolation: evidence.execution.isolation,
      sandbox: evidence.execution.sandbox,
    })),
    ...(options.expectedLightReview ? { light_review: options.expectedLightReview } : {}),
    review_attempt: {
      attempt_id: latestEvidence.attempt_id,
      expected_count: expectedCount,
      evidence_digest: digestOf(canonicalJson(
        [...candidates]
          .sort((left, right) => left.evidence.reviewer.slot - right.evidence.reviewer.slot)
          .map(({ api, evidence, actor }) => ({
            review_id: String(api.id),
            actor,
            commit_id: api.commit_id,
            evidence,
          })),
      )),
    },
    ...(cutoffReached
      ? {
          reason:
            `ラウンド上限に達したため人間判断へ移行します: round=${options.gateRound?.round}, ` +
            `cutoff_threshold=${options.gateRound?.cutoffThreshold}, unresolved_blocking=${blockers.filter((finding) => finding.severity === 'blocking').length}`,
        }
      : {}),
  };
}
