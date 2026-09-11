import path from "node:path";
import { advanceReviewSession, parseReviewRoundInput, } from "../domain/review-convergence.js";
import { calculateStagingDigest, listStagingArtifacts, readStoredStagingRecord, refreshStoredStagingDigest, withStagingMutationLock, } from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
import { observeReviewDiff } from "./review-diff.js";
import { REVIEW_SESSION_FILE, readStoredReviewSession, } from "./review-session-store.js";
export { observeReviewDiff, REVIEW_SESSION_FILE, readStoredReviewSession };
import { deriveEffectiveHead } from "../domain/evidence-reanchor.js";
import { isEvidenceOnlyPath } from "../domain/review.js";
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
/**
 * **staging digest不一致の診断に付ける再開手順。** digestを再固定できるのは
 * `workflow record`だけであり、拒否だけを返すと利用者はsourceを読むまで
 * 次の1手が分からない（Issue #1323、A-3）。判定は変えず文言だけを足す。
 */
export const STAGING_DIGEST_RERECORD_HINT = "。stagingを編集した場合は workflow record --step=<最新のStep> を再実行してdigestを更新してから再試行してください";
function assertStoredStagingDigest(staging) {
    const stored = readStoredStagingRecord(staging);
    const artifacts = listStagingArtifacts(staging);
    if (stableJson(stored.artifacts) !== stableJson(artifacts) ||
        stored.digest !== calculateStagingDigest(staging, artifacts))
        throw new Error(`review session更新前のstaging成果物一覧またはdigestが一致しません${STAGING_DIGEST_RERECORD_HINT}`);
}
function sortedUnique(values) {
    return [...new Set(values)].sort();
}
function resolveCommit(root, label, sha) {
    const observed = git(["rev-parse", "--verify", `${sha}^{commit}`], root, {
        env: GIT_ENV,
        allowFailure: true,
    });
    if (observed.status !== 0)
        throw new Error(`review round --initの${label}をexact commitへ解決できません: ${sha}`);
    return observed.stdout.trim();
}
/**
 * **次roundの入力雛形を保存済みsessionと実Gitから組み立てる**（Issue #1323、A-2）。
 *
 * findings以外を確定した`ReviewRoundInput`を返す。sessionが無ければround 1で、
 * `baseSha`・`scopeIds`・`acceptanceCriteriaIds`を要求し`initialDiffDigest`を実測する。
 * sessionがあれば次roundで、anchorをsessionから写し、`previousBlocking`を前roundの
 * blocking、`fixedDiff`を再固定chainの実効HEADから`headSha`までの実Git差分にする。
 * **stagingもsessionも書かない。** 判定は`previewReviewRound`が従来どおり行う。
 */
export function buildReviewRoundDraft(input) {
    const staging = assertWorkflowStaging(input.staging);
    const root = path.resolve(staging, "../../../..");
    const headSha = resolveCommit(root, "--head", input.headSha);
    const previous = readStoredReviewSession(staging);
    const notes = [];
    const currentHeadSha = git(["rev-parse", "--verify", "HEAD^{commit}"], root, {
        env: GIT_ENV,
    }).stdout.trim();
    /**
     * **previewが拒否する雛形を書かない**（round 1 REV-02）。`review round`は
     * current HEADだけを受理し、収束後は空でない実fixedDiffを要求するため、
     * その条件を満たさない入力はnotesでなくerrorにする。
     */
    if (currentHeadSha !== headSha)
        throw new Error(`review round --initの--head ${headSha.slice(0, 8)} はrepositoryのcurrent HEAD ${currentHeadSha.slice(0, 8)} と一致しません。review roundはcurrent HEADだけを受理します`);
    let round;
    if (previous === null) {
        if (typeof input.baseSha !== "string")
            throw new Error("review round --initはsessionが無いとき--base=<sha>が必要です");
        if (!input.scopeIds?.length || !input.acceptanceCriteriaIds?.length)
            throw new Error("review round --initはsessionが無いとき--scope=<ID,...>と--ac=<ID,...>が必要です");
        const baseSha = resolveCommit(root, "--base", input.baseSha);
        const observed = observeReviewDiff(root, baseSha, headSha);
        round = {
            round: 1,
            previousRoundDigest: null,
            anchor: {
                /** anchorのID列は重複なし昇順が契約であり、雛形側で正規化する */
                scopeIds: sortedUnique(input.scopeIds),
                acceptanceCriteriaIds: sortedUnique(input.acceptanceCriteriaIds),
                invariantIds: sortedUnique(input.invariantIds ?? []),
                diffBaseSha: baseSha,
                initialHeadSha: headSha,
                initialDiffDigest: observed.digest,
            },
            candidateHeadSha: headSha,
            focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
            findings: [],
        };
        notes.push("round 1は固定initial HEADの全scope reviewである。findingsへreviewの指摘を書く");
    }
    else {
        /** budget枯渇はHEAD差分の有無より先に固有の停止理由を返す。 */
        if (previous.status === "budget-exhausted")
            throw new Error("review round --init: sessionはbudget-exhaustedです。取り直しroundは開けません。follow-up Issueの新しいstagingで工程を通してください");
        if (input.baseSha !== undefined ||
            input.scopeIds ||
            input.acceptanceCriteriaIds ||
            input.invariantIds)
            notes.push("sessionがあるため--base・--scope・--ac・--invariantは無視し、anchorをsessionから写した");
        const previousHeadSha = deriveEffectiveHead({
            records: readEvidenceReanchorChain(staging),
            anchoredHeadSha: previous.latestCandidateHeadSha,
        }).effectiveHeadSha;
        const fixed = observeReviewDiff(root, previousHeadSha, headSha).changedPaths;
        const last = previous.rounds.at(-1);
        const previousBlocking = [...(last?.blocking ?? [])];
        round = {
            round: previous.rounds.length + 1,
            previousRoundDigest: previous.latestRoundDigest,
            anchor: previous.anchor,
            candidateHeadSha: headSha,
            focus: { previousBlocking, fixedDiff: fixed, adjacentScope: [] },
            findings: [],
        };
        if (previousBlocking.length > 0)
            notes.push(`前round blocker ${previousBlocking.join("、")} の再評価結果（resolvedまたはvalid）をfindingsへ同じIDで入れる。脱落は拒否される`);
        if (fixed.length === 0)
            throw new Error("review round --init: 前round headからの実Git差分が空です。HEADを進めずに次roundを記録することはできません");
        if (previous.status === "converged")
            notes.push("sessionはconvergedである。取り直しroundは収束後のHEAD移動に対して1回だけ許される");
    }
    return { round: parseReviewRoundInput(round), notes };
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
        /**
         * **前round headは再固定chainから導出した実効HEADである。**
         *
         * 生の`latestCandidateHeadSha`を使うと、rebase後に`review reanchor`が成立しても
         * 次の前進修正で「diff baseがcandidate HEADのancestorではありません」と拒否され、
         * **正規経路が再び塞がる**（Issue #1172）。chainが空なら
         * `latestCandidateHeadSha`そのものになり、判定は変更前と同一である。
         */
        const previousHeadSha = deriveEffectiveHead({
            records: readEvidenceReanchorChain(staging),
            anchoredHeadSha: previous.latestCandidateHeadSha,
        }).effectiveHeadSha;
        const fixed = observeReviewDiff(root, previousHeadSha, input.round.candidateHeadSha).changedPaths;
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
/**
 * **evidence-only suffix**: `fromSha`が`toSha`のancestorで、`fromSha..toSha`の
 * 差分がevidence-only allowlist配下の1 pathだけならそのpathを返す（Issue #1272）。
 *
 * review artifactをcommitするとHEADが`H_impl`から`H_final`へ動く。reviewerが
 * 確認した内容とPR・mergeされる内容の一致という性質は、artifact 1 fileの追加では
 * 破れない。従来はこの移動にも「取り直しround」を要求し、製品差分の無いroundで
 * 収束後の別枠を毎Issue消費していた。**受理するのはこの形だけで、空差分・
 * 2 path以上・allowlist外・非ancestorはundefinedにし、呼び出し側が従来と同じ
 * 文言で拒否する。**
 */
export function evidenceOnlySuffix(root, fromSha, toSha) {
    if (fromSha === toSha)
        return undefined;
    /**
     * **1 commitだけを受理する**（round 1 R1-H-02）。`toSha`の第1親が`fromSha`で
     * なければ、途中commitのauthorをmerge認可が実装者と誤認しうるため拒否する。
     * ancestor関係はこの条件に含まれる。
     */
    const parent = git(["rev-parse", "--verify", `${toSha}^1^{commit}`], root, {
        env: GIT_ENV,
        allowFailure: true,
    });
    if (parent.status !== 0 || parent.stdout.trim() !== fromSha)
        return undefined;
    const parents = git(["rev-list", "--parents", "-n", "1", toSha], root, {
        env: GIT_ENV,
        allowFailure: true,
    });
    if (parents.status !== 0 || parents.stdout.trim().split(/\s+/u).length !== 2)
        return undefined;
    /**
     * **rename検出を切り、change typeとmodeまで見る**（round 1 R1-H-01）。
     * `--name-only`はrename先だけを1 pathとして出すため、製品fileをartifact pathへ
     * `git mv`した差分が「artifact 1件の追加」に見える。`--raw`で追加(A)または
     * 変更(M)の通常file（mode 100644）1件だけを受理し、削除・rename・copy・
     * type変更・symlink・gitlink・実行権限付与を拒否する。
     */
    const raw = git(["diff", "--raw", "--no-renames", "--no-abbrev", "-z", fromSha, toSha], root, { env: GIT_ENV, allowFailure: true });
    if (raw.status !== 0)
        return undefined;
    const fields = raw.stdout.split("\0").filter((item) => item.length > 0);
    if (fields.length !== 2)
        return undefined;
    const [meta, only] = fields;
    const matched = /^:(?<srcMode>[0-7]{6}) (?<dstMode>[0-7]{6}) [0-9a-f]+ [0-9a-f]+ (?<status>[AM])$/u.exec(meta ?? "");
    if (!matched?.groups)
        return undefined;
    /**
     * 追加は000000→100644、変更は100644→100644だけを受理する。
     * 削除・type変更・symlink・gitlink・実行権限の付与と除去を落とす。
     * `--no-renames`によりrename・copyは2 pathとして上の件数検査で落ちる。
     */
    const { srcMode, dstMode, status } = matched.groups;
    if (dstMode !== "100644" ||
        (status === "A" && srcMode !== "000000") ||
        (status === "M" && srcMode !== "100644"))
        return undefined;
    return isEvidenceOnlyPath(only) ? only : undefined;
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
    if (effectiveHeadSha !== input.currentHeadSha &&
        evidenceOnlySuffix(path.resolve(staging, "../../../.."), effectiveHeadSha, input.currentHeadSha) === undefined)
        throw new Error("review sessionのcandidate HEADがcurrent HEADと一致しません");
    return session;
}
//# sourceMappingURL=review-session.js.map