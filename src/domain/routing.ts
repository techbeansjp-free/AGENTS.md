import type {
  ModelMappingChoice,
  ProviderCapabilityMapping,
  ProviderModelObservation,
  RoutingRole,
} from "../types.js";

export type RoutingAvailabilityState = "available" | "unavailable" | "unknown";

export interface RoutingAvailability {
  provider: string;
  state: RoutingAvailabilityState;
  models: string[];
  modelMetadata: ProviderModelObservation[];
  observedAt: string;
  entrypoint: string;
}

export interface RoutingResolutionInput {
  scope: string;
  coordinatorIdentity: string;
  implementerIdentity: string;
  reviewerIdentity: string;
  availability: RoutingAvailability;
  mapping: ProviderCapabilityMapping;
  modelMapping: ModelMappingChoice | undefined;
  requiredCapability: string;
  evaluatorRef: string;
}

interface RoleIdentity {
  identity: string;
  provider: string;
}

export interface ResolvedRoutingDecision {
  state: "resolved";
  scope: string;
  provider: string;
  model: string;
  mappingVersion: string;
  evaluatorRef: string;
  reasoningEffort: "high";
  serviceTier: "default";
  roles: Record<RoutingRole, RoleIdentity>;
}

export interface PendingRoutingDecision {
  state: "pending";
  ruleId: string;
  reason: string;
  updateRequired: boolean;
}

export interface RejectedRoutingDecision {
  state: "rejected";
  ruleId: string;
  reason: string;
}

export type RoutingDecision =
  ResolvedRoutingDecision | PendingRoutingDecision | RejectedRoutingDecision;

export interface RoutingExecutionProposal {
  model: string;
  reasoningEffort: string;
  serviceTier: string;
}

export interface RoutingGuardResult {
  allowed: boolean;
  ruleId?: string;
  reason?: string;
}

function pending(ruleId: string, reason: string): PendingRoutingDecision {
  return { state: "pending", ruleId, reason, updateRequired: true };
}

function rejected(ruleId: string, reason: string): RejectedRoutingDecision {
  return { state: "rejected", ruleId, reason };
}

function roleIdentities(
  input: RoutingResolutionInput,
  choices: ModelMappingChoice,
): Record<RoutingRole, RoleIdentity> {
  return {
    coordinator: {
      identity: input.coordinatorIdentity,
      provider: choices.roles.coordinator.provider,
    },
    implementer: {
      identity: input.implementerIdentity,
      provider: choices.roles.implementer.provider,
    },
    reviewer: {
      identity: input.reviewerIdentity,
      provider: choices.roles.reviewer.provider,
    },
  };
}

export function resolveRouting(input: RoutingResolutionInput): RoutingDecision {
  const choices = input.modelMapping;
  if (choices === undefined)
    return pending("FR-836-05", "project choiceのmodelMappingが未設定です");
  if (input.evaluatorRef.trim() === "")
    return pending("FR-836-12", "evaluatorRefを確定できません");
  if (
    input.scope.trim() === "" ||
    input.coordinatorIdentity.trim() === "" ||
    input.implementerIdentity.trim() === "" ||
    input.reviewerIdentity.trim() === "" ||
    input.implementerIdentity === input.reviewerIdentity
  )
    return rejected(
      "FR-836-11",
      "scopeとrole identityを既知の独立した値へ解決できません",
    );
  const implementer = choices.roles.implementer;
  if (
    implementer.logicalTier !== "highest_available" ||
    implementer.reasoningEffort !== "high" ||
    implementer.speed !== "standard"
  )
    return rejected("FR-836-05", "implementerのrouting選択値が許可集合外です");
  if (
    input.availability.state !== "available" ||
    input.availability.provider !== implementer.provider
  )
    return pending(
      "FR-836-02",
      "provider availabilityをavailableと確認できません",
    );
  const provider = input.mapping.providers.find(
    (candidate) => candidate.provider === implementer.provider,
  );
  if (provider === undefined)
    return pending(
      "FR-836-10",
      "provider capability mappingに対応providerがありません",
    );
  if (!provider.capabilities.includes(input.requiredCapability))
    return pending(
      "FR-836-04",
      "providerが要求されたcoding能力を宣言していません",
    );
  if (provider.selectionSource !== "provider_recommended_default")
    return pending("FR-836-10", "model選択元をtrusted mappingで解決できません");
  const available = new Set(input.availability.models);
  if (available.size === 0)
    return pending("FR-836-02", "利用可能model一覧が空です");
  const recommended = input.availability.modelMetadata.filter(
    (model) => model.recommended && available.has(model.model),
  );
  if (recommended.length === 0)
    return pending(
      "FR-836-02",
      "provider公式recommended defaultを一意に観測できません",
    );
  if (recommended.length !== 1)
    return pending(
      "BR-836-09",
      "provider公式recommended defaultが複数あるため推測できません",
    );
  const selected = recommended[0]!;
  if (!selected.supportedReasoningEfforts.includes("high"))
    return pending(
      "FR-836-05",
      "provider公式recommended defaultがreasoning effort highに対応しません",
    );
  return {
    state: "resolved",
    scope: input.scope,
    provider: implementer.provider,
    model: selected.model,
    mappingVersion: input.mapping.mappingVersion,
    evaluatorRef: input.evaluatorRef,
    reasoningEffort: "high",
    serviceTier: "default",
    roles: roleIdentities(input, choices),
  };
}

export function rejectRoutingDowngrade(
  expected: ResolvedRoutingDecision,
  proposed: RoutingExecutionProposal,
): RoutingGuardResult {
  if (
    proposed.model !== expected.model ||
    proposed.reasoningEffort !== expected.reasoningEffort ||
    proposed.serviceTier !== expected.serviceTier
  )
    return {
      allowed: false,
      ruleId: "BR-836-02",
      reason: "解決済みrouting条件の無告知変更を拒否しました",
    };
  return { allowed: true };
}

export function revalidateRouting(
  expected: ResolvedRoutingDecision,
  input: RoutingResolutionInput,
): RoutingGuardResult {
  const actual = resolveRouting(input);
  if (
    actual.state !== "resolved" ||
    actual.scope !== expected.scope ||
    actual.provider !== expected.provider ||
    actual.model !== expected.model ||
    actual.mappingVersion !== expected.mappingVersion ||
    actual.evaluatorRef !== expected.evaluatorRef ||
    actual.reasoningEffort !== expected.reasoningEffort ||
    actual.serviceTier !== expected.serviceTier ||
    actual.roles.coordinator.identity !== expected.roles.coordinator.identity ||
    actual.roles.implementer.identity !== expected.roles.implementer.identity ||
    actual.roles.reviewer.identity !== expected.roles.reviewer.identity
  )
    return {
      allowed: false,
      ruleId: "FR-836-06",
      reason: "実行直前のrouting再検証で解決結果が変化しました",
    };
  return { allowed: true };
}

function isProductPath(relative: string): boolean {
  const normalized = relative.replaceAll("\\", "/");
  return (
    normalized.startsWith("src/") ||
    normalized.startsWith("test/") ||
    normalized.startsWith("docs/specs/")
  );
}

export function authorizeImplementation(input: {
  decision: RoutingDecision;
  actorIdentity: string;
  changedPaths: string[];
}): RoutingGuardResult {
  if (input.decision.state !== "resolved")
    return {
      allowed: false,
      ruleId: input.decision.ruleId,
      reason: input.decision.reason,
    };
  if (input.changedPaths.some(isProductPath)) {
    if (input.actorIdentity === input.decision.roles.coordinator.identity)
      return {
        allowed: false,
        ruleId: "BR-836-01",
        reason: "coordinatorはCodex利用可能scopeのproduct実装を担当できません",
      };
    if (input.actorIdentity !== input.decision.roles.implementer.identity)
      return {
        allowed: false,
        ruleId: "BR-836-01",
        reason: "product実装は解決済みimplementer identityだけが担当できます",
      };
  }
  return { allowed: true };
}
