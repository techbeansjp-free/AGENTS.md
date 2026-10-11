/** Candidate work is advisory until the existing formal workflow accepts its evidence. */
export const CANDIDATE_RISKS = [
    "authentication",
    "authorization",
    "secrets",
    "personal-data",
    "destructive-data",
    "data-integrity",
    "migration",
    "async-concurrency",
    "state-transition",
    "production-impact",
    "legal-financial",
    "trust-boundary",
    "external-api",
    "irreversible-action",
];
const SHA = /^[0-9a-f]{40}$/;
/** No aggregate score can offset a single material risk or missing criterion. */
export function decideCandidatePreflight(input) {
    const reasons = [];
    if (!input.intent.trim())
        reasons.push("一次Intentが空です");
    if (!input.correctnessCriterion.trim())
        reasons.push("正しさの基準が未確定です");
    if (!SHA.test(input.baseSha))
        reasons.push("Git base HEADが不正です");
    if (!input.isolatedWorktree)
        reasons.push("隔離worktreeが必要です");
    const triggered = [];
    for (const key of CANDIDATE_RISKS) {
        const status = input.risk[key] ?? "unknown";
        if (status === "triggered")
            triggered.push(key);
        if (status === "unknown")
            reasons.push(`未確認リスク: ${key}`);
    }
    reasons.push(...input.unresolved.map((value) => `未解決事項: ${value}`));
    if (triggered.length > 0)
        reasons.push(`事前の上流検討が必要: ${triggered.join(", ")}`);
    return {
        kind: "asc-candidate-decision/v1",
        authority: "none",
        route: triggered.length > 0
            ? "upstream"
            : reasons.length > 0
                ? "clarify"
                : "candidate",
        reasons,
    };
}
/** Actual Git paths are provided by the adapter, never by the implementing worker. */
export function decideCandidatePost(input) {
    const changed = new Set(input.observedPaths);
    const unexpected = [...changed].filter((item) => !input.allowedPaths.includes(item));
    const priority = [
        "security-risk",
        "intent",
        "requirement",
        "design",
        "verification",
        "implementation",
    ];
    const gap = priority.find((item) => input.gaps.includes(item));
    if (unexpected.length > 0 || gap) {
        const reasons = [
            ...(unexpected.length > 0
                ? [`想定外のGit差分: ${unexpected.join(", ")}`]
                : []),
            ...(gap ? [`候補実装後の不足責務: ${gap}`] : []),
        ];
        const responsibility = gap === "security-risk" || gap === "intent" || gap === "requirement"
            ? gap
            : unexpected.length > 0
                ? "design"
                : gap;
        return {
            kind: "asc-candidate-decision/v1",
            authority: "none",
            route: unexpected.length > 0 ||
                (gap !== "implementation" && gap !== "verification")
                ? "upstream"
                : "repair",
            reasons,
            responsibility,
        };
    }
    if (!input.targetTestsPassed || changed.size === 0)
        return {
            kind: "asc-candidate-decision/v1",
            authority: "none",
            route: "repair",
            reasons: [
                changed.size === 0
                    ? "候補実装の差分がありません"
                    : "対象テストが失敗しました",
            ],
            responsibility: changed.size === 0 ? "implementation" : "verification",
        };
    return {
        kind: "asc-candidate-decision/v1",
        authority: "none",
        route: "independent-review",
        reasons: [],
        responsibility: "independent-review",
    };
}
//# sourceMappingURL=candidate-workflow.js.map