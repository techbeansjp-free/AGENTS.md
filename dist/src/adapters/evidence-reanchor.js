import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { deriveEffectiveHead, isContentEquivalent, isRebaseEquivalent, isEvidenceReanchorRecord, } from "../domain/evidence-reanchor.js";
import { comparableReviewEvidence, tryParseReviewEvidence, validateReviewEvidenceAgainstSession, } from "../domain/review-evidence.js";
import { isEvidenceOnlyPath } from "../domain/review.js";
import { unconvergedReviewSessionDiagnostic } from "../domain/review-convergence.js";
import { calculateStagingDigest, listStagingArtifacts, readStoredStagingRecord, refreshStoredStagingDigest, withStagingMutationLock, } from "../domain/staging.js";
import { observeStoredDeliveryState, readStoredDeliveryState, } from "./delivery-state.js";
import { GIT_ENV, evidenceOnlySuffix, observeReviewDiff, observeSingleCommitParent, readBlobAtCommit, } from "./review-diff.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { observedEvidenceErrors } from "./review-evidence.js";
import { readStoredReviewSession } from "./review-session-store.js";
import { assertWorkflowStaging, readWorkflowJournal, } from "./workflow-journal.js";
export const EVIDENCE_REANCHOR_FILE = "journal/reanchor.jsonl";
const OID = /^[a-f0-9]{40}$/u;
function renderEvidenceReanchorChain(chain) {
    return `${chain.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}
/**
 * reanchor公開後・staging record更新前の停止だけを前向き復旧する。
 *
 * 保存済みartifact集合と、terminal追記前のchainを使った投影digestが保存済み
 * digestに完全一致する場合だけrefreshする。したがって、同じ入力の再実行を
 * 口実に無関係なstaging変更を正当化しない。
 */
function recoverPublishedReanchorDigest(staging, chain) {
    const stored = readStoredStagingRecord(staging);
    const currentArtifacts = listStagingArtifacts(staging);
    const currentDigest = calculateStagingDigest(staging, currentArtifacts);
    if (stableJson(stored.artifacts) === stableJson(currentArtifacts) &&
        stored.digest === currentDigest)
        return;
    const previous = chain.slice(0, -1);
    const expectedBeforeArtifacts = previous.length === 0
        ? currentArtifacts.filter((artifact) => artifact !== EVIDENCE_REANCHOR_FILE)
        : currentArtifacts;
    if (stableJson(stored.artifacts) !== stableJson(expectedBeforeArtifacts))
        throw new Error("再固定再開時のartifact集合が公開前・公開後のどちらとも一致しません");
    const previousDigest = crypto
        .createHash("sha256")
        .update(renderEvidenceReanchorChain(previous))
        .digest("hex");
    const projectedBefore = crypto
        .createHash("sha256")
        .update(stableJson(expectedBeforeArtifacts.map((relative) => ({
        relative,
        digest: relative === EVIDENCE_REANCHOR_FILE
            ? previousDigest
            : crypto
                .createHash("sha256")
                .update(fs.readFileSync(path.join(staging, ...relative.split("/"))))
                .digest("hex"),
    }))))
        .digest("hex");
    if (stored.digest !== projectedBefore)
        throw new Error("再固定以外のstaging成果物が変更されているためdigestを復旧できません");
    refreshStoredStagingDigest(staging);
    const refreshed = readStoredStagingRecord(staging);
    if (stableJson(refreshed.artifacts) !== stableJson(currentArtifacts) ||
        refreshed.digest !== currentDigest)
        throw new Error("再固定公開後のstaging digest復旧確認に失敗しました");
}
/**
 * 追記済みの再固定chainを読む。
 *
 * **fileが無い場合は空のchainとして扱う。** 再固定記録を持たない既存stateの判定を
 * 変更前と完全に同一にするためである。
 */
export function readEvidenceReanchorChain(stagingInput) {
    const staging = assertWorkflowStaging(stagingInput);
    const file = path.join(staging, EVIDENCE_REANCHOR_FILE);
    if (!fs.existsSync(file))
        return [];
    const records = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (line.trim() === "")
            continue;
        const value = parseJsonStrict(line, "再固定記録");
        if (!isEvidenceReanchorRecord(value))
            throw new Error("再固定記録の形式が不正です");
        records.push(value);
    }
    return records;
}
/**
 * 層ごとの固定済みanchorを耐久stateから導出する。
 *
 * **旧headと旧baseを利用者から受け取らない。** 任意の旧baseを選べると
 * 「旧diffと新diffが一致する」対を作れてしまい、未reviewのbase内容を含むheadへ
 * 証跡を移送できる。束縛先は既存stateにある。
 */
/**
 * 宣言された`H_impl`を構造で検証する。
 *
 * **caller申告を信用しない。** `H_impl..head`が当該artifact 1件だけであることを
 * Git objectから確かめる。宣言が偽なら不一致になり受理されない（Issue #1172）。
 */
function verifiedImplementationBoundary(root, head, artifactPath, declared, comparison, role) {
    /**
     * **Git観測の失敗を例外のまま外へ出さない。**
     *
     * `parseReviewEvidence`はSHAの書式だけを見るため、**存在しないSHAも
     * 通す。** その値で`observeReviewDiff`を呼ぶと`git rev-parse`が失敗して例外になり、
     * 拒否理由へ変換されないまま呼び出し元へ伝播する（Issue #1172、外部review）。
     * **同定できない入力は理由つきで拒否する。**
     */
    let observed;
    try {
        observed = observeReanchorDiff(root, role, comparison, declared, head, declared);
    }
    catch (error) {
        return {
            valid: false,
            gitFailure: error instanceof Error ? error.message : String(error),
        };
    }
    return {
        valid: observed.changedPaths.length === 1 &&
            observed.changedPaths[0] === artifactPath,
    };
}
/**
 * 差分path集合からreview artifact候補を1件だけ同定する。
 *
 * **同定規則の正本はevidence-only allowlistである。** 判定は`pr create`・review session・
 * record layerと同じ`isEvidenceOnlyPath`へ委ねる。`pr create`は
 * `assertConvergedReviewSession`から`evidenceOnlySuffix`を経てこの述語へ到達する。
 * **2 prefixを直書きで持つ箇所が`pr merge`側に残る**（`resolveImplementationCommitForMerge`と
 * delivery stateのMergeIntent解析）。そこは`pr merge`の認可判定であり本変更のscope外で、
 * 合流は別Issueとする。以前はこのadapterが
 * `docs/reviews/`だけの単純前方一致を持っていたが、それはASC自repoの`audit:check`
 * が使う運用上の狭い集合であって製品の契約ではない。**製品allowlistは利用側の
 * 配置自由度であり、正本は`docs/reviews/`と`.agent-skill-chain/reviews/`の2つを
 * 許す。** 同定規則を製品内の2箇所で別々に持つと、片方だけが正本から外れる
 * （Issue #1433）。
 *
 * **file名の字面を受理条件にしない。** 正本は配置だけを定め、`02_品質基準.md`は
 * 汎用packageが特定のfile名を強制しないことを要求する。
 */
function terminalArtifactPath(paths) {
    const artifacts = paths.filter(isEvidenceOnlyPath);
    /** **artifactが1件でない差分は同定できない。** 受理しない。 */
    return artifacts.length === 1 ? artifacts[0] : undefined;
}
/**
 * 再固定で行うGit比較へ、その比較の役割と固定中の4 SHAを付ける。
 *
 * `observeReviewDiff`は汎用adapterなので変更せず、再固定固有の診断だけをここで
 * 合成する。artifact本文やstate全体は診断へ出さない。
 */
function observeReanchorDiff(root, role, comparison, baseSha, headSha, implementationSha) {
    try {
        return observeReviewDiff(root, baseSha, headSha);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`再固定のGit比較に失敗しました（役割=${role}, oldBaseSha=${comparison.oldBaseSha}, oldHeadSha=${comparison.oldHeadSha}, newBaseSha=${comparison.newBaseSha}, newHeadSha=${comparison.newHeadSha}${implementationSha === undefined ? "" : `, H_impl=${implementationSha}`}）: ${detail}`, { cause: error });
    }
}
/**
 * rebase後の再固定に限って成立する二層の等価性を観測する。
 *
 * 判定材料はすべてGit objectから再計算する。記録も申告も根拠にしない。
 */
function observeRebaseEquivalence(root, input) {
    const beforeAll = observeReanchorDiff(root, "旧base→旧head", input, input.oldBaseSha, input.oldHeadSha);
    const afterAll = observeReanchorDiff(root, "新base→新head", input, input.newBaseSha, input.newHeadSha);
    const beforePath = terminalArtifactPath(beforeAll.changedPaths);
    const afterPath = terminalArtifactPath(afterAll.changedPaths);
    if (beforePath === undefined || afterPath === undefined)
        return { reason: "artifact-not-unique" };
    const beforeArtifact = readBlobAtCommit(root, input.oldHeadSha, beforePath);
    const afterArtifact = readBlobAtCommit(root, input.newHeadSha, afterPath);
    if (beforeArtifact === undefined || afterArtifact === undefined)
        return { reason: "artifact-unreadable" };
    const beforeParsed = tryParseReviewEvidence(beforeArtifact);
    const afterParsed = tryParseReviewEvidence(afterArtifact);
    if (!("evidence" in beforeParsed) || !("evidence" in afterParsed))
        return { reason: "identity-unresolvable" };
    const beforeAnchor = {
        base: beforeParsed.evidence.observed.baseSha,
        implementation: beforeParsed.evidence.observed.implementationHeadSha,
    };
    const afterAnchor = {
        base: afterParsed.evidence.observed.baseSha,
        implementation: afterParsed.evidence.observed.implementationHeadSha,
    };
    /** **宣言した比較基点が再固定の基点と一致することを要求する。** */
    if (beforeAnchor.base !== input.oldBaseSha ||
        afterAnchor.base !== input.newBaseSha)
        return { reason: "base-mismatch" };
    const beforeBoundary = verifiedImplementationBoundary(root, input.oldHeadSha, beforePath, beforeAnchor.implementation, input, "旧H_impl→旧head");
    if (!beforeBoundary.valid)
        return {
            reason: "boundary-mismatch",
            gitFailure: beforeBoundary.gitFailure,
        };
    const afterBoundary = verifiedImplementationBoundary(root, input.newHeadSha, afterPath, afterAnchor.implementation, input, "新H_impl→新head");
    if (!afterBoundary.valid)
        return {
            reason: "boundary-mismatch",
            gitFailure: afterBoundary.gitFailure,
        };
    /**
     * **新`H_final`がevidence-only suffixの形をmodeまで満たすことを要求する。**
     *
     * `verifiedImplementationBoundary`は変更pathの件数と名前しか見ない。mode
     * `100755`の証跡は通常fileなので`git show`で本文が読め、証跡の厳密解析を
     * すべて通過する。round 2は
     * `artifact-replacement`と`reviewed-forward`の2経路にこの検査を足したが、
     * **通常rebase経路（本関数）は対象外のまま残っていた。** `isContentEquivalent`が
     * mode変更を含む「new file mode」行の差でfalseになり必ずこの関数へ入るため、
     * ここを通さない限り3経路のうち最も一般的な経路がmode検証を欠く
     * （Issue #1433、外部review round 4・Codex）。
     *
     * 旧`H_final`側へは適用しない。過去に受理した記録を遡って拒否へ変えない。
     */
    if (evidenceOnlySuffix(root, afterAnchor.implementation, input.newHeadSha) !==
        afterPath)
        return { reason: "mode-mismatch" };
    return {
        reason: isRebaseEquivalent({
            beforeImplementation: observeReanchorDiff(root, "旧base→旧H_impl", input, input.oldBaseSha, beforeAnchor.implementation, beforeAnchor.implementation),
            afterImplementation: observeReanchorDiff(root, "新base→新H_impl", input, input.newBaseSha, afterAnchor.implementation, afterAnchor.implementation),
            beforeArtifact,
            afterArtifact,
            beforeArtifactPath: beforePath,
            afterArtifactPath: afterPath,
        }),
    };
}
function digestOf(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
}
/**
 * 新しいreview証跡を保存済みsessionと最新Step 10 bindingへ照合する。
 *
 * **証跡の値をauthorityにしない。** findingの最終状態・未解決Critical/High・
 * count済みround数はsessionから再導出した値との一致だけを受理し、`H_impl`は
 * sessionの収束candidate HEADそのものを要求する。diff・影響集合・検証欄は
 * `observedEvidenceErrors`でGit・stagingの観測記録・trusted policyから再導出した
 * 値との一致を要求する（読めなければ受理しない）。
 */
function acceptedSessionEvidence(staging, evidence, options) {
    let recorded;
    try {
        recorded =
            observedEvidenceErrors(stagingRepositoryRoot(staging), staging, evidence)
                .length === 0;
    }
    catch {
        recorded = false;
    }
    if (!recorded)
        return false;
    const session = readStoredReviewSession(staging);
    const journal = readWorkflowJournal(staging);
    const step10 = [...journal.entries]
        .reverse()
        .find((entry) => entry.step === 10 && (!options.postPrIntake || entry.postPrIntake))?.reviewSession;
    return (session !== null &&
        session.status === "converged" &&
        session.latestCandidateHeadSha ===
            evidence.observed.implementationHeadSha &&
        validateReviewEvidenceAgainstSession(evidence, session).length === 0 &&
        step10 !== undefined &&
        step10.sessionId === session.sessionId &&
        step10.roundDigest === session.latestRoundDigest &&
        step10.headSha === session.latestCandidateHeadSha &&
        journal.errors.length === 0);
}
/**
 * push済み証跡の同一path前進修正を、review判断が同じ場合だけ受理する。
 *
 * **変わってよいのは検証記録（`verification`）だけである。** 比較基点・`H_impl`・
 * session・finding・独立性・判定は完全一致を要求する。
 */
function observeArtifactSupersession(staging, root, input) {
    if (input.oldBaseSha !== input.newBaseSha)
        return undefined;
    if (observeSingleCommitParent(root, input.newHeadSha) !== input.oldHeadSha)
        return undefined;
    const changed = observeReanchorDiff(root, "新H_final親→新H_final", input, input.oldHeadSha, input.newHeadSha);
    const artifactPath = terminalArtifactPath(changed.changedPaths);
    if (artifactPath === undefined ||
        changed.changedPaths.length !== 1 ||
        !isEvidenceOnlyPath(artifactPath))
        return undefined;
    const raw = git([
        "diff",
        "--raw",
        "--no-renames",
        "--no-abbrev",
        "-z",
        input.oldHeadSha,
        input.newHeadSha,
    ], root, { env: GIT_ENV, allowFailure: true });
    if (raw.status !== 0 ||
        !/^:100644 100644 [0-9a-f]+ [0-9a-f]+ M\0/u.test(raw.stdout))
        return undefined;
    const oldArtifact = readBlobAtCommit(root, input.oldHeadSha, artifactPath);
    const newArtifact = readBlobAtCommit(root, input.newHeadSha, artifactPath);
    if (oldArtifact === undefined ||
        newArtifact === undefined ||
        oldArtifact === newArtifact)
        return undefined;
    const oldParsed = tryParseReviewEvidence(oldArtifact);
    const newParsed = tryParseReviewEvidence(newArtifact);
    if (!("evidence" in oldParsed) || !("evidence" in newParsed))
        return undefined;
    const oldEvidence = oldParsed.evidence;
    const newEvidence = newParsed.evidence;
    if (oldEvidence.observed.baseSha !== input.oldBaseSha ||
        newEvidence.observed.baseSha !== input.newBaseSha ||
        oldEvidence.observed.implementationHeadSha !==
            newEvidence.observed.implementationHeadSha ||
        comparableReviewEvidence(oldEvidence, "supersession") !==
            comparableReviewEvidence(newEvidence, "supersession"))
        return undefined;
    if (evidenceOnlySuffix(root, newEvidence.observed.implementationHeadSha, input.newHeadSha) !== artifactPath)
        return undefined;
    if (!verifiedImplementationBoundary(root, input.newHeadSha, artifactPath, newEvidence.observed.implementationHeadSha, input, "新H_impl→新head").valid)
        return undefined;
    if (!acceptedSessionEvidence(staging, newEvidence, { postPrIntake: false }))
        return undefined;
    return {
        artifactPath,
        oldDigest: digestOf(oldArtifact),
        newDigest: digestOf(newArtifact),
    };
}
/**
 * 通常のrebase等価性から外れる証跡の改名を、同じreview済み実装境界へ閉じる。
 *
 * **path是正だけを受理するため、証跡の内容はbyte一致を要求する。** 新pathの
 * 自己申告だけでは受理せず、Git構造・保存済みsession・Step 10 bindingを再計測する。
 */
function observeArtifactReplacement(staging, root, input) {
    const beforeAll = observeReanchorDiff(root, "旧base→旧head", input, input.oldBaseSha, input.oldHeadSha);
    const afterAll = observeReanchorDiff(root, "新base→新head", input, input.newBaseSha, input.newHeadSha);
    const oldPath = terminalArtifactPath(beforeAll.changedPaths);
    const newPath = terminalArtifactPath(afterAll.changedPaths);
    /**
     * **新証跡がevidence-only allowlist配下であることは`terminalArtifactPath`が
     * 既に保証している。** basenameの字面を重ねて要求しない（Issue #1433）。
     */
    if (oldPath === undefined || newPath === undefined || oldPath === newPath)
        return undefined;
    const oldArtifact = readBlobAtCommit(root, input.oldHeadSha, oldPath);
    const newArtifact = readBlobAtCommit(root, input.newHeadSha, newPath);
    if (oldArtifact === undefined ||
        newArtifact === undefined ||
        oldArtifact !== newArtifact)
        return undefined;
    const parsed = tryParseReviewEvidence(newArtifact);
    if (!("evidence" in parsed))
        return undefined;
    const evidence = parsed.evidence;
    if (evidence.observed.baseSha !== input.oldBaseSha ||
        evidence.observed.baseSha !== input.newBaseSha)
        return undefined;
    if (!verifiedImplementationBoundary(root, input.oldHeadSha, oldPath, evidence.observed.implementationHeadSha, input, "旧H_impl→旧head").valid ||
        !verifiedImplementationBoundary(root, input.newHeadSha, newPath, evidence.observed.implementationHeadSha, input, "新H_impl→新head").valid)
        return undefined;
    /**
     * **新`H_final`がevidence-only suffixの形をmodeまで満たすことを要求する。**
     *
     * `terminalArtifactPath`が見るのはpathだけである。TERM-ASC-101はmode `100644`の
     * 通常file 1件の追加または変更だけをevidence-only suffixとする。再固定で実効HEADへ
     * 入った新headは以後どこでも再検査されないため、**再固定がこの形を確かめる唯一の
     * 地点である**（Issue #1433、外部review round 2）。
     */
    if (evidenceOnlySuffix(root, evidence.observed.implementationHeadSha, input.newHeadSha) !== newPath)
        return undefined;
    if (!acceptedSessionEvidence(staging, evidence, { postPrIntake: false }))
        return undefined;
    const digest = digestOf(newArtifact);
    return { oldPath, newPath, oldDigest: digest, newDigest: digest };
}
/**
 * `pr-bound`後に外部reviewer指摘を取り込んだ前進commitを、新しいreview roundへ
 * 束縛する。旧delivery headをancestorに持つこと、exact session、明示intake、
 * review証跡とsessionの一致をすべて再観測し、force rewriteや未review差分を拒否する。
 *
 * **base変更（既定branch追随）も同じ経路で扱う（Issue #1493）。** 以降の全チェックは
 * `input.newBaseSha`だけを参照するため、必要な追加条件は「oldBaseShaがnewBaseShaの
 * 正当な前進（ancestor）であること」の1点であり、`merge-base --is-ancestor`だけを
 * local Gitへ問い合わせて確認する。**フルdiffは計算しない。** newBaseShaが実際の
 * GitHub既定branch tipであることは`pr merge`が確認する（`inspectAuthorizedPullRequestMerge`）。
 */
function observeReviewedForward(staging, root, input) {
    if (input.oldBaseSha !== input.newBaseSha) {
        const ancestor = git(["merge-base", "--is-ancestor", input.oldBaseSha, input.newBaseSha], root, { env: GIT_ENV, allowFailure: true });
        if (ancestor.status !== 0)
            return undefined;
    }
    const finalParent = observeSingleCommitParent(root, input.newHeadSha);
    const finalSuffix = observeReanchorDiff(root, "新H_final親→新H_final", input, finalParent, input.newHeadSha);
    const artifactPath = terminalArtifactPath(finalSuffix.changedPaths);
    if (artifactPath === undefined)
        return undefined;
    const artifact = readBlobAtCommit(root, input.newHeadSha, artifactPath);
    if (artifact === undefined)
        return undefined;
    const parsed = tryParseReviewEvidence(artifact);
    if (!("evidence" in parsed))
        return undefined;
    const evidence = parsed.evidence;
    if (evidence.observed.baseSha !== input.newBaseSha)
        return undefined;
    if (finalParent !== evidence.observed.implementationHeadSha)
        return undefined;
    if (input.oldHeadSha === evidence.observed.implementationHeadSha)
        return undefined;
    try {
        /** `observeReviewDiff`の固定Git環境でstrict ancestorを再観測する。 */
        observeReviewDiff(root, input.oldHeadSha, evidence.observed.implementationHeadSha);
    }
    catch {
        return undefined;
    }
    if (!verifiedImplementationBoundary(root, input.newHeadSha, artifactPath, evidence.observed.implementationHeadSha, input, "新H_impl→新head").valid)
        return undefined;
    /** artifact-replacementと同じ理由でmodeまで確かめる（Issue #1433）。 */
    if (evidenceOnlySuffix(root, evidence.observed.implementationHeadSha, input.newHeadSha) !== artifactPath)
        return undefined;
    if (!acceptedSessionEvidence(staging, evidence, { postPrIntake: true }))
        return undefined;
    return {
        sessionId: evidence.observed.session.sessionId,
        roundDigest: evidence.observed.session.latestRoundDigest,
        implementationSha: evidence.observed.implementationHeadSha,
        artifactPath,
        artifactDigest: digestOf(artifact),
    };
}
function resolveAnchor(staging, layer) {
    const deliveryState = observeStoredDeliveryState(staging);
    if (layer === "delivery") {
        const state = deliveryState;
        if (!state?.create)
            throw new Error("pr reanchorには pr create で固定したdelivery stateが必要です");
        if (state.state !== "step11-recorded" && state.state !== "pr-bound")
            throw new Error(`delivery stateが${state.state}です。pr-boundまたはstep11-recordedだけがpr reanchorを受理します`);
        return {
            anchoredHeadSha: state.create.headSha,
            anchoredBaseSha: state.create.baseSha,
            prBound: state.state === "pr-bound",
        };
    }
    if (deliveryState?.create)
        throw new Error("review reanchorはdelivery state固定後には使えません。pr reanchorを使ってください");
    const session = readStoredReviewSession(staging);
    if (session === null)
        throw new Error("review reanchorには永続review sessionが必要です");
    if (session.status !== "converged")
        throw new Error(unconvergedReviewSessionDiagnostic(session.status));
    return {
        anchoredHeadSha: session.latestCandidateHeadSha,
        anchoredBaseSha: session.anchor.diffBaseSha,
        prBound: false,
    };
}
function validateEvidenceReanchorInput(input) {
    for (const [label, oid] of [
        ["--new-head", input.newHeadSha],
        ["--new-base", input.newBaseSha],
    ])
        if (!OID.test(oid))
            throw new Error(`${label}は小文字40桁のGit SHAで指定してください`);
    if (input.reason.trim() === "")
        throw new Error("再固定の理由を指定してください");
}
/** 再固定の既存受理条件を、永続書込みなしで評価する。 */
export function evaluateEvidenceReanchor(input) {
    const staging = assertWorkflowStaging(input.staging);
    validateEvidenceReanchorInput(input);
    const anchor = resolveAnchor(staging, input.layer);
    const existing = readEvidenceReanchorChain(staging);
    const derived = deriveEffectiveHead({
        records: existing,
        anchoredHeadSha: anchor.anchoredHeadSha,
    });
    if (derived.invalidIndex !== undefined)
        throw new Error(`既存の再固定chainが${derived.invalidIndex}件目で連鎖していません`);
    const oldHeadSha = derived.effectiveHeadSha;
    const oldBaseSha = existing.at(-1)?.newBaseSha ?? anchor.anchoredBaseSha;
    const terminal = existing.at(-1);
    if (terminal?.newHeadSha === input.newHeadSha &&
        terminal.newBaseSha === input.newBaseSha)
        return {
            chain: existing,
            effectiveHeadSha: derived.effectiveHeadSha,
            appended: false,
            oldHeadSha,
            oldBaseSha,
            diffDigest: undefined,
            method: undefined,
            artifactReplacement: undefined,
            artifactSupersession: undefined,
            reviewedForward: undefined,
        };
    if (oldHeadSha === input.newHeadSha)
        throw new Error("再固定は移動していないheadに対して行えません");
    const comparison = {
        oldBaseSha,
        oldHeadSha,
        newBaseSha: input.newBaseSha,
        newHeadSha: input.newHeadSha,
    };
    const before = observeReanchorDiff(input.root, "旧base→旧head", comparison, oldBaseSha, oldHeadSha);
    const after = observeReanchorDiff(input.root, "新base→新head", comparison, input.newBaseSha, input.newHeadSha);
    let method = "rebase";
    let artifactReplacement;
    let artifactSupersession;
    let reviewedForward;
    if (!isContentEquivalent(before, after)) {
        const rebase = observeRebaseEquivalence(input.root, comparison);
        /**
         * **pr-boundではrebase等価でもrebaseとしては受理しない**（末尾の拒否）。検証記録の
         * 再実行だけを差し替えた証跡是正は、検証commandとscopeの集合が変わらないため
         * rebase等価に分類される。trusted policyが宣言するfull commandは1つだけなので
         * （REQ-WF-040）、pr-bound後の検証欄の是正はこの形になる。各方法は自身の検査を
         * 全部行うため、pr-boundで他の方法を試しても受理集合は各方法の範囲を超えない。
         */
        if (rebase.reason !== "ok" || anchor.prBound) {
            artifactReplacement = observeArtifactReplacement(staging, input.root, comparison);
            if (artifactReplacement !== undefined)
                method = "artifact-replacement";
            else if (anchor.prBound) {
                artifactSupersession = observeArtifactSupersession(staging, input.root, comparison);
                if (artifactSupersession !== undefined)
                    method = "artifact-supersession";
                else {
                    reviewedForward = observeReviewedForward(staging, input.root, comparison);
                    if (reviewedForward !== undefined)
                        method = "reviewed-forward";
                }
            }
            if (rebase.reason !== "ok" &&
                artifactReplacement === undefined &&
                artifactSupersession === undefined &&
                reviewedForward === undefined)
                throw new Error(`再固定前後の内容が等価ではありません（${rebase.reason}）: before=${before.digest} after=${after.digest}${rebase.gitFailure === undefined ? "" : `; ${rebase.gitFailure}`}`);
        }
    }
    if (anchor.prBound &&
        method !== "artifact-replacement" &&
        method !== "artifact-supersession" &&
        method !== "reviewed-forward")
        throw new Error("pr reanchorのpr-bound再固定は監査合格済みartifact改名、または明示したpost-PR intakeとexact review bindingを持つ前進commitだけを受理します");
    return {
        chain: existing,
        effectiveHeadSha: input.newHeadSha,
        appended: true,
        oldHeadSha,
        oldBaseSha,
        diffDigest: before.digest,
        method,
        artifactReplacement,
        artifactSupersession,
        reviewedForward,
    };
}
/**
 * 内容等価性を実証したうえで再固定記録を1件追記する。
 *
 * 既存の`journal/steps.jsonl`と`journal/delivery-state.json`へは書き込まない。
 * 追記後に`refreshStoredStagingDigest`を呼び、read-backで一致を確認する。
 */
export function appendEvidenceReanchor(input) {
    const staging = assertWorkflowStaging(input.staging);
    /** input拒否で既存transaction復旧やlock作成へ進まない旧順序を保つ。 */
    validateEvidenceReanchorInput(input);
    return withStagingMutationLock(staging, () => {
        /** applyだけが既存delivery transactionをlock内で復旧してから最新stateを評価する。 */
        readStoredDeliveryState(staging);
        const evaluation = evaluateEvidenceReanchor(input);
        if (!evaluation.appended) {
            recoverPublishedReanchorDigest(staging, evaluation.chain);
            return {
                chain: evaluation.chain,
                effectiveHeadSha: evaluation.effectiveHeadSha,
                appended: false,
            };
        }
        const record = {
            oldHeadSha: evaluation.oldHeadSha,
            newHeadSha: input.newHeadSha,
            oldBaseSha: evaluation.oldBaseSha,
            newBaseSha: input.newBaseSha,
            diffDigest: evaluation.diffDigest,
            method: evaluation.method,
            reason: input.reason,
            recordedAt: input.recordedAt,
            ...(evaluation.artifactReplacement === undefined
                ? {}
                : { artifactReplacement: evaluation.artifactReplacement }),
            ...(evaluation.artifactSupersession === undefined
                ? {}
                : { artifactSupersession: evaluation.artifactSupersession }),
            ...(evaluation.reviewedForward === undefined
                ? {}
                : { reviewedForward: evaluation.reviewedForward }),
        };
        const file = path.join(staging, EVIDENCE_REANCHOR_FILE);
        const next = [...evaluation.chain, record];
        writeFileAtomic(file, renderEvidenceReanchorChain(next), {
            temporaryDirectory: path.dirname(staging),
        });
        refreshStoredStagingDigest(staging);
        const reread = readEvidenceReanchorChain(staging);
        if (JSON.stringify(reread) !== JSON.stringify(next))
            throw new Error("再固定chainの書き込み後read-backが一致しません");
        return {
            chain: reread,
            effectiveHeadSha: record.newHeadSha,
            appended: true,
        };
    });
}
//# sourceMappingURL=evidence-reanchor.js.map