import { git } from "../lib/process.js";
import { computeImpactSet, evidenceSuffixPaths, } from "./impact-set.js";
import { GIT_ENV } from "./review-diff.js";
import { isDefaultBranchFollowMerge } from "./review-session-store.js";
/** `git diff --name-only -z --no-renames`のpath列（content再計算に数えない）。 */
export function changedPathsBetween(root, fromSha, toSha) {
    return git(["diff", "--name-only", "-z", "--no-renames", fromSha, toSha, "--"], root, { env: GIT_ENV })
        .stdout.split("\0")
        .filter(Boolean);
}
/**
 * 追随の観測だけを行う（Issue #1544 C3の追随部分）。既定branch tipは呼び出し側が注入し、
 * `pr merge`は検証済み`authority.defaultBranchTipOid`、雛形はlocal tipを渡す。
 */
export function createFollowObservations(root, tipSha, records, counter) {
    return {
        followParent(previousHeadSha, mergeSha, baseSha) {
            if (tipSha === undefined ||
                !isDefaultBranchFollowMerge(root, previousHeadSha, mergeSha, tipSha))
                return undefined;
            const second = git(["rev-list", "--parents", "-n", "1", mergeSha], root, {
                env: GIT_ENV,
            })
                .stdout.trim()
                .split(/\s+/u)[2];
            return second !== undefined &&
                git(["merge-base", "--is-ancestor", baseSha, second], root, {
                    env: GIT_ENV,
                    allowFailure: true,
                }).status === 0
                ? second
                : undefined;
        },
        follow(baseSha, secondParent, mergeSha, previousHeadSha) {
            const mainChanged = changedPathsBetween(root, baseSha, secondParent);
            if (counter) {
                counter.contentDiffs += 1;
                counter.impactDerivations += 1;
            }
            const impact = computeImpactSet({
                root,
                baseSha: secondParent,
                headSha: mergeSha,
                excludePaths: evidenceSuffixPaths(root, previousHeadSha, secondParent, mergeSha, records),
            });
            return {
                mainChanged,
                impactPaths: [
                    ...impact.changedPaths,
                    ...impact.adjacent.map(({ path }) => path),
                ],
                unbounded: impact.mode === "full",
            };
        },
    };
}
//# sourceMappingURL=review-reuse-follow.js.map