import {
  run,
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
) => ProcessResult;

interface ProviderCatalog {
  available: boolean;
  models: string[];
}

const PROVIDER_NAME = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const MODEL_SLUG = /^[a-z0-9][a-z0-9.-]{0,127}$/u;

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
    entrypoint: provider,
    reason,
  };
}

export function observeProvider(
  provider: string,
  execute: ProviderExecutor = run,
  now: () => Date = () => new Date(),
): ProviderAvailabilityObservation {
  const observedAt = now().toISOString();
  if (!PROVIDER_NAME.test(provider))
    return unknownObservation(
      provider,
      observedAt,
      "provider実行入口の名前が不正です",
    );
  let result: ProcessResult;
  try {
    result = execute(provider, ["models", "list", "--json"], process.cwd(), {
      allowFailure: true,
    });
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
    catalog = parseJsonStrict(result.stdout, "provider model catalog");
  } catch {
    return unknownObservation(
      provider,
      observedAt,
      "provider model catalogを解釈できません",
    );
  }
  if (!isProviderCatalog(catalog))
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
    entrypoint: provider,
  };
}
