import path from "node:path";
import { isRecord } from "../types.js";

const IDS = Array.from({ length: 12 }, (_, index) => `I${index + 1}`);
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
const CHECK_ID_MAX_LENGTH = 64;

export type ConformanceScope = "repository-bound" | "package-attested";

export interface ConformanceDeclaration {
  scope?: ConformanceScope;
  bindingDocuments: unknown[];
}

export interface ConformanceDeclarationDiff {
  weakened: string[];
  allowed: string[];
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

const DIAGNOSTIC_CHECK_ID_LIMIT = 20;
const DIAGNOSTIC_RULE_ID_LIMIT = 3;

function diagnosticRuleId(ruleId: string): string {
  return JSON.stringify(ruleId.slice(0, CHECK_ID_MAX_LENGTH));
}

function unregisteredCheckRefMessage(input: {
  prefix: string;
  checkId: string;
  registeredCheckIds: ReadonlySet<string>;
  rules: readonly unknown[];
}): string {
  const underivableRuleIds = new Set<string>();
  for (const rule of input.rules) {
    if (!isRecord(rule) || typeof rule.ruleId !== "string") continue;
    if (checkIdForRuleId(rule.ruleId) === undefined)
      underivableRuleIds.add(rule.ruleId);
  }
  const sortedCheckIds = [...input.registeredCheckIds].sort();
  const shownCheckIds = sortedCheckIds.slice(0, DIAGNOSTIC_CHECK_ID_LIMIT);
  const registered =
    sortedCheckIds.length === 0
      ? "登録済みcheckIdは0件です"
      : `登録済みcheckId(${sortedCheckIds.length}件): ${shownCheckIds.join(
          ", ",
        )}${
          sortedCheckIds.length > shownCheckIds.length
            ? `, ほか${sortedCheckIds.length - shownCheckIds.length}件`
            : ""
        }`;
  const parts = [
    `${input.prefix}check-refがproject ruleへ登録されていません: ${input.checkId}`,
    "checkIdはproject ruleのruleIdから接頭辞ASC-を除いて小文字化した値です",
    "規則の正本は`.agent-skill-chain/docs/00_運用ポリシー.md`の「conformance scopeと適用可否」節です",
    registered,
  ];
  if (underivableRuleIds.size > 0)
    parts.push(
      `導出できないruleId(${underivableRuleIds.size}件): ${[
        ...underivableRuleIds,
      ]
        .sort()
        .slice(0, DIAGNOSTIC_RULE_ID_LIMIT)
        .map(diagnosticRuleId)
        .join(", ")}`,
    );
  return parts.join("。");
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
            unregisteredCheckRefMessage({
              prefix: `${item.id}.`,
              checkId: point.checkId,
              registeredCheckIds,
              rules: Array.isArray(rulesInput) ? rulesInput : [],
            }),
          );
      } else errors.push(`${item.id}.enforcement.kindが不正です`);
    }
  }
  return { valid: errors.length === 0, errors };
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
