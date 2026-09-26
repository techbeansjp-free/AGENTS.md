export function resolveAuthorityDecision(input) {
    const { authorityMode, proposedValue, confirmedBy } = input;
    const confirmed = typeof confirmedBy === "string" && confirmedBy !== "";
    if (authorityMode === "authoritative")
        return {
            effectiveValue: proposedValue,
            requiresConfirmation: false,
            rejected: false,
            reason: "authoritative: 提案をそのまま有効値として採用した",
        };
    if (authorityMode === "advisory") {
        if (confirmed)
            return {
                effectiveValue: proposedValue,
                requiresConfirmation: false,
                rejected: false,
                reason: `advisory: ${confirmedBy}が明示的に確認したため有効値へ反映した`,
            };
        return {
            effectiveValue: null,
            requiresConfirmation: true,
            rejected: false,
            reason: "advisory: 提案は記録したが進行役の確認が無いため有効値へ反映しない",
        };
    }
    if (authorityMode === "one-way-escalation") {
        if (input.oneWaySafeValue === undefined)
            throw new Error("one-way-escalationにはoneWaySafeValueが必要です");
        if (proposedValue === input.oneWaySafeValue)
            return {
                effectiveValue: proposedValue,
                requiresConfirmation: false,
                rejected: false,
                reason: "one-way-escalation: 安全側（fail-closed）方向のため確認なしで有効値へ反映した",
            };
        if (confirmed)
            return {
                effectiveValue: proposedValue,
                requiresConfirmation: false,
                rejected: false,
                reason: `one-way-escalation: 緩和方向だが${confirmedBy}が明示的に確認したため有効値へ反映した`,
            };
        return {
            effectiveValue: null,
            requiresConfirmation: true,
            rejected: false,
            reason: "one-way-escalation: 緩和方向の提案は進行役の確認が無いため有効値へ反映しない",
        };
    }
    // constrained-choice
    if (input.candidateSet === undefined)
        throw new Error("constrained-choiceにはcandidateSetが必要です");
    if (!input.candidateSet.includes(proposedValue))
        return {
            effectiveValue: null,
            requiresConfirmation: false,
            rejected: true,
            reason: `constrained-choice: 提案が候補集合外です（候補: ${input.candidateSet.join(", ") || "(空)"}）`,
        };
    return {
        effectiveValue: proposedValue,
        requiresConfirmation: false,
        rejected: false,
        reason: "constrained-choice: 候補集合内の選択のため有効値へ反映した",
    };
}
//# sourceMappingURL=decision-authority.js.map