import { latestPlanSeal, planAmendmentDigests, planSealDigest, } from "./plan-seal.js";
import { isReviewSessionConverged, } from "./review-convergence.js";
/**
 * 両辺が既知のときだけ真偽を返す。**どちらかが不明なら`null`であり、一致と表示しない。**
 */
export function resumeMatches(left, right) {
    if (left === null || left === undefined)
        return null;
    if (right === null || right === undefined)
        return null;
    return left === right;
}
function observed(observation, label, errors) {
    if (observation.ok)
        return { value: observation.value };
    errors.push(`${label}: ${observation.error}`);
    return undefined;
}
/** 観測結果から再開状態を導出する純関数。reader失敗は`errors`へ入れ該当項目を`null`にする。 */
export function deriveWorkflowResume(input) {
    const errors = [];
    const headSha = observed(input.headSha, "HEAD", errors)?.value ?? null;
    const journal = observed(input.journal, "journal", errors)?.value;
    const amendments = observed(input.amendments, "計画変更", errors);
    const runs = observed(input.verificationRuns, "検証記録", errors)?.value;
    const session = observed(input.reviewSession, "review session", errors)?.value ?? null;
    const delivery = observed(input.delivery, "delivery state", errors)?.value ?? undefined;
    const seal = journal === undefined ? undefined : latestPlanSeal(journal);
    const planning = journal === undefined || amendments === undefined
        ? null
        : {
            sealed: seal !== undefined,
            sealDigest: seal === undefined ? null : planSealDigest(seal.seal),
            amendmentCount: planAmendmentDigests(amendments.value).length,
        };
    const implementationHeadSha = journal === undefined
        ? null
        : ([...journal].reverse().find((entry) => entry.step === 9)
            ?.implementationHeadSha ?? null);
    const latestRun = runs?.at(-1);
    return {
        authority: "advisory",
        staging: input.staging,
        headSha,
        baseSha: session?.anchor.diffBaseSha ?? null,
        planning,
        implementation: {
            headSha: implementationHeadSha,
            matchesHead: resumeMatches(implementationHeadSha, headSha),
        },
        verification: latestRun === undefined
            ? null
            : {
                headSha: latestRun.headSha,
                scope: latestRun.scope,
                passed: latestRun.exitCode === 0 && latestRun.signal === null,
                recordDigest: latestRun.recordDigest,
                matchesImplementationHead: resumeMatches(latestRun.headSha, implementationHeadSha),
            },
        review: session === null
            ? null
            : {
                status: isReviewSessionConverged(session) ? "converged" : "active",
                latestRoundDigest: session.latestRoundDigest,
                candidateHeadSha: session.latestCandidateHeadSha,
                rounds: session.rounds.length,
                matchesImplementationHead: resumeMatches(session.latestCandidateHeadSha, implementationHeadSha),
            },
        delivery: delivery === undefined
            ? null
            : { state: delivery.state, pr: delivery.pr?.number ?? null },
        errors,
    };
}
//# sourceMappingURL=workflow-resume.js.map