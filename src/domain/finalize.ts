import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import { enforceTrustedBoundary } from "./enforcement.js";
import { isRecord, type Policy, type RuleObservation } from "../types.js";

export interface RootUpdateObservation {
  rootPath: string;
  currentBranch: string;
  defaultBranch: string;
  dirty: boolean;
  untracked: string[];
  upstreamRef: string | undefined;
  localSha: string;
  upstreamSha: string;
  remoteSha: string;
  mergeSha: string;
  fastForwardable: boolean;
}

export function planRootUpdate(input: unknown): {
  state: "ready" | "rejected";
  from: string;
  to: string;
  reasons: string[];
  recovery: string[];
} {
  const value = isRecord(input) ? input : {};
  const stringValue = (key: keyof RootUpdateObservation): string =>
    typeof value[key] === "string" ? value[key] : "";
  const rootPath = stringValue("rootPath");
  const currentBranch = stringValue("currentBranch");
  const defaultBranch = stringValue("defaultBranch");
  const upstreamRef = stringValue("upstreamRef");
  const localSha = stringValue("localSha");
  const upstreamSha = stringValue("upstreamSha");
  const remoteSha = stringValue("remoteSha");
  const mergeSha = stringValue("mergeSha");
  const reasons: string[] = [];
  const recovery: string[] = [];
  const reject = (reason: string, next: string): void => {
    reasons.push(reason);
    if (!recovery.includes(next)) recovery.push(next);
  };

  if (rootPath.trim() === "")
    reject(
      "root worktreeのパスが空です",
      "対象repositoryのroot worktreeパスを指定して再実行する",
    );
  if (
    currentBranch.trim() === "" ||
    defaultBranch.trim() === "" ||
    currentBranch !== defaultBranch
  )
    reject(
      "root worktreeが検証済みの既定branchではありません",
      "root worktreeを既定branchへ戻し、branch名を確認してから再実行する",
    );
  const untracked = value.untracked;
  if (
    value.dirty !== false ||
    !Array.isArray(untracked) ||
    untracked.some((item) => typeof item !== "string") ||
    untracked.length > 0
  )
    reject(
      "root worktreeに変更または未追跡ファイルがあります",
      "変更をcommitまたはstashしてから再実行する",
    );
  if (upstreamRef.trim() === "")
    reject(
      "root worktreeのupstreamが不明です",
      "既定branchのupstreamを確認して設定してから再実行する",
    );
  if (
    upstreamSha.trim() === "" ||
    remoteSha.trim() === "" ||
    upstreamSha !== remoteSha
  )
    reject(
      "upstream SHAとremote SHAが一致しません",
      "originの既定branchをfetchし、remote同一性を再確認してから再実行する",
    );
  if (!/^[a-f0-9]{40}$/iu.test(mergeSha) || remoteSha !== mergeSha)
    reject(
      "検証済みmerge SHAが40桁Git SHAでないかremote SHAと一致しません",
      "PRのmerge結果をread-after-writeで再確認し、完全なmerge SHAで再実行する",
    );
  const alreadyUpdated =
    /^[a-f0-9]{40}$/iu.test(mergeSha) && localSha === mergeSha;
  if (!alreadyUpdated && value.fastForwardable !== true)
    reject(
      "root worktreeをmerge SHAへfast-forwardできません",
      "local mainの分岐を調査し、利用者の判断で復旧してから再実行する",
    );

  return {
    state: reasons.length === 0 ? "ready" : "rejected",
    from: localSha,
    to: mergeSha,
    reasons,
    recovery,
  };
}

export function planWorktreeCleanup(input: {
  target: { path: string; branch: string };
  registered: Array<{ path: string; branch: string }>;
  prMerged: boolean;
  clean: boolean;
  pushed: boolean;
  recoveryReachable: boolean;
  consumerAssets: string[];
}): {
  state: "ready" | "rejected";
  target: string;
  reasons: string[];
} {
  const reasons: string[] = [];
  const exact = input.registered.filter(
    (worktree) =>
      worktree.path === input.target.path &&
      worktree.branch === input.target.branch,
  );
  if (exact.length !== 1)
    reasons.push(
      "対象PR専用worktreeのpathとbranchに完全一致する登録が1件ではありません",
    );
  if (!input.prMerged) reasons.push("対象PRがマージ済みではありません");
  if (!input.clean) reasons.push("対象worktreeがcleanではありません");
  if (!input.pushed) reasons.push("対象branchがpush済みではありません");
  if (!input.recoveryReachable)
    reasons.push("対象worktreeの復旧参照を確認できません");
  if (input.consumerAssets.length > 0)
    reasons.push("対象worktreeに利用者所有資産があります");
  return {
    state: reasons.length === 0 ? "ready" : "rejected",
    target: input.target.path,
    reasons,
  };
}

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
