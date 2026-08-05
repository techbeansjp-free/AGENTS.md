import { gh } from './exec.js';
import { SEGMENTS, type Segment } from './issue.js';
import { reviewFilePath } from './local-state.js';
import { resolveCurrentBranch } from './worktree.js';
import { toYamlString, tryReadYamlFile } from './yaml-io.js';

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

interface GithubPrPayload {
  number?: number;
  state?: string;
  headRefName?: string;
  latestReviews?: GithubReview[];
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
}

export interface UnresolvedGithubComment {
  source: 'pr_comment' | 'issue_comment';
  author: string;
  body: string;
  created_at: string;
  url?: string;
}

export interface GithubPartialFailure {
  side: 'issue' | 'pr';
  reason: string;
}

export interface GithubReviewStatus {
  mode: 'github';
  detection: 'succeeded';
  pr_number?: number;
  unresolved_reviews: UnresolvedGithubReview[];
  unresolved_comments: UnresolvedGithubComment[];
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
  comments: UnresolvedGithubComment[];
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
  source: 'pr_comment' | 'issue_comment',
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

function unresolvedReview(review: GithubReview): UnresolvedGithubReview | undefined {
  if (review.state !== 'CHANGES_REQUESTED') return undefined;
  return {
    author: review.author?.login ?? 'unknown',
    state: 'CHANGES_REQUESTED',
    body: typeof review.body === 'string' ? review.body : '',
    ...(typeof review.submittedAt === 'string' ? { submitted_at: review.submittedAt } : {}),
  };
}

function detectGithubIssueSide(root: string, issueNumber: string): SuccessfulIssueDetection | FailedSideDetection {
  const result = gh(['issue', 'view', issueNumber, '--json', 'comments'], root);
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

function detectGithubPrSide(root: string, issueNumber: string): SuccessfulPrDetection | FailedSideDetection {
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
    ['pr', 'view', branch, '--json', 'number,state,headRefName,latestReviews,comments'],
    root,
  );
  if (result.status !== 0) {
    if (result.stderr.toLowerCase().includes('no pull requests found')) {
      return { succeeded: true, reviews: [], comments: [] };
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
      !Array.isArray(payload.latestReviews) ||
      !Array.isArray(payload.comments)
    ) {
      throw new Error('number/state/headRefName/latestReviews/commentsが不正です');
    }
    if (payload.state !== 'OPEN') return { succeeded: true, reviews: [], comments: [] };
    return {
      succeeded: true,
      prNumber: payload.number,
      reviews: payload.latestReviews
        .map(unresolvedReview)
        .filter((review): review is UnresolvedGithubReview => review !== undefined),
      comments: payload.comments
        .map((comment) => unresolvedComment(comment, 'pr_comment'))
        .filter((comment): comment is UnresolvedGithubComment => comment !== undefined),
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
): GithubReviewStatus | FailedGithubReviewStatus | undefined {
  const issueResult = detectGithubIssueSide(root, issueNumber);
  const prResult = detectGithubPrSide(root, issueNumber);

  if (!issueResult.succeeded && !prResult.succeeded) {
    return {
      mode: 'github',
      detection: 'failed',
      reason: `issue側: ${issueResult.reason}; pr側: ${prResult.reason}`,
    };
  }

  const unresolvedReviews = prResult.succeeded ? prResult.reviews : [];
  const unresolvedComments = [
    ...(prResult.succeeded ? prResult.comments : []),
    ...(issueResult.succeeded ? issueResult.comments : []),
  ];
  const partialFailures: GithubPartialFailure[] = [];
  if (!issueResult.succeeded) partialFailures.push({ side: 'issue', reason: issueResult.reason });
  if (!prResult.succeeded) partialFailures.push({ side: 'pr', reason: prResult.reason });

  if (unresolvedReviews.length === 0 && unresolvedComments.length === 0 && partialFailures.length === 0) {
    return undefined;
  }
  return {
    mode: 'github',
    detection: 'succeeded',
    ...(prResult.succeeded && prResult.prNumber !== undefined ? { pr_number: prResult.prNumber } : {}),
    unresolved_reviews: unresolvedReviews,
    unresolved_comments: unresolvedComments,
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
