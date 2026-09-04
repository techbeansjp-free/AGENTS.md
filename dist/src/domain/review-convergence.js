import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
/**
 * 通常のreviewラウンド予算。round 1で全scopeを見て、2と3で未解決blockerを追う。
 */
export const REVIEW_ROUND_BUDGET = 3;
/**
 * 収束後にHEADが動いたときの取り直しへ、予算とは別枠で1 roundだけ許す上限。
 *
 * **外部reviewerが何回reviewするかを利用側は制御できない。** 3 roundで収束した後に
 * 指摘が届いてHEADが進むと、`round > REVIEW_ROUND_BUDGET`だけを見る実装では
 * 是正を記録する経路が1つも残らない（Issue #1140）。
 *
 * **増分は収束後の取り直しに限る。** 未解決blockerを抱えたまま予算を使い切った
 * `budget-exhausted`からは開かない。開くと、任意の1 pushで新品の予算をもらえる。
 */
export const REVIEW_RECOVERY_ROUND = REVIEW_ROUND_BUDGET + 1;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const STABLE_ID = /^[A-Z][A-Z0-9._-]{1,127}$/u;
const SEVERITIES = ["Critical", "High", "Medium", "Low"];
const STATUSES = ["valid", "resolved", "duplicate", "false-positive"];
const SOURCES = ["review", "consultation", "audit"];
const RELATIONS = [
    "acceptance-violation",
    "invariant-violation",
    "fix-regression",
    "improvement",
    "out-of-scope",
];
function exactObject(value, label, fields) {
    if (!isRecord(value))
        throw new Error(`${label}はobjectが必要です`);
    const unknown = Object.keys(value).filter((field) => !fields.includes(field));
    const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
    if (unknown.length > 0)
        throw new Error(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
    if (missing.length > 0)
        throw new Error(`${label}の必須fieldがありません: ${missing.join(", ")}`);
    return value;
}
function stableStrings(value, label) {
    if (!Array.isArray(value) ||
        value.some((item) => typeof item !== "string" ||
            item.trim() === "" ||
            item.normalize("NFC") !== item))
        throw new Error(`${label}は正規化済みの空でない文字列配列が必要です`);
    const values = value;
    if (new Set(values).size !== values.length ||
        stableJson(values) !== stableJson([...values].sort()))
        throw new Error(`${label}は重複なしの昇順でなければなりません`);
    return Object.freeze([...values]);
}
function requiredStableId(value, label) {
    if (typeof value !== "string" || !STABLE_ID.test(value))
        throw new Error(`${label}は安定IDが必要です`);
    return value;
}
function requiredText(value, label) {
    if (typeof value !== "string" ||
        value.trim() === "" ||
        value.normalize("NFC") !== value ||
        Buffer.byteLength(value, "utf8") > 4096)
        throw new Error(`${label}は正規化済みの空でない文字列が必要です`);
    return value;
}
function safePath(value, label) {
    const path = requiredText(value, label);
    if (path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part) => part === "" || part === "." || part === ".."))
        throw new Error(`${label}はrepository相対pathが必要です`);
    return path;
}
function oneOf(value, values, label) {
    if (typeof value !== "string" || !values.includes(value))
        throw new Error(`${label}が不正です`);
    return value;
}
function parseAnchor(value) {
    const anchor = exactObject(value, "review anchor", [
        "scopeIds",
        "acceptanceCriteriaIds",
        "invariantIds",
        "diffBaseSha",
        "initialHeadSha",
        "initialDiffDigest",
    ]);
    const scopeIds = stableStrings(anchor.scopeIds, "review anchor.scopeIds");
    const acceptanceCriteriaIds = stableStrings(anchor.acceptanceCriteriaIds, "review anchor.acceptanceCriteriaIds");
    const invariantIds = stableStrings(anchor.invariantIds, "review anchor.invariantIds");
    if (scopeIds.length === 0 || acceptanceCriteriaIds.length === 0)
        throw new Error("review anchorにはscopeとAcceptance Criteriaが必要です");
    if (!OID.test(String(anchor.diffBaseSha ?? "")))
        throw new Error("review anchor.diffBaseShaが不正です");
    if (!OID.test(String(anchor.initialHeadSha ?? "")))
        throw new Error("review anchor.initialHeadShaが不正です");
    if (!SHA256.test(String(anchor.initialDiffDigest ?? "")))
        throw new Error("review anchor.initialDiffDigestが不正です");
    return Object.freeze({
        scopeIds,
        acceptanceCriteriaIds,
        invariantIds,
        diffBaseSha: String(anchor.diffBaseSha),
        initialHeadSha: String(anchor.initialHeadSha),
        initialDiffDigest: String(anchor.initialDiffDigest),
    });
}
function parseFocus(value) {
    const focus = exactObject(value, "review round.focus", [
        "previousBlocking",
        "fixedDiff",
        "adjacentScope",
    ]);
    if (!Array.isArray(focus.adjacentScope))
        throw new Error("review round.focus.adjacentScopeは配列が必要です");
    const adjacentScope = focus.adjacentScope.map((candidate, index) => {
        const adjacent = exactObject(candidate, `review round.focus.adjacentScope[${index}]`, ["path", "graphEvidence"]);
        return Object.freeze({
            path: safePath(adjacent.path, `review round.focus.adjacentScope[${index}].path`),
            graphEvidence: (() => {
                const evidence = requiredText(adjacent.graphEvidence, `review round.focus.adjacentScope[${index}].graphEvidence`);
                if (!SHA256.test(evidence))
                    throw new Error(`review round.focus.adjacentScope[${index}].graphEvidenceはGraph Evidence digestが必要です`);
                return evidence;
            })(),
        });
    });
    const adjacentPaths = adjacentScope.map(({ path }) => path);
    if (new Set(adjacentPaths).size !== adjacentPaths.length)
        throw new Error("review round.focus.adjacentScopeのpathが重複しています");
    return Object.freeze({
        previousBlocking: stableStrings(focus.previousBlocking, "review round.focus.previousBlocking"),
        fixedDiff: stableStrings(focus.fixedDiff, "review round.focus.fixedDiff"),
        adjacentScope: Object.freeze(adjacentScope),
    });
}
function parseFinding(value, index) {
    const label = `review round.findings[${index}]`;
    const finding = exactObject(value, label, [
        "id",
        "severity",
        "status",
        "source",
        "relation",
        "evidence",
        "path",
        "contractId",
        "causedByFindingId",
    ]);
    const nullableId = (candidate, field) => {
        if (candidate === null)
            return null;
        return requiredStableId(candidate, `${label}.${field}`);
    };
    return Object.freeze({
        id: requiredStableId(finding.id, `${label}.id`),
        severity: oneOf(finding.severity, SEVERITIES, `${label}.severity`),
        status: oneOf(finding.status, STATUSES, `${label}.status`),
        source: oneOf(finding.source, SOURCES, `${label}.source`),
        relation: oneOf(finding.relation, RELATIONS, `${label}.relation`),
        evidence: requiredText(finding.evidence, `${label}.evidence`),
        path: safePath(finding.path, `${label}.path`),
        contractId: nullableId(finding.contractId, "contractId"),
        causedByFindingId: nullableId(finding.causedByFindingId, "causedByFindingId"),
    });
}
export function parseReviewRoundInput(value) {
    const round = exactObject(value, "review round", [
        "round",
        "previousRoundDigest",
        "anchor",
        "candidateHeadSha",
        "focus",
        "findings",
    ]);
    if (!Number.isInteger(round.round) || Number(round.round) < 1)
        throw new Error("review round.roundは1以上の整数が必要です");
    if (round.previousRoundDigest !== null &&
        !SHA256.test(String(round.previousRoundDigest ?? "")))
        throw new Error("review round.previousRoundDigestが不正です");
    if (!OID.test(String(round.candidateHeadSha ?? "")))
        throw new Error("review round.candidateHeadShaが不正です");
    if (!Array.isArray(round.findings) || round.findings.length > 256)
        throw new Error("review round.findingsは256件以下の配列が必要です");
    const findings = round.findings.map(parseFinding);
    if (new Set(findings.map(({ id }) => id)).size !== findings.length)
        throw new Error("review round.findingsのIDが重複しています");
    return Object.freeze({
        round: Number(round.round),
        previousRoundDigest: round.previousRoundDigest === null
            ? null
            : String(round.previousRoundDigest),
        anchor: parseAnchor(round.anchor),
        candidateHeadSha: String(round.candidateHeadSha),
        focus: parseFocus(round.focus),
        findings: Object.freeze(findings),
    });
}
export function reviewSessionId(anchor) {
    return crypto.createHash("sha256").update(stableJson(anchor)).digest("hex");
}
function sameStrings(left, right) {
    return stableJson(left) === stableJson(right);
}
function findingAdmission(input) {
    const { finding, round, anchor, focus, priorBlocking } = input;
    if (finding.status !== "valid")
        return {
            admission: "record-only",
            admissionReason: "resolvedまたは非有効findingは履歴だけに保持する",
        };
    if (finding.severity !== "Critical" && finding.severity !== "High")
        return {
            admission: "record-only",
            admissionReason: "Medium/Lowはcurrent scopeを拡大せず記録だけにする",
        };
    if (finding.relation === "improvement" || finding.relation === "out-of-scope")
        return {
            admission: "record-only",
            admissionReason: "改善提案または範囲外findingはfollow-upとして記録する",
        };
    const existingBlocker = priorBlocking.has(finding.id);
    if (round >= 2 && existingBlocker)
        return {
            admission: "block-current",
            admissionReason: "前roundの未解決blockerを同じsessionで追跡する",
        };
    const inFixedDiff = focus.fixedDiff.includes(finding.path);
    if (round >= 2 && !inFixedDiff)
        return {
            admission: "record-only",
            admissionReason: focus.adjacentScope.some(({ path }) => path === finding.path)
                ? "Graph Evidenceの実照合が未導入なので隣接範囲はcurrent blockerへ昇格しない"
                : "実Gitの修正差分外なのでcurrent scopeへ追加しない",
        };
    if (finding.relation === "acceptance-violation") {
        if (finding.contractId !== null &&
            anchor.acceptanceCriteriaIds.includes(finding.contractId))
            return {
                admission: "block-current",
                admissionReason: "固定済みAcceptance Criteriaへの違反を再現した",
            };
        return {
            admission: "record-only",
            admissionReason: "固定済みAcceptance Criteriaへ結び付かない",
        };
    }
    if (finding.relation === "invariant-violation") {
        if (finding.contractId !== null &&
            anchor.invariantIds.includes(finding.contractId))
            return {
                admission: "block-current",
                admissionReason: "固定済みdomain invariantへの違反を再現した",
            };
        return {
            admission: "record-only",
            admissionReason: "固定済みdomain invariantへ結び付かない",
        };
    }
    if (finding.relation === "fix-regression" &&
        finding.causedByFindingId !== null &&
        priorBlocking.has(finding.causedByFindingId) &&
        inFixedDiff)
        return {
            admission: "block-current",
            admissionReason: "前round blockerの修正差分がCritical/High回帰を導入した",
        };
    return {
        admission: "record-only",
        admissionReason: "修正起因を前round blockerと固定修正差分へ立証できない",
    };
}
export function advanceReviewSession(previous, round) {
    const sessionId = reviewSessionId(round.anchor);
    const expectedRound = previous === null ? 1 : previous.rounds.length + 1;
    if (round.round !== expectedRound)
        throw new Error(`review round resetまたは飛び越しを拒否しました: expected=${expectedRound} actual=${round.round}`);
    if (round.round > REVIEW_RECOVERY_ROUND)
        throw new Error(`同一review sessionは${REVIEW_RECOVERY_ROUND} roundを超えて自動拡大できません`);
    if (previous === null) {
        if (round.previousRoundDigest !== null)
            throw new Error("round 1にpreviousRoundDigestを指定できません");
        if (round.candidateHeadSha !== round.anchor.initialHeadSha ||
            round.focus.previousBlocking.length > 0 ||
            round.focus.fixedDiff.length > 0 ||
            round.focus.adjacentScope.length > 0)
            throw new Error("round 1は固定initial HEADの全scope reviewで開始します");
    }
    else {
        /**
         * **取り直しの1 roundが収束後だけに開くことは、この1行が担っている。**
         *
         * `REVIEW_ROUND_BUDGET`到達後の非収束状態は`budget-exhausted`しか取り得ない
         * （status導出を参照）。したがって`round === REVIEW_RECOVERY_ROUND`かつ
         * `status !== "converged"`を別に判定しても到達しない。**到達しない条件を置くと、
         * それを外す変異が生存する死んだ分岐になる。** status導出の`>=`が
         * この含意を保証しており、`SCN-UNIT-REVIEWCONV-007`が固定する。
         */
        if (previous.status === "budget-exhausted")
            throw new Error("budget終了済みreview sessionは更新できません");
        if (previous.sessionId !== sessionId)
            throw new Error("review sessionのscope・AC・invariant・diff anchor変更を拒否しました");
        if (round.previousRoundDigest !== previous.latestRoundDigest)
            throw new Error("review roundのprevious digestが保存済みlatest roundと一致しません");
        if (previous.status === "converged" &&
            (round.candidateHeadSha === previous.latestCandidateHeadSha ||
                round.focus.fixedDiff.length === 0))
            throw new Error("収束後の追加reviewは前roundと異なるcandidate HEADと空でない実Git fixedDiffが必要です");
        const prior = previous.rounds.at(-1)?.blocking ?? [];
        if (!sameStrings(round.focus.previousBlocking, [...prior].sort()))
            throw new Error("前round blockerをfocusから脱落または追加できません");
    }
    const priorBlocking = new Set(previous?.rounds.at(-1)?.blocking ?? []);
    const admittedFindings = round.findings.map((finding) => Object.freeze({
        ...finding,
        ...findingAdmission({
            finding,
            round: round.round,
            anchor: round.anchor,
            focus: round.focus,
            priorBlocking,
        }),
    }));
    if (round.round >= 2) {
        const reportedPrior = new Set(admittedFindings
            .filter(({ id }) => priorBlocking.has(id))
            .map(({ id }) => id));
        if ([...priorBlocking].some((id) => !reportedPrior.has(id)))
            throw new Error("前round blockerの再評価結果をfindingから脱落できません");
    }
    const blocking = admittedFindings
        .filter(({ admission }) => admission === "block-current")
        .map(({ id }) => id)
        .sort();
    const recordOnly = admittedFindings
        .filter(({ admission }) => admission === "record-only")
        .map(({ id }) => id)
        .sort();
    const roundWithoutDigest = {
        round: round.round,
        previousRoundDigest: round.previousRoundDigest,
        candidateHeadSha: round.candidateHeadSha,
        focus: round.focus,
        findings: admittedFindings,
        blocking,
        recordOnly,
    };
    const roundDigest = crypto
        .createHash("sha256")
        .update(stableJson(roundWithoutDigest))
        .digest("hex");
    const record = Object.freeze({ ...roundWithoutDigest, roundDigest });
    const rounds = Object.freeze([...(previous?.rounds ?? []), record]);
    return Object.freeze({
        schemaVersion: "agent-skill-chain/review-session/v1",
        sessionId,
        anchor: round.anchor,
        rounds,
        latestRoundDigest: roundDigest,
        latestCandidateHeadSha: round.candidateHeadSha,
        /**
         * **取り直しのroundで未解決が残ればそこで終端にする。** `round === 3`だけを
         * 見ると`REVIEW_RECOVERY_ROUND`が`active`になり、上限を超えた次roundを
         * 要求できる状態が残る。
         */
        status: blocking.length === 0
            ? "converged"
            : round.round >= REVIEW_ROUND_BUDGET
                ? "budget-exhausted"
                : "active",
    });
}
/**
 * 保存済みstateは各roundを先頭から再評価して検証する。保存側のadmissionやdigestを
 * authorityにせず、同じdomain policyから再導出するため改竄でblockerを脱落できない。
 */
export function parseReviewSessionState(value) {
    const state = exactObject(value, "review session", [
        "schemaVersion",
        "sessionId",
        "anchor",
        "rounds",
        "latestRoundDigest",
        "latestCandidateHeadSha",
        "status",
    ]);
    if (state.schemaVersion !== "agent-skill-chain/review-session/v1")
        throw new Error("review session.schemaVersionが不正です");
    if (!Array.isArray(state.rounds) ||
        state.rounds.length < 1 ||
        state.rounds.length > REVIEW_RECOVERY_ROUND)
        throw new Error(`review session.roundsは1〜${REVIEW_RECOVERY_ROUND}件が必要です`);
    let rebuilt = null;
    for (const [index, candidate] of state.rounds.entries()) {
        const record = exactObject(candidate, `review session.rounds[${index}]`, [
            "round",
            "previousRoundDigest",
            "candidateHeadSha",
            "focus",
            "findings",
            "blocking",
            "recordOnly",
            "roundDigest",
        ]);
        if (!Array.isArray(record.findings))
            throw new Error(`review session.rounds[${index}].findingsは配列が必要です`);
        const findings = record.findings.map((finding, findingIndex) => {
            const admitted = exactObject(finding, `review session.rounds[${index}].findings[${findingIndex}]`, [
                "id",
                "severity",
                "status",
                "source",
                "relation",
                "evidence",
                "path",
                "contractId",
                "causedByFindingId",
                "admission",
                "admissionReason",
            ]);
            return Object.fromEntries(Object.entries(admitted).filter(([field]) => field !== "admission" && field !== "admissionReason"));
        });
        const round = parseReviewRoundInput({
            round: record.round,
            previousRoundDigest: record.previousRoundDigest,
            anchor: state.anchor,
            candidateHeadSha: record.candidateHeadSha,
            focus: record.focus,
            findings,
        });
        rebuilt = advanceReviewSession(rebuilt, round);
        const rebuiltRecord = rebuilt.rounds.at(-1);
        if (!rebuiltRecord || stableJson(rebuiltRecord) !== stableJson(candidate))
            throw new Error(`review session round ${index + 1}のadmissionまたはdigestが不正です`);
    }
    if (rebuilt === null || stableJson(rebuilt) !== stableJson(value))
        throw new Error("review sessionのanchor、latestまたはstatusが再導出値と一致しません");
    return rebuilt;
}
//# sourceMappingURL=review-convergence.js.map