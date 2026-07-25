import { digestOf } from './digest.js';

export const REVIEW_EVIDENCE_MARKER = '<!-- agent-skill-chain:gate-review-evidence -->';

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

export interface ReviewEvidence {
  schema_version: 'agent-skill-chain/gate-review-evidence/v1';
  issue_id: string;
  gate: 'spec' | 'design' | 'implementation' | 'validation';
  profile: 'standard' | 'strict';
  target_sha: string;
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
}

export interface EvidenceVerification {
  final: 'approved' | 'rejected' | 'human_required';
  conformance: 'pass' | 'fail' | 'pending';
  falsification: 'pass' | 'fail' | 'pending';
  blockers: EvidenceFinding[];
  approved_artifacts: { path: string; digest: string }[];
  reviewers: VerifiedReviewer[];
  reason?: string;
}

export function evidencePromptDigest(
  issueId: string,
  gate: string,
  targetSha: string,
  artifacts: { path: string; digest: string }[],
): string {
  const ordered = [...artifacts].sort((a, b) => a.path.localeCompare(b.path));
  return digestOf(JSON.stringify({ issue_id: issueId, gate, target_sha: targetSha, artifacts: ordered }));
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
    blockers,
    approved_artifacts: [],
    reviewers: [],
    reason,
  };
}

function isEvidenceShape(value: ReviewEvidence): boolean {
  return (
    value.schema_version === 'agent-skill-chain/gate-review-evidence/v1' &&
    /^ISSUE-[0-9]+$/.test(value.issue_id) &&
    ['spec', 'design', 'implementation', 'validation'].includes(value.gate) &&
    ['standard', 'strict'].includes(value.profile) &&
    typeof value.target_sha === 'string' &&
    !!value.reviewer &&
    typeof value.reviewer.run_id === 'string' &&
    [1, 2].includes(value.reviewer.slot) &&
    ['codex', 'claude', 'human'].includes(value.reviewer.adapter) &&
    typeof value.prompt_digest === 'string' &&
    !!value.verdict &&
    Array.isArray(value.verdict.blockers) &&
    Array.isArray(value.verdict.approved_artifacts)
  );
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
  expectedPromptDigest: string;
  expectedArtifacts: { path: string; digest: string }[];
  coreReviewRequired: boolean;
  codexModel: string;
  codexReasoning: string;
}): EvidenceVerification {
  if (options.unresolvedWriterActor || options.writerActors.length === 0) {
    return fail('PR/commitのwriter actorを完全に解決できません');
  }
  const expectedByPath = new Map(options.expectedArtifacts.map((artifact) => [artifact.path, artifact.digest]));
  const candidates: { api: GithubReviewRecord; evidence: ReviewEvidence; actor: string }[] = [];

  for (const review of options.reviews) {
    if (!review.body.includes(REVIEW_EVIDENCE_MARKER)) continue;
    let evidence: ReviewEvidence;
    try {
      const parsed = parseReviewEvidence(review.body);
      if (!parsed || !isEvidenceShape(parsed)) return fail(`review ${review.id} のevidence形式が不正です`);
      evidence = parsed;
    } catch {
      return fail(`review ${review.id} のevidence JSONを検証できません`);
    }
    if (
      evidence.issue_id !== options.issueId ||
      evidence.gate !== options.gate ||
      evidence.profile !== options.profile
    ) {
      continue;
    }
    const actor = review.user?.login;
    if (!actor) return fail(`review ${review.id} のactorを解決できません`);
    if (!options.trustedActors.includes(actor)) return fail(`review ${review.id} のactorはtrusted recorderではありません`);
    if (options.writerActors.includes(actor)) return fail(`review ${review.id} はwriter actorによる自己承認です`);
    if (review.state.toUpperCase() === 'DISMISSED') return fail(`review ${review.id} はdismiss済みです`);
    if (review.commit_id !== options.targetSha || evidence.target_sha !== options.targetSha) {
      return fail(`review ${review.id} のtarget SHAが現在のPR headと一致しません`);
    }
    if (evidence.prompt_digest !== options.expectedPromptDigest) {
      return fail(`review ${review.id} のprompt digestが一致しません`);
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
    for (const [artifactPath, digest] of expectedByPath) {
      if (actualByPath.get(artifactPath) !== digest) {
        return fail(`review ${review.id} の成果物digestが一致しません: ${artifactPath}`);
      }
    }
    candidates.push({ api: review, evidence, actor });
  }

  const expectedSlots = options.profile === 'strict' ? [1, 2] : [1];
  if (candidates.length !== expectedSlots.length) {
    return fail(`独立review evidence件数が不足または過剰です: expected=${expectedSlots.length}, actual=${candidates.length}`);
  }
  const runIds = new Set(candidates.map((candidate) => candidate.evidence.reviewer.run_id));
  const slots = new Set(candidates.map((candidate) => candidate.evidence.reviewer.slot));
  if (runIds.size !== candidates.length || slots.size !== candidates.length) {
    return fail('reviewer run IDまたはslotが重複しています');
  }
  if (expectedSlots.some((slot) => !slots.has(slot as 1 | 2))) return fail('必要なreviewer slotが揃っていません');

  const verdicts = candidates.map((candidate) => candidate.evidence.verdict);
  const blockers = verdicts.flatMap((verdict) => verdict.blockers);
  const hasBlocking = blockers.some((finding) => finding.severity === 'blocking');
  const rejected = verdicts.some(
    (verdict) => verdict.conformance === 'fail' || verdict.falsification === 'fail',
  ) || hasBlocking;
  const approved = verdicts.every(
    (verdict) =>
      verdict.conformance === 'pass' &&
      verdict.falsification === 'pass' &&
      verdict.inconclusive === false,
  ) && !hasBlocking;
  const final = rejected ? 'rejected' : approved ? 'approved' : 'human_required';
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
    })),
  };
}
