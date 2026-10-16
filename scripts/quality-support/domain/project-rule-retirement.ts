import crypto from "node:crypto";
import { isRecord, type ProjectRuleRetirementProposal } from "../types.js";

export interface RuleFragmentSource {
  ruleId: string;
  fragmentPath: string;
  raw: string;
}

export interface AcceptedRuleRetirement {
  ruleId: string;
  fragmentPath: string;
  proposedSha256: string;
  observedSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const RULE_ID = /^ASC-[A-Z0-9-]+$/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

export function isProjectRuleRetirementProposal(
  value: unknown,
): value is ProjectRuleRetirementProposal {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) =>
      ["ruleId", "beforeSha256", "reason", "owner"].includes(key),
    ) &&
    typeof value.ruleId === "string" &&
    RULE_ID.test(value.ruleId) &&
    typeof value.beforeSha256 === "string" &&
    SHA256.test(value.beforeSha256) &&
    [value.reason, value.owner].every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        !CONTROL.test(item),
    )
  );
}

/** schemaと同じ集合契約をruntime入力とmatcherの両方で検証する。 */
export function validRuleRetirementProposals(
  value: unknown,
): value is ProjectRuleRetirementProposal[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    !value.every(isProjectRuleRetirementProposal)
  )
    return false;
  const keys = value.map((item) =>
    JSON.stringify([item.ruleId, item.beforeSha256, item.reason, item.owner]),
  );
  return new Set(keys).size === keys.length;
}

/** 削除として検知済みのruleだけを照合する。candidateの提案は入力に取らない。 */
export function acceptApprovedRuleRetirements(input: {
  deletedRuleIds: string[];
  trustedProposals: unknown;
  trustedRuleSources?: readonly RuleFragmentSource[];
}): {
  accepted: AcceptedRuleRetirement[];
  remaining: Array<{ ruleId: string; reason: string }>;
} {
  const accepted: AcceptedRuleRetirement[] = [];
  const remaining: Array<{ ruleId: string; reason: string }> = [];
  const proposals = validRuleRetirementProposals(input.trustedProposals)
    ? input.trustedProposals
    : [];
  const declaredSources: readonly RuleFragmentSource[] = Array.isArray(
    input.trustedRuleSources,
  )
    ? (input.trustedRuleSources as readonly RuleFragmentSource[])
    : [];
  for (const ruleId of input.deletedRuleIds) {
    const sources = declaredSources.filter(
      (source) => source?.ruleId === ruleId,
    );
    const source = sources.length === 1 ? sources[0] : undefined;
    const sourceValid =
      source &&
      typeof source.raw === "string" &&
      typeof source.fragmentPath === "string" &&
      /^project\/rules\/[a-z0-9][a-z0-9.-]*\.json$/u.test(source.fragmentPath);
    const observedSha256 = sourceValid
      ? crypto.createHash("sha256").update(source.raw, "utf8").digest("hex")
      : undefined;
    const matching = proposals.filter((proposal) => proposal.ruleId === ruleId);
    const proposal = matching.find(
      (item) => item.beforeSha256 === observedSha256,
    );
    if (sourceValid && proposal && observedSha256) {
      accepted.push({
        ruleId,
        fragmentPath: source.fragmentPath,
        proposedSha256: proposal.beforeSha256,
        observedSha256,
      });
    } else {
      const observation = sourceValid
        ? `fragment=${source.fragmentPath}、observedSha256=${observedSha256}`
        : "trusted rule source欠落または対応不明";
      const proposed =
        matching.map((item) => item.beforeSha256).join(",") ||
        "登録済み提案なしまたは型不正";
      remaining.push({
        ruleId,
        reason: `trusted ruleを削除している（ruleId=${ruleId}、${observation}、proposedSha256=${proposed}）`,
      });
    }
  }
  return { accepted, remaining };
}
