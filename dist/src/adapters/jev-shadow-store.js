/**
 * Jev continuous shadowのfile I/O（Issue #1486、T-02）。
 *
 * `src/adapters/decision-journal-store.ts`と同じ永続方針を踏襲する：
 * 永続先は常に`primaryRoot`（worktree削除で消えないため）、file単位の
 * single-writer lockは既存`withStagingMutationLock`を再利用する。
 * decision journal本体（`events.jsonl`）とは別file（`jev-shadow.jsonl`）に
 * 分け、shadow記録の追加がdecision journalの既存schema・既存読み手へ
 * 一切影響しないようにする。
 */
import fs from "node:fs";
import path from "node:path";
import { withStagingMutationLock } from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { isRecord } from "../types.js";
export const JEV_SHADOW_DIRECTORY = ".agent-skill-chain/runtime/decisions";
function shadowDirectory(primaryRoot, id) {
    return path.join(primaryRoot, JEV_SHADOW_DIRECTORY, path.basename(id));
}
function shadowPath(primaryRoot, id) {
    return path.join(shadowDirectory(primaryRoot, id), "jev-shadow.jsonl");
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
function nullableNumber(value, label) {
    if (value === null)
        return null;
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`${label}は数値が必要です`);
    return value;
}
const AUTHORITY_MODES = [
    "authoritative",
    "advisory",
    "one-way-escalation",
    "constrained-choice",
];
const OUTCOME_KINDS = [
    "ok",
    "schema-error",
    "auth-error",
    "usage-error",
    "rate-limited",
    "network-error",
    "unexpected-status",
];
export function parseJevShadowLine(value) {
    if (!isRecord(value))
        throw new Error("jev-shadow行はobjectが必要です");
    const latencyMs = value.latencyMs;
    if (typeof latencyMs !== "number" ||
        latencyMs < 0 ||
        !Number.isFinite(latencyMs))
        throw new Error("latencyMsが不正です");
    const inputTokens = value.inputTokens;
    const outputTokens = value.outputTokens;
    if (typeof inputTokens !== "number" || inputTokens < 0)
        throw new Error("inputTokensが不正です");
    if (typeof outputTokens !== "number" || outputTokens < 0)
        throw new Error("outputTokensが不正です");
    const authorityMode = value.primaryAuthorityMode;
    if (typeof authorityMode !== "string" ||
        !AUTHORITY_MODES.includes(authorityMode))
        throw new Error("primaryAuthorityModeが不正です");
    const outcomeKind = value.outcomeKind;
    if (typeof outcomeKind !== "string" ||
        !OUTCOME_KINDS.includes(outcomeKind))
        throw new Error("outcomeKindが不正です");
    const matches = value.matchesPrimaryProposedValue;
    if (matches !== null && typeof matches !== "boolean")
        throw new Error("matchesPrimaryProposedValueが不正です");
    const confidence = value.jevConfidence;
    if (confidence !== null && typeof confidence !== "number")
        throw new Error("jevConfidenceが不正です");
    return {
        decisionRecordId: requiredString(value.decisionRecordId, "decisionRecordId"),
        decisionTypeId: requiredString(value.decisionTypeId, "decisionTypeId"),
        candidateHeadSha: requiredString(value.candidateHeadSha, "candidateHeadSha"),
        primaryProposedValue: requiredString(value.primaryProposedValue, "primaryProposedValue"),
        primaryAuthorityMode: authorityMode,
        jevModel: requiredString(value.jevModel, "jevModel"),
        jevResolvedModel: nullableString(value.jevResolvedModel, "jevResolvedModel"),
        jevProposedValue: nullableString(value.jevProposedValue, "jevProposedValue"),
        jevConfidence: nullableNumber(confidence, "jevConfidence"),
        outcomeKind: outcomeKind,
        outcomeDetail: nullableString(value.outcomeDetail, "outcomeDetail"),
        matchesPrimaryProposedValue: matches,
        inputTokens,
        outputTokens,
        latencyMs,
        dispatchedAt: requiredString(value.dispatchedAt, "dispatchedAt"),
    };
}
export function readJevShadowJournal(primaryRoot, id) {
    const file = shadowPath(primaryRoot, id);
    if (!fs.existsSync(file))
        return { records: [], errors: [] };
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error("jev-shadow journalはsymlinkでない通常fileが必要です");
    const lines = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "");
    const records = [];
    const errors = [];
    lines.forEach((line, index) => {
        try {
            records.push(parseJevShadowLine(JSON.parse(line)));
        }
        catch (error) {
            errors.push(`line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    return { records, errors };
}
export function findJevShadowRecord(primaryRoot, id, decisionRecordId) {
    const { records, errors } = readJevShadowJournal(primaryRoot, id);
    if (errors.length > 0)
        throw new Error(`jev-shadow journal（${id}）に不正な行があるため参照できません: ${errors.join("; ")}`);
    return records.find((record) => record.decisionRecordId === decisionRecordId);
}
/** 1件追記する。既存decision journalと同じsingle-writer lockを再利用する。 */
export function appendJevShadowRecord(primaryRoot, id, record) {
    const directory = shadowDirectory(primaryRoot, id);
    fs.mkdirSync(directory, { recursive: true });
    withStagingMutationLock(directory, () => {
        const file = shadowPath(primaryRoot, id);
        const existing = readJevShadowJournal(primaryRoot, id);
        if (existing.errors.length > 0)
            throw new Error(`jev-shadow journalの既存内容が不正です: ${existing.errors.join("; ")}`);
        if (existing.records.some((entry) => entry.decisionRecordId === record.decisionRecordId))
            throw new Error(`decisionRecordIdが既存jev-shadow journalと重複しています: ${record.decisionRecordId}`);
        const priorSource = fs.existsSync(file)
            ? fs.readFileSync(file, "utf8").replace(/\n$/u, "")
            : "";
        const nextSource = priorSource === ""
            ? `${JSON.stringify(record)}\n`
            : `${priorSource}\n${JSON.stringify(record)}\n`;
        writeFileAtomic(file, nextSource);
        const reread = readJevShadowJournal(primaryRoot, id);
        if (reread.errors.length > 0 ||
            !reread.records.some((entry) => entry.decisionRecordId === record.decisionRecordId))
            throw new Error("jev-shadow journalの書き込み後read-backが一致しません");
    });
}
//# sourceMappingURL=jev-shadow-store.js.map