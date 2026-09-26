/** `executor.kind === "provider"`のdecisionだけがshadow対象になり得る。 */
export function isJevShadowEligible(executor) {
    return executor.kind === "provider";
}
const DCAND_010_CRITERIA = Object.freeze({
    minor: "軽微な矛盾3条件（設計正本が定める判定基準）を全て満たし、gateを緩めても安全と判断できる",
    "not-minor": "軽微な矛盾3条件のいずれかを満たさない、またはgateを緩めるべきでないと判断できる",
});
const DCAND_008_CRITERIA = Object.freeze({
    "confirmed-limited": "対象PRの最新HEADに紐づくCodeRabbit自身のcheck・review・通知に明示的なrate limitの記載がある",
    "no-limit-evidence": "最新HEADについて必要なGitHub情報を取得できたが、明示的なrate limitの記載は無い",
    unknown: "GitHub情報を取得できない、または最新HEAD・identityを確定できない",
});
/**
 * `subjectRef`（判断対象を指す文字列。例:「PR#1485 finding F-01」）だけを
 * 送信する。**呼び出し側が渡した`payload`の内容（finding evidence等の
 * 自由形式text）は一切送らない。** 送ってよいevidence sub-fieldの
 * per-type allowlistは本Issueのスコープに含めない（disclosed gap。実際に
 * evidence文字列を使う呼び出し元がまだ無いため、allowlistを先に作らない）。
 */
export function planJevShadowQuestion(input) {
    if (input.decisionTypeId === "DCAND-010") {
        return {
            question: {
                key: "dcand010",
                options: ["minor", "not-minor"],
                criteria: DCAND_010_CRITERIA,
            },
            state: { context: `軽微な矛盾3条件判定の対象: ${input.subjectRef}` },
        };
    }
    if (input.decisionTypeId === "DCAND-008") {
        return {
            question: {
                key: "dcand008",
                options: ["confirmed-limited", "no-limit-evidence", "unknown"],
                criteria: DCAND_008_CRITERIA,
            },
            state: { context: `CodeRabbit利用枠制限判定の対象: ${input.subjectRef}` },
        };
    }
    if (input.decisionTypeId === "DCAND-009") {
        if (input.candidateSet === undefined || input.candidateSet.length < 2)
            return undefined;
        const criteria = Object.fromEntries(input.candidateSet.map((name) => [
            name,
            `reviewer候補として${name}を選ぶ`,
        ]));
        return {
            question: {
                key: "dcand009",
                options: [...input.candidateSet],
                criteria,
            },
            state: { context: `reviewer選定の対象: ${input.subjectRef}` },
        };
    }
    return undefined;
}
export function buildJevShadowRecord(input) {
    const base = {
        decisionRecordId: input.decisionRecordId,
        decisionTypeId: input.decisionTypeId,
        candidateHeadSha: input.candidateHeadSha,
        primaryProposedValue: input.primaryProposedValue,
        primaryAuthorityMode: input.primaryAuthorityMode,
        jevModel: input.jevModel,
        latencyMs: input.latencyMs,
        dispatchedAt: input.dispatchedAt,
    };
    const { outcome } = input;
    if (outcome.kind === "ok") {
        return {
            ...base,
            jevResolvedModel: outcome.resolvedModel,
            jevProposedValue: outcome.answer.choice,
            jevConfidence: outcome.answer.confidence,
            outcomeKind: outcome.kind,
            outcomeDetail: null,
            matchesPrimaryProposedValue: outcome.answer.choice === input.primaryProposedValue,
            inputTokens: outcome.usage.inputTokens,
            outputTokens: outcome.usage.outputTokens,
        };
    }
    const outcomeDetail = outcome.kind === "rate-limited"
        ? `retryAfterMs=${outcome.retryAfterMs ?? "unknown"}`
        : outcome.kind === "unexpected-status"
            ? `status=${outcome.status}: ${outcome.detail}`
            : outcome.detail;
    return {
        ...base,
        jevResolvedModel: null,
        jevProposedValue: null,
        jevConfidence: null,
        outcomeKind: outcome.kind,
        outcomeDetail,
        matchesPrimaryProposedValue: null,
        inputTokens: 0,
        outputTokens: 0,
    };
}
//# sourceMappingURL=jev-shadow.js.map