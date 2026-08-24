import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import {
  resolveEffectivePolicy,
  validateEnforcementPolicy,
} from "./enforcement.js";
import crypto from "node:crypto";
import {
  parseJsonStrict,
  resolveContained,
  stableJson,
} from "../lib/security.js";
import { findPackageRoot } from "../lib/package-root.js";
import { validateProjectConformanceBinding } from "./conformance.js";
import {
  COMPATIBLE_POLICY_SCHEMA_VERSIONS,
  CURRENT_POLICY_SCHEMA_VERSION,
  DEPRECATED_POLICY_SCHEMA_ALIASES,
  SUPPORTED_POLICY_SCHEMA_VERSIONS,
} from "../lib/version.js";
import {
  type Policy,
  type ProviderCapabilityMapping,
  type ProjectChoices,
  type Rule,
  isRecord,
} from "../types.js";
import { validateProviderCapabilityMapping } from "./provider-capability.js";

const PROJECT_CHOICE_FIELDS = [
  "language",
  "testRunner",
  "gherkinDialect",
  "testLayers",
  "forbiddenTestFileSuffixes",
  "naming",
  "packageManager",
  "runtime",
  "ci",
  "modelMapping",
  "release",
  "projectKind",
  "capabilities",
  "quality",
] as const;

const packageRoot = findPackageRoot(import.meta.url);
const policyVersionLabel = (version: string): string =>
  version.replace("agent-skill-chain/project-policy/v", "v");
const currentPolicyVersionLabel = policyVersionLabel(
  CURRENT_POLICY_SCHEMA_VERSION,
);
const compatiblePolicyVersionLabels =
  COMPATIBLE_POLICY_SCHEMA_VERSIONS.map(policyVersionLabel).join("、");

function rejectUnknownKeys(
  value: unknown,
  allowed: string[],
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${prefix}はobjectでなければなりません`);
    return;
  }
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) errors.push(`${prefix}.${key}は未知fieldです`);
}

function validateStringArray(
  value: unknown,
  name: string,
  errors: string[],
  options: { allowed?: string[]; min?: number; max?: number } = {},
): void {
  if (!Array.isArray(value)) {
    errors.push(`${name}は配列でなければなりません`);
    return;
  }
  const items = value as unknown[];
  if (options.min !== undefined && items.length < options.min)
    errors.push(`${name}は${options.min}件以上でなければなりません`);
  if (options.max !== undefined && items.length > options.max)
    errors.push(`${name}は${options.max}件以内でなければなりません`);
  if (items.some((item) => typeof item !== "string" || item.length === 0))
    errors.push(`${name}には空でない文字列だけを指定してください`);
  if (
    options.allowed &&
    items.some(
      (item) => typeof item !== "string" || !options.allowed?.includes(item),
    )
  )
    errors.push(`${name}に許可されていない値があります`);
  if (new Set(items).size !== items.length)
    errors.push(`${name}に重複があります`);
}

function hasConcreteDecisionText(value: unknown, minimum: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    !/^(?:-|なし|未定|不明|x+)$/iu.test(value.trim()) &&
    !/[（{][^）}]+[）}]/u.test(value)
  );
}

function validateApplicabilityDecision(
  value: unknown,
  name: string,
  errors: string[],
): void {
  rejectUnknownKeys(value, ["status", "reason", "evidence"], name, errors);
  const record = isRecord(value) ? value : {};
  if (record.status !== "applicable" && record.status !== "not-applicable")
    errors.push(`${name}.statusが不正です`);
  for (const [field, minimum] of [
    ["reason", 8],
    ["evidence", 4],
  ] as const)
    if (!hasConcreteDecisionText(record[field], minimum))
      errors.push(`${name}.${field}を具体化してください`);
}

function validatePositiveInteger(
  value: unknown,
  name: string,
  errors: string[],
): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    errors.push(`${name}は1以上の整数でなければなりません`);
}

function validateModelMapping(value: unknown, errors: string[]): void {
  rejectUnknownKeys(
    value,
    ["roles", "evidenceStoreRoot", "retention"],
    "modelMapping",
    errors,
  );
  const mapping = isRecord(value) ? value : {};
  rejectUnknownKeys(
    mapping.roles,
    ["coordinator", "implementer", "reviewer"],
    "modelMapping.roles",
    errors,
  );
  const roles = isRecord(mapping.roles) ? mapping.roles : {};
  for (const role of ["coordinator", "implementer", "reviewer"] as const) {
    const name = `modelMapping.roles.${role}`;
    const roleChoice = roles[role];
    rejectUnknownKeys(
      roleChoice,
      ["provider", "logicalTier", "reasoningEffort", "speed"],
      name,
      errors,
    );
    const record = isRecord(roleChoice) ? roleChoice : {};
    if (typeof record.provider !== "string" || record.provider.trim() === "")
      errors.push(`${name}.providerは空でない文字列でなければなりません`);
    if (
      record.logicalTier !== "project_default" &&
      record.logicalTier !== "highest_available"
    )
      errors.push(`${name}.logicalTierが不正です`);
    if (record.reasoningEffort !== "high")
      errors.push(`${name}.reasoningEffortはhighでなければなりません`);
    if (record.speed !== "standard")
      errors.push(`${name}.speedはstandardでなければなりません`);
  }
  if (
    typeof mapping.evidenceStoreRoot !== "string" ||
    mapping.evidenceStoreRoot !== mapping.evidenceStoreRoot.normalize("NFC") ||
    !/^(?!\/)(?!\.\.\/)(?!.*\/\.\.\/)(?!.*\\)(?:[A-Za-z0-9._-]+\/)+$/u.test(
      mapping.evidenceStoreRoot,
    )
  )
    errors.push(
      "modelMapping.evidenceStoreRootは安全なrepository相対directoryでなければなりません",
    );
  const retentionName = "modelMapping.retention";
  rejectUnknownKeys(
    mapping.retention,
    [
      "retentionDays",
      "maxRecordsPerIssue",
      "maxRecordBytes",
      "rotationCondition",
      "deletionMethod",
    ],
    retentionName,
    errors,
  );
  const retention = isRecord(mapping.retention) ? mapping.retention : {};
  for (const field of [
    "retentionDays",
    "maxRecordsPerIssue",
    "maxRecordBytes",
  ] as const)
    validatePositiveInteger(
      retention[field],
      `${retentionName}.${field}`,
      errors,
    );
  for (const field of ["rotationCondition", "deletionMethod"] as const)
    if (typeof retention[field] !== "string" || retention[field].trim() === "")
      errors.push(
        `${retentionName}.${field}は空でない文字列でなければなりません`,
      );
}

export function validateProjectChoices(value: unknown) {
  const errors: string[] = [];
  rejectUnknownKeys(
    value,
    [...PROJECT_CHOICE_FIELDS],
    "projectChoices",
    errors,
  );
  const projectChoices = isRecord(value) ? value : {};
  for (const field of [
    "language",
    "testRunner",
    "gherkinDialect",
    "naming",
    "packageManager",
    "runtime",
    "ci",
    "release",
    "projectKind",
  ] as const)
    if (
      typeof projectChoices[field] !== "string" ||
      projectChoices[field].trim() === ""
    )
      errors.push(
        `projectChoices.${field}は空でない文字列でなければなりません`,
      );
  validateStringArray(
    projectChoices.testLayers,
    "projectChoices.testLayers",
    errors,
    { min: 1 },
  );
  validateStringArray(
    projectChoices.forbiddenTestFileSuffixes,
    "projectChoices.forbiddenTestFileSuffixes",
    errors,
  );
  if (
    Array.isArray(projectChoices.forbiddenTestFileSuffixes) &&
    projectChoices.forbiddenTestFileSuffixes.some(
      (suffix) =>
        typeof suffix !== "string" || !/^\.[A-Za-z0-9._-]+$/u.test(suffix),
    )
  )
    errors.push("projectChoices.forbiddenTestFileSuffixesが不正です");
  if (projectChoices.modelMapping !== undefined)
    validateModelMapping(projectChoices.modelMapping, errors);
  const capabilities = isRecord(projectChoices.capabilities)
    ? projectChoices.capabilities
    : {};
  const capabilityFields = [
    "privacySecurity",
    "observability",
    "humanCenteredUi",
    "designTokens",
  ] as const;
  rejectUnknownKeys(
    projectChoices.capabilities,
    [...capabilityFields],
    "projectChoices.capabilities",
    errors,
  );
  for (const field of capabilityFields)
    validateApplicabilityDecision(
      capabilities[field],
      `projectChoices.capabilities.${field}`,
      errors,
    );
  const quality = isRecord(projectChoices.quality)
    ? projectChoices.quality
    : {};
  const qualityFields = [
    "implementationLanguage",
    "strictTypecheck",
    "forbiddenTypes",
    "lintCommand",
    "formatCheckCommand",
    "formatWriteCommand",
    "typecheckCommand",
    "runtimeValidation",
    "auxiliaryLanguages",
  ];
  rejectUnknownKeys(
    projectChoices.quality,
    qualityFields,
    "projectChoices.quality",
    errors,
  );
  for (const field of [
    "implementationLanguage",
    "lintCommand",
    "formatCheckCommand",
    "formatWriteCommand",
    "typecheckCommand",
    "runtimeValidation",
  ])
    if (typeof quality[field] !== "string" || quality[field].trim() === "")
      errors.push(
        `projectChoices.quality.${field}は空でない文字列でなければなりません`,
      );
  if (quality.strictTypecheck !== true)
    errors.push(
      "projectChoices.quality.strictTypecheckはtrueでなければなりません",
    );
  validateStringArray(
    quality.forbiddenTypes,
    "projectChoices.quality.forbiddenTypes",
    errors,
    { min: 1 },
  );
  const auxiliaryLanguages = isRecord(quality.auxiliaryLanguages)
    ? quality.auxiliaryLanguages
    : {};
  if (!isRecord(quality.auxiliaryLanguages))
    errors.push(
      "projectChoices.quality.auxiliaryLanguagesはobjectでなければなりません",
    );
  for (const [language, decision] of Object.entries(auxiliaryLanguages))
    validateApplicabilityDecision(
      decision,
      `projectChoices.quality.auxiliaryLanguages.${language}`,
      errors,
    );
  return { valid: errors.length === 0, errors };
}

export function isProjectChoices(value: unknown): value is ProjectChoices {
  return validateProjectChoices(value).valid;
}

export function readProjectChoices(source: string): ProjectChoices {
  const value: unknown = parseJsonStrict(source, "project choice");
  const validation = validateProjectChoices(value);
  if (!validation.valid)
    throw new Error(
      `project choiceが不正です: ${validation.errors.join("; ")}`,
    );
  return value as ProjectChoices;
}

export function validatePolicy(policy: unknown) {
  const errors: string[] = [];
  const candidate = isRecord(policy) ? policy : {};
  const delivery = isRecord(candidate.delivery) ? candidate.delivery : {};
  const merge = isRecord(candidate.merge) ? candidate.merge : {};
  const budgets = isRecord(candidate.budgets) ? candidate.budgets : {};
  const projectChoices = isRecord(candidate.projectChoices)
    ? candidate.projectChoices
    : undefined;
  rejectUnknownKeys(
    policy,
    [
      "schemaVersion",
      "delivery",
      "merge",
      "rules",
      "budgets",
      "projectChoices",
    ],
    "policy",
    errors,
  );
  rejectUnknownKeys(candidate.delivery, ["stopAt"], "delivery", errors);
  rejectUnknownKeys(
    candidate.merge,
    ["mode", "branches", "methods", "requiredChecks", "requiredReviews"],
    "merge",
    errors,
  );
  const schemaVersion = candidate.schemaVersion;
  const deprecatedAliasTarget =
    typeof schemaVersion === "string" &&
    Object.prototype.hasOwnProperty.call(
      DEPRECATED_POLICY_SCHEMA_ALIASES,
      schemaVersion,
    )
      ? DEPRECATED_POLICY_SCHEMA_ALIASES[schemaVersion]
      : undefined;
  const compatibleInput =
    typeof schemaVersion === "string" &&
    (COMPATIBLE_POLICY_SCHEMA_VERSIONS.includes(schemaVersion) ||
      (typeof deprecatedAliasTarget === "string" &&
        COMPATIBLE_POLICY_SCHEMA_VERSIONS.includes(deprecatedAliasTarget)));
  if (
    typeof schemaVersion !== "string" ||
    (!SUPPORTED_POLICY_SCHEMA_VERSIONS.includes(schemaVersion) &&
      !deprecatedAliasTarget)
  )
    errors.push(
      `schemaVersionが未対応です。${currentPolicyVersionLabel}へのstaged migrationを実行してください`,
    );
  if (
    compatibleInput &&
    (candidate.rules !== undefined ||
      candidate.budgets !== undefined ||
      candidate.projectChoices !== undefined)
  )
    errors.push(
      `${compatiblePolicyVersionLabels}ではrules、budgets、projectChoicesを使用できません。${currentPolicyVersionLabel}へstaged migrationしてください`,
    );
  if (delivery.stopAt !== "pull_request")
    errors.push("delivery.stopAtはpull_requestでなければなりません");
  if (
    !["disabled", "assisted", "automatic"].some((value) => value === merge.mode)
  )
    errors.push("merge.modeが不正です");
  validateStringArray(merge.branches, "merge.branches", errors, { max: 32 });
  validateStringArray(merge.methods, "merge.methods", errors, {
    allowed: ["merge", "squash", "rebase"],
  });
  validateStringArray(merge.requiredChecks, "merge.requiredChecks", errors);
  if (
    typeof merge.requiredReviews !== "number" ||
    !Number.isInteger(merge.requiredReviews) ||
    merge.requiredReviews < 0 ||
    merge.requiredReviews > 20
  )
    errors.push("merge.requiredReviewsが不正です");
  const forbidden = [
    "deleteBranch",
    "closeIssue",
    "release",
    "finalize",
    "cleanup",
  ];
  for (const key of forbidden)
    if (merge[key] === true)
      errors.push(`マージ権限へ${key}を含めてはいけません`);
  if (schemaVersion === CURRENT_POLICY_SCHEMA_VERSION) {
    rejectUnknownKeys(
      candidate.budgets,
      ["localFeedbackMs", "prGateMs"],
      "budgets",
      errors,
    );
    for (const key of ["localFeedbackMs", "prGateMs"])
      if (
        typeof budgets[key] !== "number" ||
        !Number.isInteger(budgets[key]) ||
        budgets[key] < 1
      )
        errors.push(`budgets.${key}は1以上の整数でなければなりません`);
    const enforcement = validateEnforcementPolicy(policy);
    errors.push(...enforcement.errors);
    if (projectChoices !== undefined)
      errors.push(...validateProjectChoices(projectChoices).errors);
  }
  const migration =
    compatibleInput ||
    errors.some(
      (error) => error.includes("schemaVersion") || error.includes("未知field"),
    )
      ? {
          target: CURRENT_POLICY_SCHEMA_VERSION,
          activation: "staged",
          deprecatedAlias:
            deprecatedAliasTarget && typeof schemaVersion === "string"
              ? { input: schemaVersion, canonical: deprecatedAliasTarget }
              : undefined,
          remediation:
            "policy、schema、runtime、CI、templateを同一migrationで更新してください",
          rollback: "入力policyを変更せずtrusted版を保持する",
        }
      : undefined;
  return {
    valid: errors.length === 0,
    errors,
    migration,
    diagnostics: errors.length
      ? [
          {
            ruleId: "ASC-POLICY-INVALID",
            purpose: "schemaとruntimeのpolicy契約を一致させる",
            risk: "unknown",
            reasons: errors,
            scope: ["policy"],
            checks: ["schemaVersion、未知field、rules、budgetsを確認した"],
            autoFixes: [
              {
                description: `${currentPolicyVersionLabel} staged migrationを作る`,
                dryRunDiff: `schemaVersionとrulesを${currentPolicyVersionLabel}形式へ更新する`,
              },
            ],
            next: "migrationをdry-runしてから適用してください",
            requiredAuthority: "project policy owner",
            rollback: "trusted policyを保持する",
          },
        ]
      : [],
  };
}

const MANIFEST_VERSION = "agent-skill-chain/project-policy-manifest/v1";
const CONTROL = /[\p{Cc}\p{Cf}]/u;

export interface PolicyManifest {
  schemaVersion: typeof MANIFEST_VERSION;
  policy: Omit<Policy, "rules" | "projectChoices">;
  choiceFiles: string[];
  ruleFiles: string[];
  conformanceFiles: string[];
  providerFiles?: string[];
  conformanceDirectory: "project/conformance";
}

interface Fragment {
  value: unknown;
  raw: string;
}
export interface PolicySet {
  policy: Policy;
  hash: string;
  setHash: string;
  setEntries: string[][];
  rawEntries: Record<string, string>;
  semanticPolicyHash: string;
  provenance: Record<string, unknown>;
  manifest: PolicyManifest | Policy;
  choices: ProjectChoices[];
  providerMappings: ProviderCapabilityMapping[];
  rules: Rule[];
}

interface ProviderObservation {
  repository: string;
  prNumber: number;
  baseRefName: string;
  defaultBranch: string;
  baseRefOid: string;
  headRefOid: string;
  defaultBranchTipOid: string;
  provenance: { source: string; repository: string; prNumber: number };
}

function requirePolicy(value: unknown, label: string): Policy {
  const validation = validatePolicy(value);
  if (!validation.valid)
    throw new Error(`${label}が不正です: ${validation.errors.join("; ")}`);
  return value as Policy;
}

function requireManifest(value: unknown): PolicyManifest {
  const validation = validateProjectPolicyManifest(value);
  if (!validation.valid)
    throw new Error(
      `project policy manifestが不正です: ${validation.errors.join("; ")}`,
    );
  return value as PolicyManifest;
}

export function validateProjectPolicyManifest(manifest: unknown) {
  const errors: string[] = [];
  rejectUnknownKeys(
    manifest,
    [
      "schemaVersion",
      "policy",
      "choiceFiles",
      "ruleFiles",
      "conformanceFiles",
      "providerFiles",
      "conformanceDirectory",
    ],
    "manifest",
    errors,
  );
  if (!isRecord(manifest)) return { valid: false, errors };
  const policy = isRecord(manifest.policy) ? manifest.policy : {};
  const delivery = isRecord(policy.delivery) ? policy.delivery : {};
  const merge = isRecord(policy.merge) ? policy.merge : {};
  const budgets = isRecord(policy.budgets) ? policy.budgets : {};
  if (manifest.schemaVersion !== MANIFEST_VERSION)
    errors.push("manifest schemaVersionが不正です");
  rejectUnknownKeys(
    manifest.policy,
    ["schemaVersion", "delivery", "merge", "budgets"],
    "manifest.policy",
    errors,
  );
  rejectUnknownKeys(
    policy.delivery,
    ["stopAt"],
    "manifest.policy.delivery",
    errors,
  );
  rejectUnknownKeys(
    policy.merge,
    ["mode", "branches", "methods", "requiredChecks", "requiredReviews"],
    "manifest.policy.merge",
    errors,
  );
  rejectUnknownKeys(
    policy.budgets,
    ["localFeedbackMs", "prGateMs"],
    "manifest.policy.budgets",
    errors,
  );
  if (policy.schemaVersion !== CURRENT_POLICY_SCHEMA_VERSION)
    errors.push("manifest.policy.schemaVersionが不正です");
  if (delivery.stopAt !== "pull_request")
    errors.push("manifest.policy.delivery.stopAtが不正です");
  if (
    !["disabled", "assisted", "automatic"].some((value) => value === merge.mode)
  )
    errors.push("manifest.policy.merge.modeが不正です");
  validateStringArray(
    merge.branches,
    "manifest.policy.merge.branches",
    errors,
    { max: 32 },
  );
  validateStringArray(merge.methods, "manifest.policy.merge.methods", errors, {
    allowed: ["merge", "squash", "rebase"],
  });
  validateStringArray(
    merge.requiredChecks,
    "manifest.policy.merge.requiredChecks",
    errors,
  );
  const requiredReviews = merge.requiredReviews;
  if (
    typeof requiredReviews !== "number" ||
    !Number.isInteger(requiredReviews) ||
    requiredReviews < 0 ||
    requiredReviews > 20
  )
    errors.push("manifest.policy.merge.requiredReviewsが不正です");
  for (const key of ["localFeedbackMs", "prGateMs"]) {
    const value = budgets[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
      errors.push(`manifest.policy.budgets.${key}が不正です`);
  }
  const choiceFiles: unknown[] = Array.isArray(manifest.choiceFiles)
    ? (manifest.choiceFiles as unknown[])
    : [];
  const ruleFiles: unknown[] = Array.isArray(manifest.ruleFiles)
    ? (manifest.ruleFiles as unknown[])
    : [];
  const conformanceFiles: unknown[] = Array.isArray(manifest.conformanceFiles)
    ? (manifest.conformanceFiles as unknown[])
    : [];
  const providerFiles: unknown[] = Array.isArray(manifest.providerFiles)
    ? (manifest.providerFiles as unknown[])
    : [];
  const references = [
    ...choiceFiles,
    ...ruleFiles,
    ...conformanceFiles,
    ...providerFiles,
  ];
  if (
    !Array.isArray(manifest?.choiceFiles) ||
    manifest.choiceFiles.length !== 1
  )
    errors.push("choiceFilesは1件の配列でなければなりません");
  if (!Array.isArray(manifest?.ruleFiles) || manifest.ruleFiles.length === 0)
    errors.push("ruleFilesは1件以上の配列でなければなりません");
  if (
    !Array.isArray(manifest?.conformanceFiles) ||
    manifest.conformanceFiles.length === 0
  )
    errors.push("conformanceFilesは1件以上の配列でなければなりません");
  if (ruleFiles.length > 126)
    errors.push("ruleFilesは126件以内でなければなりません");
  if (conformanceFiles.length > 126)
    errors.push("conformanceFilesは126件以内でなければなりません");
  if (providerFiles.length > 126)
    errors.push("providerFilesは126件以内でなければなりません");
  for (const reference of references)
    if (
      typeof reference !== "string" ||
      reference === "" ||
      path.isAbsolute(reference) ||
      reference.includes("..") ||
      reference.includes("\\") ||
      CONTROL.test(reference) ||
      reference !== reference.normalize("NFC") ||
      !/^project\/(?:choices|rules|conformance|providers)\/[a-z0-9][a-z0-9.-]*\.json$/u.test(
        reference,
      )
    )
      errors.push(`project fragment pathが不正です: ${String(reference)}`);
  for (const list of [choiceFiles, ruleFiles, conformanceFiles, providerFiles])
    if (stableJson(list) !== stableJson([...list].sort()))
      errors.push("project fragment pathは字句順でなければなりません");
  const keys = references.map((reference) =>
    typeof reference === "string"
      ? reference.normalize("NFC").toLocaleLowerCase("und")
      : String(reference),
  );
  if (new Set(keys).size !== keys.length)
    errors.push("project fragment pathが重複またはUnicode/case衝突しています");
  if (
    typeof manifest?.conformanceDirectory !== "string" ||
    manifest.conformanceDirectory !== "project/conformance"
  )
    errors.push(
      "conformanceDirectoryはproject/conformanceでなければなりません",
    );
  return { valid: errors.length === 0, errors };
}

function assemblePolicySet(
  manifest: PolicyManifest,
  manifestRaw: string,
  reader: (relative: string) => Fragment,
  inventory: string[],
  provenance: Record<string, unknown> = {},
): PolicySet {
  const manifestValidation = validateProjectPolicyManifest(manifest);
  if (!manifestValidation.valid)
    throw new Error(
      `project policy manifestが不正です: ${manifestValidation.errors.join("; ")}`,
    );
  const expected = [
    ...manifest.choiceFiles,
    ...manifest.ruleFiles,
    ...manifest.conformanceFiles,
    ...(manifest.providerFiles ?? []),
  ].sort();
  const actual = [...inventory].sort();
  if (stableJson(expected) !== stableJson(actual))
    throw new Error(
      `project directory inventoryがmanifestと一致しません: expected=${expected.join(",")} actual=${actual.join(",")}`,
    );
  const entries: Record<string, Fragment> = Object.fromEntries(
    expected.map((relative) => [relative, reader(relative)]),
  );
  for (const [relative, entry] of Object.entries(entries))
    if (entry.raw.length > 1024 * 1024)
      throw new Error(`project fragmentが1 MiBを超えています: ${relative}`);
  const choices = manifest.choiceFiles.map(
    (relative) => entries[relative]!.value as ProjectChoices,
  );
  const rules = manifest.ruleFiles.map(
    (relative) => entries[relative]!.value as Rule,
  );
  const providerMappings = (manifest.providerFiles ?? []).map(
    (relative) => entries[relative]!.value as ProviderCapabilityMapping,
  );
  for (const relative of manifest.providerFiles ?? []) {
    const mapping = entries[relative]!.value;
    const validation = validateProviderCapabilityMapping(mapping);
    manifestValidation.errors.push(
      ...validation.errors.map((error) => `${relative}: ${error}`),
    );
  }
  for (const relative of manifest.conformanceFiles) {
    const binding = entries[relative]!.value;
    const validation = validateProjectConformanceBinding(binding);
    manifestValidation.errors.push(
      ...validation.errors.map((error) => `${relative}: ${error}`),
    );
  }
  if (manifestValidation.errors.length)
    throw new Error(
      `project fragmentが不正です: ${manifestValidation.errors.join("; ")}`,
    );
  const policy: Policy = {
    ...manifest.policy,
    projectChoices: choices[0],
    rules,
  };
  const validation = validatePolicy(policy);
  if (!validation.valid)
    throw new Error(
      `canonical project policy setが不正です: ${validation.errors.join("; ")}`,
    );
  const hashedEntries: string[][] = [
    [
      "project-policy.json",
      crypto.createHash("sha256").update(manifestRaw).digest("hex"),
    ],
    ...expected.map((relative) => [
      relative,
      crypto.createHash("sha256").update(entries[relative]!.raw).digest("hex"),
    ]),
  ];
  const setHash = crypto
    .createHash("sha256")
    .update(
      stableJson({
        domain: "agent-skill-chain/project-policy-set/v1",
        entries: hashedEntries,
      }),
    )
    .digest("hex");
  const semanticPolicyHash = crypto
    .createHash("sha256")
    .update(stableJson(policy))
    .digest("hex");
  const rawEntries: Record<string, string> = {
    "project-policy.json": manifestRaw,
  };
  for (const relative of expected)
    rawEntries[relative] = entries[relative]!.raw;
  return {
    policy,
    hash: setHash,
    setHash,
    setEntries: hashedEntries,
    rawEntries,
    semanticPolicyHash,
    provenance,
    manifest,
    choices,
    providerMappings,
    rules,
  };
}

export function loadProjectPolicySet(root: string): PolicySet {
  const namespace = path.join(root, ".agent-skill-chain");
  const manifestFile = resolveContained(
    root,
    ".agent-skill-chain/project-policy.json",
  );
  const manifestRaw = fs.readFileSync(manifestFile, "utf8");
  const manifest = parseJsonStrict(manifestRaw, "project policy manifest");
  if (isRecord(manifest) && manifest.schemaVersion !== MANIFEST_VERSION) {
    if (fs.existsSync(path.join(namespace, "project")))
      throw new Error("legacy monolithとproject directoryの混在を拒否しました");
    const policy = requirePolicy(manifest, "legacy project policy");
    const semanticPolicyHash = crypto
      .createHash("sha256")
      .update(stableJson(manifest))
      .digest("hex");
    return {
      policy,
      hash: semanticPolicyHash,
      setHash: semanticPolicyHash,
      setEntries: [
        [
          "project-policy.json",
          crypto.createHash("sha256").update(manifestRaw).digest("hex"),
        ],
      ],
      rawEntries: { "project-policy.json": manifestRaw },
      semanticPolicyHash,
      provenance: { source: "filesystem-legacy" },
      manifest: policy,
      choices: policy.projectChoices ? [policy.projectChoices] : [],
      providerMappings: [],
      rules: policy.rules,
    };
  }
  const projectRoot = path.join(namespace, "project");
  if (
    !fs.existsSync(projectRoot) ||
    fs.lstatSync(projectRoot).isSymbolicLink() ||
    !fs.statSync(projectRoot).isDirectory()
  )
    throw new Error(
      "project inventory rootは通常directoryでなければなりません",
    );
  const allowedDirectories = ["choices", "rules", "conformance", "providers"];
  for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true }))
    if (
      !allowedDirectories.includes(entry.name) ||
      !entry.isDirectory() ||
      entry.isSymbolicLink()
    )
      throw new Error(
        `project inventoryに未知または不正なdirectoryがあります: project/${entry.name}`,
      );
  const inventory: string[] = [];
  for (const directory of allowedDirectories) {
    const current = path.join(projectRoot, directory);
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error(
          `project inventoryに通常JSON file以外があります: project/${directory}/${entry.name}`,
        );
      const file = path.join(current, entry.name);
      if ((fs.statSync(file).mode & 0o111) !== 0)
        throw new Error(
          `project fragmentに実行権限は不要です: project/${directory}/${entry.name}`,
        );
      inventory.push(`project/${directory}/${entry.name}`);
    }
  }
  return assemblePolicySet(
    requireManifest(manifest),
    manifestRaw,
    (relative) => {
      const file = resolveContained(namespace, relative);
      let current = namespace;
      for (const part of relative.split("/")) {
        current = path.join(current, part);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
          throw new Error(`project fragmentにsymlinkは使えません: ${relative}`);
      }
      const raw = fs.readFileSync(file, "utf8");
      return { value: parseJsonStrict(raw, relative), raw };
    },
    inventory,
    { source: "filesystem" },
  );
}

/** Read a project policy set from one fixed Git commit without assigning authority semantics. */
export function loadProjectPolicySetAtCommit(
  root: string,
  ref: string,
): PolicySet {
  const resolved = git(["rev-parse", "--verify", `${ref}^{commit}`], root, {
    allowFailure: true,
  });
  if (resolved.status !== 0)
    throw new Error(`${ref}を固定Git commit SHAへ解決できません`);
  const commitSha = resolved.stdout.trim();
  const show = (relative: string): Fragment => {
    const full = `.agent-skill-chain/${relative}`;
    const mode = git(["ls-tree", commitSha, full], root, {
      allowFailure: true,
    });
    if (mode.status !== 0 || !mode.stdout.trim().startsWith("100644 blob "))
      throw new Error(
        `${commitSha}のproject fragmentが通常fileではありません: ${relative}`,
      );
    const result = git(["show", `${commitSha}:${full}`], root, {
      allowFailure: true,
    });
    if (result.status !== 0)
      throw new Error(
        `${commitSha}のproject fragmentを読めません: ${relative}`,
      );
    return {
      value: parseJsonStrict(result.stdout, `${commitSha}:${full}`),
      raw: result.stdout,
    };
  };
  const manifestResult = show("project-policy.json");
  const manifest = manifestResult.value;
  const tree = git(
    ["ls-tree", "-r", commitSha, ".agent-skill-chain/project"],
    root,
    { allowFailure: true },
  );
  const treeLines =
    tree.status === 0 ? tree.stdout.split("\n").filter(Boolean) : [];
  if (isRecord(manifest) && manifest.schemaVersion !== MANIFEST_VERSION) {
    if (treeLines.length)
      throw new Error("legacy monolithとproject directoryの混在を拒否しました");
    const policy = requirePolicy(manifest, "legacy project policy");
    const semanticPolicyHash = crypto
      .createHash("sha256")
      .update(stableJson(manifest))
      .digest("hex");
    return {
      policy,
      hash: semanticPolicyHash,
      setHash: semanticPolicyHash,
      setEntries: [
        [
          "project-policy.json",
          crypto.createHash("sha256").update(manifestResult.raw).digest("hex"),
        ],
      ],
      rawEntries: { "project-policy.json": manifestResult.raw },
      semanticPolicyHash,
      provenance: { source: "git-legacy", commitSha },
      manifest: policy,
      choices: policy.projectChoices ? [policy.projectChoices] : [],
      providerMappings: [],
      rules: policy.rules,
    };
  }
  for (const line of treeLines)
    if (!line.startsWith("100644 blob "))
      throw new Error(
        `project inventoryにsymlink、gitlink、実行fileがあります: ${line}`,
      );
  const inventory = treeLines.map((line) =>
    line.slice(line.indexOf("\t") + 1).replace(/^\.agent-skill-chain\//, ""),
  );
  return assemblePolicySet(
    requireManifest(manifest),
    manifestResult.raw,
    show,
    inventory,
    { source: "git", commitSha },
  );
}

/** Compatibility wrapper for callers that already resolved a trusted ref. */
export function loadTrustedProjectPolicySet(
  root: string,
  ref: string,
): PolicySet {
  return loadProjectPolicySetAtCommit(root, ref);
}

export function loadTrustedPolicy(root: string, defaultBranch: string): Policy {
  const ref = `origin/${defaultBranch}`;
  return loadTrustedProjectPolicySet(root, ref).policy;
}

export function loadEffectiveTrustedPolicy(
  root: string,
  defaultBranch: string,
): Policy {
  return loadEffectiveTrustedPolicySet(root, defaultBranch).policy;
}

export function loadEffectiveTrustedPolicySet(
  root: string,
  defaultBranch: string,
) {
  const branchRef = `origin/${defaultBranch}`;
  const resolved = git(
    ["rev-parse", "--verify", `${branchRef}^{commit}`],
    root,
    { allowFailure: true },
  );
  if (resolved.status !== 0)
    throw new Error(`${branchRef}のtrusted commit SHAを解決できません`);
  return loadEffectiveTrustedPolicySetAtCommit(root, resolved.stdout.trim());
}

/** Assemble floor and project extension exclusively from an already resolved commit. */
function loadEffectiveTrustedPolicySetAtCommit(root: string, ref: string) {
  const packageFloorFile = path.join(
    packageRoot,
    ".agent-skill-chain",
    "policy",
    "default.json",
  );
  const packageFloor = requirePolicy(
    parseJsonStrict(
      fs.readFileSync(packageFloorFile, "utf8"),
      "package default safety floor",
    ),
    "package default safety floor",
  );
  const trustedFloor = git(
    ["show", `${ref}:.agent-skill-chain/policy/default.json`],
    root,
    { allowFailure: true },
  );
  if (trustedFloor.status !== 0)
    throw new Error(`${ref}にpackage default safety floorがありません`);
  const committedFloor = requirePolicy(
    parseJsonStrict(trustedFloor.stdout, `${ref}:default policy`),
    "trusted commitのdefault policy",
  );
  const floorResult =
    committedFloor.schemaVersion === CURRENT_POLICY_SCHEMA_VERSION
      ? resolveEffectivePolicy(packageFloor, committedFloor, { trusted: true })
      : { valid: true, policy: packageFloor };
  if (!floorResult.valid)
    throw new Error(
      `trusted defaultをpackage safety floorへ合成できません: ${"diagnostic" in floorResult ? floorResult.diagnostic?.reasons.join("; ") : "不明な構成error"}`,
    );
  const floor = floorResult.policy;
  const result = git(
    ["show", `${ref}:.agent-skill-chain/project-policy.json`],
    root,
    { allowFailure: true },
  );
  const baseEntries = [
    [
      "package-default.json",
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(packageFloorFile))
        .digest("hex"),
    ],
    [
      "policy/default.json",
      crypto.createHash("sha256").update(trustedFloor.stdout).digest("hex"),
    ],
  ];
  if (result.status !== 0) {
    const setHash = crypto
      .createHash("sha256")
      .update(
        stableJson({
          domain: "agent-skill-chain/effective-policy-set/v1",
          entries: baseEntries,
        }),
      )
      .digest("hex");
    return {
      policy: floor,
      setHash,
      setEntries: baseEntries,
      semanticPolicyHash: crypto
        .createHash("sha256")
        .update(stableJson(floor))
        .digest("hex"),
      provenance: { source: "git-floor", commitSha: ref },
    };
  }
  const projectSet = loadTrustedProjectPolicySet(root, ref);
  const project = projectSet.policy;
  const effective = resolveEffectivePolicy(floor, project, { trusted: true });
  if (!effective.valid)
    throw new Error(
      `effective policyを構成できません: ${effective.diagnostic?.reasons?.join("; ") ?? "不明な構成error"}`,
    );
  const setEntries = [
    ...baseEntries,
    ...projectSet.setEntries.map((entry): [string, string] => [
      `project/${entry[0]}`,
      entry[1],
    ]),
  ].sort(([left], [right]) => left.localeCompare(right));
  const setHash = crypto
    .createHash("sha256")
    .update(
      stableJson({
        domain: "agent-skill-chain/effective-policy-set/v1",
        entries: setEntries,
      }),
    )
    .digest("hex");
  return {
    ...projectSet,
    policy: effective.policy,
    setHash,
    hash: setHash,
    setEntries,
    semanticPolicyHash: crypto
      .createHash("sha256")
      .update(stableJson(effective.policy))
      .digest("hex"),
    provenance: { ...projectSet.provenance, floorCommitSha: ref },
  };
}

/** Resolve authority policy only from a fixed trusted commit and trusted provider observation. */
export function loadOperationPolicy(
  root: string,
  options: {
    trustedCommit?: string;
    expectedBaseSha?: string;
    candidateHeadSha?: string;
    baseRef?: string;
    defaultBranch?: string;
    repository?: string;
    pr?: number;
    provider?: ProviderObservation;
  } = {},
) {
  if (Object.keys(options).length > 0) {
    if (
      !/^[a-f0-9]{40}$/iu.test(options.trustedCommit ?? "") ||
      !/^[a-f0-9]{40}$/iu.test(options.expectedBaseSha ?? "")
    )
      throw new Error(
        "explicit trusted commitとexpected base SHAはどちらも40桁SHAで必要です",
      );
    const trustedCommit = options.trustedCommit!;
    const expectedBaseSha = options.expectedBaseSha!;
    if (trustedCommit.toLowerCase() !== expectedBaseSha.toLowerCase())
      throw new Error(
        "explicit trusted commitがGitHub PR expected base SHAと一致しません",
      );
    if (
      !/^[a-f0-9]{40}$/iu.test(options.candidateHeadSha ?? "") ||
      options.candidateHeadSha?.toLowerCase() === trustedCommit.toLowerCase()
    )
      throw new Error(
        "candidate head SHAはtrusted baseと異なる40桁SHAで必要です",
      );
    if (
      typeof options.baseRef !== "string" ||
      options.baseRef.length === 0 ||
      typeof options.defaultBranch !== "string" ||
      options.defaultBranch.length === 0
    )
      throw new Error(
        "PR base refとrepository default branchは空でないbranch名で必要です",
      );
    if (options.baseRef !== options.defaultBranch)
      throw new Error(
        "非default branchをbaseとするPRはtrusted authorityとして使用できません",
      );
    const defaultBranch = options.defaultBranch;
    if (typeof defaultBranch !== "string")
      throw new Error("repository default branchが必要です");
    const checkedBranch = git(
      ["check-ref-format", "--branch", defaultBranch],
      root,
      { allowFailure: true },
    );
    if (
      checkedBranch.status !== 0 ||
      checkedBranch.stdout.trim() !== defaultBranch
    )
      throw new Error(
        "repository default branchは有効なGit branch名で必要です",
      );
    const provider = options.provider;
    if (!provider)
      throw new Error(
        "trusted GitHub providerによるPR authority観測が必要です",
      );
    if (provider?.provenance?.source !== "github")
      throw new Error(
        "trusted GitHub providerによるPR authority観測が必要です",
      );
    if (
      provider.repository !== options.repository ||
      provider.provenance.repository !== options.repository
    )
      throw new Error("GitHub providerのrepositoryが明示対象と一致しません");
    if (
      provider.prNumber !== options.pr ||
      provider.provenance.prNumber !== options.pr
    )
      throw new Error("GitHub providerのPR numberが明示対象と一致しません");
    if (
      provider.baseRefName !== options.baseRef ||
      provider.defaultBranch !== options.defaultBranch
    )
      throw new Error("GitHub providerのbase/default branch観測が一致しません");
    if (
      String(provider.baseRefOid ?? "").toLowerCase() !==
      trustedCommit.toLowerCase()
    )
      throw new Error(
        "GitHub providerのPR base OIDがtrusted commitと一致しません",
      );
    if (
      String(provider.headRefOid ?? "").toLowerCase() !==
      options.candidateHeadSha?.toLowerCase()
    )
      throw new Error(
        "GitHub providerのcandidate headが明示したPR head SHAと一致しません",
      );
    const resolved = git(
      ["rev-parse", "--verify", `${trustedCommit}^{commit}`],
      root,
      { allowFailure: true },
    );
    if (
      resolved.status !== 0 ||
      resolved.stdout.trim().toLowerCase() !== trustedCommit.toLowerCase()
    )
      throw new Error(
        "explicit trusted commitをrepository内の固定commit SHAへ解決できません",
      );
    const remoteDefaultRef = `refs/remotes/origin/${defaultBranch}`;
    const remoteDefault = git(
      ["rev-parse", "--verify", `${remoteDefaultRef}^{commit}`],
      root,
      { allowFailure: true },
    );
    if (
      remoteDefault.status !== 0 ||
      !/^[a-f0-9]{40}$/iu.test(remoteDefault.stdout.trim())
    )
      throw new Error(
        "明示されたremote default branchを固定commitへ解決できません",
      );
    if (
      String(provider.defaultBranchTipOid ?? "").toLowerCase() !==
      remoteDefault.stdout.trim().toLowerCase()
    )
      throw new Error(
        "local remote default tipがGitHub providerの現在tip OIDと一致しません",
      );
    const ancestry = git(
      [
        "merge-base",
        "--is-ancestor",
        trustedCommit,
        remoteDefault.stdout.trim(),
      ],
      root,
      { allowFailure: true },
    );
    if (ancestry.status !== 0)
      throw new Error(
        "trusted commitはremote default branch commitのancestorではありません",
      );
    return loadEffectiveTrustedPolicySetAtCommit(root, resolved.stdout.trim());
  }
  const symbolic = git(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    root,
    { allowFailure: true },
  );
  if (symbolic.status === 0)
    return loadEffectiveTrustedPolicySet(
      root,
      symbolic.stdout.trim().replace(/^origin\//, ""),
    );
  throw new Error(
    "origin/HEADをtrusted branchとcommit SHAへ解決できないためauthority operationを停止しました",
  );
}

export function loadConsumerPolicy(root: string): Policy | undefined {
  const file = path.join(root, ".agent-skill-chain", "project-policy.json");
  if (!fs.existsSync(file)) return undefined;
  return loadProjectPolicySet(root).policy;
}

/** Read an optional consumer policy from one fixed commit. */
export function loadConsumerPolicyAtCommit(
  root: string,
  ref: string,
): Policy | undefined {
  const resolved = git(["rev-parse", "--verify", `${ref}^{commit}`], root, {
    allowFailure: true,
  });
  if (
    resolved.status !== 0 ||
    resolved.stdout.trim().toLowerCase() !== ref.toLowerCase()
  )
    throw new Error(
      "candidate policyを読む固定commitを完全OIDへ解決できません",
    );
  const exists = git(
    [
      "cat-file",
      "-e",
      `${resolved.stdout.trim()}:.agent-skill-chain/project-policy.json`,
    ],
    root,
    { allowFailure: true },
  );
  if (exists.status !== 0) return undefined;
  return loadProjectPolicySetAtCommit(root, resolved.stdout.trim()).policy;
}
