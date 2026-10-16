import { git } from "../lib/process.js";
import { EMPTY_DIFF_DIGEST, assignInspectionForRound, judgeReviewReuse, } from "../domain/review-reuse.js";
import { deriveReviewRoundImpact, } from "./impact-set.js";
import { GIT_ENV, evidenceOnlySuffix, observeReviewDiff, observeReviewDiffSections, resolveUniqueMergeBase, } from "./review-diff.js";
/**
 * review再利用判定（C2）が要求するGit観測（Issue #1544 C3）。読み取りsubcommandだけを使い、
 * 例外はC2が該当positionの`判定不能`へ変換する。transitionの観測は同じ範囲を2回導出しない。
 */
export function createReuseObserver(root, records, counter) {
    const impacts = new Map();
    const deriveImpact = (fromSha, toSha) => {
        const key = `${fromSha}..${toSha}`;
        const known = impacts.get(key);
        if (known)
            return known;
        if (counter) {
            counter.contentDiffs += 1;
            counter.impactDerivations += 1;
        }
        const observed = deriveReviewRoundImpact({
            root,
            previousHeadSha: fromSha,
            headSha: toSha,
            records,
        });
        impacts.set(key, observed);
        return observed;
    };
    const transitions = new Map();
    const tree = (sha) => git(["rev-parse", "--verify", `${sha}^{tree}`], root, {
        env: GIT_ENV,
    }).stdout.trim();
    return {
        deriveImpact,
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
                const derived = deriveImpact(fromSha, toSha);
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
        isAncestor(ancestorSha, descendantSha) {
            const status = git(["merge-base", "--is-ancestor", ancestorSha, descendantSha], root, { env: GIT_ENV, allowFailure: true }).status;
            if (status !== 0 && status !== 1)
                throw new Error(`祖先関係を観測できません: ${ancestorSha} ${descendantSha}`);
            return status === 0;
        },
        wholeDigest(baseSha, toSha) {
            if (counter)
                counter.contentDiffs += 1;
            return observeReviewDiff(root, baseSha, toSha).digest;
        },
        changedPaths(fromSha, toSha) {
            // `--name-only`のpath列でありcontent再計算に数えない。
            return git(["diff", "--name-only", "-z", "--no-renames", fromSha, toSha, "--"], root, { env: GIT_ENV })
                .stdout.split("\0")
                .filter(Boolean);
        },
        sections(baseSha, headSha) {
            if (counter)
                counter.contentDiffs += 1;
            return observeReviewDiffSections(root, baseSha, headSha);
        },
    };
}
/**
 * 雛形の比較基点: local Gitが観測できる既定branch tip（`refs/remotes/origin/HEAD`）と`headSha`の
 * 一意なmerge-base（`pr merge`の`actualAuditBase`と同じ求め方）。求められなければundefined。
 * round 1のhead（`initialHeadSha`）が既に含む基点は全体検分でも動かせない（`judgeReviewReuse`）
 * ため、割当の基点にせずundefinedを返す。
 */
function localAuditBase(root, headSha, anchor) {
    const tip = git(["rev-parse", "--verify", "refs/remotes/origin/HEAD^{commit}"], root, { env: GIT_ENV, allowFailure: true });
    if (tip.status !== 0)
        return undefined;
    let base;
    try {
        base = resolveUniqueMergeBase(root, headSha, tip.stdout.trim());
    }
    catch {
        return undefined;
    }
    return base !== anchor.diffBaseSha &&
        git(["merge-base", "--is-ancestor", base, anchor.initialHeadSha], root, {
            env: GIT_ENV,
            allowFailure: true,
        }).status === 0
        ? undefined
        : base;
}
/**
 * `pr merge`の再利用判定。`actualAuditBase`は検証済み既定branch tipから求めた値だけを渡す。
 * `issue`はstagingのtracker Issue番号（`stagingTrackerIssue`）で、前headのreview記録の照合に使う。
 */
export function judgeReviewReuseAtMerge(input) {
    return judgeReviewReuse({
        session: input.session,
        actualAuditBase: input.actualAuditBase,
        effectiveHeadSha: input.effectiveHeadSha,
        observer: createReuseObserver(input.root, { issue: input.issue, session: input.session }, input.counter),
    });
}
/** `review round --init`と`--apply`が共有する検分割当（local tipからの比較基点で評価する）。 */
export function assignReviewInspection(input) {
    const actualAuditBase = localAuditBase(input.root, input.toSha, input.session.anchor);
    return assignInspectionForRound({
        session: input.session,
        ...(actualAuditBase === undefined ? {} : { actualAuditBase }),
        fromSha: input.fromSha,
        toSha: input.toSha,
        focus: input.focus,
        observer: input.observer ??
            createReuseObserver(input.root, {
                issue: input.issue,
                session: input.session,
            }),
    });
}
//# sourceMappingURL=review-reuse.js.map