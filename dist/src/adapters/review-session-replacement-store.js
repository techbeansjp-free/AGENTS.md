import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict } from "../lib/security.js";
import { isRecord } from "../types.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
/**
 * review session置換記録（TERM-1569-01、REQ-WF-052）のreader。
 *
 * **置換記録は認可の根拠にしない（INV-07）。** 置換後のround 1が照合するH_implと、
 * `pr reanchor`の`session-replacement`がH_implを確かめる値だけを与える。読取りのたびに
 * sequence連番・hash chain・保存fileのdigestを検査し、1つでも崩れていれば拒否する。
 */
export const REVIEW_SESSION_REPLACEMENTS_FILE = "journal/review-session-replacements.jsonl";
const SCHEMA = "agent-skill-chain/review-session-replacement/v1";
const OID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const FIELDS = [
    "schemaVersion",
    "sequence",
    "previousRecordDigest",
    "previousSession",
    "implementationHeadSha",
    "pullRequestHeadSha",
    "savedPath",
    "savedProgressPath",
    "replacedAt",
];
const SESSION_FIELDS = [
    "sessionId",
    "digest",
    "status",
    "rounds",
    "countedRounds",
    "initialHeadSha",
    "latestCandidateHeadSha",
];
export function replacedSessionPath(sequence) {
    return `review-session-replaced-${String(sequence).padStart(3, "0")}.json`;
}
export function replacedProgressPath(sequence) {
    return `journal/review-progress-replaced-${String(sequence).padStart(3, "0")}.jsonl`;
}
export function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
function closedFields(value, fields, label) {
    const keys = Object.keys(value);
    if (keys.length !== fields.length ||
        keys.some((key) => !fields.includes(key)))
        throw new Error(`${label}のfieldが置換記録schemaと一致しません`);
}
function parseRecord(line) {
    const value = parseJsonStrict(line, REVIEW_SESSION_REPLACEMENTS_FILE);
    if (!isRecord(value) || value.schemaVersion !== SCHEMA)
        throw new Error("置換記録のschemaVersionが不正です");
    closedFields(value, FIELDS, "置換記録");
    const previous = value.previousSession;
    if (!isRecord(previous))
        throw new Error("置換記録のpreviousSessionが不正です");
    closedFields(previous, SESSION_FIELDS, "置換記録のpreviousSession");
    const shaFields = [
        value.implementationHeadSha,
        value.pullRequestHeadSha,
        previous.initialHeadSha,
        previous.latestCandidateHeadSha,
    ];
    if (!Number.isSafeInteger(value.sequence) ||
        value.sequence < 1 ||
        (value.previousRecordDigest !== null &&
            (typeof value.previousRecordDigest !== "string" ||
                !SHA256.test(value.previousRecordDigest))) ||
        shaFields.some((sha) => typeof sha !== "string" || !OID.test(sha)) ||
        typeof previous.sessionId !== "string" ||
        !SHA256.test(previous.sessionId) ||
        typeof previous.digest !== "string" ||
        !SHA256.test(previous.digest) ||
        previous.status !== "converged" ||
        !Number.isSafeInteger(previous.rounds) ||
        !Number.isSafeInteger(previous.countedRounds) ||
        typeof value.savedPath !== "string" ||
        (value.savedProgressPath !== null &&
            typeof value.savedProgressPath !== "string") ||
        typeof value.replacedAt !== "string" ||
        new Date(Date.parse(value.replacedAt)).toISOString() !== value.replacedAt)
        throw new Error("置換記録のfield値が不正です");
    return value;
}
/** 置換記録fileの完全な行を返す（fileが無ければ空）。末尾が欠けた記録は拒否する。 */
export function readReplacementLines(staging) {
    const file = path.join(staging, ...REVIEW_SESSION_REPLACEMENTS_FILE.split("/"));
    if (!fs.existsSync(file))
        return [];
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error("置換記録は通常fileでなければなりません");
    const source = fs.readFileSync(file, "utf8");
    if (source === "" || !source.endsWith("\n"))
        throw new Error("置換記録の末尾が完全な行ではありません");
    return source.slice(0, -1).split("\n");
}
/**
 * 置換記録を読み、連番・hash chain・保存fileを検査する。
 *
 * `pendingLast`は`review replace --apply`の中断復旧だけが使う。最終記録の保存fileが
 * まだ無い状態（記録の追記後・renameの前）を許し、それ以外の崩れは常に拒否する。
 */
export function readReviewSessionReplacements(stagingInput, options = {}) {
    const staging = assertWorkflowStaging(stagingInput);
    const lines = readReplacementLines(staging);
    return lines.map((line, index) => {
        const record = parseRecord(line);
        if (record.sequence !== index + 1)
            throw new Error("置換記録のsequenceが連番ではありません");
        if (record.previousRecordDigest !==
            (index === 0 ? null : sha256(lines[index - 1])))
            throw new Error("置換記録のhash chainが直前の記録と一致しません");
        if (record.savedPath !== replacedSessionPath(record.sequence) ||
            (record.savedProgressPath !== null &&
                record.savedProgressPath !== replacedProgressPath(record.sequence)))
            throw new Error("置換記録の保存先pathが連番から導出した名前と一致しません");
        const saved = path.join(staging, record.savedPath);
        const pending = options.pendingLast === true &&
            index === lines.length - 1 &&
            !fs.existsSync(saved);
        if (!pending) {
            if (!fs.existsSync(saved) ||
                fs.lstatSync(saved).isSymbolicLink() ||
                sha256(fs.readFileSync(saved)) !== record.previousSession.digest)
                throw new Error(`置換済みreview sessionの保存file ${record.savedPath} が置換記録のdigestと一致しません`);
            if (record.savedProgressPath !== null &&
                !fs.existsSync(path.join(staging, ...record.savedProgressPath.split("/"))))
                throw new Error(`置換済みreview progressの保存file ${record.savedProgressPath} がありません`);
        }
        return record;
    });
}
//# sourceMappingURL=review-session-replacement-store.js.map