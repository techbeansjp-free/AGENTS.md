import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import { acceptedValues, childFields, field, nestedFields, unknownAndMissingError, } from "./input-contract.js";
import { PROGRESS_INVENTORY_FIELDS, parseReviewProgressInventory, } from "./review-progress.js";
/**
 * 1 sessionに記録できるroundの総数（数えないroundを含む）。記録番号はround番号と
 * 同じなので、65 round目は記録できない。
 *
 * 数えるround数の上限は廃止した（Issue #1503）。round数を分離・停止の理由にせず、
 * 発散はadmission規則が抑え、兆候は`reviewDivergence`がwarningとして報告する。
 */
export const REVIEW_ROUND_RECORD_LIMIT = 64;
/** 同じfindingがこの回数以上blockerとして残ったら発散の兆候として報告する。 */
export const REVIEW_DIVERGENCE_RECURRENCE = 3;
/**
 * 修正回帰の連鎖（`causedByFindingId`の辿り）がこの段数以上ならwarningを返す（Issue #1517 AMD-002）。
 * 2段は「是正が生んだ回帰を是正したら、また回帰が出た」状態であり、同じ機構へ条件を足し続ける
 * 増殖loopの兆候である。
 */
export const REVIEW_FIX_REGRESSION_CHAIN = 2;
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
/** 非収束の原因と、ownerが受容する対象を混同させない診断を返す。 */
export function unconvergedReviewSessionDiagnostic(session) {
    if (typeof session !== "string") {
        const pending = pendingReviewFindingIds(session);
        if (pending.length > 0)
            return `review sessionが実効収束していません。旧policyの固定契約違反が再評価待ちです: ${pending.join(", ")}。保存status=${session.status}とdigestは保持し、review round --initで全pendingを明示分類してください。同HEADの再評価を許可します`;
    }
    const status = typeof session === "string" ? session : session.status;
    return `review sessionが収束していません: status=${status}。reviewが未完了か、実際に検分したHEADとcandidateHeadShaの対応が誤っている可能性があります。ownerのrisk受容へ進まず、review-session.jsonのroundごとのcandidateHeadShaを実際のレビュー順と突き合わせてください`;
}
/**
 * findingの`causedByFindingId`を辿った連鎖（根から末端の順）。IDごとに最新の記録を採り、
 * `null`への訂正で連鎖を切る。循環は起点によらず1件として返す。
 */
function fixRegressionChains(findings) {
    const causedBy = new Map();
    /**
     * 最新の記録で判定する。原因の`null`訂正と、回帰ではなかったという判定
     * （`false-positive`・`duplicate`。是正済みの`resolved`は履歴として残す）は連鎖を切る。
     */
    for (const finding of findings)
        if (finding.causedByFindingId === null ||
            finding.status === "false-positive" ||
            finding.status === "duplicate")
            causedBy.delete(finding.id);
        else
            causedBy.set(finding.id, finding.causedByFindingId);
    const chains = new Map();
    for (const id of causedBy.keys()) {
        const chain = [id];
        const seen = new Set(chain);
        let cursor = causedBy.get(id);
        while (cursor !== undefined && !seen.has(cursor)) {
            chain.unshift(cursor);
            seen.add(cursor);
            cursor = causedBy.get(cursor);
        }
        const key = cursor !== undefined ? [...chain].sort().join("\0") : chain.join("\0");
        if (!chains.has(key))
            chains.set(key, chain);
    }
    return [...chains.values()];
}
/**
 * 発散の兆候を保存済みroundから導出する。**判定・記録・merge可否を変えない。**
 * sessionへは保存しない（digest chainと旧sessionの読取りを変えないため）。
 */
export function reviewDivergence(state) {
    const counted = state.rounds.filter((record) => !record.followOnly && !record.recordLayerOnly);
    const recurrence = new Map();
    for (const record of counted)
        for (const id of record.blocking)
            recurrence.set(id, (recurrence.get(id) ?? 0) + 1);
    const maxFindingRecurrence = Math.max(0, ...recurrence.values());
    const latest = counted.at(-1);
    const previous = counted.at(-2);
    const earlierIds = new Set(counted
        .slice(0, -1)
        .flatMap((record) => record.findings.map(({ id }) => id)));
    const priorBlocking = new Set(previous?.blocking ?? []);
    const newBlockers = latest?.blocking.filter((id) => !priorBlocking.has(id)) ?? [];
    const newBlockerRate = latest && latest.blocking.length > 0
        ? newBlockers.length / latest.blocking.length
        : 0;
    const repeatedFindingRate = latest && latest.findings.length > 0
        ? latest.findings.filter(({ id }) => earlierIds.has(id)).length /
            latest.findings.length
        : 0;
    const warnings = [];
    const recurring = [...recurrence]
        .filter(([, count]) => count >= REVIEW_DIVERGENCE_RECURRENCE)
        .map(([id]) => id)
        .sort();
    if (recurring.length > 0)
        warnings.push(`同じfindingが${REVIEW_DIVERGENCE_RECURRENCE} round以上blockerとして残っています: ${recurring.join(", ")}`);
    if (previous && newBlockers.length > 0)
        warnings.push(`直前roundに無かったblockerが新たに出ています: ${[...newBlockers].sort().join(", ")}`);
    const chains = fixRegressionChains(counted.flatMap(({ findings }) => findings));
    const fixRegressionDepth = Math.max(0, ...chains.map((chain) => chain.length - 1));
    const longest = chains
        .filter((chain) => chain.length - 1 >= REVIEW_FIX_REGRESSION_CHAIN)
        .filter((chain) => !chains.some((other) => other.length > chain.length &&
        other.slice(0, chain.length).join("\0") === chain.join("\0")))
        .map((chain) => chain.join(" → "))
        .sort();
    if (longest.length > 0)
        warnings.push(`修正回帰が${REVIEW_FIX_REGRESSION_CHAIN}段以上連鎖しています: ${longest.join(", ")}。同じ機構へ条件を足して塞がず、判定をその機構に依存させない縮小案（許可list化、入力全体の走査、fail-closed、機能の撤回）を先に評価してください`);
    return {
        countedRounds: counted.length,
        maxFindingRecurrence,
        newBlockerRate,
        repeatedFindingRate,
        fixedPathCount: latest?.focus.fixedDiff.length ?? 0,
        fixRegressionDepth,
        warnings,
    };
}
/** `optionalFields`は必須にはせず、未知fieldとしても拒否しない。 */
function exactObject(value, label, fields, optionalFields = []) {
    if (!isRecord(value))
        throw new Error(`${label}はobjectが必要です`);
    const unknown = Object.keys(value).filter((name) => !fields.includes(name) && !optionalFields.includes(name));
    const missing = fields.filter((name) => !Object.prototype.hasOwnProperty.call(value, name));
    const error = unknownAndMissingError(label, unknown, missing);
    if (error)
        throw new Error(error);
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
        throw new Error(`${label}が不正です${acceptedValues(values)}`);
    return value;
}
function parseAnchor(value) {
    if (!isRecord(value))
        throw new Error("review anchorはobjectが必要です");
    const { required, optional } = childFields(REVIEW_ROUND_INPUT_FIELDS, "anchor");
    const unknown = Object.keys(value).filter((name) => !required.includes(name) && !optional.includes(name));
    const missing = required.filter((name) => !(name in value));
    const error = unknownAndMissingError("review anchor", unknown, missing);
    if (error)
        throw new Error(error);
    const anchor = value;
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
        ...(anchor.progressInventory === undefined
            ? {}
            : {
                progressInventory: parseReviewProgressInventory(anchor.progressInventory),
            }),
    });
}
function parseFocus(value) {
    const { required, optional } = childFields(REVIEW_ROUND_INPUT_FIELDS, "focus");
    const focus = exactObject(value, "review round.focus", required, optional);
    if (focus.adjacentScopeUnbounded !== undefined &&
        focus.adjacentScopeUnbounded !== true)
        throw new Error("review round.focus.adjacentScopeUnboundedはtrueだけを指定できます（限定済みはfieldを省略する）");
    if (focus.adjacentScopeUnbounded === true &&
        Array.isArray(focus.adjacentScope) &&
        focus.adjacentScope.length > 0)
        throw new Error("review round.focus.adjacentScopeUnboundedとadjacentScopeは同時に指定できません");
    if (!Array.isArray(focus.adjacentScope))
        throw new Error("review round.focus.adjacentScopeは配列が必要です");
    const adjacentScope = focus.adjacentScope.map((candidate, index) => {
        const adjacent = exactObject(candidate, `review round.focus.adjacentScope[${index}]`, childFields(REVIEW_ROUND_INPUT_FIELDS, "focus.adjacentScope[]").required);
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
        ...(focus.adjacentScopeUnbounded === true
            ? { adjacentScopeUnbounded: true }
            : {}),
    });
}
/**
 * **`decisionRef`はoptional field（PR #1497独立review round 4指摘）。**
 * `decisionRef`導入前（Issue #1485より前）に記録されたfindingにはfield自体が
 * 無く、必須fieldのまま受理すると`review-session.json`のschemaVersionを
 * 変えずに既存のstored round・legacy findingを拒否する後方互換break になる。
 * `exactObject`のoptionalFieldsへ移し、値の有無を`hasOwnProperty`で区別する。
 *
 * **`undefined`と`null`をdigestへ同じ寄与にしない。** `stableJson`は
 * `Object.entries`で列挙するため、fieldを`decisionRef: undefined`として
 * 持たせると`JSON.stringify(undefined) ?? "null"`経由で`null`と同一の
 * 直列化になり、legacy findingの`roundDigest`が`decisionRef`導入後に
 * 変わってしまう（保存済みroundとの再検証が食い違う）。fieldが無かった
 * findingはこの関数の戻り値でも`decisionRef`キー自体を持たせない
 * （spread条件分岐）ことで、導入前と同じ直列化を保つ。
 */
/**
 * findingの診断labelへ添字とIDを添える。IDは安定ID形式を満たす場合だけ使い、
 * 満たさない入力値は診断へ複写しない。
 */
function findingLabel(value, index) {
    const base = `review round.findings[${index}]`;
    const id = isRecord(value) ? value.id : undefined;
    return typeof id === "string" && STABLE_ID.test(id)
        ? `${base}（id=${id}）`
        : base;
}
function parseFinding(value, index) {
    const label = findingLabel(value, index);
    const { required, optional } = childFields(REVIEW_ROUND_INPUT_FIELDS, "findings[]");
    const finding = exactObject(value, label, required, optional);
    const nullableId = (candidate, field) => {
        if (candidate === null)
            return null;
        return requiredStableId(candidate, `${label}.${field}`);
    };
    const hasDecisionRef = Object.prototype.hasOwnProperty.call(finding, "decisionRef");
    const decisionRef = finding.decisionRef;
    if (hasDecisionRef &&
        decisionRef !== null &&
        !/^DR-[0-9a-f]{1,64}$/u.test(String(decisionRef)))
        throw new Error(`${label}.decisionRefはnullまたは"DR-"接頭辞のIDが必要です`);
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
        ...(hasDecisionRef
            ? { decisionRef: decisionRef === null ? null : String(decisionRef) }
            : {}),
    });
}
/** `review round --file`の項目定義。`--help`と検証が共有する。 */
export const REVIEW_ROUND_INPUT_FIELDS = Object.freeze([
    field("round", "integer（1以上）"),
    field("previousRoundDigest", "sha256 | null"),
    field("anchor", "object"),
    field("anchor.scopeIds", "string[]（空でないNFC正規化済み文字列、重複なし昇順、1件以上）"),
    field("anchor.acceptanceCriteriaIds", "string[]（空でないNFC正規化済み文字列、重複なし昇順、1件以上）"),
    field("anchor.invariantIds", "string[]（空でないNFC正規化済み文字列、重複なし昇順）"),
    field("anchor.diffBaseSha", "commit SHA"),
    field("anchor.initialHeadSha", "commit SHA"),
    field("anchor.initialDiffDigest", "sha256"),
    field("anchor.progressInventory", "object", { required: false }),
    ...nestedFields("anchor.progressInventory", PROGRESS_INVENTORY_FIELDS),
    field("candidateHeadSha", "commit SHA"),
    field("focus", "object"),
    field("focus.previousBlocking", "string[]（空でないNFC正規化済み文字列、重複なし昇順）"),
    field("focus.fixedDiff", "string[]（空でないNFC正規化済み文字列、重複なし昇順）"),
    field("focus.adjacentScope", "object[]"),
    field("focus.adjacentScope[].path", "repository相対path"),
    field("focus.adjacentScope[].graphEvidence", "sha256"),
    field("focus.adjacentScopeUnbounded", "true", { required: false }),
    field("findings", "object[]（256件以下）"),
    field("findings[].id", "stableId"),
    field("findings[].severity", "string", { values: SEVERITIES }),
    field("findings[].status", "string", { values: STATUSES }),
    field("findings[].source", "string", { values: SOURCES }),
    field("findings[].relation", "string", { values: RELATIONS }),
    field("findings[].evidence", "string"),
    field("findings[].path", "repository相対path"),
    field("findings[].contractId", "stableId | null"),
    field("findings[].causedByFindingId", "stableId | null"),
    field("findings[].decisionRef", "DR-ID | null", { required: false }),
    field("followOnly", "true", { required: false }),
    field("recordLayerOnly", "true", { required: false }),
]);
export function parseReviewRoundInput(value) {
    const { required, optional } = childFields(REVIEW_ROUND_INPUT_FIELDS, "");
    const round = exactObject(value, "review round", required, optional);
    if (round.followOnly !== undefined && round.followOnly !== true)
        throw new Error("review round.followOnlyはtrueだけを受理します");
    if (round.recordLayerOnly !== undefined && round.recordLayerOnly !== true)
        throw new Error("review round.recordLayerOnlyはtrueだけを受理します");
    if (round.followOnly === true && round.recordLayerOnly === true)
        throw new Error("followOnlyとrecordLayerOnlyは併用できません");
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
        ...(round.followOnly === true ? { followOnly: true } : {}),
        ...(round.recordLayerOnly === true
            ? { recordLayerOnly: true }
            : {}),
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
    if (finding.severity !== "Critical" &&
        finding.severity !== "High" &&
        (input.policyVersion === 1 || !isFixedContractFinding(finding, anchor)))
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
    /**
     * **隣接範囲はGitから再導出済みの影響集合である**（REQ-WF-039）。
     * `previewReviewRound`が記録前に`adjacentScope`を実Gitの影響集合と照合し、
     * 不一致を拒否する。したがってここへ届く隣接pathは申告ではなく観測であり、
     * 修正差分と同じくcurrent scopeへ含める。
     */
    /**
     * **影響集合を証明できない（`adjacentScopeUnbounded`）ときは全pathを隣接範囲とする。**
     * 証明できないことでtargetedより狭いadmissionにしない（fail-closed）。
     */
    const inAdjacentScope = round >= 2 &&
        !inFixedDiff &&
        (focus.adjacentScopeUnbounded === true ||
            focus.adjacentScope.some(({ path }) => path === finding.path));
    if (round >= 2 && !inFixedDiff && !inAdjacentScope)
        return {
            admission: "record-only",
            admissionReason: "実Gitの修正差分外なのでcurrent scopeへ追加しない",
        };
    if (finding.relation === "acceptance-violation") {
        if (finding.contractId !== null &&
            anchor.acceptanceCriteriaIds.includes(finding.contractId))
            return {
                admission: "block-current",
                admissionReason: inAdjacentScope
                    ? "影響集合の隣接範囲で固定済みAcceptance Criteriaへの違反を再現した"
                    : "固定済みAcceptance Criteriaへの違反を再現した",
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
                admissionReason: inAdjacentScope
                    ? "影響集合の隣接範囲で固定済みdomain invariantへの違反を再現した"
                    : "固定済みdomain invariantへの違反を再現した",
            };
        return {
            admission: "record-only",
            admissionReason: "固定済みdomain invariantへ結び付かない",
        };
    }
    if (finding.relation === "fix-regression" &&
        finding.causedByFindingId !== null &&
        priorBlocking.has(finding.causedByFindingId) &&
        (inFixedDiff || inAdjacentScope))
        return {
            admission: "block-current",
            admissionReason: inAdjacentScope
                ? "前round blockerの修正差分が影響集合の隣接範囲へCritical/High回帰を導入した"
                : "前round blockerの修正差分がCritical/High回帰を導入した",
        };
    return {
        admission: "record-only",
        admissionReason: "修正起因を前round blockerと固定修正差分へ立証できない",
    };
}
function isFixedContractFinding(finding, anchor) {
    return (finding.contractId !== null &&
        ((finding.relation === "acceptance-violation" &&
            anchor.acceptanceCriteriaIds.includes(finding.contractId)) ||
            (finding.relation === "invariant-violation" &&
                anchor.invariantIds.includes(finding.contractId))));
}
/** IDごとの最後の観測を採る。空のfollow/record roundで過去findingを失わない。 */
export function latestReviewFindingObservations(state) {
    const latest = new Map();
    for (const round of state.rounds)
        for (const finding of round.findings)
            latest.set(finding.id, { finding, round });
    return [...latest.values()];
}
/** 旧policyがrecord-onlyとした未評価の固定契約違反だけを再評価待ちとする。 */
export function pendingReviewFindingIds(state) {
    // 保存値は変えず、現policyでのblocker継続を時系列に再生する。
    // 未観測IDは保持し、明示的な非blocking観測だけが継続を解除する。
    let blocking = new Set();
    for (const round of state.rounds) {
        const priorBlocking = blocking;
        blocking = new Set(priorBlocking);
        for (const finding of round.findings) {
            const { admission } = findingAdmission({
                finding,
                round: round.round,
                anchor: state.anchor,
                focus: round.focus,
                priorBlocking,
                policyVersion: 2,
            });
            if (admission === "block-current")
                blocking.add(finding.id);
            else
                blocking.delete(finding.id);
        }
    }
    return latestReviewFindingObservations(state)
        .filter(({ finding, round }) => round.admissionPolicyVersion === undefined &&
        finding.admission === "record-only" &&
        isFixedContractFinding(finding, state.anchor) &&
        blocking.has(finding.id))
        .map(({ finding }) => finding.id)
        .sort();
}
export function effectiveReviewBlocking(state) {
    return Object.freeze([
        ...new Set([
            ...(state.rounds.at(-1)?.blocking ?? []),
            ...pendingReviewFindingIds(state),
        ]),
    ].sort());
}
export function isReviewSessionConverged(state) {
    return (state.status === "converged" && effectiveReviewBlocking(state).length === 0);
}
/**
 * 数えるroundの件数。検証済みfollow/record layerだけは数えない（Issue #1287）。
 * 外部要因による追随は発散の指標にならない。
 */
export function countedRounds(state) {
    if (state === null)
        return 0;
    return state.rounds.filter((record) => !record.followOnly && !record.recordLayerOnly).length;
}
export function advanceReviewSession(previous, round) {
    return advanceReviewSessionWithPolicy(previous, round, 2);
}
/** Historical replay is private: callers cannot choose the legacy policy. */
function advanceReviewSessionWithPolicy(previous, round, policyVersion) {
    const pending = previous && policyVersion === 2 ? pendingReviewFindingIds(previous) : [];
    const priorIds = previous
        ? policyVersion === 2
            ? effectiveReviewBlocking(previous)
            : previous.rounds.at(-1).blocking
        : [];
    const sessionId = reviewSessionId(round.anchor);
    const expectedRound = previous === null ? 1 : previous.rounds.length + 1;
    if (round.round !== expectedRound)
        throw new Error(`review round resetまたは飛び越しを拒否しました: expected=${expectedRound} actual=${round.round}`);
    if (round.round > REVIEW_ROUND_RECORD_LIMIT)
        throw new Error(`同一review sessionへ${REVIEW_ROUND_RECORD_LIMIT}件を超えるroundを記録できません`);
    const nonCounting = round.followOnly || round.recordLayerOnly;
    if (nonCounting && pending.length > 0)
        throw new Error(`旧policyの固定契約違反の再評価が必要です。非消費roundでは解消できません: ${pending.join(", ")}`);
    if (round.followOnly && round.findings.length > 0)
        throw new Error("既定branch追随だけのroundへfindingを記録できません。指摘があるroundは数えるroundとして記録します");
    if (round.recordLayerOnly && round.findings.length > 0)
        throw new Error("record layerだけのroundへfindingを記録できません。指摘があるroundは数えるroundとして記録します");
    if (previous === null) {
        if (nonCounting)
            throw new Error("round 1を非消費roundとして記録できません");
        if (round.previousRoundDigest !== null)
            throw new Error("round 1にpreviousRoundDigestを指定できません");
        if (round.candidateHeadSha !== round.anchor.initialHeadSha ||
            round.focus.previousBlocking.length > 0 ||
            round.focus.fixedDiff.length > 0 ||
            round.focus.adjacentScope.length > 0 ||
            round.focus.adjacentScopeUnbounded === true)
            throw new Error("round 1は固定initial HEADの全scope reviewで開始します");
    }
    else {
        if (previous.sessionId !== sessionId)
            throw new Error("review sessionのscope・AC・invariant・diff anchor変更を拒否しました");
        if (round.previousRoundDigest !== previous.latestRoundDigest)
            throw new Error("review roundのprevious digestが保存済みlatest roundと一致しません");
        if (previous.status === "converged" &&
            pending.length === 0 &&
            (round.candidateHeadSha === previous.latestCandidateHeadSha ||
                round.focus.fixedDiff.length === 0))
            throw new Error("収束後の追加reviewは前roundと異なるcandidate HEADと空でない実Git fixedDiffが必要です");
        const prior = priorIds;
        if (!sameStrings(round.focus.previousBlocking, [...prior].sort()))
            throw new Error("前round blockerをfocusから脱落または追加できません");
    }
    const priorBlocking = new Set(priorIds);
    const admittedFindings = round.findings.map((finding) => Object.freeze({
        ...finding,
        ...findingAdmission({
            finding,
            round: round.round,
            anchor: round.anchor,
            focus: round.focus,
            priorBlocking,
            policyVersion,
        }),
    }));
    if (round.round >= 2 && !nonCounting) {
        const reportedPrior = new Set(admittedFindings
            .filter(({ id }) => priorBlocking.has(id))
            .map(({ id }) => id));
        if ([...priorBlocking].some((id) => !reportedPrior.has(id)))
            throw new Error("前round blockerの再評価結果をfindingから脱落できません");
    }
    /**
     * follow-only roundはreviewを行わないため、直前の未解決blockerを解消したことにも
     * できない。findingを要求すると「追随だけなのでfinding禁止」という契約と矛盾
     * するため、保存済みblockerをそのまま次recordへ運ぶ。
     */
    const blocking = nonCounting
        ? [...priorBlocking].sort()
        : admittedFindings
            .filter(({ admission }) => admission === "block-current")
            .map(({ id }) => id)
            .sort();
    const recordOnly = admittedFindings
        .filter(({ admission }) => admission === "record-only")
        .map(({ id }) => id)
        .sort();
    const roundWithoutDigest = {
        ...(policyVersion === 2 ? { admissionPolicyVersion: 2 } : {}),
        round: round.round,
        previousRoundDigest: round.previousRoundDigest,
        candidateHeadSha: round.candidateHeadSha,
        focus: round.focus,
        findings: admittedFindings,
        blocking,
        recordOnly,
        ...(round.followOnly ? { followOnly: true } : {}),
        ...(round.recordLayerOnly ? { recordLayerOnly: true } : {}),
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
        latestCandidateHeadSha: round.recordLayerOnly
            ? previous.latestCandidateHeadSha
            : round.candidateHeadSha,
        status: blocking.length === 0 ? "converged" : "active",
    });
}
/**
 * Issue #1503より前はround数の上限で`budget-exhausted`を保存していた。上限は廃止し、
 * 再導出では同じ内容が`active`になる。**旧statusは読取り時に無視する。**
 * それ以外のfieldは従来どおり再導出値とbyte一致を要求する。
 */
function withoutLegacyStatus(value) {
    if (isRecord(value) && value.status === "budget-exhausted")
        return { ...value, status: "active" };
    return value;
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
        state.rounds.length > REVIEW_ROUND_RECORD_LIMIT)
        throw new Error(`review session.roundsは1〜${REVIEW_ROUND_RECORD_LIMIT}件が必要です`);
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
        ], ["followOnly", "recordLayerOnly", "admissionPolicyVersion"]);
        if (record.admissionPolicyVersion !== undefined &&
            record.admissionPolicyVersion !== 2)
            throw new Error("review round.admissionPolicyVersionは2だけを受理します");
        if (record.admissionPolicyVersion === undefined &&
            rebuilt?.rounds.at(-1)?.admissionPolicyVersion === 2)
            throw new Error("review admission policyの旧版への逆戻りを拒否しました");
        if (record.followOnly !== undefined && record.followOnly !== true)
            throw new Error(`review session.rounds[${index}].followOnlyはtrueだけを受理します`);
        if (record.recordLayerOnly !== undefined && record.recordLayerOnly !== true)
            throw new Error(`review session.rounds[${index}].recordLayerOnlyはtrueだけを受理します`);
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
            ], ["decisionRef"]);
            return Object.fromEntries(Object.entries(admitted).filter(([field]) => field !== "admission" && field !== "admissionReason"));
        });
        const round = parseReviewRoundInput({
            round: record.round,
            previousRoundDigest: record.previousRoundDigest,
            anchor: state.anchor,
            candidateHeadSha: record.candidateHeadSha,
            focus: record.focus,
            findings,
            ...(record.followOnly === true ? { followOnly: true } : {}),
            ...(record.recordLayerOnly === true ? { recordLayerOnly: true } : {}),
        });
        rebuilt = advanceReviewSessionWithPolicy(rebuilt, round, record.admissionPolicyVersion === 2 ? 2 : 1);
        const rebuiltRecord = rebuilt.rounds.at(-1);
        if (!rebuiltRecord || stableJson(rebuiltRecord) !== stableJson(candidate))
            throw new Error(`review session round ${index + 1}のadmissionまたはdigestが不正です`);
    }
    if (rebuilt === null ||
        stableJson(rebuilt) !== stableJson(withoutLegacyStatus(value)))
        throw new Error("review sessionのanchor、latestまたはstatusが再導出値と一致しません");
    return rebuilt;
}
//# sourceMappingURL=review-convergence.js.map