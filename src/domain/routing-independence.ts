const CONTROL = /[\p{Cc}\p{Cf}]/u;

export const ROUTING_TRUSTED_DATA_PATHS = [
  ".agent-skill-chain/project/providers/capability-mapping.json",
  ".agent-skill-chain/project/choices/development.json",
  ".agent-skill-chain/project/conformance/bindings.json",
] as const;

export const ROUTING_EVALUATOR_PATHS = [
  "src/domain/routing.ts",
  "src/domain/routing-independence.ts",
] as const;

export interface RoutingIndependenceInput {
  implementerIdentity: string;
  reviewerIdentity: string;
  candidatePaths: readonly string[];
  trustedRef: string;
  candidateHead: string;
  evaluatorRef: string;
}

export interface RoutingIndependenceResult {
  verdict: "independent" | "violated" | "pending";
  evaluatorRef: string;
  trustedRef: string;
  trustedDataPaths: readonly string[];
  ruleId?: string;
  reason?: string;
}

function validIdentity(identity: string): boolean {
  return (
    identity.trim().length > 0 &&
    identity === identity.normalize("NFC") &&
    !CONTROL.test(identity)
  );
}

function safeCandidatePath(relative: string): boolean {
  return (
    relative.length > 0 &&
    relative === relative.normalize("NFC") &&
    !relative.startsWith("/") &&
    !relative.includes("\\") &&
    !CONTROL.test(relative) &&
    relative.split("/").every((part) => part !== "" && part !== "..")
  );
}

function result(
  input: RoutingIndependenceInput,
  verdict: RoutingIndependenceResult["verdict"],
  ruleId?: string,
  reason?: string,
): RoutingIndependenceResult {
  return {
    verdict,
    evaluatorRef: input.evaluatorRef,
    trustedRef: input.trustedRef,
    trustedDataPaths: [...ROUTING_TRUSTED_DATA_PATHS],
    ...(ruleId === undefined ? {} : { ruleId }),
    ...(reason === undefined ? {} : { reason }),
  };
}

export function checkRoutingIndependence(
  input: RoutingIndependenceInput,
): RoutingIndependenceResult {
  if (
    !validIdentity(input.implementerIdentity) ||
    !validIdentity(input.reviewerIdentity) ||
    input.implementerIdentity === input.reviewerIdentity
  )
    return result(
      input,
      "violated",
      "FR-836-11",
      "implementerとreviewerは既知の別identityでなければなりません",
    );
  if (
    input.trustedRef.trim() === "" ||
    input.candidateHead.trim() === "" ||
    input.evaluatorRef.trim() === "" ||
    input.candidatePaths.some((relative) => !safeCandidatePath(relative))
  )
    return result(
      input,
      "pending",
      "FR-836-12",
      "trusted ref、candidate head、evaluatorRef、candidate pathを安全に確定できません",
    );

  const changed = new Set(input.candidatePaths);
  const trustedDataChanged = ROUTING_TRUSTED_DATA_PATHS.some((relative) =>
    changed.has(relative),
  );
  const evaluatorChanged = ROUTING_EVALUATOR_PATHS.some((relative) =>
    changed.has(relative),
  );

  if (trustedDataChanged && input.trustedRef === input.candidateHead)
    return result(
      input,
      "pending",
      "FR-836-12",
      "candidate headのデータ資産はtrusted入力として使用できません",
    );
  if (
    evaluatorChanged &&
    (input.evaluatorRef === input.candidateHead ||
      input.evaluatorRef !== input.trustedRef)
  )
    return result(
      input,
      "pending",
      "FR-836-12",
      "candidateが変更した評価器のcandidate head出力は自己評価に使用できません",
    );

  return result(input, "independent");
}
