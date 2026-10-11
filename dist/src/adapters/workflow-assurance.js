/**
 * Reuse the journal/resume observations already made by workflow advance.
 * Presence of a verification or review record alone never means its trusted-policy
 * binding is valid: the existing verification/review/delivery gates own that check.
 */
export function deriveAssuranceProjection(input) {
    const { mode, resume } = input;
    const recorded = (step) => !input.journalValid
        ? "unknown"
        : input.journalSteps.includes(step)
            ? "satisfied"
            : "unsatisfied";
    const obligations = [];
    const add = (id, status, evidenceRefs, reasons, requiredWork) => {
        obligations.push({
            id,
            status,
            contractRefs: [".agent-skill-chain/docs/01_開発ワークフロー.md"],
            evidenceRefs,
            reasons,
            ...(status === "satisfied" ? {} : { requiredWork }),
        });
    };
    const stepEvidence = (step) => [`journal:step-${step}`];
    add("O-01", recorded(1), stepEvidence(1), [], "semantic");
    const contractStep = mode === "full" ? 2 : 1;
    add("O-02", recorded(contractStep), stepEvidence(contractStep), [], "semantic");
    const designStep = mode === "full" ? 7 : 1;
    add("O-03", recorded(designStep), stepEvidence(designStep), [], "semantic");
    const planningStep = mode === "full" ? 8 : 4;
    const planningStatus = recorded(planningStep);
    add("O-04", planningStatus === "satisfied" && resume.planning?.sealed !== true
        ? "unknown"
        : planningStatus, [...stepEvidence(planningStep), "staging:planning-seal"], planningStatus === "satisfied" && resume.planning?.sealed !== true
        ? ["正式なplanning sealを確認できない"]
        : [], "deterministic");
    const implementationRecorded = recorded(9);
    const implementationStatus = implementationRecorded !== "satisfied"
        ? implementationRecorded
        : resume.implementation.matchesHead === false
            ? "unknown"
            : resume.implementation.matchesHead === true
                ? "satisfied"
                : "unknown";
    add("O-05", implementationStatus, [...stepEvidence(9), "git:HEAD"], resume.implementation.matchesHead === false
        ? [
            "実装HEADと現在HEADが異なる。evidence-only後続commitか未review差分かは既存gateで判定する",
        ]
        : [], "deterministic");
    const verificationStatus = input.verificationGate?.status ??
        (resume.errors.length > 0
            ? "unknown"
            : resume.verification === null
                ? "unsatisfied"
                : !resume.verification.passed
                    ? "invalidated"
                    : "unknown");
    add("O-06", verificationStatus, ["staging:verification-runs", "git:HEAD", "trusted:verification-policy"], input.verificationGate !== undefined
        ? [input.verificationGate.reason]
        : verificationStatus === "unknown"
            ? [
                "記録の存在だけではpolicy・scope・impactの有効性を確定できない。既存verify gateで再照合する",
            ]
            : verificationStatus === "invalidated"
                ? ["検証失敗"]
                : [], "deterministic");
    const reviewStatus = input.reviewGate?.status ??
        (resume.errors.length > 0
            ? "unknown"
            : resume.review === null || resume.review.status !== "converged"
                ? "unsatisfied"
                : "unknown");
    if (mode === "full") {
        add("O-R3", recorded(3), stepEvidence(3), ["要件readinessの独立確認。実装後のexact HEADレビューとは別の責務"], "independent-review");
        add("O-R7", recorded(7), stepEvidence(7), ["設計readinessの独立確認。実装後のexact HEADレビューとは別の責務"], "independent-review");
    }
    add("O-07", reviewStatus, ["staging:review-session", "git:HEAD", "tracked:review-evidence"], input.reviewGate !== undefined
        ? [input.reviewGate.reason]
        : reviewStatus === "unknown"
            ? [
                "収束sessionだけでは独立性・差分・検証Evidenceの有効性を確定できない",
            ]
            : resume.review?.matchesImplementationHead === false
                ? [
                    "review対象HEADと実装HEADが異なる。既存review gateで正当な後続commitか照合する",
                ]
                : [], "independent-review");
    add("O-08", "unknown", ["git:HEAD:docs/specs/02_要件/"], [
        "仕様影響を要求と既存契約から判定する。文言のみの訂正は限定根拠付きno-spec-impactが可能。docs/specs未作成だけではbootstrapを要求しない。updatedの場合は必要IDを既存spec gateで照合する",
    ], "semantic");
    add("O-09", "unknown", ["git:merge-base", "staging:review-session"], ["実差分と監査済み範囲は既存review/delivery gateで照合する"], "deterministic");
    add("O-10", "unknown", ["trusted:delivery-policy", "staging:delivery-state"], ["外部操作のauthorityは既存Delivery gateで再照合する"], "human-authorization");
    const byStep = {
        1: ["O-01", "O-02"],
        2: ["O-02"],
        3: ["O-02", "O-R3"],
        4: ["O-02"],
        5: ["O-03", "O-08"],
        6: ["O-04", "O-08"],
        7: ["O-03", "O-04", "O-R7", "O-08"],
        8: ["O-04"],
        9: ["O-05", "O-06"],
        10: ["O-06", "O-07", "O-09"],
        11: ["O-09", "O-10"],
    };
    const selected = (byStep[input.nextStep ?? -1] ?? [])
        .map((id) => obligations.find((item) => item.id === id))
        .filter((item) => item !== undefined && item.status !== "satisfied");
    const kind = input.action.executor === "none"
        ? "none"
        : input.action.executor === "cli"
            ? "deterministic"
            : input.role === "reviewer" || input.role === "readiness-reviewer"
                ? "independent-review"
                : "semantic";
    return {
        authority: "advisory",
        observedHeadSha: resume.headSha,
        observedMode: mode,
        obligations,
        selectedWork: {
            obligationIds: selected.map((item) => item.id),
            kind,
            evidenceRefs: [...new Set(selected.flatMap((item) => item.evidenceRefs))],
        },
    };
}
//# sourceMappingURL=workflow-assurance.js.map