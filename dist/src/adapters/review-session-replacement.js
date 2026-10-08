import fs from "node:fs";
import path from "node:path";
import { countedRounds, parseReviewSessionState, } from "../domain/review-convergence.js";
import { deriveEffectiveHead } from "../domain/evidence-reanchor.js";
import { calculateStagingDigest, listStagingArtifacts, readStoredStagingRecord, refreshStoredStagingDigest, withStagingMutationLock, } from "../domain/staging.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { observeStoredDeliveryState } from "./delivery-state.js";
import { readEvidenceReanchorChain } from "./evidence-reanchor.js";
import { preserveReviewProgressJournal, reviewProgressJournalPresent, } from "./review-progress.js";
import { evidenceOnlySuffix } from "./review-diff.js";
import { REVIEW_SESSION_FILE, readStoredReviewSession, } from "./review-session-store.js";
import { REVIEW_SESSION_REPLACEMENTS_FILE, readReplacementLines, readReviewSessionReplacements, replacedProgressPath, replacedSessionPath, sha256, } from "./review-session-replacement-store.js";
import { assertWorkflowStaging, readWorkflowJournal, } from "./workflow-journal.js";
/**
 * review session置換の前提（BR-01、02 §3.1）。1つでも欠ければ名指しして拒否する。
 *
 * **current H_implは呼出し側から受け取らない。** sessionのlatest candidateが固定済みPRの
 * 実効headそのもの、またはその証跡だけのsuffixの起点である場合に限り、そのcandidateを
 * current H_implとする。未reviewのcommitを含むsessionや未収束sessionは置換できない。
 */
export function replacementPreconditionErrors(input) {
    const errors = [];
    if (input.session === null)
        errors.push("review sessionが存在しません");
    else if (input.session.status !== "converged")
        errors.push("review sessionがconvergedではありません");
    else if (!input.candidateIsCurrentImplementation)
        errors.push("latest roundのcandidate HEADがcurrent H_impl（PR実効head、またはその証跡だけのsuffixの起点）と一致しません");
    if (input.delivery?.state !== "pr-bound")
        errors.push("delivery stateがpr-boundではありません");
    if (input.delivery?.merge)
        errors.push("merge intentがあります");
    if (input.delivery?.step11 || input.journalHasStep11)
        errors.push("Step 11が記録されています");
    return errors;
}
function stagingDigestMatches(staging) {
    const stored = readStoredStagingRecord(staging);
    const artifacts = listStagingArtifacts(staging);
    return (stableJson(stored.artifacts) === stableJson(artifacts) &&
        stored.digest === calculateStagingDigest(staging, artifacts));
}
/** 置換前提（BR-01）を現在のdelivery stateと固定済みPRの実効headに対して判定する。 */
function observedPreconditions(staging, session, journalHasStep11) {
    const delivery = observeStoredDeliveryState(staging);
    const pullRequestHeadSha = delivery
        ? deriveEffectiveHead({
            records: readEvidenceReanchorChain(staging),
            anchoredHeadSha: delivery.create.headSha,
        }).effectiveHeadSha
        : undefined;
    const candidate = session?.latestCandidateHeadSha;
    const candidateIsCurrentImplementation = candidate !== undefined &&
        pullRequestHeadSha !== undefined &&
        (candidate === pullRequestHeadSha ||
            evidenceOnlySuffix(stagingRepositoryRoot(staging), candidate, pullRequestHeadSha) !== undefined);
    return {
        errors: replacementPreconditionErrors({
            session,
            delivery,
            journalHasStep11,
            candidateIsCurrentImplementation,
        }),
        pullRequestHeadSha,
    };
}
function plan(staging, replacedAt) {
    const errors = [];
    const journal = readWorkflowJournal(staging);
    if (journal.errors.length > 0)
        errors.push(`workflow journalが不正です: ${journal.errors.join("; ")}`);
    if (!stagingDigestMatches(staging))
        errors.push("staging成果物一覧またはcontent digestが保存値と一致しません");
    let records = [];
    try {
        records = readReviewSessionReplacements(staging);
    }
    catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    const session = readStoredReviewSession(staging);
    const observed = observedPreconditions(staging, session, journal.entries.some((entry) => entry.step === 11));
    errors.push(...observed.errors);
    const { pullRequestHeadSha } = observed;
    if (errors.length > 0 || !session || !pullRequestHeadSha)
        return { errors };
    const sequence = records.length + 1;
    const file = path.join(staging, REVIEW_SESSION_FILE);
    const previousLine = readReplacementLines(staging).at(-1);
    const record = {
        schemaVersion: "agent-skill-chain/review-session-replacement/v1",
        sequence,
        previousRecordDigest: previousLine === undefined ? null : sha256(previousLine),
        previousSession: {
            sessionId: session.sessionId,
            digest: sha256(fs.readFileSync(file)),
            status: "converged",
            rounds: session.rounds.length,
            countedRounds: countedRounds(session),
            initialHeadSha: session.anchor.initialHeadSha,
            latestCandidateHeadSha: session.latestCandidateHeadSha,
        },
        implementationHeadSha: session.latestCandidateHeadSha,
        pullRequestHeadSha,
        savedPath: replacedSessionPath(sequence),
        savedProgressPath: reviewProgressJournalPresent(staging)
            ? replacedProgressPath(sequence)
            : null,
        replacedAt,
    };
    for (const target of [record.savedPath, record.savedProgressPath])
        if (target !== null &&
            fs.existsSync(path.join(staging, ...target.split("/"))))
            return {
                errors: [`置換済みsessionの保存先 ${target} が既に存在します`],
            };
    return { errors: [], plan: { record, line: stableJson(record) } };
}
/**
 * 中断した置換を完了できるか確かめる（02 §6）。最終記録の置換前状態を現在のfileから
 * 再構成し、そのdigestが保存済みstaging digestと一致する場合だけ残りの段を行う。
 */
function interruptedReplacement(staging) {
    const records = readReviewSessionReplacements(staging, { pendingLast: true });
    const last = records.at(-1);
    if (!last)
        return undefined;
    const sessionFile = path.join(staging, REVIEW_SESSION_FILE);
    const savedFile = path.join(staging, last.savedPath);
    const sessionSource = fs.existsSync(sessionFile)
        ? fs.readFileSync(sessionFile)
        : fs.existsSync(savedFile)
            ? fs.readFileSync(savedFile)
            : undefined;
    if (sessionSource === undefined ||
        sha256(sessionSource) !== last.previousSession.digest ||
        (fs.existsSync(sessionFile) && fs.existsSync(savedFile)))
        return undefined;
    const earlier = readReplacementLines(staging).slice(0, -1);
    const excluded = new Set([
        last.savedPath,
        ...(last.savedProgressPath ? [last.savedProgressPath] : []),
        REVIEW_SESSION_FILE,
        REVIEW_SESSION_REPLACEMENTS_FILE,
    ]);
    const virtual = new Map(listStagingArtifacts(staging)
        .filter((relative) => !excluded.has(relative))
        .map((relative) => [
        relative,
        sha256(fs.readFileSync(path.join(staging, ...relative.split("/")))),
    ]));
    virtual.set(REVIEW_SESSION_FILE, sha256(sessionSource));
    if (earlier.length > 0)
        virtual.set(REVIEW_SESSION_REPLACEMENTS_FILE, sha256(`${earlier.join("\n")}\n`));
    const artifacts = [...virtual.keys()].sort((left, right) => left.localeCompare(right));
    const stored = readStoredStagingRecord(staging);
    const digest = sha256(stableJson(artifacts.map((relative) => ({
        relative,
        digest: virtual.get(relative),
    }))));
    return stableJson(stored.artifacts) === stableJson(artifacts) &&
        stored.digest === digest
        ? { record: last, sessionSource }
        : undefined;
}
/**
 * 中断した置換の最終記録を、置換前のsession内容と現在のdelivery stateに対して
 * 再検証する（BR-01）。staging digestの再構成が一致しても、記録は手で追記できるため
 * 通常の置換と同じ前提と、記録の値が旧sessionから導出した値と一致することを求める。
 */
function interruptedRecordErrors(staging, record, sessionSource) {
    let session;
    try {
        session = parseReviewSessionState(parseJsonStrict(sessionSource.toString("utf8"), "review session"));
    }
    catch (error) {
        return [error instanceof Error ? error.message : String(error)];
    }
    const journal = readWorkflowJournal(staging);
    const errors = journal.errors.length > 0
        ? [`workflow journalが不正です: ${journal.errors.join("; ")}`]
        : [];
    const observed = observedPreconditions(staging, session, journal.entries.some((entry) => entry.step === 11));
    errors.push(...observed.errors);
    const expected = {
        sessionId: session.sessionId,
        digest: sha256(sessionSource),
        status: "converged",
        rounds: session.rounds.length,
        countedRounds: countedRounds(session),
        initialHeadSha: session.anchor.initialHeadSha,
        latestCandidateHeadSha: session.latestCandidateHeadSha,
    };
    if (stableJson(record.previousSession) !== stableJson(expected) ||
        record.implementationHeadSha !== session.latestCandidateHeadSha ||
        record.pullRequestHeadSha !== observed.pullRequestHeadSha)
        errors.push("中断した置換記録の値が置換前のreview sessionと一致しません");
    return errors;
}
/**
 * 中断した置換の最終記録の`savedProgressPath`とreview progress journalの配置を、applyの段の
 * 順序から到達できる組合せ（BR-02の許可表）へ照合する（Issue #1571）。pathは定数と連番から
 * 導出し、記録の文字列を使わない。不一致なら組合せと復旧手段を名指しした理由1件を返す。
 */
function interruptedProgressErrors(staging, record) {
    const renamed = !fs.existsSync(path.join(staging, REVIEW_SESSION_FILE));
    const original = reviewProgressJournalPresent(staging);
    const saved = fs.existsSync(path.join(staging, ...replacedProgressPath(record.sequence).split("/")));
    const declared = record.savedProgressPath !== null;
    if (declared
        ? renamed
            ? original !== saved
            : original && !saved
        : !original && !saved)
        return [];
    const recovery = declared && !original && !saved
        ? "置換記録が宣言するreview progress journalが失われています。退避元があれば元名へ戻してから再applyしてください。復元できない場合は置換記録を書き換えず人手で調査してください"
        : original && (!declared || renamed)
            ? "元名のreview progress journalは置換の中断中に作られた旧sessionの進捗です（`review progress append`等）。内容を確認してstaging外へ退避してから再applyしてください"
            : declared && original
                ? "sessionのrenameより前にprogress journalが保存名へ移っていますが、元名にもreview progress journalがあります。元名の内容は置換の中断中に追記された旧sessionの進捗の可能性があるため上書きしないでください。2つのfileの内容を比較してどちらを残すかを判断し、不要な方をstaging外へ退避して、残す方を元名に置いてから再applyしてください"
                : declared
                    ? "sessionのrenameより前にprogress journalが保存名へ移っています。保存名のfileを元名へ戻してから再applyしてください"
                    : "置換記録はprogress journalを宣言していません。保存名のfileを確認してstaging外へ退避してから再applyしてください";
    const state = (present) => (present ? "あり" : "なし");
    return [
        `中断した置換記録${record.sequence}件目（savedProgressPath=${record.savedProgressPath ?? "null"}）とreview progress journalの配置（review session=${renamed ? "rename済み" : "未rename"}、元名=${state(original)}、保存名=${state(saved)}）がapplyの段の順序から到達できません。${recovery}`,
    ];
}
function moveReplacedFiles(staging, record) {
    const source = path.join(staging, REVIEW_SESSION_FILE);
    const target = path.join(staging, record.savedPath);
    if (fs.existsSync(source)) {
        if (fs.existsSync(target))
            throw new Error(`置換済みsessionの保存先 ${record.savedPath} が既に存在します`);
        fs.renameSync(source, target);
    }
    if (record.savedProgressPath)
        preserveReviewProgressJournal(staging, record.savedProgressPath);
}
function nextStep(record) {
    return `git switch --detach ${record.implementationHeadSha}でH_implへdetachし、review round --init --head=${record.implementationHeadSha} --base=<git merge-base ${record.implementationHeadSha} refs/remotes/origin/HEADの値>でround 1（full-scope）を収束させてください。その後branchへ戻り、workflow record --step=10 --post-pr-intake、review export、push、pr reanchorの順に進めます`;
}
/**
 * `review replace`（review session置換、TERM-1569-01、REQ-WF-052）。
 *
 * applyは置換記録1行の追記 → `review-session.json`（とreview progress journal）の
 * 保存名へのrename → staging digest再固定の順に行う。旧sessionはrenameで移すため
 * byte一致で残る。前提違反ではstagingを1byteも変更しない（INV-08）。
 */
export function replaceReviewSession(input) {
    const staging = assertWorkflowStaging(input.staging);
    const replacedAt = input.now ?? new Date().toISOString();
    if (!input.apply) {
        const observed = plan(staging, replacedAt);
        if (!observed.plan)
            throw new ReviewSessionReplacementError(observed.errors);
        return {
            state: "preview",
            record: observed.plan.record,
            recovered: false,
            next: nextStep(observed.plan.record),
        };
    }
    return withStagingMutationLock(staging, () => {
        if (!stagingDigestMatches(staging)) {
            const interrupted = interruptedReplacement(staging);
            if (interrupted) {
                const errors = [
                    ...interruptedRecordErrors(staging, interrupted.record, interrupted.sessionSource),
                    ...interruptedProgressErrors(staging, interrupted.record),
                ];
                if (errors.length > 0)
                    throw new ReviewSessionReplacementError(errors);
                moveReplacedFiles(staging, interrupted.record);
                const stagingDigest = refreshStoredStagingDigest(staging).digest;
                readReviewSessionReplacements(staging);
                return {
                    state: "replaced",
                    record: interrupted.record,
                    recovered: true,
                    stagingDigest,
                    next: nextStep(interrupted.record),
                };
            }
        }
        const observed = plan(staging, replacedAt);
        if (!observed.plan)
            throw new ReviewSessionReplacementError(observed.errors);
        writeFileAtomic(path.join(staging, ...REVIEW_SESSION_REPLACEMENTS_FILE.split("/")), `${[...readReplacementLines(staging), observed.plan.line].join("\n")}\n`, { temporaryDirectory: path.dirname(staging) });
        moveReplacedFiles(staging, observed.plan.record);
        const stagingDigest = refreshStoredStagingDigest(staging).digest;
        const reread = readReviewSessionReplacements(staging).at(-1);
        if (!reread || stableJson(reread) !== stableJson(observed.plan.record))
            throw new Error("置換記録の書き込み後read-backが一致しません");
        return {
            state: "replaced",
            record: reread,
            recovered: false,
            stagingDigest,
            next: nextStep(reread),
        };
    });
}
export class ReviewSessionReplacementError extends Error {
    reasons;
    constructor(reasons) {
        super(`review session置換の前提を満たしません: ${reasons.join("; ")}`);
        this.reasons = reasons;
    }
}
//# sourceMappingURL=review-session-replacement.js.map