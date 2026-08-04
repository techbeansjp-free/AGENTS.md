import { gh, git } from './exec.js';
import { findOpenPrByHead } from './gh-open-pr.js';
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

export interface UnresolvedGithubReview {
  author: string;
  state: 'CHANGES_REQUESTED';
  body: string;
  submitted_at?: string;
}

export interface UnresolvedGithubComment {
  source: 'pr' | 'issue';
  author: string;
  body: string;
  created_at: string;
  url?: string;
}

export interface GithubReviewStatus {
  mode: 'github';
  detection: 'succeeded';
  pr_number: number;
  since: string;
  unresolved_reviews: UnresolvedGithubReview[];
  unresolved_comments: UnresolvedGithubComment[];
}

export interface FailedReviewStatus {
  mode: 'github';
  detection: 'failed';
  reason: string;
}

export interface GateFinding {
  severity: string;
  origin: string;
  code: string;
  evidence: string[];
}

export interface LocalReviewStatus {
  mode: 'local';
  detection: 'succeeded';
  gate: string;
  unresolved_blocking_findings: GateFinding[];
}

export type ReviewStatus = GithubReviewStatus | FailedReviewStatus | LocalReviewStatus;

interface GithubReviewPayload {
  latestReviews: GithubReview[];
  comments: GithubComment[];
}

interface GithubIssuePayload {
  comments: GithubComment[];
}

interface LocalGateReport {
  gate?: {
    blockers?: GateFinding[];
  };
}

function failureReason(context: string, stderr: string): string {
  const detail = stderr.trim().slice(0, 200);
  return detail ? `${context}: ${detail}` : context;
}

function isAutomationMarker(body: string): boolean {
  return body.trimStart().startsWith('<!-- agent-skill-chain:');
}

function parseGithubPayloads(prJson: string, issueJson: string): {
  reviews: GithubReview[];
  prComments: GithubComment[];
  issueComments: GithubComment[];
} {
  const pr = JSON.parse(prJson) as GithubReviewPayload;
  const issue = JSON.parse(issueJson) as GithubIssuePayload;
  if (!Array.isArray(pr.latestReviews) || !Array.isArray(pr.comments) || !Array.isArray(issue.comments)) {
    throw new Error('GitHub review status JSON に必要な配列がありません');
  }
  return { reviews: pr.latestReviews, prComments: pr.comments, issueComments: issue.comments };
}

function unresolvedComment(comment: GithubComment, source: 'pr' | 'issue', since: string): UnresolvedGithubComment | undefined {
  if (typeof comment.body !== 'string' || typeof comment.createdAt !== 'string') return undefined;
  const commentTime = Date.parse(comment.createdAt);
  const sinceTime = Date.parse(since);
  if (!Number.isFinite(commentTime) || !Number.isFinite(sinceTime) || commentTime <= sinceTime || isAutomationMarker(comment.body)) {
    return undefined;
  }
  return {
    source,
    author: comment.author?.login ?? 'unknown',
    body: comment.body,
    created_at: comment.createdAt,
    ...(typeof comment.url === 'string' ? { url: comment.url } : {}),
  };
}

/**
 * GitHub側の最新review stateと直近commit後のコメントを、workerが再開時に
 * 確認すべき調整状態として抽出する。該当がなければプロンプトを増やさない。
 */
export function detectGithubReviewStatus(root: string, issueNumber: string): GithubReviewStatus | FailedReviewStatus | undefined {
  const branch = resolveCurrentBranch(root);
  if (!branch) {
    return { mode: 'github', detection: 'failed', reason: '現在のブランチ名を解決できません' };
  }

  const pr = findOpenPrByHead(root, branch);
  if (!pr) return undefined;

  const commit = git(['log', '-1', '--format=%cI', 'HEAD'], root);
  if (commit.status !== 0 || !commit.stdout.trim()) {
    return {
      mode: 'github',
      detection: 'failed',
      reason: failureReason('直近commit時刻の取得に失敗しました', commit.stderr),
    };
  }
  const since = commit.stdout.trim();

  const prResult = gh(['pr', 'view', String(pr.number), '--json', 'latestReviews,comments'], root);
  if (prResult.status !== 0) {
    return {
      mode: 'github',
      detection: 'failed',
      reason: failureReason(`PR #${pr.number} のレビュー・コメント取得に失敗しました`, prResult.stderr),
    };
  }
  const issueResult = gh(['issue', 'view', issueNumber, '--json', 'comments'], root);
  if (issueResult.status !== 0) {
    return {
      mode: 'github',
      detection: 'failed',
      reason: failureReason(`ISSUE-${issueNumber} のコメント取得に失敗しました`, issueResult.stderr),
    };
  }

  let payloads: ReturnType<typeof parseGithubPayloads>;
  try {
    payloads = parseGithubPayloads(prResult.stdout, issueResult.stdout);
  } catch (error) {
    return {
      mode: 'github',
      detection: 'failed',
      reason: `GitHub review status JSON の解釈に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const unresolvedReviews = payloads.reviews
    .filter((review) => review.state === 'CHANGES_REQUESTED')
    .map((review): UnresolvedGithubReview => ({
      author: review.author?.login ?? 'unknown',
      state: 'CHANGES_REQUESTED',
      body: typeof review.body === 'string' ? review.body : '',
      ...(typeof review.submittedAt === 'string' ? { submitted_at: review.submittedAt } : {}),
    }));
  const unresolvedComments = [
    ...payloads.prComments.map((comment) => unresolvedComment(comment, 'pr', since)),
    ...payloads.issueComments.map((comment) => unresolvedComment(comment, 'issue', since)),
  ].filter((comment): comment is UnresolvedGithubComment => comment !== undefined);

  if (unresolvedReviews.length === 0 && unresolvedComments.length === 0) return undefined;
  return {
    mode: 'github',
    detection: 'succeeded',
    pr_number: pr.number,
    since,
    unresolved_reviews: unresolvedReviews,
    unresolved_comments: unresolvedComments,
  };
}

/** ローカルgate reportに残るorigin付きblocking findingだけを抽出する。 */
export function detectLocalBlockingFindings(
  root: string,
  issueNumber: string,
  segment: string,
): LocalReviewStatus | undefined {
  try {
    const report = tryReadYamlFile<LocalGateReport>(reviewFilePath(root, issueNumber, segment));
    const findings = (report?.gate?.blockers ?? []).filter(
      (finding) => finding?.severity === 'blocking' && typeof finding.origin === 'string' && finding.origin.length > 0,
    );
    if (findings.length === 0) return undefined;
    return {
      mode: 'local',
      detection: 'succeeded',
      gate: segment,
      unresolved_blocking_findings: findings,
    };
  } catch {
    return undefined;
  }
}

/** 検出結果をrole contractと同じYAML形式の起動プロンプトブロックへ整形する。 */
export function formatReviewStatusBlock(data: ReviewStatus): string {
  const indented = toYamlString(data)
    .trimEnd()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `review_status:\n${indented}`;
}
