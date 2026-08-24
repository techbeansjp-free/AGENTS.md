import { parseJsonStrict } from "../lib/security.js";
import { type ProviderCapabilityMapping, isRecord } from "../types.js";

const SCHEMA_VERSION =
  "agent-skill-chain/provider-capability-mapping/v2" as const;
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
    if (
      !exactKeys(providerValue, ["provider", "capabilities", "selectionSource"])
    )
      errors.push("provider capability mappingのproviderに未知fieldがあります");
    const provider = providerValue.provider;
    if (typeof provider !== "string" || !SLUG.test(provider))
      errors.push("provider capability mappingのprovider名が不正です");
    else if (providerNames.has(provider))
      errors.push(
        `provider capability mappingのproviderが重複しています: ${provider}`,
      );
    else providerNames.add(provider);
    const capabilities = providerValue.capabilities;
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
    if (providerValue.selectionSource !== "provider_recommended_default")
      errors.push("provider capability mappingのselectionSourceが不正です");
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
