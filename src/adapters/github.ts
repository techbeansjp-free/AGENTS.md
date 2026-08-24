import fs from "node:fs";
import { run } from "../lib/process.js";
import { isRecord } from "../types.js";

interface GitHubInput {
  repository: string;
  issue: number;
  bodyFile: string;
  title: string;
  headSha: string;
  head: string;
  base: string;
  bodyLink: string;
  pr: number;
  sha: string;
  implementationCommitSha: string;
  runId: string;
  reviewId: string;
  branch: string;
  method: "merge" | "squash" | "rebase";
}
export interface PolicyAuthorityObservation {
  repository: string;
  prNumber: number;
  defaultBranch: string;
  defaultBranchTipOid: string;
  baseRefName: string;
  baseRefOid: string;
  headRefOid: string;
  provenance: { source: string; repository: string; prNumber: number };
}
interface RepositoryObservation {
  nameWithOwner?: string;
  defaultBranchRef?: { name?: string };
  viewerPermission?: string;
}
interface PullRequestObservation {
  number?: number;
  url?: string;
  headRefName?: string;
  baseRefName?: string;
  headRefOid?: string;
  baseRefOid?: string;
  author?: { id?: string };
}
interface ReviewObservation {
  state?: string;
  commit_id?: string;
  user?: { node_id?: string };
  submitted_at?: string;
  id?: string | number;
}
export interface PullRequestInspection extends PullRequestObservation {
  author?: { id?: string };
  isDraft?: boolean;
  mergeStateStatus?: string;
  statusCheckRollup?: Array<{
    conclusion?: string;
    status?: string;
    name?: string;
    context?: string;
  }>;
}
export interface ApprovalObservation {
  state?: string;
  commitSha?: string;
  actorId?: string;
  submittedAt?: string;
  reviewId?: string;
}
export interface BranchProtectionObservation {
  known: boolean;
  protected: boolean;
  value?: unknown;
  error?: string;
}
export interface CommitInspection {
  sha?: string;
  authorActorId?: string;
}
export type PullRequestCreationResult =
  | { url: string; state: "created" }
  | { url: string; state: "rollback_required"; reason: string };

function requireFullOid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/iu.test(value))
    throw new Error(`${label}は40桁の完全OIDでなければなりません`);
  return value;
}

function parseObject<T extends object>(source: string, label: string): T {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) throw new Error(`${label}がobjectではありません`);
  return parsed as T;
}

export class GitHubProviderUnavailableError extends Error {
  readonly code = "ASC_GITHUB_PROVIDER_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "GitHubProviderUnavailableError";
  }
}

/** Compare the immutable policy-authority observation tuple. */
export function samePolicyAuthorityObservation(
  left: PolicyAuthorityObservation,
  right: PolicyAuthorityObservation,
): boolean {
  const keys: Array<keyof PolicyAuthorityObservation> = [
    "repository",
    "prNumber",
    "defaultBranch",
    "defaultBranchTipOid",
    "baseRefName",
    "baseRefOid",
    "headRefOid",
  ];
  return keys.every((key) => left[key] === right[key]);
}

function observePolicyAuthority(
  repository: string,
  prNumber: number,
  cwd: string,
) {
  try {
    run("gh", ["auth", "status"], cwd);
  } catch {
    throw new GitHubProviderUnavailableError(
      "GitHub providerの認証状態を観測できません",
    );
  }
  let observedRepository: RepositoryObservation;
  let observedPr: PullRequestObservation;
  let defaultBranchTipOid: string;
  try {
    observedRepository = parseObject<RepositoryObservation>(
      run(
        "gh",
        [
          "repo",
          "view",
          repository,
          "--json",
          "nameWithOwner,defaultBranchRef",
        ],
        cwd,
      ).stdout,
      "repository観測",
    );
    observedPr = parseObject<PullRequestObservation>(
      run(
        "gh",
        [
          "pr",
          "view",
          String(prNumber),
          "--repo",
          repository,
          "--json",
          "number,baseRefName,baseRefOid,headRefOid",
        ],
        cwd,
      ).stdout,
      "PR観測",
    );
    const defaultBranch = observedRepository?.defaultBranchRef?.name;
    if (typeof defaultBranch !== "string")
      throw new Error("default branchが不明です");
    defaultBranchTipOid = run(
      "gh",
      [
        "api",
        `repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`,
        "--jq",
        ".sha",
      ],
      cwd,
    ).stdout.trim();
  } catch {
    throw new GitHubProviderUnavailableError(
      "GitHub providerのrepositoryまたはPR観測を取得できません",
    );
  }
  const complete =
    typeof observedRepository.nameWithOwner === "string" &&
    typeof observedRepository.defaultBranchRef?.name === "string" &&
    /^[a-f0-9]{40}$/iu.test(defaultBranchTipOid) &&
    typeof observedPr.number === "number" &&
    Number.isInteger(observedPr.number) &&
    typeof observedPr.baseRefName === "string" &&
    typeof observedPr.baseRefOid === "string" &&
    /^[a-f0-9]{40}$/iu.test(observedPr.baseRefOid) &&
    typeof observedPr.headRefOid === "string" &&
    /^[a-f0-9]{40}$/iu.test(observedPr.headRefOid);
  if (!complete)
    throw new GitHubProviderUnavailableError(
      "GitHub providerのauthority観測が不完全です",
    );
  if (
    typeof observedRepository.nameWithOwner !== "string" ||
    typeof observedRepository.defaultBranchRef?.name !== "string" ||
    typeof observedPr.number !== "number" ||
    typeof observedPr.baseRefName !== "string" ||
    typeof observedPr.baseRefOid !== "string" ||
    typeof observedPr.headRefOid !== "string"
  )
    throw new GitHubProviderUnavailableError(
      "GitHub providerのauthority観測を型付けできません",
    );
  return {
    provenance: { source: "github", repository, prNumber },
    repository: observedRepository.nameWithOwner,
    defaultBranch: observedRepository.defaultBranchRef.name,
    defaultBranchTipOid,
    prNumber: observedPr.number,
    baseRefName: observedPr.baseRefName,
    baseRefOid: observedPr.baseRefOid,
    headRefOid: observedPr.headRefOid,
  };
}

function verifyRepository(
  repository: string,
  cwd: string,
  access: "read" | "write",
): void {
  run("gh", ["auth", "status"], cwd);
  let observed: RepositoryObservation;
  try {
    observed = parseObject<RepositoryObservation>(
      run(
        "gh",
        [
          "repo",
          "view",
          repository,
          "--json",
          "nameWithOwner,viewerPermission",
        ],
        cwd,
      ).stdout,
      "repository観測",
    );
  } catch {
    throw new Error("GitHubリポジトリと権限の観測結果を検証できません");
  }
  if (observed.nameWithOwner !== repository)
    throw new Error(
      `GitHubリポジトリが一致しません: 期待値=${repository} 観測値=${observed.nameWithOwner || "不明"}`,
    );
  const levels = ["READ", "TRIAGE", "WRITE", "MAINTAIN", "ADMIN"];
  const observedLevel = levels.indexOf(observed.viewerPermission ?? "");
  const requiredLevel =
    access === "write" ? levels.indexOf("WRITE") : levels.indexOf("READ");
  if (observedLevel < requiredLevel)
    throw new Error(
      `対象GitHubリポジトリの${access === "write" ? "書き込み" : "読み取り"}権限が不足しています`,
    );
}

/**
 * The only GitHub CLI process boundary. Domain code and skills never invoke gh.
 */
export function github(
  operation: "issue.sync",
  input: Pick<GitHubInput, "repository" | "issue" | "bodyFile">,
  cwd: string,
): { url: string };
export function github(
  operation: "review.evidence",
  input: Pick<
    GitHubInput,
    "repository" | "pr" | "runId" | "reviewId" | "implementationCommitSha"
  >,
  cwd: string,
): Record<string, unknown>;
export function github(
  operation: "policy.authority",
  input: Pick<GitHubInput, "repository" | "pr">,
  cwd: string,
): PolicyAuthorityObservation;
export function github(
  operation: "pr.inspect",
  input: Pick<GitHubInput, "repository" | "pr">,
  cwd: string,
): PullRequestInspection;
export function github(
  operation: "pr.reviews",
  input: Pick<GitHubInput, "repository" | "pr">,
  cwd: string,
): ApprovalObservation[];
export function github(
  operation: "commit.inspect",
  input: Pick<GitHubInput, "repository" | "sha">,
  cwd: string,
): CommitInspection;
export function github(
  operation: "branch.protection",
  input: Pick<GitHubInput, "repository" | "branch">,
  cwd: string,
): BranchProtectionObservation;
export function github(
  operation: "pr.merge",
  input: Pick<GitHubInput, "repository" | "pr" | "method">,
  cwd: string,
): { state: string };
export function github(
  operation: "pr.create",
  input: Pick<
    GitHubInput,
    "repository" | "issue" | "headSha" | "head" | "base" | "bodyLink"
  > & { title?: string },
  cwd: string,
): PullRequestCreationResult;
export function github(
  operation: string,
  input: Partial<GitHubInput> & { repository: string },
  cwd: string,
): unknown;
export function github(
  operation: string,
  supplied: Partial<GitHubInput> & { repository: string },
  cwd: string,
): unknown {
  const input = supplied as GitHubInput;
  if (operation === "issue.sync") {
    verifyRepository(input.repository, cwd, "write");
    const args = [
      "issue",
      "edit",
      String(input.issue),
      "--repo",
      input.repository,
      "--body-file",
      input.bodyFile,
    ];
    run("gh", args, cwd);
    const expected = fs
      .readFileSync(input.bodyFile, "utf8")
      .replace(/\r\n/g, "\n")
      .trimEnd();
    const observed = run(
      "gh",
      [
        "issue",
        "view",
        String(input.issue),
        "--repo",
        input.repository,
        "--json",
        "body",
        "--jq",
        ".body",
      ],
      cwd,
    )
      .stdout.replace(/\r\n/g, "\n")
      .trimEnd();
    if (observed !== expected)
      throw new Error("Issue同期後の読み取り検証に失敗しました");
    return {
      url: `https://github.com/${input.repository}/issues/${input.issue}`,
    };
  }
  if (operation === "issue.create") {
    verifyRepository(input.repository, cwd, "write");
    const result = run(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        input.repository,
        "--title",
        input.title,
        "--body-file",
        input.bodyFile,
      ],
      cwd,
    );
    return { url: result.stdout.trim() };
  }
  if (operation === "pr.create") {
    verifyRepository(input.repository, cwd, "write");
    if (!/^[a-f0-9]{40}$/i.test(input.headSha ?? ""))
      throw new Error("PR対象HEAD SHAが不正です");
    const remoteHead = run(
      "gh",
      [
        "api",
        `repos/${input.repository}/commits/${encodeURIComponent(input.head)}`,
        "--jq",
        ".sha",
      ],
      cwd,
    ).stdout.trim();
    if (remoteHead !== input.headSha)
      throw new Error("PR作成前にremote branchのHEAD SHAが証拠と一致しません");
    const remoteBase = run(
      "gh",
      [
        "api",
        `repos/${input.repository}/commits/${encodeURIComponent(input.base)}`,
        "--jq",
        ".sha",
      ],
      cwd,
    ).stdout.trim();
    if (!/^[a-f0-9]{40}$/iu.test(remoteBase))
      throw new Error(
        "PR作成前にremote base branchを固定commitへ解決できません",
      );
    const result = run(
      "gh",
      [
        "pr",
        "create",
        "--repo",
        input.repository,
        "--head",
        input.head,
        "--base",
        input.base,
        "--title",
        input.title ?? `Issue #${input.issue}`,
        "--body",
        input.bodyLink,
      ],
      cwd,
    );
    const url = result.stdout.trim();
    if (
      !new RegExp(
        `^https://github\\.com/${input.repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/\\d+$`,
      ).test(url)
    )
      throw new Error("PR作成結果のURLが対象リポジトリと一致しません");
    const observed = parseObject<PullRequestObservation>(
      run(
        "gh",
        [
          "pr",
          "view",
          url,
          "--repo",
          input.repository,
          "--json",
          "url,headRefName,baseRefName,headRefOid,baseRefOid",
        ],
        cwd,
      ).stdout,
      "PR観測",
    );
    if (
      observed.url !== url ||
      observed.headRefName !== input.head ||
      observed.baseRefName !== input.base ||
      observed.headRefOid !== input.headSha ||
      observed.baseRefOid !== remoteBase
    ) {
      return {
        state: "rollback_required",
        url,
        reason:
          "PR作成後の読み取り検証に失敗しました。作成済みPRを確認してcloseまたは修正してください",
      };
    }
    return { state: "created", url };
  }
  if (operation === "pr.inspect") {
    verifyRepository(input.repository, cwd, "read");
    const result = run(
      "gh",
      [
        "pr",
        "view",
        String(input.pr),
        "--repo",
        input.repository,
        "--json",
        "number,url,author,isDraft,headRefName,baseRefName,headRefOid,baseRefOid,mergeStateStatus,reviewDecision,statusCheckRollup",
      ],
      cwd,
    );
    return parseObject<Record<string, unknown>>(result.stdout, "PR観測");
  }
  if (operation === "pr.reviews") {
    verifyRepository(input.repository, cwd, "read");
    const pages: unknown = JSON.parse(
      run(
        "gh",
        [
          "api",
          "--paginate",
          "--slurp",
          `repos/${input.repository}/pulls/${input.pr}/reviews?per_page=100`,
        ],
        cwd,
      ).stdout,
    );
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
      throw new Error("GitHub review観測がpage配列ではありません");
    return pages
      .flat()
      .filter(isRecord)
      .map((review) => {
        const typed = review as ReviewObservation;
        return {
          state: typed.state,
          commitSha: typed.commit_id,
          actorId: typed.user?.node_id,
          submittedAt: typed.submitted_at,
          reviewId: String(typed.id ?? ""),
        };
      });
  }
  if (operation === "commit.inspect") {
    verifyRepository(input.repository, cwd, "read");
    const requestedSha = requireFullOid(input.sha, "commit.inspectのSHA");
    const commit = parseObject<{ sha?: string; author?: { node_id?: string } }>(
      run(
        "gh",
        ["api", `repos/${input.repository}/commits/${requestedSha}`],
        cwd,
      ).stdout,
      "commit観測",
    );
    if (commit.sha !== requestedSha)
      throw new Error("commit.inspectの応答OIDが要求OIDと一致しません");
    return { sha: commit.sha, authorActorId: commit.author?.node_id };
  }
  if (operation === "policy.authority") {
    return observePolicyAuthority(input.repository, input.pr, cwd);
  }
  if (operation === "review.evidence") {
    verifyRepository(input.repository, cwd, "read");
    const implementationCommitSha = requireFullOid(
      input.implementationCommitSha,
      "review.evidenceの実装SHA",
    );
    const pr = parseObject<PullRequestObservation>(
      run(
        "gh",
        [
          "pr",
          "view",
          String(input.pr),
          "--repo",
          input.repository,
          "--json",
          "number,headRefOid,author",
        ],
        cwd,
      ).stdout,
      "PR観測",
    );
    const implementation = parseObject<{
      sha?: string;
      author?: { node_id?: string };
    }>(
      run(
        "gh",
        ["api", `repos/${input.repository}/commits/${implementationCommitSha}`],
        cwd,
      ).stdout,
      "commit観測",
    );
    if (implementation.sha !== implementationCommitSha)
      throw new Error("review.evidenceの実装commit OIDが要求OIDと一致しません");
    const ci = parseObject<{
      repository?: { full_name?: string };
      id?: string | number;
      event?: string;
      head_sha?: string;
      conclusion?: string;
      pull_requests?: Array<{ number?: number }>;
    }>(
      run(
        "gh",
        ["api", `repos/${input.repository}/actions/runs/${input.runId}`],
        cwd,
      ).stdout,
      "CI観測",
    );
    const review = parseObject<ReviewObservation>(
      run(
        "gh",
        [
          "api",
          `repos/${input.repository}/pulls/${input.pr}/reviews/${input.reviewId}`,
        ],
        cwd,
      ).stdout,
      "review観測",
    );
    return {
      provenance: {
        source: "github",
        repository: input.repository,
        prNumber: input.pr,
        runId: String(input.runId),
        reviewId: String(input.reviewId),
      },
      implementation: {
        repository: input.repository,
        commitSha: implementation.sha,
        authorActorId: implementation.author?.node_id,
      },
      pr: {
        repository: input.repository,
        number: pr.number,
        headSha: pr.headRefOid,
        authorActorId: pr.author?.id,
      },
      ci: {
        repository: ci.repository?.full_name,
        runId: String(ci.id ?? ""),
        event: ci.event,
        headSha: ci.head_sha,
        conclusion: String(ci.conclusion ?? "").toLowerCase(),
        pullRequestNumbers: Array.isArray(ci.pull_requests)
          ? ci.pull_requests.map((item) => item.number)
          : [],
      },
      review: {
        repository: input.repository,
        prNumber: pr.number,
        reviewId: String(review.id ?? ""),
        commitSha: review.commit_id,
        actorId: review.user?.node_id,
        submittedAt: review.submitted_at,
        verdict: String(review.state ?? "").toLowerCase(),
      },
    };
  }
  if (operation === "branch.protection") {
    verifyRepository(input.repository, cwd, "read");
    const result = run(
      "gh",
      [
        "api",
        `repos/${input.repository}/branches/${encodeURIComponent(input.branch)}/protection`,
      ],
      cwd,
      { allowFailure: true },
    );
    if (result.status === 0)
      return {
        known: true,
        protected: true,
        value: JSON.parse(result.stdout) as unknown,
      };
    if (result.status === 1 && /404|Branch not protected/i.test(result.stderr))
      return { known: true, protected: false };
    return { known: false, protected: false, error: result.stderr };
  }
  if (operation === "pr.merge") {
    verifyRepository(input.repository, cwd, "write");
    const methodFlag =
      input.method === "rebase"
        ? "--rebase"
        : input.method === "merge"
          ? "--merge"
          : "--squash";
    run(
      "gh",
      [
        "pr",
        "merge",
        String(input.pr),
        "--repo",
        input.repository,
        methodFlag,
        "--auto",
      ],
      cwd,
    );
    return { state: "merge_or_native_auto_merge_requested" };
  }
  throw new Error(`未対応のGitHub操作です: ${operation}`);
}
