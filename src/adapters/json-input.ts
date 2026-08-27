import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict } from "../lib/security.js";
import { isRecord, type Policy } from "../types.js";
import { type ModeAnswer } from "../domain/mode.js";
import {
  loadProjectPolicySet,
  validatePolicy,
  type PolicySet,
} from "../domain/policy.js";
import { type enforceOperation } from "../domain/enforcement.js";
import {
  type MigrationState,
  type MigrationKind,
  type planFileMigration,
} from "../domain/migration.js";
import { type ConceptualMigrationState } from "../domain/enforcement.js";

export interface SpecReviewInput {
  specImpact?: string;
  rationale?: string;
  trace?: { requirements?: string[]; scenarios?: string[]; tests?: string[] };
}

export interface FinalizeEvidenceInput {
  repository: string;
  base: string;
  specConsistent: boolean | "unknown";
  testsPassed: boolean | "unknown";
  reviewApproved: boolean | "unknown";
  prMerged: boolean | "unknown";
}

export interface DeliveryEvidenceInput {
  headSha: string;
  review: Record<string, unknown>;
  tests: Record<string, unknown>;
  spec: Record<string, unknown>;
  ownership?: Record<string, unknown>;
}

export type LoadedMigrationState =
  | { kind: "file"; state: MigrationState }
  | { kind: "conceptual"; state: ConceptualMigrationState };

const MIGRATION_KINDS: MigrationKind[] = [
  "policy",
  "schema",
  "runtime",
  "CI",
  "template",
];

function isMigrationKind(value: unknown): value is MigrationKind {
  return MIGRATION_KINDS.some((kind) => kind === value);
}

export function readJsonInput(file: string): unknown {
  return parseJsonStrict(fs.readFileSync(file, "utf8"), file);
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim() !== "")
  );
}

function exactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isPolicyInput(value: unknown): value is Policy {
  return validatePolicy(value).valid;
}

export function readPolicyJson(file: string): Policy {
  const value = readJsonInput(file);
  if (!isPolicyInput(value))
    throw new Error(`${file}は有効なproject policyではありません`);
  return value;
}

export function readPolicyFileInput(file: string): Policy | PolicySet {
  const value = readJsonInput(file);
  if (!isRecord(value)) throw new Error(`${file}はobjectでなければなりません`);
  if (value.schemaVersion !== "agent-skill-chain/project-policy-manifest/v1") {
    if (!isPolicyInput(value))
      throw new Error(`${file}は有効なproject policyではありません`);
    return value;
  }
  if (
    path.basename(file) !== "project-policy.json" ||
    path.basename(path.dirname(file)) !== ".agent-skill-chain"
  )
    throw new Error(
      "fragmented project policy manifestは.agent-skill-chain/project-policy.jsonから読み込んでください",
    );
  return loadProjectPolicySet(path.dirname(path.dirname(file)));
}

/**
 * mode assessmentの期待形。**利用者が形式を知る正規経路は`--help`であり**（`docs/specs/`の
 * CLI・GitHub契約「usageと必須入力の提示」）、拒否理由も同じ形を名指しする。
 * 配布schemaの`workflow-mode-decision.schema.json`はmode決定の**記録**であって入力ではない。
 * 記録をそのまま渡すと`mode`を尊重するのか無視するのかが曖昧になるため受理しない。
 */
const MODE_ASSESSMENT_SHAPE =
  '質問IDをキーに{"answer":true|false|"unknown","evidence":"根拠"}を持つobjectを渡してください。回答か根拠が欠けたIDは不明として扱いfullへ倒します';

export function readModeAssessment(file: string): Record<string, ModeAnswer> {
  const value = readJsonInput(file);
  if (!isRecord(value))
    throw new Error(
      `${file}のmode assessmentはobjectでなければなりません。${MODE_ASSESSMENT_SHAPE}`,
    );
  const answers: Record<string, ModeAnswer> = {};
  for (const [id, answer] of Object.entries(value)) {
    if (!isRecord(answer) || !exactFields(answer, ["answer", "evidence"]))
      throw new Error(
        `${file}のmode assessmentが不正です。${MODE_ASSESSMENT_SHAPE}`,
      );
    const answerValue = answer.answer;
    const evidence = answer.evidence;
    if (
      !(
        answerValue === undefined ||
        typeof answerValue === "boolean" ||
        answerValue === "unknown"
      ) ||
      !(evidence === undefined || typeof evidence === "string")
    )
      throw new Error(
        `${file}のmode assessmentが不正です。${MODE_ASSESSMENT_SHAPE}`,
      );
    answers[id] = { answer: answerValue, evidence };
  }
  return answers;
}

export function readSpecReview(file: string): SpecReviewInput {
  const value = readJsonInput(file);
  if (
    !isRecord(value) ||
    !exactFields(value, ["specImpact", "rationale", "trace"])
  )
    throw new Error(`${file}の仕様review入力が不正です`);
  if (value.specImpact !== undefined && typeof value.specImpact !== "string")
    throw new Error(`${file}の仕様review入力が不正です`);
  if (value.rationale !== undefined && typeof value.rationale !== "string")
    throw new Error(`${file}の仕様review入力が不正です`);
  if (value.trace === undefined)
    return { specImpact: value.specImpact, rationale: value.rationale };
  if (
    !isRecord(value.trace) ||
    !exactFields(value.trace, ["requirements", "scenarios", "tests"])
  )
    throw new Error(`${file}の仕様review入力が不正です`);
  const trace = value.trace;
  for (const key of ["requirements", "scenarios", "tests"])
    if (trace[key] !== undefined && !stringArray(trace[key]))
      throw new Error(`${file}の仕様review入力が不正です`);
  return {
    specImpact: value.specImpact,
    rationale: value.rationale,
    trace: {
      requirements: stringArray(trace.requirements)
        ? trace.requirements
        : undefined,
      scenarios: stringArray(trace.scenarios) ? trace.scenarios : undefined,
      tests: stringArray(trace.tests) ? trace.tests : undefined,
    },
  };
}

function enforcementInput(
  value: unknown,
): value is Omit<Parameters<typeof enforceOperation>[0], "policy"> {
  if (
    !isRecord(value) ||
    !exactFields(value, [
      "ruleId",
      "boundary",
      "violated",
      "reasons",
      "checks",
      "override",
      "expectedOverride",
      "online",
      "requiresExternal",
      "validation",
      "events",
    ])
  )
    return false;
  return (
    typeof value.ruleId === "string" &&
    typeof value.boundary === "string" &&
    typeof value.violated === "boolean" &&
    (value.reasons === undefined || stringArray(value.reasons)) &&
    (value.checks === undefined || stringArray(value.checks)) &&
    (value.online === undefined || typeof value.online === "boolean") &&
    (value.requiresExternal === undefined ||
      typeof value.requiresExternal === "boolean") &&
    (value.override === undefined || isRecord(value.override)) &&
    (value.expectedOverride === undefined ||
      isRecord(value.expectedOverride)) &&
    (value.validation === undefined || isRecord(value.validation)) &&
    (value.events === undefined ||
      (Array.isArray(value.events) && value.events.every(isRecord)))
  );
}

export function readEnforcementInput(
  file: string,
): Omit<Parameters<typeof enforceOperation>[0], "policy"> {
  const value = readJsonInput(file);
  if (!enforcementInput(value))
    throw new Error(`${file}のoperation入力が不正です`);
  return value;
}

export function readMigrationManifest(file: string): {
  root: string;
  entries: Parameters<typeof planFileMigration>[3];
} {
  const value = readJsonInput(file);
  if (
    !isRecord(value) ||
    !exactFields(value, ["root", "entries"]) ||
    typeof value.root !== "string" ||
    !Array.isArray(value.entries)
  )
    throw new Error("migration manifestの構造が不正です");
  const entries = value.entries.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      !exactFields(entry, ["kind", "path", "after"]) ||
      !isMigrationKind(entry.kind) ||
      typeof entry.path !== "string" ||
      typeof entry.after !== "string"
    )
      throw new Error("migration manifestの構造が不正です");
    return [{ kind: entry.kind, path: entry.path, after: entry.after }];
  });
  return { root: value.root, entries };
}

function hashOrNull(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))
  );
}

function manifestEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactFields(value, [
      "order",
      "kind",
      "path",
      "source",
      "owner",
      "retention",
      "beforeHash",
      "afterHash",
    ]) &&
    typeof value.order === "number" &&
    Number.isInteger(value.order) &&
    MIGRATION_KINDS.some((kind) => kind === value.kind) &&
    ["path", "source", "owner", "retention"].every(
      (key) => typeof value[key] === "string",
    ) &&
    hashOrNull(value.beforeHash) &&
    hashOrNull(value.afterHash)
  );
}

function migrationArtifact(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactFields(value, [
      "kind",
      "path",
      "after",
      "source",
      "owner",
      "retention",
      "beforeHash",
      "afterHash",
      "before",
    ]) &&
    MIGRATION_KINDS.some((kind) => kind === value.kind) &&
    ["path", "after", "source", "owner", "retention"].every(
      (key) => typeof value[key] === "string",
    ) &&
    hashOrNull(value.beforeHash) &&
    hashOrNull(value.afterHash) &&
    (value.before === null || typeof value.before === "string")
  );
}

function fileMigrationState(value: unknown): value is MigrationState {
  const allowed = [
    "state",
    "allowed",
    "revision",
    "history",
    "root",
    "trustedHash",
    "candidateHash",
    "candidateSetHash",
    "candidateSemanticPolicyHash",
    "candidateInventoryHash",
    "manifestHash",
    "compatibility",
    "manifest",
    "artifacts",
    "changes",
    "snapshot",
    "rollback",
    "retry",
    "planId",
    "planFingerprint",
    "diagnostic",
    "transaction",
    "recovery",
    "approvedPlanHash",
    "readAfterWrite",
    "rollbackVerified",
  ];
  return (
    isRecord(value) &&
    exactFields(value, allowed) &&
    typeof value.state === "string" &&
    typeof value.allowed === "boolean" &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision) &&
    stringArray(value.history) &&
    [
      "root",
      "trustedHash",
      "candidateHash",
      "manifestHash",
      "snapshot",
      "rollback",
      "retry",
      "planId",
      "planFingerprint",
    ].every((key) => typeof value[key] === "string") &&
    isRecord(value.compatibility) &&
    Array.isArray(value.manifest) &&
    value.manifest.every(manifestEntry) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(migrationArtifact) &&
    Array.isArray(value.changes) &&
    value.changes.every((change) =>
      MIGRATION_KINDS.some((kind) => kind === change),
    )
  );
}

function conceptualMigrationState(
  value: unknown,
): value is ConceptualMigrationState {
  const allowed = [
    "state",
    "fromVersion",
    "toVersion",
    "changes",
    "compatibility",
    "dryRun",
    "writes",
    "snapshot",
    "candidate",
    "revision",
    "trustedHash",
    "candidateHash",
    "dryRunDiff",
    "rollback",
    "retry",
    "planId",
    "planFingerprint",
    "history",
    "policy",
    "allowed",
    "diagnostic",
  ];
  return (
    isRecord(value) &&
    exactFields(value, allowed) &&
    [
      "state",
      "fromVersion",
      "toVersion",
      "trustedHash",
      "candidateHash",
      "rollback",
      "retry",
      "planId",
      "planFingerprint",
    ].every((key) => typeof value[key] === "string") &&
    stringArray(value.changes) &&
    isRecord(value.compatibility) &&
    typeof value.dryRun === "boolean" &&
    Array.isArray(value.writes) &&
    isPolicyInput(value.snapshot) &&
    isPolicyInput(value.candidate) &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision) &&
    isRecord(value.dryRunDiff) &&
    (value.history === undefined || stringArray(value.history)) &&
    (value.policy === undefined || isPolicyInput(value.policy)) &&
    (value.allowed === undefined || typeof value.allowed === "boolean") &&
    (value.diagnostic === undefined || isRecord(value.diagnostic))
  );
}

export function readMigrationState(file: string): LoadedMigrationState {
  const value = readJsonInput(file);
  if (isRecord(value) && value.manifest !== undefined) {
    if (!fileMigrationState(value))
      throw new Error("file migration stateの構造が不正です");
    return { kind: "file", state: value };
  }
  if (!conceptualMigrationState(value))
    throw new Error("conceptual migration stateの構造が不正です");
  return { kind: "conceptual", state: value };
}

export function readFinalizeEvidence(file: string): FinalizeEvidenceInput {
  const value = readJsonInput(file);
  if (
    !isRecord(value) ||
    !exactFields(value, [
      "repository",
      "base",
      "specConsistent",
      "testsPassed",
      "reviewApproved",
      "prMerged",
    ])
  )
    throw new Error(`${file}のfinalize evidenceが不正です`);
  const evidenceValue = (item: unknown): item is boolean | "unknown" =>
    typeof item === "boolean" || item === "unknown";
  if (
    typeof value.repository !== "string" ||
    typeof value.base !== "string" ||
    !evidenceValue(value.specConsistent) ||
    !evidenceValue(value.testsPassed) ||
    !evidenceValue(value.reviewApproved) ||
    !evidenceValue(value.prMerged)
  )
    throw new Error(`${file}のfinalize evidenceが不正です`);
  return {
    repository: value.repository,
    base: value.base,
    specConsistent: value.specConsistent,
    testsPassed: value.testsPassed,
    reviewApproved: value.reviewApproved,
    prMerged: value.prMerged,
  };
}

export function readDeliveryEvidence(file: string): DeliveryEvidenceInput {
  const value = readJsonInput(file);
  if (
    !isRecord(value) ||
    !exactFields(value, ["headSha", "review", "tests", "spec", "ownership"]) ||
    typeof value.headSha !== "string" ||
    !isRecord(value.review) ||
    !isRecord(value.tests) ||
    !isRecord(value.spec) ||
    (value.ownership !== undefined && !isRecord(value.ownership))
  )
    throw new Error(`${file}のPR evidenceが不正です`);
  return {
    headSha: value.headSha,
    review: value.review,
    tests: value.tests,
    spec: value.spec,
    ownership: isRecord(value.ownership) ? value.ownership : undefined,
  };
}
