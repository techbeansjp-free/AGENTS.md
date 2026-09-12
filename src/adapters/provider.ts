import {
  run,
  runJsonlSession,
  type ProcessOptions,
  type ProcessResult,
} from "../lib/process.js";
import { parseJsonStrict } from "../lib/security.js";
import { PACKAGE_VERSION } from "../lib/version.js";
import { isRecord, type ProviderModelObservation } from "../types.js";

export type ProviderAvailabilityState = "available" | "unavailable" | "unknown";

export interface ProviderAvailabilityObservation {
  provider: string;
  state: ProviderAvailabilityState;
  models: string[];
  modelMetadata: ProviderModelObservation[];
  observedAt: string;
  entrypoint: string;
  reason?: string;
}

export type ProviderExecutor = (
  file: string,
  args: string[],
  cwd: string,
  options: ProcessOptions,
) => ProcessResult | Promise<ProcessResult>;

interface ProviderCatalog {
  available: boolean;
  models: string[];
  modelMetadata: ProviderModelObservation[];
}

const PROVIDER_NAME = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const MODEL_SLUG = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const CLAUDE_MODEL_ID = /^[^\p{C}\p{Z}]{1,512}$/u;
const CODEX_RESPONSE_ID = 1;
const CLAUDE_RESPONSE_ID = "asc-provider-observe";
const PROVIDER_TIMEOUT_MS = 10_000;

function parseJsonLines(stdout: string): unknown[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJsonStrict(line, "provider JSONL response"));
}

function parseTerminatedJsonLines(stdout: string): unknown[] {
  return parseJsonLines(stdout.slice(0, stdout.lastIndexOf("\n") + 1));
}

function hasCodexResponse(stdout: string, id = CODEX_RESPONSE_ID): boolean {
  for (const line of stdout
    .slice(0, stdout.lastIndexOf("\n") + 1)
    .split("\n")) {
    const source = line.trim();
    if (!source) continue;
    try {
      const message = parseJsonStrict(source, "provider JSONL response");
      if (isRecord(message) && message.id === id) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function hasClaudeResponse(stdout: string): boolean {
  return parseTerminatedJsonLines(stdout).some(
    (message) =>
      isRecord(message) &&
      message.type === "control_response" &&
      isRecord(message.response) &&
      message.response.request_id === CLAUDE_RESPONSE_ID,
  );
}

function codexInitializeInput(): string {
  return (
    JSON.stringify({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "agent-skill-chain",
          title: "agent-skill-chain",
          version: PACKAGE_VERSION,
        },
      },
    }) + "\n"
  );
}

function codexRequests(official: boolean): string {
  return (
    [
      { method: "initialized", params: {} },
      ...(official
        ? [{ method: "config/read", id: 2, params: { includeLayers: false } }]
        : []),
      {
        method: "model/list",
        id: CODEX_RESPONSE_ID,
        params: { limit: 1000, includeHidden: false },
      },
    ]
      .map((message) => JSON.stringify(message))
      .join("\n") + "\n"
  );
}

function claudeInitializeInput(): string {
  return (
    JSON.stringify({
      type: "control_request",
      request_id: CLAUDE_RESPONSE_ID,
      request: { subtype: "initialize", hooks: {} },
    }) + "\n"
  );
}

function runCodexSession(
  file: string,
  args: string[],
  cwd: string,
  options: ProcessOptions,
  official: boolean,
): Promise<ProcessResult> {
  let initialized = false;
  return runJsonlSession(file, args, cwd, {
    ...options,
    input: codexInitializeInput(),
    timeoutMs: options.timeoutMs ?? PROVIDER_TIMEOUT_MS,
    nextInput: (stdout) => {
      if (initialized) return undefined;
      const responses = parseTerminatedJsonLines(stdout).filter(
        (message) => isRecord(message) && message.id === 0,
      );
      if (responses.length === 0) return undefined;
      const response = responses[0];
      if (
        responses.length !== 1 ||
        !isRecord(response) ||
        Object.hasOwn(response, "error") ||
        !isRecord(response.result) ||
        typeof response.result.userAgent !== "string" ||
        response.result.userAgent.trim() === ""
      )
        throw new Error("Codex initializeの成功応答を確認できません");
      initialized = true;
      return codexRequests(official);
    },
    isComplete: (stdout) =>
      initialized &&
      hasCodexResponse(stdout) &&
      (!official || hasCodexResponse(stdout, 2)),
  });
}

function runClaudeSession(
  file: string,
  args: string[],
  cwd: string,
  options: ProcessOptions,
): Promise<ProcessResult> {
  return runJsonlSession(file, args, cwd, {
    ...options,
    input: claudeInitializeInput(),
    timeoutMs: options.timeoutMs ?? PROVIDER_TIMEOUT_MS,
    isComplete: hasClaudeResponse,
  });
}

function codexCatalog(stdout: string): ProviderCatalog | undefined {
  const response = parseTerminatedJsonLines(stdout).find(
    (message) => isRecord(message) && message.id === CODEX_RESPONSE_ID,
  );
  if (
    !isRecord(response) ||
    Object.hasOwn(response, "error") ||
    !isRecord(response.result)
  )
    return undefined;
  const result = response.result;
  if (
    !Array.isArray(result.data) ||
    (result.nextCursor !== null && result.nextCursor !== undefined)
  )
    return undefined;
  const modelMetadata: ProviderModelObservation[] = [];
  for (const entry of result.data) {
    if (
      !isRecord(entry) ||
      typeof entry.model !== "string" ||
      !MODEL_SLUG.test(entry.model) ||
      (entry.isDefault !== undefined && typeof entry.isDefault !== "boolean") ||
      (entry.hidden !== undefined && typeof entry.hidden !== "boolean") ||
      entry.hidden === true
    )
      return undefined;
    const efforts = entry.supportedReasoningEfforts;
    if (efforts !== undefined && !Array.isArray(efforts)) return undefined;
    const supportedReasoningEfforts = (efforts ?? []).map((effort) =>
      isRecord(effort) ? effort.reasoningEffort : undefined,
    );
    if (
      supportedReasoningEfforts.some(
        (effort) =>
          typeof effort !== "string" ||
          !/^[a-z][a-z0-9_-]{0,31}$/u.test(effort),
      ) ||
      new Set(supportedReasoningEfforts).size !==
        supportedReasoningEfforts.length
    )
      return undefined;
    modelMetadata.push({
      model: entry.model,
      recommended: entry.isDefault === true,
      supportedReasoningEfforts: supportedReasoningEfforts as string[],
    });
  }
  const models = modelMetadata.map((entry) => entry.model);
  if (new Set(models).size !== models.length) return undefined;
  return {
    available: models.length > 0,
    models,
    modelMetadata,
  };
}

function claudeCatalog(stdout: string): ProviderCatalog | undefined {
  const responses = parseTerminatedJsonLines(stdout).filter(
    (message) =>
      isRecord(message) &&
      message.type === "control_response" &&
      isRecord(message.response) &&
      message.response.request_id === CLAUDE_RESPONSE_ID,
  );
  const envelope = responses[0];
  if (
    responses.length !== 1 ||
    !isRecord(envelope) ||
    !isRecord(envelope.response) ||
    envelope.response.subtype !== "success" ||
    !isRecord(envelope.response.response) ||
    !Array.isArray(envelope.response.response.models)
  )
    return undefined;
  const modelMetadata: ProviderModelObservation[] = [];
  const values: string[] = [];
  for (const entry of envelope.response.response.models) {
    if (
      !isRecord(entry) ||
      typeof entry.value !== "string" ||
      !CLAUDE_MODEL_ID.test(entry.value) ||
      typeof entry.resolvedModel !== "string" ||
      !CLAUDE_MODEL_ID.test(entry.resolvedModel) ||
      (entry.supportsEffort !== undefined &&
        typeof entry.supportsEffort !== "boolean")
    )
      return undefined;
    const efforts = entry.supportedEffortLevels;
    if (efforts !== undefined && !Array.isArray(efforts)) return undefined;
    const supportedReasoningEfforts = efforts ?? [];
    if (
      supportedReasoningEfforts.some(
        (effort) =>
          typeof effort !== "string" ||
          !/^[a-z][a-z0-9_-]{0,31}$/u.test(effort),
      ) ||
      new Set(supportedReasoningEfforts).size !==
        supportedReasoningEfforts.length
    )
      return undefined;
    values.push(entry.value);
    modelMetadata.push({
      model: entry.resolvedModel,
      recommended: entry.value === "default",
      supportedReasoningEfforts: supportedReasoningEfforts as string[],
    });
  }
  if (new Set(values).size !== values.length) return undefined;
  const models = [...new Set(modelMetadata.map((entry) => entry.model))];
  return { available: models.length > 0, models, modelMetadata };
}

async function defaultExecutor(
  file: string,
  args: string[],
  cwd: string,
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (file !== "codex") return run(file, args, cwd, options);
  return runCodexSession(file, args, cwd, options, false);
}

function isLegacyProviderCatalog(
  value: unknown,
): value is { available: boolean; models: string[] } {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "available") ||
    !Object.hasOwn(value, "models") ||
    typeof value.available !== "boolean" ||
    !Array.isArray(value.models)
  )
    return false;
  const models = value.models as unknown[];
  if (
    models.some(
      (model) => typeof model !== "string" || !MODEL_SLUG.test(model),
    ) ||
    new Set(models).size !== models.length
  )
    return false;
  return value.available ? models.length > 0 : models.length === 0;
}

function unknownObservation(
  provider: string,
  observedAt: string,
  reason: string,
): ProviderAvailabilityObservation {
  return {
    provider,
    state: "unknown",
    models: [],
    modelMetadata: [],
    observedAt,
    entrypoint:
      provider === "codex"
        ? "codex app-server model/list"
        : provider === "claude"
          ? "claude stream-json initialize models"
          : provider,
    reason,
  };
}

export async function observeProvider(
  provider: string,
  execute: ProviderExecutor = defaultExecutor,
  now: () => Date = () => new Date(),
  options: { cwd?: string; official?: boolean } = {},
): Promise<ProviderAvailabilityObservation> {
  const observedAt = now().toISOString();
  if (!PROVIDER_NAME.test(provider))
    return unknownObservation(
      provider,
      observedAt,
      "provider実行入口の名前が不正です",
    );
  let result: ProcessResult;
  try {
    const observer =
      execute === defaultExecutor && provider === "codex"
        ? (
            file: string,
            args: string[],
            cwd: string,
            processOptions: ProcessOptions,
          ) =>
            runCodexSession(
              file,
              args,
              cwd,
              processOptions,
              options.official === true,
            )
        : execute === defaultExecutor && provider === "claude"
          ? runClaudeSession
          : execute;
    result = await observer(
      provider,
      provider === "codex"
        ? [
            "app-server",
            "--stdio",
            ...(options.official ? CODEX_SELECTION_CONFIG : []),
          ]
        : provider === "claude"
          ? [
              "--output-format",
              "stream-json",
              "--verbose",
              "--input-format",
              "stream-json",
              "--setting-sources=",
            ]
          : ["models", "list", "--json"],
      options.cwd ?? process.cwd(),
      { allowFailure: true, timeoutMs: PROVIDER_TIMEOUT_MS },
    );
  } catch {
    return unknownObservation(
      provider,
      observedAt,
      "provider実行入口を起動できません",
    );
  }
  if (result.status !== 0)
    return unknownObservation(
      provider,
      observedAt,
      "provider実行入口のread-only観測が失敗しました",
    );
  let catalog: ProviderCatalog | undefined;
  try {
    if (provider === "codex") {
      if (options.official) {
        const responses = parseTerminatedJsonLines(result.stdout);
        const configurations = responses.filter(
          (entry) => isRecord(entry) && entry.id === 2,
        );
        const configuration = configurations[0];
        if (
          configurations.length !== 1 ||
          !isRecord(configuration) ||
          Object.hasOwn(configuration, "error") ||
          !isRecord(configuration.result) ||
          !isRecord(configuration.result.config)
        )
          return unknownObservation(
            provider,
            observedAt,
            "公式catalogのconfig/read応答を確認できません",
          );
        const config = configuration.result.config;
        if (
          (config.model_catalog_json !== null &&
            config.model_catalog_json !== undefined) ||
          (config.model_provider !== null &&
            config.model_provider !== undefined &&
            config.model_provider !== "openai")
        )
          return unknownObservation(
            provider,
            observedAt,
            "公式catalogを確認できません。model_catalog_json指定を解除しOpenAI providerで再実行してください",
          );
        if (
          responses.filter(
            (entry) => isRecord(entry) && entry.id === CODEX_RESPONSE_ID,
          ).length !== 1
        )
          return unknownObservation(
            provider,
            observedAt,
            "model/list応答が一意ではありません",
          );
      }
      catalog = codexCatalog(result.stdout);
    } else if (provider === "claude") {
      catalog = claudeCatalog(result.stdout);
    } else {
      const value: unknown = parseJsonStrict(
        result.stdout,
        "provider model catalog",
      );
      if (isLegacyProviderCatalog(value))
        catalog = {
          available: value.available,
          models: [...value.models],
          modelMetadata: value.models.map((model) => ({
            model,
            recommended: false,
            supportedReasoningEfforts: [],
          })),
        };
    }
  } catch {
    return unknownObservation(
      provider,
      observedAt,
      "provider model catalogを解釈できません",
    );
  }
  if (!catalog)
    return unknownObservation(
      provider,
      observedAt,
      "provider model catalogの構造が不正です",
    );
  return {
    provider,
    state: catalog.available ? "available" : "unavailable",
    models: [...catalog.models],
    modelMetadata: catalog.modelMetadata.map((entry) => ({
      ...entry,
      supportedReasoningEfforts: [...entry.supportedReasoningEfforts],
    })),
    observedAt,
    entrypoint:
      provider === "codex"
        ? "codex app-server model/list"
        : provider === "claude"
          ? "claude stream-json initialize models"
          : provider,
  };
}

/** Keep authentication and safety configuration; override only model selection. */
export const CODEX_SELECTION_CONFIG = [
  "-c",
  'model_provider="openai"',
  "-c",
  'model_reasoning_effort="high"',
  "-c",
  'service_tier="default"',
];
