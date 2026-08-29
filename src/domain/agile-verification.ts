import { isRecord } from "../types.js";

export type ChangeType =
  | "bug-fix"
  | "new-feature"
  | "refactoring"
  | "documentation"
  | "configuration"
  | "migration"
  | "security-sensitive"
  | "algorithm"
  | "api"
  | "concurrency";

export type ChangeRisk = "low" | "medium" | "high" | "critical";

export type VerificationMethod =
  | "bug-reproduction"
  | "unit-test"
  | "integration-test"
  | "acceptance-test"
  | "regression-test"
  | "contract-test"
  | "property-based-test"
  | "differential-test"
  | "mutation-test"
  | "static-analysis"
  | "type-check"
  | "schema-validation"
  | "security-analysis"
  | "dependency-analysis"
  | "graph-conformance-check"
  | "build"
  | "runtime-validation"
  | "rollback-validation"
  | "compatibility-test"
  | "negative-test"
  | "race-test"
  | "stress-test"
  | "invariant-test";

const methods = (
  ...values: VerificationMethod[]
): readonly VerificationMethod[] => Object.freeze(values);

const BASE_VERIFICATION: Readonly<
  Record<ChangeType, readonly VerificationMethod[]>
> = Object.freeze({
  "bug-fix": methods("bug-reproduction", "regression-test", "integration-test"),
  "new-feature": methods("acceptance-test", "integration-test", "build"),
  refactoring: methods("regression-test", "static-analysis", "type-check"),
  documentation: methods(
    "schema-validation",
    "graph-conformance-check",
    "build",
  ),
  configuration: methods(
    "schema-validation",
    "contract-test",
    "integration-test",
  ),
  migration: methods(
    "runtime-validation",
    "rollback-validation",
    "compatibility-test",
  ),
  "security-sensitive": methods(
    "negative-test",
    "security-analysis",
    "static-analysis",
  ),
  algorithm: methods("unit-test", "property-based-test", "differential-test"),
  api: methods("contract-test", "integration-test", "acceptance-test"),
  concurrency: methods("race-test", "stress-test", "invariant-test"),
});

export interface VerificationSelection {
  changeType: ChangeType;
  risk: ChangeRisk;
  affectedBoundaries: readonly string[];
  requirementIds: readonly string[];
  acceptanceCriteriaIds: readonly string[];
  impactAnalysis: VerificationImpactAnalysis;
  methods: readonly VerificationMethod[];
}

export interface VerificationImpactAnalysis {
  securityRelevant: boolean;
  dataLossPossible: boolean;
  irreversibleOperation: boolean;
  externalContractChanged: boolean;
  concurrentBehaviorChanged: boolean;
}

export interface VerificationSelectionInput {
  changeType: ChangeType;
  risk: ChangeRisk;
  affectedBoundaries: readonly string[];
  requirementIds: readonly string[];
  acceptanceCriteriaIds: readonly string[];
  impactAnalysis: VerificationImpactAnalysis;
}

const CHANGE_TYPES: readonly ChangeType[] = Object.freeze([
  "bug-fix",
  "new-feature",
  "refactoring",
  "documentation",
  "configuration",
  "migration",
  "security-sensitive",
  "algorithm",
  "api",
  "concurrency",
]);

const CHANGE_RISKS: readonly ChangeRisk[] = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
]);

function exactInputObject(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}はobjectが必要です`);
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  if (unknown.length > 0)
    throw new Error(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
  const missing = fields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (missing.length > 0)
    throw new Error(`${label}の必須fieldがありません: ${missing.join(", ")}`);
  return value;
}

function nonEmptyStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label}は空でない文字列配列が必要です`);
  const strings: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string" || item.trim() === "")
      throw new Error(`${label}は空でない文字列配列が必要です`);
    strings.push(item);
  }
  return Object.freeze(strings);
}

function requiredBoolean(
  value: Record<string, unknown>,
  field: string,
  label: string,
): boolean {
  if (typeof value[field] !== "boolean")
    throw new Error(`${label}.${field}はbooleanが必要です`);
  return value[field];
}

export function parseVerificationSelectionInput(
  value: unknown,
): VerificationSelectionInput {
  const input = exactInputObject(value, "Verification Set入力", [
    "changeType",
    "risk",
    "affectedBoundaries",
    "requirementIds",
    "acceptanceCriteriaIds",
    "impactAnalysis",
  ]);
  if (!CHANGE_TYPES.some((changeType) => changeType === input.changeType))
    throw new Error("Verification Set入力.changeTypeが不正です");
  if (!CHANGE_RISKS.some((risk) => risk === input.risk))
    throw new Error("Verification Set入力.riskが不正です");
  const impact = exactInputObject(
    input.impactAnalysis,
    "Verification Set入力.impactAnalysis",
    [
      "securityRelevant",
      "dataLossPossible",
      "irreversibleOperation",
      "externalContractChanged",
      "concurrentBehaviorChanged",
    ],
  );
  return {
    changeType: input.changeType as ChangeType,
    risk: input.risk as ChangeRisk,
    affectedBoundaries: nonEmptyStringArray(
      input.affectedBoundaries,
      "Verification Set入力.affectedBoundaries",
    ),
    requirementIds: nonEmptyStringArray(
      input.requirementIds,
      "Verification Set入力.requirementIds",
    ),
    acceptanceCriteriaIds: nonEmptyStringArray(
      input.acceptanceCriteriaIds,
      "Verification Set入力.acceptanceCriteriaIds",
    ),
    impactAnalysis: Object.freeze({
      securityRelevant: requiredBoolean(
        impact,
        "securityRelevant",
        "Verification Set入力.impactAnalysis",
      ),
      dataLossPossible: requiredBoolean(
        impact,
        "dataLossPossible",
        "Verification Set入力.impactAnalysis",
      ),
      irreversibleOperation: requiredBoolean(
        impact,
        "irreversibleOperation",
        "Verification Set入力.impactAnalysis",
      ),
      externalContractChanged: requiredBoolean(
        impact,
        "externalContractChanged",
        "Verification Set入力.impactAnalysis",
      ),
      concurrentBehaviorChanged: requiredBoolean(
        impact,
        "concurrentBehaviorChanged",
        "Verification Set入力.impactAnalysis",
      ),
    }),
  };
}

function requireIdentifiers(values: readonly string[], label: string): void {
  if (values.length === 0 || values.some((value) => value.trim() === ""))
    throw new Error(`${label}を1件以上指定してください`);
}

export function selectVerificationSet(
  input: VerificationSelectionInput,
): VerificationSelection {
  requireIdentifiers(input.requirementIds, "Requirement ID");
  requireIdentifiers(input.acceptanceCriteriaIds, "Acceptance Criteria ID");
  if (input.affectedBoundaries.length === 0)
    throw new Error("Affected Boundaryを1件以上指定してください");
  const methods = new Set<VerificationMethod>(
    BASE_VERIFICATION[input.changeType],
  );
  if (input.affectedBoundaries.length > 1) methods.add("integration-test");
  if (
    input.risk === "high" ||
    input.risk === "critical" ||
    input.impactAnalysis.securityRelevant
  ) {
    methods.add("negative-test");
    methods.add("security-analysis");
  }
  if (
    input.impactAnalysis.dataLossPossible ||
    input.impactAnalysis.irreversibleOperation
  ) {
    methods.add("regression-test");
    methods.add("rollback-validation");
  }
  if (input.impactAnalysis.externalContractChanged) {
    methods.add("contract-test");
    methods.add("integration-test");
  }
  if (input.impactAnalysis.concurrentBehaviorChanged) {
    methods.add("race-test");
    methods.add("invariant-test");
  }
  return {
    changeType: input.changeType,
    risk: input.risk,
    affectedBoundaries: Object.freeze([...input.affectedBoundaries]),
    requirementIds: Object.freeze([...input.requirementIds]),
    acceptanceCriteriaIds: Object.freeze([...input.acceptanceCriteriaIds]),
    impactAnalysis: Object.freeze({ ...input.impactAnalysis }),
    methods: Object.freeze([...methods]),
  };
}

export interface ImplementationDiscovery {
  workflowMode: "full" | "quick" | "poc";
  modeDisqualifiers: readonly ModeDisqualifierEvidence[];
  changesGoal: boolean;
  changesScope: boolean;
  changesAcceptanceCriteria: boolean;
  expandsSecurityBoundary: boolean;
  introducesIrreversibleOperation: boolean;
}

export interface ModeDisqualifierEvidence {
  id: string;
  evidence: string;
}

function parseModeDisqualifiers(
  value: unknown,
): readonly ModeDisqualifierEvidence[] {
  if (!Array.isArray(value))
    throw new Error("実装中発見入力.modeDisqualifiersは配列が必要です");
  const ids = new Set<string>();
  return Object.freeze(
    value.map((candidate, index) => {
      const label = `実装中発見入力.modeDisqualifiers[${index}]`;
      const item = exactInputObject(candidate, label, ["id", "evidence"]);
      const id = item.id;
      const evidence = item.evidence;
      if (typeof id !== "string" || id.trim() === "")
        throw new Error(`${label}.idは空でない文字列が必要です`);
      if (typeof evidence !== "string" || evidence.trim() === "")
        throw new Error(`${label}.evidenceは空でない文字列が必要です`);
      const normalizedId = id.trim();
      if (ids.has(normalizedId))
        throw new Error(
          `実装中発見入力.modeDisqualifiersの重複idを拒否しました: ${normalizedId}`,
        );
      ids.add(normalizedId);
      return Object.freeze({ id: normalizedId, evidence });
    }),
  );
}

export function parseImplementationDiscoveryInput(
  value: unknown,
): ImplementationDiscovery {
  const input = exactInputObject(value, "実装中発見入力", [
    "workflowMode",
    "modeDisqualifiers",
    "changesGoal",
    "changesScope",
    "changesAcceptanceCriteria",
    "expandsSecurityBoundary",
    "introducesIrreversibleOperation",
  ]);
  if (
    input.workflowMode !== "full" &&
    input.workflowMode !== "quick" &&
    input.workflowMode !== "poc"
  )
    throw new Error("実装中発見入力.workflowModeが不正です");
  return Object.freeze({
    workflowMode: input.workflowMode,
    modeDisqualifiers: parseModeDisqualifiers(input.modeDisqualifiers),
    changesGoal: requiredBoolean(input, "changesGoal", "実装中発見入力"),
    changesScope: requiredBoolean(input, "changesScope", "実装中発見入力"),
    changesAcceptanceCriteria: requiredBoolean(
      input,
      "changesAcceptanceCriteria",
      "実装中発見入力",
    ),
    expandsSecurityBoundary: requiredBoolean(
      input,
      "expandsSecurityBoundary",
      "実装中発見入力",
    ),
    introducesIrreversibleOperation: requiredBoolean(
      input,
      "introducesIrreversibleOperation",
      "実装中発見入力",
    ),
  });
}

export type DiscoveryDisposition =
  | "continue"
  | "rebaseline-affected-contracts"
  | "promote-to-full"
  | "stop-or-promote-full";

export interface DiscoveryAssessment {
  workflowMode: ImplementationDiscovery["workflowMode"];
  modeDisqualifiers: readonly ModeDisqualifierEvidence[];
  disposition: DiscoveryDisposition;
  affectedArtifacts: readonly string[];
  requiredRecordFields: readonly string[];
}

const DISCOVERY_RECORD_FIELDS = Object.freeze([
  "fact",
  "impact",
  "decision",
  "action",
  "verification",
  "specificationUpdate",
]);

export function assessImplementationDiscovery(
  discovery: ImplementationDiscovery,
): DiscoveryAssessment {
  const workflowMode = discovery.workflowMode;
  const modeDisqualifiers = Object.freeze(
    discovery.modeDisqualifiers.map((item) => Object.freeze({ ...item })),
  );
  const contractChanged =
    discovery.changesGoal ||
    discovery.changesScope ||
    discovery.changesAcceptanceCriteria ||
    discovery.expandsSecurityBoundary ||
    discovery.introducesIrreversibleOperation ||
    discovery.modeDisqualifiers.length > 0;
  if (!contractChanged)
    return {
      workflowMode,
      modeDisqualifiers,
      disposition: "continue",
      affectedArtifacts: Object.freeze([]),
      requiredRecordFields: DISCOVERY_RECORD_FIELDS,
    };

  if (discovery.workflowMode === "quick") {
    const mustPromote =
      discovery.expandsSecurityBoundary ||
      discovery.introducesIrreversibleOperation ||
      discovery.modeDisqualifiers.length > 0;
    return {
      workflowMode,
      modeDisqualifiers,
      disposition: mustPromote
        ? "promote-to-full"
        : "rebaseline-affected-contracts",
      affectedArtifacts: Object.freeze(
        mustPromote
          ? ["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]
          : ["00_要求定義.md"],
      ),
      requiredRecordFields: DISCOVERY_RECORD_FIELDS,
    };
  }

  if (discovery.workflowMode === "poc") {
    const unsafeForPoc =
      discovery.expandsSecurityBoundary ||
      discovery.introducesIrreversibleOperation ||
      discovery.modeDisqualifiers.length > 0;
    return {
      workflowMode,
      modeDisqualifiers,
      disposition: unsafeForPoc
        ? "stop-or-promote-full"
        : "rebaseline-affected-contracts",
      affectedArtifacts: Object.freeze(
        unsafeForPoc
          ? ["00_要求定義.md", "01_要件定義.md", "02_設計.md", "03_実装計画.md"]
          : ["00_要求定義.md"],
      ),
      requiredRecordFields: DISCOVERY_RECORD_FIELDS,
    };
  }

  const affected = new Set<string>();
  if (discovery.changesGoal || discovery.changesScope)
    affected.add("00_要求定義.md");
  if (
    discovery.changesGoal ||
    discovery.changesScope ||
    discovery.changesAcceptanceCriteria ||
    discovery.expandsSecurityBoundary ||
    discovery.introducesIrreversibleOperation ||
    discovery.modeDisqualifiers.length > 0
  ) {
    affected.add("01_要件定義.md");
    affected.add("02_設計.md");
    affected.add("03_実装計画.md");
  }
  return {
    workflowMode,
    modeDisqualifiers,
    disposition: "rebaseline-affected-contracts",
    affectedArtifacts: Object.freeze([...affected]),
    requiredRecordFields: DISCOVERY_RECORD_FIELDS,
  };
}

export type DeliveryContinuation =
  "stop-at-pr" | "wait-authority" | "wait-merge-ready" | "invoke-pr-merge";

export function assertWorkflowMergeAllowed(
  workflowMode: "full" | "quick" | "poc",
): void {
  if (workflowMode === "poc")
    throw new Error("PoCはPRが停止点でありpr mergeを実行できません");
}

export function decideDeliveryContinuation(input: {
  workflowMode: "full" | "quick" | "poc";
  trustedMergeMode: "disabled" | "assisted" | "automatic";
  assistedAuthorityVerified: boolean;
  mergeReadyVerified: boolean;
}): DeliveryContinuation {
  if (input.workflowMode === "poc" || input.trustedMergeMode === "disabled")
    return "stop-at-pr";
  if (input.trustedMergeMode === "assisted" && !input.assistedAuthorityVerified)
    return "wait-authority";
  if (!input.mergeReadyVerified) return "wait-merge-ready";
  return "invoke-pr-merge";
}
