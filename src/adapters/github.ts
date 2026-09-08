import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/process.js";
import { isRecord } from "../types.js";

/**
 * merge方式をgh CLIのflagへ写す。
 *
 * **未知値は例外にする。既定値を持たせない。** 以前は`merge`と`rebase`以外を
 * すべて`--squash`へ倒しており、値を解決できなかった場合に取り込み先branch上の
 * commitの親が1個になって`audit:check`の2区間導出が壊れる事象が、診断なしで
 * 起きていた。
 *
 * **squashの受理可否はここで決めない。** 方式の許可は`resolveMergeMethod`が
 * project policyの`merge.methods`と長命branchペア判定で決める。adapterが
 * 宣言済みの方式を上書きすると、policyで許可した構成が実行段で不能になる。
 */
function mergeMethodFlag(method: string): "--merge" | "--rebase" | "--squash" {
  if (method === "merge") return "--merge";
  if (method === "rebase") return "--rebase";
  if (method === "squash") return "--squash";
  throw new Error(
    `merge方式を解決できません: ${method}。merge、rebase、squashのいずれかを指定してください`,
  );
}

interface GitHubInput {
  repository: string;
  issue: number;
  bodyFile: string;
  title: string;
  headSha: string;
  head: string;
  base: string;
  body: string;
  pr: number;
  sha: string;
  descendantSha: string;
  baseSha: string;
  implementationCommitSha: string;
  runId: string;
  reviewId: string;
  branch: string;
  method: "merge" | "squash" | "rebase";
  readBackSettle: ReadBackSettle;
}

/**
 * PR作成直後の読み戻しを、closing Issue索引が確定するまで有界で待つ設定
 * （Issue #1271）。
 *
 * **上限は回数と経過時間の両方で閉じる。** 片方だけでは、待機の実装を誤ったときに
 * 無期限へ倒れる経路が残る。**既定値は暫定である。** 根拠は2026-09-08の1点観測
 * （索引反映まで約16秒）だけであり、分布は測っていない。
 */
export interface ReadBackSettle {
  /** read-backの最大試行回数。1なら待たない */
  readonly maxAttempts: number;
  /** 試行と試行のあいだの待機ms。要素が尽きたら最後の値を使う */
  readonly delaysMs: readonly number[];
  /** 待機の総経過上限ms */
  readonly maxElapsedMs: number;
}

/**
 * **既定値をadapter内に1箇所だけ持つ**（Issue #1271）。
 *
 * CLI flag、project choice、環境変数へ出さない。**利用側が上限を伸ばせると、
 * 未確定の索引を待ち続ける経路が製品の外から作れる。**
 */
export const DEFAULT_READ_BACK_SETTLE: ReadBackSettle = Object.freeze({
  maxAttempts: 6,
  delaysMs: Object.freeze([1000, 2000, 4000, 8000, 16000]),
  maxElapsedMs: 40000,
});

/**
 * event loopを進めずに待つ。**`sleep`等のexecutableへ依存しない**（Issue #1271）。
 *
 * CLIは同期実行であり、`await`できる呼び出し元が存在しない。
 */
function waitSync(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
export interface RepositoryAuthorityObservation {
  repository: string;
  defaultBranch: string;
  defaultBranchTipOid: string;
  provenance: { source: string; repository: string };
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
export type MergeQueueEntryState =
  "AWAITING_CHECKS" | "LOCKED" | "MERGEABLE" | "QUEUED" | "UNMERGEABLE";
export interface PullRequestQueueObservation {
  repository: string;
  prNumber: number;
  headRefOid: string;
  entry: {
    id: string;
    state: MergeQueueEntryState;
    enqueuedAt: string;
    headCommitOid: string;
    baseCommitOid: string;
  } | null;
}
interface RepositoryObservation {
  nameWithOwner?: string;
  defaultBranchRef?: { name?: string };
  viewerPermission?: string;
}
interface PullRequestObservation {
  number?: number;
  url?: string;
  title?: string;
  body?: string;
  state?: string;
  mergedAt?: string;
  mergeCommit?: { oid?: string };
  autoMergeRequest?: unknown;
  headRefName?: string;
  baseRefName?: string;
  headRefOid?: string;
  baseRefOid?: string;
  headRepository?: { nameWithOwner?: string };
  isCrossRepository?: boolean;
  author?: { id?: string };
  closingIssuesReferences?: Array<{ number?: number; url?: string }>;
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
    state?: string;
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
export interface PullRequestCiObservation {
  repository: string;
  runId: string;
  event: string;
  headSha: string;
  conclusion: string;
  /** `queued` / `in_progress` / `completed`。配送判定に使う（Issue #969）。 */
  status: string;
  pullRequestNumbers: number[];
}
/**
 * 固定run IDで読んだ単一runの観測。
 *
 * **`pr.ci-runs`の一覧観測とは別の型である。** 一覧はmerge前の選別に使い、
 * こちらはmerge後の固定identity照合だけに使う。`headRepository`は一覧観測に無く、
 * **fork由来のrunを排除するために増やした**（Issue #1280）。
 */
export interface FixedCiRunObservation {
  runId: string;
  repository: string;
  headRepository: string;
  event: string;
  headSha: string;
  headBranch: string;
  status: string;
  conclusion: string;
  pullRequestNumbers: number[];
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
export interface CommitTopologyObservation {
  repository: string;
  sha: string;
  treeSha: string;
  parentShas: string[];
}
export interface CommitAncestryObservation {
  repository: string;
  ancestorSha: string;
  descendantSha: string;
  status: string;
  isAncestor: boolean;
}
export interface RefInspection {
  branch: string;
  sha: string;
}
export type PullRequestCreationResult =
  | { url: string; state: "created"; observation: PullRequestInspection }
  | {
      url: string;
      state: "rollback_required";
      reason: string;
      observation?: PullRequestInspection;
    };

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

export function canonicalProviderInstant(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string") throw new Error(`${label}が不正です`);
  const parsed = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    !Number.isFinite(parsed)
  )
    throw new Error(`${label}が不正です`);
  return new Date(parsed).toISOString();
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

function observeRepositoryAuthority(
  repository: string,
  cwd: string,
): RepositoryAuthorityObservation {
  try {
    run("gh", ["auth", "status"], cwd);
  } catch {
    throw new GitHubProviderUnavailableError(
      "GitHub providerの認証状態を観測できません",
    );
  }
  try {
    const observed = parseObject<RepositoryObservation>(
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
      "repository authority観測",
    );
    if (
      observed.nameWithOwner !== repository ||
      typeof observed.defaultBranchRef?.name !== "string"
    )
      throw new Error("repository authorityのidentityが不完全です");
    const defaultBranchTipOid = requireFullOid(
      run(
        "gh",
        [
          "api",
          `repos/${repository}/commits/${encodeURIComponent(observed.defaultBranchRef.name)}`,
          "--jq",
          ".sha",
        ],
        cwd,
      ).stdout.trim(),
      "provider default branch tip",
    );
    return {
      provenance: { source: "github", repository },
      repository: observed.nameWithOwner,
      defaultBranch: observed.defaultBranchRef.name,
      defaultBranchTipOid,
    };
  } catch (error) {
    if (error instanceof GitHubProviderUnavailableError) throw error;
    throw new GitHubProviderUnavailableError(
      `GitHub providerのrepository authorityを観測できません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const EXACT_PULL_REQUEST_QUEUE_QUERY = `query ExactPullRequestQueue($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){nameWithOwner pullRequest(number:$number){number headRefOid mergeQueueEntry{id state enqueuedAt headCommit{oid} baseCommit{oid} pullRequest{number}}}}}`;

/**
 * PR creation recovery must prove exact absence before it may consume a dispatch
 * claim. `gh pr list --limit N` cannot prove absence because a matching historic
 * PR may exist after the client-side limit. Keep the cursor and pageInfo in this
 * query so `gh api --paginate --slurp` exhausts the provider connection.
 */
const EXACT_PULL_REQUESTS_QUERY = `query ExactPullRequests($owner:String!,$repo:String!,$head:String!,$base:String!,$endCursor:String){repository(owner:$owner,name:$repo){nameWithOwner pullRequests(first:100,after:$endCursor,headRefName:$head,baseRefName:$base,states:[OPEN,CLOSED,MERGED]){nodes{number url title body state mergedAt headRefName baseRefName headRefOid baseRefOid headRepository{nameWithOwner} isCrossRepository closingIssuesReferences(first:100){nodes{number url}}}pageInfo{hasNextPage endCursor}}}}`;

function observePullRequestQueue(
  repository: string,
  prNumber: number,
  cwd: string,
): PullRequestQueueObservation {
  verifyRepository(repository, cwd, "read");
  const [owner, name, ...rest] = repository.split("/");
  if (!owner || !name || rest.length > 0)
    throw new Error("merge queue観測のrepositoryが不正です");
  const response = parseObject<{
    data?: {
      repository?: {
        nameWithOwner?: string;
        pullRequest?: {
          number?: number;
          headRefOid?: string;
          mergeQueueEntry?: null | {
            id?: string;
            state?: string;
            enqueuedAt?: string;
            headCommit?: { oid?: string };
            baseCommit?: { oid?: string };
            pullRequest?: { number?: number };
          };
        };
      };
    };
  }>(
    run(
      "gh",
      [
        "api",
        "graphql",
        "-f",
        `query=${EXACT_PULL_REQUEST_QUEUE_QUERY}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `repo=${name}`,
        "-F",
        `number=${prNumber}`,
      ],
      cwd,
    ).stdout,
    "merge queue観測",
  );
  const observedRepository = response.data?.repository;
  const observedPr = observedRepository?.pullRequest;
  if (
    observedRepository?.nameWithOwner !== repository ||
    observedPr?.number !== prNumber
  )
    throw new Error("merge queue観測のrepositoryまたはPRが一致しません");
  const headRefOid = requireFullOid(
    observedPr.headRefOid,
    "merge queue観測のPR HEAD",
  );
  const entry = observedPr.mergeQueueEntry;
  if (entry === null) return { repository, prNumber, headRefOid, entry: null };
  if (!isRecord(entry))
    throw new Error("merge queue entryを決定的に観測できません");
  const states = new Set<MergeQueueEntryState>([
    "AWAITING_CHECKS",
    "LOCKED",
    "MERGEABLE",
    "QUEUED",
    "UNMERGEABLE",
  ]);
  if (
    typeof entry.id !== "string" ||
    entry.id.trim() === "" ||
    !states.has(entry.state as MergeQueueEntryState) ||
    entry.pullRequest?.number !== prNumber
  )
    throw new Error("merge queue entryのidentityが不完全です");
  const headCommitOid = requireFullOid(
    entry.headCommit?.oid,
    "merge queue entryのHEAD",
  );
  if (headCommitOid !== headRefOid)
    throw new Error("merge queue entryのHEADがPR HEADと一致しません");
  return {
    repository,
    prNumber,
    headRefOid,
    entry: {
      id: entry.id,
      state: entry.state as MergeQueueEntryState,
      enqueuedAt: canonicalProviderInstant(
        entry.enqueuedAt,
        "merge queue entryのenqueuedAt",
      ),
      headCommitOid,
      baseCommitOid: requireFullOid(
        entry.baseCommit?.oid,
        "merge queue entryのbase commit",
      ),
    },
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
  operation: "issue.read",
  input: Pick<GitHubInput, "repository" | "issue">,
  cwd: string,
): {
  repository: string;
  issue: number;
  body: string;
  bodySha256: string;
};
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
  operation: "repository.authority",
  input: Pick<GitHubInput, "repository">,
  cwd: string,
): RepositoryAuthorityObservation;
export function github(
  operation: "pr.inspect",
  input: Pick<GitHubInput, "repository" | "pr">,
  cwd: string,
): PullRequestInspection;
export function github(
  operation: "pr.find",
  input: Pick<GitHubInput, "repository" | "head" | "base">,
  cwd: string,
): PullRequestInspection[];
export function github(
  operation: "pr.queue",
  input: Pick<GitHubInput, "repository" | "pr">,
  cwd: string,
): PullRequestQueueObservation;
export function github(
  operation: "commit.topology",
  input: Pick<GitHubInput, "repository" | "sha">,
  cwd: string,
): CommitTopologyObservation;
export function github(
  operation: "commit.ancestry",
  input: Pick<GitHubInput, "repository" | "sha" | "descendantSha">,
  cwd: string,
): CommitAncestryObservation;
export function github(
  operation: "pr.reviews",
  input: Pick<GitHubInput, "repository" | "pr">,
  cwd: string,
): ApprovalObservation[];
export function github(
  operation: "pr.ci-runs",
  input: Pick<GitHubInput, "repository" | "pr" | "headSha">,
  cwd: string,
): PullRequestCiObservation[];
export function github(
  operation: "pr.ci-run",
  input: Pick<GitHubInput, "repository" | "runId">,
  cwd: string,
): FixedCiRunObservation;
export function github(
  operation: "commit.inspect",
  input: Pick<GitHubInput, "repository" | "sha">,
  cwd: string,
): CommitInspection;
export function github(
  operation: "ref.inspect",
  input: Pick<GitHubInput, "repository" | "branch">,
  cwd: string,
): RefInspection;
export function github(
  operation: "branch.protection",
  input: Pick<GitHubInput, "repository" | "branch">,
  cwd: string,
): BranchProtectionObservation;
export function github(
  operation: "repository.assert-write",
  input: Pick<GitHubInput, "repository">,
  cwd: string,
): { repository: string; writable: true };
export function github(
  operation: "pr.merge",
  input: Pick<GitHubInput, "repository" | "pr" | "method" | "headSha">,
  cwd: string,
): { state: string };
export function github(
  operation: "pr.create",
  input: Pick<
    GitHubInput,
    | "repository"
    | "issue"
    | "headSha"
    | "head"
    | "base"
    | "baseSha"
    | "title"
    | "body"
  > & { onDispatch: () => boolean; readBackSettle?: ReadBackSettle },
  cwd: string,
): PullRequestCreationResult;
export function github(
  operation: string,
  input: Partial<GitHubInput> & { repository: string },
  cwd: string,
): unknown;
export function github(
  operation: string,
  supplied: Partial<GitHubInput> & {
    repository: string;
    onDispatch?: () => boolean;
  },
  cwd: string,
): unknown {
  const input = supplied as GitHubInput & { onDispatch?: () => boolean };
  if (operation === "issue.read") {
    /**
     * **更新前のIssue本文を読む唯一の経路である。**
     *
     * `issue.sync`は本文を全面置換する。既存のチェックリストや進捗記録を保全
     * するには更新前の本文が要るが、skillは`gh`の直接呼び出しを禁じている
     * （`step-04-issue-sync/SKILL.md`）。読み取り経路が無いと、この2つを
     * 同時に満たせない。
     *
     * 書き込みを行わないため`repository read`で足りる。
     */
    verifyRepository(input.repository, cwd, "read");
    const body = run(
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
    ).stdout.replace(/\r\n/g, "\n");
    return {
      repository: input.repository,
      issue: input.issue,
      body,
      bodySha256: crypto
        .createHash("sha256")
        .update(body, "utf8")
        .digest("hex"),
    };
  }
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
  if (operation === "repository.assert-write") {
    verifyRepository(input.repository, cwd, "write");
    return { repository: input.repository, writable: true };
  }
  if (operation === "repository.authority") {
    return observeRepositoryAuthority(input.repository, cwd);
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
    const expectedBaseSha = requireFullOid(input.baseSha, "PR対象base SHA");
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
    if (remoteBase !== expectedBaseSha)
      throw new Error(
        "PR作成前にremote base branchのHEAD SHAが準備済み証拠と一致しません",
      );
    /**
     * **本文はfile経由で渡す。** argvの上限は約131KBで、template構造を満たす本文は
     * 改行と記号を多く含む。`--body`へ直接載せると上限と引用の扱いに依存する。
     */
    const bodyDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "asc-pr-body-"),
    );
    const composedBodyFile = path.join(bodyDirectory, "body.md");
    fs.writeFileSync(composedBodyFile, `${input.body}\n`);
    /**
     * **成功時も例外時も一時fileを残さない。** `gh`はfileを同期的に読み切るため、
     * 呼び出し直後に消してよい。残すと`pr create`のたびにtmpへ本文が蓄積する。
     */
    let created: ReturnType<typeof run>;
    try {
      /**
       * **claimはprovider要求の直前でだけ消費する**（Issue #1157）。
       *
       * 以前はCLIがclaimを消費してからこのadapterを呼び、adapterの第1文の
       * `verifyRepository`（内部で`gh auth status`）で落ちていた。**変更要求を1度も
       * 送っていないのに「成否を断定できない」としてstagingが恒久的に停止していた。**
       *
       * `01_開発ワークフロー.md`はprovider call直前のclaimを定めている。ここが
       * 「最終再検証に成功した同じ呼び出しだけが一度実行できる」境界である。
       * **`onDispatch`を任意にしない。** 任意にすると、claimを取らずに変更要求を
       * 送れるprimitiveが公開され、並行実行で重複PRを作れる。
       *
       * **型で必須にしたうえで実行時も確かめる。** overloadは`pr.create`へ
       * `onDispatch`を必須にしているが、実装signatureは全operation共通のため
       * 省略が型で止まらない経路が残る。**fail-closedで拒否する。**
       *
       * **本文を書いた後・`gh`を起動する前に置く。** `try`の外へ出すと、gateが
       * 拒否したときにPR本文を含む一時領域が残る（外部reviewer指摘）。前へ出すと、
       * 本文書き込みの失敗がclaim消費後に起きて同じ欠陥を再現する。
       */
      if (typeof input.onDispatch !== "function")
        throw new Error("PR createにはdispatch claimの受け渡しが必要です");
      if (!input.onDispatch())
        throw new Error(
          "PR create dispatch claimは既に消費済みのためprovider createを再送しません",
        );
      created = run(
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
          input.title,
          "--body-file",
          composedBodyFile,
        ],
        cwd,
      );
    } finally {
      fs.rmSync(bodyDirectory, { recursive: true, force: true });
    }
    const result = created;
    const url = result.stdout.trim();
    const urlMatch = new RegExp(
      `^https://github\\.com/${input.repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/([1-9]\\d*)$`,
      "iu",
    ).exec(url);
    if (!urlMatch)
      throw new Error("PR作成結果のURLが対象リポジトリと一致しません");
    const expectedBody = input.body.replace(/\r\n/g, "\n").trimEnd();
    /**
     * **closing以外のidentityは各観測で照合する**（Issue #1271）。
     *
     * loopの後で1回だけ照合すると、**1回目の不一致が2回目の正常な観測で
     * 洗い流される。** 待機中は認可済みの別writerがtitleやbodyを変更しうる。
     * REQ-GH-001はこの競合を予防できず事後検出すると定めており、検出の位置は
     * 各観測でなければならない。
     */
    const coreIdentityMatches = (observation: PullRequestInspection): boolean =>
      observation.number === Number(urlMatch[1]) &&
      observation.url === url &&
      observation.title === input.title &&
      observation.body?.replace(/\r\n/g, "\n").trimEnd() === expectedBody &&
      observation.headRefName === input.head &&
      observation.baseRefName === input.base &&
      observation.headRefOid === input.headSha &&
      observation.baseRefOid === remoteBase &&
      observation.headRepository?.nameWithOwner?.toLowerCase() ===
        input.repository.toLowerCase() &&
      observation.isCrossRepository === false;
    /**
     * **closing Issue索引の反映を有界で待つ**（Issue #1271）。
     *
     * `gh pr create`の直後は、GitHubがPR本文を解釈して作る
     * `closingIssuesReferences`がまだ空で返る。**これは「1件もcloseしない」
     * という確定した判定ではなく未確定である。** 1回だけ読んで空を返すと、
     * 後段の`assertPullRequestTrackerBinding`が必ず拒否し、`pr create`の
     * 1回目が確定的に失敗していた。
     *
     * **待つのは厳密に空配列のときだけである。** 非空、配列でない、identity
     * 不一致はいずれも確定した観測として即座に停止する。**空を成功へ倒す経路は
     * 作らない。** 上限に達したら最後の観測をそのまま返し、受理述語が今日と
     * 同じように拒否する。
     *
     * **繰り返すのは`gh pr view`だけである。** `gh pr create`は再送しない
     * （`01_開発ワークフロー.md`のclaim消費規則）。
     */
    const settle = input.readBackSettle ?? DEFAULT_READ_BACK_SETTLE;
    /**
     * **単調時計を使う**（Issue #1271）。`Date.now()`はNTP補正で後退しうる。
     * 後退すると経過の上限が発火せず、回数上限だけが停止条件になる。
     * **上限を2つ置く意味が半分失われる。**
     */
    const startedAt = process.hrtime.bigint();
    let observed: PullRequestInspection;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        observed = parseObject<PullRequestInspection>(
          run(
            "gh",
            [
              "pr",
              "view",
              url,
              "--repo",
              input.repository,
              "--json",
              "number,url,title,body,headRefName,baseRefName,headRefOid,baseRefOid,headRepository,isCrossRepository,closingIssuesReferences",
            ],
            cwd,
          ).stdout,
          "PR観測",
        );
      } catch (error) {
        /** **読み取りの失敗はsettleの対象にしない。** 未確定ではなく異常である。 */
        return {
          state: "rollback_required",
          url,
          reason: `PR作成後の読み取り検証に失敗しました。作成済みPRを確認してcloseまたは修正してください: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (!coreIdentityMatches(observed))
        return {
          state: "rollback_required",
          url,
          reason:
            "PR作成後の読み取り検証に失敗しました。作成済みPRを確認してcloseまたは修正してください",
          observation: observed,
        };
      const closing = observed.closingIssuesReferences;
      /**
       * **配列でない観測をsettleの対象にしない。** field欠落や`null`は
       * 索引の未反映ではなく、trusted providerから観測できていない状態である。
       */
      if (!Array.isArray(closing) || closing.length > 0) break;
      if (attempt >= settle.maxAttempts) break;
      const delay =
        settle.delaysMs[Math.min(attempt - 1, settle.delaysMs.length - 1)] ?? 0;
      const elapsedMs = Number(
        (process.hrtime.bigint() - startedAt) / 1000000n,
      );
      if (elapsedMs + delay > settle.maxElapsedMs) break;
      waitSync(delay);
    }
    return { state: "created", url, observation: observed };
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
        "number,url,title,body,state,mergedAt,mergeCommit,autoMergeRequest,author,isDraft,headRefName,baseRefName,headRefOid,baseRefOid,headRepository,isCrossRepository,mergeStateStatus,reviewDecision,statusCheckRollup,closingIssuesReferences",
      ],
      cwd,
    );
    return parseObject<Record<string, unknown>>(result.stdout, "PR観測");
  }
  if (operation === "pr.find") {
    verifyRepository(input.repository, cwd, "read");
    if (
      typeof input.head !== "string" ||
      typeof input.base !== "string" ||
      input.head.trim() === "" ||
      input.base.trim() === "" ||
      input.head.startsWith("-") ||
      input.base.startsWith("-") ||
      input.head.includes("..") ||
      input.base.includes("..")
    )
      throw new Error("pr.findのheadまたはbase branch名が不正です");
    const [owner, name, ...rest] = input.repository.split("/");
    if (!owner || !name || rest.length > 0)
      throw new Error("pr.findのrepositoryが不正です");
    const parsed: unknown = JSON.parse(
      run(
        "gh",
        [
          "api",
          "graphql",
          "--paginate",
          "--slurp",
          "-f",
          `query=${EXACT_PULL_REQUESTS_QUERY}`,
          "-f",
          `owner=${owner}`,
          "-f",
          `repo=${name}`,
          "-f",
          `head=${input.head}`,
          "-f",
          `base=${input.base}`,
        ],
        cwd,
      ).stdout,
    );
    if (!Array.isArray(parsed) || parsed.length === 0)
      throw new Error("PR検索結果がpage配列ではありません");
    const observations: PullRequestInspection[] = [];
    for (const [pageIndex, rawPage] of parsed.entries()) {
      if (!isRecord(rawPage) || !isRecord(rawPage.data))
        throw new Error(`PR検索結果page ${pageIndex + 1}が不正です`);
      const repository = rawPage.data.repository;
      if (
        !isRecord(repository) ||
        repository.nameWithOwner !== input.repository ||
        !isRecord(repository.pullRequests) ||
        !Array.isArray(repository.pullRequests.nodes)
      )
        throw new Error(
          `PR検索結果page ${pageIndex + 1}のrepositoryが不正です`,
        );
      const pageInfo = repository.pullRequests.pageInfo;
      const finalPage = pageIndex === parsed.length - 1;
      if (
        !isRecord(pageInfo) ||
        typeof pageInfo.hasNextPage !== "boolean" ||
        (pageInfo.endCursor !== null &&
          (typeof pageInfo.endCursor !== "string" ||
            pageInfo.endCursor === "")) ||
        pageInfo.hasNextPage === finalPage ||
        (pageInfo.hasNextPage && typeof pageInfo.endCursor !== "string")
      )
        throw new Error(
          `PR検索結果page ${pageIndex + 1}のpaginationが完結していません`,
        );
      for (const rawNode of repository.pullRequests.nodes) {
        if (!isRecord(rawNode))
          throw new Error("PR検索結果nodeがobjectではありません");
        if (
          !Number.isSafeInteger(rawNode.number) ||
          Number(rawNode.number) < 1 ||
          typeof rawNode.url !== "string" ||
          typeof rawNode.title !== "string" ||
          typeof rawNode.body !== "string" ||
          (rawNode.state !== "OPEN" &&
            rawNode.state !== "CLOSED" &&
            rawNode.state !== "MERGED") ||
          (rawNode.mergedAt !== null && typeof rawNode.mergedAt !== "string") ||
          typeof rawNode.headRefName !== "string" ||
          rawNode.headRefName === "" ||
          typeof rawNode.baseRefName !== "string" ||
          rawNode.baseRefName === "" ||
          !isRecord(rawNode.headRepository) ||
          typeof rawNode.headRepository.nameWithOwner !== "string" ||
          rawNode.headRepository.nameWithOwner === "" ||
          typeof rawNode.isCrossRepository !== "boolean"
        )
          throw new Error("PR検索結果nodeの必須fieldが不正です");
        requireFullOid(rawNode.headRefOid, "PR検索結果nodeのhead OID");
        requireFullOid(rawNode.baseRefOid, "PR検索結果nodeのbase OID");
        if (typeof rawNode.mergedAt === "string")
          canonicalProviderInstant(
            rawNode.mergedAt,
            "PR検索結果nodeのmergedAt",
          );
        const closingConnection = rawNode.closingIssuesReferences;
        if (
          !isRecord(closingConnection) ||
          !Array.isArray(closingConnection.nodes) ||
          closingConnection.nodes.some(
            (item) =>
              !isRecord(item) ||
              !Number.isSafeInteger(item.number) ||
              Number(item.number) < 1 ||
              typeof item.url !== "string" ||
              item.url === "",
          )
        )
          throw new Error("PR検索結果のclosing Issue接続が不正です");
        observations.push({
          ...(rawNode as PullRequestInspection),
          closingIssuesReferences: closingConnection.nodes as Array<{
            number?: number;
            url?: string;
          }>,
        });
      }
    }
    return observations;
  }
  if (operation === "pr.queue") {
    return observePullRequestQueue(input.repository, input.pr, cwd);
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
    const reviews: unknown[] = pages.flat();
    if (reviews.some((review) => !isRecord(review)))
      throw new Error("GitHub review観測にobjectでないeventがあります");
    return reviews.flatMap((review) => {
      const typed = review as ReviewObservation;
      // REST exposes draft reviews as PENDING with submitted_at=null. They
      // are not review-state events and cannot grant or revoke approval.
      if (typed.state === "PENDING") return [];
      return [
        {
          state: typed.state,
          commitSha: typed.commit_id,
          actorId: typed.user?.node_id,
          submittedAt: typed.submitted_at,
          reviewId: String(typed.id ?? ""),
        },
      ];
    });
  }
  if (operation === "pr.ci-runs") {
    verifyRepository(input.repository, cwd, "read");
    const headSha = requireFullOid(input.headSha, "pr.ci-runsのHEAD SHA");
    const pages: unknown = JSON.parse(
      run(
        "gh",
        [
          "api",
          "--paginate",
          "--slurp",
          /**
           * **成否で絞り込まない**（Issue #969）。`status=success`を付けると、
           * run未生成・実行中・失敗がすべて同じ「該当0件」へ潰れ、
           * 待つべきか人を呼ぶべきかを判定できない。**絞り込みは呼び出し側の
           * 純関数が行う。** 成功判定そのものは従来どおり呼び出し側にある。
           */
          `repos/${input.repository}/actions/runs?event=pull_request&head_sha=${headSha}&per_page=100`,
        ],
        cwd,
      ).stdout,
    );
    if (!Array.isArray(pages))
      throw new Error("GitHub Actions run観測がpage object配列ではありません");
    const pageRecords = pages.filter(isRecord);
    if (pageRecords.length !== pages.length)
      throw new Error("GitHub Actions run観測がpage object配列ではありません");
    const runs = pageRecords.flatMap((page): unknown[] => {
      const observed: unknown = page.workflow_runs;
      if (!Array.isArray(observed))
        throw new Error(
          "GitHub Actions run観測のworkflow_runsが配列ではありません",
        );
      return observed;
    });
    if (runs.some((run) => !isRecord(run)))
      throw new Error("GitHub Actions run観測にobjectでないrunがあります");
    return runs.map((rawRun) => {
      const run = rawRun as Record<string, unknown>;
      if (
        !isRecord(run.repository) ||
        typeof run.repository.full_name !== "string" ||
        !Array.isArray(run.pull_requests) ||
        run.pull_requests.some(
          (pullRequest) =>
            !isRecord(pullRequest) ||
            !Number.isSafeInteger(pullRequest.number) ||
            Number(pullRequest.number) < 1,
        )
      )
        throw new Error("GitHub Actions run観測のidentityが不正です");
      return {
        repository: run.repository.full_name,
        runId: String(run.id ?? ""),
        event: String(run.event ?? ""),
        headSha: String(run.head_sha ?? ""),
        conclusion: String(run.conclusion ?? "").toLowerCase(),
        status: String(run.status ?? "").toLowerCase(),
        pullRequestNumbers: run.pull_requests.map((pullRequest) =>
          Number((pullRequest as Record<string, unknown>).number),
        ),
      };
    });
  }
  if (operation === "pr.ci-run") {
    /**
     * **固定run IDで1件だけ読む。** merge後の照合は再検索ではなく固定identityの
     * 直読みで行う。`pull_requests`はPRが閉じると空になるため、head_shaでの再検索は
     * merge成功後に必ず失敗する（Issue #1280）。
     *
     * **欠落を合格へ倒さない。** 404も不正応答も例外にする。
     */
    verifyRepository(input.repository, cwd, "read");
    const runId = String(input.runId ?? "");
    if (!/^[0-9]+$/u.test(runId))
      throw new Error("pr.ci-runのrun IDが不正です");
    const observed: unknown = JSON.parse(
      run("gh", ["api", `repos/${input.repository}/actions/runs/${runId}`], cwd)
        .stdout,
    );
    if (!isRecord(observed))
      throw new Error("GitHub Actions run観測がobjectではありません");
    const repository = observed.repository;
    const headRepository = observed.head_repository;
    if (
      !isRecord(repository) ||
      typeof repository.full_name !== "string" ||
      !isRecord(headRepository) ||
      typeof headRepository.full_name !== "string" ||
      typeof observed.event !== "string" ||
      typeof observed.head_sha !== "string" ||
      typeof observed.head_branch !== "string" ||
      typeof observed.status !== "string" ||
      typeof observed.conclusion !== "string" ||
      !Number.isSafeInteger(observed.id) ||
      !Array.isArray(observed.pull_requests)
    )
      throw new Error("GitHub Actions run観測のidentityが不正です");
    const pullRequestNumbers = observed.pull_requests.map((pullRequest) => {
      if (
        !isRecord(pullRequest) ||
        !Number.isSafeInteger(pullRequest.number) ||
        Number(pullRequest.number) < 1
      )
        throw new Error("GitHub Actions run観測の関連PRが不正です");
      return Number(pullRequest.number);
    });
    return {
      runId: String(observed.id),
      repository: repository.full_name,
      headRepository: headRepository.full_name,
      event: observed.event,
      headSha: observed.head_sha,
      headBranch: observed.head_branch,
      status: observed.status,
      conclusion: observed.conclusion,
      pullRequestNumbers,
    };
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
  if (operation === "commit.topology") {
    verifyRepository(input.repository, cwd, "read");
    const sha = requireFullOid(input.sha, "commit.topologyのSHA");
    const observed = parseObject<{
      sha?: string;
      commit?: { tree?: { sha?: string } };
      parents?: Array<{ sha?: string }>;
    }>(
      run("gh", ["api", `repos/${input.repository}/commits/${sha}`], cwd)
        .stdout,
      "merge commit topology観測",
    );
    if (
      observed.sha !== sha ||
      typeof observed.commit?.tree?.sha !== "string" ||
      !/^[a-f0-9]{40}$/u.test(observed.commit.tree.sha) ||
      !Array.isArray(observed.parents) ||
      observed.parents.some(
        (parent) =>
          typeof parent.sha !== "string" || !/^[a-f0-9]{40}$/u.test(parent.sha),
      )
    )
      throw new Error("merge commit topologyのOID観測が不完全です");
    return {
      repository: input.repository,
      sha,
      treeSha: observed.commit.tree.sha,
      parentShas: observed.parents.map((parent) => parent.sha!),
    };
  }
  if (operation === "commit.ancestry") {
    verifyRepository(input.repository, cwd, "read");
    const ancestorSha = requireFullOid(input.sha, "commit.ancestryのancestor");
    const descendantSha = requireFullOid(
      input.descendantSha,
      "commit.ancestryのdescendant",
    );
    const observed = parseObject<{
      status?: string;
      base_commit?: { sha?: string };
      merge_base_commit?: { sha?: string };
    }>(
      run(
        "gh",
        [
          "api",
          `repos/${input.repository}/compare/${ancestorSha}...${descendantSha}`,
        ],
        cwd,
      ).stdout,
      "commit ancestry観測",
    );
    if (
      observed.base_commit?.sha !== ancestorSha ||
      observed.merge_base_commit?.sha !== ancestorSha ||
      (observed.status !== "ahead" && observed.status !== "identical")
    )
      return {
        repository: input.repository,
        ancestorSha,
        descendantSha,
        status: String(observed.status ?? "unknown"),
        isAncestor: false,
      };
    return {
      repository: input.repository,
      ancestorSha,
      descendantSha,
      status: observed.status,
      isAncestor: true,
    };
  }
  if (operation === "ref.inspect") {
    verifyRepository(input.repository, cwd, "read");
    if (
      typeof input.branch !== "string" ||
      input.branch.trim() === "" ||
      input.branch.startsWith("-") ||
      input.branch.includes("..")
    )
      throw new Error("ref.inspectのbranch名が不正です");
    const sha = requireFullOid(
      run(
        "gh",
        [
          "api",
          `repos/${input.repository}/commits/${encodeURIComponent(input.branch)}`,
          "--jq",
          ".sha",
        ],
        cwd,
      ).stdout.trim(),
      "ref.inspectのSHA",
    );
    return { branch: input.branch, sha };
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
    if (
      result.status === 1 &&
      /404|Branch not protected/i.test(result.stderr)
    ) {
      const rulesResult = run(
        "gh",
        [
          "api",
          "--paginate",
          "--slurp",
          `repos/${input.repository}/rules/branches/${encodeURIComponent(input.branch)}?per_page=100`,
        ],
        cwd,
        { allowFailure: true },
      );
      if (rulesResult.status !== 0)
        return {
          known: false,
          protected: false,
          error: rulesResult.stderr,
        };
      try {
        const pages: unknown = JSON.parse(rulesResult.stdout);
        if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
          throw new Error("ruleset応答がpage配列ではありません");
        const rules = pages.flat();
        if (rules.some((rule) => !isRecord(rule)))
          throw new Error("ruleset応答にobject以外が含まれます");
        const protectingRuleTypes = new Set([
          "pull_request",
          "required_status_checks",
          "required_signatures",
          "non_fast_forward",
          "required_linear_history",
        ]);
        const protectingRules = rules.filter(
          (rule) =>
            isRecord(rule) &&
            typeof rule.type === "string" &&
            protectingRuleTypes.has(rule.type),
        );
        return protectingRules.length > 0
          ? {
              known: true,
              protected: true,
              value: { source: "ruleset", rules: protectingRules },
            }
          : {
              known: true,
              protected: false,
              value:
                rules.length > 0
                  ? { source: "ruleset", rules }
                  : { source: "ruleset" },
            };
      } catch (error) {
        return {
          known: false,
          protected: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return { known: false, protected: false, error: result.stderr };
  }
  if (operation === "pr.merge") {
    verifyRepository(input.repository, cwd, "write");
    const expectedHeadSha = requireFullOid(
      input.headSha,
      "merge対象の再認可済みHEAD SHA",
    );
    /**
     * **既定をsquashへ倒さない。**
     *
     * squashは取り込み先branch上のcommitの親を1個にするため、`audit:check`が
     * `比較基点..H_impl`と`H_impl..H_final`の2区間を導出できなくなる。未知値を
     * 黙ってsquashにすると、その破壊が診断なしで起きる。
     */
    const methodFlag = mergeMethodFlag(input.method);
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
        "--match-head-commit",
        expectedHeadSha,
      ],
      cwd,
    );
    return { state: "merge_or_native_auto_merge_requested" };
  }
  throw new Error(`未対応のGitHub操作です: ${operation}`);
}
