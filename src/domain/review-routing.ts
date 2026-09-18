import { assertLoopbackEndpoint } from "../lib/local-llm-endpoint.js";
import type { ModelMappingChoice } from "../types.js";
import { DISPATCHABLE_REVIEWER_PROVIDERS } from "./reviewer-provider.js";
import {
  PROVIDER_AUTONOMOUS_CEILINGS,
  validateRoleAssignment,
} from "./role.js";

export interface ReviewRoutingResolutionInput {
  scope: string;
  coordinatorIdentity: string;
  implementerIdentity: string;
  reviewerIdentity: string;
  implementerContext: string;
  reviewerContext: string;
  modelMapping: ModelMappingChoice | undefined;
}

export interface ResolvedReviewRoutingDecision {
  state: "resolved";
  scope: string;
  provider: string;
  model: string;
  mode: "supplement" | "replace";
  endpoint: string;
}

export interface PendingReviewRoutingDecision {
  state: "pending";
  ruleId: string;
  reason: string;
}

export interface RejectedReviewRoutingDecision {
  state: "rejected";
  ruleId: string;
  reason: string;
}

export type ReviewRoutingDecision =
  | ResolvedReviewRoutingDecision
  | PendingReviewRoutingDecision
  | RejectedReviewRoutingDecision;

function pending(ruleId: string, reason: string): PendingReviewRoutingDecision {
  return { state: "pending", ruleId, reason };
}

function rejected(
  ruleId: string,
  reason: string,
): RejectedReviewRoutingDecision {
  return { state: "rejected", ruleId, reason };
}

/**
 * reviewer役割をローカルLLM providerへdispatchできるかを決定する純粋関数。
 * `resolveRouting`（implementer専用）とは独立に保ち、implementer向けの
 * 固定値（logicalTier="highest_available"等）を持ち込まない（INV-05）。
 */
export function resolveReviewRouting(
  input: ReviewRoutingResolutionInput,
): ReviewRoutingDecision {
  const choices = input.modelMapping;
  if (choices === undefined)
    return pending(
      "FR-1425-01",
      "trusted project choiceのmodelMappingが未設定です",
    );
  if (
    input.scope.trim() === "" ||
    input.coordinatorIdentity.trim() === "" ||
    input.implementerIdentity.trim() === "" ||
    input.reviewerIdentity.trim() === "" ||
    input.implementerContext.trim() === "" ||
    input.reviewerContext.trim() === ""
  )
    return rejected(
      "FR-1425-02",
      "scopeとrole identity・contextを既知の値へ解決できません",
    );
  const roles = validateRoleAssignment({
    scope: input.scope,
    assignments: [
      {
        role: "coordinator",
        identity: input.coordinatorIdentity,
        context: "coordinator",
      },
      {
        role: "implementer",
        identity: input.implementerIdentity,
        context: input.implementerContext,
      },
      {
        role: "reviewer",
        identity: input.reviewerIdentity,
        context: input.reviewerContext,
      },
    ],
  });
  if (!roles.valid) return rejected("FR-1425-02", roles.errors.join(" / "));
  /**
   * `validateRoleAssignment`（role.ts）はimplementer・reviewerの独立性しか見ない。
   * coordinatorとreviewerの同一identityは`launchReview`側で個別に拒否しており、
   * `resolveReviewRouting`（preview経路）だけがこれを見逃すと、preview結果を信じた
   * 呼出し元が`launch`時に初めて拒否される不整合が生じる（独立レビュー指摘）。
   * `validateRoleAssignment`自体は`implementer`側routingも使う共有関数のため、
   * ここへ個別に持ち込みINV-05の既存挙動非変更を保つ。
   */
  if (input.coordinatorIdentity === input.reviewerIdentity)
    return rejected(
      "FR-1425-02",
      `scope ${input.scope} のcoordinatorとreviewerは異なるidentityでなければなりません`,
    );

  const reviewer = choices.roles.reviewer;
  if (!("mode" in reviewer))
    return rejected(
      "FR-1425-03",
      "reviewer役割にローカルLLM providerが設定されていません（既存のCodex/Claude形状のままです）",
    );
  /**
   * TypeScriptの型は`reviewer.provider`を`"ollama"`固定と保証するが、これは
   * schema検証済み入力を前提にした静的保証であり、実行時の値そのものを
   * 保証しない。呼出し元がschema検証を経ていない値を渡す場合に備え、
   * ceiling参照の前に実行時でも明示的に検証する（独立レビューH-02）。
   *
   * provider名の文字列比較をここへ複数箇所に埋め込まない。dispatch可能provider
   * の集合は`DISPATCHABLE_REVIEWER_PROVIDERS`（reviewer-provider.ts）が持ち、
   * 新providerの追加はこの集合とREVIEWER_EXECUTORSへの登録だけで完結させる。
   */
  const provider = String(reviewer.provider);
  if (!DISPATCHABLE_REVIEWER_PROVIDERS.has(provider))
    return rejected(
      "FR-1425-03",
      `未知のローカルLLM providerです: ${provider}`,
    );
  const ceiling = PROVIDER_AUTONOMOUS_CEILINGS[provider];
  if (!ceiling || ceiling.dimension !== "model")
    return rejected(
      "FR-1425-04",
      `provider ${reviewer.provider} の自律選択上限が未定義です`,
    );
  if (!ceiling.allowed.includes(reviewer.model))
    return rejected(
      "FR-1425-04",
      `model ${reviewer.model} は承認済みallowlistに含まれません`,
    );
  if (reviewer.mode !== "supplement" && reviewer.mode !== "replace")
    return rejected(
      "FR-1425-05",
      `reviewerモードが不正です: ${String(reviewer.mode)}`,
    );
  try {
    assertLoopbackEndpoint(reviewer.endpoint);
  } catch (error) {
    return rejected(
      "FR-1425-06",
      error instanceof Error ? error.message : "endpointが不正です",
    );
  }

  return {
    state: "resolved",
    scope: input.scope,
    provider,
    model: reviewer.model,
    mode: reviewer.mode,
    endpoint: reviewer.endpoint,
  };
}
