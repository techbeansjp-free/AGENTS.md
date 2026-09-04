import path from "node:path";
function pending(ruleId, reason) {
    return { state: "pending", ruleId, reason, updateRequired: true };
}
function rejected(ruleId, reason) {
    return { state: "rejected", ruleId, reason };
}
function roleIdentities(input, choices, routeMode) {
    return {
        coordinator: {
            identity: input.coordinatorIdentity,
            provider: choices.roles.coordinator.provider,
        },
        implementer: {
            identity: routeMode === "fallback"
                ? input.coordinatorIdentity
                : input.implementerIdentity,
            provider: routeMode === "fallback"
                ? choices.roles.coordinator.provider
                : choices.roles.implementer.provider,
        },
        reviewer: {
            identity: input.reviewerIdentity,
            provider: choices.roles.reviewer.provider,
        },
    };
}
function fallback(input, choices, reason) {
    const coordinator = choices.roles.coordinator;
    if (choices.fallback.when !== "implementer_unavailable" ||
        choices.fallback.role !== "coordinator" ||
        choices.fallback.modelSelection !== "project_default" ||
        coordinator.logicalTier !== "project_default" ||
        coordinator.reasoningEffort !== "high" ||
        coordinator.speed !== "standard")
        return rejected("FR-836-05", "coordinator fallbackのproject default、reasoning high、standard speedを解決できません");
    return {
        state: "resolved",
        routeMode: "fallback",
        scope: input.scope,
        provider: coordinator.provider,
        model: choices.fallback.modelSelection,
        modelSelection: "project_default",
        routingReason: reason,
        mappingVersion: input.mapping.mappingVersion,
        evaluatorRef: input.evaluatorRef,
        reasoningEffort: "high",
        serviceTier: "default",
        roles: roleIdentities(input, choices, "fallback"),
    };
}
export function resolveRouting(input) {
    const choices = input.modelMapping;
    if (choices === undefined)
        return pending("FR-836-05", "project choiceのmodelMappingが未設定です");
    if (input.evaluatorRef.trim() === "")
        return pending("FR-836-12", "evaluatorRefを確定できません");
    if (input.scope.trim() === "" ||
        input.coordinatorIdentity.trim() === "" ||
        input.implementerIdentity.trim() === "" ||
        input.reviewerIdentity.trim() === "" ||
        input.coordinatorIdentity === input.reviewerIdentity ||
        input.implementerIdentity === input.reviewerIdentity)
        return rejected("FR-836-11", "scopeとrole identityを既知の独立した値へ解決できません");
    const implementer = choices.roles.implementer;
    if (implementer.logicalTier !== "highest_available" ||
        implementer.reasoningEffort !== "high" ||
        implementer.speed !== "standard")
        return rejected("FR-836-05", "implementerのrouting選択値が許可集合外です");
    if (input.availability.provider !== implementer.provider)
        return pending("FR-836-02", "観測したproviderがimplementer設定と一致しません");
    if (input.availability.state !== "available")
        return fallback(input, choices, "preferred_implementer_unavailable");
    if (input.coordinatorIdentity === input.implementerIdentity)
        return rejected("FR-836-11", "preferred routeではcoordinatorとimplementerを別identityへ解決する必要があります");
    const provider = input.mapping.providers.find((candidate) => candidate.provider === implementer.provider);
    if (provider === undefined)
        return fallback(input, choices, "preferred_capability_mapping_missing");
    if (!provider.capabilities.includes(input.requiredCapability))
        return fallback(input, choices, "preferred_capability_unconfirmed");
    if (provider.selectionSource !== "provider_recommended_default")
        return fallback(input, choices, "preferred_selection_source_unconfirmed");
    const available = new Set(input.availability.models);
    if (available.size === 0)
        return fallback(input, choices, "preferred_model_catalog_empty");
    const recommended = input.availability.modelMetadata.filter((model) => model.recommended && available.has(model.model));
    if (recommended.length === 0)
        return fallback(input, choices, "preferred_recommended_default_missing");
    if (recommended.length !== 1)
        return fallback(input, choices, "preferred_recommended_default_ambiguous");
    const selected = recommended[0];
    if (!selected.supportedReasoningEfforts.includes("high"))
        return fallback(input, choices, "preferred_reasoning_effort_unsupported");
    return {
        state: "resolved",
        routeMode: "preferred",
        scope: input.scope,
        provider: implementer.provider,
        model: selected.model,
        modelSelection: "provider_recommended_default",
        routingReason: "preferred_implementer_available",
        mappingVersion: input.mapping.mappingVersion,
        evaluatorRef: input.evaluatorRef,
        reasoningEffort: "high",
        serviceTier: "default",
        roles: roleIdentities(input, choices, "preferred"),
    };
}
export function rejectRoutingDowngrade(expected, proposed) {
    if (proposed.model !== expected.model ||
        proposed.reasoningEffort !== expected.reasoningEffort ||
        proposed.serviceTier !== expected.serviceTier)
        return {
            allowed: false,
            ruleId: "BR-836-02",
            reason: "解決済みrouting条件の無告知変更を拒否しました",
        };
    return { allowed: true };
}
export function revalidateRouting(expected, input) {
    const actual = resolveRouting(input);
    if (actual.state !== "resolved" ||
        actual.scope !== expected.scope ||
        actual.routeMode !== expected.routeMode ||
        actual.provider !== expected.provider ||
        actual.model !== expected.model ||
        actual.modelSelection !== expected.modelSelection ||
        actual.routingReason !== expected.routingReason ||
        actual.mappingVersion !== expected.mappingVersion ||
        actual.evaluatorRef !== expected.evaluatorRef ||
        actual.reasoningEffort !== expected.reasoningEffort ||
        actual.serviceTier !== expected.serviceTier ||
        actual.roles.coordinator.identity !== expected.roles.coordinator.identity ||
        actual.roles.implementer.identity !== expected.roles.implementer.identity ||
        actual.roles.reviewer.identity !== expected.roles.reviewer.identity)
        return {
            allowed: false,
            ruleId: "FR-836-06",
            reason: "実行直前のrouting再検証で解決結果が変化しました",
        };
    return { allowed: true };
}
function isProductPath(relative) {
    const normalized = path.posix.normalize(relative.replaceAll("\\", "/"));
    return (normalized.startsWith("src/") ||
        normalized.startsWith("test/") ||
        normalized.startsWith("docs/specs/"));
}
export function authorizeImplementation(input) {
    if (input.decision.state !== "resolved")
        return {
            allowed: false,
            ruleId: input.decision.ruleId,
            reason: input.decision.reason,
        };
    if (input.changedPaths.some(isProductPath)) {
        /**
         * **route modeを問わずcoordinatorのproduct実装を拒否する。**
         * 既存routing形式のfallbackはcoordinatorをimplementer候補へ解決するが、
         * 仕様（`docs/specs/04_機能/01_ワークフローv0.3.md`、`10_セキュリティ/01_信頼境界.md`）は
         * 「role operation契約はcoordinatorによるproduct実装を許可せず、独立implementerへ
         * 再割当するまで停止する」と定める。**preferredに限ると、fallback時に
         * roles.implementerがcoordinatorへ解決されるため素通りする**（Issue #992）。
         */
        if (input.actorIdentity === input.decision.roles.coordinator.identity)
            return {
                allowed: false,
                ruleId: "BR-836-01",
                reason: "coordinatorはproduct実装を担当できません。独立implementerへ再割当するまで実装を開始しないでください",
            };
        if (input.actorIdentity !== input.decision.roles.implementer.identity)
            return {
                allowed: false,
                ruleId: "BR-836-01",
                reason: "product実装は解決済みimplementer identityだけが担当できます",
            };
    }
    return { allowed: true };
}
//# sourceMappingURL=routing.js.map