import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import { enforceTrustedBoundary } from "./enforcement.js";
import { type Policy, type RuleObservation } from "../types.js";

interface FinalizeState {
  repository?: string;
  worktree?: string;
  branch?: string;
  base?: string;
  headSha?: string;
  baseSha?: string;
  dirty?: boolean;
  untracked?: string[];
  stashes?: string[];
  temporaryArtifacts?: string[];
  ignoredArtifacts?: string[];
  pushed?: boolean;
  remoteBranch?: boolean;
  prMerged?: boolean | "unknown";
  specConsistent?: boolean | "unknown";
  testsPassed?: boolean | "unknown";
  reviewApproved?: boolean | "unknown";
  recoveryReachable?: boolean;
  recoveryRef?: string;
  [key: string]: unknown;
}

/** @param {unknown} state */
export function buildFinalizeReport(state: FinalizeState) {
  const reasons: string[] = [];
  if (
    !state.repository ||
    !state.worktree ||
    !state.branch ||
    !state.base ||
    !state.headSha ||
    !state.baseSha
  )
    reasons.push("同一性が不明です");
  if (state.dirty !== false)
    reasons.push("worktreeに変更があるか状態が不明です");
  if (!Array.isArray(state.untracked) || state.untracked.length > 0)
    reasons.push("未追跡ファイルがあるか状態が不明です");
  if (!Array.isArray(state.stashes) || state.stashes.length > 0)
    reasons.push("stashがあるか状態が不明です");
  if (
    !Array.isArray(state.temporaryArtifacts) ||
    state.temporaryArtifacts.length > 0
  )
    reasons.push("一時資産があるか状態が不明です");
  if (
    !Array.isArray(state.ignoredArtifacts) ||
    state.ignoredArtifacts.length > 0
  )
    reasons.push("無視対象資産があるか状態が不明です");
  const requiredTruth: Array<[keyof FinalizeState, string]> = [
    ["pushed", "コミットがpushされていません"],
    ["remoteBranch", "リモートブランチがありません"],
    ["prMerged", "PRがマージされていません"],
    ["specConsistent", "仕様整合性が証明されていません"],
    ["testsPassed", "テスト合格が証明されていません"],
    ["reviewApproved", "レビューが承認されていません"],
    ["recoveryReachable", "復旧参照を利用できません"],
  ];
  for (const [field, label] of requiredTruth)
    if (state[field] !== true) reasons.push(label);
  if (!state.recoveryRef) reasons.push("復旧参照がありません");
  const snapshot = structuredClone(state);
  const hash = crypto
    .createHash("sha256")
    .update(stableJson(snapshot))
    .digest("hex");
  return { version: 1, safe: reasons.length === 0, reasons, snapshot, hash };
}

/** @param {{report: unknown, approvedHash: string, currentState: unknown, trustedPolicy: unknown}} input @param {(operation: string, payload: unknown) => void} destructive */
export function applyFinalize(
  input: {
    report: ReturnType<typeof buildFinalizeReport>;
    approvedHash: string;
    currentState: FinalizeState;
    trustedPolicy?: Policy;
  },
  destructive: (
    operation: string,
    payload: { path: unknown; branch: unknown },
  ) => void,
) {
  if (!input.trustedPolicy)
    throw new Error("finalize applyにはtrusted policyが必要です");
  const observations: RuleObservation[] = input.trustedPolicy.rules
    .filter(
      (rule) =>
        rule.scope.includes("worktree") &&
        ["identity", "path"].includes(rule.riskClass),
    )
    .map((rule) => ({
      ruleId: rule.ruleId,
      violated: !input.report.safe,
      reasons: input.report.reasons,
      checks: [
        "actual finalize reportのrepository、path、SHA、review、test、recovery状態を導出した",
      ],
    }));
  const boundary = enforceTrustedBoundary({
    policy: input.trustedPolicy,
    boundary: "worktree",
    observations,
  });
  if (!boundary.allowed)
    throw new Error(
      `${boundary.diagnostic?.ruleId ?? "ASC-FINALIZE"}: ${boundary.diagnostic?.reasons.join("; ") ?? "boundary違反"}`,
    );
  if (!input.report.safe)
    throw new Error(
      `安全でないため完了処理を拒否しました: ${input.report.reasons.join("; ")}`,
    );
  if (
    !/^[a-f0-9]{64}$/.test(input.approvedHash) ||
    input.approvedHash !== input.report.hash
  )
    throw new Error("明示承認が報告ハッシュと一致しません");
  const current = buildFinalizeReport(input.currentState);
  if (!current.safe || current.hash !== input.report.hash)
    throw new Error("事前確認後に状態が変化しました（TOCTOU）");
  destructive("worktree.remove", {
    path: current.snapshot.worktree,
    branch: current.snapshot.branch,
  });
  return {
    state: "finalized",
    worktree: current.snapshot.worktree,
    branchPreserved: true,
  };
}
