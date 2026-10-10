import path from "node:path";
import { git } from "../lib/process.js";
import { parseJsonStrict } from "../lib/security.js";
import { isRecord } from "../types.js";
import { validateDeliveryEvidence } from "../domain/delivery.js";
import { parseReviewEvidence, } from "../domain/review-evidence.js";
import { verifyReviewEvidenceWithStaging } from "./review-evidence.js";
import { GIT_ENV } from "./review-diff.js";
const MAX_BYTES = 256 * 1024;
const TOKENS = ["ASC_VERIFICATION", "ASC_REVIEW", "ASC_HEAD"];
function fields(value, required, optional = []) {
    if (!isRecord(value) ||
        required.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => ![...required, ...optional].includes(key)))
        throw new Error("delivery summaryの必須fieldまたは未知fieldが不正です");
    return value;
}
function strings(value) {
    if (!Array.isArray(value) ||
        value.length === 0 ||
        value.some((item) => typeof item !== "string" || item.trim() === "") ||
        new Set(value).size !== value.length)
        throw new Error("delivery summaryには重複のない空でない文字列配列が必要です");
    return value;
}
/** Only an immutable regular Git blob is input; filesystem edits are never read. */
export function readDeliveryBlob(root, commit, relative) {
    if (!/^[a-f0-9]{40}$/u.test(commit) ||
        relative === "" ||
        path.posix.normalize(relative) !== relative ||
        path.isAbsolute(relative) ||
        relative.split("/").some((part) => part === ".." || part === ".git") ||
        /[\\\x00-\x1f\x7f]/u.test(relative))
        throw new Error("delivery summaryは正規化済みrepository相対pathが必要です");
    const entries = git(["ls-tree", "-z", commit, "--", relative], root, {
        env: GIT_ENV,
    })
        .stdout.split("\0")
        .filter(Boolean);
    const match = entries.length === 1
        ? /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/u.exec(entries[0])
        : null;
    if (!match || match[3] !== relative)
        throw new Error("delivery summary/reviewは対象commitの通常Git blobが必要です");
    const oid = match[2];
    const size = Number(git(["cat-file", "-s", oid], root, { env: GIT_ENV }).stdout.trim());
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES)
        throw new Error("delivery summary/reviewは256KiB以下が必要です");
    return git(["cat-file", "blob", oid], root, {
        env: GIT_ENV,
        maxBufferBytes: MAX_BYTES,
    }).stdout;
}
export function parseDeliverySummary(source, issue) {
    const value = fields(parseJsonStrict(source, "delivery summary"), ["schemaVersion", "issue", "body", "scenarioIds", "spec"], ["ownership"]);
    if (value.schemaVersion !== "asc-delivery-summary/v1" ||
        value.issue !== issue ||
        !Number.isSafeInteger(issue) ||
        issue < 1 ||
        typeof value.body !== "string" ||
        Buffer.byteLength(source, "utf8") > MAX_BYTES)
        throw new Error("delivery summaryのschemaVersion/issue/bodyが不正です");
    const body = value.body;
    const found = body.match(/\{\{ASC_[^{}\r\n]*\}\}/gu) ?? [];
    if (found.length !== TOKENS.length ||
        TOKENS.some((token) => found.filter((item) => item === `{{${token}}}`).length !== 1))
        throw new Error("delivery summaryのASC_VERIFICATION/ASC_REVIEW/ASC_HEADは各1回必要です");
    const scenarioIds = strings(value.scenarioIds);
    const spec = fields(value.spec, ["consistent", "impact"], ["rationale", "trace"]);
    if (typeof spec.consistent !== "boolean" ||
        !["updated", "no-spec-impact"].includes(String(spec.impact)) ||
        (spec.rationale !== undefined && typeof spec.rationale !== "string"))
        throw new Error("delivery summaryのspec明示宣言が不正です");
    if (spec.trace !== undefined) {
        const trace = fields(spec.trace, ["requirements", "scenarios", "tests"]);
        for (const key of ["requirements", "scenarios", "tests"])
            strings(trace[key]);
    }
    let ownership;
    if (value.ownership !== undefined) {
        ownership = fields(value.ownership, ["classified", "owner", "targetLayer"]);
        if (typeof ownership.classified !== "boolean" ||
            typeof ownership.owner !== "string" ||
            ownership.owner.trim() === "" ||
            typeof ownership.targetLayer !== "string" ||
            ownership.targetLayer.trim() === "")
            throw new Error("delivery summaryのownership明示宣言が不正です");
    }
    return { body, scenarioIds, spec, ownership };
}
/** Semantic declarations come from the reviewed implementation blob; success comes from observations. */
export function generateDeliveryInput(input) {
    const summary = parseDeliverySummary(readDeliveryBlob(input.root, input.implementationHeadSha, input.summaryPath), input.issue);
    const review = parseReviewEvidence(readDeliveryBlob(input.root, input.headSha, `docs/reviews/${input.issue}_review.json`));
    if (review.issue !== input.issue ||
        review.observed.implementationHeadSha !== input.implementationHeadSha)
        throw new Error("delivery summaryと正式reviewのIssue/H_implが一致しません");
    const errors = verifyReviewEvidenceWithStaging({
        staging: input.staging,
        evidence: review,
        independenceMode: input.independenceMode,
        verificationPolicy: input.verificationPolicy,
    });
    if (errors.length > 0)
        throw new Error(`delivery summaryの正式review/検証が不正です: ${errors.join("; ")}`);
    const evidence = {
        headSha: input.headSha,
        review: { approved: true, headSha: input.headSha },
        tests: {
            passed: true,
            headSha: input.headSha,
            scenarioIds: summary.scenarioIds,
        },
        spec: { ...summary.spec, headSha: input.headSha },
        ...(summary.ownership ? { ownership: summary.ownership } : {}),
    };
    validateDeliveryEvidence(evidence, input.headSha);
    const replacements = {
        ASC_HEAD: `H_impl: ${input.implementationHeadSha}; PR HEAD: ${input.headSha}`,
        ASC_REVIEW: `approved; evidenceDigest: ${review.evidenceDigest}; roundDigest: ${review.observed.session.latestRoundDigest}`,
        ASC_VERIFICATION: review.observed.verification
            .map((record) => `scope=${record.scope}; exitCode=${record.exitCode}; recordDigest=${record.recordDigest}; command=${JSON.stringify(record.command)}`)
            .join("\n"),
    };
    const body = summary.body.replace(/\{\{(ASC_VERIFICATION|ASC_REVIEW|ASC_HEAD)\}\}/gu, (_match, token) => replacements[token]);
    return { body, evidence };
}
//# sourceMappingURL=delivery-input.js.map