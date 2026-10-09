import { git } from "../lib/process.js";
import type { FollowObservation } from "../domain/review-reuse-follow.js";
import { isEvidenceOnlyPath } from "../domain/review.js";
import { computeImpactSet } from "./impact-set.js";
import { GIT_ENV } from "./review-diff.js";
import { isDefaultBranchFollowMerge } from "./review-session-store.js";

/** content diff再計算と影響集合導出の回数（NFR-02のtest seam）。 */
export interface ReuseObservationCounter {
  contentDiffs: number;
  impactDerivations: number;
}

/** `git diff --name-only -z --no-renames`のpath列（content再計算に数えない）。 */
export function changedPathsBetween(
  root: string,
  fromSha: string,
  toSha: string,
): string[] {
  return git(
    ["diff", "--name-only", "-z", "--no-renames", fromSha, toSha, "--"],
    root,
    { env: GIT_ENV },
  )
    .stdout.split("\0")
    .filter(Boolean);
}

/**
 * 追随の観測だけを行う（Issue #1544 C3の追随部分）。既定branch tipは呼び出し側が注入し、
 * `pr merge`は検証済み`authority.defaultBranchTipOid`、雛形はlocal tipを渡す。
 */
export function createFollowObservations(
  root: string,
  tipSha: string | undefined,
  counter?: ReuseObservationCounter,
) {
  return {
    followParent(
      previousHeadSha: string,
      mergeSha: string,
      baseSha: string,
    ): string | undefined {
      if (
        tipSha === undefined ||
        !isDefaultBranchFollowMerge(root, previousHeadSha, mergeSha, tipSha)
      )
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
    follow(
      baseSha: string,
      secondParent: string,
      mergeSha: string,
    ): FollowObservation {
      const mainChanged = changedPathsBetween(root, baseSha, secondParent);
      if (counter) {
        counter.contentDiffs += 1;
        counter.impactDerivations += 1;
      }
      const impact = computeImpactSet({
        root,
        baseSha: secondParent,
        headSha: mergeSha,
        excludePath: isEvidenceOnlyPath,
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
