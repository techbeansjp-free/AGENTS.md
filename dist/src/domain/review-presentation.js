export const REVIEW_EFFORTS = [
    "Quick win",
    "Moderate",
    "Heavy lift",
];
export function visibleReviewFindings(findings, profile) {
    return profile === "chill"
        ? findings.filter((finding) => finding.severity === "Critical" || finding.severity === "High")
        : findings;
}
export function reviewProfileInstruction(profile) {
    return profile === "chill"
        ? "chill profile: Critical/Highに該当する具体的な問題だけを報告してください。\n"
        : "assertive profile: Critical/Highに加え、根拠のあるMedium/Lowも報告してください。\n";
}
//# sourceMappingURL=review-presentation.js.map