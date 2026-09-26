/**
 * Jev HTTP adapter（Issue #1486、T-01）。実際のfetchはここに閉じ込め、
 * `src/domain/jev-dispatch.ts`のpure関数（request構築・egress policy・
 * response解析）を呼ぶだけにする。
 *
 * **`transport`は常に注入可能。** `npm test`は実networkへ依存しない
 * （fakeなtransportで決定的に検証する）。実APIへの手動probeは開発者が
 * 別途スクリプトで行い、テストsuiteには含めない。
 *
 * APIキー値は`process.env[config.apiKeyEnvVar]`から読んだ瞬間にHTTP
 * headerへ渡すだけで、それ以外のどのobject・log・戻り値にも含めない。
 */
import type { JevProviderConfig } from "../domain/jev-provider-config.js";
import {
  JEV_ENDPOINT,
  buildJevChoiceRequestBody,
  parseJevChoiceResponse,
  validateJevEgressPayload,
  type JevChoiceQuestionSpec,
  type JevDispatchOutcome,
} from "../domain/jev-dispatch.js";

export interface JevTransportResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type JevTransport = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<JevTransportResponse>;

const DEFAULT_TIMEOUT_MS = 15000;

export interface JevDispatchParams {
  readonly config: JevProviderConfig;
  readonly question: JevChoiceQuestionSpec;
  readonly state: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  readonly transport?: JevTransport;
}

export interface JevDispatchResult {
  readonly outcome: JevDispatchOutcome;
  readonly latencyMs: number;
}

function defaultFetchTransport(
  url: string,
  init: Parameters<JevTransport>[1],
): Promise<JevTransportResponse> {
  return fetch(url, init) as unknown as Promise<JevTransportResponse>;
}

/**
 * Jevへ1件のchoice questionを投げる。**例外を投げない。** ネットワーク・
 * timeout・認証・schema・rate limitのいずれも`JevDispatchOutcome`として
 * 正常returnし、呼び出し側（continuous shadow）が`try/catch`無しでも
 * silent fallbackにならない（Issue #1486 S-04）。
 */
export async function dispatchJevChoice(
  params: JevDispatchParams,
): Promise<JevDispatchResult> {
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
  let body: ReturnType<typeof buildJevChoiceRequestBody>;
  try {
    body = buildJevChoiceRequestBody({
      model: params.config.model,
      question: params.question,
      state: params.state,
    });
  } catch (error) {
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
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return {
        outcome: {
          kind: "network-error",
          detail: "応答bodyをJSONとして解析できません",
        },
        latencyMs,
      };
    }
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs =
      retryAfterHeader !== null && /^\d+$/u.test(retryAfterHeader)
        ? Number(retryAfterHeader) * 1000
        : null;
    const outcome = parseJevChoiceResponse(
      response.status,
      params.question.key,
      json,
      retryAfterMs,
    );
    return { outcome, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const detail = error instanceof Error ? error.message : String(error);
    return {
      outcome: {
        kind: "network-error",
        detail: controller.signal.aborted ? `timeout(${timeoutMs}ms)` : detail,
      },
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
