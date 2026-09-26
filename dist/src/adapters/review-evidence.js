import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { isContentEquivalent } from "../domain/evidence-reanchor.js";
import { isEvidenceOnlyPath } from "../domain/review.js";
import { unconvergedReviewSessionDiagnostic } from "../domain/review-convergence.js";
import { createReviewEvidence, isReviewActorId, parseReviewEvidence, renderReviewEvidence, REVIEW_EVIDENCE_NAME_PATTERN, validateReviewEvidenceAgainstSession, } from "../domain/review-evidence.js";
import { readStoredStagingRecord } from "../domain/staging.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { selectObservedVerification, verificationRecordErrors, } from "../domain/verification-run.js";
import { computeImpactSet } from "./impact-set.js";
import { GIT_ENV, observeReviewDiff } from "./review-diff.js";
import { readStoredReviewSession } from "./review-session-store.js";
import { readVerificationRuns } from "./verification-run.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
function isAncestor(root, ancestor, descendant) {
    return (git(["merge-base", "--is-ancestor", ancestor, descendant], root, {
        env: GIT_ENV,
        allowFailure: true,
    }).status === 0);
}
function resolveCommit(root, label, value) {
    const observed = git(["rev-parse", "--verify", `${value}^{commit}`], root, {
        env: GIT_ENV,
        allowFailure: true,
    });
    if (observed.status !== 0)
        throw new Error(`${label}をexact commitへ解決できません: ${value}`);
    return observed.stdout.trim();
}
/**
 * 証跡の`baseSha`・`implementationHeadSha`がreview済みの実装を指すかをGitから判定する。
 *
 * 受理する形は2つだけである。
 *
 * 1. `H_impl`が保存済みsessionのcandidate HEADそのもの。基点はsessionの`diffBaseSha`か、
 *    その前進（既定branch追随、Issue #1493）で`H_impl`のancestorであるもの
 * 2. rebase後の`H_impl`。`基点..H_impl`の完全diffがsessionの
 *    `diffBaseSha..candidate HEAD`と内容等価であるもの
 *
 * **どちらでもない値は、reviewしていない内容を指すため拒否する。**
 */
export function reviewEvidenceBindingErrors(root, session, evidence) {
    const { baseSha, implementationHeadSha } = evidence;
    if (baseSha === implementationHeadSha)
        return ["review証跡の比較基点とH_implは異なるcommitでなければなりません"];
    try {
        if (implementationHeadSha === session.latestCandidateHeadSha) {
            if (baseSha === session.anchor.diffBaseSha)
                return [];
            if (isAncestor(root, session.anchor.diffBaseSha, baseSha) &&
                isAncestor(root, baseSha, implementationHeadSha))
                return [];
            return [
                "review証跡の比較基点がsessionの比較基点でも、その前進でH_implのancestorであるcommitでもありません",
            ];
        }
        const reviewed = observeReviewDiff(root, session.anchor.diffBaseSha, session.latestCandidateHeadSha);
        const rebased = observeReviewDiff(root, baseSha, implementationHeadSha);
        if (isContentEquivalent(reviewed, rebased))
            return [];
        return [
            `review証跡のH_impl ${implementationHeadSha} はreview済みcandidate HEAD ${session.latestCandidateHeadSha} ではなく、比較基点からの差分も内容等価ではありません。review済みの実装commitでreview exportを実行してください`,
        ];
    }
    catch (error) {
        return [
            `review証跡の比較基点・H_implをGitで観測できません: ${error instanceof Error ? error.message : String(error)}`,
        ];
    }
}
/**
 * 証跡の`observed`節をGitと検証記録から再導出して照合する。**証跡の値を
 * authorityにしない。** diff digest・影響集合digestとmodeは`比較基点..H_impl`から
 * 再計算し、検証欄はstagingの機械記録に同じ`recordDigest`の合格記録があることを求める。
 */
export function observedEvidenceErrors(root, staging, evidence) {
    const { baseSha, implementationHeadSha } = evidence.observed;
    const errors = [];
    try {
        const diff = observeReviewDiff(root, baseSha, implementationHeadSha);
        if (diff.digest !== evidence.observed.diffDigest)
            errors.push("review証跡のdiffDigestが比較基点..H_implのGit差分と一致しません");
        const impact = computeImpactSet({
            root,
            baseSha,
            headSha: implementationHeadSha,
        });
        if (impact.digest !== evidence.observed.impact.digest)
            errors.push("review証跡の影響集合digestが比較基点..H_implから再計算した影響集合と一致しません");
        if (impact.mode !== evidence.observed.impact.mode)
            errors.push(`review証跡の影響集合mode ${evidence.observed.impact.mode} が再計算したmode ${impact.mode} と一致しません`);
    }
    catch (error) {
        errors.push(`review証跡のdiff・影響集合をGitで観測できません: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        errors.push(...verificationRecordErrors(evidence.observed.verification, readVerificationRuns(staging)));
    }
    catch (error) {
        errors.push(`stagingの検証記録を読めません: ${error instanceof Error ? error.message : String(error)}`);
    }
    return errors;
}
/** stagingとGitから証跡を照合する。`review validate --artifact --staging`と消費側が共有する。 */
export function verifyReviewEvidenceWithStaging(input) {
    const staging = assertWorkflowStaging(input.staging);
    const session = readStoredReviewSession(staging);
    const errors = validateReviewEvidenceAgainstSession(input.evidence, session, {
        ...(input.independenceMode === undefined
            ? {}
            : { independenceMode: input.independenceMode }),
    });
    if (session !== null) {
        const root = stagingRepositoryRoot(staging);
        const binding = reviewEvidenceBindingErrors(root, session, input.evidence.observed);
        errors.push(...binding);
        if (binding.length === 0)
            errors.push(...observedEvidenceErrors(root, staging, input.evidence));
    }
    return errors;
}
function issueFromTracker(tracker) {
    const matched = /\/issues\/(?<issue>[1-9]\d*)$/u.exec(tracker ?? "")?.groups
        ?.issue;
    return matched === undefined ? undefined : Number(matched);
}
/**
 * 収束済みreview sessionから証跡fileを生成する（`review export`）。
 *
 * **生成はcurrent HEAD（`H_impl`）で行う。** 実装commitの後に証跡1 fileだけを
 * commitして`H_final`にする。書込みはatomicで、書込み後に読み戻して厳密に再検証する。
 */
export function exportReviewEvidence(input) {
    const staging = assertWorkflowStaging(input.staging);
    const root = path.resolve(input.root);
    const gitRoot = stagingRepositoryRoot(staging);
    if (!Number.isSafeInteger(input.issue) || input.issue < 1)
        throw new Error("review exportの--issueは1以上の整数が必要です");
    const trackerIssue = issueFromTracker(readStoredStagingRecord(staging).tracker);
    if (trackerIssue !== undefined && trackerIssue !== input.issue)
        throw new Error(`review exportの--issue=${input.issue} がstagingのtracker Issue #${trackerIssue} と一致しません`);
    if (!isReviewActorId(input.reviewer) || !isReviewActorId(input.implementer))
        throw new Error("review exportの--reviewerと--implementerはstable identity（英数字で始まり英数字と_.:=/@-だけを含む）が必要です");
    if (input.reviewer === input.implementer)
        throw new Error("review exportの--reviewerと--implementerは異なるidentityが必要です。reviewerはimplementerと別のsession/contextでなければなりません");
    const session = readStoredReviewSession(staging);
    if (session === null)
        throw new Error("review exportには永続review sessionが必要です");
    if (session.status !== "converged")
        throw new Error(unconvergedReviewSessionDiagnostic(session.status));
    const implementationHeadSha = resolveCommit(gitRoot, "current HEAD", "HEAD");
    const baseSha = input.baseSha === undefined
        ? session.anchor.diffBaseSha
        : resolveCommit(gitRoot, "--base", input.baseSha);
    const bindingErrors = reviewEvidenceBindingErrors(gitRoot, session, {
        baseSha,
        implementationHeadSha,
    });
    if (bindingErrors.length > 0)
        throw new Error(`${bindingErrors.join("; ")}。current HEADがreview済みの実装commit（H_impl）であることを確認してください。証跡commitの後（H_final）では実行できません`);
    /**
     * **検証欄は申告ではなく観測から導出する。** `比較基点..H_impl`の影響集合を
     * 再計算し、同じ`H_impl`と影響集合digestで`verify run`が記録した合格実行だけを
     * 埋め込む。影響集合がfullなら`scope=full`の合格実行を要求する。
     */
    const impact = computeImpactSet({
        root: gitRoot,
        baseSha,
        headSha: implementationHeadSha,
    });
    const verification = selectObservedVerification(readVerificationRuns(staging), {
        headSha: implementationHeadSha,
        impactDigest: impact.digest,
        impactMode: impact.mode,
        impactFeatures: impact.features,
    });
    const evidence = createReviewEvidence({
        issue: input.issue,
        baseSha,
        implementationHeadSha,
        diffDigest: observeReviewDiff(gitRoot, baseSha, implementationHeadSha)
            .digest,
        session,
        impact: { digest: impact.digest, mode: impact.mode },
        verification,
        independenceMode: input.independenceMode,
        reviewer: input.reviewer,
        implementer: input.implementer,
    });
    const out = path.resolve(root, input.out ?? path.join("docs", "reviews", `${input.issue}_review.json`));
    const relative = path.relative(root, out).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("review exportの--outはrepository内が必要です");
    if (!isEvidenceOnlyPath(relative))
        throw new Error("review exportの--outはdocs/reviews/または.agent-skill-chain/reviews/配下が必要です");
    const name = REVIEW_EVIDENCE_NAME_PATTERN.exec(path.basename(out));
    if (name === null || Number(name[1]) !== input.issue)
        throw new Error(`review exportの--outのfile名は${input.issue}_review.jsonが必要です`);
    const parent = path.dirname(out);
    /**
     * **directoryを作る前に既存の祖先を全部検査する。** 先に`mkdirSync`すると、
     * 祖先（例: `docs`）がsymlinkのとき拒否より前にrepository外へdirectoryを作る。
     */
    let ancestor = path.resolve(root);
    for (const segment of path.relative(root, parent).split(path.sep)) {
        if (segment === "")
            continue;
        ancestor = path.join(ancestor, segment);
        const stat = fs.lstatSync(ancestor, { throwIfNoEntry: false });
        if (stat === undefined)
            break;
        if (stat.isSymbolicLink() || !stat.isDirectory())
            throw new Error("review exportの--outはrepository内のsymlinkを含まない親directoryが必要です");
    }
    fs.mkdirSync(parent, { recursive: true });
    const realRoot = fs.realpathSync(root);
    const realParent = fs.realpathSync(parent);
    const lexical = path.relative(root, parent);
    if (lexical.startsWith("..") ||
        path.isAbsolute(lexical) ||
        path.resolve(realRoot, lexical) !== realParent)
        throw new Error("review exportの--outはrepository内のsymlinkを含まない親directoryが必要です");
    const realStaging = fs.realpathSync(staging);
    if (realParent === realStaging ||
        realParent.startsWith(`${realStaging}${path.sep}`))
        throw new Error("review exportの--outはstaging外が必要です");
    const existing = fs.lstatSync(out, { throwIfNoEntry: false });
    if (existing !== undefined &&
        (existing.isSymbolicLink() || !existing.isFile()))
        throw new Error("review exportの--outは通常fileでなければなりません");
    const content = renderReviewEvidence(evidence);
    writeFileAtomic(out, content, { fileMode: 0o644 });
    const reread = parseReviewEvidence(fs.readFileSync(out, "utf8"));
    if (reread.evidenceDigest !== evidence.evidenceDigest)
        throw new Error("review証跡の書き込み後read-backが一致しません");
    return { path: out, evidence: reread };
}
//# sourceMappingURL=review-evidence.js.map