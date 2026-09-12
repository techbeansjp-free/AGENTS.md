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
const CODEX_RESPONSE_ID = 1;
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

/**
 * 観測に到達できなかったときの結果を組み立てる。**実行した入口と終了値を残す**（Issue #1341）。
 *
 * 旧版は`entrypoint`がprovider名だけ、`reason`が理由だけだったため、利用者は
 * 「何を実行して何が返ったか」を配布物の`dist`を読むまで特定できなかった。
 * `stderr`本文と入力本文は載せない（仕様06）。載せるのは製品が組み立てたargvと
 * 整数の終了値だけである。
 */
function unknownObservation(
  provider: string,
  observedAt: string,
  reason: string,
  attempt: { args: readonly string[]; exitCode?: number } = { args: [] },
): ProviderAvailabilityObservation {
  const entrypoint = [provider, ...attempt.args].join(" ");
  return {
    provider,
    state: "unknown",
    models: [],
    modelMetadata: [],
    observedAt,
    entrypoint,
    reason:
      attempt.exitCode === undefined
        ? reason
        : `${reason}（終了値${attempt.exitCode}）`,
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
  const args =
    provider === "codex"
      ? [
          "app-server",
          "--stdio",
          ...(options.official ? CODEX_SELECTION_CONFIG : []),
        ]
      : ["models", "list", "--json"];
  let result: ProcessResult;
  try {
    const observer =
      options.official && execute === defaultExecutor
        ? (
            file: string,
            args_: string[],
            cwd: string,
            processOptions: ProcessOptions,
          ) => runCodexSession(file, args_, cwd, processOptions, true)
        : execute;
    /**
     * **argsは複写して渡す。** 同じ配列参照を診断へ再利用すると、executorが
     * 配列を書き換えた場合に「製品が実際に実行したargv」ではない値を報告する
     * （Issue #1341のREV-02）。
     */
    result = await observer(provider, [...args], options.cwd ?? process.cwd(), {
      allowFailure: true,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
  } catch {
    return unknownObservation(
      provider,
      observedAt,
      "provider実行入口を起動できません",
      { args },
    );
  }
  /**
   * **起動できなかった場合は終了値を載せない。** `run`は`allowFailure=true`のとき
   * 起動失敗も終了値1へ写すため、`status`だけでは区別できない（Issue #1341のREV-01）。
   * 「終了値1で終わった」と報告すると、利用者は引数を疑って実際の原因（pathが無い）へ
   * 到達できない。
   */
  if (result.launchFailure)
    return unknownObservation(
      provider,
      observedAt,
      "provider実行入口を起動できません",
      { args },
    );
  if (result.status !== 0)
    return unknownObservation(
      provider,
      observedAt,
      "provider実行入口のread-only観測が失敗しました",
      { args, exitCode: result.status },
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
            { args, exitCode: result.status },
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
            { args, exitCode: result.status },
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
            { args, exitCode: result.status },
          );
      }
      catalog = codexCatalog(result.stdout);
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
      { args, exitCode: result.status },
    );
  }
  if (!catalog)
    return unknownObservation(
      provider,
      observedAt,
      "provider model catalogの構造が不正です",
      { args, exitCode: result.status },
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
    entrypoint: provider === "codex" ? "codex app-server model/list" : provider,
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
