/**
 * Jev（TypeSafe社 System One API）へ送るrequestのpure構築と、送信して
 * よいfieldのdata egress policy（Issue #1486、T-01）。
 *
 * **実HTTP通信はここでは行わない。** requestの形状・egress policy・response
 * 解析だけを持つpure domain。実際のfetchは`src/adapters/jev-http-client.ts`
 * が持つ（domain/adapters分離）。
 *
 * 確認済みAPI形状（2026-09-26、実キーで安全な最小probeを実施して確認。
 * webで見つかった非公式情報は未確認のリードとして扱い、ここには実測結果
 * だけを記録する）:
 * - endpoint: `POST https://api.typesafe.ai/v1/systemone`
 * - 利用可能model名（`GET /v1/models`で確認）: `jev-latest`, `jev-preview`
 * - request: `{ model, questions: { [key]: { type: "choice", options: string[], criteria: Record<option, string> } }, state: Record<string, unknown> }`
 *   - `criteria`はdict必須（`string`を渡すと422 `dict_type`）。option名をkeyに
 *     取る説明文のRecordを渡すと通る（実測）
 * - 成功応答(200): `{ model, answers: { [key]: { type: "choice", choice: string, confidence: number, probabilities: Record<string, number> } }, usage: { input_tokens: number, output_tokens: number } }`
 *   - 応答の`model`は解決済みの具体的version文字列（例: `jev-1.13.0`）で、
 *     requestで指定した`jev-latest`等のalias名とは異なる
 * - 422（pydantic validation）: `{ detail: [{ type, loc, msg, input? }, ...] }`
 * - 400（api usage error。例: 未知model名）: `{ detail: { error_type: string, message: string } }`
 * - 401（認証失敗）: `{ detail: { error_type: "authentication_error", message: string } }`
 * - 429等のrate limit応答の実際のbody形状は未確認（実測でrate limitを誘発
 *   していない。安全側で誘発コストを払わなかった）。statusコードだけで
 *   分類し、body形状には依存しない
 */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export function buildJevChoiceRequestBody(input) {
    if (input.model.trim() === "")
        throw new Error("Jev requestのmodelは空でない文字列が必要です");
    if (input.question.key.trim() === "")
        throw new Error("Jev choice questionのkeyは空でない文字列が必要です");
    if (input.question.options.length < 2)
        throw new Error("Jev choice questionはoptionsが2件以上必要です");
    const uniqueOptions = new Set(input.question.options);
    if (uniqueOptions.size !== input.question.options.length)
        throw new Error("Jev choice questionのoptionsに重複があります");
    const missingCriteria = input.question.options.filter((option) => !(option in input.question.criteria));
    if (missingCriteria.length > 0)
        throw new Error(`Jev choice questionのcriteriaに未記載のoptionがあります: ${missingCriteria.join(", ")}`);
    return {
        model: input.model,
        questions: {
            [input.question.key]: {
                type: "choice",
                options: [...input.question.options],
                criteria: { ...input.question.criteria },
            },
        },
        state: { ...input.state },
    };
}
// --- Data egress policy -----------------------------------------------------
/**
 * `state`へ入れるkey名の禁止pattern。`src/domain/enforcement.ts`の
 * `redactValue`が出力時に使う既存patternと同じ語彙を、送信前の入口側でも
 * 適用する（防御の二重化。出力時redactionは「表示しない」、egress policyは
 * 「そもそも送らない」）。
 */
const EGRESS_DENIED_KEY_PATTERN = /^(?:token|password|secret|api[_-]?key|apikey|databaseurl|connectionstring|privatekey|authorization|cookie|credential)$/iu;
/**
 * 送信するstring1件あたりの文字数上限。「無関係なfile内容を丸ごと送らない」
 * ための粗い上限（Issue #1486、T-01「data egress validation」）。
 */
export const JEV_EGRESS_MAX_STRING_LENGTH = 8000;
/**
 * `state`へ入れる前のpayloadを検査する。**疑わしい内容をredactして続行
 * しない。** 禁止key名・長すぎる文字列を見つけたら送信自体を拒否する
 * （fail-closed。`findingAdmission`・`resolveAuthorityDecision`と同じ
 * 「疑わしければ止める」設計を踏襲する）。
 */
export function validateJevEgressPayload(value, keyPath = "$") {
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const result = validateJevEgressPayload(value[index], `${keyPath}[${index}]`);
            if (!result.ok)
                return result;
        }
        return { ok: true };
    }
    if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            if (EGRESS_DENIED_KEY_PATTERN.test(key))
                return {
                    ok: false,
                    reason: `禁止key名を含むため送信を拒否しました: ${keyPath}.${key}`,
                };
            const result = validateJevEgressPayload(item, `${keyPath}.${key}`);
            if (!result.ok)
                return result;
        }
        return { ok: true };
    }
    if (typeof value === "string" && value.length > JEV_EGRESS_MAX_STRING_LENGTH)
        return {
            ok: false,
            reason: `文字列が上限(${JEV_EGRESS_MAX_STRING_LENGTH}文字)を超えるため送信を拒否しました: ${keyPath}`,
        };
    return { ok: true };
}
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function extractDetailMessage(body) {
    if (isPlainObject(body) && isPlainObject(body.detail)) {
        const message = body.detail.message;
        const errorType = body.detail.error_type;
        if (typeof message === "string")
            return typeof errorType === "string"
                ? `${errorType}: ${message}`
                : message;
    }
    if (isPlainObject(body) && typeof body.detail === "string")
        return body.detail;
    return "応答bodyからdetailを抽出できません";
}
function extractPydanticDetail(body) {
    if (isPlainObject(body) && Array.isArray(body.detail)) {
        return body.detail
            .map((entry) => {
            if (!isPlainObject(entry))
                return String(entry);
            const loc = Array.isArray(entry.loc) ? entry.loc.join(".") : "?";
            const msg = typeof entry.msg === "string" ? entry.msg : "";
            return `${loc}: ${msg}`;
        })
            .join("; ");
    }
    return extractDetailMessage(body);
}
/**
 * HTTP statusとbodyから`JevDispatchOutcome`を決める。**statusコードが
 * 最終的な分類軸であり、bodyの形状が期待と違っても未知の成功として扱わない
 * （silent fallback禁止。Issue #1486 S-04）。**
 */
export function parseJevChoiceResponse(status, questionKey, body, retryAfterMs) {
    if (status === 200) {
        if (!isPlainObject(body) ||
            typeof body.model !== "string" ||
            !isPlainObject(body.answers) ||
            !isPlainObject(body.answers[questionKey]))
            return {
                kind: "schema-error",
                detail: "success応答の形状が期待（model/answers[key]）と不一致です",
            };
        const answerRaw = body.answers[questionKey];
        if (answerRaw.type !== "choice" ||
            typeof answerRaw.choice !== "string" ||
            typeof answerRaw.confidence !== "number" ||
            !isPlainObject(answerRaw.probabilities))
            return {
                kind: "schema-error",
                detail: "answers[key]の形状が期待（type/choice/confidence/probabilities）と不一致です",
            };
        const usage = isPlainObject(body.usage) ? body.usage : {};
        const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
        const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
        return {
            kind: "ok",
            resolvedModel: body.model,
            answer: {
                choice: answerRaw.choice,
                confidence: answerRaw.confidence,
                probabilities: answerRaw.probabilities,
            },
            usage: { inputTokens, outputTokens },
        };
    }
    if (status === 401)
        return { kind: "auth-error", detail: extractDetailMessage(body) };
    if (status === 422)
        return { kind: "schema-error", detail: extractPydanticDetail(body) };
    if (status === 400)
        return { kind: "usage-error", detail: extractDetailMessage(body) };
    if (status === 429)
        return { kind: "rate-limited", retryAfterMs };
    return {
        kind: "unexpected-status",
        status,
        detail: extractDetailMessage(body),
    };
}
//# sourceMappingURL=jev-dispatch.js.map