import fs from "node:fs";
import path from "node:path";
import { withStagingMutationLock } from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { isRecord } from "../types.js";
/**
 * Decision Journalの永続先（Issue #1485、L-04設計正本§3）。**常に
 * `primaryRoot`直下。** `activeRoot`（作業中worktree）には書かない。
 * Issue #1482のmetrics journalが`stagingRepositoryRoot`（active）へ書いて
 * いた設計を踏襲すると、worktree削除でjournalが失われる（INV-03）。
 * `.gitignore`済みの`runtime/`配下であり、staging digestの対象外。
 */
export const DECISION_JOURNAL_DIRECTORY = ".agent-skill-chain/runtime/decisions";
function decisionJournalDirectory(primaryRoot, id) {
    return path.join(primaryRoot, DECISION_JOURNAL_DIRECTORY, path.basename(id));
}
function decisionJournalPath(primaryRoot, id) {
    return path.join(decisionJournalDirectory(primaryRoot, id), "events.jsonl");
}
function requiredString(value, label) {
    if (typeof value !== "string" || value === "")
        throw new Error(`${label}は空でない文字列が必要です`);
    return value;
}
function nullableString(value, label) {
    if (value === null)
        return null;
    return requiredString(value, label);
}
function parseExecutor(value) {
    if (!isRecord(value))
        throw new Error("executorはobjectが必要です");
    if (value.kind === "deterministic") {
        return {
            kind: "deterministic",
            resolverId: requiredString(value.resolverId, "executor.resolverId"),
        };
    }
    if (value.kind === "provider") {
        if (value.target !== "lightweight-tier" && value.target !== "jev")
            throw new Error("executor.targetが不正です");
        const model = value.model === undefined ? undefined : requiredString(value.model, "executor.model");
        return model === undefined
            ? { kind: "provider", target: value.target }
            : { kind: "provider", target: value.target, model };
    }
    throw new Error("executor.kindが不正です");
}
const AUTHORITY_MODES = [
    "authoritative",
    "advisory",
    "one-way-escalation",
    "constrained-choice",
];
function parseAuthorityMode(value) {
    if (typeof value === "string" && AUTHORITY_MODES.includes(value))
        return value;
    throw new Error("authorityModeが不正です");
}
/** journalの1行をpure domain型へ検証しながら変換する。 */
export function parseDecisionJournalLine(value) {
    if (!isRecord(value))
        throw new Error("decision journal行はobjectが必要です");
    const latencyMs = value.latencyMs;
    const cost = value.cost;
    if (typeof latencyMs !== "number" || latencyMs < 0 || !Number.isFinite(latencyMs))
        throw new Error("latencyMsが不正です");
    if (typeof cost !== "number" || cost < 0 || !Number.isFinite(cost))
        throw new Error("costが不正です");
    return {
        decisionRecordId: requiredString(value.decisionRecordId, "decisionRecordId"),
        decisionTypeId: requiredString(value.decisionTypeId, "decisionTypeId"),
        inputDigest: requiredString(value.inputDigest, "inputDigest"),
        subjectRef: requiredString(value.subjectRef, "subjectRef"),
        candidateHeadSha: requiredString(value.candidateHeadSha, "candidateHeadSha"),
        executor: parseExecutor(value.executor),
        providerModel: nullableString(value.providerModel, "providerModel"),
        providerVersion: nullableString(value.providerVersion, "providerVersion"),
        proposedValue: requiredString(value.proposedValue, "proposedValue"),
        effectiveValue: nullableString(value.effectiveValue, "effectiveValue"),
        authorityMode: parseAuthorityMode(value.authorityMode),
        adjudicationReason: requiredString(value.adjudicationReason, "adjudicationReason"),
        latencyMs,
        cost,
        decidedAt: requiredString(value.decidedAt, "decidedAt"),
    };
}
export function readDecisionJournal(primaryRoot, id) {
    const file = decisionJournalPath(primaryRoot, id);
    if (!fs.existsSync(file))
        return { records: [], errors: [] };
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error("decision journalはsymlinkでない通常fileが必要です");
    const lines = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "");
    const records = [];
    const errors = [];
    lines.forEach((line, index) => {
        try {
            records.push(parseDecisionJournalLine(JSON.parse(line)));
        }
        catch (error) {
            errors.push(`line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    return { records, errors };
}
export function findDecisionJournalRecord(primaryRoot, id, decisionRecordId) {
    return readDecisionJournal(primaryRoot, id).records.find((record) => record.decisionRecordId === decisionRecordId);
}
/**
 * 1件追記する。**既存metrics journal（`appendMetricsEvent`）と同じ
 * single-writer lock（`withStagingMutationLock`）を再利用し、専用の耐久保証
 * 機構を新設しない。** lockは`<primaryRoot>/.agent-skill-chain/runtime/decisions/<id>/`
 * directory自身に対して取得する（`withStagingMutationLock`はdirectory一般に
 * 使える。staging専用ではない）。
 */
export function appendDecisionJournalRecord(primaryRoot, id, record) {
    const directory = decisionJournalDirectory(primaryRoot, id);
    fs.mkdirSync(directory, { recursive: true });
    withStagingMutationLock(directory, () => {
        const file = decisionJournalPath(primaryRoot, id);
        const existing = readDecisionJournal(primaryRoot, id);
        if (existing.errors.length > 0)
            throw new Error(`decision journalの既存内容が不正です: ${existing.errors.join("; ")}`);
        if (existing.records.some((entry) => entry.decisionRecordId === record.decisionRecordId))
            throw new Error(`decisionRecordIdが既存journalと重複しています: ${record.decisionRecordId}`);
        const priorSource = fs.existsSync(file)
            ? fs.readFileSync(file, "utf8").replace(/\n$/u, "")
            : "";
        const nextSource = priorSource === ""
            ? `${JSON.stringify(record)}\n`
            : `${priorSource}\n${JSON.stringify(record)}\n`;
        writeFileAtomic(file, nextSource);
        const reread = readDecisionJournal(primaryRoot, id);
        if (reread.errors.length > 0 ||
            !reread.records.some((entry) => entry.decisionRecordId === record.decisionRecordId))
            throw new Error("decision journalの書き込み後read-backが一致しません");
    });
}
//# sourceMappingURL=decision-journal-store.js.map