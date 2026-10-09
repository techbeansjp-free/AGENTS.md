import { git } from "../lib/process.js";
import { EMPTY_DIFF_DIGEST, assignInspectionForRound, judgeReviewReuse, } from "../domain/review-reuse.js";
import { deriveReviewRoundImpact } from "./impact-set.js";
import { GIT_ENV, evidenceOnlySuffix, observeReviewDiff, observeReviewDiffSections, } from "./review-diff.js";
import { changedPathsBetween, createFollowObservations, } from "./review-reuse-follow.js";
/**
 * review再利用判定（C2）が要求するGit観測（Issue #1544 C3）。読み取りsubcommandだけを使い、
 * 例外はC2が該当positionの`判定不能`へ変換する。transitionの観測は同じ範囲を2回導出しない。
 */
export function createReuseObserver(root, tipSha, counter) {
    const transitions = new Map();
    const tree = (sha) => git(["rev-parse", "--verify", `${sha}^{tree}`], root, {
        env: GIT_ENV,
    }).stdout.trim();
    return {
        ...createFollowObservations(root, tipSha, counter),
        link(previousHeadSha, nextSha) {
            if (evidenceOnlySuffix(root, previousHeadSha, nextSha) !== undefined)
                return "evidence-suffix";
            return tree(previousHeadSha) === tree(nextSha) ? "tree-equal" : "break";
        },
        transition(fromSha, toSha) {
            const key = `${fromSha}..${toSha}`;
            const cached = transitions.get(key);
            if (cached)
                return cached;
            let observed = {
                digest: EMPTY_DIFF_DIGEST,
                changedPaths: [],
                adjacentScope: [],
                unbounded: false,
            };
            if (fromSha !== toSha) {
                if (counter) {
                    counter.contentDiffs += 1;
                    counter.impactDerivations += 1;
                }
                // 雛形・記録前照合と同じ導出を使う（02 A-01）。
                const derived = deriveReviewRoundImpact({
                    root,
                    previousHeadSha: fromSha,
                    headSha: toSha,
                });
                observed = {
                    digest: derived.impact.changeDigest,
                    changedPaths: derived.impact.changedPaths,
                    adjacentScope: derived.adjacentScope,
                    unbounded: derived.adjacentScopeUnbounded,
                };
            }
            transitions.set(key, observed);
            return observed;
        },
        wholeDigest(baseSha, toSha) {
            if (counter)
                counter.contentDiffs += 1;
            return observeReviewDiff(root, baseSha, toSha).digest;
        },
        changedPaths(fromSha, toSha) {
            return changedPathsBetween(root, fromSha, toSha);
        },
        sections(baseSha, headSha) {
            if (counter)
                counter.contentDiffs += 1;
            return observeReviewDiffSections(root, baseSha, headSha);
        },
    };
}
/** local Gitが観測できる既定branch tip（雛形用）。観測できなければundefined。 */
export function localDefaultBranchTip(root) {
    const observed = git(["rev-parse", "--verify", "refs/remotes/origin/HEAD^{commit}"], root, { env: GIT_ENV, allowFailure: true });
    return observed.status === 0 ? observed.stdout.trim() : undefined;
}
/** `pr merge`の再利用判定。tipは検証済み`authority.defaultBranchTipOid`だけを渡す。 */
export function judgeReviewReuseAtMerge(input) {
    return judgeReviewReuse({
        session: input.session,
        actualAuditBase: input.actualAuditBase,
        effectiveHeadSha: input.effectiveHeadSha,
        observer: createReuseObserver(input.root, input.tipSha, input.counter),
    });
}
/** `review round --init`と`--apply`が共有する検分割当（local tipで評価する）。 */
export function assignReviewInspection(input) {
    return assignInspectionForRound({
        session: input.session,
        fromSha: input.fromSha,
        toSha: input.toSha,
        focus: input.focus,
        allowFollowOnly: input.allowFollowOnly,
        observer: createReuseObserver(input.root, localDefaultBranchTip(input.root)),
    });
}
//# sourceMappingURL=review-reuse.js.map