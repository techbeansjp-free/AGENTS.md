export type ReviewProfile = "chill" | "assertive";
export type ReviewEffort = "Quick win" | "Moderate" | "Heavy lift";

export const REVIEW_EFFORTS: readonly ReviewEffort[] = [
  "Quick win",
  "Moderate",
  "Heavy lift",
];

export function visibleReviewFindings<T extends { severity: string }>(
  findings: T[],
  profile: ReviewProfile,
): T[] {
  return profile === "chill"
    ? findings.filter(
        (finding) =>
          finding.severity === "Critical" || finding.severity === "High",
      )
    : findings;
}

export function reviewProfileInstruction(profile: ReviewProfile): string {
  return profile === "chill"
    ? "chill profile: Critical/Highに該当する具体的な問題だけを報告してください。\n"
    : "assertive profile: Critical/Highに加え、根拠のあるMedium/Lowも報告してください。\n";
}
