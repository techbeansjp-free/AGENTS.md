import fs from "node:fs";
import path from "node:path";
import { resolveContained } from "../lib/security.js";
import { isRecord } from "../types.js";

const IDS = Array.from({ length: 12 }, (_, index) => `I${index + 1}`);
const CONTRACT_FIELDS = [
  "id",
  "name",
  "statement",
  "sourceHook",
  "enforcementHooks",
  "evidenceHooks",
  "rollback",
];
const BINDING_FIELDS = [
  "id",
  "status",
  "reason",
  "evidence",
  "sourcePaths",
  "enforcement",
  "counterexampleScenarios",
];
const SAFE_BINDING_PATH =
  /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\\)(?!.*\/$)[^\u0000]+$/u;
const CHECK_ID = /^[a-z][a-z0-9-]{0,63}$/u;

export type ConformanceScope = "repository-bound" | "package-attested";

export interface ConformanceDeclaration {
  scope?: ConformanceScope;
  bindingDocuments: unknown[];
}

export interface ConformanceDeclarationDiff {
  weakened: string[];
  allowed: string[];
}
export const DEVELOPMENT_CONSIDERATION_IDS = [
  "DC-PRIVACY",
  "DC-OBSERVABILITY",
  "DC-UX",
  "DC-TOKENS",
] as const;

export interface RuleCoverageRow {
  ruleId: string;
  normative: boolean;
  schema: boolean;
  runtime: boolean;
  ci: boolean;
}

export interface RuleCoverageOrphan {
  ruleId: string;
  reason: string;
}

const PROJECT_RULE_PREFIX = ["ASC", "DOGFOOD"].join("-");
export const PROJECT_RULE_ENFORCEMENT_POINTS: Readonly<Record<string, string>> =
  Object.fromEntries(
    [
      ["CI-PERMISSION-001", "checkQualityCiPermissions"],
      ["CI-TRIGGER-001", "checkQualityCiTriggers"],
      ["CODE-QUALITY-001", "checkQualityCommands"],
      ["DISTRIBUTION-BOUNDARY-001", "checkPackageDistributionBoundary"],
      ["DOCS-001", "checkJapaneseDocuments"],
      ["DOGFOODING-001", "checkConformance"],
      ["JAPANESE-DOCS-001", "checkJapaneseDocuments"],
      ["LOCKFILE-001", "checkPackageManagerBoundary"],
      ["NAMING-EXCEPTION-001", "checkFixedMarkdownNames"],
      ["NUMBERED-MARKDOWN-001", "checkFixedMarkdownNames"],
      ["OWNERSHIP-LOCAL-001", "validateOwnershipBoundary"],
      ["OWNERSHIP-PR-001", "validateOwnershipBoundary"],
      ["PACKAGE-001", "checkPackageDistributionBoundary"],
      ["PACKAGE-MANAGER-001", "checkPackageManagerBoundary"],
      ["DISTRIBUTION-IMPACT-001", "validateDistributionImpact"],
      ["QUALITY-COMMAND-001", "checkQualityCommands"],
      ["RUNTIME-001", "checkNodeRuntimeAlignment"],
      ["SAFETY-001", "checkTrustedPolicyBoundary"],
    ].map(([suffix, point]) => [`${PROJECT_RULE_PREFIX}-${suffix}`, point]),
  );

const PROJECT_RULE_FIELDS = [
  "ruleId",
  "purpose",
  "riskClass",
  "scope",
  "enforcement",
  "activation",
  "owner",
  "targetLayer",
  "evidence",
  "remediation",
  "overridePolicy",
  "rollback",
] as const;
const PROJECT_RULE_METADATA_FIELDS = [
  "packageDefault",
  "projectOverride",
  "changeAuthority",
] as const;
const PROJECT_RULE_ID = /\bASC-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gu;

function projectRuleIds(source: string): Set<string> {
  return new Set(source.match(PROJECT_RULE_ID) ?? []);
}

export function validateProjectRuleLedgerEntry(value: unknown, label = "rule") {
  const errors: string[] = [];
  if (!isRecord(value))
    return { valid: false, errors: [`${label}はobjectでなければなりません`] };
  for (const field of PROJECT_RULE_FIELDS)
    if (value[field] === undefined) errors.push(`${label}.${field}が必要です`);
  for (const field of [
    "ruleId",
    "purpose",
    "riskClass",
    "owner",
    "evidence",
    "remediation",
    "rollback",
  ] as const)
    if (!text(value[field]))
      errors.push(`${label}.${field}は空でない文字列でなければなりません`);
  if (
    typeof value.ruleId !== "string" ||
    !/^ASC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(value.ruleId)
  )
    errors.push(`${label}.ruleIdはASC-で始まる安定IDでなければなりません`);
  if (!strings(value.scope))
    errors.push(`${label}.scopeは重複のない非空文字列配列でなければなりません`);
  if (
    !["deny", "require", "assist", "warn", "record"].includes(
      String(value.enforcement),
    )
  )
    errors.push(`${label}.enforcementが不正です`);
  const metadataCount = PROJECT_RULE_METADATA_FIELDS.filter(
    (field) => value[field] !== undefined,
  ).length;
  if (
    metadataCount !== 0 &&
    metadataCount !== PROJECT_RULE_METADATA_FIELDS.length
  )
    errors.push(
      `${label}のpackageDefault、projectOverride、changeAuthorityは3fieldを同時に指定してください`,
    );
  for (const field of PROJECT_RULE_METADATA_FIELDS)
    if (value[field] !== undefined && !text(value[field]))
      errors.push(`${label}.${field}は空でない文字列でなければなりません`);
  return { valid: errors.length === 0, errors };
}

export function buildRuleCoverage(input: {
  rules: unknown[];
  normativeText: string;
  schemaText: string;
  runtimeText: string;
  ciText: string;
}): { rows: RuleCoverageRow[]; orphans: RuleCoverageOrphan[] } {
  const normativeIds = projectRuleIds(input.normativeText);
  const schemaIds = projectRuleIds(input.schemaText);
  const runtimeIds = projectRuleIds(input.runtimeText);
  const ciIds = projectRuleIds(input.ciText);
  const definedIds = new Set(
    input.rules.flatMap((rule) =>
      isRecord(rule) &&
      typeof rule.ruleId === "string" &&
      /^ASC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(rule.ruleId)
        ? [rule.ruleId]
        : [],
    ),
  );
  const rowIds = new Set([
    ...definedIds,
    ...normativeIds,
    ...schemaIds,
    ...ciIds,
  ]);
  const rows = [...rowIds]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((ruleId) => ({
      ruleId,
      normative: normativeIds.has(ruleId),
      schema: schemaIds.has(ruleId),
      runtime: runtimeIds.has(ruleId),
      ci: ciIds.has(ruleId),
    }));
  const orphans: RuleCoverageOrphan[] = [];
  for (const row of rows) {
    if (definedIds.has(row.ruleId) && !row.runtime && !row.ci)
      orphans.push({
        ruleId: row.ruleId,
        reason:
          "rule fileに存在しますがruntimeにもCIにもenforcement pointがありません",
      });
    if (row.normative && !definedIds.has(row.ruleId))
      orphans.push({
        ruleId: row.ruleId,
        reason: "規範文書に存在しますがproject policyに定義されていません",
      });
    if (row.schema && !row.runtime)
      orphans.push({
        ruleId: row.ruleId,
        reason: "schemaに存在しますがruntimeで検証されていません",
      });
    if (
      row.ci &&
      !definedIds.has(row.ruleId) &&
      !row.normative &&
      !row.schema &&
      !row.runtime
    )
      orphans.push({
        ruleId: row.ruleId,
        reason: "CIだけに存在する暗黙ruleです",
      });
  }
  return { rows, orphans };
}

export function validateDevelopmentConsiderationRecords(
  value: unknown,
  label = "document",
) {
  const errors: string[] = [];
  if (!Array.isArray(value))
    return {
      valid: false,
      errors: [`${label}: 開発契約の適用判断は配列でなければなりません`],
      checked: DEVELOPMENT_CONSIDERATION_IDS,
    };
  const records = value.filter(isRecord);
  if (records.length !== value.length)
    errors.push(`${label}: 開発契約の適用判断にobject以外があります`);
  for (const id of DEVELOPMENT_CONSIDERATION_IDS) {
    const matches = records.filter((record) => record.id === id);
    if (matches.length !== 1) {
      errors.push(`${label}: ${id}は重複なく1件必要です`);
      continue;
    }
    const record = matches[0] ?? {};
    if (record.status !== "applicable" && record.status !== "not-applicable")
      errors.push(
        `${label}: ${id}の判定はapplicableまたはnot-applicableでなければなりません`,
      );
    for (const [field, minimum] of [
      ["reason", 8],
      ["evidence", 4],
    ] as const) {
      const fieldValue = record[field];
      if (
        typeof fieldValue !== "string" ||
        fieldValue.trim().length < minimum ||
        /^(?:-|なし|未定|不明|x+)$/iu.test(fieldValue.trim()) ||
        /[（{][^）}]+[）}]/u.test(fieldValue)
      )
        errors.push(
          `${label}: ${id}の${field === "reason" ? "理由" : "証拠"}が具体化されていません`,
        );
    }
  }
  for (const record of records)
    if (
      typeof record.id !== "string" ||
      !DEVELOPMENT_CONSIDERATION_IDS.some((id) => id === record.id)
    )
      errors.push(
        `${label}: ${String(record.id ?? "unknown")}は未知の開発契約IDです`,
      );
  return {
    valid: errors.length === 0,
    errors,
    checked: DEVELOPMENT_CONSIDERATION_IDS,
  };
}

export function validateDevelopmentConsiderations(
  markdown: string,
  label = "document",
) {
  const rows: Array<{
    id: string;
    status: string;
    reason: string;
    evidence: string;
  }> = [];
  for (const line of markdown.split(/\r?\n/u)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const id = cells[0];
    if (
      typeof id !== "string" ||
      !DEVELOPMENT_CONSIDERATION_IDS.some((expected) => expected === id)
    )
      continue;
    rows.push({
      id,
      status: cells[2] ?? "",
      reason: cells[3] ?? "",
      evidence: cells[4] ?? "",
    });
  }
  return validateDevelopmentConsiderationRecords(rows, label);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(text) &&
    new Set(value).size === value.length
  );
}

function bindingStatus(
  value: Record<string, unknown>,
): "applicable" | "not-applicable" | undefined {
  if (value.status === undefined || value.status === "applicable")
    return "applicable";
  return value.status === "not-applicable" ? value.status : undefined;
}

function enforcementPointKey(point: unknown): string {
  if (!isRecord(point)) return "";
  const kind = point.kind === undefined ? "module-export" : String(point.kind);
  const relative =
    typeof point.path === "string"
      ? path.posix.normalize(point.path.normalize("NFC"))
      : "";
  const reference =
    kind === "module-export"
      ? String(point.export ?? "")
      : kind === "file-entrypoint"
        ? String(point.runner ?? "")
        : String(point.checkId ?? "");
  return `${kind}\u0000${relative}\u0000${reference}`;
}

export function checkIdForRuleId(ruleId: string): string | undefined {
  if (!/^ASC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(ruleId)) return undefined;
  const checkId = ruleId.slice("ASC-".length).toLowerCase();
  return CHECK_ID.test(checkId) ? checkId : undefined;
}

export function validateConformanceContract(contract: unknown) {
  const errors: string[] = [];
  if (!isRecord(contract))
    return {
      valid: false,
      errors: ["contractはobjectでなければなりません"],
      invariants: [],
    };
  for (const key of Object.keys(contract))
    if (!["schemaVersion", "invariants"].includes(key))
      errors.push(`contract.${key}は未知fieldです`);
  if (contract.schemaVersion !== "agent-skill-chain/conformance/v1")
    errors.push("conformance schemaVersionが不正です");
  if (!Array.isArray(contract.invariants))
    errors.push("invariantsは配列でなければなりません");
  else {
    const ids = contract.invariants.map((item) =>
      isRecord(item) ? item.id : undefined,
    );
    if (contract.invariants.length !== 12)
      errors.push("invariantsはexact 12件でなければなりません");
    for (const id of IDS)
      if (ids.filter((item) => item === id).length !== 1)
        errors.push(`${id}は重複なく1件必要です`);
    for (const id of ids)
      if (typeof id !== "string" || !IDS.includes(id))
        errors.push(`${String(id ?? "unknown")}は未知invariantです`);
    for (const item of contract.invariants) {
      if (!isRecord(item)) {
        errors.push("invariantはobjectでなければなりません");
        continue;
      }
      for (const field of CONTRACT_FIELDS)
        if (item[field] === undefined)
          errors.push(`${item.id ?? "unknown"}.${field}が必要です`);
      for (const field of Object.keys(item))
        if (!CONTRACT_FIELDS.includes(field))
          errors.push(`${item.id ?? "unknown"}.${field}は未知fieldです`);
      for (const field of ["name", "statement", "sourceHook", "rollback"])
        if (!text(item[field]))
          errors.push(
            `${item.id ?? "unknown"}.${field}は空でない文字列でなければなりません`,
          );
      for (const field of ["enforcementHooks", "evidenceHooks"])
        if (!strings(item[field]))
          errors.push(
            `${item.id ?? "unknown"}.${field}は重複のない非空文字列配列でなければなりません`,
          );
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    invariants: contract.invariants ?? [],
  };
}

/** Keep shape validation separate so candidate data cannot trigger filesystem reads before its paths are proven safe. */
export function validateProjectConformanceBinding(
  binding: unknown,
  rulesInput?: unknown,
) {
  const errors: string[] = [];
  if (!isRecord(binding))
    return { valid: false, errors: ["bindingはobjectでなければなりません"] };
  for (const key of Object.keys(binding))
    if (!["schemaVersion", "bindings"].includes(key))
      errors.push(`binding.${key}は未知fieldです`);
  if (binding.schemaVersion !== "agent-skill-chain/project-conformance/v1")
    errors.push("binding schemaVersionが不正です");
  const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
  const registeredCheckIds =
    rulesInput === undefined
      ? undefined
      : new Set(
          (Array.isArray(rulesInput) ? rulesInput : []).flatMap((rule) => {
            if (!isRecord(rule) || typeof rule.ruleId !== "string") return [];
            const checkId = checkIdForRuleId(rule.ruleId);
            return checkId ? [checkId] : [];
          }),
        );
  if (rulesInput !== undefined && !Array.isArray(rulesInput))
    errors.push("project rulesは配列でなければなりません");
  if (bindings.length !== 12)
    errors.push("bindingsはexact 12件でなければなりません");
  const ids = bindings.map((item) => (isRecord(item) ? item.id : undefined));
  for (const id of IDS)
    if (ids.filter((item) => item === id).length !== 1)
      errors.push(`binding ${id}は重複なく1件必要です`);
  for (const id of ids)
    if (typeof id !== "string" || !IDS.includes(id))
      errors.push(`binding ${String(id ?? "unknown")}は未知invariantです`);
  for (const item of bindings) {
    if (!isRecord(item)) {
      errors.push("binding itemはobjectでなければなりません");
      continue;
    }
    if (item.id === undefined)
      errors.push(`${item.id ?? "unknown"}.idが必要です`);
    for (const field of Object.keys(item))
      if (!BINDING_FIELDS.includes(field))
        errors.push(`${item.id ?? "unknown"}.${field}は未知fieldです`);
    const status = bindingStatus(item);
    if (!status) errors.push(`${String(item.id)}.statusが不正です`);
    if (status === "not-applicable") {
      if (!text(item.reason))
        errors.push(`${String(item.id)}.reasonが必要です`);
      if (!text(item.evidence))
        errors.push(`${String(item.id)}.evidenceが必要です`);
      for (const field of [
        "sourcePaths",
        "enforcement",
        "counterexampleScenarios",
      ] as const)
        if (item[field] !== undefined)
          errors.push(
            `${String(item.id)}.${field}はnot-applicableでは指定できません`,
          );
      continue;
    }
    if (item.reason !== undefined || item.evidence !== undefined)
      errors.push(
        `${String(item.id)}のreason/evidenceはnot-applicableでだけ指定できます`,
      );
    if (!strings(item.sourcePaths))
      errors.push(`${item.id}.sourcePathsが不正です`);
    if (
      !strings(item.counterexampleScenarios) ||
      item.counterexampleScenarios.some((id) => !/^SCN-[A-Z0-9-]+$/u.test(id))
    )
      errors.push(`${String(item.id)}.counterexampleScenariosが不正です`);
    const enforcement = Array.isArray(item.enforcement) ? item.enforcement : [];
    if (enforcement.length === 0)
      errors.push(`${item.id}.enforcementが必要です`);
    const enforcementTuples = enforcement.map(enforcementPointKey);
    if (new Set(enforcementTuples).size !== enforcementTuples.length)
      errors.push(`${item.id}.enforcementのpath/export tupleが重複しています`);
    for (const point of enforcement) {
      if (!isRecord(point)) {
        errors.push(`${String(item.id)}.enforcement itemが不正です`);
        continue;
      }
      const kind = point.kind === undefined ? "module-export" : point.kind;
      const allowed =
        kind === "module-export"
          ? ["kind", "path", "export"]
          : kind === "file-entrypoint"
            ? ["kind", "path", "runner"]
            : kind === "check-ref"
              ? ["kind", "checkId"]
              : ["kind"];
      for (const key of Object.keys(point))
        if (!allowed.includes(key))
          errors.push(`${item.id}.enforcement.${key}は未知fieldです`);
      if (kind === "module-export") {
        if (!text(point.path) || !text(point.export))
          errors.push(`${item.id}.module-exportはpathとexportが必要です`);
        else if (!SAFE_BINDING_PATH.test(point.path))
          errors.push(`${item.id}.enforcement.pathが不正です`);
      } else if (kind === "file-entrypoint") {
        if (!text(point.path) || !text(point.runner))
          errors.push(`${item.id}.file-entrypointはpathとrunnerが必要です`);
        else if (!SAFE_BINDING_PATH.test(point.path))
          errors.push(`${item.id}.enforcement.pathが不正です`);
      } else if (kind === "check-ref") {
        if (!text(point.checkId) || !CHECK_ID.test(point.checkId))
          errors.push(`${item.id}.check-ref.checkIdが不正です`);
        else if (
          registeredCheckIds !== undefined &&
          !registeredCheckIds.has(point.checkId)
        )
          errors.push(
            `${item.id}.check-refがproject ruleへ登録されていません: ${point.checkId}`,
          );
      } else errors.push(`${item.id}.enforcement.kindが不正です`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Strip non-executable text so a hook name mentioned only in a comment or literal cannot satisfy conformance. */
function executableSource(source: string): string {
  let result = "";
  let state = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (current === "/" && next === "/") {
        result += "  ";
        index += 1;
        state = "line-comment";
        continue;
      }
      if (current === "/" && next === "*") {
        result += "  ";
        index += 1;
        state = "block-comment";
        continue;
      }
      if (current === "'" || current === '"' || current === "`") {
        result += " ";
        state = current;
        escaped = false;
        continue;
      }
      result += current;
      continue;
    }
    if (state === "line-comment") {
      if (current === "\n") {
        result += "\n";
        state = "code";
      } else result += " ";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else result += current === "\n" ? "\n" : " ";
      continue;
    }
    if (escaped) {
      result += current === "\n" ? "\n" : " ";
      escaped = false;
      continue;
    }
    if (current === "\\") {
      result += " ";
      escaped = true;
      continue;
    }
    if (current === state) {
      result += " ";
      state = "code";
      continue;
    }
    result += current === "\n" ? "\n" : " ";
  }
  return result;
}

function hasExport(file: string, name: string): boolean {
  const source = executableSource(fs.readFileSync(file, "utf8"));
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    new RegExp(
      `^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|const|let|var)\\s+${escaped}\\b`,
      "mu",
    ).test(source)
  )
    return true;
  if (
    new RegExp(`^\\s*export\\s*\\*\\s+as\\s+${escaped}\\b`, "mu").test(source)
  )
    return true;
  for (const match of source.matchAll(/^\s*export\s*\{([^}]*)\}/gmu)) {
    const exported = match[1].split(",").map((entry) =>
      entry
        .trim()
        .split(/\s+as\s+/u)
        .at(-1)
        ?.trim(),
    );
    if (exported.includes(name)) return true;
  }
  return false;
}

export function validateRepositoryConformance(
  root: string,
  contract: unknown,
  binding: unknown,
  evidenceInput: unknown = {},
  rulesInput: unknown = [],
) {
  const contractResult = validateConformanceContract(contract);
  const bindingResult = validateProjectConformanceBinding(binding, rulesInput);
  const errors = [...contractResult.errors, ...bindingResult.errors];
  if (!isRecord(binding)) return { valid: false, errors };
  const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
  const evidence = isRecord(evidenceInput) ? evidenceInput : {};
  if (!isRecord(evidenceInput))
    errors.push("成功証拠はobjectでなければなりません");
  for (const field of Object.keys(evidence))
    if (!["tool", "passedScenarioIds"].includes(field))
      errors.push(`成功証拠.${field}は未知fieldです`);
  const passedScenarioIds = Array.isArray(evidence.passedScenarioIds)
    ? evidence.passedScenarioIds
    : [];
  if (
    !Array.isArray(evidence.passedScenarioIds) ||
    evidence.passedScenarioIds.some(
      (id) => typeof id !== "string" || !/^SCN-[A-Z0-9-]+$/u.test(id),
    )
  )
    errors.push("成功証拠passedScenarioIdsが不正です");
  const passed = new Set<unknown>(passedScenarioIds);
  if (!text(evidence.tool)) errors.push("成功証拠toolが必要です");
  const registeredCheckIds = new Set(
    (Array.isArray(rulesInput) ? rulesInput : []).flatMap((rule) => {
      if (!isRecord(rule) || typeof rule.ruleId !== "string") return [];
      const checkId = checkIdForRuleId(rule.ruleId);
      return checkId ? [checkId] : [];
    }),
  );
  if (!Array.isArray(rulesInput))
    errors.push("project rulesは配列でなければなりません");
  for (const item of bindings) {
    if (!isRecord(item)) {
      errors.push("binding itemはobjectでなければなりません");
      continue;
    }
    if (bindingStatus(item) === "not-applicable") continue;
    for (const relative of Array.isArray(item.sourcePaths)
      ? item.sourcePaths
      : []) {
      if (typeof relative !== "string") continue;
      try {
        const file = resolveContained(root, relative);
        if (!fs.statSync(file).isFile())
          errors.push(
            `${String(item.id)}のsourceがfileではありません: ${relative}`,
          );
      } catch {
        errors.push(`${String(item.id)}のsourceが実在しません: ${relative}`);
      }
    }
    for (const point of Array.isArray(item.enforcement)
      ? item.enforcement
      : []) {
      if (!isRecord(point)) continue;
      const kind = point.kind === undefined ? "module-export" : point.kind;
      if (kind === "check-ref") {
        if (
          typeof point.checkId === "string" &&
          !registeredCheckIds.has(point.checkId)
        )
          errors.push(
            `${String(item.id)}のcheck-refがproject ruleへ登録されていません: ${point.checkId}`,
          );
        continue;
      }
      if (typeof point.path !== "string") continue;
      try {
        const file = resolveContained(root, point.path);
        if (kind === "file-entrypoint") {
          const stat = fs.lstatSync(file);
          if (stat.isSymbolicLink() || !stat.isFile())
            errors.push(
              `${String(item.id)}のfile-entrypointはsymlinkでない通常fileでなければなりません: ${point.path}`,
            );
        } else if (!text(point.export) || !hasExport(file, point.export))
          errors.push(
            `${String(item.id)}のenforcement exportが実在しません: ${point.path}#${String(point.export)}`,
          );
      } catch {
        errors.push(
          `${String(item.id)}のenforcement pathが実在しません: ${point.path}`,
        );
      }
    }
    for (const scenario of Array.isArray(item.counterexampleScenarios)
      ? item.counterexampleScenarios
      : [])
      if (!passed.has(scenario))
        errors.push(
          `${String(item.id)}のcounterexampleに成功証拠がありません: ${String(scenario)}`,
        );
  }
  return {
    valid: errors.length === 0,
    errors,
    checked: IDS,
    evidenceTool: evidence.tool,
  };
}

function flattenedBindings(
  declaration: ConformanceDeclaration,
): Record<string, unknown>[] {
  return declaration.bindingDocuments.flatMap((document) =>
    isRecord(document) && Array.isArray(document.bindings)
      ? document.bindings.filter(isRecord)
      : [],
  );
}

export function classifyConformanceDeclarationDiff(
  trusted: ConformanceDeclaration,
  candidate: ConformanceDeclaration,
): ConformanceDeclarationDiff {
  const diff: ConformanceDeclarationDiff = { weakened: [], allowed: [] };
  const trustedScope = trusted.scope ?? "repository-bound";
  const candidateScope = candidate.scope ?? "repository-bound";
  if (
    trustedScope === "repository-bound" &&
    candidateScope === "package-attested"
  )
    diff.weakened.push(
      "conformanceScope: repository-boundからpackage-attestedへ格下げしている",
    );
  else if (trustedScope !== candidateScope)
    diff.allowed.push("conformanceScope");
  const candidateById = new Map(
    flattenedBindings(candidate).map((binding) => [
      String(binding.id),
      binding,
    ]),
  );
  for (const trustedBinding of flattenedBindings(trusted)) {
    const id = String(trustedBinding.id);
    const candidateBinding = candidateById.get(id);
    if (!candidateBinding) {
      diff.weakened.push(`binding ${id}: trusted bindingを削除している`);
      continue;
    }
    const trustedStatus = bindingStatus(trustedBinding);
    const candidateStatus = bindingStatus(candidateBinding);
    if (
      trustedStatus === "applicable" &&
      candidateStatus === "not-applicable"
    ) {
      diff.weakened.push(
        `binding ${id}: applicableからnot-applicableへ格下げしている`,
      );
      continue;
    }
    if (trustedStatus === "not-applicable" && candidateStatus === "applicable")
      diff.allowed.push(`binding ${id}.status`);
    if (trustedStatus !== "applicable" || candidateStatus !== "applicable")
      continue;
    for (const field of ["enforcement", "counterexampleScenarios"] as const) {
      const trustedCount = Array.isArray(trustedBinding[field])
        ? trustedBinding[field].length
        : 0;
      const candidateCount = Array.isArray(candidateBinding[field])
        ? candidateBinding[field].length
        : 0;
      if (candidateCount < trustedCount)
        diff.weakened.push(
          `binding ${id}.${field}: 要素数を${trustedCount}件から${candidateCount}件へ減らしている`,
        );
      else if (candidateCount > trustedCount)
        diff.allowed.push(`binding ${id}.${field}`);
    }
  }
  return diff;
}

export const DISTRIBUTION_IMPACT_HEADING = "## 配布物影響";
const DISTRIBUTION_IMPACT_HEADING_TEXT = "配布物影響";
const DISTRIBUTION_DECISION_UPDATED = "配布物を更新した";
const DISTRIBUTION_DECISION_NOT_UPDATED = "配布物を更新しない";

function normalizeRelative(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function distributedPaths(input: {
  changedPaths: readonly string[];
  packageFiles: readonly string[];
}): string[] {
  const files = input.packageFiles.map(normalizeRelative);
  const compiled = new Map<string, string>();
  if (files.includes("dist/src/")) compiled.set("src/", "dist/src/");
  if (files.includes("dist/bin/")) compiled.set("dist/bin/", "dist/bin/");
  if (files.includes("dist/bin/")) compiled.set("bin/", "dist/bin/");
  const direct = files;
  const matched: string[] = [];
  for (const raw of input.changedPaths) {
    const relative = normalizeRelative(raw);
    const isDirect = direct.some((entry) =>
      entry.endsWith("/") ? relative.startsWith(entry) : relative === entry,
    );
    const isCompiled = [...compiled.keys()].some((prefix) =>
      relative.startsWith(prefix),
    );
    if (isDirect || isCompiled) matched.push(relative);
  }
  return [...new Set(matched)].sort();
}

export function extractMarkdownSection(
  markdown: string,
  headingText: string,
): string | undefined {
  const pattern = new RegExp(
    `^## (?:\\d+\\.\\s*)?${headingText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*$`,
    "u",
  );
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => pattern.test(line.trimEnd()));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /u.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

export function validateDistributionImpact(input: {
  markdown: string;
  changedPaths: readonly string[];
  packageFiles: readonly string[];
}): { valid: boolean; errors: string[]; distributed: string[] } {
  const errors: string[] = [];
  const distributed = distributedPaths({
    changedPaths: input.changedPaths,
    packageFiles: input.packageFiles,
  });
  const section = extractMarkdownSection(
    input.markdown,
    DISTRIBUTION_IMPACT_HEADING_TEXT,
  );
  if (section === undefined) {
    errors.push(
      `review artifactへ「${DISTRIBUTION_IMPACT_HEADING}」の節が必要です。配布境界へ入る変更pathと、配布物を更新したか更新しない理由を記述してください`,
    );
    return { valid: false, errors, distributed };
  }
  for (const relative of distributed)
    if (!section.includes(relative))
      errors.push(
        `配布物影響の節に配布境界へ入る変更pathがありません: ${relative}`,
      );
  const decisionLines = section
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("判断:"));
  const decisions = decisionLines.map((line) =>
    line.slice("判断:".length).trim(),
  );
  const allowed = [
    DISTRIBUTION_DECISION_UPDATED,
    DISTRIBUTION_DECISION_NOT_UPDATED,
  ];
  if (decisions.length !== 1)
    errors.push(
      `配布物影響の節へ「判断: ${DISTRIBUTION_DECISION_UPDATED}」または「判断: ${DISTRIBUTION_DECISION_NOT_UPDATED}」の行が1件だけ必要です`,
    );
  else if (!allowed.includes(decisions[0] ?? ""))
    errors.push(
      `配布物影響の判断は「${DISTRIBUTION_DECISION_UPDATED}」または「${DISTRIBUTION_DECISION_NOT_UPDATED}」のいずれかでなければなりません: ${decisions[0]}`,
    );
  const groundLines = section
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("根拠:"));
  const grounds = groundLines.map((line) => line.slice("根拠:".length).trim());
  if (grounds.length !== 1)
    errors.push("配布物影響の節へ「根拠:」の行が1件だけ必要です");
  else {
    const ground = grounds[0] ?? "";
    if (ground.length < 20)
      errors.push(
        "配布物影響の根拠が短すぎます。判断した理由を記述してください",
      );
    if (/^\{.*\}$/u.test(ground) || ground.includes("{"))
      errors.push("配布物影響の根拠にplaceholderが残っています");
  }
  return { valid: errors.length === 0, errors, distributed };
}
