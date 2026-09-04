import path from "node:path";
import { advanceReviewSession, } from "../domain/review-convergence.js";
import { calculateStagingDigest, listStagingArtifacts, readStoredStagingRecord, refreshStoredStagingDigest, withStagingMutationLock, } from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
import { observeReviewDiff } from "./review-diff.js";
import { REVIEW_SESSION_FILE, readStoredReviewSession, } from "./review-session-store.js";
export { observeReviewDiff, REVIEW_SESSION_FILE, readStoredReviewSession };
import { deriveEffectiveHead } from "../domain/evidence-reanchor.js";
import { readEvidenceReanchorChain } from "./evidence-reanchor.js";
const GIT_ENV = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
};
function assertStoredStagingDigest(staging) {
    const stored = readStoredStagingRecord(staging);
    const artifacts = listStagingArtifacts(staging);
    if (stableJson(stored.artifacts) !== stableJson(artifacts) ||
        stored.digest !== calculateStagingDigest(staging, artifacts))
        throw new Error("review session更新前のstaging成果物一覧またはdigestが一致しません");
}
export function previewReviewRound(input) {
    const staging = assertWorkflowStaging(input.staging);
    assertStoredStagingDigest(staging);
    const previous = readStoredReviewSession(staging);
    const root = path.resolve(staging, "../../../..");
    const currentHeadSha = git(["rev-parse", "--verify", "HEAD^{commit}"], root, {
        env: GIT_ENV,
    }).stdout.trim();
    if (currentHeadSha !== input.round.candidateHeadSha)
        throw new Error("review round candidate HEADがrepositoryのcurrent HEADと一致しません");
    if (previous === null) {
        const observed = observeReviewDiff(root, input.round.anchor.diffBaseSha, input.round.anchor.initialHeadSha);
        if (observed.digest !== input.round.anchor.initialDiffDigest)
            throw new Error("review roundのinitial diff digestがGit観測値と一致しません");
    }
    else {
        const fixed = observeReviewDiff(root, previous.latestCandidateHeadSha, input.round.candidateHeadSha).changedPaths;
        if (stableJson(fixed) !== stableJson(input.round.focus.fixedDiff))
            throw new Error("review roundのfixedDiffが前roundからの実Git差分と一致しません");
    }
    return advanceReviewSession(previous, input.round);
}
export function recordReviewRound(input) {
    const staging = assertWorkflowStaging(input.staging);
    return withStagingMutationLock(staging, () => {
        const next = previewReviewRound({ staging, round: input.round });
        const file = path.join(staging, REVIEW_SESSION_FILE);
        writeFileAtomic(file, `${stableJson(next)}\n`, {
            temporaryDirectory: path.dirname(staging),
        });
        refreshStoredStagingDigest(staging);
        const reread = readStoredReviewSession(staging);
        if (reread === null || stableJson(reread) !== stableJson(next))
            throw new Error("review sessionの書き込み後read-backが一致しません");
        assertStoredStagingDigest(staging);
        return reread;
    });
}
export function assertConvergedReviewSession(input) {
    const staging = assertWorkflowStaging(input.staging);
    assertStoredStagingDigest(staging);
    const session = readStoredReviewSession(staging);
    if (session === null)
        throw new Error("Step 10には永続review sessionが必要です");
    if (session.status !== "converged")
        throw new Error(`review sessionが収束していません: status=${session.status}`);
    if (session.latestRoundDigest !== input.expectedDigest)
        throw new Error("Step 10のreview session digestが保存済みlatest roundと一致しません");
    /**
     * **照合対象は再固定chainから導出した実効HEADである。**
     * chainが空なら`latestCandidateHeadSha`そのものになり、判定は変更前と同一である。
     */
    const effectiveHeadSha = deriveEffectiveHead({
        records: readEvidenceReanchorChain(staging),
        anchoredHeadSha: session.latestCandidateHeadSha,
    }).effectiveHeadSha;
    if (effectiveHeadSha !== input.currentHeadSha)
        throw new Error("review sessionのcandidate HEADがcurrent HEADと一致しません");
    return session;
}
//# sourceMappingURL=review-session.js.map