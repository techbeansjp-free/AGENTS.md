import { assertLoopbackEndpoint } from "../lib/security.js";
import { PROVIDER_AUTONOMOUS_CEILINGS, validateRoleAssignment, } from "./role.js";
function pending(ruleId, reason) {
    return { state: "pending", ruleId, reason };
}
function rejected(ruleId, reason) {
    return { state: "rejected", ruleId, reason };
}
/**
 * reviewer役割をローカルLLM providerへdispatchできるかを決定する純粋関数。
 * `resolveRouting`（implementer専用）とは独立に保ち、implementer向けの
 * 固定値（logicalTier="highest_available"等）を持ち込まない（INV-05）。
 */
export function resolveReviewRouting(input) {
    const choices = input.modelMapping;
    if (choices === undefined)
        return pending("FR-1425-01", "trusted project choiceのmodelMappingが未設定です");
    if (input.scope.trim() === "" ||
        input.coordinatorIdentity.trim() === "" ||
        input.implementerIdentity.trim() === "" ||
        input.reviewerIdentity.trim() === "" ||
        input.implementerContext.trim() === "" ||
        input.reviewerContext.trim() === "")
        return rejected("FR-1425-02", "scopeとrole identity・contextを既知の値へ解決できません");
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
    if (!roles.valid)
        return rejected("FR-1425-02", roles.errors.join(" / "));
    const reviewer = choices.roles.reviewer;
    if (!("mode" in reviewer))
        return rejected("FR-1425-03", "reviewer役割にローカルLLM providerが設定されていません（既存のCodex/Claude形状のままです）");
    /**
     * TypeScriptの型は`reviewer.provider`を`"ollama"`固定と保証するが、これは
     * schema検証済み入力を前提にした静的保証であり、実行時の値そのものを
     * 保証しない。呼出し元がschema検証を経ていない値を渡す場合に備え、
     * ceiling参照の前に実行時でも明示的に検証する（独立レビューH-02）。
     */
    if (reviewer.provider !== "ollama")
        return rejected("FR-1425-03", `未知のローカルLLM providerです: ${String(reviewer.provider)}`);
    const ceiling = PROVIDER_AUTONOMOUS_CEILINGS[reviewer.provider];
    if (!ceiling || ceiling.dimension !== "model")
        return rejected("FR-1425-04", `provider ${reviewer.provider} の自律選択上限が未定義です`);
    if (!ceiling.allowed.includes(reviewer.model))
        return rejected("FR-1425-04", `model ${reviewer.model} は承認済みallowlistに含まれません`);
    if (reviewer.mode !== "supplement" && reviewer.mode !== "replace")
        return rejected("FR-1425-05", `reviewerモードが不正です: ${String(reviewer.mode)}`);
    try {
        assertLoopbackEndpoint(reviewer.endpoint);
    }
    catch (error) {
        return rejected("FR-1425-06", error instanceof Error ? error.message : "endpointが不正です");
    }
    return {
        state: "resolved",
        scope: input.scope,
        provider: "ollama",
        model: reviewer.model,
        mode: reviewer.mode,
        endpoint: reviewer.endpoint,
    };
}
//# sourceMappingURL=review-routing.js.map