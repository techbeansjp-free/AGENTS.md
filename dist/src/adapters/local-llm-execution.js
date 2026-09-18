import { assertLoopbackEndpoint } from "../lib/security.js";
import { isRecord } from "../types.js";
/** Stream応答を有限timeout・有限出力上限で読み取り、raw応答本文を保持しない。 */
export async function executeLocalLlm(input, limits = {}) {
    if (input.prompt.trim() === "")
        throw new Error("ローカルLLM実行のpromptが空です");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/u.test(input.model))
        throw new Error("ローカルLLM実行のmodel名が不正です");
    const url = assertLoopbackEndpoint(input.endpoint);
    const timeoutMs = limits.timeoutMs ?? 5 * 60 * 1000;
    const maxBytes = limits.maxOutputBytes ?? 8 * 1024 * 1024;
    if (!Number.isInteger(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > 30 * 60 * 1000 ||
        !Number.isInteger(maxBytes) ||
        maxBytes <= 0)
        throw new Error("ローカルLLM実行の有限上限が不正です");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await fetch(new URL("/api/generate", url), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    model: input.model,
                    prompt: input.prompt,
                    stream: false,
                }),
                signal: controller.signal,
            });
        }
        catch (error) {
            if (controller.signal.aborted)
                return {
                    state: "unknown",
                    reason: "ローカルLLM実行が有限時間上限に達しました。応答を確認してから明示的に再開してください",
                };
            return {
                state: "unknown",
                reason: `ローカルLLMへ接続できません: ${error instanceof Error ? error.message : "不明なエラー"}`,
            };
        }
        if (!response.ok)
            return {
                state: "failed",
                reason: `ローカルLLMが異常な応答状態を返しました: HTTP ${response.status}`,
            };
        const reader = response.body?.getReader();
        if (!reader)
            return {
                state: "unknown",
                reason: "ローカルLLMの応答本文を読み取れません",
            };
        let bytes = 0;
        let text = "";
        const decoder = new TextDecoder();
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > maxBytes) {
                await reader.cancel();
                return {
                    state: "unknown",
                    reason: "ローカルLLM出力が容量上限に達しました。対象を縮小して再実行してください",
                };
            }
            text += decoder.decode(value, { stream: true });
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            return {
                state: "unknown",
                reason: "ローカルLLM応答が不正なJSON形式です",
            };
        }
        if (!isRecord(parsed) ||
            typeof parsed.response !== "string" ||
            parsed.done !== true)
            return {
                state: "unknown",
                reason: "ローカルLLM応答が既定の形状（response/done）と一致しません",
            };
        return {
            state: "succeeded",
            reason: "ローカルLLMの正常完了を確認しました",
        };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=local-llm-execution.js.map