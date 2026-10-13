import { isSecuritySensitivePath } from "./impact-set.js";

/** Candidate work is advisory until the existing formal workflow accepts its evidence. */
export const CANDIDATE_RISKS = [
  "authentication",
  "authorization",
  "secrets",
  "personal-data",
  "destructive-data",
  "data-integrity",
  "migration",
  "async-concurrency",
  "state-transition",
  "production-impact",
  "legal-financial",
  "trust-boundary",
  "external-api",
  "irreversible-action",
] as const;
export type CandidateRisk = (typeof CANDIDATE_RISKS)[number];
export type CandidateRiskStatus = "cleared" | "triggered" | "unknown";
export type CandidateGap =
  | "implementation"
  | "verification"
  | "design"
  | "requirement"
  | "intent"
  | "security-risk";
export interface CandidatePreflightInput {
  intent: string;
  correctnessCriterion: string;
  baseSha: string;
  isolatedWorktree: boolean;
  allowedPaths: readonly string[];
  risk: Partial<Record<CandidateRisk, CandidateRiskStatus>>;
  unresolved: readonly string[];
}
export interface CandidateDecision {
  kind: "asc-candidate-decision/v1";
  authority: "none";
  route: "candidate" | "clarify" | "upstream" | "repair" | "independent-review";
  reasons: string[];
  responsibility?: CandidateGap | "independent-review";
  pendingResponsibilities?: CandidateGap[];
}
const SHA = /^[0-9a-f]{40}$/;
/** No aggregate score can offset a single material risk or missing criterion. */
export function decideCandidatePreflight(
  input: CandidatePreflightInput,
): CandidateDecision {
  const reasons: string[] = [];
  if (!input.intent.trim()) reasons.push("一次Intentが空です");
  if (!input.correctnessCriterion.trim())
    reasons.push("正しさの基準が未確定です");
  if (!SHA.test(input.baseSha)) reasons.push("Git base HEADが不正です");
  if (!input.isolatedWorktree) reasons.push("隔離worktreeが必要です");
  const sensitivePaths = input.allowedPaths.filter(isSecuritySensitivePath);
  const triggered: CandidateRisk[] = [];
  for (const key of CANDIDATE_RISKS) {
    const status = input.risk[key] ?? "unknown";
    if (status === "triggered") triggered.push(key);
    if (status === "unknown") reasons.push(`未確認リスク: ${key}`);
  }
  reasons.push(...input.unresolved.map((value) => `未解決事項: ${value}`));
  if (sensitivePaths.length > 0)
    reasons.push(`事前の上流検討が必要なpath: ${sensitivePaths.join(", ")}`);
  if (triggered.length > 0)
    reasons.push(`事前の上流検討が必要: ${triggered.join(", ")}`);
  return {
    kind: "asc-candidate-decision/v1",
    authority: "none",
    route:
      triggered.length > 0 || sensitivePaths.length > 0
        ? "upstream"
        : reasons.length > 0
          ? "clarify"
          : "candidate",
    reasons,
  };
}
export interface CandidatePostInput {
  observedPaths: readonly string[];
  allowedPaths: readonly string[];
  targetTestsPassed: boolean;
  gaps: readonly CandidateGap[];
}
/** Actual Git paths are provided by the adapter, never by the implementing worker. */
export function decideCandidatePost(
  input: CandidatePostInput,
): CandidateDecision {
  const changed = new Set(input.observedPaths);
  const unexpected = [...changed].filter(
    (item) => !input.allowedPaths.includes(item),
  );
  const pending = new Set<CandidateGap>(input.gaps);
  if ([...changed].some(isSecuritySensitivePath)) pending.add("security-risk");
  if (unexpected.length > 0 && !unexpected.some(isSecuritySensitivePath))
    pending.add("design");
  if (!input.targetTestsPassed) pending.add("verification");
  if (changed.size === 0) pending.add("implementation");
  const priority: readonly CandidateGap[] = [
    "security-risk",
    "intent",
    "requirement",
    "design",
    "verification",
    "implementation",
  ];
  const pendingResponsibilities = priority.filter((item) => pending.has(item));
  if (pendingResponsibilities.length > 0) {
    const reasons = [
      ...(unexpected.length > 0
        ? [`想定外のGit差分: ${unexpected.join(", ")}`]
        : []),
      ...([...changed].some(isSecuritySensitivePath)
        ? ["セキュリティ上の注意を要するGit差分を上流で確認する"]
        : []),
      ...input.gaps.map((gap) => `候補実装後の不足責務: ${gap}`),
      ...(!input.targetTestsPassed ? ["対象テストが失敗しました"] : []),
      ...(changed.size === 0 ? ["候補実装の差分がありません"] : []),
    ];
    const responsibility = pendingResponsibilities[0];
    return {
      kind: "asc-candidate-decision/v1",
      authority: "none",
      route: pendingResponsibilities.some((gap) =>
        ["security-risk", "intent", "requirement", "design"].includes(gap),
      )
        ? "upstream"
        : "repair",
      reasons,
      responsibility,
      pendingResponsibilities,
    };
  }
  return {
    kind: "asc-candidate-decision/v1",
    authority: "none",
    route: "independent-review",
    reasons: [],
    responsibility: "independent-review",
  };
}
