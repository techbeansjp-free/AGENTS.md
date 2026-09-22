import http, { type IncomingMessage } from "node:http";
import { assertLoopbackEndpoint } from "../lib/local-llm-endpoint.js";
import { isValidLocalLlmModel } from "../lib/local-llm-model.js";
import type {
  ReviewerExecutionResult,
  ReviewerExecutor,
} from "../domain/reviewer-provider.js";
import { isRecord } from "../types.js";
import {
  DEFAULT_LOCAL_REVIEW_MAX_OUTPUT_TOKENS,
  isValidLocalReviewMaxOutputTokens,
} from "../domain/local-review-limits.js";

export interface LocalLlmExecutionInput {
  endpoint: string;
  model: string;
  prompt: string;
  /** 指定時は第2引数`limits.timeoutMs`より優先する（呼出し元のconfig単位設定を通す経路） */
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export type LocalLlmExecutionResult = ReviewerExecutionResult;

export type LocalLlmExecutor = ReviewerExecutor;

function requestLocalLlm(
  url: URL,
  body: string,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
      },
      resolve,
    );
    request.once("error", reject);
    request.end(body);
  });
}

interface ParsedOllamaResponse {
  output: string;
  doneReason?: string;
}

function parseOllamaResponse(text: string): ParsedOllamaResponse | undefined {
  const parseRecord = (value: string): unknown => JSON.parse(value);
  try {
    const parsed = parseRecord(text);
    if (
      isRecord(parsed) &&
      typeof parsed.response === "string" &&
      parsed.done === true
    )
      return {
        output: parsed.response,
        ...(typeof parsed.done_reason === "string"
          ? { doneReason: parsed.done_reason }
          : {}),
      };
  } catch {
    // stream=trueは改行区切りJSONを返すため、単一JSONでなければ下で検証する。
  }
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return undefined;
  let output = "";
  let completed = false;
  let doneReason: string | undefined;
  try {
    for (const line of lines) {
      const parsed = parseRecord(line);
      if (
        !isRecord(parsed) ||
        typeof parsed.response !== "string" ||
        typeof parsed.done !== "boolean" ||
        completed
      )
        return undefined;
      output += parsed.response;
      completed = parsed.done;
      if (parsed.done && typeof parsed.done_reason === "string")
        doneReason = parsed.done_reason;
    }
  } catch {
    return undefined;
  }
  return completed ? { output, doneReason } : undefined;
}

/**
 * Stream応答を有限timeout・有限出力上限で読み取る。`succeeded`時は応答本文を
 * `output`として返す（reviewer役割の指摘内容を伝えるため必須。破棄すると
 * ローカルLLMが何を指摘したか呼出し元へ一切伝わらない）。raw stdout/stderrや
 * prompt本文をログへ書き出すのは呼出し元の責務であり、この関数自体は転記しない。
 */
export async function executeLocalLlm(
  input: LocalLlmExecutionInput,
  limits: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<LocalLlmExecutionResult> {
  if (input.prompt.trim() === "")
    throw new Error("ローカルLLM実行のpromptが空です");
  if (!isValidLocalLlmModel(input.model))
    throw new Error("ローカルLLM実行のmodel名が不正です");
  const url = assertLoopbackEndpoint(input.endpoint);
  const timeoutMs = input.timeoutMs ?? limits.timeoutMs ?? 15 * 60 * 1000;
  const maxBytes = limits.maxOutputBytes ?? 8 * 1024 * 1024;
  const maxOutputTokens =
    input.maxOutputTokens ?? DEFAULT_LOCAL_REVIEW_MAX_OUTPUT_TOKENS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 30 * 60 * 1000 ||
    !Number.isInteger(maxBytes) ||
    maxBytes <= 0 ||
    !isValidLocalReviewMaxOutputTokens(maxOutputTokens)
  )
    throw new Error("ローカルLLM実行の有限上限が不正です");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: IncomingMessage;
    try {
      response = await requestLocalLlm(
        new URL("/api/generate", url),
        JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          // Ollamaの非stream応答は生成完了までresponse headerを返さない。
          // streamで早期にheaderを受けつつ、下で全chunkを有限量に集約する。
          stream: true,
          options: {
            temperature: 0,
            num_predict: maxOutputTokens,
          },
        }),
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted)
        return {
          state: "unknown",
          reason:
            "ローカルLLM実行が有限時間上限に達しました。応答を確認してから明示的に再開してください",
        };
      return {
        state: "unknown",
        reason: `ローカルLLMへ接続できません: ${error instanceof Error ? error.message : "不明なエラー"}`,
      };
    }
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      response.destroy();
      return {
        state: "failed",
        reason:
          "ローカルLLMがredirect応答を返しました。loopback限定の多層防御に反するため追従しません",
      };
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      return {
        state: "failed",
        reason: `ローカルLLMが異常な応答状態を返しました: HTTP ${status}`,
      };
    }
    let bytes = 0;
    let text = "";
    const decoder = new TextDecoder();
    try {
      for await (const value of response) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          response.destroy();
          return {
            state: "unknown",
            reason:
              "ローカルLLM出力が容量上限に達しました。対象を縮小して再実行してください",
          };
        }
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      /**
       * timeoutがstream読取中に発火すると`controller.abort()`がasync iteratorを
       * rejectさせる。接続確立前のabortはrequestのcatch（上）が処理するが、
       * 読取中のabortはここでも捕捉しないと未捕捉rejectionになる（独立レビュー指摘）。
       */
      if (controller.signal.aborted)
        return {
          state: "unknown",
          reason:
            "ローカルLLM実行が有限時間上限に達しました。応答を確認してから明示的に再開してください",
        };
      return {
        state: "unknown",
        reason: `ローカルLLM応答の読み取りに失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`,
      };
    }
    const parsed = parseOllamaResponse(text);
    if (parsed === undefined)
      return {
        state: "unknown",
        reason:
          "ローカルLLM応答が既定の形状（改行区切りresponse/done）と一致しません",
      };
    if (parsed.doneReason === "length")
      return {
        state: "unknown",
        reason:
          "ローカルLLM出力が生成token上限に達しました。maxOutputTokensまたは対象範囲を調整してください",
      };
    return {
      state: "succeeded",
      reason: "ローカルLLMの正常完了を確認しました",
      output: parsed.output,
    };
  } finally {
    clearTimeout(timer);
  }
}
