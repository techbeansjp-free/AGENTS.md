export type Enforcement = "deny" | "require" | "assist" | "warn" | "record";
export type Activation = "active" | "staged" | "disabled";
export type TargetLayer = "package" | "project" | "spec" | "evidence";

export interface ApplicabilityDecision {
  status: "applicable" | "not-applicable";
  reason: string;
  evidence: string;
}

export type RoutingRole = "coordinator" | "implementer" | "reviewer";
export type RoutingRouteMode = "preferred" | "fallback";
export type RoutingModelSelection =
  "provider_recommended_default" | "project_default";
export type RoutingReason =
  | "preferred_implementer_available"
  | "preferred_implementer_unavailable"
  | "preferred_capability_mapping_missing"
  | "preferred_capability_unconfirmed"
  | "preferred_selection_source_unconfirmed"
  | "preferred_model_catalog_empty"
  | "preferred_recommended_default_missing"
  | "preferred_recommended_default_ambiguous"
  | "preferred_reasoning_effort_unsupported";

export interface RoleModelChoice {
  provider: string;
  logicalTier: "project_default" | "highest_available";
  reasoningEffort: "high";
  speed: "standard";
}

export interface ReviewerRoleModelChoice extends RoleModelChoice {
  independence: {
    differentFrom: "implementer";
  };
}

export interface RoutingEvidenceRetentionChoice {
  retentionDays: number;
  maxRecordsPerIssue: number;
  maxRecordBytes: number;
  rotationCondition: "oldest_first";
  deletionMethod: "preview_then_explicit";
}

export type ModelTierChoice = "routine" | "standard" | "advanced" | "critical";

export interface RoleContractChoice {
  allowedPaths: string[];
  allowedOperations: string[];
  forbiddenOperations: string[];
  requiredEvidence: string[];
}

export interface ModelMappingChoice {
  roles: {
    coordinator: RoleModelChoice;
    implementer: RoleModelChoice;
    reviewer: ReviewerRoleModelChoice;
  };
  fallback: {
    when: "implementer_unavailable";
    role: "coordinator";
    modelSelection: "project_default";
  };
  evidenceStoreRoot: string;
  retention: RoutingEvidenceRetentionChoice;
  roleContracts?: Record<string, RoleContractChoice>;
  tierMapping?: Record<string, ModelTierChoice>;
  minimumTierByRisk?: Record<string, ModelTierChoice>;
}

export interface ProviderCapability {
  provider: string;
  capabilities: string[];
  selectionSource: "provider_recommended_default";
}

export interface ProviderCapabilityMapping {
  schemaVersion: "agent-skill-chain/provider-capability-mapping/v2";
  mappingVersion: string;
  providers: ProviderCapability[];
}

export interface ProviderModelObservation {
  model: string;
  recommended: boolean;
  supportedReasoningEfforts: string[];
}

export interface Rule {
  ruleId: string;
  purpose: string;
  riskClass: string;
  scope: string[];
  enforcement: Enforcement;
  activation: Activation;
  owner: string;
  targetLayer: TargetLayer;
  evidence: string;
  remediation: string;
  overridePolicy: "never" | "bound";
  rollback: string;
}

export interface ProjectChoices {
  language: string;
  testRunner: string;
  gherkinDialect: string;
  testLayers: string[];
  forbiddenTestFileSuffixes: string[];
  naming: string;
  packageManager: string;
  runtime: string;
  ci: string;
  modelMapping?: string | ModelMappingChoice;
  release: string;
  projectKind: string;
  capabilities: {
    privacySecurity: ApplicabilityDecision;
    observability: ApplicabilityDecision;
    humanCenteredUi: ApplicabilityDecision;
    designTokens: ApplicabilityDecision;
  };
  quality: {
    implementationLanguage: string;
    strictTypecheck: true;
    forbiddenTypes: string[];
    lintCommand: string;
    formatCheckCommand: string;
    formatWriteCommand: string;
    typecheckCommand: string;
    runtimeValidation: string;
    auxiliaryLanguages: Record<string, ApplicabilityDecision>;
  };
}

export interface Policy {
  schemaVersion: string;
  delivery: { stopAt: "pull_request" };
  merge: {
    mode: "disabled" | "assisted" | "automatic";
    branches: string[];
    methods: Array<"merge" | "squash" | "rebase">;
    requiredChecks: string[];
    requiredReviews: number;
  };
  budgets?: { localFeedbackMs?: number; prGateMs?: number };
  worktree?: {
    root: string;
    namePattern: string;
    branchPattern: string;
    allowedBranchTypes: string[];
    base: string;
    cleanup: string;
  };
  rules: Rule[];
  projectChoices?: ProjectChoices;
}

export interface AutoFix {
  description: string;
  dryRunDiff: string;
}

export interface Diagnostic {
  ruleId: string;
  purpose: string;
  risk: string;
  reasons: string[];
  scope: string[];
  checks: string[];
  autoFixes: AutoFix[];
  next: string;
  requiredAuthority: string;
  rollback: string;
}

export interface RuleObservation {
  ruleId: string;
  violated: boolean;
  reasons?: string[];
  checks?: string[];
}

export interface OverrideRecord {
  ruleId?: string;
  issue?: number;
  scope?: string;
  actor?: string;
  reason?: string;
  expiresAt?: string;
  sha?: string;
}

export interface ValidationEvidence {
  sha?: string;
  policyHash?: string;
  tool?: string;
  scope?: string[];
  passed?: boolean;
}

export interface ValidationInput {
  kind: "targeted" | "final";
  changedFiles: string[];
  risk: string[];
  evidence: ValidationEvidence;
  successfulFingerprints?: string[];
  successfulEvidence?: Array<
    ValidationEvidence & { fingerprint: string; passed: boolean }
  >;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
