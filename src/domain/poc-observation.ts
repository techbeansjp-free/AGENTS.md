import crypto from "node:crypto";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import {
  POC_OBSERVABLE_KINDS,
  type PocDeclaration,
  type PocObservableKind,
} from "./mode.js";

export const POC_OBSERVATION_FILE = "poc-observation.json";
export const POC_OBSERVATION_DIRECTORY = "poc-observations";
export const POC_OBSERVATION_SCHEMA = "agent-skill-chain/poc-observation/v1";

export interface PocObservationResult {
  observableId: string;
  scenarioId: string;
  kind: PocObservableKind;
  target: string | null;
  expected: string | number;
  actual: string | number;
  status: "passed" | "failed";
  resultDigest: string;
}

export interface PocScenarioExecution {
  scenarioId: string;
  exitCode: number;
  signal: string | null;
  executionDigest: string;
}

export interface PocObservationEvidence {
  schemaVersion: typeof POC_OBSERVATION_SCHEMA;
  declarationDigest: string;
  headSha: string;
  observedAt: string;
  fixture: { id: string; root: string; digest: string };
  runner: { id: string; path: string; digest: string };
  executions: PocScenarioExecution[];
  results: PocObservationResult[];
  evidenceDigest: string;
}

const EVIDENCE_FIELDS = new Set([
  "schemaVersion",
  "declarationDigest",
  "headSha",
  "observedAt",
  "fixture",
  "runner",
  "executions",
  "results",
  "evidenceDigest",
]);
const FIXTURE_FIELDS = new Set(["id", "root", "digest"]);
const RUNNER_FIELDS = new Set(["id", "path", "digest"]);
const RESULT_FIELDS = new Set([
  "observableId",
  "scenarioId",
  "kind",
  "target",
  "expected",
  "actual",
  "status",
  "resultDigest",
]);
const EXECUTION_FIELDS = new Set([
  "scenarioId",
  "exitCode",
  "signal",
  "executionDigest",
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;

export function pocObservationArtifact(headSha: string): string {
  if (!GIT_SHA.test(headSha))
    throw new Error("PoC observation artifactには完全な40桁HEAD SHAが必要です");
  return `${POC_OBSERVATION_DIRECTORY}/${headSha}.json`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function exactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  return (
    Object.keys(value).length === fields.size &&
    Object.keys(value).every((field) => fields.has(field))
  );
}

function isUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

export function pocDeclarationDigest(declaration: PocDeclaration): string {
  return sha256(stableJson(declaration));
}

export function pocObservationResultDigest(
  result: Omit<PocObservationResult, "resultDigest">,
): string {
  return sha256(stableJson(result));
}

export function pocScenarioExecutionDigest(
  execution: Omit<PocScenarioExecution, "executionDigest">,
): string {
  return sha256(stableJson(execution));
}

export function pocObservationEvidenceDigest(
  evidence: Omit<PocObservationEvidence, "evidenceDigest">,
): string {
  return sha256(stableJson(evidence));
}

export function parsePocObservationEvidence(source: string): {
  evidence?: PocObservationEvidence;
  errors: string[];
} {
  if (Buffer.byteLength(source, "utf8") > 256 * 1024)
    return { errors: ["poc-observation Evidenceが256KiB上限を超えています"] };
  let value: unknown;
  try {
    value = parseJsonStrict(source, POC_OBSERVATION_FILE);
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)] };
  }
  if (!isRecord(value))
    return { errors: ["poc-observation Evidenceはobjectが必要です"] };

  const errors: string[] = [];
  if (!exactFields(value, EVIDENCE_FIELDS))
    errors.push("poc-observation Evidenceのfield集合が不正です");
  if (value.schemaVersion !== POC_OBSERVATION_SCHEMA)
    errors.push("poc-observation EvidenceのschemaVersionが不正です");
  if (!SHA256.test(String(value.declarationDigest ?? "")))
    errors.push("poc-observation EvidenceのdeclarationDigestが不正です");
  if (!GIT_SHA.test(String(value.headSha ?? "")))
    errors.push("poc-observation EvidenceのheadShaが不正です");
  if (!isUtcInstant(value.observedAt))
    errors.push("poc-observation EvidenceのobservedAtが不正です");
  if (!SHA256.test(String(value.evidenceDigest ?? "")))
    errors.push("poc-observation EvidenceのevidenceDigestが不正です");

  let fixture: PocObservationEvidence["fixture"] | undefined;
  if (!isRecord(value.fixture) || !exactFields(value.fixture, FIXTURE_FIELDS))
    errors.push("poc-observation Evidenceのfixture構造が不正です");
  else if (
    !nonEmpty(value.fixture.id) ||
    !nonEmpty(value.fixture.root) ||
    !SHA256.test(String(value.fixture.digest ?? ""))
  )
    errors.push("poc-observation Evidenceのfixture値が不正です");
  else
    fixture = {
      id: value.fixture.id,
      root: value.fixture.root,
      digest: value.fixture.digest as string,
    };

  let runner: PocObservationEvidence["runner"] | undefined;
  if (!isRecord(value.runner) || !exactFields(value.runner, RUNNER_FIELDS))
    errors.push("poc-observation Evidenceのrunner構造が不正です");
  else if (
    !nonEmpty(value.runner.id) ||
    !nonEmpty(value.runner.path) ||
    !SHA256.test(String(value.runner.digest ?? ""))
  )
    errors.push("poc-observation Evidenceのrunner値が不正です");
  else
    runner = {
      id: value.runner.id,
      path: value.runner.path,
      digest: value.runner.digest as string,
    };

  const executions: PocScenarioExecution[] = [];
  if (!Array.isArray(value.executions) || value.executions.length === 0)
    errors.push("poc-observation Evidenceのexecutionsは1件以上必要です");
  else
    value.executions.forEach((item, index) => {
      if (!isRecord(item) || !exactFields(item, EXECUTION_FIELDS)) {
        errors.push(
          `poc-observation executions[${index}]のfield集合が不正です`,
        );
        return;
      }
      if (
        !nonEmpty(item.scenarioId) ||
        !Number.isInteger(item.exitCode) ||
        (item.signal !== null && !nonEmpty(item.signal)) ||
        !SHA256.test(String(item.executionDigest ?? ""))
      ) {
        errors.push(`poc-observation executions[${index}]の値が不正です`);
        return;
      }
      const execution: PocScenarioExecution = {
        scenarioId: item.scenarioId,
        exitCode: item.exitCode as number,
        signal: item.signal as string | null,
        executionDigest: item.executionDigest as string,
      };
      const { executionDigest, ...identity } = execution;
      if (pocScenarioExecutionDigest(identity) !== executionDigest)
        errors.push(
          `poc-observation executions[${index}]のdigestが一致しません`,
        );
      executions.push(execution);
    });
  if (
    new Set(executions.map(({ scenarioId }) => scenarioId)).size !==
    executions.length
  )
    errors.push("poc-observation executionのscenarioIdが重複しています");

  const results: PocObservationResult[] = [];
  if (!Array.isArray(value.results) || value.results.length === 0)
    errors.push("poc-observation Evidenceのresultsは1件以上必要です");
  else {
    const knownKinds = new Set<string>(POC_OBSERVABLE_KINDS);
    value.results.forEach((item, index) => {
      if (!isRecord(item) || !exactFields(item, RESULT_FIELDS)) {
        errors.push(`poc-observation results[${index}]のfield集合が不正です`);
        return;
      }
      if (
        !nonEmpty(item.observableId) ||
        !nonEmpty(item.scenarioId) ||
        !knownKinds.has(String(item.kind ?? "")) ||
        (item.target !== null && !nonEmpty(item.target)) ||
        (typeof item.expected !== "string" &&
          typeof item.expected !== "number") ||
        (typeof item.actual !== "string" && typeof item.actual !== "number") ||
        (item.status !== "passed" && item.status !== "failed") ||
        !SHA256.test(String(item.resultDigest ?? ""))
      ) {
        errors.push(`poc-observation results[${index}]の値が不正です`);
        return;
      }
      const result: PocObservationResult = {
        observableId: item.observableId,
        scenarioId: item.scenarioId,
        kind: item.kind as PocObservableKind,
        target: item.target as string | null,
        expected: item.expected as string | number,
        actual: item.actual as string | number,
        status: item.status,
        resultDigest: item.resultDigest as string,
      };
      const typedValueValid =
        result.kind === "exit-code"
          ? Number.isInteger(result.expected) &&
            Number.isInteger(result.actual) &&
            result.target === null
          : result.kind === "file-digest"
            ? typeof result.expected === "string" &&
              typeof result.actual === "string" &&
              SHA256.test(result.expected) &&
              SHA256.test(result.actual) &&
              nonEmpty(result.target)
            : typeof result.expected === "string" &&
              typeof result.actual === "string" &&
              SHA256.test(result.expected) &&
              SHA256.test(result.actual) &&
              result.target === null;
      if (!typedValueValid)
        errors.push(`poc-observation results[${index}]のkind別形式が不正です`);
      if ((result.actual === result.expected) !== (result.status === "passed"))
        errors.push(
          `poc-observation results[${index}]のstatusが計測値と一致しません`,
        );
      const { resultDigest, ...identity } = result;
      if (pocObservationResultDigest(identity) !== resultDigest)
        errors.push(`poc-observation results[${index}]のdigestが一致しません`);
      results.push(result);
    });
  }
  if (
    new Set(results.map(({ observableId }) => observableId)).size !==
    results.length
  )
    errors.push("poc-observation resultのobservableIdが重複しています");

  if (
    errors.length > 0 ||
    !fixture ||
    !runner ||
    !isUtcInstant(value.observedAt)
  )
    return { errors };
  const evidence: PocObservationEvidence = {
    schemaVersion: POC_OBSERVATION_SCHEMA,
    declarationDigest: value.declarationDigest as string,
    headSha: value.headSha as string,
    observedAt: value.observedAt,
    fixture,
    runner,
    executions,
    results,
    evidenceDigest: value.evidenceDigest as string,
  };
  const { evidenceDigest, ...identity } = evidence;
  if (pocObservationEvidenceDigest(identity) !== evidenceDigest)
    return {
      errors: ["poc-observation Evidenceの全体digestが一致しません"],
    };
  return { evidence, errors: [] };
}

export function validatePocObservationEvidence(input: {
  source: string;
  declaration: PocDeclaration;
  headSha: string;
}): {
  valid: boolean;
  evidence?: PocObservationEvidence;
  errors: string[];
} {
  const parsed = parsePocObservationEvidence(input.source);
  if (!parsed.evidence) return { valid: false, errors: parsed.errors };
  const evidence = parsed.evidence;
  const errors = [...parsed.errors];
  if (!GIT_SHA.test(input.headSha)) errors.push("検証対象HEAD SHAが不正です");
  else if (evidence.headSha !== input.headSha)
    errors.push("poc-observation EvidenceのHEADが検証対象HEADと一致しません");
  if (evidence.declarationDigest !== pocDeclarationDigest(input.declaration))
    errors.push("poc-observation EvidenceのPoC宣言digestが一致しません");
  if (
    evidence.fixture.id !== input.declaration.fixture.id ||
    evidence.fixture.root !== input.declaration.fixture.root
  )
    errors.push("poc-observation Evidenceの隔離fixtureがPoC宣言と一致しません");
  if (
    evidence.runner.id !== input.declaration.fixture.runner.id ||
    evidence.runner.path !== input.declaration.fixture.runner.path
  )
    errors.push("poc-observation EvidenceのrunnerがPoC宣言と一致しません");
  if (evidence.executions.length !== input.declaration.scenarios.length)
    errors.push(
      "poc-observation execution集合が宣言済みscenario集合と一致しません",
    );
  for (let index = 0; index < input.declaration.scenarios.length; index += 1) {
    const scenario = input.declaration.scenarios[index];
    const execution = evidence.executions[index];
    if (!scenario || !execution) continue;
    if (execution.scenarioId !== scenario.id)
      errors.push(
        `poc-observation executions[${index}]が宣言済みscenario ${scenario.id} と一致しません`,
      );
    if (execution.exitCode !== 0 || execution.signal !== null)
      errors.push(
        `poc-observation scenario ${scenario.id} のrunnerが正常終了していません`,
      );
  }
  if (evidence.results.length !== input.declaration.observables.length)
    errors.push(
      "poc-observation result集合が宣言済みobservable集合と一致しません",
    );
  for (
    let index = 0;
    index < input.declaration.observables.length;
    index += 1
  ) {
    const expected = input.declaration.observables[index];
    const observed = evidence.results[index];
    if (!expected || !observed) continue;
    if (
      observed.observableId !== expected.id ||
      observed.scenarioId !== expected.scenarioId ||
      observed.kind !== expected.kind ||
      observed.target !== (expected.target ?? null) ||
      observed.expected !== expected.expected
    )
      errors.push(
        `poc-observation results[${index}]が宣言済みobservable ${expected.id} と完全一致しません`,
      );
    if (observed.actual !== observed.expected || observed.status !== "passed")
      errors.push(
        `poc-observation observable ${expected.id} が合格していません`,
      );
  }
  return {
    valid: errors.length === 0,
    evidence,
    errors: [...new Set(errors)],
  };
}
