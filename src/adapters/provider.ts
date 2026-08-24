import {
  run,
  runJsonlSession,
  type ProcessOptions,
  type ProcessResult,
} from "../lib/process.js";
import { parseJsonStrict } from "../lib/security.js";
import { isRecord } from "../types.js";

export type ProviderAvailabilityState = "available" | "unavailable" | "unknown";

export interface ProviderAvailabilityObservation {
  provider: string;
  state: ProviderAvailabilityState;
  models: string[];
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

function hasCodexResponse(stdout: string): boolean {
  try {
    return parseJsonLines(stdout).some(
      (message) => isRecord(message) && message.id === CODEX_RESPONSE_ID,
    );
  } catch {
    return false;
  }
}

function codexInput(): string {
  return [
    {
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "agent-skill-chain",
          title: "agent-skill-chain",
          version: "0.3.1",
        },
      },
    },
    { method: "initialized", params: {} },
    {
      method: "model/list",
      id: CODEX_RESPONSE_ID,
      params: { limit: 1000, includeHidden: false },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join("\n")
    .concat("\n");
}

function codexCatalog(stdout: string): ProviderCatalog | undefined {
  const response = parseJsonLines(stdout).find(
    (message) => isRecord(message) && message.id === CODEX_RESPONSE_ID,
  );
  if (!isRecord(response) || !isRecord(response.result)) return undefined;
  const result = response.result;
  if (
    !Array.isArray(result.data) ||
    (result.nextCursor !== null && result.nextCursor !== undefined)
  )
    return undefined;
  const models = result.data.map((entry) =>
    isRecord(entry) ? entry.model : undefined,
  );
  if (
    models.some(
      (model) => typeof model !== "string" || !MODEL_SLUG.test(model),
    ) ||
    new Set(models).size !== models.length
  )
    return undefined;
  return { available: models.length > 0, models: models as string[] };
}

async function defaultExecutor(
  file: string,
  args: string[],
  cwd: string,
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (file !== "codex") return run(file, args, cwd, options);
  return runJsonlSession(file, args, cwd, {
    ...options,
    input: codexInput(),
    timeoutMs: PROVIDER_TIMEOUT_MS,
    isComplete: hasCodexResponse,
  });
}

function isProviderCatalog(value: unknown): value is ProviderCatalog {
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
    observedAt,
    entrypoint: provider === "codex" ? "codex app-server model/list" : provider,
    reason,
  };
}

export async function observeProvider(
  provider: string,
  execute: ProviderExecutor = defaultExecutor,
  now: () => Date = () => new Date(),
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
    result = await execute(
      provider,
      provider === "codex"
        ? ["app-server", "--stdio"]
        : ["models", "list", "--json"],
      process.cwd(),
      { allowFailure: true },
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
  let catalog: unknown;
  try {
    catalog =
      provider === "codex"
        ? codexCatalog(result.stdout)
        : parseJsonStrict(result.stdout, "provider model catalog");
  } catch {
    return unknownObservation(
      provider,
      observedAt,
      "provider model catalogを解釈できません",
    );
  }
  if (!catalog || !isProviderCatalog(catalog))
    return unknownObservation(
      provider,
      observedAt,
      "provider model catalogの構造が不正です",
    );
  return {
    provider,
    state: catalog.available ? "available" : "unavailable",
    models: [...catalog.models],
    observedAt,
    entrypoint: provider === "codex" ? "codex app-server model/list" : provider,
  };
}
