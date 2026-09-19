/** Related files provide context; a finding must name a file in the review target. */
export function filterReviewFindingsToTarget(findings, targetFiles) {
    const targets = new Set(targetFiles);
    const scoped = findings.filter((finding) => targets.has(finding.file));
    return {
        findings: scoped,
        ignoredOutOfScopeCount: findings.length - scoped.length,
    };
}
//# sourceMappingURL=review-finding-scope.js.map