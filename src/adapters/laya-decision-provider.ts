import type {
  DecisionProvider,
  DecisionRequest,
  DecisionResult,
} from "../domain/decision-provider.js";
import { assertLoopbackEndpoint } from "../lib/local-llm-endpoint.js";
import { parseJsonStrict } from "../lib/security.js";

export interface LayaDecisionProviderConfig {
  endpoint: string;
  modelId: string;
  timeoutMs: number;
  minimumConfidence: number;
  maximumResponseBytes: number;
}

export type LayaTransport = (
  endpoint: URL,
  body: string,
  signal: AbortSignal,
) => Promise<{ status: number; body: string }>;

interface LayaWireResponse {
  answer: string;
  confidence: number;
}

function parseResponse(source: string, maximumBytes: number): LayaWireResponse {
  if (Buffer.byteLength(source) > maximumBytes)
    throw new Error("Laya responseが上限を超えました");
  const parsed: unknown = parseJsonStrict(source, "Laya response");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Laya responseがobjectではありません");
  const value = parsed as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !["answer", "confidence"].includes(key)) ||
    typeof value.answer !== "string" ||
    value.answer.length === 0 ||
    value.answer.length > 256 ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  )
    throw new Error("Laya response contractが不正です");
  return { answer: value.answer, confidence: value.confidence };
}

export class LayaDecisionProvider implements DecisionProvider {
  readonly id = "laya";
  readonly #config: LayaDecisionProviderConfig;
  readonly #transport: LayaTransport;

  constructor(config: LayaDecisionProviderConfig, transport: LayaTransport) {
    assertLoopbackEndpoint(config.endpoint);
    if (!config.modelId || config.modelId.length > 256)
      throw new Error("Laya modelIdが不正です");
    if (
      !Number.isSafeInteger(config.timeoutMs) ||
      config.timeoutMs < 1 ||
      config.timeoutMs > 900_000
    )
      throw new Error("Laya timeoutMsが不正です");
    if (config.minimumConfidence < 0 || config.minimumConfidence > 1)
      throw new Error("Laya minimumConfidenceが不正です");
    if (
      !Number.isSafeInteger(config.maximumResponseBytes) ||
      config.maximumResponseBytes < 256 ||
      config.maximumResponseBytes > 1_048_576
    )
      throw new Error("Laya maximumResponseBytesが不正です");
    this.#config = config;
    this.#transport = transport;
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const endpoint = assertLoopbackEndpoint(this.#config.endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    try {
      const body = JSON.stringify({
        model: this.#config.modelId,
        questionId: request.questionId,
        claim: request.claim,
        evidence: request.evidence,
      });
      const response = await this.#transport(endpoint, body, controller.signal);
      if (response.status < 200 || response.status >= 300)
        return {
          state: "degraded",
          providerId: this.id,
          reason: "Laya runtime error",
          authority: false,
        };
      const parsed = parseResponse(
        response.body,
        this.#config.maximumResponseBytes,
      );
      if (parsed.confidence < this.#config.minimumConfidence)
        return {
          state: "degraded",
          providerId: this.id,
          reason: "Laya confidence below threshold",
          authority: false,
        };
      return {
        state: "decided",
        providerId: this.id,
        answer: parsed.answer,
        confidence: parsed.confidence,
        authority: false,
      };
    } catch {
      return {
        state: "degraded",
        providerId: this.id,
        reason: "Laya unavailable",
        authority: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
