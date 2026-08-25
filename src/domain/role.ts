export const ROLES = [
  "coordinator",
  "analyst",
  "implementer",
  "reviewer",
  "verifier",
  "finalizer",
] as const;

export type Role = (typeof ROLES)[number];

export interface RoleContract {
  role: Role;
  allowedPaths: string[];
  allowedOperations: string[];
  forbiddenOperations: string[];
  requiredEvidence: string[];
}

const contract = (
  role: Role,
  allowedPaths: string[],
  allowedOperations: string[],
  forbiddenOperations: string[],
  requiredEvidence: string[],
): RoleContract => ({
  role,
  allowedPaths,
  allowedOperations,
  forbiddenOperations,
  requiredEvidence,
});

export const DEFAULT_ROLE_CONTRACTS: Readonly<Record<Role, RoleContract>> = {
  coordinator: contract(
    "coordinator",
    [".agent-skill-chain/tmp/", ".agent-skill-chain/role-log/"],
    [
      "decompose_issue",
      "assign_role",
      "transition_state",
      "aggregate_evidence",
    ],
    ["implement_product", "self_approve", "merge_arbitration"],
    ["assignment_record", "state_record"],
  ),
  analyst: contract(
    "analyst",
    ["docs/specs/", ".agent-skill-chain/tmp/"],
    ["define_requirements", "design", "define_acceptance", "author_gherkin"],
    ["final_approval_of_own_scope"],
    ["requirements_trace"],
  ),
  implementer: contract(
    "implementer",
    ["src/", "test/", "docs/specs/", ".agent-skill-chain/"],
    ["confirm_failing_test", "implement_product", "refactor_local", "run_test"],
    ["final_review", "merge_arbitration"],
    ["failing_test", "test_result"],
  ),
  reviewer: contract(
    "reviewer",
    [".agent-skill-chain/role-log/", ".agent-skill-chain/tmp/"],
    ["affirmative_review", "adversarial_review", "classify_finding"],
    ["modify_target_diff", "hide_finding"],
    [
      "affirmative_review",
      "adversarial_review",
      "finding_classification",
      "independence",
    ],
  ),
  verifier: contract(
    "verifier",
    [".agent-skill-chain/role-log/", ".agent-skill-chain/tmp/"],
    [
      "run_independent_test",
      "verify_artifact",
      "verify_spec",
      "verify_remote_sha",
    ],
    ["implement_product", "approve_unverified"],
    ["independent_test", "artifact_verification", "spec_consistency"],
  ),
  finalizer: contract(
    "finalizer",
    [".agent-skill-chain/role-log/", ".agent-skill-chain/tmp/"],
    ["open_pr", "verify_merge", "update_main", "safe_cleanup", "close_issue"],
    ["change_requirements", "implement_product", "alter_review_result"],
    ["pr_evidence", "merge_verification", "cleanup_report"],
  ),
};

function isRole(value: string): value is Role {
  return ROLES.some((role) => role === value);
}

function effectiveContracts(
  overrides?: Record<string, RoleContract>,
): Readonly<Record<Role, RoleContract>> {
  if (!overrides) return DEFAULT_ROLE_CONTRACTS;
  return Object.fromEntries(
    ROLES.map((role) => [
      role,
      overrides[role] ?? DEFAULT_ROLE_CONTRACTS[role],
    ]),
  ) as unknown as Readonly<Record<Role, RoleContract>>;
}

export function validateRoleAssignment(input: {
  scope: string;
  assignments: Array<{ role: string; identity: string; context: string }>;
  contracts?: Record<string, RoleContract>;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  const contracts = effectiveContracts(input.contracts);
  for (const assignment of input.assignments) {
    if (!isRole(assignment.role) || !contracts[assignment.role]) {
      errors.push(`未知のroleです: ${assignment.role}`);
      continue;
    }
    if (seen.has(assignment.role))
      errors.push(`同一scopeでroleを重複割当できません: ${assignment.role}`);
    seen.add(assignment.role);
    if (assignment.identity.trim() === "")
      errors.push(`${assignment.role}のidentityが不明です`);
    if (assignment.context.trim() === "")
      errors.push(`${assignment.role}のcontextが不明です`);
  }
  if (!seen.has("coordinator")) errors.push("coordinatorの割当が必要です");
  const implementer = input.assignments.find(
    (assignment) => assignment.role === "implementer",
  );
  const reviewer = input.assignments.find(
    (assignment) => assignment.role === "reviewer",
  );
  if (implementer && reviewer) {
    if (implementer.identity === reviewer.identity)
      errors.push(
        `scope ${input.scope} のimplementerとreviewerは異なるidentityでなければなりません`,
      );
    if (implementer.context === reviewer.context)
      errors.push(
        `scope ${input.scope} のimplementerとreviewerは異なるcontextでなければなりません`,
      );
  }
  return { valid: errors.length === 0, errors };
}

function pathAllowed(candidate: string, prefixes: string[]): boolean {
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  )
    return false;
  return prefixes.some((prefix) => {
    const normalizedPrefix = prefix.replaceAll("\\", "/").replace(/^\.\//u, "");
    const directoryPrefix = normalizedPrefix.endsWith("/")
      ? normalizedPrefix
      : `${normalizedPrefix}/`;
    return (
      normalized === normalizedPrefix.replace(/\/$/u, "") ||
      normalized.startsWith(directoryPrefix)
    );
  });
}

export function validateRoleOperation(input: {
  role: string;
  operation: string;
  paths: string[];
  evidence: string[];
  contracts?: Record<string, RoleContract>;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRole(input.role))
    return { valid: false, errors: [`未知のroleです: ${input.role}`] };
  const roleContract = effectiveContracts(input.contracts)[input.role];
  if (roleContract.role !== input.role)
    errors.push(
      `role contractのkey ${input.role}と宣言role ${roleContract.role}が一致しません`,
    );
  if (roleContract.forbiddenOperations.includes(input.operation))
    errors.push(`${input.role}には${input.operation}が禁止されています`);
  else if (!roleContract.allowedOperations.includes(input.operation))
    errors.push(`${input.role}には${input.operation}が許可されていません`);
  for (const candidate of input.paths)
    if (!pathAllowed(candidate, roleContract.allowedPaths))
      errors.push(`${input.role}の許可path外です: ${candidate}`);
  for (const required of roleContract.requiredEvidence)
    if (!input.evidence.includes(required))
      errors.push(`${input.role}の必要証拠が不足しています: ${required}`);
  return { valid: errors.length === 0, errors };
}

export const MODEL_TIERS = [
  "routine",
  "standard",
  "advanced",
  "critical",
] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

const TIER_STRENGTH: Readonly<Record<ModelTier, number>> = {
  routine: 1,
  standard: 2,
  advanced: 3,
  critical: 4,
};

export function requiredTier(input: {
  risk: string;
  mode: string;
  scope: string;
  findingSeverity?: string;
}): ModelTier {
  const risk = input.risk.normalize("NFC").toLowerCase();
  const mode = input.mode.normalize("NFC").toLowerCase();
  const scope = input.scope.normalize("NFC").toLowerCase();
  const severity = input.findingSeverity?.normalize("NFC").toLowerCase() ?? "";
  if (
    ["secret", "authority", "irreversible", "identity", "artifact"].some(
      (value) => risk === value || risk.split(/[,\s]+/u).includes(value),
    ) ||
    severity === "critical" ||
    (mode === "full" &&
      /(?:delete|deletion|削除|merge|マージ|release|リリース)/u.test(scope))
  )
    return "critical";
  if (
    /(?:architecture|アーキテクチャ|security|セキュリティ|adversarial|敵対|multi[-_ ]?domain|複数domain)/u.test(
      `${risk} ${scope}`,
    ) ||
    severity === "high"
  )
    return "advanced";
  if (/(?:format|整形|read[-_ ]?only|読み取り専用|列挙)/u.test(scope))
    return "routine";
  return "standard";
}

export function validateTierSelection(input: {
  required: ModelTier;
  selected: ModelTier;
  mapping: Record<string, ModelTier | undefined>;
  model: string;
  justification?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const mapped = input.mapping[input.model];
  if (mapped === undefined)
    errors.push(`model ${input.model} のtier mappingが未定義です`);
  else if (mapped !== input.selected)
    errors.push(
      `model ${input.model} のmapping ${mapped}と選択tier ${input.selected}が一致しません`,
    );
  if (TIER_STRENGTH[input.selected] < TIER_STRENGTH[input.required])
    errors.push(
      `必要tier ${input.required}より低い${input.selected}への降格を拒否しました`,
    );
  return { valid: errors.length === 0, errors };
}

// 能力tierは操作authorityを付与しない。authorityはenforceOperationと
// enforceTrustedBoundaryを含む既存の信頼境界で独立に検証する。

export interface HumanOverride {
  provider: string;
  selection: string;
  issue: number;
  scope: string;
  instructedBy: string;
  instructedAt: string;
  expiresAt: string;
}

export const PROVIDER_AUTONOMOUS_CEILINGS: Readonly<
  Record<string, { dimension: "reasoningEffort" | "model"; allowed: string[] }>
> = {
  codex: {
    dimension: "reasoningEffort",
    allowed: ["low", "medium", "high"],
  },
  claude: {
    dimension: "model",
    allowed: ["haiku", "sonnet", "opus"],
  },
};

const AI_ISSUERS = new Set([
  ...ROLES,
  "agent",
  "ai",
  "assistant",
  "codex",
  "claude",
]);

function validTimestamp(value: string): number | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function validateProviderSelection(input: {
  provider: string;
  selection: string;
  issue: number;
  scope: string;
  now: string;
  override?: HumanOverride;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const provider = input.provider.normalize("NFC").toLowerCase();
  const selection = input.selection.normalize("NFC").toLowerCase();
  const ceiling = Object.hasOwn(PROVIDER_AUTONOMOUS_CEILINGS, provider)
    ? PROVIDER_AUTONOMOUS_CEILINGS[provider]
    : undefined;
  if (!ceiling) {
    errors.push(`provider ${input.provider} の自律選択上限が未定義です`);
    return { valid: false, errors };
  }
  if (ceiling.allowed.includes(selection)) return { valid: true, errors };
  const overrideEligible =
    (provider === "codex" && ["xhigh", "max", "ultra"].includes(selection)) ||
    (provider === "claude" && selection === "fable");
  if (!overrideEligible) {
    errors.push(
      `${input.selection}はalias・自動routing・fallbackを含む未承認の選択値です`,
    );
    return { valid: false, errors };
  }
  const override = input.override;
  if (!override) {
    errors.push(
      `${input.provider}の${input.selection}は自律選択上限を超えるため人間overrideが必要です`,
    );
    return { valid: false, errors };
  }
  if (AI_ISSUERS.has(override.instructedBy.trim().toLowerCase()))
    errors.push("AI agentまたはroleによる自己発行overrideは使用できません");
  if (override.provider !== input.provider)
    errors.push("overrideのproviderが対象と一致しません");
  if (override.selection !== input.selection)
    errors.push("overrideのmodelまたは推論レベルが対象と一致しません");
  if (override.issue !== input.issue)
    errors.push("overrideのIssueが対象と一致しません");
  if (override.scope !== input.scope)
    errors.push("overrideのscopeが対象と完全一致しません");
  if (override.instructedBy.trim() === "")
    errors.push("overrideの指示者が不明です");
  const instructedAt = validTimestamp(override.instructedAt);
  const expiresAt = validTimestamp(override.expiresAt);
  const now = validTimestamp(input.now);
  if (instructedAt === undefined) errors.push("overrideの指示日時が不正です");
  if (expiresAt === undefined) errors.push("overrideの失効日時が不正です");
  if (now === undefined) errors.push("検証日時が不正です");
  if (instructedAt !== undefined && now !== undefined && instructedAt > now)
    errors.push("overrideの指示日時が未来です");
  if (expiresAt !== undefined && now !== undefined && expiresAt <= now)
    errors.push("overrideは失効しています");
  return { valid: errors.length === 0, errors };
}
