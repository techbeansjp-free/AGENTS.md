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
  "sourcePaths",
  "enforcement",
  "counterexampleScenarios",
];
export const DEVELOPMENT_CONSIDERATION_IDS = [
  "DC-PRIVACY",
  "DC-OBSERVABILITY",
  "DC-UX",
  "DC-TOKENS",
] as const;

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
export function validateProjectConformanceBinding(binding: unknown) {
  const errors: string[] = [];
  if (!isRecord(binding))
    return { valid: false, errors: ["bindingはobjectでなければなりません"] };
  for (const key of Object.keys(binding))
    if (!["schemaVersion", "bindings"].includes(key))
      errors.push(`binding.${key}は未知fieldです`);
  if (binding.schemaVersion !== "agent-skill-chain/project-conformance/v1")
    errors.push("binding schemaVersionが不正です");
  const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
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
    for (const field of BINDING_FIELDS)
      if (item[field] === undefined)
        errors.push(`${item.id ?? "unknown"}.${field}が必要です`);
    for (const field of Object.keys(item))
      if (!BINDING_FIELDS.includes(field))
        errors.push(`${item.id ?? "unknown"}.${field}は未知fieldです`);
    if (!strings(item.sourcePaths))
      errors.push(`${item.id}.sourcePathsが不正です`);
    if (
      !strings(item.counterexampleScenarios) ||
      item.counterexampleScenarios.some((id) => !/^SCN-[A-Z0-9-]+$/.test(id))
    )
      errors.push(`${String(item.id)}.counterexampleScenariosが不正です`);
    const enforcement = Array.isArray(item.enforcement) ? item.enforcement : [];
    if (enforcement.length === 0)
      errors.push(`${item.id}.enforcementが必要です`);
    const enforcementTuples = enforcement.map((point) =>
      isRecord(point)
        ? `${typeof point.path === "string" ? path.posix.normalize(point.path.normalize("NFC")) : ""}\u0000${String(point.export ?? "")}`
        : "",
    );
    if (new Set(enforcementTuples).size !== enforcementTuples.length)
      errors.push(`${item.id}.enforcementのpath/export tupleが重複しています`);
    for (const point of enforcement) {
      if (!isRecord(point)) {
        errors.push(`${String(item.id)}.enforcement itemが不正です`);
        continue;
      }
      for (const key of Object.keys(point))
        if (!["path", "export"].includes(key))
          errors.push(`${item.id}.enforcement.${key}は未知fieldです`);
      if (!text(point.path) || !text(point.export))
        errors.push(`${item.id}.enforcementはpathとexportが必要です`);
      else if (
        !/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\\)(?!.*\/$)[^\u0000]+$/u.test(
          point.path,
        )
      )
        errors.push(`${item.id}.enforcement.pathが不正です`);
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
) {
  const contractResult = validateConformanceContract(contract);
  const bindingResult = validateProjectConformanceBinding(binding);
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
  for (const item of bindings) {
    if (!isRecord(item)) {
      errors.push("binding itemはobjectでなければなりません");
      continue;
    }
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
      if (!isRecord(point) || typeof point.path !== "string") continue;
      try {
        const file = resolveContained(root, point.path);
        if (!text(point.export) || !hasExport(file, point.export))
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
