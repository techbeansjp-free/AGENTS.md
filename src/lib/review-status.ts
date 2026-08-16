import { gh } from './exec.js';
import { SEGMENTS, type Segment } from './issue.js';
import { reviewFilePath } from './local-state.js';
import {
  REVIEW_EVIDENCE_MARKER,
  isEvidenceVerdict,
  parseReviewEvidence,
  type EvidenceFinding,
  type ReviewEvidence,
} from './review-evidence.js';
import { loadProtectedCoreReviewPolicy } from './model-selection.js';
import { resolveCurrentBranch } from './worktree.js';
import { toYamlString, tryReadYamlFile } from './yaml-io.js';

const GITHUB_ISSUE_SIDE = `issue` as const;

interface GithubActor {
  login?: string;
}

interface GithubReview {
  author?: GithubActor;
  state?: string;
  body?: string;
  submittedAt?: string;
}

interface GithubComment {
  author?: GithubActor;
  body?: string;
  createdAt?: string;
  url?: string;
}

interface GithubReviewThreadComment {
  user?: GithubActor;
  body?: string;
  created_at?: string;
  html_url?: string;
}

interface GithubPrPayload {
  number?: number;
  state?: string;
  headRefName?: string;
  headRefOid?: string;
  reviews?: GithubReview[];
  comments?: GithubComment[];
}

interface GithubIssuePayload {
  comments?: GithubComment[];
}

export interface UnresolvedGithubReview {
  author: string;
  state: 'CHANGES_REQUESTED';
  body: string;
  submitted_at?: string;
  comment_bodies?: string[];
}

export interface UnresolvedGithubComment {
  source: 'pr_comment' | 'issue_comment' | 'review_thread_comment';
  author: string;
  body: string;
  created_at: string;
  url?: string;
}

export interface GithubPartialFailure {
  side:
    | typeof GITHUB_ISSUE_SIDE
    | 'pr'
    | 'pr_review_thread_comments'
    | 'gate_review_trust_policy'
    | 'gate_review_target_sha'
    | 'gate_review_evidence';
  reason: string;
}

export interface GithubReviewStatus {
  mode: 'github';
  detection: 'succeeded';
  pr_number?: number;
  unresolved_reviews: UnresolvedGithubReview[];
  unresolved_comments: UnresolvedGithubComment[];
  unresolved_blocking_findings?: GithubGateFinding[];
  partial_failures?: GithubPartialFailure[];
}

export interface FailedGithubReviewStatus {
  mode: 'github';
  detection: 'failed';
  reason: string;
}

interface RawGateFinding {
  severity: string;
  origin: string;
  code: string;
  evidence: string[];
}

export interface GateFinding extends RawGateFinding {
  source_segment: Segment;
}

export interface GithubGateFinding extends EvidenceFinding {
  source_segment: Segment;
}

export interface LocalReadFailure {
  segment: Segment;
  reason: string;
}

export interface LocalReviewStatus {
  mode: 'local';
  detection: 'succeeded';
  gate: string;
  unresolved_blocking_findings: GateFinding[];
  local_read_failures?: LocalReadFailure[];
}

export interface FailedLocalReviewStatus {
  mode: 'local';
  detection: 'failed';
  reason: string;
}

export type ReviewStatus = GithubReviewStatus | FailedGithubReviewStatus | LocalReviewStatus | FailedLocalReviewStatus;

interface LocalGateReport {
  gate?: {
    blockers?: RawGateFinding[];
  };
}

interface SuccessfulIssueDetection {
  succeeded: true;
  comments: UnresolvedGithubComment[];
}

interface SuccessfulPrDetection {
  succeeded: true;
  prNumber?: number;
  reviews: UnresolvedGithubReview[];
  blockingFindings: GithubGateFinding[];
  comments: UnresolvedGithubComment[];
  reviewThreadCommentFailure?: string;
  gateReviewTrustPolicyFailure?: string;
  gateReviewTargetShaFailure?: string;
  gateReviewEvidenceFailure?: string;
}

interface FailedSideDetection {
  succeeded: false;
  reason: string;
}

const SEGMENT_TO_ORIGIN: Record<Segment, EvidenceFinding['origin']> = {
  spec: 'specification',
  design: 'design',
  implementation: 'implementation',
  validation: 'validation',
};

function failureReason(context: string, detailRaw: string): string {
  const detail = detailRaw.trim().slice(0, 200);
  return detail ? `${context}: ${detail}` : context;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAutomationMarker(body: string): boolean {
  return body.trimStart().startsWith('<!-- agent-skill-chain:');
}

function unresolvedComment(
  comment: GithubComment,
  source: 'pr_comment' | 'issue_comment' | 'review_thread_comment',
): UnresolvedGithubComment | undefined {
  if (typeof comment.body !== 'string' || typeof comment.createdAt !== 'string') return undefined;
  if (isAutomationMarker(comment.body)) return undefined;
  return {
    source,
    author: comment.author?.login ?? 'unknown',
    body: comment.body,
    created_at: comment.createdAt,
    ...(typeof comment.url === 'string' ? { url: comment.url } : {}),
  };
}

function unresolvedReviews(reviews: GithubReview[]): UnresolvedGithubReview[] {
  const byAuthor = new Map<string, { review: GithubReview; index: number }[]>();
  reviews.forEach((review, index) => {
    const author = review.author?.login ?? 'unknown';
    const entries = byAuthor.get(author) ?? [];
    entries.push({ review, index });
    byAuthor.set(author, entries);
  });

  const unresolved: UnresolvedGithubReview[] = [];
  for (const [author, entries] of byAuthor) {
    const decisions = entries
      .filter(({ review }) => review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED')
      .sort(compareReviewEntries);
    const latest = decisions.at(-1);
    if (!latest || latest.review.state !== 'CHANGES_REQUESTED') continue;

    const commentBodies = entries
      .filter(({ review }) => review.state === 'COMMENTED')
      .filter((entry) => compareReviewEntries(entry, latest) > 0)
      .sort(compareReviewEntries)
      .map(({ review }) => review.body)
      .filter((body): body is string => typeof body === 'string');
    unresolved.push({
      author,
      state: 'CHANGES_REQUESTED',
      body: typeof latest.review.body === 'string' ? latest.review.body : '',
      ...(typeof latest.review.submittedAt === 'string' ? { submitted_at: latest.review.submittedAt } : {}),
      ...(commentBodies.length > 0 ? { comment_bodies: commentBodies } : {}),
    });
  }
  return unresolved;
}

interface GithubGateFindingDetection {
  findings: GithubGateFinding[];
  trustPolicyFailure?: string;
  evidenceFailure?: string;
}

function unresolvedGateFindings(
  root: string,
  reviews: GithubReview[],
  issueNumber: string,
  segment: string | undefined,
  targetSha: string | undefined,
): GithubGateFindingDetection {
  const targetOrigin = segment ? SEGMENT_TO_ORIGIN[segment as Segment] : undefined;
  if (!targetOrigin) return { findings: [] };

  let trustedActors: Set<string> | undefined;
  let trustPolicyFailure: string | undefined;
  try {
    const policy = loadProtectedCoreReviewPolicy(root);
    const configuredActors = policy?.execution.trusted_reviewer_actors;
    if (!configuredActors || configuredActors.length === 0) {
      trustPolicyFailure = 'ゲートレビューevidenceのtrusted actor登録をproject policyから解決できません';
    } else {
      trustedActors = new Set(configuredActors);
    }
  } catch (error) {
    trustPolicyFailure = `ゲートレビューevidenceのtrusted actor登録を解決できません: ${errorReason(error)}`;
  }

  const candidates: { evidence: ReviewEvidence; entry: { review: GithubReview; index: number } }[] = [];
  const malformedEntries: { entry: { review: GithubReview; index: number }; reason: string }[] = [];
  reviews.forEach((review, index) => {
    if (
      review.state === 'DISMISSED' ||
      typeof review.body !== 'string' ||
      !review.body.includes(REVIEW_EVIDENCE_MARKER)
    ) {
      return;
    }
    try {
      const evidence = parseReviewEvidence(review.body);
      if (
        evidence?.schema_version === 'agent-skill-chain/gate-review-evidence/v3' &&
        evidence.issue_id === `ISSUE-${issueNumber}` &&
        evidence.target_sha === targetSha &&
        SEGMENTS.includes(evidence.gate) &&
        typeof evidence.attempt_id === 'string' &&
        isEvidenceVerdict(evidence.verdict)
      ) {
        candidates.push({ evidence, entry: { review, index } });
      }
    } catch (error) {
      // Issue #680: 解釈不能な証跡を黙って落とすと、古い判定を確定結果として誤採用する。
      malformedEntries.push({ entry: { review, index }, reason: errorReason(error) });
    }
  });

  if (!trustedActors) {
    const findings = candidates.flatMap(({ evidence }) => {
      const hasRelevantBlocker = evidence.verdict.blockers.some(
        (finding) => finding.severity === 'blocking' && finding.origin === targetOrigin,
      );
      if (!hasRelevantBlocker) return [];
      return [{
        severity: 'blocking' as const,
        origin: targetOrigin,
        code: 'GATE_REVIEW_EVIDENCE_UNVERIFIED',
        evidence: [
          `${evidence.gate} gate evidenceにblocking findingがありますが、trusted actor登録を解決できないため内容を検証できません`,
        ],
        source_segment: evidence.gate,
      }];
    });
    return { findings, ...(trustPolicyFailure ? { trustPolicyFailure } : {}) };
  }

  const matching = candidates.filter(({ entry }) => {
    const author = entry.review.author?.login;
    return typeof author === 'string' && trustedActors.has(author);
  });
  const trustedMalformedEntries = malformedEntries.filter(({ entry }) => {
    const author = entry.review.author?.login;
    return typeof author === 'string' && trustedActors.has(author);
  });

  const findings: GithubGateFinding[] = [];
  if (!targetSha) {
    if (reviews.some((review) => (
      review.state !== 'DISMISSED' &&
      typeof review.body === 'string' &&
      review.body.includes(REVIEW_EVIDENCE_MARKER) &&
      typeof review.author?.login === 'string' &&
      trustedActors.has(review.author.login)
    ))) {
      findings.push({
        severity: 'blocking',
        origin: targetOrigin,
        code: 'GATE_REVIEW_TARGET_SHA_UNVERIFIED',
        evidence: ['PR head SHAを取得できないため、ゲートレビューevidenceの対象を検証できません'],
        source_segment: segment as Segment,
      });
    }
    return { findings };
  }

  let evidenceFailure: string | undefined;
  for (const sourceSegment of SEGMENTS) {
    const forGate = matching.filter(({ evidence }) => evidence.gate === sourceSegment);

    const byAttempt = new Map<string, typeof forGate>();
    for (const candidate of forGate) {
      const entries = byAttempt.get(candidate.evidence.attempt_id) ?? [];
      entries.push(candidate);
      byAttempt.set(candidate.evidence.attempt_id, entries);
    }
    const attempts = [...byAttempt.values()];
    const completeAttempts = attempts.filter((entries) => {
      const expectedCounts = new Set(entries.map(({ evidence }) => evidence.expected_count));
      if (expectedCounts.size !== 1) return false;
      const expectedCount = entries[0]?.evidence.expected_count;
      if (expectedCount !== 1 && expectedCount !== 2) return false;
      const slots = entries.map(({ evidence }) => evidence.reviewer?.slot);
      const metadataIsCoherent = [
        entries.map(({ evidence }) => evidence.profile),
        entries.map(({ evidence }) => evidence.prompt_digest),
        entries.map(({ evidence }) => evidence.execution?.trusted_base_sha),
        entries.map(({ evidence }) => evidence.execution?.launcher_digest),
        entries.map(({ evidence }) => evidence.execution?.launcher_token_digest),
        entries.map(({ evidence }) => evidence.target_sha),
      ].every((values) => values.every((value) => typeof value === 'string') && new Set(values).size === 1);
      return (
        entries.length === expectedCount &&
        new Set(slots).size === expectedCount &&
        slots.every((slot) => Number.isInteger(slot) && slot >= 1 && slot <= expectedCount) &&
        metadataIsCoherent
      );
    });
    const conclusiveAttempts = completeAttempts.filter((entries) => entries.every(({ evidence }) => (
      evidence.verdict.inconclusive === false &&
      evidence.verdict.conformance !== 'pending' &&
      evidence.verdict.falsification !== 'pending'
    )));

    const latestEntry = (attempt: typeof forGate) => attempt.reduce((latest, entry) =>
      compareReviewEntries(entry.entry, latest.entry) > 0 ? entry : latest,
    );
    const latestConclusiveAttempt = conclusiveAttempts.reduce<typeof forGate | undefined>((latest, candidate) => {
      if (!latest) return candidate;
      return compareReviewEntries(latestEntry(candidate).entry, latestEntry(latest).entry) > 0 ? candidate : latest;
    }, undefined);
    const activeMalformedEntries = sourceSegment === segment
      ? trustedMalformedEntries.filter(({ entry }) => (
          !latestConclusiveAttempt ||
          compareReviewEntries(entry, latestEntry(latestConclusiveAttempt).entry) > 0
        ))
      : [];
    if (activeMalformedEntries.length > 0) {
      evidenceFailure = 'trusted actorのゲートレビューevidenceを解釈できません';
      findings.push({
        severity: 'blocking',
        origin: targetOrigin,
        code: 'GATE_REVIEW_EVIDENCE_MALFORMED',
        evidence: activeMalformedEntries.map(({ entry, reason }) => (
          `${entry.review.author?.login ?? 'unknown'}のゲートレビューevidenceを解釈できません: ${reason}`
        )),
        source_segment: sourceSegment,
      });
    }
    const activeIncompleteAttempts = attempts
      .filter((entries) => !completeAttempts.includes(entries))
      .filter((entries) => (
        !latestConclusiveAttempt ||
        compareReviewEntries(latestEntry(entries).entry, latestEntry(latestConclusiveAttempt).entry) > 0
      ));
    if (activeIncompleteAttempts.length > 0) {
      findings.push({
        severity: 'blocking',
        origin: targetOrigin,
        code: 'GATE_REVIEW_ATTEMPT_INCOMPLETE',
        evidence: ['不完備なゲートレビューattemptがあり、blocking findingの解決状態を完全には判定できません'],
        source_segment: sourceSegment,
      });
      for (const attempt of activeIncompleteAttempts) {
        for (const { evidence } of attempt) {
          for (const finding of evidence.verdict.blockers) {
            if (finding.severity === 'blocking' && finding.origin === targetOrigin) {
              findings.push({ ...finding, source_segment: sourceSegment });
            }
          }
        }
      }
    }

    const activeInconclusiveAttempts = completeAttempts
      .filter((entries) => !conclusiveAttempts.includes(entries))
      .filter((entries) => (
        !latestConclusiveAttempt ||
        compareReviewEntries(latestEntry(entries).entry, latestEntry(latestConclusiveAttempt).entry) > 0
      ));
    if (activeInconclusiveAttempts.length > 0) {
      findings.push({
        severity: 'blocking',
        origin: targetOrigin,
        code: 'GATE_REVIEW_ATTEMPT_INCONCLUSIVE',
        evidence: ['判定不能なゲートレビューattemptがあり、blocking findingの解決状態を確定できません'],
        source_segment: sourceSegment,
      });
      for (const attempt of activeInconclusiveAttempts) {
        for (const { evidence } of attempt) {
          for (const finding of evidence.verdict.blockers) {
            if (finding.severity === 'blocking' && finding.origin === targetOrigin) {
              findings.push({ ...finding, source_segment: sourceSegment });
            }
          }
        }
      }
    }

    if (!latestConclusiveAttempt) continue;

    for (const { evidence } of latestConclusiveAttempt) {
      for (const finding of evidence.verdict.blockers) {
        if (finding.severity === 'blocking' && finding.origin === targetOrigin) {
          findings.push({ ...finding, source_segment: sourceSegment });
        }
      }
    }
  }
  return { findings, ...(evidenceFailure ? { evidenceFailure } : {}) };
}

function compareReviewEntries(
  left: { review: GithubReview; index: number },
  right: { review: GithubReview; index: number },
): number {
  const leftTime = typeof left.review.submittedAt === 'string' ? left.review.submittedAt : '';
  const rightTime = typeof right.review.submittedAt === 'string' ? right.review.submittedAt : '';
  return leftTime.localeCompare(rightTime) || left.index - right.index;
}

function detectReviewThreadComments(
  root: string,
  prNumber: number,
): { comments: UnresolvedGithubComment[]; failure?: string } {
  const comments: UnresolvedGithubComment[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = gh(
      ['api', `repos/{owner}/{repo}/pulls/${prNumber}/comments?per_page=100&page=${page}`],
      root,
    );
    if (result.status !== 0) {
      return {
        comments,
        failure: failureReason(`PR #${prNumber} のインラインレビューコメント取得に失敗しました`, result.stderr),
      };
    }
    try {
      const payload = JSON.parse(result.stdout) as GithubReviewThreadComment[];
      if (!Array.isArray(payload)) throw new Error('コメント一覧が配列ではありません');
      comments.push(
        ...payload
          .map((comment) => unresolvedComment({
            author: comment.user,
            body: comment.body,
            createdAt: comment.created_at,
            url: comment.html_url,
          }, 'review_thread_comment'))
          .filter((comment): comment is UnresolvedGithubComment => comment !== undefined),
      );
      if (payload.length < 100) return { comments };
    } catch (error) {
      return {
        comments,
        failure: `PR #${prNumber} のインラインレビューコメントJSON解釈に失敗しました: ${errorReason(error)}`,
      };
    }
  }
  return {
    comments,
    failure: `PR #${prNumber} のインラインレビューコメントがpagination上限を超えました`,
  };
}

function detectGithubIssueSide(root: string, issueNumber: string): SuccessfulIssueDetection | FailedSideDetection {
  const result = gh([GITHUB_ISSUE_SIDE, 'view', issueNumber, '--json', 'comments'], root);
  if (result.status !== 0) {
    return {
      succeeded: false,
      reason: failureReason(`ISSUE-${issueNumber} のコメント取得に失敗しました`, result.stderr),
    };
  }

  try {
    const payload = JSON.parse(result.stdout) as GithubIssuePayload;
    if (!Array.isArray(payload.comments)) throw new Error('comments配列がありません');
    return {
      succeeded: true,
      comments: payload.comments
        .map((comment) => unresolvedComment(comment, 'issue_comment'))
        .filter((comment): comment is UnresolvedGithubComment => comment !== undefined),
    };
  } catch (error) {
    return {
      succeeded: false,
      reason: `ISSUE-${issueNumber} のコメントJSON解釈に失敗しました: ${errorReason(error)}`,
    };
  }
}

function detectGithubPrSide(
  root: string,
  issueNumber: string,
  segment?: string,
): SuccessfulPrDetection | FailedSideDetection {
  const branch = resolveCurrentBranch(root);
  if (!branch) {
    return { succeeded: false, reason: '現在のブランチ名を解決できません' };
  }

  const expectedBranch = new RegExp(`^[^/]+/${issueNumber}-`);
  if (!expectedBranch.test(branch)) {
    return {
      succeeded: false,
      reason: `現在のブランチ(${branch})は対象ISSUE-${issueNumber}のブランチ命名規則(<type>/${issueNumber}-<slug>)と一致しません`,
    };
  }

  const result = gh(
    ['pr', 'view', branch, '--json', 'number,state,headRefName,headRefOid,reviews,comments'],
    root,
  );
  if (result.status !== 0) {
    if (result.stderr.toLowerCase().includes('no pull requests found')) {
      return { succeeded: true, reviews: [], blockingFindings: [], comments: [] };
    }
    return {
      succeeded: false,
      reason: failureReason(`ブランチ ${branch} のPRレビュー・コメント取得に失敗しました`, result.stderr),
    };
  }

  try {
    const payload = JSON.parse(result.stdout) as GithubPrPayload;
    if (
      typeof payload.number !== 'number' ||
      typeof payload.state !== 'string' ||
      typeof payload.headRefName !== 'string' ||
      !Array.isArray(payload.reviews) ||
      !Array.isArray(payload.comments)
    ) {
      throw new Error('number/state/headRefName/reviews/commentsが不正です');
    }
    const reviewThreadResult = detectReviewThreadComments(root, payload.number);
    const targetSha = typeof payload.headRefOid === 'string' && payload.headRefOid.length > 0
      ? payload.headRefOid
      : undefined;
    const gateFindingResult = unresolvedGateFindings(
      root,
      payload.reviews,
      issueNumber,
      segment,
      targetSha,
    );
    return {
      succeeded: true,
      prNumber: payload.number,
      reviews: unresolvedReviews(payload.reviews),
      blockingFindings: gateFindingResult.findings,
      comments: [
        ...payload.comments
          .map((comment) => unresolvedComment(comment, 'pr_comment'))
          .filter((comment): comment is UnresolvedGithubComment => comment !== undefined),
        ...reviewThreadResult.comments,
      ],
      ...(reviewThreadResult.failure ? { reviewThreadCommentFailure: reviewThreadResult.failure } : {}),
      ...(gateFindingResult.trustPolicyFailure
        ? { gateReviewTrustPolicyFailure: gateFindingResult.trustPolicyFailure }
        : {}),
      ...(!targetSha
        ? { gateReviewTargetShaFailure: `PR #${payload.number} のhead SHAを取得できません` }
        : {}),
      ...(gateFindingResult.evidenceFailure
        ? { gateReviewEvidenceFailure: gateFindingResult.evidenceFailure }
        : {}),
    };
  } catch (error) {
    return {
      succeeded: false,
      reason: `ブランチ ${branch} のPR JSON解釈に失敗しました: ${errorReason(error)}`,
    };
  }
}

/** GitHubのIssue側とPR側を独立に検出し、部分障害でも取得済みの情報を保持する。 */
export function detectGithubReviewStatus(
  root: string,
  issueNumber: string,
  segment?: string,
): GithubReviewStatus | FailedGithubReviewStatus | undefined {
  const issueResult = detectGithubIssueSide(root, issueNumber);
  const prResult = detectGithubPrSide(root, issueNumber, segment);

  if (!issueResult.succeeded && !prResult.succeeded) {
    return {
      mode: 'github',
      detection: 'failed',
      reason: `${GITHUB_ISSUE_SIDE}側: ${issueResult.reason}; pr側: ${prResult.reason}`,
    };
  }

  const unresolvedReviews = prResult.succeeded ? prResult.reviews : [];
  const unresolvedBlockingFindings = prResult.succeeded ? prResult.blockingFindings : [];
  const unresolvedComments = [
    ...(prResult.succeeded ? prResult.comments : []),
    ...(issueResult.succeeded ? issueResult.comments : []),
  ];
  const partialFailures: GithubPartialFailure[] = [];
  if (!issueResult.succeeded) partialFailures.push({ side: GITHUB_ISSUE_SIDE, reason: issueResult.reason });
  if (!prResult.succeeded) partialFailures.push({ side: 'pr', reason: prResult.reason });
  if (prResult.succeeded && prResult.reviewThreadCommentFailure) {
    partialFailures.push({
      side: 'pr_review_thread_comments',
      reason: prResult.reviewThreadCommentFailure,
    });
  }
  if (prResult.succeeded && prResult.gateReviewTrustPolicyFailure) {
    partialFailures.push({
      side: 'gate_review_trust_policy',
      reason: prResult.gateReviewTrustPolicyFailure,
    });
  }
  if (prResult.succeeded && prResult.gateReviewTargetShaFailure) {
    partialFailures.push({
      side: 'gate_review_target_sha',
      reason: prResult.gateReviewTargetShaFailure,
    });
  }
  if (prResult.succeeded && prResult.gateReviewEvidenceFailure) {
    partialFailures.push({
      side: 'gate_review_evidence',
      reason: prResult.gateReviewEvidenceFailure,
    });
  }

  if (
    unresolvedReviews.length === 0 &&
    unresolvedComments.length === 0 &&
    unresolvedBlockingFindings.length === 0 &&
    partialFailures.length === 0
  ) {
    return undefined;
  }
  return {
    mode: 'github',
    detection: 'succeeded',
    ...(prResult.succeeded && prResult.prNumber !== undefined ? { pr_number: prResult.prNumber } : {}),
    unresolved_reviews: unresolvedReviews,
    unresolved_comments: unresolvedComments,
    ...(unresolvedBlockingFindings.length > 0
      ? { unresolved_blocking_findings: unresolvedBlockingFindings }
      : {}),
    ...(partialFailures.length > 0 ? { partial_failures: partialFailures } : {}),
  };
}

/** 全segmentのgate reportを走査し、起動対象segment由来のblocking findingを抽出する。 */
export function detectLocalBlockingFindings(
  root: string,
  issueNumber: string,
  segment: string,
): LocalReviewStatus | FailedLocalReviewStatus | undefined {
  const targetOrigin = SEGMENT_TO_ORIGIN[segment as Segment] ?? segment;
  const findings: GateFinding[] = [];
  const failures: LocalReadFailure[] = [];
  let successfulReads = 0;

  for (const sourceSegment of SEGMENTS) {
    let report: LocalGateReport | undefined;
    try {
      report = tryReadYamlFile<LocalGateReport>(reviewFilePath(root, issueNumber, sourceSegment));
      successfulReads += 1;
    } catch (error) {
      failures.push({ segment: sourceSegment, reason: errorReason(error) });
      continue;
    }
    for (const finding of report?.gate?.blockers ?? []) {
      if (finding?.severity === 'blocking' && finding.origin === targetOrigin) {
        findings.push({ ...finding, source_segment: sourceSegment });
      }
    }
  }

  if (successfulReads === 0) {
    return {
      mode: 'local',
      detection: 'failed',
      reason: failures.map(({ segment: failedSegment, reason }) => `${failedSegment}: ${reason}`).join('; '),
    };
  }
  if (findings.length === 0 && failures.length === 0) return undefined;
  return {
    mode: 'local',
    detection: 'succeeded',
    gate: segment,
    unresolved_blocking_findings: findings,
    ...(failures.length > 0 ? { local_read_failures: failures } : {}),
  };
}

/** 検出結果をrole contractと同じYAML形式の起動プロンプトセクションへ整形する。 */
export function formatReviewStatusBlock(data: ReviewStatus): string {
  const indented = toYamlString(data)
    .trimEnd()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `review_status:\n${indented}`;
}
