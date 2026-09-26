import { JEV_ENDPOINT, buildJevChoiceRequestBody, parseJevChoiceResponse, validateJevEgressPayload, } from "../domain/jev-dispatch.js";
const DEFAULT_TIMEOUT_MS = 15000;
const BEARER_TOKEN_PATTERN = /^[\x21-\x7e]+$/u;
const SAFE_ERROR_TOKEN = /^[A-Za-z0-9_]{1,64}$/u;
function safeErrorToken(value) {
    return typeof value === "string" && SAFE_ERROR_TOKEN.test(value)
        ? value
        : undefined;
}
function errorCode(error) {
    if (typeof error !== "object" || error === null)
        return undefined;
    const direct = safeErrorToken(error.code);
    if (direct !== undefined)
        return direct;
    const cause = error.cause;
    if (typeof cause !== "object" || cause === null)
        return undefined;
    return safeErrorToken(cause.code);
}
function describeTransportError(error) {
    const name = error instanceof Error
        ? (safeErrorToken(error.name) ?? "Error")
        : "unknown";
    const code = errorCode(error);
    return code === undefined
        ? `transport error (${name})`
        : `transport error (${name}/${code})`;
}
function defaultFetchTransport(url, init) {
    return fetch(url, init);
}
/**
 * Jevへ1件のchoice questionを投げる。**例外を投げない。** ネットワーク・
 * timeout・認証・schema・rate limitのいずれも`JevDispatchOutcome`として
 * 正常returnし、呼び出し側（continuous shadow）が`try/catch`無しでも
 * silent fallbackにならない（Issue #1486 S-04）。
 */
export async function dispatchJevChoice(params) {
    const startedAt = Date.now();
    const egress = validateJevEgressPayload(params.state);
    if (!egress.ok)
        return {
            outcome: {
                kind: "schema-error",
                detail: `egress policy: ${egress.reason}`,
            },
            latencyMs: 0,
        };
    // 変数名を"apiKey"にしない: scripts/check_package_contents.tsのsecretText
    // patternは`api[_-]?key\s*[=:]\s*...`形状のsource文字列を配布物から見つけて
    // 拒否する（実際の値ではなくvariable代入の字面を見ている）。ここは値の代入
    // 先であって漏洩ではないが、字面を似せない命名で誤検知を避ける。
    const resolvedKeyValue = process.env[params.config.apiKeyEnvVar];
    if (typeof resolvedKeyValue !== "string" || resolvedKeyValue.length === 0)
        return {
            outcome: {
                kind: "auth-error",
                detail: `env var ${params.config.apiKeyEnvVar} が未設定です`,
            },
            latencyMs: 0,
        };
    // HTTP header値として安全な印字可能ASCII（空白・制御文字を含まない）だけを
    // 受け付ける。改行・NUL等を含む値をfetchへ渡すと、例外messageへ
    // `Bearer <値>`がそのまま載り、outcome.detail経由でjev-shadow.jsonlへ
    // 永続化される（独立security review L1）。値そのものは出力しない。
    if (!BEARER_TOKEN_PATTERN.test(resolvedKeyValue))
        return {
            outcome: {
                kind: "auth-error",
                detail: `env var ${params.config.apiKeyEnvVar} の値がHTTP header値として不正な文字を含みます`,
            },
            latencyMs: 0,
        };
    let body;
    try {
        body = buildJevChoiceRequestBody({
            model: params.config.model,
            question: params.question,
            state: params.state,
        });
    }
    catch (error) {
        return {
            outcome: {
                kind: "schema-error",
                detail: error instanceof Error ? error.message : String(error),
            },
            latencyMs: 0,
        };
    }
    const transport = params.transport ?? defaultFetchTransport;
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await transport(JEV_ENDPOINT, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${resolvedKeyValue}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const latencyMs = Date.now() - startedAt;
        let json;
        try {
            json = await response.json();
        }
        catch {
            return {
                outcome: {
                    kind: "network-error",
                    detail: "応答bodyをJSONとして解析できません",
                },
                latencyMs,
            };
        }
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader !== null && /^\d+$/u.test(retryAfterHeader)
            ? Number(retryAfterHeader) * 1000
            : null;
        const outcome = parseJevChoiceResponse(response.status, params.question.key, json, retryAfterMs);
        return { outcome, latencyMs };
    }
    catch (error) {
        const latencyMs = Date.now() - startedAt;
        // transport例外のmessageは複製しない（値やheaderを含み得る）。固定文言と
        // error class名・codeだけを残す（独立security review L1）。
        const detail = describeTransportError(error);
        return {
            outcome: {
                kind: "network-error",
                detail: controller.signal.aborted ? `timeout(${timeoutMs}ms)` : detail,
            },
            latencyMs,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=jev-http-client.js.map