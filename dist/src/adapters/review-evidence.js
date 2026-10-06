import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { isContentEquivalent } from "../domain/evidence-reanchor.js";
import { isEvidenceOnlyPath } from "../domain/review.js";
import { unconvergedReviewSessionDiagnostic, isReviewSessionConverged, } from "../domain/review-convergence.js";
import { createReviewEvidence, isReviewActorId, parseReviewEvidence, renderReviewEvidence, REVIEW_EVIDENCE_NAME_PATTERN, validateReviewEvidenceAgainstSession, } from "../domain/review-evidence.js";
import { readStoredStagingRecord } from "../domain/staging.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { loadTrustedVerificationPolicy } from "../domain/policy.js";
import { stableJson } from "../lib/security.js";
import { selectObservedVerification, } from "../domain/verification-run.js";
import { computeImpactSet } from "./impact-set.js";
import { GIT_ENV, observeReviewDiff, resolveImplementationHead, } from "./review-diff.js";
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
 *
 * **この関数はaudit範囲の完全性そのものは検証しない（Issue #1495）。** 宣言された
 * `baseSha`がsessionの比較基点の前進としてancestor範囲内でありさえすれば受理する
 * ため、宣言済みbaseと実際の`merge-base`が乖離するケース自体はここでは防げない。
 * それは`pr merge`側（`inspectAuthorizedPullRequestMerge`）が、実際に再計算した
 * `merge-base`（`actualAuditBase`）と`session.anchor.diffBaseSha`の**完全一致**を
 * 別途Gitから直接要求する形で担保する。`session.anchor.diffBaseSha`自体は
 * round 1作成時（`buildReviewRoundDraft`、`src/adapters/review-session.ts`）に
 * ローカル観測済みの既定branch tipまたはそれとの実際のmerge-baseへ拘束済みで
 * あり（REV-02是正）、この関数（`reviewEvidenceBindingErrors`）が受理する
 * ancestor範囲内の`baseSha`はその拘束済みsession比較基点を前進の起点にする
 * だけであって、`pr merge`側の完全一致判定を弱めない。検討の過程では、この
 * 関数自体を`baseSha`とsession比較基点の厳密一致のみへ狭める設計
 * （`trustedAdvancedBaseSha`）や、`pr merge`側を変更path集合の被覆関係
 * （部分集合）で判定する設計を試みたが、前者はlegitimateなreviewed-forward
 * follow-mainの`review export`を壊す回帰を起こし（Step 10 round 2独立review
 * High指摘）、後者は同一round内のhunk単位の部分revertを見逃す欠陥が
 * あることが判明した（Step 10 round 3独立review High指摘）。最終的に
 * この関数は#1495是正前の挙動へ完全に戻し、audit範囲の完全性はもっぱら
 * `pr merge`側の完全一致判定（と、Issue #1544解決までの暫定guard）が担う
 * 設計へ収束した。
 *
 * **`session.latestCandidateHeadSha`はcanonical resolverへ通さず、厳密な一致を
 * 要求する（Issue #1532 round 1指摘、MEDIUM-1）。** 検討時は「session側の値も
 * resolverへ通せば汚染されたcandidate HEADから自己修復できる」という設計を試みたが、
 * (a) 実インシデント（PR #1528/#1537）はexport側の解決だけで直り、この変更は不要
 * だった、(b) `baseSha === session.anchor.diffBaseSha`の分岐にresolver後の値との
 * ancestry再検証が無く、resolverが比較基点より下流へ歩いた場合を検知できない、
 * (c) `H_impl === candidate`かつcandidate自身がevidence-path commitである既存の
 * 受理形が、resolver適用後は分岐2（内容等価性、baseの前進を許容しない）へ落ちて
 * 失われる（Issue #1493と同型の回帰）、(d) `pr merge`側の`resolveImplementationCommitForMerge`
 * （`src/cli.ts`）は本Issueで統合しておらず、汚染されたcandidate HEADに対して
 * export/validateは通ってもpr mergeだけ拒否するという未カバーの穴が残る、という
 * 4点が判明したため、より安全な厳密比較へ戻した。汚染されたsession候補の救済は
 * 本Issueのscope外とし、必要なら`resolveImplementationCommitForMerge`も含めた
 * 別Issueで扱う。
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
 * 再計算する。**検証欄も再導出する。** stagingの全記録から、再計算した影響集合と
 * 照合時点のtrusted policyで`selectObservedVerification`を実行し、証跡の検証欄が
 * その導出結果と完全一致することを要求する。手で組んだ証跡が合格記録だけを
 * 抜き出し、後続の不合格や宣言外のcommandを隠す形を拒否する。
 */
export function observedEvidenceErrors(root, staging, evidence, verificationPolicy) {
    const { baseSha, implementationHeadSha } = evidence.observed;
    const errors = [];
    let impact;
    try {
        impact = computeImpactSet({
            root,
            baseSha,
            headSha: implementationHeadSha,
        });
        if (impact.changeDigest !== evidence.observed.diffDigest)
            errors.push("review証跡のdiffDigestが比較基点..H_implのGit差分と一致しません");
        if (impact.digest !== evidence.observed.impact.digest)
            errors.push("review証跡の影響集合digestが比較基点..H_implから再計算した影響集合と一致しません");
        if (impact.mode !== evidence.observed.impact.mode)
            errors.push(`review証跡の影響集合mode ${evidence.observed.impact.mode} が再計算したmode ${impact.mode} と一致しません`);
    }
    catch (error) {
        errors.push(`review証跡のdiff・影響集合をGitで観測できません: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (impact === undefined)
        return errors;
    try {
        const derived = selectObservedVerification(readVerificationRuns(staging), {
            headSha: implementationHeadSha,
            impactDigest: impact.digest,
            impactMode: impact.mode,
            impactFeatures: impact.features,
            policy: verificationPolicy ?? loadTrustedVerificationPolicy(root),
        });
        if (stableJson(derived) !== stableJson(evidence.observed.verification))
            errors.push("review証跡の検証欄がstagingの観測記録とtrusted policyから再導出した検証欄と一致しません。H_implでverify runを実行した後にreview exportを再実行してください");
    }
    catch (error) {
        errors.push(`review証跡の検証欄をstagingの観測記録から再導出できません: ${error instanceof Error ? error.message : String(error)}`);
    }
    return errors;
}
/**
 * stagingとGitから証跡を照合する。`review validate --artifact --staging`と消費側
 * （`pr merge`は独立性modeによらず）が共有する。`verificationPolicy`を省略すると
 * `origin/HEAD`のtrusted commitから読む。`pr merge`はPR baseのtrusted setから渡す。
 */
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
            errors.push(...observedEvidenceErrors(root, staging, input.evidence, input.verificationPolicy));
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
 * **生成はcurrent HEADをcanonical resolver（`resolveImplementationHead`、
 * Issue #1532）へ通した値（`H_impl`）で行う。** current HEAD自身がevidence-only
 * trailing commit（前回のexportで加えた証跡commit、収束後の是正commit等）の
 * 上にある場合も、resolverが遡って真の実装commitへ解決する。実装commitの後に
 * 証跡1 fileだけをcommitして`H_final`にする。書込みはatomicで、書込み後に
 * 読み戻して厳密に再検証する。
 *
 * **resolverには、このexportが書こうとしているartifact path自身を渡す**
 * （Issue #1532 round 1指摘、HIGH-1）。current HEAD自身が、今回のexportとは
 * 無関係な別pathのreview記録を編集する正当な実装commitであっても、遡りは
 * このexportのartifact pathだけに固定され、その別commit自身を遡り越さない。
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
    /**
     * **出力先pathを、H_impl解決より先に確定する。** canonical resolver
     * （`resolveImplementationHead`）は「どのpathを遡り対象とするか」を明示引数で
     * 要求する（Issue #1532 round 1指摘、HIGH-1）。ここで確定する`relative`が
     * その値であり、「このexportが書こうとしているartifact path」を表す。
     * `head`自身がこのpath以外のreview記録を編集する正当な実装commitであっても、
     * その別pathを誤って遡り越さない。
     */
    const out = path.resolve(root, input.out ?? path.join("docs", "reviews", `${input.issue}_review.json`));
    const relative = path.relative(root, out).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("review exportの--outはrepository内が必要です");
    if (!isEvidenceOnlyPath(relative))
        throw new Error("review exportの--outはdocs/reviews/または.agent-skill-chain/reviews/配下が必要です");
    const name = REVIEW_EVIDENCE_NAME_PATTERN.exec(path.basename(out));
    if (name === null || Number(name[1]) !== input.issue)
        throw new Error(`review exportの--outのfile名は${input.issue}_review.jsonが必要です`);
    const session = readStoredReviewSession(staging);
    if (session === null)
        throw new Error("review exportには永続review sessionが必要です");
    if (!isReviewSessionConverged(session))
        throw new Error(unconvergedReviewSessionDiagnostic(session));
    const currentHeadSha = resolveCommit(gitRoot, "current HEAD", "HEAD");
    const implementationHeadSha = resolveImplementationHead(gitRoot, currentHeadSha, relative);
    const baseSha = input.baseSha === undefined
        ? session.anchor.diffBaseSha
        : resolveCommit(gitRoot, "--base", input.baseSha);
    const bindingErrors = reviewEvidenceBindingErrors(gitRoot, session, {
        baseSha,
        implementationHeadSha,
    });
    if (bindingErrors.length > 0)
        throw new Error(`${bindingErrors.join("; ")}。current HEADから遡って解決したH_impl（${implementationHeadSha}）が、review済みsessionのcandidate HEADと一致しません。review済みの実装commit以降でreview exportを実行してください`);
    /**
     * **検証欄は申告ではなく観測から導出する。** `比較基点..H_impl`の影響集合を
     * 再計算し、同じ`H_impl`と影響集合digestで`verify run`が記録した合格実行だけを
     * 埋め込む。影響集合がfullなら`scope=full`の合格実行を要求する。commandは
     * 既定branchのtrusted policyの宣言と照合する。
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
        policy: loadTrustedVerificationPolicy(gitRoot),
    });
    const evidence = createReviewEvidence({
        issue: input.issue,
        baseSha,
        implementationHeadSha,
        diffDigest: impact.changeDigest,
        session,
        impact: { digest: impact.digest, mode: impact.mode },
        verification,
        independenceMode: input.independenceMode,
        reviewer: input.reviewer,
        implementer: input.implementer,
    });
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