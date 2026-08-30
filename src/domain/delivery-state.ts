import crypto from "node:crypto";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";

export const DELIVERY_STATE_FILE = "journal/delivery-state.json";
export const DELIVERY_STATE_SCHEMA_VERSION =
  "agent-skill-chain/delivery-state/v1" as const;

export type DeliveryStateName =
  | "create-prepared"
  | "pr-bound"
  | "merge-prepared"
  | "merge-observed"
  | "step11-recorded"
  | "reconciliation-required";

export interface DeliveryCreateIntent {
  repository: string;
  issue: number;
  issueUrl: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  pullRequestDigest: string;
  bodyClosingDigest: string;
  preparedAt: string;
  /**
   * 外部createを呼ぶ権利をdurableに一度だけ消費した時刻。
   * nullだけが未dispatchを証明し、非nullはprovider callの成否にかかわらず再送禁止を表す。
   */
  dispatchClaimedAt: string | null;
}

export type DeliveryCreateIntentInput = Omit<
  DeliveryCreateIntent,
  "dispatchClaimedAt"
>;

export interface PullRequestBinding {
  number: number;
  url: string;
  boundAt: string;
}

export type MergeProviderRequest =
  | {
      kind: "auto-merge";
      requestedAt: string;
      method: "merge" | "squash" | "rebase";
      headSha: string;
      baseSha: string;
    }
  | {
      kind: "merge-queue";
      requestId: string;
      requestedAt: string;
      queueState:
        "AWAITING_CHECKS" | "LOCKED" | "MERGEABLE" | "QUEUED" | "UNMERGEABLE";
      headSha: string;
      baseSha: string;
    };

export interface MergeObservation {
  repository: string;
  prNumber: number;
  prUrl: string;
  headSha: string;
  issue: number;
  issueUrl: string;
  bodyClosingDigest: string;
  providerState: "merge-requested" | "merged";
  providerRequest: MergeProviderRequest | null;
  providerMergedAt: string | null;
  observedAt: string;
  observationId: string;
  mergeCommitSha: string | null;
}

export interface MergeIntent {
  method: "merge" | "squash" | "rebase";
  authorizedHeadSha: string;
  authorizedBaseRef: string;
  authorizedBaseSha: string;
  trustedPolicyCommitSha: string;
  implementationCommitSha: string;
  reviewArtifactPath: string;
  reviewArtifactDigest: string;
  ciRunId: string;
  reviewId: string;
  reviewEvidenceId: string;
  intentId: string;
  preparedAt: string;
  /** createと同じone-shot dispatch claim。 */
  dispatchClaimedAt: string | null;
  observation: MergeObservation | null;
}

export type MergeIntentInput = Omit<
  MergeIntent,
  "dispatchClaimedAt" | "observation"
>;

export interface Step11Record {
  outcome: "pull-request" | "merged";
  recordedAt: string;
  journalDigest: string;
  evidenceId: string;
}

export interface ReconciliationRecord {
  phase: "create" | "merge";
  reason: string;
  enteredAt: string;
}

export interface DeliveryState {
  schemaVersion: typeof DELIVERY_STATE_SCHEMA_VERSION;
  revision: number;
  state: DeliveryStateName;
  create: DeliveryCreateIntent;
  pr: PullRequestBinding | null;
  merge: MergeIntent | null;
  step11: Step11Record | null;
  reconciliation: ReconciliationRecord | null;
}

const ROOT_FIELDS = new Set([
  "schemaVersion",
  "revision",
  "state",
  "create",
  "pr",
  "merge",
  "step11",
  "reconciliation",
]);
const CREATE_FIELDS = new Set([
  "repository",
  "issue",
  "issueUrl",
  "headRef",
  "headSha",
  "baseRef",
  "baseSha",
  "pullRequestDigest",
  "bodyClosingDigest",
  "preparedAt",
  "dispatchClaimedAt",
]);
const PR_FIELDS = new Set(["number", "url", "boundAt"]);
const MERGE_FIELDS = new Set([
  "method",
  "authorizedHeadSha",
  "authorizedBaseRef",
  "authorizedBaseSha",
  "trustedPolicyCommitSha",
  "implementationCommitSha",
  "reviewArtifactPath",
  "reviewArtifactDigest",
  "ciRunId",
  "reviewId",
  "reviewEvidenceId",
  "intentId",
  "preparedAt",
  "dispatchClaimedAt",
  "observation",
]);
const OBSERVATION_FIELDS = new Set([
  "repository",
  "prNumber",
  "prUrl",
  "headSha",
  "issue",
  "issueUrl",
  "bodyClosingDigest",
  "providerState",
  "providerRequest",
  "providerMergedAt",
  "observedAt",
  "observationId",
  "mergeCommitSha",
]);
const OBSERVATION_INPUT_FIELDS = new Set(
  [...OBSERVATION_FIELDS].filter((field) => field !== "observationId"),
);
const STEP11_FIELDS = new Set([
  "outcome",
  "recordedAt",
  "journalDigest",
  "evidenceId",
]);
const PROVIDER_REQUEST_FIELDS = new Set([
  "kind",
  "requestedAt",
  "method",
  "headSha",
  "baseSha",
]);
const QUEUE_REQUEST_FIELDS = new Set([
  "kind",
  "requestId",
  "requestedAt",
  "queueState",
  "headSha",
  "baseSha",
]);
const RECONCILIATION_FIELDS = new Set(["phase", "reason", "enteredAt"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const OID = /^[a-f0-9]{40}$/u;
const REPOSITORY =
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const INTENT_ID = /^[a-f0-9]{32,64}$/u;

function unknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  const missing = [...allowed].filter((field) => !(field in value));
  if (unknown.length > 0)
    throw new Error(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
  if (missing.length > 0)
    throw new Error(`${label}の必須fieldがありません: ${missing.join(", ")}`);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label}は空でない文字列が必要です`);
  return value;
}

function instant(value: unknown, label: string): string {
  if (typeof value !== "string")
    throw new Error(`${label}はISO 8601 UTC日時が必要です`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error(`${label}はISO 8601 UTC日時が必要です`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`${label}は正の安全な整数が必要です`);
  return value as number;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value))
    throw new Error(`${label}は64桁SHA-256が必要です`);
  return value;
}

function oid(value: unknown, label: string): string {
  if (typeof value !== "string" || !OID.test(value))
    throw new Error(`${label}は小文字40桁Git OIDが必要です`);
  return value;
}

function repository(value: unknown): string {
  const parsed = nonEmpty(value, "create.repository");
  if (
    !REPOSITORY.test(parsed) ||
    parsed.endsWith("/.") ||
    parsed.endsWith("/..")
  )
    throw new Error("create.repositoryは正確なowner/name形式が必要です");
  return parsed.toLowerCase();
}

function ref(value: unknown, label: string): string {
  const parsed = nonEmpty(value, label);
  const components = parsed.split("/");
  if (
    parsed.startsWith("-") ||
    parsed.startsWith("/") ||
    parsed.endsWith("/") ||
    parsed.endsWith(".") ||
    parsed.includes("..") ||
    parsed.includes("//") ||
    parsed.includes("@{") ||
    parsed === "@" ||
    components.some(
      (component) => component.startsWith(".") || component.endsWith(".lock"),
    ) ||
    /[\0-\x20\x7f~^:?*[\\]/u.test(parsed)
  )
    throw new Error(`${label}は安全なGit ref名が必要です`);
  return parsed;
}

function expectedIssueUrl(repositoryValue: string, issue: number): string {
  return `https://github.com/${repositoryValue}/issues/${issue}`;
}

function expectedPullRequestUrl(
  repositoryValue: string,
  prNumber: number,
): string {
  return `https://github.com/${repositoryValue}/pull/${prNumber}`;
}

function exactUrl(value: unknown, expected: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== expected.toLowerCase()
  )
    throw new Error(`${label}が固定identity ${expected}と一致しません`);
  return expected.toLowerCase();
}

function notBefore(value: string, lowerBound: string, label: string): void {
  if (value < lowerBound)
    throw new Error(`${label}は先行event ${lowerBound} より前にできません`);
}

function parseCreate(value: unknown): DeliveryCreateIntent {
  if (!isRecord(value)) throw new Error("createはobjectが必要です");
  unknownFields(value, CREATE_FIELDS, "create");
  const repositoryValue = repository(value.repository);
  const issue = positiveInteger(value.issue, "create.issue");
  const parsed: DeliveryCreateIntent = {
    repository: repositoryValue,
    issue,
    issueUrl: exactUrl(
      value.issueUrl,
      expectedIssueUrl(repositoryValue, issue),
      "create.issueUrl",
    ),
    headRef: ref(value.headRef, "create.headRef"),
    headSha: oid(value.headSha, "create.headSha"),
    baseRef: ref(value.baseRef, "create.baseRef"),
    baseSha: oid(value.baseSha, "create.baseSha"),
    pullRequestDigest: digest(
      value.pullRequestDigest,
      "create.pullRequestDigest",
    ),
    bodyClosingDigest: digest(
      value.bodyClosingDigest,
      "create.bodyClosingDigest",
    ),
    preparedAt: instant(value.preparedAt, "create.preparedAt"),
    dispatchClaimedAt:
      value.dispatchClaimedAt === null
        ? null
        : instant(value.dispatchClaimedAt, "create.dispatchClaimedAt"),
  };
  if (parsed.dispatchClaimedAt)
    notBefore(
      parsed.dispatchClaimedAt,
      parsed.preparedAt,
      "create.dispatchClaimedAt",
    );
  return parsed;
}

function parsePullRequest(
  value: unknown,
  create: DeliveryCreateIntent,
): PullRequestBinding | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("prはobjectまたはnullが必要です");
  unknownFields(value, PR_FIELDS, "pr");
  const number = positiveInteger(value.number, "pr.number");
  const parsed: PullRequestBinding = {
    number,
    url: exactUrl(
      value.url,
      expectedPullRequestUrl(create.repository, number),
      "pr.url",
    ),
    boundAt: instant(value.boundAt, "pr.boundAt"),
  };
  notBefore(parsed.boundAt, create.preparedAt, "pr.boundAt");
  return parsed;
}

function observationIdentityValue(
  value: Omit<MergeObservation, "observationId">,
): Omit<MergeObservation, "observationId"> {
  return {
    repository: value.repository,
    prNumber: value.prNumber,
    prUrl: value.prUrl,
    headSha: value.headSha,
    issue: value.issue,
    issueUrl: value.issueUrl,
    bodyClosingDigest: value.bodyClosingDigest,
    providerState: value.providerState,
    providerRequest: value.providerRequest,
    providerMergedAt: value.providerMergedAt,
    observedAt: value.observedAt,
    mergeCommitSha: value.mergeCommitSha,
  };
}

function parseProviderRequest(value: unknown): MergeProviderRequest | null {
  if (value === null) return null;
  if (!isRecord(value))
    throw new Error(
      "merge.observation.providerRequestはobjectまたはnullが必要です",
    );
  if (value.kind === "auto-merge") {
    unknownFields(value, PROVIDER_REQUEST_FIELDS, "auto-merge providerRequest");
    if (
      value.method !== "merge" &&
      value.method !== "squash" &&
      value.method !== "rebase"
    )
      throw new Error("auto-merge providerRequest.methodが不正です");
    return {
      kind: "auto-merge",
      requestedAt: instant(
        value.requestedAt,
        "auto-merge providerRequest.requestedAt",
      ),
      method: value.method,
      headSha: oid(value.headSha, "auto-merge providerRequest.headSha"),
      baseSha: oid(value.baseSha, "auto-merge providerRequest.baseSha"),
    };
  }
  if (value.kind === "merge-queue") {
    unknownFields(value, QUEUE_REQUEST_FIELDS, "merge-queue providerRequest");
    const queueStates = new Set([
      "AWAITING_CHECKS",
      "LOCKED",
      "MERGEABLE",
      "QUEUED",
      "UNMERGEABLE",
    ]);
    if (!queueStates.has(String(value.queueState)))
      throw new Error("merge-queue providerRequest.queueStateが不正です");
    return {
      kind: "merge-queue",
      requestId: nonEmpty(
        value.requestId,
        "merge-queue providerRequest.requestId",
      ),
      requestedAt: instant(
        value.requestedAt,
        "merge-queue providerRequest.requestedAt",
      ),
      queueState: value.queueState as Extract<
        MergeProviderRequest,
        { kind: "merge-queue" }
      >["queueState"],
      headSha: oid(value.headSha, "merge-queue providerRequest.headSha"),
      baseSha: oid(value.baseSha, "merge-queue providerRequest.baseSha"),
    };
  }
  throw new Error("merge.observation.providerRequest.kindが不正です");
}

export function canonicalDigest(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

export function pullRequestContentDigest(input: {
  title: string;
  body: string;
}): string {
  const title = nonEmpty(input.title, "PR title");
  if (typeof input.body !== "string")
    throw new Error("PR bodyは文字列でなければなりません");
  return canonicalDigest({
    domain: "agent-skill-chain/pull-request-content/v1",
    title,
    body: input.body.replace(/\r\n/gu, "\n").trimEnd(),
  });
}

export function pullRequestTerminalEvidenceId(
  create: DeliveryCreateIntent,
  pr: PullRequestBinding,
): string {
  return canonicalDigest({
    domain: "agent-skill-chain/pr-terminal-evidence/v1",
    repository: create.repository,
    issue: create.issue,
    issueUrl: create.issueUrl,
    headRef: create.headRef,
    headSha: create.headSha,
    baseRef: create.baseRef,
    baseSha: create.baseSha,
    pullRequestDigest: create.pullRequestDigest,
    bodyClosingDigest: create.bodyClosingDigest,
    prNumber: pr.number,
    prUrl: pr.url,
    boundAt: pr.boundAt,
  });
}

export function closingContractDigest(input: {
  canonicalIssue: number;
  canonicalIssueUrl: string;
  closingIssueNumbers: readonly number[];
}): string {
  const issue = positiveInteger(input.canonicalIssue, "canonicalIssue");
  const match =
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/([1-9]\d*)$/iu.exec(
      input.canonicalIssueUrl,
    );
  if (!match || Number(match[1]) !== issue)
    throw new Error("canonicalIssueUrlは完全なGitHub Issue URLが必要です");
  if (
    !Array.isArray(input.closingIssueNumbers) ||
    input.closingIssueNumbers.length !== 1 ||
    input.closingIssueNumbers[0] !== issue
  )
    throw new Error("closing Issueはcanonical Issue 1件だけが必要です");
  return canonicalDigest({
    canonicalIssue: issue,
    canonicalIssueUrl: input.canonicalIssueUrl.toLowerCase(),
    closingIssueNumbers: [issue],
  });
}

function normalizeObservation(
  value: Record<string, unknown>,
  create: DeliveryCreateIntent,
  pr: PullRequestBinding,
): Omit<MergeObservation, "observationId"> {
  const providerState = value.providerState;
  if (providerState !== "merge-requested" && providerState !== "merged")
    throw new Error("merge.observation.providerStateが不正です");
  const mergeCommitSha =
    value.mergeCommitSha === null
      ? null
      : oid(value.mergeCommitSha, "merge.observation.mergeCommitSha");
  const providerMergedAt =
    value.providerMergedAt === null
      ? null
      : instant(value.providerMergedAt, "merge.observation.providerMergedAt");
  const providerRequest = parseProviderRequest(value.providerRequest);
  if (
    (providerState === "merged" &&
      (mergeCommitSha === null || providerMergedAt === null)) ||
    (providerState === "merge-requested" &&
      (mergeCommitSha !== null ||
        providerMergedAt !== null ||
        providerRequest === null))
  )
    throw new Error(
      "providerStateとproviderRequest・providerMergedAt・mergeCommitShaが一致しません",
    );
  const withoutId: Omit<MergeObservation, "observationId"> = {
    repository: repository(value.repository),
    prNumber: positiveInteger(value.prNumber, "merge.observation.prNumber"),
    prUrl: exactUrl(
      value.prUrl,
      expectedPullRequestUrl(create.repository, pr.number),
      "merge.observation.prUrl",
    ),
    headSha: oid(value.headSha, "merge.observation.headSha"),
    issue: positiveInteger(value.issue, "merge.observation.issue"),
    issueUrl: exactUrl(
      value.issueUrl,
      expectedIssueUrl(create.repository, create.issue),
      "merge.observation.issueUrl",
    ),
    bodyClosingDigest: digest(
      value.bodyClosingDigest,
      "merge.observation.bodyClosingDigest",
    ),
    providerState,
    providerRequest,
    providerMergedAt,
    observedAt: instant(value.observedAt, "merge.observation.observedAt"),
    mergeCommitSha,
  };
  assertObservationMatchesBinding(create, pr, withoutId);
  return withoutId;
}

function parseObservation(
  value: unknown,
  create: DeliveryCreateIntent,
  pr: PullRequestBinding,
): MergeObservation | null {
  if (value === null) return null;
  if (!isRecord(value))
    throw new Error("merge.observationはobjectまたはnullが必要です");
  unknownFields(value, OBSERVATION_FIELDS, "merge.observation");
  const withoutId = normalizeObservation(value, create, pr);
  const observationId = digest(
    value.observationId,
    "merge.observation.observationId",
  );
  if (observationId !== canonicalDigest(observationIdentityValue(withoutId)))
    throw new Error("merge.observation.observationIdが観測内容と一致しません");
  return { ...withoutId, observationId };
}

function parseMerge(
  value: unknown,
  create: DeliveryCreateIntent,
  pr: PullRequestBinding | null,
): MergeIntent | null {
  if (value === null) return null;
  if (!pr) throw new Error("mergeには固定済みpr bindingが必要です");
  if (!isRecord(value)) throw new Error("mergeはobjectまたはnullが必要です");
  unknownFields(value, MERGE_FIELDS, "merge");
  if (
    value.method !== "merge" &&
    value.method !== "squash" &&
    value.method !== "rebase"
  )
    throw new Error("merge.methodが不正です");
  const authorizedHeadSha = oid(
    value.authorizedHeadSha,
    "merge.authorizedHeadSha",
  );
  if (authorizedHeadSha !== create.headSha)
    throw new Error("merge.authorizedHeadShaが固定HEADと一致しません");
  const authorizedBaseRef = ref(
    value.authorizedBaseRef,
    "merge.authorizedBaseRef",
  );
  if (authorizedBaseRef !== create.baseRef)
    throw new Error("merge.authorizedBaseRefが固定base refと一致しません");
  const authorizedBaseSha = oid(
    value.authorizedBaseSha,
    "merge.authorizedBaseSha",
  );
  const trustedPolicyCommitSha = oid(
    value.trustedPolicyCommitSha,
    "merge.trustedPolicyCommitSha",
  );
  if (trustedPolicyCommitSha !== authorizedBaseSha)
    throw new Error("merge.trustedPolicyCommitShaが認可base SHAと一致しません");
  if (typeof value.intentId !== "string" || !INTENT_ID.test(value.intentId))
    throw new Error("merge.intentIdは32〜64桁の小文字hexが必要です");
  const reviewArtifactPath = nonEmpty(
    value.reviewArtifactPath,
    "merge.reviewArtifactPath",
  );
  if (
    !reviewArtifactPath.startsWith("docs/reviews/") &&
    !reviewArtifactPath.startsWith(".agent-skill-chain/reviews/")
  )
    throw new Error("merge.reviewArtifactPathがevidence-only領域外です");
  const ciRunId = nonEmpty(value.ciRunId, "merge.ciRunId");
  const reviewId = nonEmpty(value.reviewId, "merge.reviewId");
  if (!/^[1-9]\d*$/u.test(ciRunId) || !/^[1-9]\d*$/u.test(reviewId))
    throw new Error("mergeのCI run IDとreview IDは正の整数文字列が必要です");
  const parsed: MergeIntent = {
    method: value.method,
    authorizedHeadSha,
    authorizedBaseRef,
    authorizedBaseSha,
    trustedPolicyCommitSha,
    implementationCommitSha: oid(
      value.implementationCommitSha,
      "merge.implementationCommitSha",
    ),
    reviewArtifactPath,
    reviewArtifactDigest: digest(
      value.reviewArtifactDigest,
      "merge.reviewArtifactDigest",
    ),
    ciRunId,
    reviewId,
    reviewEvidenceId: digest(value.reviewEvidenceId, "merge.reviewEvidenceId"),
    intentId: value.intentId,
    preparedAt: instant(value.preparedAt, "merge.preparedAt"),
    dispatchClaimedAt:
      value.dispatchClaimedAt === null
        ? null
        : instant(value.dispatchClaimedAt, "merge.dispatchClaimedAt"),
    observation: parseObservation(value.observation, create, pr),
  };
  const expectedReviewEvidenceId = canonicalDigest({
    domain: "agent-skill-chain/merge-review-evidence/v1",
    repository: create.repository,
    prNumber: pr.number,
    finalHeadSha: create.headSha,
    implementationCommitSha: parsed.implementationCommitSha,
    reviewArtifactPath: parsed.reviewArtifactPath,
    reviewArtifactDigest: parsed.reviewArtifactDigest,
    ciRunId: parsed.ciRunId,
    reviewId: parsed.reviewId,
  });
  if (parsed.reviewEvidenceId !== expectedReviewEvidenceId)
    throw new Error(
      "merge.reviewEvidenceIdが固定review Evidenceと一致しません",
    );
  notBefore(parsed.preparedAt, pr.boundAt, "merge.preparedAt");
  if (parsed.dispatchClaimedAt)
    notBefore(
      parsed.dispatchClaimedAt,
      parsed.preparedAt,
      "merge.dispatchClaimedAt",
    );
  if (parsed.observation)
    notBefore(
      parsed.observation.observedAt,
      parsed.preparedAt,
      "merge.observation.observedAt",
    );
  if (parsed.observation) {
    const request = parsed.observation.providerRequest;
    if (
      request &&
      (request.headSha !== create.headSha ||
        request.baseSha !== parsed.authorizedBaseSha)
    )
      throw new Error(
        "merge providerRequestのhead/baseが固定済み認可tupleと一致しません",
      );
    if (parsed.dispatchClaimedAt && parsed.observation.providerMergedAt)
      notBefore(
        parsed.observation.providerMergedAt,
        parsed.dispatchClaimedAt,
        "merge.observation.providerMergedAt",
      );
    if (parsed.dispatchClaimedAt && request)
      notBefore(
        request.requestedAt,
        parsed.dispatchClaimedAt,
        "merge.observation.providerRequest.requestedAt",
      );
  }
  return parsed;
}

function parseStep11(
  value: unknown,
  create: DeliveryCreateIntent,
  pr: PullRequestBinding | null,
  merge: MergeIntent | null,
): Step11Record | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("step11はobjectまたはnullが必要です");
  unknownFields(value, STEP11_FIELDS, "step11");
  if (value.outcome !== "pull-request" && value.outcome !== "merged")
    throw new Error("step11.outcomeが不正です");
  if (!pr) throw new Error("step11には固定済みPR bindingが必要です");
  const evidenceId = digest(value.evidenceId, "step11.evidenceId");
  const expectedEvidenceId =
    value.outcome === "merged"
      ? merge?.observation?.observationId
      : pullRequestTerminalEvidenceId(create, pr);
  if (!expectedEvidenceId || evidenceId !== expectedEvidenceId)
    throw new Error("step11.evidenceIdが終端Evidenceと一致しません");
  const parsed: Step11Record = {
    outcome: value.outcome,
    recordedAt: instant(value.recordedAt, "step11.recordedAt"),
    journalDigest: digest(value.journalDigest, "step11.journalDigest"),
    evidenceId,
  };
  notBefore(
    parsed.recordedAt,
    value.outcome === "merged"
      ? (merge?.observation?.observedAt ?? pr.boundAt)
      : pr.boundAt,
    "step11.recordedAt",
  );
  return parsed;
}

function parseReconciliation(value: unknown): ReconciliationRecord | null {
  if (value === null) return null;
  if (!isRecord(value))
    throw new Error("reconciliationはobjectまたはnullが必要です");
  unknownFields(value, RECONCILIATION_FIELDS, "reconciliation");
  if (value.phase !== "create" && value.phase !== "merge")
    throw new Error("reconciliation.phaseが不正です");
  return {
    phase: value.phase,
    reason: nonEmpty(value.reason, "reconciliation.reason"),
    enteredAt: instant(value.enteredAt, "reconciliation.enteredAt"),
  };
}

function validateShape(state: DeliveryState): void {
  const fail = (message: string): never => {
    throw new Error(`delivery state ${state.state}が不正です: ${message}`);
  };
  if (state.state === "create-prepared") {
    if (state.pr || state.merge || state.step11 || state.reconciliation)
      fail("create以外のfieldはnullが必要です");
    return;
  }
  if (state.state === "pr-bound") {
    if (!state.pr || state.merge || state.step11 || state.reconciliation)
      fail("prだけが固定済みでなければなりません");
    return;
  }
  if (state.state === "merge-prepared") {
    if (
      !state.pr ||
      !state.merge ||
      state.merge.observation ||
      state.step11 ||
      state.reconciliation
    )
      fail("観測前のmerge intentだけが必要です");
    return;
  }
  if (state.state === "merge-observed") {
    if (
      !state.pr ||
      !state.merge?.observation ||
      state.step11 ||
      state.reconciliation
    )
      fail("merge observationが必要です");
    return;
  }
  if (state.state === "step11-recorded") {
    if (!state.pr || !state.step11 || state.reconciliation)
      fail("PR bindingとStep 11記録が必要です");
    const step11 = state.step11;
    if (!step11)
      throw new Error(
        "delivery state step11-recordedが不正です: Step 11記録が必要です",
      );
    if (step11.outcome === "pull-request") {
      if (state.merge) fail("PR停止終端ではmergeがnullでなければなりません");
    } else if (
      !state.merge?.observation ||
      state.merge.observation.providerState !== "merged"
    ) {
      fail("merged終端ではproviderのmerged observationが必要です");
    }
    return;
  }
  const reconciliation = state.reconciliation;
  if (reconciliation === null)
    throw new Error(
      `delivery state ${state.state}が不正です: reconciliation記録が必要です`,
    );
  if (state.step11) fail("reconciliation中はstep11がnullでなければなりません");
  if (reconciliation.phase === "create") {
    if (state.pr || state.merge) fail("create照合中はprとmergeがnullです");
    notBefore(
      reconciliation.enteredAt,
      state.create.preparedAt,
      "reconciliation.enteredAt",
    );
  } else {
    const merge = state.merge;
    if (!state.pr || !merge)
      throw new Error(
        `delivery state ${state.state}が不正です: merge照合中は固定済みmerge intentが必要です`,
      );
    notBefore(
      reconciliation.enteredAt,
      merge.preparedAt,
      "reconciliation.enteredAt",
    );
  }
}

export function parseDeliveryState(source: string): DeliveryState {
  const value = parseJsonStrict(source, DELIVERY_STATE_FILE);
  if (!isRecord(value)) throw new Error("delivery stateはobjectが必要です");
  unknownFields(value, ROOT_FIELDS, "delivery state");
  if (value.schemaVersion !== DELIVERY_STATE_SCHEMA_VERSION)
    throw new Error("delivery state schemaVersionが不正です");
  const revision = positiveInteger(value.revision, "delivery state revision");
  if (
    value.state !== "create-prepared" &&
    value.state !== "pr-bound" &&
    value.state !== "merge-prepared" &&
    value.state !== "merge-observed" &&
    value.state !== "step11-recorded" &&
    value.state !== "reconciliation-required"
  )
    throw new Error("delivery state名が不正です");
  const create = parseCreate(value.create);
  const pr = parsePullRequest(value.pr, create);
  const merge = parseMerge(value.merge, create, pr);
  const state: DeliveryState = {
    schemaVersion: DELIVERY_STATE_SCHEMA_VERSION,
    revision,
    state: value.state,
    create,
    pr,
    merge,
    step11: parseStep11(value.step11, create, pr, merge),
    reconciliation: parseReconciliation(value.reconciliation),
  };
  validateShape(state);
  return state;
}

export function renderDeliveryState(state: DeliveryState): string {
  const parsed = parseDeliveryState(stableJson(state));
  return `${stableJson(parsed)}\n`;
}

export function deliveryStateDigest(state: DeliveryState): string {
  return canonicalDigest(parseDeliveryState(stableJson(state)));
}

export function preparePullRequestCreation(
  create: DeliveryCreateIntentInput,
): DeliveryState {
  const candidate: DeliveryState = {
    schemaVersion: DELIVERY_STATE_SCHEMA_VERSION,
    revision: 1,
    state: "create-prepared",
    create: { ...create, dispatchClaimedAt: null },
    pr: null,
    merge: null,
    step11: null,
    reconciliation: null,
  };
  return parseDeliveryState(stableJson(candidate));
}

export function claimPullRequestCreationDispatch(
  current: DeliveryState,
  claimedAt: string,
): DeliveryState {
  if (current.state !== "create-prepared")
    throw new Error(`${current.state}ではPR create dispatchをclaimできません`);
  if (current.create.dispatchClaimedAt !== null)
    throw new Error("PR create dispatch claimは既に消費されています");
  const candidate: DeliveryState = {
    ...current,
    revision: current.revision + 1,
    create: { ...current.create, dispatchClaimedAt: claimedAt },
  };
  return parseDeliveryState(stableJson(candidate));
}

export function assertImmutablePullRequestBinding(
  state: DeliveryState,
  input: Readonly<{
    repository: string;
    issue: number;
    issueUrl: string;
    prNumber: number;
    prUrl: string;
    headSha: string;
  }>,
): void {
  if (!state.pr) throw new Error("固定済みPR bindingがありません");
  const actual = {
    repository: state.create.repository.toLowerCase(),
    issue: state.create.issue,
    issueUrl: state.create.issueUrl.toLowerCase(),
    prNumber: state.pr.number,
    prUrl: state.pr.url.toLowerCase(),
    headSha: state.create.headSha,
  };
  const expected = {
    repository: input.repository.toLowerCase(),
    issue: input.issue,
    issueUrl: input.issueUrl.toLowerCase(),
    prNumber: input.prNumber,
    prUrl: input.prUrl.toLowerCase(),
    headSha: input.headSha,
  };
  if (stableJson(actual) !== stableJson(expected))
    throw new Error("PR bindingのrepository・PR・HEAD・Issueは変更できません");
}

export function bindPullRequest(
  current: DeliveryState,
  binding: PullRequestBinding,
): DeliveryState {
  if (
    current.state !== "create-prepared" &&
    !(
      current.state === "reconciliation-required" &&
      current.reconciliation?.phase === "create"
    )
  )
    throw new Error(`${current.state}からpr-boundへ遷移できません`);
  const candidate: DeliveryState = {
    ...current,
    revision: current.revision + 1,
    state: "pr-bound",
    pr: binding,
    reconciliation: null,
  };
  return parseDeliveryState(stableJson(candidate));
}

export function prepareMergeIntent(
  current: DeliveryState,
  merge: MergeIntentInput,
): DeliveryState {
  if (current.state !== "pr-bound")
    throw new Error(`${current.state}からmerge-preparedへ遷移できません`);
  const candidate: DeliveryState = {
    ...current,
    revision: current.revision + 1,
    state: "merge-prepared",
    merge: { ...merge, dispatchClaimedAt: null, observation: null },
  };
  return parseDeliveryState(stableJson(candidate));
}

export function claimMergeDispatch(
  current: DeliveryState,
  claimedAt: string,
): DeliveryState {
  if (current.state !== "merge-prepared" || !current.merge)
    throw new Error(`${current.state}ではmerge dispatchをclaimできません`);
  if (current.merge.dispatchClaimedAt !== null)
    throw new Error("merge dispatch claimは既に消費されています");
  const candidate: DeliveryState = {
    ...current,
    revision: current.revision + 1,
    merge: { ...current.merge, dispatchClaimedAt: claimedAt },
  };
  return parseDeliveryState(stableJson(candidate));
}

function assertObservationMatchesBinding(
  create: DeliveryCreateIntent,
  pr: PullRequestBinding,
  observation: Omit<MergeObservation, "observationId">,
): void {
  const expected = {
    repository: create.repository.toLowerCase(),
    prNumber: pr.number,
    prUrl: pr.url.toLowerCase(),
    headSha: create.headSha,
    issue: create.issue,
    issueUrl: create.issueUrl.toLowerCase(),
    bodyClosingDigest: create.bodyClosingDigest,
  };
  const actual = {
    repository: observation.repository.toLowerCase(),
    prNumber: observation.prNumber,
    prUrl: observation.prUrl.toLowerCase(),
    headSha: observation.headSha,
    issue: observation.issue,
    issueUrl: observation.issueUrl.toLowerCase(),
    bodyClosingDigest: observation.bodyClosingDigest,
  };
  if (stableJson(actual) !== stableJson(expected))
    throw new Error("merge observationが固定済みPR bindingと一致しません");
}

export function observeMerge(
  current: DeliveryState,
  observation: Omit<MergeObservation, "observationId">,
): DeliveryState {
  if (
    current.state !== "merge-prepared" &&
    current.state !== "merge-observed" &&
    !(
      current.state === "reconciliation-required" &&
      current.reconciliation?.phase === "merge"
    )
  )
    throw new Error(`${current.state}からmerge-observedへ遷移できません`);
  if (!current.pr || !current.merge)
    throw new Error("merge observationには固定済みPRとmerge intentが必要です");
  if (!isRecord(observation))
    throw new Error("merge observationはobjectが必要です");
  unknownFields(observation, OBSERVATION_INPUT_FIELDS, "merge observation");
  const canonical = normalizeObservation(
    observation,
    current.create,
    current.pr,
  );
  const complete: MergeObservation = {
    ...canonical,
    observationId: canonicalDigest(observationIdentityValue(canonical)),
  };
  if (current.state === "merge-observed") {
    const previous = current.merge.observation;
    if (!previous) throw new Error("merge-observedに観測記録がありません");
    if (stableJson(previous) === stableJson(complete)) return current;
    if (
      previous.providerState !== "merge-requested" ||
      complete.providerState !== "merged"
    )
      throw new Error(
        "merge observationはmerge-requestedからmergedへだけ更新できます",
      );
    notBefore(
      complete.observedAt,
      previous.observedAt,
      "merge.observation.observedAt",
    );
  }
  const candidate: DeliveryState = {
    ...current,
    revision: current.revision + 1,
    state: "merge-observed",
    merge: { ...current.merge, observation: complete },
    reconciliation: null,
  };
  return parseDeliveryState(stableJson(candidate));
}

export function recordStep11(
  current: DeliveryState,
  input: Omit<Step11Record, "evidenceId">,
): DeliveryState {
  const merged = input.outcome === "merged";
  if (
    (merged &&
      (current.state !== "merge-observed" || !current.merge?.observation)) ||
    (!merged && current.state !== "pr-bound")
  )
    throw new Error(`${current.state}からstep11-recordedへ遷移できません`);
  if (merged && current.merge?.observation?.providerState !== "merged")
    throw new Error("Step 11 merged記録前にproviderのmerged状態が必要です");
  if (!current.pr) throw new Error("Step 11記録には固定済みPRが必要です");
  const candidate: DeliveryState = {
    ...current,
    revision: current.revision + 1,
    state: "step11-recorded",
    step11: {
      ...input,
      evidenceId: merged
        ? current.merge!.observation!.observationId
        : pullRequestTerminalEvidenceId(current.create, current.pr),
    },
  };
  return parseDeliveryState(stableJson(candidate));
}

export function requireDeliveryReconciliation(
  current: DeliveryState,
  input: ReconciliationRecord,
): DeliveryState {
  const expectedPhase =
    current.state === "create-prepared"
      ? "create"
      : current.state === "merge-prepared" || current.state === "merge-observed"
        ? "merge"
        : undefined;
  if (!expectedPhase || input.phase !== expectedPhase)
    throw new Error(
      `${current.state}から${input.phase} reconciliationへ遷移できません`,
    );
  const candidate: DeliveryState = {
    ...current,
    revision: current.revision + 1,
    state: "reconciliation-required",
    reconciliation: input,
  };
  return parseDeliveryState(stableJson(candidate));
}
