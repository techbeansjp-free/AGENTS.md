import { parseJsonStrict } from "../lib/security.js";
import { type ProviderCapabilityMapping, isRecord } from "../types.js";

const SCHEMA_VERSION =
  "agent-skill-chain/provider-capability-mapping/v1" as const;
const SLUG = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const CAPABILITY = /^[a-z][a-z0-9_-]{0,63}$/u;

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

export function validateProviderCapabilityMapping(value: unknown) {
  const errors: string[] = [];
  if (!isRecord(value))
    return {
      valid: false,
      errors: ["provider capability mappingはobjectでなければなりません"],
    };
  if (!exactKeys(value, ["schemaVersion", "mappingVersion", "providers"]))
    errors.push(
      "provider capability mappingに未知fieldまたは不足fieldがあります",
    );
  if (value.schemaVersion !== SCHEMA_VERSION)
    errors.push("provider capability mappingのschemaVersionが不正です");
  if (
    typeof value.mappingVersion !== "string" ||
    value.mappingVersion.trim() === "" ||
    value.mappingVersion.length > 128
  )
    errors.push("provider capability mappingのmappingVersionが不正です");
  if (!Array.isArray(value.providers) || value.providers.length === 0) {
    errors.push("provider capability mappingのprovidersは1件以上必要です");
    return { valid: false, errors };
  }
  const providerNames = new Set<string>();
  for (const providerValue of value.providers as unknown[]) {
    if (!isRecord(providerValue)) {
      errors.push("provider capability mappingのproviderが不正です");
      continue;
    }
    if (!exactKeys(providerValue, ["provider", "models"]))
      errors.push("provider capability mappingのproviderに未知fieldがあります");
    const provider = providerValue.provider;
    if (typeof provider !== "string" || !SLUG.test(provider))
      errors.push("provider capability mappingのprovider名が不正です");
    else if (providerNames.has(provider))
      errors.push(
        `provider capability mappingのproviderが重複しています: ${provider}`,
      );
    else providerNames.add(provider);
    if (
      !Array.isArray(providerValue.models) ||
      providerValue.models.length === 0
    ) {
      errors.push("provider capability mappingのmodelsは1件以上必要です");
      continue;
    }
    const slugs = new Set<string>();
    let previousRank = 0;
    for (const modelValue of providerValue.models as unknown[]) {
      if (!isRecord(modelValue)) {
        errors.push("provider capability mappingのmodelが不正です");
        continue;
      }
      if (!exactKeys(modelValue, ["slug", "capabilities", "rank"]))
        errors.push("provider capability mappingのmodelに未知fieldがあります");
      const slug = modelValue.slug;
      if (typeof slug !== "string" || !SLUG.test(slug))
        errors.push("provider capability mappingのmodel slugが不正です");
      else if (slugs.has(slug))
        errors.push(
          `provider capability mappingのmodel slugが重複しています: ${slug}`,
        );
      else slugs.add(slug);
      const capabilities = modelValue.capabilities;
      if (
        !Array.isArray(capabilities) ||
        capabilities.length === 0 ||
        capabilities.some(
          (capability) =>
            typeof capability !== "string" || !CAPABILITY.test(capability),
        ) ||
        new Set(capabilities).size !== capabilities.length
      )
        errors.push("provider capability mappingのcapabilitiesが不正です");
      const rank = modelValue.rank;
      if (
        typeof rank !== "number" ||
        !Number.isInteger(rank) ||
        rank < 1 ||
        rank <= previousRank
      )
        errors.push(
          "provider capability mappingのrankは整数の昇順でなければなりません",
        );
      else previousRank = rank;
    }
  }
  return { valid: errors.length === 0, errors };
}

export function isProviderCapabilityMapping(
  value: unknown,
): value is ProviderCapabilityMapping {
  return validateProviderCapabilityMapping(value).valid;
}

export function readProviderCapabilityMapping(
  source: string,
): ProviderCapabilityMapping {
  const value: unknown = parseJsonStrict(source, "provider capability mapping");
  const validation = validateProviderCapabilityMapping(value);
  if (!validation.valid)
    throw new Error(
      `provider capability mappingが不正です: ${validation.errors.join("; ")}`,
    );
  return value as ProviderCapabilityMapping;
}
