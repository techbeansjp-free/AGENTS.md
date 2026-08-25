import {
  compareTrustedPolicy,
  enforceTrustedBoundary,
  resolveEffectivePolicy,
} from "./enforcement.js";
import {
  type Diagnostic,
  type Policy,
  type RuleObservation,
} from "../types.js";

interface DeliveryEvidence {
  headSha?: string;
  review?: { approved?: boolean; headSha?: string };
  tests?: { passed?: boolean; headSha?: string; scenarioIds?: unknown };
  spec?: {
    consistent?: boolean;
    headSha?: string;
    impact?: string;
    rationale?: string;
    trace?: { requirements?: unknown; scenarios?: unknown; tests?: unknown };
  };
  ownership?: { classified?: boolean; owner?: string; targetLayer?: string };
}
interface PullRequestInput {
  apply: boolean;
  authorization?: string;
  evidence: DeliveryEvidence;
  headSha: string;
  issue: number;
  canonicalIssue?: number;
  relatedIssues?: number[];
  head: string;
  base: string;
  repository: string;
  trustedPolicy?: Policy;
  candidatePolicy?: Policy;
}
interface Approval {
  state?: string;
  commitSha?: string;
  actorId?: string;
  submittedAt?: string;
  reviewId?: string;
}
export interface MergeInput {
  trustedPolicy: Policy;
  candidatePolicy?: Policy;
  method: "merge" | "squash" | "rebase";
  checks?: string[];
  approvals?: Approval[];
  headSha?: string;
  prAuthorActorId?: string;
  implementationAuthorActorId?: string;
  branch: string;
  baseRef?: string;
  headRef?: string;
  repositoryVerified?: boolean;
  shaVerified?: boolean;
  protectionVerified?: boolean;
  mergeableVerified?: boolean;
}

export interface MergeMethodDecision {
  allowed: boolean;
  method: string;
  resolvedMethods: string[];
  reasons: string[];
  diagnostic?: Diagnostic;
}

function branchMatches(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function mergeMethodDiagnostic(
  input: { baseRef: string; headRef: string; method: string },
  reasons: string[],
): Diagnostic {
  return {
    ruleId: "ASC-MERGE-METHOD-001",
    purpose: "長命branch間の履歴接続を維持して恒常的な全面衝突を防ぐ",
    risk: "data-loss",
    reasons,
    scope: [
      "pr merge",
      `base:${input.baseRef || "不明"}`,
      `head:${input.headRef || "不明"}`,
      `method:${input.method}`,
    ],
    checks: [
      "base branchに一致するbranchMethodsをすべて抽出してmethodsの積集合を確認した",
      "baseRefとheadRefがmerge.branchesに列挙された長命branch同士か確認した",
    ],
    autoFixes: [],
    next: "長命branch同士はmerge方式を指定してpr mergeを再実行してください",
    requiredAuthority: "対象repositoryのmerge authority",
    rollback: "危険なmergeを実行せず、branchと既存commitを変更しない",
  };
}

export function resolveMergeMethod(input: {
  baseRef: string;
  headRef: string;
  method: string;
  policy: Policy;
}): MergeMethodDecision {
  const globalMethods = Array.isArray(input.policy.merge.methods)
    ? input.policy.merge.methods.filter(
        (method): method is "merge" | "squash" | "rebase" =>
          method === "merge" || method === "squash" || method === "rebase",
      )
    : [];
  const entries = Array.isArray(input.policy.merge.branchMethods)
    ? input.policy.merge.branchMethods
    : [];
  const matches = entries.filter(
    (entry) =>
      Array.isArray(entry.branches) &&
      entry.branches.some(
        (branch) =>
          typeof branch === "string" && branchMatches(branch, input.baseRef),
      ),
  );
  const expanded = matches.flatMap((entry) =>
    entry.methods.filter((method) => !globalMethods.includes(method)),
  );
  const resolvedMethods =
    matches.length === 0
      ? [...globalMethods]
      : globalMethods.filter((method) =>
          matches.every(
            (entry) =>
              Array.isArray(entry.methods) && entry.methods.includes(method),
          ),
        );
  const reasons: string[] = [];
  if (expanded.length > 0)
    reasons.push(
      `branch単位指定がglobalな許可を拡大しています: ${[...new Set(expanded)].join(", ")}`,
    );
  if (matches.length > 0 && resolvedMethods.length === 0)
    reasons.push(
      "base branchに複数のbranchMethods entryが一致しましたが、methodsの積集合が空です",
    );
  if (!resolvedMethods.some((method) => method === input.method))
    reasons.push(
      `${input.method}方式はbase branch ${input.baseRef}へ解決されたmethodsに含まれません`,
    );
  const longLivedPair =
    input.policy.merge.branches.includes(input.baseRef) &&
    input.policy.merge.branches.includes(input.headRef);
  if (longLivedPair && (input.method === "squash" || input.method === "rebase"))
    reasons.push(
      `${input.method}は長命branch間の親子関係を切ってmerge-baseを進めないため、以後のmergeが恒常的に全面衝突し、誤った衝突解決で変更を巻き戻すriskがあります`,
    );
  if (reasons.length === 0)
    return {
      allowed: true,
      method: input.method,
      resolvedMethods,
      reasons: [],
    };
  return {
    allowed: false,
    method: input.method,
    resolvedMethods,
    reasons,
    diagnostic: mergeMethodDiagnostic(input, reasons),
  };
}

export function validateIssueClosingReferences(
  body: string,
  input: { canonicalIssue: number; relatedIssues: number[] },
): {
  valid: boolean;
  errors: string[];
  closes: number[];
  relates: number[];
} {
  const extract = (pattern: RegExp): number[] =>
    [...body.matchAll(pattern)].map((match) => Number(match[1]));
  const closes = extract(/\b(?:closes?|closed|fixes|resolves)\s+#(\d+)\b/giu);
  const relates = extract(/\brelates\s+to\s+#(\d+)\b/giu);
  const errors: string[] = [];
  const canonicalCount = closes.filter(
    (issue) => issue === input.canonicalIssue,
  ).length;
  if (canonicalCount !== 1)
    errors.push(
      `canonical Issue #${input.canonicalIssue}は終端keywordで1回だけ参照してください`,
    );
  const unexpectedCloses = [
    ...new Set(closes.filter((issue) => issue !== input.canonicalIssue)),
  ];
  if (unexpectedCloses.length > 0)
    errors.push(
      `canonical Issue以外を自動closeできません: ${unexpectedCloses.map((issue) => `#${issue}`).join(", ")}`,
    );
  for (const issue of [...new Set(input.relatedIssues)]) {
    if (!relates.includes(issue))
      errors.push(`後続Issue #${issue}はRelates toで参照してください`);
    if (closes.includes(issue))
      errors.push(`後続Issue #${issue}に終端keywordを使用できません`);
  }
  return { valid: errors.length === 0, errors, closes, relates };
}

function requireStringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim() === "" ||
        /[\u0000-\u001f\u007f]/.test(item),
    )
  ) {
    throw new Error(`${name}には空でない安全な文字列配列が必要です`);
  }
  if (new Set(value).size !== value.length)
    throw new Error(`${name}に重複があります`);
  return value.filter((item): item is string => typeof item === "string");
}

function validateDeliveryEvidence(
  evidence: DeliveryEvidence,
  headSha: string,
): void {
  if (!/^[a-f0-9]{40}$/i.test(headSha))
    throw new Error("PR対象HEAD SHAは40桁のGit SHAで指定してください");
  if (!evidence || evidence.headSha !== headSha)
    throw new Error("PR証拠のHEAD SHAが対象HEADと一致しません");
  if (!evidence.review?.approved || evidence.review.headSha !== headSha)
    throw new Error("同じHEAD SHAに対するレビュー合格が必要です");
  if (!evidence.tests?.passed || evidence.tests.headSha !== headSha)
    throw new Error("同じHEAD SHAに対するテスト合格が必要です");
  const scenarioIds = requireStringArray(
    evidence.tests.scenarioIds,
    "テスト証拠のSCN ID",
  );
  if (scenarioIds.some((id) => !/^SCN-[A-Z0-9-]+$/.test(id)))
    throw new Error("テスト証拠に不正なSCN IDがあります");
  if (!evidence.spec?.consistent || evidence.spec.headSha !== headSha)
    throw new Error("同じHEAD SHAに対する仕様整合性の合格が必要です");
  if (evidence.spec.impact === "updated") {
    const requirements = requireStringArray(
      evidence.spec.trace?.requirements,
      "仕様証拠の要件追跡",
    );
    const scenarios = requireStringArray(
      evidence.spec.trace?.scenarios,
      "仕様証拠のシナリオ追跡",
    );
    requireStringArray(evidence.spec.trace?.tests, "仕様証拠のテスト追跡");
    if (requirements.some((id) => !/^[A-Z][A-Z0-9-]*-\d+$/.test(id)))
      throw new Error("仕様証拠に不正な要件IDがあります");
    if (
      scenarios.some((id) => !scenarioIds.includes(id)) ||
      scenarioIds.some((id) => !scenarios.includes(id))
    )
      throw new Error("仕様とテストのSCN IDが一致しません");
  } else if (evidence.spec.impact === "no-spec-impact") {
    if (
      typeof evidence.spec.rationale !== "string" ||
      evidence.spec.rationale.trim().length < 12
    )
      throw new Error("no-spec-impactには対象範囲を限定した根拠が必要です");
  } else {
    throw new Error("仕様影響はupdatedまたはno-spec-impactで指定してください");
  }
}

export function createPullRequest(
  input: PullRequestInput,
  external: (
    operation: "pr.create",
    input: {
      operation: "pr.create";
      authorityStatus: string;
      repository: string;
      issue: number;
      head: string;
      headSha: string;
      base: string;
      bodyLink: string;
    },
  ) =>
    | { url: string; state?: "created" }
    | { url: string; state: "rollback_required"; reason: string },
) {
  const [owner, repositoryName, extra] = input.repository.split("/");
  if (
    extra ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner ?? "") ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repositoryName ?? "") ||
    repositoryName === "." ||
    repositoryName === ".."
  )
    throw new Error("リポジトリは正確なowner/name形式で指定してください");
  if (!/^\d+$/.test(String(input.issue)) || !input.head || !input.base)
    throw new Error("Issue番号、先頭ブランチ、基点ブランチが必要です");
  if (
    input.head.startsWith("-") ||
    input.base.startsWith("-") ||
    input.head.includes("..") ||
    input.base.includes("..")
  )
    throw new Error("先頭・基点ブランチ名が安全ではありません");
  validateDeliveryEvidence(input.evidence, input.headSha);
  if (input.trustedPolicy) {
    const effective = resolveEffectivePolicy(
      input.trustedPolicy,
      input.candidatePolicy,
    );
    const comparison = effective.valid
      ? compareTrustedPolicy(input.trustedPolicy, effective.policy)
      : { allowed: false, rejected: [effective.diagnostic] };
    const ownership = input.evidence?.ownership;
    const observations = input.trustedPolicy.rules
      .filter((rule) => rule.scope.includes("pull_request"))
      .map((rule): RuleObservation | undefined =>
        rule.riskClass === "authority"
          ? {
              ruleId: rule.ruleId,
              violated: !effective.valid || !comparison.allowed,
              reasons: effective.valid
                ? comparison.rejected.flatMap((item) => item?.reasons ?? [])
                : (effective.diagnostic?.reasons ?? [
                    "candidate policyを安全floorへ合成できません",
                  ]),
              checks: [
                "trusted policyと固定candidate policyの自己緩和を比較した",
              ],
            }
          : rule.riskClass === "quality"
            ? {
                ruleId: rule.ruleId,
                violated:
                  ownership?.classified !== true ||
                  typeof ownership?.owner !== "string" ||
                  typeof ownership?.targetLayer !== "string",
                reasons: [
                  "PR evidenceにasset分類、owner、targetLayerの実測結果が必要です",
                ],
                checks: [
                  "HEAD SHAに拘束されたPR evidenceのownership分類を確認した",
                ],
              }
            : undefined,
      )
      .filter(
        (observation): observation is RuleObservation =>
          observation !== undefined,
      );
    const enforcement = enforceTrustedBoundary({
      policy: input.trustedPolicy,
      boundary: "pull_request",
      observations,
    });
    if (!enforcement.allowed)
      throw new Error(
        `${enforcement.diagnostic?.ruleId ?? "ASC-DELIVERY"}: ${enforcement.diagnostic?.reasons.join("; ") ?? "boundary違反"}`,
      );
  }
  const canonicalIssue = input.canonicalIssue ?? input.issue;
  const relatedIssues = input.relatedIssues ?? [];
  const bodyLink = [
    `Closes #${canonicalIssue}`,
    ...relatedIssues.map((issue) => `Relates to #${issue}`),
  ].join("\n\n");
  const references = validateIssueClosingReferences(bodyLink, {
    canonicalIssue,
    relatedIssues,
  });
  if (!references.valid)
    throw new Error(
      `PR本文のIssue参照が不正です: ${references.errors.join("; ")}`,
    );
  const preview = {
    operation: "pr.create" as const,
    authorityStatus: "unverified-preview",
    repository: input.repository,
    issue: input.issue,
    head: input.head,
    headSha: input.headSha,
    base: input.base,
    bodyLink,
  };
  if (!input.apply) return { state: "preview", preview };
  if (!input.trustedPolicy)
    throw new Error(
      "外部PR作成には既定ブランチから取得したtrusted policyが必要です",
    );
  if (input.authorization !== "approved")
    throw new Error("外部書き込みには明示的な承認が必要です");
  const result = external("pr.create", preview);
  if (result.state === "rollback_required")
    return {
      state: "rollback_required",
      url: result.url,
      reason: result.reason,
      next: "作成済みPRを確認し、明示authorityでcloseまたは正しいHEAD/baseへ修正する",
    };
  return {
    state: "waiting_for_human_review",
    url: result.url,
    next: "独立したpr mergeコマンドを使う。暗黙のマージ・完了処理・後片付けは行わない",
  };
}

export function authorizeMerge(input: MergeInput) {
  const policy = input.trustedPolicy?.merge;
  const deny = (reason: string, diagnostic?: Diagnostic) => ({
    allowed: false,
    reason,
    operations: [] as string[],
    diagnostic,
  });
  if (!policy || !["disabled", "assisted", "automatic"].includes(policy.mode))
    return deny("信頼済みポリシーがないか不正です");
  if (policy.mode === "disabled")
    return deny("信頼済みポリシーによりマージは無効です");
  if (
    input.repositoryVerified !== true ||
    input.shaVerified !== true ||
    input.protectionVerified !== true ||
    input.mergeableVerified !== true
  )
    return deny(
      "リポジトリ・SHA・保護設定・merge可能状態のtrusted観測が不足または失敗しました",
    );
  if (
    !Array.isArray(policy.branches) ||
    !policy.branches.some((pattern) => branchMatches(pattern, input.branch))
  )
    return deny("先頭ブランチが許可されていません");
  const methodDecision = resolveMergeMethod({
    baseRef: input.baseRef ?? "",
    headRef: input.headRef ?? input.branch,
    method: input.method,
    policy: input.trustedPolicy,
  });
  if (!methodDecision.allowed)
    return deny(methodDecision.reasons.join("。"), methodDecision.diagnostic);
  if (!Array.isArray(input.checks)) return deny("検査状態が不明です");
  const observedChecks = input.checks;
  const missing = policy.requiredChecks.filter(
    (check) => !observedChecks.includes(check),
  );
  if (missing.length > 0)
    return deny(`必須検査が不足しています: ${missing.join(", ")}`);
  if (!/^[a-f0-9]{40}$/iu.test(input.headSha ?? ""))
    return deny("merge対象HEADの固定SHAがありません");
  if (!Array.isArray(input.approvals))
    return deny("reviewのtrusted観測がありません");
  const needsApproval =
    (policy.requiredReviews ?? 0) > 0 || policy.mode === "assisted";
  if (
    needsApproval &&
    (typeof input.prAuthorActorId !== "string" ||
      input.prAuthorActorId === "" ||
      typeof input.implementationAuthorActorId !== "string" ||
      input.implementationAuthorActorId === "")
  )
    return deny("PR authorとimplementation authorのstable ID観測がありません");
  const latestByActor = new Map<string, Approval>();
  const byReviewId = new Map<string, Approval>();
  for (const approval of input.approvals) {
    const timestamp =
      typeof approval?.submittedAt === "string"
        ? Date.parse(approval.submittedAt)
        : Number.NaN;
    if (
      typeof approval?.actorId !== "string" ||
      approval.actorId === "" ||
      typeof approval?.state !== "string" ||
      approval.state === "" ||
      !/^[a-f0-9]{40}$/iu.test(approval?.commitSha ?? "") ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(
        approval?.submittedAt ?? "",
      ) ||
      !Number.isFinite(timestamp) ||
      typeof approval?.reviewId !== "string" ||
      approval.reviewId === ""
    )
      return deny(
        "review観測のactor、state、commit SHA、submittedAt、review IDが不正です",
      );
    if (
      typeof approval.reviewId !== "string" ||
      typeof approval.actorId !== "string" ||
      typeof approval.submittedAt !== "string"
    )
      return deny("review観測の必須fieldが不足しています");
    const sameId = byReviewId.get(approval.reviewId);
    if (
      sameId &&
      (sameId.actorId !== approval.actorId ||
        sameId.state !== approval.state ||
        sameId.commitSha !== approval.commitSha ||
        sameId.submittedAt !== approval.submittedAt)
    )
      return deny("同一review IDの観測内容が矛盾しています");
    if (!sameId) byReviewId.set(approval.reviewId, approval);
    const current = latestByActor.get(approval.actorId);
    if (!current) {
      latestByActor.set(approval.actorId, approval);
      continue;
    }
    const currentTimestamp = Date.parse(current.submittedAt ?? "");
    if (
      timestamp === currentTimestamp &&
      approval.reviewId === current.reviewId &&
      (approval.state !== current.state ||
        approval.commitSha !== current.commitSha)
    )
      return deny("同一review IDの観測内容が矛盾しています");
    if (
      timestamp > currentTimestamp ||
      (timestamp === currentTimestamp &&
        approval.reviewId.localeCompare(current.reviewId ?? "", "en", {
          numeric: true,
        }) > 0)
    )
      latestByActor.set(approval.actorId, approval);
  }
  const independentApprovals = new Set(
    [...latestByActor.values()]
      .filter(
        (approval) =>
          approval.state === "APPROVED" &&
          approval.commitSha === input.headSha &&
          typeof approval.actorId === "string" &&
          approval.actorId !== input.prAuthorActorId &&
          approval.actorId !== input.implementationAuthorActorId,
      )
      .map((approval) => approval.actorId as string),
  );
  if (independentApprovals.size < (policy.requiredReviews ?? 0))
    return deny("同じHEAD SHAに対する独立reviewが不足しています");
  if (policy.mode === "assisted" && independentApprovals.size < 1)
    return deny(
      "assistedモードには同じHEAD SHAに対する独立した人間承認が必要です",
    );
  return {
    allowed: true,
    reason: "既定ブランチ上の信頼済みポリシーがマージを許可しています",
    operations: ["pr.merge"],
    diagnostic: undefined,
    methodDecision,
  };
}
