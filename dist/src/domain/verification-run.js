import crypto from "node:crypto";
import { parseJsonStrict, redactSecrets, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
/**
 * 観測した検証実行の機械記録（REQ-WF-038、REQ-WF-040）。
 *
 * **検証の合格は自己申告ではなく観測である。** `verify run`だけがこの記録を追記する。
 * 記録は「どのcommitで」「どの影響集合に対して」「どのargvを」実行し「終了値が何だったか」
 * を持つ。`review export`は申告文字列ではなくこの記録から検証欄を導出し、消費側は
 * 証跡の検証欄がこの記録に存在することを`recordDigest`で照合する。
 *
 * **記録は利用者のlocal stagingにある。** 改竄を暗号的に防ぐものではなく、
 * review sessionと同じ信頼水準の機械記録である。検証できるのは「CLIが観測した形の
 * 記録が、証跡の指すcommitと影響集合に一致して存在すること」までである。
 */
export const VERIFICATION_RUN_SCHEMA_VERSION = "agent-skill-chain/verification-run/v1";
/** staging内の追記専用記録。`journal/`配下は版管理下stagingでも`.gitignore`が除外する。 */
export const VERIFICATION_RUN_FILE = "journal/verification-runs.jsonl";
export const VERIFICATION_SCOPES = ["targeted", "full"];
/** 1記録のargv要素数・byte数と、file全体の記録数の上限。 */
export const MAX_VERIFICATION_ARGV = 256;
const MAX_ARGUMENT_BYTES = 4096;
export const MAX_VERIFICATION_RUNS = 4096;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SIGNAL = /^SIG[A-Z0-9]{1,16}$/u;
const RECORD_FIELDS = [
    "schemaVersion",
    "baseSha",
    "headSha",
    "command",
    "scope",
    "impactDigest",
    "impactMode",
    "exitCode",
    "signal",
    "startedAt",
    "finishedAt",
    "stdoutDigest",
    "stderrDigest",
    "recordDigest",
];
function exactFields(value, label, fields) {
    if (!isRecord(value))
        throw new Error(`${label}はobjectが必要です`);
    const unknown = Object.keys(value).filter((field) => !fields.includes(field));
    if (unknown.length > 0)
        throw new Error(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
    const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
    if (missing.length > 0)
        throw new Error(`${label}の必須fieldがありません: ${missing.join(", ")}`);
    return value;
}
function pattern(value, expression, label, description) {
    if (typeof value !== "string" || !expression.test(value))
        throw new Error(`${label}は${description}が必要です`);
    return value;
}
function timestamp(value, label) {
    if (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
        new Date(value).toISOString() !== value)
        throw new Error(`${label}はUTCのISO 8601時刻（ミリ秒つき）が必要です`);
    return value;
}
/**
 * 実行するargvを検査する。**shellを通さずに実行するため、要素はそのまま
 * processへ渡る。** 空要素・制御文字・非NFC・上限超過を拒否する。
 */
export function validateVerificationArgv(value, label = "検証command") {
    if (!Array.isArray(value) ||
        value.length < 1 ||
        value.length > MAX_VERIFICATION_ARGV)
        throw new Error(`${label}は1〜${MAX_VERIFICATION_ARGV}要素のargvが必要です`);
    return Object.freeze(value.map((argument, index) => {
        if (typeof argument !== "string" ||
            argument === "" ||
            argument.normalize("NFC") !== argument ||
            /[\u0000-\u001f\u007f]/u.test(argument) ||
            Buffer.byteLength(argument, "utf8") > MAX_ARGUMENT_BYTES)
            throw new Error(`${label}[${index}]は制御文字を含まない空でない${MAX_ARGUMENT_BYTES} byte以下のNFC文字列が必要です`);
        /** argvは記録とcommitされる証跡へ残るため、秘密情報らしき値を拒否する */
        if (redactSecrets(argument) !== argument)
            throw new Error(`${label}[${index}]に秘密情報らしき値があります。argvは証跡へ残るため環境変数で渡してください`);
        return argument;
    }));
}
export function verificationRunDigest(body) {
    const withoutDigest = Object.fromEntries(Object.entries(body).filter(([field]) => field !== "recordDigest"));
    return crypto
        .createHash("sha256")
        .update(stableJson(withoutDigest))
        .digest("hex");
}
function parseRecordValue(value, label) {
    const record = exactFields(value, label, RECORD_FIELDS);
    if (record.schemaVersion !== VERIFICATION_RUN_SCHEMA_VERSION)
        throw new Error(`${label}.schemaVersionが不正です`);
    const scope = record.scope;
    if (typeof scope !== "string" ||
        !VERIFICATION_SCOPES.includes(scope))
        throw new Error(`${label}.scopeはtargetedまたはfullが必要です`);
    if (record.impactMode !== "targeted" && record.impactMode !== "full")
        throw new Error(`${label}.impactModeはtargetedまたはfullが必要です`);
    if (record.exitCode !== null &&
        (typeof record.exitCode !== "number" ||
            !Number.isSafeInteger(record.exitCode) ||
            record.exitCode < 0 ||
            record.exitCode > 255))
        throw new Error(`${label}.exitCodeはnullまたは0〜255の整数が必要です`);
    if (record.signal !== null &&
        (typeof record.signal !== "string" || !SIGNAL.test(record.signal)))
        throw new Error(`${label}.signalはnullまたはsignal名が必要です`);
    if ((record.exitCode === null) === (record.signal === null))
        throw new Error(`${label}はexitCodeとsignalのどちらか一方だけを持ちます`);
    if (record.scope === "targeted" && record.impactMode === "full")
        throw new Error(`${label}.scope=targetedは影響集合がfullのとき記録できません`);
    const body = {
        schemaVersion: VERIFICATION_RUN_SCHEMA_VERSION,
        baseSha: pattern(record.baseSha, OID, `${label}.baseSha`, "Git object ID"),
        headSha: pattern(record.headSha, OID, `${label}.headSha`, "Git object ID"),
        command: validateVerificationArgv(record.command, `${label}.command`),
        scope: scope,
        impactDigest: pattern(record.impactDigest, SHA256, `${label}.impactDigest`, "sha256"),
        impactMode: record.impactMode,
        exitCode: record.exitCode,
        signal: record.signal,
        startedAt: timestamp(record.startedAt, `${label}.startedAt`),
        finishedAt: timestamp(record.finishedAt, `${label}.finishedAt`),
        stdoutDigest: pattern(record.stdoutDigest, SHA256, `${label}.stdoutDigest`, "sha256"),
        stderrDigest: pattern(record.stderrDigest, SHA256, `${label}.stderrDigest`, "sha256"),
    };
    if (body.finishedAt < body.startedAt)
        throw new Error(`${label}.finishedAtはstartedAt以後が必要です`);
    const recordDigest = pattern(record.recordDigest, SHA256, `${label}.recordDigest`, "sha256");
    if (verificationRunDigest(body) !== recordDigest)
        throw new Error(`${label}.recordDigestが内容と一致しません`);
    return Object.freeze({ ...body, recordDigest });
}
/** 記録bodyへdigestを付け、値を検査した記録を返す。 */
export function sealVerificationRun(body) {
    return parseRecordValue({ ...body, recordDigest: verificationRunDigest(body) }, "検証記録");
}
export function renderVerificationRun(record) {
    const ordered = Object.fromEntries(RECORD_FIELDS.map((field) => [field, record[field]]));
    return JSON.stringify(ordered);
}
/**
 * 追記専用記録fileを厳密に読む。**1行でも読めなければ全体を拒否する**（fail closed）。
 * 各行は正規直列化とbyte一致しなければならず、末尾は改行で終わる。
 */
export function parseVerificationRuns(source) {
    if (source === "")
        return Object.freeze([]);
    if (!source.endsWith("\n"))
        throw new Error("検証記録fileは改行で終わる必要があります");
    const lines = source.slice(0, -1).split("\n");
    if (lines.length > MAX_VERIFICATION_RUNS)
        throw new Error(`検証記録は${MAX_VERIFICATION_RUNS}件以下が必要です。stagingを整理してください`);
    const records = lines.map((line, index) => {
        const label = `検証記録${index + 1}行目`;
        const record = parseRecordValue(parseJsonStrict(line, label), label);
        if (renderVerificationRun(record) !== line)
            throw new Error(`${label}が正規直列化と一致しません`);
        return record;
    });
    const digests = records.map(({ recordDigest }) => recordDigest);
    if (new Set(digests).size !== digests.length)
        throw new Error("検証記録のrecordDigestが重複しています");
    return Object.freeze(records);
}
export function renderVerificationRuns(records) {
    return records.map((record) => `${renderVerificationRun(record)}\n`).join("");
}
function sameArgv(left, right) {
    return stableJson(left) === stableJson(right);
}
/**
 * `scope=targeted`の実行が影響集合の選んだfeatureを全部argvに含むかを返す。
 * **targetedを名乗る実行が影響集合より狭いfeatureしか走らせない形を拒否する。**
 * 含まれないfeatureを返す（空なら充足）。
 */
export function missingTargetedFeatures(command, features) {
    const argv = new Set(command);
    return features.filter((feature) => !argv.has(feature));
}
/**
 * `H_impl`と影響集合に一致する記録から、証跡へ埋め込む検証欄を導出する。
 *
 * 1. `headSha`と`impactDigest`が一致する記録だけを対象にする
 * 2. **同じargvの記録は最新の1件だけを見る。** 最新が不合格のcommandがあれば拒否する。
 *    合格した後の再実行で失敗した事実を、古い合格で隠させない
 * 3. 合格（`exitCode=0`・`signal=null`）した実行が1件以上必要である
 * 4. 影響集合がfullなら`scope=full`の合格実行が必要である
 * 5. `scope=targeted`の合格実行は影響集合の選んだfeatureを全部argvに含む
 */
export function selectObservedVerification(records, target) {
    const matching = records.filter((record) => record.headSha === target.headSha &&
        record.impactDigest === target.impactDigest);
    if (matching.length === 0) {
        const atHead = records.filter((record) => record.headSha === target.headSha).length;
        throw new Error(atHead > 0
            ? `H_impl ${target.headSha} の検証記録${atHead}件はいずれも現在の影響集合（digest ${target.impactDigest}）と一致しません。比較基点を揃えてverify runを再実行してください`
            : `H_impl ${target.headSha} で観測した検証記録がありません。H_implで verify run --staging=<staging> -- <command> を実行してください`);
    }
    const latest = [];
    for (const record of matching) {
        const index = latest.findIndex((item) => sameArgv(item.command, record.command));
        if (index >= 0)
            latest.splice(index, 1);
        latest.push(record);
    }
    const failed = latest.filter((record) => record.exitCode !== 0 || record.signal !== null);
    if (failed.length > 0)
        throw new Error(`最新の実行が不合格の検証commandがあります: ${failed
            .map((record) => `${JSON.stringify(record.command)}（exitCode=${String(record.exitCode)}, signal=${String(record.signal)}）`)
            .join("; ")}`);
    if (target.impactMode === "full" && !latest.some((r) => r.scope === "full"))
        throw new Error("影響集合がfullのためscope=fullの合格した検証記録が必要です");
    for (const record of latest) {
        if (record.scope !== "targeted")
            continue;
        const missing = missingTargetedFeatures(record.command, target.impactFeatures);
        if (missing.length > 0)
            throw new Error(`scope=targetedの検証記録が影響集合のfeatureを含みません: ${missing.join(", ")}`);
    }
    return Object.freeze(latest.map((record) => Object.freeze({
        command: record.command,
        scope: record.scope,
        exitCode: 0,
        headSha: record.headSha,
        impactDigest: record.impactDigest,
        finishedAt: record.finishedAt,
        recordDigest: record.recordDigest,
    })));
}
/**
 * 証跡の検証欄を保存済み記録と照合する。**証跡の値をauthorityにせず、記録に同じ
 * `recordDigest`の合格記録があり、写した値が一致し、同じargvの後続実行が失敗して
 * いないことだけを受理する。**
 */
export function verificationRecordErrors(entries, records) {
    const errors = [];
    for (const entry of entries) {
        const index = records.findIndex((record) => record.recordDigest === entry.recordDigest);
        const record = records[index];
        if (record === undefined) {
            errors.push(`review証跡の検証記録${entry.recordDigest}がstagingの観測記録にありません`);
            continue;
        }
        if (!sameArgv(record.command, entry.command) ||
            record.scope !== entry.scope ||
            record.exitCode !== 0 ||
            record.signal !== null ||
            record.headSha !== entry.headSha ||
            record.impactDigest !== entry.impactDigest ||
            record.finishedAt !== entry.finishedAt) {
            errors.push(`review証跡の検証記録${entry.recordDigest}がstagingの観測記録と一致しません`);
            continue;
        }
        const later = records
            .slice(index + 1)
            .filter((candidate) => candidate.headSha === record.headSha &&
            candidate.impactDigest === record.impactDigest &&
            sameArgv(candidate.command, record.command))
            .at(-1);
        if (later !== undefined && (later.exitCode !== 0 || later.signal !== null))
            errors.push(`review証跡の検証command ${JSON.stringify(record.command)} は同じH_implでの後続実行が不合格です`);
    }
    return errors;
}
//# sourceMappingURL=verification-run.js.map