import crypto from "node:crypto";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import { countedRounds, REVIEW_RECOVERY_ROUND, } from "./review-convergence.js";
import { validateVerificationArgv, VERIFICATION_SCOPES, } from "./verification-run.js";
/**
 * Step 10の構造化review証跡（REQ-WF-038、TERM-ASC-WR-03）。
 *
 * **reviewの証明は散文ではなく構造化Evidenceである。Gitが示す事実を書き直さない。**
 * 本fileは`review export`だけが生成し、人やAIが手で書かない。安全性は次の4つで保つ。
 *
 * 1. **観測（`observed`）と申告（`declared`）を分ける。** `observed`は保存済みreview
 *    session・Git・`verify run`の機械記録から再導出できる値だけを持ち、消費側は毎回
 *    再導出して一致だけを受理する。`declared`はreviewer・implementer identityと
 *    独立性の申告であり、hard gateの根拠にしない（REQ-WF-038）
 * 2. `evidenceDigest`でfile全体の値を束縛する。1 byteの改変でも不一致になる
 * 3. 正規直列化（`renderReviewEvidence`）とbyte一致しないfileを拒否する。
 *    手書き・整形し直しを受理しない
 * 4. 旧版（v1）は申告文字列の検証欄を持つため受理しない
 */
export const REVIEW_EVIDENCE_SCHEMA_VERSION = "agent-skill-chain/review-evidence/v2";
const LEGACY_REVIEW_EVIDENCE_SCHEMA_VERSION = "agent-skill-chain/review-evidence/v1";
/** review証跡のfile名。`docs/reviews/<Issue番号>_review.json`。 */
export const REVIEW_EVIDENCE_NAME_PATTERN = /^([1-9]\d*)_review\.json$/u;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const STABLE_ID = /^[A-Z][A-Z0-9._-]{1,127}$/u;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9_.:=/@-]{0,255}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SEVERITIES = ["Critical", "High", "Medium", "Low"];
const STATUSES = ["valid", "resolved", "duplicate", "false-positive"];
const RELATIONS = [
    "acceptance-violation",
    "invariant-violation",
    "fix-regression",
    "improvement",
    "out-of-scope",
];
const MODES = ["context-isolated", "actor-independent"];
const IMPACT_MODES = ["targeted", "full"];
const MAX_VERIFICATIONS = 64;
const MAX_FINDINGS = 4096;
function exactObject(value, label, fields) {
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
function oneOf(value, values, label) {
    if (typeof value !== "string" || !values.includes(value))
        throw new Error(`${label}が不正です`);
    return value;
}
function oid(value, label) {
    if (typeof value !== "string" || !OID.test(value))
        throw new Error(`${label}は小文字40桁または64桁のGit object IDが必要です`);
    return value;
}
function sha256(value, label) {
    if (typeof value !== "string" || !SHA256.test(value))
        throw new Error(`${label}は小文字64桁のsha256が必要です`);
    return value;
}
function text(value, label) {
    if (typeof value !== "string" ||
        value.trim() === "" ||
        value !== value.trim() ||
        value.normalize("NFC") !== value ||
        /[\u0000-\u001f\u007f]/u.test(value) ||
        Buffer.byteLength(value, "utf8") > 4096)
        throw new Error(`${label}は正規化済みの空でない1行の文字列が必要です`);
    return value;
}
function repositoryPath(value, label) {
    const candidate = text(value, label);
    if (candidate.startsWith("/") ||
        candidate.includes("\\") ||
        candidate
            .split("/")
            .some((part) => part === "" || part === "." || part === ".."))
        throw new Error(`${label}はrepository相対pathが必要です`);
    return candidate;
}
export function isReviewActorId(value) {
    return typeof value === "string" && ACTOR_ID.test(value);
}
function actor(value, label) {
    if (!isReviewActorId(value))
        throw new Error(`${label}は英数字で始まる256文字以下のstable identity（英数字と_.:=/@-）が必要です`);
    return value;
}
function positiveInteger(value, label) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
        throw new Error(`${label}は1以上の整数が必要です`);
    return value;
}
function parseFinding(value, index) {
    const label = `review evidence.findings[${index}]`;
    const finding = exactObject(value, label, [
        "id",
        "severity",
        "status",
        "relation",
        "path",
        "contractId",
    ]);
    if (typeof finding.id !== "string" || !STABLE_ID.test(finding.id))
        throw new Error(`${label}.idは安定IDが必要です`);
    if (finding.contractId !== null &&
        (typeof finding.contractId !== "string" ||
            !STABLE_ID.test(finding.contractId)))
        throw new Error(`${label}.contractIdはnullまたは安定IDが必要です`);
    return Object.freeze({
        id: finding.id,
        severity: oneOf(finding.severity, SEVERITIES, `${label}.severity`),
        status: oneOf(finding.status, STATUSES, `${label}.status`),
        relation: oneOf(finding.relation, RELATIONS, `${label}.relation`),
        path: repositoryPath(finding.path, `${label}.path`),
        contractId: finding.contractId,
    });
}
function parseVerification(value, index, observed) {
    const label = `review evidence.observed.verification[${index}]`;
    const item = exactObject(value, label, [
        "command",
        "scope",
        "exitCode",
        "headSha",
        "impactDigest",
        "finishedAt",
        "recordDigest",
    ]);
    if (item.exitCode !== 0)
        throw new Error(`${label}.exitCodeは0だけを受理します`);
    const headSha = oid(item.headSha, `${label}.headSha`);
    if (headSha !== observed.implementationHeadSha)
        throw new Error(`${label}.headShaはobserved.implementationHeadShaと一致する必要があります`);
    const impactDigest = sha256(item.impactDigest, `${label}.impactDigest`);
    if (impactDigest !== observed.impactDigest)
        throw new Error(`${label}.impactDigestはobserved.impact.digestと一致する必要があります`);
    if (typeof item.finishedAt !== "string" ||
        !TIMESTAMP.test(item.finishedAt) ||
        new Date(item.finishedAt).toISOString() !== item.finishedAt)
        throw new Error(`${label}.finishedAtはUTCのISO 8601時刻が必要です`);
    return Object.freeze({
        command: validateVerificationArgv(item.command, `${label}.command`),
        scope: oneOf(item.scope, VERIFICATION_SCOPES, `${label}.scope`),
        exitCode: 0,
        headSha,
        impactDigest,
        finishedAt: item.finishedAt,
        recordDigest: sha256(item.recordDigest, `${label}.recordDigest`),
    });
}
function parseObserved(value) {
    const observed = exactObject(value, "review evidence.observed", [
        "baseSha",
        "implementationHeadSha",
        "diffDigest",
        "session",
        "impact",
        "verification",
    ]);
    const session = exactObject(observed.session, "review evidence.observed.session", ["sessionId", "latestRoundDigest", "status", "countedRounds"]);
    if (session.status !== "converged")
        throw new Error("review evidence.observed.session.statusはconvergedだけを受理します");
    const counted = positiveInteger(session.countedRounds, "review evidence.observed.session.countedRounds");
    if (counted > REVIEW_RECOVERY_ROUND)
        throw new Error(`review evidence.observed.session.countedRoundsが上限${REVIEW_RECOVERY_ROUND}を超えています: ${counted}`);
    const impact = exactObject(observed.impact, "review evidence.observed.impact", ["digest", "mode"]);
    const baseSha = oid(observed.baseSha, "review evidence.observed.baseSha");
    const implementationHeadSha = oid(observed.implementationHeadSha, "review evidence.observed.implementationHeadSha");
    const impactDigest = sha256(impact.digest, "review evidence.observed.impact.digest");
    const impactMode = oneOf(impact.mode, IMPACT_MODES, "review evidence.observed.impact.mode");
    if (!Array.isArray(observed.verification) ||
        observed.verification.length < 1 ||
        observed.verification.length > MAX_VERIFICATIONS)
        throw new Error(`review evidence.observed.verificationは1〜${MAX_VERIFICATIONS}件が必要です`);
    const verification = observed.verification.map((item, index) => parseVerification(item, index, { implementationHeadSha, impactDigest }));
    const digests = verification.map(({ recordDigest }) => recordDigest);
    if (new Set(digests).size !== digests.length)
        throw new Error("review evidence.observed.verificationのrecordDigestが重複しています");
    const commands = verification.map(({ command }) => stableJson(command));
    if (new Set(commands).size !== commands.length)
        throw new Error("review evidence.observed.verificationのcommandが重複しています");
    if (impactMode === "full" && !verification.some((v) => v.scope === "full"))
        throw new Error("review evidence.observed.impact.modeがfullのためscope=fullの検証記録が必要です");
    return Object.freeze({
        baseSha,
        implementationHeadSha,
        diffDigest: sha256(observed.diffDigest, "review evidence.observed.diffDigest"),
        session: Object.freeze({
            sessionId: sha256(session.sessionId, "review evidence.observed.session.sessionId"),
            latestRoundDigest: sha256(session.latestRoundDigest, "review evidence.observed.session.latestRoundDigest"),
            status: "converged",
            countedRounds: counted,
        }),
        impact: Object.freeze({ digest: impactDigest, mode: impactMode }),
        verification: Object.freeze(verification),
    });
}
function parseDeclared(value) {
    const declared = exactObject(value, "review evidence.declared", [
        "reviewer",
        "implementer",
        "independenceMode",
        "reviewerModifiedCandidate",
    ]);
    const reviewer = actor(declared.reviewer, "review evidence.declared.reviewer");
    const implementer = actor(declared.implementer, "review evidence.declared.implementer");
    if (reviewer === implementer)
        throw new Error("review evidence.declared.reviewerとimplementerは異なるidentityが必要です");
    if (declared.reviewerModifiedCandidate !== false)
        throw new Error("review evidence.declared.reviewerModifiedCandidateはfalseだけを受理します");
    return Object.freeze({
        reviewer,
        implementer,
        independenceMode: oneOf(declared.independenceMode, MODES, "review evidence.declared.independenceMode"),
        reviewerModifiedCandidate: false,
    });
}
/** 値の検査だけを行い、digestとbyte表現は検査しない。 */
function parseEvidenceValue(value) {
    if (isRecord(value) &&
        value.schemaVersion === LEGACY_REVIEW_EVIDENCE_SCHEMA_VERSION)
        throw new Error(`review evidence.schemaVersion ${LEGACY_REVIEW_EVIDENCE_SCHEMA_VERSION} は受理しません。v1の検証欄は申告文字列であり観測ではありません。H_implで verify run を実行し review export で ${REVIEW_EVIDENCE_SCHEMA_VERSION} を再生成してください`);
    const evidence = exactObject(value, "review evidence", [
        "schemaVersion",
        "issue",
        "observed",
        "findings",
        "unresolvedCriticalHigh",
        "verdict",
        "declared",
        "evidenceDigest",
    ]);
    if (evidence.schemaVersion !== REVIEW_EVIDENCE_SCHEMA_VERSION)
        throw new Error("review evidence.schemaVersionが不正です");
    const observed = parseObserved(evidence.observed);
    if (!Array.isArray(evidence.findings) ||
        evidence.findings.length > MAX_FINDINGS)
        throw new Error(`review evidence.findingsは${MAX_FINDINGS}件以下の配列が必要です`);
    const findings = evidence.findings.map(parseFinding);
    const ids = findings.map(({ id }) => id);
    if (stableJson(ids) !== stableJson([...new Set(ids)].sort()))
        throw new Error("review evidence.findingsはIDの重複なし昇順が必要です");
    if (!Array.isArray(evidence.unresolvedCriticalHigh) ||
        evidence.unresolvedCriticalHigh.length !== 0)
        throw new Error("review evidence.unresolvedCriticalHighは空配列だけを受理します。未解決Critical/Highが残るreviewは証跡にできません");
    if (evidence.verdict !== "approved")
        throw new Error("review evidence.verdictはapprovedだけを受理します");
    return Object.freeze({
        schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
        issue: positiveInteger(evidence.issue, "review evidence.issue"),
        observed,
        findings: Object.freeze(findings),
        unresolvedCriticalHigh: Object.freeze([]),
        verdict: "approved",
        declared: parseDeclared(evidence.declared),
        evidenceDigest: sha256(evidence.evidenceDigest, "review evidence.evidenceDigest"),
    });
}
/** `evidenceDigest`を除く全fieldの正規JSONのsha256。 */
export function reviewEvidenceDigest(body) {
    const withoutDigest = Object.fromEntries(Object.entries(body).filter(([field]) => field !== "evidenceDigest"));
    return crypto
        .createHash("sha256")
        .update(stableJson(withoutDigest))
        .digest("hex");
}
function orderedEvidence(evidence) {
    return {
        schemaVersion: evidence.schemaVersion,
        issue: evidence.issue,
        observed: {
            baseSha: evidence.observed.baseSha,
            implementationHeadSha: evidence.observed.implementationHeadSha,
            diffDigest: evidence.observed.diffDigest,
            session: {
                sessionId: evidence.observed.session.sessionId,
                latestRoundDigest: evidence.observed.session.latestRoundDigest,
                status: evidence.observed.session.status,
                countedRounds: evidence.observed.session.countedRounds,
            },
            impact: {
                digest: evidence.observed.impact.digest,
                mode: evidence.observed.impact.mode,
            },
            verification: evidence.observed.verification.map((item) => ({
                command: [...item.command],
                scope: item.scope,
                exitCode: item.exitCode,
                headSha: item.headSha,
                impactDigest: item.impactDigest,
                finishedAt: item.finishedAt,
                recordDigest: item.recordDigest,
            })),
        },
        findings: evidence.findings.map((finding) => ({
            id: finding.id,
            severity: finding.severity,
            status: finding.status,
            relation: finding.relation,
            path: finding.path,
            contractId: finding.contractId,
        })),
        unresolvedCriticalHigh: [...evidence.unresolvedCriticalHigh],
        verdict: evidence.verdict,
        declared: {
            reviewer: evidence.declared.reviewer,
            implementer: evidence.declared.implementer,
            independenceMode: evidence.declared.independenceMode,
            reviewerModifiedCandidate: evidence.declared.reviewerModifiedCandidate,
        },
        evidenceDigest: evidence.evidenceDigest,
    };
}
/**
 * 正規直列化。field順を固定し、2 space indentと末尾改行1つで出力する。
 * **同じ値は常に同じbyte列になる。** 再固定のbyte一致比較はこの性質に依存する。
 */
export function renderReviewEvidence(evidence) {
    return `${JSON.stringify(orderedEvidence(evidence), null, 2)}\n`;
}
/** bodyへdigestを付けて値を検査した証跡を返す。 */
export function sealReviewEvidence(body) {
    return parseEvidenceValue({
        ...body,
        evidenceDigest: reviewEvidenceDigest(body),
    });
}
/**
 * review証跡fileを厳密に読む。未知field、型違い、digest不一致、
 * 正規直列化とのbyte不一致をすべて拒否する。
 */
export function parseReviewEvidence(source) {
    const evidence = parseEvidenceValue(parseJsonStrict(source, "review evidence"));
    if (reviewEvidenceDigest(evidence) !== evidence.evidenceDigest)
        throw new Error("review evidence.evidenceDigestが内容と一致しません。証跡は`review export`で再生成してください");
    if (renderReviewEvidence(evidence) !== source)
        throw new Error("review evidenceが正規直列化と一致しません。手書き・再整形した証跡は受理しません。`review export`で再生成してください");
    return evidence;
}
/** 例外を投げずに読む。読めない場合は理由を返す。 */
export function tryParseReviewEvidence(source) {
    try {
        return { evidence: parseReviewEvidence(source) };
    }
    catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}
/**
 * sessionの全roundを先頭から走査し、finding IDごとの最終状態を返す。
 * reviewer判断の本文（evidence文）は持たない。判断の記録はsessionが正本である。
 */
export function finalReviewFindings(session) {
    const latest = new Map();
    for (const round of session.rounds)
        for (const finding of round.findings)
            latest.set(finding.id, Object.freeze({
                id: finding.id,
                severity: finding.severity,
                status: finding.status,
                relation: finding.relation,
                path: finding.path,
                contractId: finding.contractId,
            }));
    return Object.freeze([...latest.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
/** 最新roundのblocking。収束済みsessionでは空である。 */
export function unresolvedCriticalHighFindings(session) {
    return Object.freeze([...(session.rounds.at(-1)?.blocking ?? [])].sort());
}
/**
 * 収束済みsessionと観測値から証跡を組み立てる。**収束していない、blockerが残る、
 * reviewerとimplementerが同一、観測した合格検証が無い場合は生成しない。**
 * 検証欄は`selectObservedVerification`が機械記録から導出した値だけを受け取る。
 */
export function createReviewEvidence(input) {
    if (input.session.status !== "converged")
        throw new Error(`review sessionが収束していないため証跡を生成できません: status=${input.session.status}`);
    const unresolved = unresolvedCriticalHighFindings(input.session);
    if (unresolved.length > 0)
        throw new Error(`未解決Critical/Highが残るため証跡を生成できません: ${unresolved.join(", ")}`);
    return sealReviewEvidence({
        schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
        issue: input.issue,
        observed: {
            baseSha: input.baseSha,
            implementationHeadSha: input.implementationHeadSha,
            diffDigest: input.diffDigest,
            session: {
                sessionId: input.session.sessionId,
                latestRoundDigest: input.session.latestRoundDigest,
                status: "converged",
                countedRounds: countedRounds(input.session),
            },
            impact: {
                digest: input.impact.digest,
                mode: input.impact.mode,
            },
            verification: input.verification,
        },
        findings: finalReviewFindings(input.session),
        unresolvedCriticalHigh: unresolved,
        verdict: "approved",
        declared: {
            reviewer: input.reviewer,
            implementer: input.implementer,
            independenceMode: input.independenceMode,
            reviewerModifiedCandidate: false,
        },
    });
}
/**
 * 証跡を保存済みsessionと照合する。**fileの値をauthorityにせず、sessionから再導出した
 * 値との一致だけを受理する。** Git（比較基点・`H_impl`・diff・影響集合）と検証記録の
 * 照合はcallerが行う（`verifyReviewEvidenceWithStaging`）。
 */
export function validateReviewEvidenceAgainstSession(evidence, session, options = {}) {
    const errors = [];
    if (session === null)
        return ["review証跡を照合する永続review sessionがありません"];
    const observed = evidence.observed;
    if (session.status !== "converged")
        errors.push(`review sessionが収束していません: status=${session.status}`);
    if (observed.session.sessionId !== session.sessionId)
        errors.push("review証跡のsessionIdが保存済みsessionと一致しません");
    if (observed.session.latestRoundDigest !== session.latestRoundDigest)
        errors.push("review証跡のlatestRoundDigestが保存済みsessionの最新roundと一致しません");
    if (observed.session.countedRounds !== countedRounds(session))
        errors.push("review証跡のcountedRoundsが保存済みsessionと一致しません");
    if (stableJson(evidence.findings) !== stableJson(finalReviewFindings(session)))
        errors.push("review証跡のfindingsが保存済みsessionのfinding最終状態と一致しません");
    if (stableJson(evidence.unresolvedCriticalHigh) !==
        stableJson(unresolvedCriticalHighFindings(session)))
        errors.push("review証跡の未解決Critical/Highが保存済みsessionと一致しません");
    if (options.independenceMode !== undefined &&
        evidence.declared.independenceMode !== options.independenceMode)
        errors.push(`review証跡の独立性モード${evidence.declared.independenceMode}がtrusted policyの${options.independenceMode}と一致しません`);
    if (options.requireSessionHead === true &&
        observed.implementationHeadSha !== session.latestCandidateHeadSha)
        errors.push("review証跡のimplementationHeadShaが保存済みsessionのcandidate HEADと一致しません");
    return errors;
}
/**
 * 再固定で変わってよいfieldを除いた比較用の値。
 *
 * - `rebase`: 比較基点・`H_impl`と、それに束縛される値（影響集合、各検証記録の
 *   headSha・impactDigest・finishedAt・recordDigest）だけが変わってよい。
 *   **検証したcommandとscopeの集合は一致を要求する。** diff digest（内容のdigest）・
 *   session・finding・申告も一致を要求する
 * - `supersession`: 追加の検証記録（`observed.verification`）だけが変わってよい
 * - `exact`: 何も変わってはならない（path是正）
 */
export function comparableReviewEvidence(evidence, kind) {
    const ordered = orderedEvidence(evidence);
    const { evidenceDigest: _digest, ...body } = ordered;
    void _digest;
    const observed = { ...ordered.observed };
    if (kind === "rebase") {
        delete observed.baseSha;
        delete observed.implementationHeadSha;
        delete observed.impact;
        observed.verification = ordered.observed.verification
            .map(({ command, scope }) => stableJson({ command, scope }))
            .sort();
    }
    if (kind === "supersession")
        delete observed.verification;
    return stableJson({ ...body, observed });
}
//# sourceMappingURL=review-evidence.js.map