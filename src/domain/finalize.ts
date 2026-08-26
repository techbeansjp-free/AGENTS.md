import crypto from "node:crypto";
import path from "node:path";
import { stableJson } from "../lib/security.js";
import { enforceTrustedBoundary } from "./enforcement.js";
import { isRecord, type Policy, type RuleObservation } from "../types.js";
import {
  assessWorktreeRemovalSafety,
  resolveFinalizeIgnoredPathAllowlist,
} from "./worktree-removal-safety.js";

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

export interface WorktreeCleanupPlanInput {
  repositoryRoot?: string;
  target: { path: string; branch: string };
  registered: Array<{ path: string; branch: string }>;
  prMerged: boolean | undefined;
  clean: boolean | undefined;
  trackedChanges?: boolean | undefined;
  pushed: boolean | undefined;
  remoteBranch?: boolean | undefined;
  recoveryReachable: boolean | undefined;
  consumerAssets?: string[];
  untracked?: unknown;
  stashes?: unknown;
  temporaryArtifacts?: unknown;
  ignoredArtifacts?: unknown;
  ignoredPathAllowlist?: unknown;
  targetCanonicalPath?: string;
  targetAbsent?: boolean;
}

export function planWorktreeCleanup(input: WorktreeCleanupPlanInput): {
  state: "ready" | "rejected" | "already-absent";
  target: string;
  reasons: string[];
} {
  const reasons: string[] = [];
  const targetPath = input.target?.path;
  const targetBranch = input.target?.branch;
  const registeredValid = Array.isArray(input.registered);
  const registered = registeredValid ? input.registered : [];
  const targetPathValid =
    typeof targetPath === "string" && targetPath.trim() !== "";
  const targetValid =
    targetPathValid &&
    typeof targetBranch === "string" &&
    targetBranch.trim() !== "";
  if (!targetValid && input.targetAbsent !== true)
    reasons.push("対象PR専用worktreeのpathまたはbranchが不明です");
  if (!registeredValid) reasons.push("登録済みworktree一覧が不明です");
  if (
    input.targetAbsent !== undefined &&
    typeof input.targetAbsent !== "boolean"
  )
    reasons.push("対象worktreeの存在状態が不明です");
  if (input.clean !== undefined && typeof input.clean !== "boolean")
    reasons.push("未commitの追跡対象fileがあるか状態が不明です");
  if (
    typeof input.trackedChanges === "boolean" &&
    typeof input.clean === "boolean" &&
    input.trackedChanges !== !input.clean
  )
    reasons.push(
      `追跡対象fileの観測が矛盾しています: trackedChanges=${String(input.trackedChanges)}、clean=${String(input.clean)}`,
    );
  if (
    input.consumerAssets !== undefined &&
    !Array.isArray(input.consumerAssets)
  )
    reasons.push("未追跡fileの種別が不明です");
  if (
    Array.isArray(input.untracked) &&
    Array.isArray(input.consumerAssets) &&
    (input.untracked.length !== input.consumerAssets.length ||
      input.untracked.some(
        (entry, index) => entry !== input.consumerAssets?.[index],
      ))
  )
    reasons.push(
      `未追跡fileの観測が矛盾しています: untracked=${JSON.stringify(input.untracked)}、consumerAssets=${JSON.stringify(input.consumerAssets)}`,
    );
  const temporaryArtifacts = Array.isArray(input.temporaryArtifacts)
    ? input.temporaryArtifacts
    : [];
  if (!Array.isArray(input.temporaryArtifacts))
    reasons.push("一時資産があるか状態が不明です");
  const exact = registered.filter(
    (worktree) =>
      worktree.path === targetPath && worktree.branch === targetBranch,
  );
  if (typeof input.repositoryRoot === "string" && targetPathValid) {
    const relative = path.relative(
      path.resolve(input.repositoryRoot),
      path.resolve(targetPath),
    );
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      reasons.push("対象worktreeがrepository root内の専用pathではありません");
  }
  if (
    typeof input.targetCanonicalPath === "string" &&
    targetPathValid &&
    path.resolve(input.targetCanonicalPath) !== path.resolve(targetPath)
  )
    reasons.push("対象worktreeのpathにsymlink祖先または同一性の変化があります");
  if (input.targetAbsent === true) {
    if (!targetPathValid)
      reasons.push("既削除として確認する対象worktree pathが不明です");
    if (registered.some((worktree) => worktree.path === targetPath))
      reasons.push(
        "対象pathは別branchを含む登録済みworktreeとして残っています",
      );
    if (input.prMerged !== true)
      reasons.push("対象PRがマージ済みではないか観測が不明です");
    return {
      state: reasons.length === 0 ? "already-absent" : "rejected",
      target: typeof targetPath === "string" ? targetPath : "",
      reasons,
    };
  }
  if (exact.length !== 1)
    reasons.push(
      "対象PR専用worktreeのpathとbranchに完全一致する登録が1件ではありません",
    );
  const ignoredArtifacts = input.ignoredArtifacts;
  const untracked =
    input.untracked === undefined
      ? Array.isArray(input.consumerAssets)
        ? input.consumerAssets
        : undefined
      : input.untracked;
  const derivedUntracked =
    Array.isArray(untracked) && Array.isArray(ignoredArtifacts)
      ? (untracked as unknown[]).concat(
          (temporaryArtifacts as unknown[]).filter(
            (artifact) => !ignoredArtifacts.includes(artifact),
          ),
        )
      : untracked;
  const safety = assessWorktreeRemovalSafety({
    repositoryRoot: input.repositoryRoot,
    worktreePath:
      input.repositoryRoot === undefined || !targetPathValid
        ? undefined
        : targetPath,
    trackedChanges:
      input.trackedChanges === undefined
        ? typeof input.clean === "boolean"
          ? !input.clean
          : undefined
        : input.trackedChanges,
    untracked: derivedUntracked,
    ignoredArtifacts,
    ignoredPathAllowlist:
      input.ignoredPathAllowlist === undefined
        ? resolveFinalizeIgnoredPathAllowlist()
        : input.ignoredPathAllowlist,
    stashes: input.stashes,
    pushed: input.pushed,
    remoteBranch: input.remoteBranch,
    merged: input.prMerged,
    recoveryReachable: input.recoveryReachable,
  });
  reasons.push(...safety.reasons);
  return {
    state: reasons.length === 0 ? "ready" : "rejected",
    target: typeof targetPath === "string" ? targetPath : "",
    reasons,
  };
}

export type CompletionPhase =
  | "merge-confirm"
  | "root-update"
  | "cleanup-preview"
  | "cleanup-apply"
  | "post-verify";

export interface CompletionPhaseResult {
  phase: CompletionPhase;
  state: "succeeded" | "rejected" | "pending" | "skipped";
  reasons: string[];
  recovery: string[];
}

export interface CompletionPlanInput {
  mergeConfirmed: boolean;
  mergeSha: string;
  rootUpdate: ReturnType<typeof planRootUpdate>;
  cleanup: ReturnType<typeof planWorktreeCleanup>;
  cleanupAuthorityGranted: boolean;
  previewDigest: string;
  approvedDigest: string;
}

export interface CompletionOutcomeInput {
  phases: CompletionPhaseResult[];
  postVerify: {
    rootSha: string;
    expectedRootSha: string;
    targetPathAbsent: boolean;
    otherWorktreesUnchanged: boolean;
    containerState: "removed" | "retained" | "absent";
  };
}

const COMPLETION_PHASES: readonly CompletionPhase[] = [
  "merge-confirm",
  "root-update",
  "cleanup-preview",
  "cleanup-apply",
  "post-verify",
];

function completionPhase(
  phase: CompletionPhase,
  state: CompletionPhaseResult["state"],
  reasons: string[] = [],
  recovery: string[] = [],
): CompletionPhaseResult {
  return { phase, state, reasons, recovery };
}

function skippedCompletionPhases(
  phases: readonly CompletionPhase[],
  reason: string,
): CompletionPhaseResult[] {
  return phases.map((phase) => completionPhase(phase, "skipped", [reason]));
}

function validRootUpdatePlan(
  value: unknown,
): value is ReturnType<typeof planRootUpdate> {
  return (
    isRecord(value) &&
    (value.state === "ready" || value.state === "rejected") &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string") &&
    Array.isArray(value.recovery) &&
    value.recovery.every((recovery) => typeof recovery === "string") &&
    (value.state === "ready"
      ? value.reasons.length === 0
      : value.reasons.length > 0)
  );
}

function validCleanupPlan(
  value: unknown,
): value is ReturnType<typeof planWorktreeCleanup> {
  return (
    isRecord(value) &&
    ["ready", "rejected", "already-absent"].includes(
      typeof value.state === "string" ? value.state : "",
    ) &&
    typeof value.target === "string" &&
    value.target.trim() !== "" &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string") &&
    (value.state === "rejected"
      ? value.reasons.length > 0
      : value.reasons.length === 0)
  );
}

export function planCompletion(input: unknown): {
  state: "pending" | "rejected" | "ready";
  phases: CompletionPhaseResult[];
  requiredAuthority: string[];
} {
  const value = isRecord(input) ? input : {};
  const rootUpdate = validRootUpdatePlan(value.rootUpdate)
    ? value.rootUpdate
    : undefined;
  const cleanup = validCleanupPlan(value.cleanup) ? value.cleanup : undefined;
  const mergeSha = typeof value.mergeSha === "string" ? value.mergeSha : "";
  if (value.mergeConfirmed !== true || !/^[a-f0-9]{40}$/iu.test(mergeSha)) {
    const reason =
      value.mergeConfirmed !== true
        ? "対象PRのmerge確認が成立していません"
        : "検証済みmerge SHAが40桁Git SHAではありません";
    return {
      state: "rejected",
      phases: [
        completionPhase(
          "merge-confirm",
          "rejected",
          [reason],
          ["GitHubで対象PRのmerge状態と完全なmerge SHAを再確認する"],
        ),
        ...skippedCompletionPhases(
          COMPLETION_PHASES.slice(1),
          "merge確認が成立しないため実行しません",
        ),
      ],
      requiredAuthority: [],
    };
  }
  if (!rootUpdate) {
    const reason = "root更新計画の観測形式が不正または不明です";
    return {
      state: "rejected",
      phases: [
        completionPhase("merge-confirm", "succeeded"),
        completionPhase(
          "root-update",
          "rejected",
          [reason],
          ["root更新状態を再読取して完了previewを再実行する"],
        ),
        ...skippedCompletionPhases(
          COMPLETION_PHASES.slice(2),
          "root更新計画が成立しないためcleanupへ進みません",
        ),
      ],
      requiredAuthority: [],
    };
  }
  if (rootUpdate.state === "rejected") {
    return {
      state: "rejected",
      phases: [
        completionPhase("merge-confirm", "succeeded"),
        completionPhase(
          "root-update",
          "rejected",
          [...rootUpdate.reasons],
          [...rootUpdate.recovery],
        ),
        ...skippedCompletionPhases(
          COMPLETION_PHASES.slice(2),
          "root更新が拒否されたためcleanupへ進みません",
        ),
      ],
      requiredAuthority: [],
    };
  }
  if (rootUpdate.to.toLowerCase() !== mergeSha.toLowerCase()) {
    const reason = "root更新計画の到達SHAが検証済みmerge SHAと一致しません";
    return {
      state: "rejected",
      phases: [
        completionPhase("merge-confirm", "succeeded"),
        completionPhase(
          "root-update",
          "rejected",
          [reason],
          ["root更新状態とmerge SHAを再読取して完了previewを再実行する"],
        ),
        ...skippedCompletionPhases(
          COMPLETION_PHASES.slice(2),
          "root更新の到達SHAが一致しないためcleanupへ進みません",
        ),
      ],
      requiredAuthority: [],
    };
  }
  if (!cleanup || cleanup.state === "rejected") {
    const reasons = cleanup?.reasons ?? ["cleanup観測が不正または不明です"];
    return {
      state: "rejected",
      phases: [
        completionPhase("merge-confirm", "succeeded"),
        completionPhase("root-update", "succeeded"),
        completionPhase(
          "cleanup-preview",
          "rejected",
          [...reasons],
          ["対象worktreeの安全条件を再読取してcleanup previewを再実行する"],
        ),
        ...skippedCompletionPhases(
          COMPLETION_PHASES.slice(3),
          "cleanup previewが成立しないため適用しません",
        ),
      ],
      requiredAuthority: [],
    };
  }
  if (cleanup.state === "already-absent") {
    return {
      state: "ready",
      phases: [
        completionPhase("merge-confirm", "succeeded"),
        completionPhase("root-update", "succeeded"),
        completionPhase("cleanup-preview", "succeeded", [
          "対象worktreeは既に削除済みです",
        ]),
        completionPhase("cleanup-apply", "skipped", [
          "既削除のため再適用は不要です",
        ]),
        completionPhase("post-verify", "skipped"),
      ],
      requiredAuthority: [],
    };
  }
  if (value.cleanupAuthorityGranted !== true) {
    return {
      state: "pending",
      phases: [
        completionPhase("merge-confirm", "succeeded"),
        completionPhase("root-update", "succeeded"),
        completionPhase("cleanup-preview", "succeeded"),
        completionPhase(
          "cleanup-apply",
          "pending",
          ["worktree cleanup operationの明示authorityがありません"],
          [
            "同じpreview digestを確認し、--cleanup-authorityを明示して再実行する",
          ],
        ),
        completionPhase("post-verify", "skipped"),
      ],
      requiredAuthority: ["worktree.cleanup"],
    };
  }
  const previewDigest =
    typeof value.previewDigest === "string" ? value.previewDigest : "";
  const approvedDigest =
    typeof value.approvedDigest === "string" ? value.approvedDigest : "";
  if (
    !/^[a-f0-9]{64}$/u.test(previewDigest) ||
    !/^[a-f0-9]{64}$/u.test(approvedDigest) ||
    previewDigest !== approvedDigest
  ) {
    return {
      state: "rejected",
      phases: [
        completionPhase("merge-confirm", "succeeded"),
        completionPhase("root-update", "succeeded"),
        completionPhase("cleanup-preview", "succeeded"),
        completionPhase(
          "cleanup-apply",
          "rejected",
          ["承認済みdigestが最新cleanup previewの64桁digestと一致しません"],
          [
            "worktree finalize --completeをpreviewで再実行し、新しいpreview digestを確認する",
          ],
        ),
        completionPhase("post-verify", "skipped"),
      ],
      requiredAuthority: [],
    };
  }
  return {
    state: "ready",
    phases: [
      completionPhase("merge-confirm", "succeeded"),
      completionPhase("root-update", "succeeded"),
      completionPhase("cleanup-preview", "succeeded"),
      completionPhase("cleanup-apply", "succeeded"),
      completionPhase("post-verify", "skipped"),
    ],
    requiredAuthority: [],
  };
}

function isCompletionPhase(value: unknown): value is CompletionPhase {
  return (
    typeof value === "string" &&
    COMPLETION_PHASES.some((phase) => phase === value)
  );
}

function isCompletionPhaseState(
  value: unknown,
): value is CompletionPhaseResult["state"] {
  return (
    value === "succeeded" ||
    value === "rejected" ||
    value === "pending" ||
    value === "skipped"
  );
}

function validCompletionPhase(value: unknown): value is CompletionPhaseResult {
  return (
    isRecord(value) &&
    isCompletionPhase(value.phase) &&
    isCompletionPhaseState(value.state) &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string") &&
    Array.isArray(value.recovery) &&
    value.recovery.every((recovery) => typeof recovery === "string")
  );
}

export function summarizeCompletion(input: unknown): {
  state: "completed" | "partially-completed" | "rejected";
  completed: CompletionPhase[];
  pending: CompletionPhase[];
  recovery: string[];
} {
  const value = isRecord(input) ? input : {};
  const phases = Array.isArray(value.phases)
    ? value.phases.filter(validCompletionPhase)
    : [];
  const postVerify = isRecord(value.postVerify) ? value.postVerify : {};
  if (
    phases.length !== COMPLETION_PHASES.length ||
    new Set(phases.map((phase) => phase.phase)).size !==
      COMPLETION_PHASES.length ||
    typeof postVerify.rootSha !== "string" ||
    typeof postVerify.expectedRootSha !== "string" ||
    typeof postVerify.targetPathAbsent !== "boolean" ||
    typeof postVerify.otherWorktreesUnchanged !== "boolean" ||
    !["removed", "retained", "absent"].includes(
      typeof postVerify.containerState === "string"
        ? postVerify.containerState
        : "",
    )
  ) {
    return {
      state: "rejected",
      completed: [],
      pending: [...COMPLETION_PHASES],
      recovery: [
        "phase結果と事後確認を再読取し、worktree finalize --completeを再実行する",
      ],
    };
  }
  const recovery = phases.flatMap((phase) => phase.recovery);
  if (postVerify.rootSha !== postVerify.expectedRootSha)
    recovery.push("root HEADと検証済みmerge SHAを確認し、root更新を再検証する");
  if (!postVerify.targetPathAbsent)
    recovery.push(
      "対象worktreeを保持したままcleanup previewとauthorityを確認して再実行する",
    );
  if (!postVerify.otherWorktreesUnchanged)
    recovery.push(
      "他worktree一覧を直前snapshotと照合し、差分を復旧してから再実行する",
    );
  const completed = phases
    .filter(
      (phase) => phase.state === "succeeded" && phase.phase !== "post-verify",
    )
    .map((phase) => phase.phase);
  const verificationFailed =
    postVerify.rootSha !== postVerify.expectedRootSha ||
    !postVerify.targetPathAbsent ||
    !postVerify.otherWorktreesUnchanged;
  const postVerifySucceeded = phases.some(
    (phase) => phase.phase === "post-verify" && phase.state === "succeeded",
  );
  if (!verificationFailed && postVerifySucceeded) completed.push("post-verify");
  const pending = COMPLETION_PHASES.filter(
    (phase) => !completed.includes(phase),
  );
  const rejectedPhase = phases.some((phase) => phase.state === "rejected");
  const pendingPhase = phases.some((phase) => phase.state === "pending");
  const rootSucceeded = phases.some(
    (phase) => phase.phase === "root-update" && phase.state === "succeeded",
  );
  const requiredPlanningSucceeded = [
    "merge-confirm",
    "root-update",
    "cleanup-preview",
  ].every((required) =>
    phases.some(
      (phase) => phase.phase === required && phase.state === "succeeded",
    ),
  );
  if (!requiredPlanningSucceeded)
    recovery.push(
      "merge確認、root更新、cleanup previewの順序を再確認して完了フローを再実行する",
    );
  const cleanupAppliedOrAbsent = phases.some(
    (phase) =>
      phase.phase === "cleanup-apply" &&
      (phase.state === "succeeded" ||
        (phase.state === "skipped" && postVerify.targetPathAbsent === true)),
  );
  const incompleteOutcome =
    !requiredPlanningSucceeded ||
    !cleanupAppliedOrAbsent ||
    !postVerifySucceeded;
  const state =
    verificationFailed ||
    pendingPhase ||
    (rejectedPhase && rootSucceeded) ||
    (incompleteOutcome && rootSucceeded)
      ? "partially-completed"
      : rejectedPhase || incompleteOutcome
        ? "rejected"
        : "completed";
  return {
    state,
    completed,
    pending,
    recovery: [...new Set(recovery)],
  };
}

interface FinalizeState {
  repositoryRoot?: string;
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
  ignoredPathAllowlist?: string[];
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
  const ignoredArtifacts = state.ignoredArtifacts;
  const derivedUntracked =
    Array.isArray(state.untracked) &&
    Array.isArray(state.temporaryArtifacts) &&
    Array.isArray(ignoredArtifacts)
      ? [
          ...state.untracked,
          ...state.temporaryArtifacts.filter(
            (artifact) => !ignoredArtifacts.includes(artifact),
          ),
        ]
      : state.untracked;
  if (!Array.isArray(state.temporaryArtifacts))
    reasons.push("一時資産があるか状態が不明です");
  const safety = assessWorktreeRemovalSafety({
    repositoryRoot: state.repositoryRoot,
    worktreePath:
      state.repositoryRoot === undefined ? undefined : state.worktree,
    trackedChanges:
      state.dirty === undefined ? undefined : state.dirty === true,
    untracked: derivedUntracked,
    ignoredArtifacts,
    ignoredPathAllowlist:
      state.ignoredPathAllowlist === undefined
        ? resolveFinalizeIgnoredPathAllowlist()
        : state.ignoredPathAllowlist,
    stashes: state.stashes,
    pushed: state.pushed,
    remoteBranch: state.remoteBranch,
    merged: state.prMerged === "unknown" ? undefined : state.prMerged,
    recoveryReachable: state.recoveryReachable,
  });
  reasons.push(...safety.reasons);
  const requiredTruth: Array<[keyof FinalizeState, string]> = [
    ["specConsistent", "仕様整合性が証明されていません"],
    ["testsPassed", "テスト合格が証明されていません"],
    ["reviewApproved", "レビューが承認されていません"],
  ];
  for (const [field, label] of requiredTruth)
    if (state[field] !== true) reasons.push(label);
  if (!state.recoveryRef) reasons.push("復旧参照がありません");
  const snapshot = structuredClone({
    ...state,
    ignoredPathAllowlist:
      state.ignoredPathAllowlist ?? resolveFinalizeIgnoredPathAllowlist(),
  });
  const hash = crypto
    .createHash("sha256")
    .update(stableJson(snapshot))
    .digest("hex");
  const uniqueReasons = [...new Set(reasons)];
  return {
    version: 1,
    safe: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    snapshot,
    hash,
  };
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
