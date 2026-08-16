import { gh, git } from './exec.js';
import { SEGMENTS, type Segment } from './issue.js';
import { reviewFilePath } from './local-state.js';
import {
  REVIEW_EVIDENCE_MARKER,
  isEvidenceVerdict,
  parseReviewEvidence,
  type EvidenceFinding,
  type ReviewEvidence,
} from './review-evidence.js';
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
  side: typeof GITHUB_ISSUE_SIDE | 'pr' | 'pr_review_thread_comments';
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
}

interface FailedSideDetection {
  succeeded: false;
  reason: string;
}

const SEGMENT_TO_ORIGIN: Record<Segment, string> = {
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

function unresolvedGateFindings(
  reviews: GithubReview[],
  issueNumber: string,
  segment: string | undefined,
  targetSha: string | undefined,
): GithubGateFinding[] {
  const targetOrigin = segment ? SEGMENT_TO_ORIGIN[segment as Segment] : undefined;
  if (!targetOrigin || !targetSha) return [];

  const matching: { evidence: ReviewEvidence; entry: { review: GithubReview; index: number } }[] = [];
  reviews.forEach((review, index) => {
    if (review.state === 'DISMISSED' || typeof review.body !== 'string' || !review.body.includes(REVIEW_EVIDENCE_MARKER)) {
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
        matching.push({ evidence, entry: { review, index } });
      }
    } catch {
      // 構造化evidenceの完全な検証とCheck Run発行はtrusted recorderが担う。
      // worker promptでは解釈不能なreviewをblocking findingとして推測しない。
    }
  });

  const findings: GithubGateFinding[] = [];
  for (const sourceSegment of SEGMENTS) {
    const forGate = matching.filter(({ evidence }) => evidence.gate === sourceSegment);
    if (forGate.length === 0) continue;
    const latest = forGate.reduce((current, candidate) =>
      compareReviewEntries(candidate.entry, current.entry) > 0 ? candidate : current,
    );
    const latestAttempt = forGate.filter(({ evidence }) => evidence.attempt_id === latest.evidence.attempt_id);
    for (const { evidence } of latestAttempt) {
      for (const finding of evidence.verdict.blockers) {
        if (finding.severity === 'blocking' && finding.origin === targetOrigin) {
          findings.push({ ...finding, source_segment: sourceSegment });
        }
      }
    }
  }
  return findings;
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
    ['pr', 'view', branch, '--json', 'number,state,headRefName,reviews,comments'],
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
    const head = git(['rev-parse', 'HEAD'], root);
    return {
      succeeded: true,
      prNumber: payload.number,
      reviews: unresolvedReviews(payload.reviews),
      blockingFindings: unresolvedGateFindings(
        payload.reviews,
        issueNumber,
        segment,
        head.status === 0 ? head.stdout.trim() : undefined,
      ),
      comments: [
        ...payload.comments
          .map((comment) => unresolvedComment(comment, 'pr_comment'))
          .filter((comment): comment is UnresolvedGithubComment => comment !== undefined),
        ...reviewThreadResult.comments,
      ],
      ...(reviewThreadResult.failure ? { reviewThreadCommentFailure: reviewThreadResult.failure } : {}),
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
