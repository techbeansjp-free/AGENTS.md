import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  createIssueStaging,
  assertStagingSyncTarget,
  recordStagingSync,
  validateIssue,
  withoutMarkdownCode,
  type IssueValidationStage,
} from "./domain/issue.js";
import { parsePocDeclaration } from "./domain/workflow.js";
import {
  bootstrapProject,
  validateSpecs,
  type ProjectKind,
} from "./domain/spec.js";
import { buildReviewEvidence, evaluateReview } from "./domain/review.js";
import { parseReviewRoundInput } from "./domain/review-convergence.js";
import {
  assertPullRequestTrackerBinding,
  createPullRequest,
  authorizeMerge,
  extractIssueClosingNumbers,
} from "./domain/delivery.js";
import {
  assessImplementationDiscovery,
  assertWorkflowMergeAllowed,
  decideDeliveryContinuation,
  parseImplementationDiscoveryInput,
  parseVerificationSelectionInput,
  selectVerificationSet,
} from "./domain/agile-verification.js";
import {
  buildWorktreePath,
  createWorktree,
  canonicalWorktreePath,
  DEFAULT_WORKTREE_PLACEMENT,
  enforceTrustedWorktreeBoundary,
  inspectFinalizeState,
  inspectRecoveryState,
  validateWorktreePlacement,
} from "./domain/worktree.js";
import {
  applyWorkspaceHygiene,
  previewWorkspaceHygiene,
  type HygieneKind,
} from "./domain/hygiene.js";
import {
  applyStagingCleanup,
  calculateStagingDigest,
  listStagingArtifacts,
  migrateLegacyStagingTrackerLocked,
  planStagingCleanup,
  readStoredStagingRecord,
  withStagingMutationLock,
} from "./domain/staging.js";
import {
  buildFinalizeReport,
  applyFinalize,
  planCompletion,
  planRootUpdate,
  planWorktreeCleanup,
  summarizeCompletion,
  type CompletionPhaseResult,
  type RootUpdateObservation,
} from "./domain/finalize.js";
import { init, upgrade, uninstall, doctor } from "./domain/lifecycle.js";
import {
  loadConsumerChoicesFragmentAtCommit,
  loadConsumerPolicyAtCommit,
  conformanceDeclarationFromPolicySet,
  loadEffectiveTrustedPolicySet,
  choicesFragmentSource,
  loadOperationPolicy,
  loadProjectPolicySet,
  loadProjectPolicySetAtCommit,
  mergeMethodPolicyWarnings,
  validatePolicy,
} from "./domain/policy.js";
import {
  applyMigration,
  compareTrustedPolicy,
  enforceOperation,
  planMigration,
  resolveEffectivePolicy,
  retryMigration,
  rollbackMigration,
  sanitizeOutput,
  serializeDiagnostic,
} from "./domain/enforcement.js";
import {
  applyFileMigration,
  planFileMigration,
  recoverFileMigration,
  retryFileMigration,
  rollbackFileMigration,
  type MigrationState,
} from "./domain/migration.js";
import { validateScenarioTrace } from "./domain/trace.js";
import {
  DEFAULT_GRAPH_BUDGET,
  GraphFreshnessError,
  SEMANTIC_EDGE_KINDS,
  assessGraphFreshness,
  semanticGraphContentHash,
  shortestSemanticPath,
  topologicalSemanticOrder,
  traverseSemanticGraph,
  type SemanticEdgeKind,
} from "./domain/semantic-graph.js";
import {
  buildRepositorySemanticGraph,
  observeRepositoryGraphSource,
} from "./adapters/repository-graph.js";
import {
  canonicalProviderInstant,
  github,
  GitHubProviderUnavailableError,
  samePolicyAuthorityObservation,
  type ApprovalObservation,
  type CommitAncestryObservation,
  type CommitTopologyObservation,
  type PolicyAuthorityObservation,
  type PullRequestInspection,
  type PullRequestQueueObservation,
} from "./adapters/github.js";
import {
  assertMinimumExecutableVersion,
  MINIMUM_GH_VERSION,
  MINIMUM_GIT_VERSION,
} from "./lib/executable-version.js";
import { git } from "./lib/process.js";
import { writeFileAtomic } from "./lib/atomic.js";
import { validateRepositoryConformance } from "./domain/conformance.js";
import {
  parseJsonStrict,
  resolveContained,
  stableJson,
} from "./lib/security.js";
import {
  canonicalLifecycleCommand,
  CLI_USAGE,
  PUBLIC_LIFECYCLE_COMMANDS,
  routingDiagnostic,
  routingRecovery,
} from "./cli-contract.js";
import {
  COMMAND_USAGE,
  findCommandUsage,
  missingFlagsError,
  missingRequiredFlags,
  renderUsage,
  spaceSeparatedFlagError,
  usageKey,
  valueFlagNames,
  CliValidationError,
  type CommandUsage,
} from "./cli-usage.js";
import { type Policy, isRecord } from "./types.js";
import { type PolicySet } from "./domain/policy.js";
import {
  surveyWorktrees,
  type WorktreeObservation,
  type WorktreeSurvey,
} from "./domain/worktree-survey.js";
import { resolveFinalizeIgnoredPathAllowlist } from "./domain/worktree-removal-safety.js";
import { observeProvider } from "./adapters/provider.js";
import { resolveRouting } from "./domain/routing.js";
import { checkRoutingIndependence } from "./domain/routing-independence.js";
import {
  appendCompletionRecord,
  appendEvidenceStateRecord,
  applyEvidencePrune,
  issueRoutingEvidence,
  previewEvidencePrune,
} from "./domain/routing-evidence.js";
import {
  MODEL_TIERS,
  requiredTier,
  validateProviderSelection,
  validateRoleAssignment,
  validateTierSelection,
  type HumanOverride,
  type ModelTier,
} from "./domain/role.js";
import {
  readDeliveryEvidence,
  readEnforcementInput,
  readFinalizeEvidence,
  isPolicyInput,
  readJsonInput,
  readMigrationManifest,
  readMigrationState,
  readModeAssessment,
  readPolicyFileInput,
  readPolicyJson,
  readSpecReview,
} from "./adapters/json-input.js";
import {
  appendDeliveryTerminalJournalEntry,
  appendWorkflowJournalEntry,
  assertPocDeliveryChangeScope,
  assertWorkflowStaging,
  executePocObservation,
  inspectCurrentPocJournalBinding,
  inspectWorkflowStaging,
  inspectPendingJournalTransaction,
  inspectStoredPocObservationEvidence,
  previewWorkflowStagingPromotion,
  promoteWorkflowStagingToFull,
  readWorkflowJournal,
  recoverPendingJournalTransaction,
  resolvePullRequestStaging,
  workflowStep,
} from "./adapters/workflow-journal.js";
import {
  assertConvergedReviewSession,
  previewReviewRound,
  recordReviewRound,
} from "./adapters/review-session.js";
import {
  appendEvidenceReanchor,
  readEvidenceReanchorChain,
} from "./adapters/evidence-reanchor.js";
import { deriveEffectiveHead } from "./domain/evidence-reanchor.js";
import {
  bindStoredPullRequest,
  claimStoredMergeDispatch,
  claimStoredPullRequestCreationDispatch,
  observeStoredMerge,
  prepareStoredMergeIntent,
  prepareStoredPullRequestCreation,
  readStoredDeliveryState,
  recordStoredStep11,
  requireStoredDeliveryReconciliation,
  resumeStoredPullRequestCreationAfterConfirmedAbsence,
} from "./adapters/delivery-state.js";
import {
  DELIVERY_STATE_FILE,
  assertImmutablePullRequestBinding,
  canonicalDigest,
  closingContractDigest,
  pullRequestContentDigest,
  pullRequestTerminalEvidenceId,
  type DeliveryState,
  type MergeProviderRequest,
  type MergeObservation,
} from "./domain/delivery-state.js";
import {
  MODE_STEP_SEQUENCES,
  NEVER_SKIPPABLE_STEPS,
  requiredSteps,
  skippableSteps,
  validateJournalHumanOverride,
  validateStepJournal,
  WORKFLOW_STEPS,
  type JournalHumanOverride,
  type StepJournalEntry,
} from "./domain/workflow.js";
import type { Mode } from "./domain/mode.js";

type Flags = Record<string, string | boolean>;

function workflowArguments(args: string[]): {
  flags: Record<string, string>;
  artifacts: string[];
} {
  const flags: Record<string, string> = {};
  const artifacts: string[] = [];
  const booleanFlags = new Set(["apply", "dry-run"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (!argument.startsWith("--"))
      throw new Error(
        `workflow commandの位置引数は使用できません: ${argument}`,
      );
    const equal = argument.indexOf("=");
    const key = argument.slice(2, equal === -1 ? undefined : equal);
    let value = equal === -1 ? undefined : argument.slice(equal + 1);
    if (value === undefined && booleanFlags.has(key)) {
      if (flags[key] !== undefined)
        throw new Error(`オプションが重複しています: --${key}`);
      flags[key] = "__present__";
      continue;
    }
    if (value === undefined) {
      const following = args[index + 1];
      if (!following || following.startsWith("--"))
        throw new Error(`--${key}には値が必要です`);
      value = following;
      index += 1;
    }
    if (value === "") throw new Error(`--${key}には空でない値が必要です`);
    if (key === "artifact") artifacts.push(value);
    else {
      if (flags[key] !== undefined)
        throw new Error(`オプションが重複しています: --${key}`);
      flags[key] = value;
    }
  }
  return { flags, artifacts };
}

function workflowLifecycleApplyMode(flags: Record<string, string>): boolean {
  for (const key of ["apply", "dry-run"])
    if (flags[key] !== undefined && flags[key] !== "__present__")
      throw new Error(`--${key}は値を付けずに指定してください`);
  if (flags.apply === "__present__" && flags["dry-run"] === "__present__")
    throw new Error("--applyと--dry-runは同時に指定できません");
  return flags.apply === "__present__";
}

function workflowMode(value: string): Mode {
  if (value !== "quick" && value !== "full" && value !== "poc")
    throw new Error("--modeはquick、full、pocのいずれかが必要です");
  return value;
}

function workflowStepNumber(value: string, flag: string): number {
  if (!/^\d+$/u.test(value))
    throw new Error(`--${flag}は0..11の整数が必要です`);
  const step = Number(value);
  if (step < 0 || step > 11)
    throw new Error(`--${flag}は0..11の整数が必要です`);
  return step;
}

function workflowDiagnostic(
  staging: string,
  mode: Mode,
  result: ReturnType<typeof validateStepJournal>,
  extra: string[] = [],
) {
  const missing = result.missingSteps.map((step) => {
    const definition = workflowStep(step);
    return {
      step,
      skillId: definition?.skillId ?? "unknown",
      responsibility: definition?.responsibility ?? "不明",
    };
  });
  const reasons = [
    ...extra,
    ...missing.map(
      ({ step, skillId, responsibility }) =>
        `step ${step}（${skillId}）${responsibility} の記録がありません`,
    ),
    ...result.unexpectedSteps.map(
      (step) => `mode=${mode}でstep ${step}は実施対象ではありません`,
    ),
    ...result.outOfOrder.map(
      (step) => `step ${step}が規定順序に違反しています`,
    ),
    ...result.modeConflicts,
    ...result.errors,
  ];
  if (mode === "quick" && result.missingSteps.includes(4))
    reasons.push("quickでもstep 4は省略対象ではないため、Issue同期が必要です");
  return {
    valid: false,
    staging,
    mode,
    missingSteps: missing,
    unexpectedSteps: result.unexpectedSteps,
    outOfOrder: result.outOfOrder,
    modeConflicts: result.modeConflicts,
    diagnostic: {
      ruleId: "ASC-WORKFLOW-STEP-001",
      purpose: "Step 0〜11の実施順序と省略可否を機械的に保証する",
      risk: "workflow",
      reasons,
      scope: ["workflow", "pr create", staging],
      checks: ["staging record、モード判定成果物、step journalを検証した"],
      autoFixes: [],
      next: "欠落したStepのskill contractを実行し、workflow record後に再検証してください",
      requiredAuthority:
        "通常は不要。欠落を受容する場合は対象Issueへ拘束したHumanOverride",
      rollback: "PRを作成せずstagingとjournalを保持する",
    },
  };
}

function assertWorkflowReadyForDelivery(
  staging: string,
): ReturnType<typeof inspectWorkflowStaging> {
  const stored = readStoredStagingRecord(staging);
  const currentArtifacts = listStagingArtifacts(staging);
  const currentDigest = calculateStagingDigest(staging, currentArtifacts);
  if (
    stableJson(stored.artifacts) !== stableJson(currentArtifacts) ||
    stored.digest !== currentDigest
  )
    throw new Error(
      "delivery直前のstaging成果物またはcontent digestが同期済み記録から変化しています",
    );
  const inspection = inspectWorkflowStaging(staging, 10);
  if (
    !inspection.modeDecision.valid ||
    !inspection.validation.valid ||
    inspection.state !== "sync-verified"
  )
    throw new Error(
      `delivery直前のworkflow再検証に失敗しました: ${[
        ...inspection.modeDecision.errors,
        ...inspection.validation.errors,
        ...inspection.validation.modeConflicts,
        ...(inspection.validation.missingSteps.length > 0
          ? [`missingSteps=${inspection.validation.missingSteps.join(",")}`]
          : []),
        ...(inspection.state === "sync-verified"
          ? []
          : ["staging recordがsync-verifiedではありません"]),
      ].join("; ")}`,
    );
  return inspection;
}

export function assertCurrentReviewJournalBinding(
  staging: string,
  headSha: string,
): void {
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0)
    throw new Error(
      `PR作成前のreview journalが不正です: ${journal.errors.join("; ")}`,
    );
  const step10 = [...journal.entries]
    .reverse()
    .find((entry) => entry.step === 10);
  if (!step10?.reviewSession)
    throw new Error("PR作成には最新Step 10のreviewSession bindingが必要です");
  const binding = step10.reviewSession;
  /**
   * **照合対象は生の記録headではなく、再固定chainから導出した実効HEADである。**
   *
   * 既定branchが動いてrebaseするとjournalのStep 10 bindingは旧headを指したままになる。
   * 内容等価性を実証した再固定記録があるなら、その終端を照合対象にする。
   * 記録が無ければchainは空で、実効HEADは記録headそのものになり判定は変更前と同一である。
   */
  const bindingEffectiveHead = deriveEffectiveHead({
    records: readEvidenceReanchorChain(staging),
    anchoredHeadSha: binding.headSha,
  }).effectiveHeadSha;
  if (bindingEffectiveHead !== headSha)
    throw new Error(
      "Step 10のreviewSession binding HEADがPR作成対象HEADと一致しません",
    );
  const session = assertConvergedReviewSession({
    staging,
    expectedDigest: binding.roundDigest,
    currentHeadSha: headSha,
  });
  const sessionEffectiveHead = deriveEffectiveHead({
    records: readEvidenceReanchorChain(staging),
    anchoredHeadSha: session.latestCandidateHeadSha,
  }).effectiveHeadSha;
  if (
    session.sessionId !== binding.sessionId ||
    session.latestRoundDigest !== binding.roundDigest ||
    sessionEffectiveHead !== bindingEffectiveHead
  )
    throw new Error(
      "Step 10のreviewSession bindingが保存済み収束sessionと一致しません",
    );
}

function assertObservedClosingContract(input: {
  state: DeliveryState;
  observed: PullRequestInspection;
  tracker: string | null;
}): { issue: number; issueUrl: string; bodyClosingDigest: string } {
  if (
    input.observed.headRepository?.nameWithOwner?.toLowerCase() !==
      input.state.create.repository.toLowerCase() ||
    input.observed.isCrossRepository !== false
  )
    throw new Error(
      "PRのhead repositoryが準備済みsame-repository identityと一致しません",
    );
  if (
    typeof input.observed.title !== "string" ||
    typeof input.observed.body !== "string"
  )
    throw new Error("PRタイトル・本文をtrusted providerから再観測できません");
  if (
    pullRequestContentDigest({
      title: input.observed.title,
      body: input.observed.body,
    }) !== input.state.create.pullRequestDigest
  )
    throw new Error("PRタイトル・本文がPR作成時の固定contentから変化しました");
  const binding = assertPullRequestTrackerBinding({
    repository: input.state.create.repository,
    tracker: input.tracker,
    closingIssueReferences: input.observed.closingIssuesReferences,
  });
  if (
    binding.issue !== input.state.create.issue ||
    binding.issueUrl.toLowerCase() !== input.state.create.issueUrl.toLowerCase()
  )
    throw new Error(
      "PRのclosing Issueが準備済みdelivery identityと一致しません",
    );
  const closes = [
    ...new Set(
      extractIssueClosingNumbers(withoutMarkdownCode(input.observed.body)),
    ),
  ];
  const bodyClosingDigest = closingContractDigest({
    canonicalIssue: binding.issue,
    canonicalIssueUrl: binding.issueUrl,
    closingIssueNumbers: closes,
  });
  if (bodyClosingDigest !== input.state.create.bodyClosingDigest)
    throw new Error("PR本文のclosing契約がPR作成時の固定値から変化しました");
  return { ...binding, bodyClosingDigest };
}

function bindingFromCreatedPullRequest(input: {
  state: DeliveryState;
  observed: PullRequestInspection;
  tracker: string | null;
  boundAt: string;
}) {
  const { state, observed } = input;
  if (
    typeof observed.number !== "number" ||
    !Number.isSafeInteger(observed.number) ||
    observed.number <= 0 ||
    typeof observed.url !== "string"
  )
    throw new Error("PR作成後に番号とURLを固定できません");
  if (
    observed.headRefName !== state.create.headRef ||
    observed.headRefOid !== state.create.headSha ||
    observed.baseRefName !== state.create.baseRef
  )
    throw new Error(
      "PR作成後のbase ref/head identityが準備済み値と一致しません",
    );
  assertObservedClosingContract({ state, observed, tracker: input.tracker });
  return { number: observed.number, url: observed.url, boundAt: input.boundAt };
}

/**
 * 固定済みPR bindingと再観測を照合する。
 *
 * **headの照合対象は再固定chainの実効HEADである。** 固定済み`create.headSha`を
 * 直接使うと、既定branchが動いてrebaseし`pr reanchor`を規定どおり実行しても
 * `pr merge`が通らない（Issue #1101）。REQ-WF-005は「照合対象を新headへ移す」と
 * 定めており、`pr create`後はその移送を`pr reanchor`が受け持つ。
 *
 * **chainが空なら実効HEADは`create.headSha`そのものになる。** 再固定記録を
 * 持たない既存stateの判定は変更前と完全に同一である。
 */
export function assertBoundPullRequestObservation(input: {
  staging: string;
  state: DeliveryState;
  observed: PullRequestInspection;
  tracker: string | null;
}): ReturnType<typeof assertObservedClosingContract> {
  const { state, observed } = input;
  if (!state.pr) throw new Error("固定済みPR bindingがありません");
  const effectiveHeadSha = deriveEffectiveHead({
    records: readEvidenceReanchorChain(input.staging),
    anchoredHeadSha: state.create.headSha,
  }).effectiveHeadSha;
  if (
    observed.number !== state.pr.number ||
    observed.url?.toLowerCase() !== state.pr.url.toLowerCase() ||
    observed.headRefName !== state.create.headRef ||
    observed.headRefOid !== effectiveHeadSha ||
    observed.baseRefName !== state.create.baseRef
  )
    throw new Error(
      "PR再観測が固定済みrepository・PR・base ref・headと一致しません",
    );
  assertImmutablePullRequestBinding(state, {
    repository: state.create.repository,
    issue: state.create.issue,
    issueUrl: state.create.issueUrl,
    prNumber: state.pr.number,
    prUrl: state.pr.url,
    headSha: state.create.headSha,
  });
  return assertObservedClosingContract(input);
}

function mergeObservationFromProvider(input: {
  staging: string;
  state: DeliveryState;
  observed: PullRequestInspection;
  queue?: PullRequestQueueObservation;
  tracker: string | null;
  observedAt: string;
}): Omit<MergeObservation, "observationId"> {
  if (!input.state.pr) throw new Error("固定済みPR bindingがありません");
  const closing = assertBoundPullRequestObservation(input);
  const merged = String(input.observed.state ?? "").toUpperCase() === "MERGED";
  const autoMergeRequest = isRecord(input.observed.autoMergeRequest)
    ? input.observed.autoMergeRequest
    : null;
  const autoMergeRequested = autoMergeRequest !== null;
  const queueEntry = input.queue?.entry ?? null;
  if (
    input.queue &&
    (input.queue.repository.toLowerCase() !==
      input.state.create.repository.toLowerCase() ||
      input.queue.prNumber !== input.state.pr.number ||
      input.queue.headRefOid !== input.state.create.headSha)
  )
    throw new Error("merge queue観測が固定済みPR bindingと一致しません");
  if (!merged && !autoMergeRequested && !queueEntry)
    throw new Error(
      "merge要求またはnative auto-merge登録をproviderのread-backで観測できません",
    );
  let mergeCommitSha: string | null = null;
  let providerMergedAt: string | null = null;
  let providerRequest: MergeProviderRequest | null = null;
  const currentAutoMergeRequest = (): MergeProviderRequest | null => {
    if (!autoMergeRequest) return null;
    if (!input.state.merge)
      throw new Error("auto-merge要求の観測には固定済みmerge intentが必要です");
    const expectedMethod = input.state.merge.method.toUpperCase();
    if (autoMergeRequest.mergeMethod !== expectedMethod)
      throw new Error(
        "providerのauto-merge methodが固定済みmerge intentと一致しません",
      );
    return {
      kind: "auto-merge",
      requestedAt: canonicalProviderInstant(
        autoMergeRequest.enabledAt,
        "auto-merge enabledAt",
      ),
      method: input.state.merge.method,
      headSha: input.state.create.headSha,
      baseSha: input.state.merge.authorizedBaseSha,
    };
  };
  if (merged) {
    const mergedAt = input.observed.mergedAt;
    providerMergedAt = canonicalProviderInstant(
      mergedAt,
      "merged PRのmergedAt",
    );
    const oid = input.observed.mergeCommit?.oid;
    if (typeof oid !== "string" || !/^[a-f0-9]{40}$/u.test(oid))
      throw new Error("merged PRのmerge commit OIDを観測できません");
    mergeCommitSha = oid;
    providerRequest =
      currentAutoMergeRequest() ??
      input.state.merge?.observation?.providerRequest ??
      null;
  } else {
    if (!input.state.merge)
      throw new Error("merge要求の観測には固定済みmerge intentが必要です");
    if (autoMergeRequested) {
      providerRequest = currentAutoMergeRequest();
    }
    if (queueEntry) {
      providerRequest = {
        kind: "merge-queue",
        requestId: queueEntry.id,
        requestedAt: queueEntry.enqueuedAt,
        queueState: queueEntry.state,
        headSha: queueEntry.headCommitOid,
        baseSha: queueEntry.baseCommitOid,
      };
    }
  }
  return {
    repository: input.state.create.repository,
    prNumber: input.state.pr.number,
    prUrl: input.state.pr.url,
    headSha: input.state.create.headSha,
    issue: closing.issue,
    issueUrl: closing.issueUrl,
    bodyClosingDigest: closing.bodyClosingDigest,
    providerState: merged ? "merged" : "merge-requested",
    providerRequest,
    providerMergedAt,
    observedAt: input.observedAt,
    mergeCommitSha,
  };
}

function finishObservedMerge(
  staging: string,
  current: DeliveryState,
  mode: Mode,
): { exitCode: number; output: Record<string, unknown> } {
  if (!current.pr || !current.merge?.observation)
    throw new Error("Step 11記録には固定PRとmerge observationが必要です");
  const observation = current.merge.observation;
  if (observation.providerState !== "merged")
    throw new Error("Step 11記録にはproviderのmerged終端観測が必要です");
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0)
    throw new Error(
      `Step 11再開前のjournalが不正です: ${journal.errors.join("; ")}`,
    );
  const existingEntries = journal.entries.filter((entry) => entry.step === 11);
  if (existingEntries.length > 1)
    throw new Error("Step 11 journal entryが重複しています");
  const existing = existingEntries[0];
  let workflow: {
    entry: StepJournalEntry;
    journalDigest: string;
    stagingDigest?: string;
  };
  if (existing) {
    if (
      !existing.artifacts.includes(current.pr.url) ||
      !existing.artifacts.includes(DELIVERY_STATE_FILE) ||
      !existing.evidence.includes(observation.observationId) ||
      !existing.evidence.includes("outcome=merged")
    )
      throw new Error("既存Step 11が固定済みmerge observationと一致しません");
    workflow = {
      entry: existing,
      journalDigest: crypto
        .createHash("sha256")
        .update(journal.source)
        .digest("hex"),
    };
  } else {
    const definition = workflowStep(11);
    if (!definition) throw new Error("step 11の定義がありません");
    workflow = appendDeliveryTerminalJournalEntry({
      staging,
      headSha: current.create.headSha,
      entry: {
        step: 11,
        skillId: definition.skillId,
        mode,
        recordedAt: new Date().toISOString(),
        artifacts: [current.pr.url, DELIVERY_STATE_FILE],
        evidence: `outcome=merged delivery observation ${observation.observationId}でrepository=${observation.repository} PR #${observation.prNumber} HEAD=${observation.headSha} Issue=${observation.issueUrl} provider=${observation.providerState}を再観測した`,
      },
    });
  }
  const completed = recordStoredStep11(staging, {
    outcome: "merged",
    recordedAt: workflow.entry.recordedAt,
    journalDigest: workflow.journalDigest,
  });
  return {
    exitCode: 0,
    output: {
      state: "merged",
      url: current.pr.url,
      observation,
      workflow,
      deliveryState: completed,
    },
  };
}

function finishBoundPullRequest(
  staging: string,
  current: DeliveryState,
  mode: Mode,
  created: Record<string, unknown> & { url?: string },
): { exitCode: number; output: Record<string, unknown> } {
  if (!current.pr || current.merge || current.state !== "pr-bound")
    throw new Error("PR停止終端にはmerge前の固定済みPR bindingが必要です");
  const evidenceId = pullRequestTerminalEvidenceId(current.create, current.pr);
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0)
    throw new Error(
      `PR停止終端のStep 11再開前journalが不正です: ${journal.errors.join("; ")}`,
    );
  const existingEntries = journal.entries.filter((entry) => entry.step === 11);
  if (existingEntries.length > 1)
    throw new Error("Step 11 journal entryが重複しています");
  let workflow: {
    entry: StepJournalEntry;
    journalDigest: string;
    stagingDigest?: string;
  };
  const existing = existingEntries[0];
  if (existing) {
    if (
      !existing.artifacts.includes(current.pr.url) ||
      !existing.artifacts.includes(DELIVERY_STATE_FILE) ||
      !existing.evidence.includes(evidenceId) ||
      !existing.evidence.includes("outcome=pull-request")
    )
      throw new Error("既存Step 11が固定済みPR停止Evidenceと一致しません");
    workflow = {
      entry: existing,
      journalDigest: crypto
        .createHash("sha256")
        .update(journal.source)
        .digest("hex"),
    };
  } else {
    const definition = workflowStep(11);
    if (!definition) throw new Error("step 11の定義がありません");
    workflow = appendDeliveryTerminalJournalEntry({
      staging,
      headSha: current.create.headSha,
      entry: {
        step: 11,
        skillId: definition.skillId,
        mode,
        recordedAt: new Date().toISOString(),
        artifacts: [current.pr.url, DELIVERY_STATE_FILE],
        evidence: `outcome=pull-request evidence=${evidenceId} repository=${current.create.repository} PR #${current.pr.number} HEAD=${current.create.headSha}を停止終端として固定した`,
      },
    });
  }
  const completed = recordStoredStep11(staging, {
    outcome: "pull-request",
    recordedAt: workflow.entry.recordedAt,
    journalDigest: workflow.journalDigest,
  });
  return {
    exitCode: 0,
    output: {
      ...created,
      state: "pull_request_complete",
      continuation: "stop-at-pr",
      workflow,
      deliveryState: completed,
      next: "PR停止点をStep 11として完了しました。mergeはこのworkflowの範囲外です",
    },
  };
}

function assertStoredStagingContentDigest(
  staging: string,
  context: string,
): void {
  const stored = readStoredStagingRecord(staging);
  const artifacts = listStagingArtifacts(staging);
  if (
    stableJson(stored.artifacts) !== stableJson(artifacts) ||
    stored.digest !== calculateStagingDigest(staging, artifacts)
  ) {
    const pending = inspectPendingJournalTransaction(staging);
    if (pending?.state === "published") return;
    throw new Error(
      `${context}のstaging成果物一覧またはcontent digestが保存値と一致しません`,
    );
  }
}

function assertRecordedStep11Evidence(
  staging: string,
  current: DeliveryState,
): void {
  if (!current.pr || !current.step11)
    throw new Error("step11-recordedの固定Evidenceが不完全です");
  assertStoredStagingContentDigest(staging, "固定済みStep 11後");
  const journal = readWorkflowJournal(staging);
  if (journal.errors.length > 0)
    throw new Error(
      `Step 11 journalの再検証に失敗しました: ${journal.errors.join("; ")}`,
    );
  const matches = journal.entries.filter(
    (entry) =>
      entry.step === 11 && entry.recordedAt === current.step11?.recordedAt,
  );
  if (matches.length !== 1)
    throw new Error("固定済みStep 11 entryが実journalに一意に存在しません");
  const entry = matches[0]!;
  if (
    !entry.artifacts.includes(current.pr.url) ||
    !entry.artifacts.includes(DELIVERY_STATE_FILE) ||
    !entry.evidence.includes(current.step11.evidenceId) ||
    !entry.evidence.includes(`outcome=${current.step11.outcome}`)
  )
    throw new Error("固定済みStep 11がPRまたは終端Evidenceと一致しません");
  if (
    (current.step11.outcome === "merged" &&
      current.step11.evidenceId !==
        current.merge?.observation?.observationId) ||
    (current.step11.outcome === "pull-request" &&
      (current.merge !== null ||
        current.step11.evidenceId !==
          pullRequestTerminalEvidenceId(current.create, current.pr)))
  )
    throw new Error("固定済みStep 11のoutcomeとdelivery stateが一致しません");
  const digest = crypto
    .createHash("sha256")
    .update(journal.source)
    .digest("hex");
  if (digest !== current.step11.journalDigest)
    throw new Error(
      "固定済みStep 11 journal digestが現在のjournalと一致しません",
    );
}

type PullRequestMergeMethod = "merge" | "squash" | "rebase";

function deliveryEventTime(lowerBound?: string): string {
  const now = new Date().toISOString();
  return lowerBound && now < lowerBound ? lowerBound : now;
}

/**
 * H_finalはreview artifactだけを加えた単一親commitでなければならない。
 * merge認可ではcurrent HEAD authorではなく、その親H_implのprovider authorを使う。
 */
interface MergeCandidateEvidence {
  implementationCommitSha: string;
  finalHeadSha: string;
  reviewArtifactPath: string;
  reviewArtifactDigest: string;
}

interface MergeReviewEvidence extends MergeCandidateEvidence {
  ciRunId: string;
  reviewId: string;
  reviewEvidenceId: string;
}

/**
 * GitHub review履歴は現在状態の一覧ではなくevent列である。古いAPPROVEDを後続の
 * CHANGES_REQUESTED/DISMISSEDより先に拾うと失効reviewを固定できるため、全eventを
 * 検証したうえでactorごとの最新の承認状態変更eventだけを候補にする。COMMENTEDと
 * 未提出draftのPENDINGはapproval状態を変更しない。
 */
function currentIndependentApprovals(input: {
  approvals: readonly ApprovalObservation[];
  headSha: string;
  prAuthorActorId: string | undefined;
  implementationAuthorActorId: string | undefined;
}): ApprovalObservation[] {
  if (
    typeof input.prAuthorActorId !== "string" ||
    input.prAuthorActorId === "" ||
    typeof input.implementationAuthorActorId !== "string" ||
    input.implementationAuthorActorId === ""
  )
    throw new Error(
      "PR authorとimplementation authorのstable ID観測がありません",
    );
  const latestByActor = new Map<string, ApprovalObservation>();
  const byReviewId = new Map<string, ApprovalObservation>();
  for (const approval of input.approvals) {
    if (approval.state === "PENDING") continue;
    const submittedAt = approval.submittedAt;
    const timestamp =
      typeof submittedAt === "string" ? Date.parse(submittedAt) : Number.NaN;
    if (
      typeof approval.actorId !== "string" ||
      approval.actorId === "" ||
      typeof approval.state !== "string" ||
      approval.state === "" ||
      !/^[a-f0-9]{40}$/iu.test(approval.commitSha ?? "") ||
      typeof submittedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(
        submittedAt,
      ) ||
      !Number.isFinite(timestamp) ||
      typeof approval.reviewId !== "string" ||
      !/^[1-9]\d*$/u.test(approval.reviewId)
    )
      throw new Error("provider review履歴のidentityまたは時系列が不正です");
    const sameId = byReviewId.get(approval.reviewId);
    if (
      sameId &&
      (sameId.actorId !== approval.actorId ||
        sameId.state !== approval.state ||
        sameId.commitSha !== approval.commitSha ||
        sameId.submittedAt !== approval.submittedAt)
    )
      throw new Error("provider review履歴で同じreview IDが矛盾しています");
    if (!sameId) byReviewId.set(approval.reviewId, approval);
    if (approval.state === "COMMENTED") continue;
    const current = latestByActor.get(approval.actorId);
    if (!current) {
      latestByActor.set(approval.actorId, approval);
      continue;
    }
    const currentTimestamp = Date.parse(current.submittedAt ?? "");
    if (
      timestamp > currentTimestamp ||
      (timestamp === currentTimestamp &&
        approval.reviewId.localeCompare(current.reviewId ?? "", "en", {
          numeric: true,
        }) > 0)
    )
      latestByActor.set(approval.actorId, approval);
  }
  return [...latestByActor.values()]
    .filter(
      (approval) =>
        approval.state === "APPROVED" &&
        approval.commitSha === input.headSha &&
        approval.actorId !== input.prAuthorActorId &&
        approval.actorId !== input.implementationAuthorActorId,
    )
    .sort((left, right) =>
      left.reviewId!.localeCompare(right.reviewId!, "en", { numeric: true }),
    );
}

function resolveImplementationCommitForMerge(
  root: string,
  finalHeadSha: string,
): MergeCandidateEvidence {
  const localHead = git(["rev-parse", "--verify", "HEAD^{commit}"], root)
    .stdout.trim()
    .toLowerCase();
  if (localHead !== finalHeadSha.toLowerCase())
    throw new Error(
      "merge認可のlocal HEADがproviderのcurrent H_finalと一致しません",
    );
  const ancestry = git(["rev-list", "--parents", "-n", "1", finalHeadSha], root)
    .stdout.trim()
    .split(/\s+/u);
  if (ancestry.length !== 2 || ancestry[0]?.toLowerCase() !== localHead)
    throw new Error(
      "H_finalはreview artifactだけを加えた単一親commitでなければなりません",
    );
  const implementationCommitSha = ancestry[1]!.toLowerCase();
  const changedPaths = git(
    [
      "diff",
      "--name-only",
      "-z",
      `${implementationCommitSha}..${finalHeadSha}`,
      "--",
    ],
    root,
  )
    .stdout.split("\0")
    .filter(Boolean);
  if (
    changedPaths.length !== 1 ||
    !(
      changedPaths[0]!.startsWith("docs/reviews/") ||
      changedPaths[0]!.startsWith(".agent-skill-chain/reviews/")
    )
  )
    throw new Error(
      "H_impl..H_finalは許可されたreview artifact 1件だけでなければなりません",
    );
  const reviewArtifactPath = changedPaths[0]!;
  const artifactContent = git(
    ["show", `${finalHeadSha}:${reviewArtifactPath}`],
    root,
  ).stdout;
  return {
    implementationCommitSha,
    finalHeadSha: finalHeadSha.toLowerCase(),
    reviewArtifactPath,
    reviewArtifactDigest: crypto
      .createHash("sha256")
      .update(artifactContent)
      .digest("hex"),
  };
}

function observeMergeReviewEvidence(input: {
  root: string;
  repository: string;
  pr: number;
  state: DeliveryState;
  observed: PullRequestInspection;
}): {
  reviewEvidence: MergeReviewEvidence;
  approvals: ApprovalObservation[];
  implementationAuthorActorId: string | undefined;
} {
  if (typeof input.observed.headRefOid !== "string")
    throw new Error("PR HEAD SHAが不正です");
  const candidate = resolveImplementationCommitForMerge(
    input.root,
    input.observed.headRefOid,
  );
  const implementation = github(
    "commit.inspect",
    {
      repository: input.repository,
      sha: candidate.implementationCommitSha,
    },
    input.root,
  );
  if (implementation.sha !== candidate.implementationCommitSha)
    throw new Error("実装commitのtrusted観測がH_implと一致しません");
  const approvals = github(
    "pr.reviews",
    { repository: input.repository, pr: input.pr },
    input.root,
  );
  const ci = github(
    "pr.ci-runs",
    {
      repository: input.repository,
      pr: input.pr,
      headSha: input.observed.headRefOid,
    },
    input.root,
  )
    .filter(
      (run) =>
        run.repository.toLowerCase() === input.repository.toLowerCase() &&
        /^[1-9]\d*$/u.test(run.runId) &&
        run.event === "pull_request" &&
        run.headSha === input.observed.headRefOid &&
        run.conclusion === "success" &&
        run.pullRequestNumbers.length === 1 &&
        run.pullRequestNumbers[0] === input.pr,
    )
    .sort((left, right) =>
      left.runId.localeCompare(right.runId, "en", { numeric: true }),
    )[0];
  if (!ci)
    throw new Error(
      "current H_finalと対象PRへ直接関連するsuccessful pull_request CI runがありません",
    );
  const independentReview = currentIndependentApprovals({
    approvals,
    headSha: input.observed.headRefOid,
    prAuthorActorId: input.observed.author?.id,
    implementationAuthorActorId: implementation.authorActorId,
  })[0];
  if (!independentReview?.reviewId)
    throw new Error(
      "current H_finalに対するPR author・H_impl authorと独立したreviewがありません",
    );
  const identity = {
    domain: "agent-skill-chain/merge-review-evidence/v1",
    repository: input.state.create.repository,
    prNumber: input.state.pr!.number,
    finalHeadSha: candidate.finalHeadSha,
    implementationCommitSha: candidate.implementationCommitSha,
    reviewArtifactPath: candidate.reviewArtifactPath,
    reviewArtifactDigest: candidate.reviewArtifactDigest,
    ciRunId: ci.runId,
    reviewId: independentReview.reviewId,
  };
  return {
    reviewEvidence: {
      ...candidate,
      ciRunId: ci.runId,
      reviewId: independentReview.reviewId,
      reviewEvidenceId: canonicalDigest(identity),
    },
    approvals,
    implementationAuthorActorId: implementation.authorActorId,
  };
}

function assertFixedMergeReviewEvidence(
  state: DeliveryState,
  evidence: MergeReviewEvidence,
): void {
  const intent = state.merge;
  if (!intent)
    throw new Error("固定review Evidenceの照合対象merge intentがありません");
  if (
    intent.implementationCommitSha !== evidence.implementationCommitSha ||
    intent.reviewArtifactPath !== evidence.reviewArtifactPath ||
    intent.reviewArtifactDigest !== evidence.reviewArtifactDigest ||
    intent.ciRunId !== evidence.ciRunId ||
    intent.reviewId !== evidence.reviewId ||
    intent.reviewEvidenceId !== evidence.reviewEvidenceId
  )
    throw new Error(
      "current provider review Evidenceが固定済みmerge review identityと一致しません",
    );
}

function inspectAuthorizedPullRequestMerge(input: {
  root: string;
  staging: string;
  repository: string;
  pr: number;
  method: PullRequestMergeMethod;
  base: string;
  state: DeliveryState;
  tracker: string | null;
  trustedSet: ReturnType<typeof loadEffectiveTrustedPolicySet>;
  allowMerged?: boolean;
}): {
  observed: PullRequestInspection;
  authority: PolicyAuthorityObservation;
  implementationCommitSha: string;
  reviewEvidence: MergeReviewEvidence;
  authorization: ReturnType<typeof authorizeMerge>;
} {
  const observed = github(
    "pr.inspect",
    { repository: input.repository, pr: input.pr },
    input.root,
  );
  if (observed.number !== input.pr)
    throw new Error("PR観測の番号が固定済みPRと一致しません");
  assertBoundPullRequestObservation({
    staging: input.staging,
    state: input.state,
    observed,
    tracker: input.tracker,
  });
  if (observed.baseRefName !== input.base)
    throw new Error("PRの基点が検証済み既定ブランチではありません");
  const authority = github(
    "policy.authority",
    { repository: input.repository, pr: input.pr },
    input.root,
  );
  const trustedCommitSha = input.trustedSet.provenance?.commitSha;
  if (
    typeof trustedCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(trustedCommitSha) ||
    authority.repository !== input.repository ||
    authority.prNumber !== input.pr ||
    authority.defaultBranch !== input.base ||
    authority.baseRefName !== input.base ||
    authority.defaultBranchTipOid !== authority.baseRefOid ||
    authority.baseRefOid !== observed.baseRefOid ||
    authority.headRefOid !== observed.headRefOid ||
    authority.defaultBranchTipOid !== trustedCommitSha
  )
    throw new Error(
      "provider authorityのrepository・既定branch・base・headがtrusted policy setと一致しません",
    );
  const protection = github(
    "branch.protection",
    { repository: input.repository, branch: input.base },
    input.root,
  );
  const checks = (observed.statusCheckRollup ?? [])
    .filter(
      (item) => (item.conclusion ?? item.state ?? item.status) === "SUCCESS",
    )
    .map((item) => item.name ?? item.context)
    .filter((item): item is string => typeof item === "string");
  const reviewed = observeMergeReviewEvidence({
    root: input.root,
    repository: input.repository,
    pr: input.pr,
    state: input.state,
    observed,
  });
  return {
    observed,
    authority,
    implementationCommitSha: reviewed.reviewEvidence.implementationCommitSha,
    reviewEvidence: reviewed.reviewEvidence,
    authorization: authorizeMerge({
      trustedPolicy: input.trustedSet.policy,
      method: input.method,
      checks,
      approvals: reviewed.approvals,
      headSha: observed.headRefOid,
      prAuthorActorId: observed.author?.id,
      implementationAuthorActorId: reviewed.implementationAuthorActorId,
      branch: observed.headRefName ?? "",
      baseRef: observed.baseRefName ?? "",
      headRef: observed.headRefName ?? "",
      repositoryVerified: true,
      shaVerified: Boolean(observed.headRefOid && observed.baseRefOid),
      protectionVerified: protection.known && protection.protected,
      mergeableVerified:
        (input.allowMerged === true &&
          String(observed.state ?? "").toUpperCase() === "MERGED") ||
        (observed.isDraft === false && observed.mergeStateStatus === "CLEAN"),
    }),
  };
}

function assertTerminalMergeProof(input: {
  state: DeliveryState;
  observation: Omit<MergeObservation, "observationId">;
  topology: CommitTopologyObservation;
  expectedTreeSha: string;
  sourceCommitCount: number;
  rebaseTopologies?: readonly CommitTopologyObservation[];
  defaultBranchTip: string;
  ancestry: CommitAncestryObservation;
  authorizedBaseAncestry?: CommitAncestryObservation;
}): void {
  const intent = input.state.merge;
  const claim = intent?.dispatchClaimedAt;
  if (!intent || !claim)
    throw new Error("merged終端には消費済みdispatch claimが必要です");
  if (
    input.observation.providerState !== "merged" ||
    !input.observation.providerMergedAt ||
    !input.observation.mergeCommitSha
  )
    throw new Error("merged終端のprovider observationが不完全です");
  if (
    input.topology.repository.toLowerCase() !==
      input.state.create.repository.toLowerCase() ||
    input.topology.sha !== input.observation.mergeCommitSha
  )
    throw new Error(
      "merge commit topologyが固定repository・merge SHAと不一致です",
    );
  if (input.topology.treeSha !== input.expectedTreeSha)
    throw new Error(
      "merge commit treeが固定済みbase/headから決定した期待treeと一致しません",
    );
  if (
    input.ancestry.repository.toLowerCase() !==
      input.state.create.repository.toLowerCase() ||
    input.ancestry.ancestorSha !== input.topology.sha ||
    input.ancestry.descendantSha !== input.defaultBranchTip ||
    !input.ancestry.isAncestor
  )
    throw new Error(
      "merge commitがprovider既定branch tipのancestorであることを確認できません",
    );

  const request = input.observation.providerRequest;
  const terminalBaseSha =
    request?.kind === "merge-queue"
      ? request.baseSha
      : intent.authorizedBaseSha;
  if (request) {
    if (
      request.headSha !== intent.authorizedHeadSha ||
      request.baseSha !== intent.authorizedBaseSha
    )
      throw new Error(
        "provider requestがdispatch claimまたは固定head/baseと不一致です",
      );
    if (request.kind === "auto-merge" && request.method !== intent.method)
      throw new Error("auto-merge methodが固定intentと一致しません");
  }

  const parents = input.topology.parentShas;
  if (intent.method === "merge") {
    if (
      parents.length !== 2 ||
      parents[0] !== terminalBaseSha ||
      parents[1] !== intent.authorizedHeadSha
    )
      throw new Error(
        "merge commitの親が固定済みbase/head認可tupleと一致しません",
      );
    return;
  }
  // GitHub may remove auto-merge/queue request objects before the first
  // read-back when the PR merges immediately. In that terminal state the
  // durable ASC dispatch claim, provider mergedAt/mergeCommit, exact expected
  // tree, commit topology and default-branch ancestry form the reproducible
  // proof. A request object strengthens the proof when it remains observable,
  // but must not make an already completed merge permanently unrecoverable.
  if (intent.method === "squash") {
    if (parents.length !== 1 || parents[0] !== terminalBaseSha)
      throw new Error("squash commitの親が終端検証base SHAと一致しません");
    return;
  }
  const rebaseTopologies = input.rebaseTopologies ?? [];
  if (rebaseTopologies.length !== input.sourceCommitCount)
    throw new Error("rebase終端のcommit数が固定source historyと一致しません");
  let expectedCommit = input.topology.sha;
  for (const observed of rebaseTopologies) {
    if (
      observed.repository.toLowerCase() !==
        input.state.create.repository.toLowerCase() ||
      observed.sha !== expectedCommit ||
      observed.parentShas.length !== 1
    )
      throw new Error("rebase終端が固定件数の1-parent線形chainではありません");
    expectedCommit = observed.parentShas[0]!;
  }
  if (expectedCommit !== terminalBaseSha)
    throw new Error(
      "rebase終端chainのfirst parentが終端検証baseと一致しません",
    );
  const baseAncestry = input.authorizedBaseAncestry;
  if (
    !baseAncestry ||
    baseAncestry.repository.toLowerCase() !==
      input.state.create.repository.toLowerCase() ||
    baseAncestry.ancestorSha !== intent.authorizedBaseSha ||
    baseAncestry.descendantSha !== input.topology.sha ||
    !baseAncestry.isAncestor
  )
    throw new Error(
      "rebase終端で固定済み認可baseからmerge commitへのancestryを確認できません",
    );
}

/**
 * The immutable authorized base/head tuple fixes the source history. For
 * squash/rebase, reject merge commits before the provider side effect so a
 * one-parent result has an unambiguous source commit count. When N=1, squash
 * and rebase intentionally share the same result invariant; commit metadata
 * is not part of the terminal contract for this short-lived-branch case.
 */
function fixedMergeSourceCommitCount(input: {
  root: string;
  method: PullRequestMergeMethod;
  baseSha: string;
  headSha: string;
}): number {
  const source = git(
    [
      "rev-list",
      "--reverse",
      "--parents",
      "--no-abbrev-commit",
      `${input.baseSha}..${input.headSha}`,
    ],
    input.root,
    {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_OPTIONAL_LOCKS: "0",
      },
    },
  ).stdout.trim();
  const lines = source === "" ? [] : source.split("\n");
  if (lines.length === 0 || lines.length > 256)
    throw new Error("merge対象source commit数は1〜256件でなければなりません");
  let expectedParent = input.baseSha;
  for (const line of lines) {
    const [commit, ...parents] = line.trim().split(/\s+/u);
    if (!commit || !/^[a-f0-9]{40}$/u.test(commit))
      throw new Error("merge対象source historyのcommit SHAが不正です");
    if (input.method !== "merge") {
      if (parents.length !== 1 || parents[0] !== expectedParent)
        throw new Error(
          "squash/rebase対象source historyは固定baseからの線形chainが必要です",
        );
      expectedParent = commit;
    }
  }
  if (input.method !== "merge" && expectedParent !== input.headSha)
    throw new Error("merge対象source historyの終端が固定HEADと一致しません");
  return lines.length;
}

function expectedMergeResultTree(
  root: string,
  state: DeliveryState,
  observation: Omit<MergeObservation, "observationId">,
): string {
  const intent = state.merge;
  if (!intent) throw new Error("期待merge treeの固定intentがありません");
  assertMinimumExecutableVersion(
    "git",
    ["--version"],
    root,
    MINIMUM_GIT_VERSION,
  );
  const baseSha =
    observation.providerRequest?.kind === "merge-queue"
      ? observation.providerRequest.baseSha
      : intent.authorizedBaseSha;
  const source = git(
    ["merge-tree", "--write-tree", baseSha, intent.authorizedHeadSha],
    root,
  ).stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(source))
    throw new Error(
      "固定済みbase/headから期待merge treeを一意に計算できません",
    );
  return source;
}

function readBackPreparedPullRequestMerge(input: {
  root: string;
  staging: string;
  repository: string;
  pr: number;
  state: DeliveryState;
  tracker: string | null;
  mode: Mode;
  apply: boolean;
}): { exitCode: number; output: Record<string, unknown> } {
  try {
    if (!input.state.merge)
      throw new Error("provider read-backより前のmerge intentがありません");
    let observed = github(
      "pr.inspect",
      { repository: input.repository, pr: input.pr },
      input.root,
    );
    const merged = String(observed.state ?? "").toUpperCase() === "MERGED";
    if (merged) {
      assertBoundPullRequestObservation({
        staging: input.staging,
        state: input.state,
        observed,
        tracker: input.tracker,
      });
      const reviewed = observeMergeReviewEvidence({
        root: input.root,
        repository: input.repository,
        pr: input.pr,
        state: input.state,
        observed,
      });
      assertFixedMergeReviewEvidence(input.state, reviewed.reviewEvidence);
    } else {
      const base = defaultBranch(input.root);
      const trustedSet = loadEffectiveTrustedPolicySet(input.root, base);
      const inspected = inspectAuthorizedPullRequestMerge({
        root: input.root,
        staging: input.staging,
        repository: input.repository,
        pr: input.pr,
        method: input.state.merge.method,
        base,
        state: input.state,
        tracker: input.tracker,
        trustedSet,
      });
      if (!inspected.authorization.allowed)
        throw new Error(
          `provider read-back時のcurrent authority再認可を拒否しました: ${inspected.authorization.reason}`,
        );
      if (
        input.state.merge.implementationCommitSha !==
        inspected.implementationCommitSha
      )
        throw new Error("provider read-back時に固定H_implが変化しました");
      assertFixedMergeReviewEvidence(input.state, inspected.reviewEvidence);
      observed = inspected.observed;
    }
    const queue =
      String(observed.state ?? "").toUpperCase() !== "MERGED" &&
      !isRecord(observed.autoMergeRequest)
        ? github(
            "pr.queue",
            { repository: input.repository, pr: input.pr },
            input.root,
          )
        : undefined;
    const merge = mergeObservationFromProvider({
      staging: input.staging,
      state: input.state,
      observed,
      queue,
      tracker: input.tracker,
      observedAt: deliveryEventTime(input.state.merge?.preparedAt),
    });
    if (merge.providerState === "merged") {
      const topology = github(
        "commit.topology",
        { repository: input.repository, sha: merge.mergeCommitSha! },
        input.root,
      );
      const repositoryAuthority = github(
        "repository.authority",
        { repository: input.repository },
        input.root,
      );
      if (repositoryAuthority.defaultBranch !== input.state.create.baseRef)
        throw new Error(
          "merged終端のprovider既定branchが固定base refと一致しません",
        );
      const ancestry = github(
        "commit.ancestry",
        {
          repository: input.repository,
          sha: merge.mergeCommitSha!,
          descendantSha: repositoryAuthority.defaultBranchTipOid,
        },
        input.root,
      );
      const authorizedBaseAncestry =
        input.state.merge.method === "rebase"
          ? github(
              "commit.ancestry",
              {
                repository: input.repository,
                sha: input.state.merge.authorizedBaseSha,
                descendantSha: merge.mergeCommitSha!,
              },
              input.root,
            )
          : undefined;
      const sourceCommitCount = fixedMergeSourceCommitCount({
        root: input.root,
        method: input.state.merge.method,
        baseSha: input.state.merge.authorizedBaseSha,
        headSha: input.state.merge.authorizedHeadSha,
      });
      const rebaseTopologies: CommitTopologyObservation[] = [];
      if (input.state.merge.method === "rebase") {
        let current = topology;
        for (let index = 0; index < sourceCommitCount; index += 1) {
          rebaseTopologies.push(current);
          if (current.parentShas.length !== 1) break;
          if (index + 1 < sourceCommitCount)
            current = github(
              "commit.topology",
              {
                repository: input.repository,
                sha: current.parentShas[0]!,
              },
              input.root,
            );
        }
      }
      assertTerminalMergeProof({
        state: input.state,
        observation: merge,
        topology,
        expectedTreeSha: expectedMergeResultTree(
          input.root,
          input.state,
          merge,
        ),
        sourceCommitCount,
        rebaseTopologies,
        defaultBranchTip: repositoryAuthority.defaultBranchTipOid,
        ancestry,
        authorizedBaseAncestry,
      });
    }
    if (merge.providerState === "merge-requested") {
      const persisted =
        input.apply && input.state.state !== "merge-observed"
          ? observeStoredMerge(input.staging, merge)
          : input.state;
      return {
        exitCode: 0,
        output: {
          state: input.apply ? "merge_pending" : "preview",
          url: input.state.pr?.url,
          observation: merge,
          deliveryState: persisted,
          next: "native auto-merge要求を再観測しました。pr mergeを再送せず、同じコマンドでmerged状態を後から再観測してください",
        },
      };
    }
    if (!input.apply)
      return {
        exitCode: 0,
        output: {
          state: "preview",
          operation: "record-observed-merge",
          observation: merge,
          deliveryState: input.state,
        },
      };
    const persisted = observeStoredMerge(input.staging, merge);
    return finishObservedMerge(input.staging, persisted, input.mode);
  } catch (error) {
    let retained = readStoredDeliveryState(input.staging) ?? input.state;
    if (
      input.apply &&
      (retained.state === "merge-prepared" ||
        retained.state === "merge-observed")
    )
      retained = requireStoredDeliveryReconciliation(input.staging, {
        phase: "merge",
        reason: `merge要求後のprovider照合に失敗したため再送を禁止した: ${error instanceof Error ? error.message : String(error)}`,
        enteredAt: deliveryEventTime(retained.merge?.preparedAt),
      });
    return {
      exitCode: 1,
      output: {
        state: input.apply ? "reconciliation_required" : "rejected",
        reason: error instanceof Error ? error.message : String(error),
        deliveryState: retained,
        next: "固定済みrepository・PR・HEAD・Issue・closing契約をproviderで照合してください。pr mergeは再実行しません",
      },
    };
  }
}

function retryPreparedMergeAfterConfirmedAbsence(input: {
  root: string;
  staging: string;
  repository: string;
  pr: number;
  method: PullRequestMergeMethod;
  state: DeliveryState;
  tracker: string | null;
  mode: Mode;
  apply: boolean;
}): { exitCode: number; output: Record<string, unknown> } {
  if (input.state.merge?.dispatchClaimedAt !== null)
    return readBackPreparedPullRequestMerge(input);
  let dispatchAttempted = false;
  try {
    const initialReadBack = github(
      "pr.inspect",
      { repository: input.repository, pr: input.pr },
      input.root,
    );
    assertBoundPullRequestObservation({
      staging: input.staging,
      state: input.state,
      observed: initialReadBack,
      tracker: input.tracker,
    });
    const initialQueue =
      String(initialReadBack.state ?? "").toUpperCase() !== "MERGED" &&
      !isRecord(initialReadBack.autoMergeRequest)
        ? github(
            "pr.queue",
            { repository: input.repository, pr: input.pr },
            input.root,
          )
        : undefined;
    if (
      String(initialReadBack.state ?? "").toUpperCase() === "MERGED" ||
      isRecord(initialReadBack.autoMergeRequest) ||
      initialQueue?.entry
    )
      return readBackPreparedPullRequestMerge(input);
    if (String(initialReadBack.state ?? "").toUpperCase() !== "OPEN")
      throw new Error(
        "provider上のPRがOPENでないためmerge要求不存在を確定できません",
      );
    if (!input.state.merge)
      throw new Error("再試行対象の固定merge intentがありません");

    const base = defaultBranch(input.root);
    const trustedSet = loadEffectiveTrustedPolicySet(input.root, base);
    const inspected = inspectAuthorizedPullRequestMerge({
      root: input.root,
      staging: input.staging,
      repository: input.repository,
      pr: input.pr,
      method: input.method,
      base,
      state: input.state,
      tracker: input.tracker,
      trustedSet,
    });
    if (!inspected.authorization.allowed)
      return {
        exitCode: 1,
        output: inspected.authorization.diagnostic
          ? (serializeDiagnostic(inspected.authorization) as Record<
              string,
              unknown
            >)
          : {
              state: "rejected",
              reason: inspected.authorization.reason,
              deliveryState: input.state,
            },
      };
    assertFixedMergeReviewEvidence(input.state, inspected.reviewEvidence);
    if (!input.apply)
      return {
        exitCode: 0,
        output: {
          state: "preview",
          operation: "retry-merge-after-confirmed-absence",
          pr: inspected.observed.url,
          headSha: inspected.observed.headRefOid,
          deliveryState: input.state,
        },
      };
    const rechecked = inspectAuthorizedPullRequestMerge({
      root: input.root,
      staging: input.staging,
      repository: input.repository,
      pr: input.pr,
      method: input.method,
      base,
      state: input.state,
      tracker: input.tracker,
      trustedSet,
    });
    if (
      !rechecked.authorization.allowed ||
      rechecked.observed.headRefOid !== inspected.observed.headRefOid ||
      rechecked.observed.baseRefOid !== inspected.observed.baseRefOid ||
      rechecked.observed.headRefName !== inspected.observed.headRefName ||
      rechecked.observed.baseRefName !== inspected.observed.baseRefName ||
      rechecked.observed.author?.id !== inspected.observed.author?.id ||
      rechecked.implementationCommitSha !== inspected.implementationCommitSha ||
      rechecked.reviewEvidence.reviewEvidenceId !==
        inspected.reviewEvidence.reviewEvidenceId ||
      !samePolicyAuthorityObservation(inspected.authority, rechecked.authority)
    )
      throw new Error(
        "merge intent再試行直前のidentityまたは認可が初回照合から変化しました",
      );
    if (
      typeof rechecked.observed.headRefOid !== "string" ||
      rechecked.observed.headRefOid !== input.state.merge.authorizedHeadSha
    )
      throw new Error(
        "merge intent再試行のHEADが固定済み認可HEADと一致しません",
      );
    const retryTrustedCommitSha = trustedSet.provenance?.commitSha;
    if (
      rechecked.authority.baseRefName !== input.state.merge.authorizedBaseRef ||
      rechecked.authority.baseRefOid !== input.state.merge.authorizedBaseSha ||
      retryTrustedCommitSha !== input.state.merge.trustedPolicyCommitSha ||
      rechecked.implementationCommitSha !==
        input.state.merge.implementationCommitSha ||
      rechecked.reviewEvidence.reviewEvidenceId !==
        input.state.merge.reviewEvidenceId
    )
      throw new Error(
        "merge intent再試行のbase・trusted policy・H_implが固定済み認可tupleと一致しません",
      );
    if (
      String(rechecked.observed.state ?? "").toUpperCase() === "MERGED" ||
      isRecord(rechecked.observed.autoMergeRequest)
    )
      return readBackPreparedPullRequestMerge(input);
    const recheckedQueue = github(
      "pr.queue",
      { repository: input.repository, pr: input.pr },
      input.root,
    );
    if (recheckedQueue.entry) return readBackPreparedPullRequestMerge(input);
    github(
      "repository.assert-write",
      { repository: input.repository },
      input.root,
    );
    assertMinimumExecutableVersion(
      "git",
      ["--version"],
      input.root,
      MINIMUM_GIT_VERSION,
    );
    assertMinimumExecutableVersion(
      "gh",
      ["--version"],
      input.root,
      MINIMUM_GH_VERSION,
    );
    const claimed = claimStoredMergeDispatch(
      input.staging,
      deliveryEventTime(input.state.merge.preparedAt),
    );
    if (!claimed.dispatchAllowed)
      return readBackPreparedPullRequestMerge({
        ...input,
        state: claimed.state,
      });
    dispatchAttempted = true;
    github(
      "pr.merge",
      {
        repository: input.repository,
        pr: input.pr,
        method: input.method,
        headSha: rechecked.observed.headRefOid,
      },
      input.root,
    );
    return readBackPreparedPullRequestMerge({ ...input, state: claimed.state });
  } catch (error) {
    const retained = dispatchAttempted
      ? requireStoredDeliveryReconciliation(input.staging, {
          phase: "merge",
          reason: `再試行したmerge provider呼び出しの成否を断定できないため以後の再送を禁止した: ${error instanceof Error ? error.message : String(error)}`,
          enteredAt: deliveryEventTime(input.state.merge?.preparedAt),
        })
      : input.state;
    return {
      exitCode: 1,
      output: {
        state: dispatchAttempted ? "reconciliation_required" : "rejected",
        reason: error instanceof Error ? error.message : String(error),
        deliveryState: retained,
        next: dispatchAttempted
          ? "providerのPR状態を照合してください。同じmerge要求は再送しません"
          : "固定済みmerge intentを保持したまま認可またはprovider状態を是正してください",
      },
    };
  }
}

function handlePullRequestMerge(flags: Flags): number {
  const apply = applyMode(flags);
  const root = path.resolve(
    typeof flags.root === "string" ? flags.root : process.cwd(),
  );
  const requestedStaging = resolveContained(root, required(flags, "staging"));
  const issuesRoot = path.join(root, ".agent-skill-chain", "tmp", "issues");
  if (path.dirname(path.resolve(requestedStaging)) !== issuesRoot)
    throw new Error(
      "pr mergeのstagingは対象rootの.agent-skill-chain/tmp/issues/直下が必要です",
    );
  const candidate = assertWorkflowStaging(requestedStaging);
  const earlyInspection = inspectWorkflowStaging(candidate);
  assertWorkflowMergeAllowed(earlyInspection.mode);

  const repository = required(flags, "repo");
  const prRaw = required(flags, "pr");
  if (!/^[1-9]\d*$/u.test(prRaw))
    throw new Error("--prは正の整数で指定してください");
  const pr = Number(prRaw);
  const rawMethod = required(flags, "method");
  if (rawMethod !== "merge" && rawMethod !== "squash" && rawMethod !== "rebase")
    throw new Error("--methodが不正です");
  const method: PullRequestMergeMethod = rawMethod;

  const initial = readStoredDeliveryState(candidate);
  if (!initial?.pr)
    throw new Error(
      "pr mergeにはpr createで永続化した固定済みdelivery stateが必要です",
    );
  const staging = resolvePullRequestStaging({
    root,
    staging: candidate,
    issue: initial.create.issue,
    repository,
  });
  assertImmutablePullRequestBinding(initial, {
    repository,
    issue: initial.create.issue,
    issueUrl: initial.create.issueUrl,
    prNumber: pr,
    prUrl: `https://github.com/${repository}/pull/${pr}`,
    headSha: initial.create.headSha,
  });
  if (initial.merge && initial.merge.method !== method)
    throw new Error("固定済みmerge intentのmethodを変更できません");

  if (initial.state === "step11-recorded") {
    assertRecordedStep11Evidence(staging, initial);
    const pullRequestTerminal = initial.step11?.outcome === "pull-request";
    print({
      state: pullRequestTerminal ? "pull_request_complete" : "merged",
      url: initial.pr.url,
      deliveryState: initial,
      next: pullRequestTerminal
        ? "このworkflowはPR停止点で完了済みです。mergeする場合はownerが別のdelivery判断を開始してください"
        : "固定済みmerge observationによるStep 11記録は完了しています",
    });
    return pullRequestTerminal ? 1 : 0;
  }
  const initialJournal = readWorkflowJournal(staging);
  const initialStep11 = initialJournal.entries.filter(
    (entry) => entry.step === 11,
  );
  if (
    initial.state === "merge-observed" &&
    initial.merge?.observation?.providerState === "merged" &&
    initialStep11.length > 0
  ) {
    assertStoredStagingContentDigest(staging, "merged終端journalからの復旧前");
    const recoveryInspection = inspectWorkflowStaging(staging, 11);
    if (
      initialJournal.errors.length > 0 ||
      initialStep11.length !== 1 ||
      !recoveryInspection.validation.valid
    )
      throw new Error(
        "merged終端のStep 11 journalからdelivery stateを安全に復旧できません",
      );
    if (!apply) {
      print({
        state: "preview",
        operation: "recover-merged-terminal-state",
        url: initial.pr.url,
        deliveryState: initial,
      });
      return 0;
    }
    const recovered = withStagingMutationLock(staging, () => {
      recoverPendingJournalTransaction(staging);
      assertStoredStagingContentDigest(
        staging,
        "merged終端journalからの復旧直前",
      );
      return finishObservedMerge(
        staging,
        readStoredDeliveryState(staging) ?? initial,
        recoveryInspection.mode,
      );
    });
    print(recovered.output);
    return recovered.exitCode;
  }

  const result = withStagingMutationLock(staging, () => {
    if (apply) recoverPendingJournalTransaction(staging);
    const workflowInspection = assertWorkflowReadyForDelivery(staging);
    assertWorkflowMergeAllowed(workflowInspection.mode);
    let stagingRecord = readStoredStagingRecord(staging);
    const current = readStoredDeliveryState(staging);
    if (!current?.pr)
      throw new Error("writer lock取得後に固定済みPR bindingを確認できません");
    assertImmutablePullRequestBinding(current, {
      repository,
      issue: current.create.issue,
      issueUrl: current.create.issueUrl,
      prNumber: pr,
      prUrl: `https://github.com/${repository}/pull/${pr}`,
      headSha: current.create.headSha,
    });
    const storedTracker = stagingRecord.tracker;
    const legacyTracker =
      typeof storedTracker === "string"
        ? /^#?([1-9]\d*)$/u.exec(storedTracker)
        : null;
    if (
      !(
        typeof storedTracker === "string" &&
        storedTracker.toLowerCase() === current.create.issueUrl.toLowerCase()
      ) &&
      Number(legacyTracker?.[1]) !== current.create.issue
    )
      throw new Error(
        "writer lock取得後のstaging trackerが固定済みdelivery Issueと一致しません",
      );
    // A dry-run must not rewrite a legacy tracker. Use the canonical Issue URL
    // already fixed in the delivery state as the read-only virtual migration.
    const deliveryTracker = current.create.issueUrl;
    if (apply) {
      stagingRecord = migrateLegacyStagingTrackerLocked(staging, {
        repository,
        issue: current.create.issue,
      });
    }
    if (current.merge && current.merge.method !== method)
      throw new Error("固定済みmerge intentのmethodを変更できません");

    if (current.state === "step11-recorded") {
      assertRecordedStep11Evidence(staging, current);
      if (current.step11?.outcome === "pull-request")
        return {
          exitCode: 1,
          output: {
            state: "pull_request_complete",
            url: current.pr.url,
            deliveryState: current,
            next: "このworkflowはPR停止点で完了済みです。mergeする場合はownerが別のdelivery判断を開始してください",
          },
        };
      return {
        exitCode: 0,
        output: {
          state: "merged",
          url: current.pr.url,
          deliveryState: current,
          next: "固定済みmerge observationによるStep 11記録は完了しています",
        },
      };
    }
    if (current.state === "merge-observed") {
      return readBackPreparedPullRequestMerge({
        root,
        staging,
        repository,
        pr,
        state: current,
        tracker: deliveryTracker,
        mode: workflowInspection.mode,
        apply,
      });
    }
    if (current.state === "merge-prepared")
      return retryPreparedMergeAfterConfirmedAbsence({
        root,
        staging,
        repository,
        pr,
        method,
        state: current,
        tracker: deliveryTracker,
        mode: workflowInspection.mode,
        apply,
      });
    if (
      current.state === "reconciliation-required" &&
      current.reconciliation?.phase === "merge"
    )
      return readBackPreparedPullRequestMerge({
        root,
        staging,
        repository,
        pr,
        state: current,
        tracker: deliveryTracker,
        mode: workflowInspection.mode,
        apply,
      });
    if (current.state !== "pr-bound")
      throw new Error(
        `${current.state}からmergeを開始できません。create照合を先に完了してください`,
      );

    const base = defaultBranch(root);
    const trustedSet = loadEffectiveTrustedPolicySet(root, base);
    const inspected = inspectAuthorizedPullRequestMerge({
      root,
      staging,
      repository,
      pr,
      method,
      base,
      state: current,
      tracker: deliveryTracker,
      trustedSet,
    });
    if (!inspected.authorization.allowed) {
      if (inspected.authorization.diagnostic) {
        return {
          exitCode: 1,
          output: serializeDiagnostic(inspected.authorization) as Record<
            string,
            unknown
          >,
        };
      }
      throw new Error(
        `マージを拒否しました: ${inspected.authorization.reason}`,
      );
    }
    if (!apply)
      return {
        exitCode: 0,
        output: {
          state: "preview",
          authorization: inspected.authorization,
          pr: inspected.observed.url,
          headSha: inspected.observed.headRefOid,
          baseSha: inspected.observed.baseRefOid,
          deliveryState: current,
        },
      };

    const rechecked = inspectAuthorizedPullRequestMerge({
      root,
      staging,
      repository,
      pr,
      method,
      base,
      state: current,
      tracker: deliveryTracker,
      trustedSet,
    });
    if (
      rechecked.observed.headRefOid !== inspected.observed.headRefOid ||
      rechecked.observed.baseRefOid !== inspected.observed.baseRefOid ||
      rechecked.observed.headRefName !== inspected.observed.headRefName ||
      rechecked.observed.baseRefName !== inspected.observed.baseRefName ||
      rechecked.observed.author?.id !== inspected.observed.author?.id ||
      rechecked.implementationCommitSha !== inspected.implementationCommitSha ||
      rechecked.reviewEvidence.reviewEvidenceId !==
        inspected.reviewEvidence.reviewEvidenceId ||
      !samePolicyAuthorityObservation(inspected.authority, rechecked.authority)
    )
      throw new Error("マージ直前にPR identityが変化しました（TOCTOU）");
    if (!rechecked.authorization.allowed) {
      if (rechecked.authorization.diagnostic)
        return {
          exitCode: 1,
          output: serializeDiagnostic(rechecked.authorization) as Record<
            string,
            unknown
          >,
        };
      throw new Error(
        `マージ直前の再認可を拒否しました: ${rechecked.authorization.reason}`,
      );
    }
    if (typeof rechecked.observed.headRefOid !== "string")
      throw new Error("merge要求前に固定HEADを確認できません");

    if (
      String(rechecked.observed.state ?? "").toUpperCase() === "MERGED" ||
      isRecord(rechecked.observed.autoMergeRequest)
    )
      throw new Error(
        "ASC merge intent作成前にprovider上の既存merge要求またはmerged状態を観測しました",
      );
    const existingQueue = github("pr.queue", { repository, pr }, root);
    if (existingQueue.entry)
      throw new Error(
        "ASC merge intent作成前にprovider上の既存merge queue entryを観測しました",
      );

    github("repository.assert-write", { repository }, root);
    assertMinimumExecutableVersion(
      "git",
      ["--version"],
      root,
      MINIMUM_GIT_VERSION,
    );
    assertMinimumExecutableVersion(
      "gh",
      ["--version"],
      root,
      MINIMUM_GH_VERSION,
    );
    fixedMergeSourceCommitCount({
      root,
      method,
      baseSha: rechecked.authority.baseRefOid,
      headSha: rechecked.observed.headRefOid,
    });

    const prepared = prepareStoredMergeIntent(staging, {
      method,
      authorizedHeadSha: rechecked.observed.headRefOid,
      authorizedBaseRef: rechecked.authority.baseRefName,
      authorizedBaseSha: rechecked.authority.baseRefOid,
      trustedPolicyCommitSha: rechecked.authority.defaultBranchTipOid,
      implementationCommitSha: rechecked.implementationCommitSha,
      reviewArtifactPath: rechecked.reviewEvidence.reviewArtifactPath,
      reviewArtifactDigest: rechecked.reviewEvidence.reviewArtifactDigest,
      ciRunId: rechecked.reviewEvidence.ciRunId,
      reviewId: rechecked.reviewEvidence.reviewId,
      reviewEvidenceId: rechecked.reviewEvidence.reviewEvidenceId,
      intentId: crypto.randomBytes(16).toString("hex"),
      preparedAt: deliveryEventTime(current.pr.boundAt),
    });
    if (!prepared.requestAllowed)
      return readBackPreparedPullRequestMerge({
        root,
        staging,
        repository,
        pr,
        state: prepared.state,
        tracker: deliveryTracker,
        mode: workflowInspection.mode,
        apply,
      });
    const claimed = claimStoredMergeDispatch(
      staging,
      deliveryEventTime(prepared.state.merge?.preparedAt),
    );
    if (!claimed.dispatchAllowed)
      return readBackPreparedPullRequestMerge({
        root,
        staging,
        repository,
        pr,
        state: claimed.state,
        tracker: deliveryTracker,
        mode: workflowInspection.mode,
        apply,
      });
    try {
      github(
        "pr.merge",
        {
          repository,
          pr,
          method,
          headSha: rechecked.observed.headRefOid,
        },
        root,
      );
    } catch (error) {
      const reconciled = requireStoredDeliveryReconciliation(staging, {
        phase: "merge",
        reason: `merge provider呼び出しの成否を断定できないため再送を禁止した: ${error instanceof Error ? error.message : String(error)}`,
        enteredAt: deliveryEventTime(prepared.state.merge?.preparedAt),
      });
      return {
        exitCode: 1,
        output: {
          state: "reconciliation_required",
          reason: error instanceof Error ? error.message : String(error),
          deliveryState: reconciled,
          next: "providerのPR状態を照合してください。同じmerge要求は再送しません",
        },
      };
    }
    return readBackPreparedPullRequestMerge({
      root,
      staging,
      repository,
      pr,
      state: claimed.state,
      tracker: stagingRecord.tracker,
      mode: workflowInspection.mode,
      apply,
    });
  });
  print(result.output);
  return result.exitCode;
}

function readJournalOverride(file: string): JournalHumanOverride {
  const value = readJsonInput(path.resolve(file));
  if (!isRecord(value)) throw new Error("workflow overrideはobjectが必要です");
  const allowed = new Set([
    "issue",
    "scope",
    "instructedBy",
    "instructedAt",
    "expiresAt",
    "reason",
  ]);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0)
    throw new Error(
      `workflow overrideの未知fieldを拒否しました: ${unknown.join(", ")}`,
    );
  if (typeof value.issue !== "number" || !Number.isInteger(value.issue))
    throw new Error("workflow override.issueは整数が必要です");
  for (const field of [
    "scope",
    "instructedBy",
    "instructedAt",
    "expiresAt",
    "reason",
  ] as const)
    if (typeof value[field] !== "string")
      throw new Error(`workflow override.${field}は文字列が必要です`);
  return {
    issue: value.issue,
    scope: value.scope as "workflow.pr.create",
    instructedBy: value.instructedBy as string,
    instructedAt: value.instructedAt as string,
    expiresAt: value.expiresAt as string,
    reason: value.reason as string,
  };
}

function parse(args: string[]): { flags: Flags; positionals: string[] } {
  const flags: Flags = {};
  const positionals: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) positionals.push(arg);
    else {
      const [rawKey, ...rest] = arg.slice(2).split("=");
      if (flags[rawKey] !== undefined)
        throw new Error(`オプションが重複しています: --${rawKey}`);
      flags[rawKey] = rest.length ? rest.join("=") : true;
    }
  }
  return { flags, positionals };
}

function required(flags: Flags, key: string): string {
  const value = flags[key];
  if (typeof value !== "string" || value === "")
    throw new Error(`--${key}=...が必要です`);
  return value;
}

function requiredExpectedRevision(flags: Flags): number {
  const raw = required(flags, "expected-revision");
  if (!/^\d+$/.test(raw))
    throw new Error("--expected-revisionは0以上の整数でなければなりません");
  return Number(raw);
}

function hygieneOperations(flags: Flags): HygieneKind[] {
  const raw = required(flags, "operations");
  const operations: HygieneKind[] = [];
  const seen = new Set<string>();
  for (const item of raw.split(",")) {
    let operation: HygieneKind;
    if (item === "empty-directory") operation = item;
    else if (item === "temporary-artifact") operation = item;
    else if (item === "completed-worktree-container") operation = item;
    else throw new Error(`未対応のworkspace hygiene operationです: ${item}`);
    if (seen.has(operation))
      throw new Error(
        `workspace hygiene operationが重複しています: ${operation}`,
      );
    seen.add(operation);
    operations.push(operation);
  }
  return operations;
}

function policyAuthorityFailure(
  status: "pending" | "rejected",
  reason: string,
) {
  return serializeDiagnostic({
    allowed: false,
    status,
    diagnostic: {
      ruleId:
        status === "pending"
          ? "ASC-POLICY-PROVIDER-001"
          : "ASC-POLICY-AUTHORITY-001",
      purpose: "PR policy authorityをtrusted provider観測へ拘束する",
      risk: "authority",
      reasons: [reason],
      scope: ["policy validate", "pull_request"],
      checks: ["repository、PR、default/base/head tupleを検証した"],
      autoFixes: [],
      next:
        status === "pending"
          ? "local安全結果を保持し、provider接続後に同じ固定commitで再実行してください"
          : "入力とtrusted provider観測の不一致を修正して再実行してください",
      requiredAuthority: "repository read",
      rollback: "policy適用や外部状態変更を行わない",
    },
  });
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(sanitizeOutput(value), null, 2)}\n`);
}
function isPolicySet(input: Policy | PolicySet): input is PolicySet {
  return "policy" in input;
}
function assembledPolicy(input: Policy | PolicySet): Policy {
  return isPolicySet(input) ? input.policy : input;
}

function printableMigration(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.artifacts)) return value;
  const artifacts = value.artifacts as unknown[];
  return {
    ...value,
    artifacts: artifacts.map((artifact) => {
      if (!isRecord(artifact)) return artifact;
      const { before: _before, after: _after, ...printable } = artifact;
      return printable;
    }),
  };
}

/**
 * `pr reanchor`と`review reanchor`の共通処理。
 *
 * **層の違いは`layer`だけである。** 判定と拒否条件はadapterが層ごとに決める。
 * dispatch側で分岐を複製しない。
 */
function dispatchEvidenceReanchor(
  input: {
    apply: boolean;
    root: string | undefined;
    staging: string;
    newHeadSha: string;
    newBaseSha: string;
    reason: string;
    layer: "delivery" | "review";
  },
  dependencies: { now?: () => Date },
): number {
  const { apply, staging, newHeadSha, newBaseSha, reason, layer } = input;
  const root = path.resolve(input.root ?? process.cwd());
  if (!apply) {
    print({
      state: "preview",
      layer,
      chainLength: readEvidenceReanchorChain(staging).length,
      newHeadSha,
      newBaseSha,
      next: "--applyで再固定を記録します",
    });
    return 0;
  }
  const result = appendEvidenceReanchor({
    staging,
    root,
    layer,
    newHeadSha,
    newBaseSha,
    reason,
    recordedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  });
  print({
    state: result.appended ? "reanchored" : "unchanged",
    layer,
    chainLength: result.chain.length,
    effectiveHeadSha: result.effectiveHeadSha,
  });
  return 0;
}

function applyMode(flags: Flags): boolean {
  if (flags.apply === true && flags["dry-run"] === true)
    throw new Error("--applyと--dry-runは同時に指定できません");
  if (flags.apply !== true && flags["dry-run"] !== true)
    throw new Error(
      "書き込み可能なコマンドには--dry-runまたは--applyが必要です",
    );
  return flags.apply === true;
}

/** Lifecycle operations are preview-only unless --apply is explicit. */
function lifecycleApplyMode(flags: Flags): boolean {
  if (flags.apply === true && flags["dry-run"] === true)
    throw new Error("--applyと--dry-runは同時に指定できません");
  return flags.apply === true;
}

function defaultBranch(root: string): string {
  const symbolic = git(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    root,
    { allowFailure: true },
  );
  if (symbolic.status === 0)
    return symbolic.stdout.trim().replace(/^origin\//, "");
  throw new Error("既定ブランチが不明です。origin/HEADを設定してください");
}

function cliRegisteredWorktrees(root: string): Array<{
  path: string;
  branch: string;
}> {
  const entries: Array<{ path: string; branch: string }> = [];
  let worktreePath: string | undefined;
  let branch: string | undefined;
  const flush = (): void => {
    if (worktreePath && branch) entries.push({ path: worktreePath, branch });
    worktreePath = undefined;
    branch = undefined;
  };
  const listed = git(["worktree", "list", "--porcelain"], root).stdout;
  for (const line of listed.split(/\r?\n/u)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) worktreePath = line.slice(9);
    if (line.startsWith("branch refs/heads/")) branch = line.slice(18);
  }
  flush();
  return entries;
}

function positiveIssueList(raw: string | boolean | undefined): number[] {
  if (raw === undefined) return [];
  if (typeof raw !== "string" || raw === "")
    throw new Error("--relatesは正のIssue番号をカンマ区切りで指定してください");
  const values = raw.split(",");
  if (values.some((value) => !/^[1-9]\d*$/u.test(value)))
    throw new Error("--relatesは正のIssue番号をカンマ区切りで指定してください");
  const issues = values.map(Number);
  if (new Set(issues).size !== issues.length)
    throw new Error("--relatesに同じIssue番号を重複して指定できません");
  return issues;
}

function registeredWorktrees(root: string): Array<{
  path: string;
  branch: string;
}> {
  const output = git(["worktree", "list", "--porcelain"], root).stdout;
  return output
    .trim()
    .split(/\r?\n\r?\n/u)
    .filter(Boolean)
    .flatMap((entry) => {
      const lines = entry.split(/\r?\n/u);
      const worktreeLine = lines.find((line) => line.startsWith("worktree "));
      const branchLine = lines.find((line) => line.startsWith("branch "));
      if (!worktreeLine) return [];
      return [
        {
          path: path.resolve(worktreeLine.slice("worktree ".length)),
          branch: branchLine?.slice("branch refs/heads/".length) ?? "",
        },
      ];
    });
}

function finalizeIgnoredPathAllowlist(root: string): string[] {
  const manifest = path.join(root, ".agent-skill-chain", "project-policy.json");
  if (!fs.existsSync(manifest)) return resolveFinalizeIgnoredPathAllowlist();
  const policy = loadProjectPolicySet(root).policy;
  return resolveFinalizeIgnoredPathAllowlist(
    policy.worktree?.finalizeIgnoredPathAllowlist,
  );
}

function collectWorktreeSurvey(root: string): WorktreeSurvey {
  const repositoryRoot = path.resolve(
    git(["rev-parse", "--show-toplevel"], root).stdout.trim(),
  );
  const registered = registeredWorktrees(repositoryRoot);
  const primaryRoot = registered[0]?.path;
  const remoteDefaultRef = `origin/${defaultBranch(repositoryRoot)}`;
  const ignoredPathAllowlist = finalizeIgnoredPathAllowlist(repositoryRoot);
  const observations: WorktreeObservation[] = [];
  const errors: string[] = [];
  const withoutUpstream = new Set<string>();
  for (const [index, worktree] of registered.entries()) {
    try {
      const isPrimary = index === 0 || worktree.path === primaryRoot;
      const status = git(
        [
          "--no-optional-locks",
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
        ],
        worktree.path,
      )
        .stdout.split(/\r?\n/u)
        .filter(Boolean);
      const upstream = git(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        worktree.path,
        { allowFailure: true },
      );
      const recovery = isPrimary
        ? {
            recoveryReachable: true,
            pushed: true,
            remoteBranch: true,
            reachableFromDefaultBranch: true,
          }
        : inspectRecoveryState(worktree.path);
      let unpushedCommits = 0;
      if (upstream.status === 0) {
        const count = git(
          [
            "rev-list",
            "--count",
            `${upstream.stdout.trim()}..${worktree.branch}`,
          ],
          worktree.path,
        ).stdout.trim();
        unpushedCommits = Number(count);
      } else withoutUpstream.add(worktree.path);
      const ignoredArtifacts = git(
        ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
        worktree.path,
      )
        .stdout.split("\0")
        .filter(Boolean);
      const stashes = git(["stash", "list"], worktree.path)
        .stdout.split(/\r?\n/u)
        .filter(Boolean);
      const merged = git(
        ["branch", "--merged", remoteDefaultRef, "--list", worktree.branch],
        repositoryRoot,
        { allowFailure: true },
      );
      if (merged.status !== 0)
        throw new Error(
          `既定branchへのmerge状態を確認できません: ${merged.stderr.trim()}`,
        );
      observations.push({
        repositoryRoot,
        path: worktree.path,
        branch: worktree.branch,
        isPrimary,
        mergedIntoDefault: merged.stdout.trim() !== "",
        dirty: status.some((line) => !line.startsWith("?? ")),
        untracked: status
          .filter((line) => line.startsWith("?? "))
          .map((line) => line.slice(3)),
        ignoredArtifacts,
        stashes,
        unpushedCommits,
        pushed: recovery.pushed,
        remoteBranch: recovery.remoteBranch,
        recoveryReachable: recovery.recoveryReachable,
        reachableFromDefaultBranch: recovery.reachableFromDefaultBranch,
      });
    } catch (error) {
      errors.push(
        `${worktree.path}: ${error instanceof Error ? error.message : "観測できません"}`,
      );
    }
  }
  const survey = surveyWorktrees(observations, ignoredPathAllowlist);
  for (const entry of survey.entries)
    if (entry.disposition === "retain" && withoutUpstream.has(entry.path))
      entry.reasons.push("upstreamが設定されていません");
  survey.errors.push(...errors);
  return survey;
}

function printWorktreeSurveyText(survey: WorktreeSurvey): void {
  const lines = [
    "worktree後片付け走査",
    "判定\tbranch\tpath\t理由",
    ...survey.entries.map(
      (entry) =>
        `${entry.disposition}\t${entry.branch}\t${entry.path}\t${entry.reasons.join("、")}`,
    ),
    `要約: 後片付け可能 ${survey.cleanupReady.length}件 / 保持 ${survey.retained.length}件 / 進行中 ${survey.inProgress.length}件`,
    ...survey.errors.map((error) => `走査error: ${error}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function observeRootUpdate(
  root: string,
  mergeSha: string,
): RootUpdateObservation {
  const actualRoot = path.resolve(
    git(["rev-parse", "--show-toplevel"], root).stdout.trim(),
  );
  const suppliedRoot = fs.realpathSync(root);
  const primaryRoot = registeredWorktrees(actualRoot)[0]?.path;
  const verifiedRootPath =
    fs.realpathSync(actualRoot) === suppliedRoot && primaryRoot === actualRoot
      ? suppliedRoot
      : "";
  const branch = git(["branch", "--show-current"], root).stdout.trim();
  const expectedDefault = defaultBranch(root);
  const status = git(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    root,
  )
    .stdout.split(/\r?\n/u)
    .filter(Boolean);
  const upstream = git(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    root,
    { allowFailure: true },
  );
  const upstreamSha =
    upstream.status === 0
      ? git(["rev-parse", "@{upstream}"], root, { allowFailure: true })
      : { status: 1, stdout: "" };
  const remote = git(
    ["ls-remote", "--exit-code", "origin", `refs/heads/${expectedDefault}`],
    root,
    { allowFailure: true },
  );
  const remoteSha =
    remote.status === 0 ? (remote.stdout.split(/\s/u)[0] ?? "") : "";
  const localSha = git(["rev-parse", "HEAD"], root).stdout.trim();
  const fastForward = git(
    ["merge-base", "--is-ancestor", localSha, mergeSha],
    root,
    { allowFailure: true },
  );
  return {
    rootPath: verifiedRootPath,
    currentBranch: branch,
    defaultBranch: expectedDefault,
    dirty: status.some((line) => !line.startsWith("?? ")),
    untracked: status
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3)),
    upstreamRef: upstream.status === 0 ? upstream.stdout.trim() : undefined,
    localSha,
    upstreamSha: upstreamSha.status === 0 ? upstreamSha.stdout.trim() : "",
    remoteSha,
    mergeSha,
    fastForwardable: fastForward.status === 0,
  };
}

function rootUpdateDiagnostic(
  plan: ReturnType<typeof planRootUpdate>,
): unknown {
  return {
    allowed: false,
    operation: "root.fast-forward",
    ...plan,
    diagnostic: {
      ruleId: "ASC-FINALIZE-ROOT-001",
      purpose: "merge済みroot mainを検証済みmerge SHAへ安全にfast-forwardする",
      risk: "worktree",
      reasons: plan.reasons,
      scope: ["worktree", "finalize", "root"],
      checks: [
        "root、branch、status、upstream、remote SHA、merge SHA、fast-forward可否を確認した",
      ],
      autoFixes: [],
      next: plan.recovery.join("。"),
      requiredAuthority: "repository maintainer",
      rollback: "root worktreeを変更せず対象worktreeを保持する",
    },
  };
}

function pathExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return false;
    throw error;
  }
}

function removeHygieneTarget(
  reportRoot: string,
  target: { path: string; kind: HygieneKind },
): void {
  const stat = fs.lstatSync(target.path);
  if (stat.isSymbolicLink())
    throw new Error(`削除直前にsymlinkを検出しました: ${target.path}`);
  const real = fs.realpathSync(target.path);
  const relative = path.relative(reportRoot, real);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`削除直前のcontainment検証に失敗しました: ${target.path}`);
  if (target.kind === "temporary-artifact") {
    if (!stat.isFile())
      throw new Error(`一時生成物が通常fileではありません: ${target.path}`);
    fs.rmSync(target.path);
    return;
  }
  if (!stat.isDirectory())
    throw new Error(`空directory候補の型が変化しました: ${target.path}`);
  fs.rmdirSync(target.path);
}

function removeStagingTarget(
  reportRoot: string,
  target: { path: string; relative: string },
): void {
  if (
    !/^\.agent-skill-chain\/tmp\/issues\/[^/]+$/u.test(target.relative) ||
    target.relative.includes("..")
  )
    throw new Error(`staging対象scopeが不正です: ${target.relative}`);
  const issuesRoot = path.join(
    reportRoot,
    ".agent-skill-chain",
    "tmp",
    "issues",
  );
  const expected = path.join(issuesRoot, path.basename(target.relative));
  if (target.path !== expected || path.dirname(target.path) !== issuesRoot)
    throw new Error(
      `staging対象がissues直下に完全一致しません: ${target.path}`,
    );
  const issuesStat = fs.lstatSync(issuesRoot);
  if (issuesStat.isSymbolicLink() || !issuesStat.isDirectory())
    throw new Error("staging issues rootが安全な通常directoryではありません");
  if (fs.realpathSync(issuesRoot) !== issuesRoot)
    throw new Error("staging issues rootにsymlink祖先があります");
  const targetStat = fs.lstatSync(target.path);
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory())
    throw new Error(`staging対象が通常directoryではありません: ${target.path}`);
  if (
    fs.realpathSync(target.path) !== target.path ||
    path.dirname(fs.realpathSync(target.path)) !== issuesRoot
  )
    throw new Error(
      `staging対象のroot containmentに失敗しました: ${target.path}`,
    );

  const verifyTree = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw new Error(`削除直前にsymlinkを検出しました: ${absolute}`);
      if (entry.name === ".git")
        throw new Error(`Git内部領域を検出しました: ${absolute}`);
      const real = fs.realpathSync(absolute);
      const relative = path.relative(target.path, real);
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new Error(`staging外へ解決される内容を検出しました: ${absolute}`);
      if (stat.isDirectory()) verifyTree(absolute);
      else if (!stat.isFile())
        throw new Error(`通常fileではない内容を検出しました: ${absolute}`);
    }
  };
  const removeTree = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw new Error(`削除直前にsymlinkへ変化しました: ${absolute}`);
      if (stat.isDirectory()) removeTree(absolute);
      else if (stat.isFile()) fs.rmSync(absolute);
      else throw new Error(`削除直前にfile種別が変化しました: ${absolute}`);
    }
    fs.rmdirSync(directory);
  };
  verifyTree(target.path);
  removeTree(target.path);
}

function stagingCleanupDiagnostic(reasons: string[]): unknown {
  return {
    ruleId: "ASC-STAGING-CLEANUP-001",
    purpose: "同期確認済みの一時stagingだけを承認済みpreviewに基づいて削除する",
    risk: "artifact",
    reasons,
    scope: [".agent-skill-chain/tmp/issues/", "issue staging"],
    checks: [
      "repository root、保持期間、同期証拠、成果物digest、fingerprint、report hashをapply直前に再確認した",
    ],
    autoFixes: [],
    next: "対象を保持し、同期証拠と現在内容を確認して新しいpreview hashを取得してください",
    requiredAuthority: "staging cleanup authorityと承認済みreport hash",
    rollback:
      "削除を開始せずstagingを保持する。部分失敗時はremovedとretainedを確認して新しいpreviewから再実行する",
  };
}

function completionRecovery(phases: CompletionPhaseResult[]): string[] {
  return [
    ...new Set(
      phases.flatMap((phase) => [
        ...phase.recovery,
        ...phase.reasons.filter((reason) => reason.trim() !== ""),
      ]),
    ),
  ];
}

function worktreeIdentitySnapshot(root: string, excludedPath: string): string {
  return JSON.stringify({
    branches: git(
      ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"],
      root,
    ).stdout,
    worktrees: registeredWorktrees(root)
      .filter((worktree) => worktree.path !== excludedPath)
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.branch.localeCompare(right.branch),
      ),
  });
}

function applyVerifiedRootUpdate(
  root: string,
  mergeSha: string,
): ReturnType<typeof planRootUpdate> {
  const initial = observeRootUpdate(root, mergeSha);
  const locallySafe =
    initial.rootPath.trim() !== "" &&
    initial.currentBranch === initial.defaultBranch &&
    !initial.dirty &&
    initial.untracked.length === 0 &&
    initial.upstreamRef !== undefined &&
    /^[a-f0-9]{40}$/iu.test(initial.mergeSha) &&
    initial.remoteSha === initial.mergeSha;
  if (locallySafe && initial.upstreamSha !== initial.remoteSha)
    git(
      [
        "fetch",
        "--no-tags",
        "origin",
        `refs/heads/${initial.defaultBranch}:refs/remotes/origin/${initial.defaultBranch}`,
      ],
      root,
    );
  const plan = planRootUpdate(observeRootUpdate(root, mergeSha));
  if (plan.state === "ready" && plan.from !== plan.to)
    git(["merge", "--ff-only", mergeSha], root);
  return plan;
}

function completionPostVerify(input: {
  phases: CompletionPhaseResult[];
  root: string;
  mergeSha: string;
  target: string;
  otherWorktreesBefore: string;
  containerState: "removed" | "retained" | "absent";
}) {
  const rootSha = git(["rev-parse", "HEAD"], input.root).stdout.trim();
  return summarizeCompletion({
    phases: input.phases,
    postVerify: {
      rootSha,
      expectedRootSha: input.mergeSha,
      targetPathAbsent: !pathExists(input.target),
      otherWorktreesUnchanged:
        worktreeIdentitySnapshot(input.root, input.target) ===
        input.otherWorktreesBefore,
      containerState: input.containerState,
    },
  });
}

function cleanupEmptyWorktreeContainer(root: string): {
  state: "removed" | "retained" | "absent";
  failure?: string;
} {
  const container = path.join(root, ".worktrees");
  if (!pathExists(container)) return { state: "absent" };
  try {
    const hygiene = previewWorkspaceHygiene({ root });
    if (
      !hygiene.candidates.some(
        (candidate) =>
          candidate.relative === ".worktrees" &&
          candidate.kind === "completed-worktree-container",
      )
    )
      return { state: "retained" };
    applyWorkspaceHygiene(
      {
        report: hygiene,
        approvedHash: hygiene.hash,
        root,
        operations: ["completed-worktree-container"],
        paths: [".worktrees"],
      },
      (candidate) => removeHygieneTarget(hygiene.root, candidate),
    );
    return { state: pathExists(container) ? "retained" : "removed" };
  } catch (error) {
    return {
      state: "retained",
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 完了処理で使う入力は呼び出し元が明示的に渡す。
 *
 * 以前は`flags`から`merge-sha`・`approved-digest`・`cleanup-authority`をこの関数の中で
 * 掘り出していた。`scripts/check_cli_usage.ts`はdispatch blockの中しか走査しないため、
 * **3つのflagがusage契約の検査から不可視になり、usage正本が宣言しないまま実装だけが
 * 読む状態が残っていた**（Issue #1097）。明示的な入力にして検査へ露出させる。
 */
function executeCompletionFlow(input: {
  apply: boolean;
  root: string;
  target: string;
  evidence: ReturnType<typeof readFinalizeEvidence>;
  mergeSha: string;
  approvedDigest: string;
  cleanupAuthorityGranted: boolean;
  authorized: boolean;
}): number {
  const {
    apply,
    root,
    target,
    evidence,
    mergeSha,
    approvedDigest,
    cleanupAuthorityGranted,
    authorized,
  } = input;
  const ignoredPathAllowlist = finalizeIgnoredPathAllowlist(root);
  const initialRootObservation = observeRootUpdate(root, mergeSha);
  const initialRootPlan = planRootUpdate(initialRootObservation);
  const targetPresent = pathExists(target);
  const initialState = targetPresent
    ? inspectFinalizeState(root, target, evidence, ignoredPathAllowlist)
    : undefined;
  const projectedState = initialState
    ? {
        ...initialState,
        ...(evidence.base === initialRootObservation.defaultBranch ||
        evidence.base === initialRootObservation.upstreamRef
          ? { baseSha: mergeSha }
          : {}),
      }
    : undefined;
  const report = projectedState
    ? buildFinalizeReport(projectedState)
    : undefined;
  const initialCleanup = planWorktreeCleanup({
    repositoryRoot: root,
    target: {
      path: target,
      branch: initialState?.branch ?? "",
    },
    registered: registeredWorktrees(root),
    prMerged: evidence.prMerged === true,
    clean: initialState ? initialState.dirty === false : undefined,
    trackedChanges: initialState?.dirty,
    pushed: initialState?.pushed,
    remoteBranch: initialState?.remoteBranch,
    recoveryReachable: initialState?.recoveryReachable,
    reachableFromDefaultBranch: initialState?.reachableFromDefaultBranch,
    untracked: initialState?.untracked ?? [],
    stashes: initialState?.stashes ?? [],
    temporaryArtifacts: initialState?.temporaryArtifacts ?? [],
    ignoredArtifacts: initialState?.ignoredArtifacts ?? [],
    ignoredPathAllowlist,
    targetCanonicalPath: canonicalWorktreePath(target),
    targetAbsent: !targetPresent,
  });
  const previewDigest = report?.hash ?? "";
  const plannedInitialCleanup =
    report && !report.safe && initialCleanup.state === "ready"
      ? {
          state: "rejected" as const,
          target: initialCleanup.target,
          reasons: [...report.reasons],
        }
      : initialCleanup;
  const initialPlan = planCompletion({
    mergeConfirmed: evidence.prMerged === true,
    mergeSha,
    rootUpdate: initialRootPlan,
    cleanup: plannedInitialCleanup,
    cleanupAuthorityGranted,
    previewDigest,
    approvedDigest,
  });
  if (!apply) {
    print({
      state: initialPlan.state,
      phases: initialPlan.phases,
      requiredAuthority: initialPlan.requiredAuthority,
      recovery: completionRecovery(initialPlan.phases),
      previewDigest: report?.hash,
      target,
    });
    return initialPlan.state === "ready" ? 0 : 1;
  }
  if (!authorized)
    throw new Error(
      "root更新を含む完了処理の適用には--authorize=approvedが必要です",
    );
  const mergePhase = initialPlan.phases.find(
    (phase) => phase.phase === "merge-confirm",
  );
  if (mergePhase?.state !== "succeeded") {
    print({
      state: "rejected",
      phases: initialPlan.phases,
      requiredAuthority: initialPlan.requiredAuthority,
      recovery: completionRecovery(initialPlan.phases),
      target,
    });
    return 1;
  }
  const appliedRootPlan = applyVerifiedRootUpdate(root, mergeSha);
  if (
    appliedRootPlan.state === "rejected" ||
    git(["rev-parse", "HEAD"], root).stdout.trim() !== mergeSha
  ) {
    const phases = [
      completionPhaseResult("merge-confirm", "succeeded"),
      completionPhaseResult(
        "root-update",
        "rejected",
        appliedRootPlan.reasons.length
          ? appliedRootPlan.reasons
          : ["適用後のroot HEADが検証済みmerge SHAと一致しません"],
        appliedRootPlan.recovery,
      ),
      completionPhaseResult("cleanup-preview", "skipped"),
      completionPhaseResult("cleanup-apply", "skipped"),
      completionPhaseResult("post-verify", "skipped"),
    ];
    print({
      state: "rejected",
      phases,
      requiredAuthority: [],
      recovery: completionRecovery(phases),
      target,
    });
    return 1;
  }
  if (!pathExists(target)) {
    const container = cleanupEmptyWorktreeContainer(root);
    const phases = initialPlan.phases.map((phase) =>
      phase.phase === "post-verify"
        ? completionPhaseResult(
            "post-verify",
            container.failure ? "rejected" : "succeeded",
            container.failure ? [container.failure] : [],
            container.failure
              ? ["空containerの状態を再確認してhygiene previewから再実行する"]
              : [],
          )
        : phase,
    );
    const otherWorktreesBefore = worktreeIdentitySnapshot(root, target);
    const summary = completionPostVerify({
      phases,
      root,
      mergeSha,
      target,
      otherWorktreesBefore,
      containerState: container.state,
    });
    print({
      ...summary,
      phases,
      requiredAuthority: [],
      target,
    });
    return summary.state === "completed" ? 0 : 1;
  }
  const currentIgnoredPathAllowlist = finalizeIgnoredPathAllowlist(root);
  const currentState = inspectFinalizeState(
    root,
    target,
    evidence,
    currentIgnoredPathAllowlist,
  );
  const currentReport = buildFinalizeReport(currentState);
  const currentCleanup = planWorktreeCleanup({
    repositoryRoot: root,
    target: { path: target, branch: currentState.branch },
    registered: registeredWorktrees(root),
    prMerged: currentState.prMerged === true,
    clean: currentState.dirty === false,
    trackedChanges: currentState.dirty,
    pushed: currentState.pushed,
    remoteBranch: currentState.remoteBranch,
    recoveryReachable: currentState.recoveryReachable,
    reachableFromDefaultBranch: currentState.reachableFromDefaultBranch,
    untracked: currentState.untracked,
    stashes: currentState.stashes,
    temporaryArtifacts: currentState.temporaryArtifacts,
    ignoredArtifacts: currentState.ignoredArtifacts,
    ignoredPathAllowlist: currentIgnoredPathAllowlist,
    targetCanonicalPath: fs.realpathSync(target),
  });
  const plannedCurrentCleanup =
    !currentReport.safe && currentCleanup.state === "ready"
      ? {
          state: "rejected" as const,
          target: currentCleanup.target,
          reasons: [...currentReport.reasons],
        }
      : currentCleanup;
  const currentPlan = planCompletion({
    mergeConfirmed: currentState.prMerged === true,
    mergeSha,
    rootUpdate: appliedRootPlan,
    cleanup: plannedCurrentCleanup,
    cleanupAuthorityGranted,
    previewDigest: currentReport.hash,
    approvedDigest,
  });
  if (currentPlan.state !== "ready" || !currentReport.safe) {
    const state =
      currentPlan.state === "pending" ? "pending" : "partially-completed";
    print({
      state,
      phases: currentPlan.phases,
      requiredAuthority: currentPlan.requiredAuthority,
      recovery: completionRecovery(currentPlan.phases),
      previewDigest: currentReport.hash,
      target,
    });
    return 1;
  }
  const otherWorktreesBefore = worktreeIdentitySnapshot(root, target);
  let phases = currentPlan.phases;
  try {
    const trustedPolicy = loadOperationPolicy(root).policy;
    applyFinalize(
      {
        report: currentReport,
        approvedHash: approvedDigest,
        currentState,
        trustedPolicy,
      },
      (operation, payload) => {
        if (operation !== "worktree.remove")
          throw new Error("未対応の完了処理です");
        if (typeof payload.path !== "string")
          throw new Error("worktree pathが不正です");
        git(["worktree", "remove", payload.path], root);
      },
    );
  } catch (error) {
    phases = phases.map((phase) =>
      phase.phase === "cleanup-apply"
        ? completionPhaseResult(
            "cleanup-apply",
            "rejected",
            [error instanceof Error ? error.message : String(error)],
            ["対象を保持してcleanup previewから再実行する"],
          )
        : phase,
    );
  }
  const container = !pathExists(target)
    ? cleanupEmptyWorktreeContainer(root)
    : { state: "retained" as const };
  phases = phases.map((phase) =>
    phase.phase === "post-verify"
      ? completionPhaseResult(
          "post-verify",
          container.failure ? "rejected" : "succeeded",
          container.failure ? [container.failure] : [],
          container.failure
            ? ["空containerの状態を再確認してhygiene previewから再実行する"]
            : [],
        )
      : phase,
  );
  const summary = completionPostVerify({
    phases,
    root,
    mergeSha,
    target,
    otherWorktreesBefore,
    containerState: container.state,
  });
  print({
    ...summary,
    phases,
    requiredAuthority: [],
    target,
    containerState: container.state,
  });
  return summary.state === "completed" ? 0 : 1;
}

function completionPhaseResult(
  phase: CompletionPhaseResult["phase"],
  state: CompletionPhaseResult["state"],
  reasons: string[] = [],
  recovery: string[] = [],
): CompletionPhaseResult {
  return { phase, state, reasons, recovery };
}

function routingProject(root: string) {
  const policySet = loadProjectPolicySet(root);
  const choices = policySet.choices[0];
  const modelMapping = choices?.modelMapping;
  const mapping = policySet.providerMappings[0];
  if (!choices || !modelMapping || typeof modelMapping === "string")
    throw new Error(
      "project choiceのmodelMappingは構造化設定が有効化されていません",
    );
  if (!mapping) throw new Error("provider capability mappingが未設定です");
  return { modelMapping, mapping };
}

function routingStorage(root: string) {
  const { modelMapping } = routingProject(root);
  return {
    repositoryRoot: root,
    storeRoot: modelMapping.evidenceStoreRoot,
    retention: modelMapping.retention,
  };
}

function routingFailure(
  state: "pending" | "rejected",
  ruleId: string,
  reason: string,
  entrypoint: string,
) {
  const recovery = routingRecovery(ruleId);
  return serializeDiagnostic({
    allowed: false,
    state,
    routingFailure: {
      reason,
      checkedEntrypoint: entrypoint,
      safeFallback: "候補なし",
      requiredAuthority: recovery.authority,
      stopPoint: "実装開始前",
      resumeCondition: recovery.resume,
    },
    diagnostic: routingDiagnostic(ruleId, reason, {
      requiredAuthority: recovery.authority,
      next: recovery.next,
    }),
  });
}

function roleTierFailure(
  ruleId: string,
  purpose: string,
  risk: string,
  reasons: string[],
  scope: string,
  next: string,
  requiredAuthority: string,
): unknown {
  return serializeDiagnostic({
    allowed: false,
    valid: false,
    errors: reasons,
    diagnostic: {
      ruleId,
      purpose,
      risk,
      reasons,
      scope: [scope],
      checks: [
        "role、identity、context、tier、mapping、override証拠を確認した",
      ],
      autoFixes: [],
      next,
      requiredAuthority,
      rollback: "外部状態と対象差分を変更せず、検証前の状態を保持する",
    },
  });
}

function assignmentInput(source: string): Array<{
  role: string;
  identity: string;
  context: string;
}> {
  const parsed = parseJsonStrict(source, "assignments");
  if (!Array.isArray(parsed))
    throw new Error("--assignmentsはJSON配列でなければなりません");
  return parsed.map((item, index) => {
    if (!isRecord(item))
      throw new Error(`assignments[${index}]はobjectでなければなりません`);
    for (const field of ["role", "identity", "context"] as const)
      if (typeof item[field] !== "string")
        throw new Error(
          `assignments[${index}].${field}は文字列でなければなりません`,
        );
    return {
      role: item.role as string,
      identity: item.identity as string,
      context: item.context as string,
    };
  });
}

function humanOverrideInput(source: string): HumanOverride {
  const parsed = parseJsonStrict(source, "override");
  if (!isRecord(parsed))
    throw new Error("--overrideはobjectでなければなりません");
  for (const field of [
    "provider",
    "selection",
    "scope",
    "instructedBy",
    "instructedAt",
    "expiresAt",
  ] as const)
    if (typeof parsed[field] !== "string")
      throw new Error(`override.${field}は文字列でなければなりません`);
  if (typeof parsed.issue !== "number" || !Number.isInteger(parsed.issue))
    throw new Error("override.issueは整数でなければなりません");
  return {
    provider: parsed.provider as string,
    selection: parsed.selection as string,
    issue: parsed.issue,
    scope: parsed.scope as string,
    instructedBy: parsed.instructedBy as string,
    instructedAt: parsed.instructedAt as string,
    expiresAt: parsed.expiresAt as string,
  };
}

function modelTier(value: string, flag: string): ModelTier {
  const tier = MODEL_TIERS.find((candidate) => candidate === value);
  if (!tier) throw new Error(`--${flag}のmodel tierが不正です`);
  return tier;
}

function graphRoot(flags: Flags): string {
  return path.resolve(
    typeof flags.root === "string" ? flags.root : process.cwd(),
  );
}

export const MIN_GRAPH_NODE_VERSION = "22.13.0" as const;

export function supportsGraphRuntime(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 13);
}

function assertGraphRuntime(version: string): void {
  if (!supportsGraphRuntime(version))
    throw new Error(
      `graph subcommandにはNode.js ${MIN_GRAPH_NODE_VERSION}以上が必要です（現在: ${version}）`,
    );
}

function assertCommandRuntime(command: string, version: string): void {
  if (command === "graph") assertGraphRuntime(version);
}

function graphEdgeKinds(
  value: string | boolean | undefined,
): SemanticEdgeKind[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "")
    throw new Error("--edge-kindsには空でないcomma区切り値が必要です");
  const values = [...new Set(value.split(","))];
  if (
    values.some(
      (candidate): candidate is string =>
        !SEMANTIC_EDGE_KINDS.includes(candidate as SemanticEdgeKind),
    )
  )
    throw new Error("--edge-kindsに未知のsemantic edge kindがあります");
  return values.sort() as SemanticEdgeKind[];
}

function graphBooleanFlag(
  value: string | boolean | undefined,
  name: string,
): boolean {
  if (value === undefined) return false;
  if (value !== true)
    throw new Error(`--${name}は値を取らないflagとして指定してください`);
  return true;
}

async function readFreshSemanticGraph(root: string) {
  const { GRAPHQLITE_VERSION, GraphQlLiteStore, graphQlLiteAsset } =
    await import("./adapters/graphqlite.js");
  const expectedSnapshot = buildRepositorySemanticGraph(root);
  const expectedGraphContentHash = semanticGraphContentHash(expectedSnapshot);
  const expectedAsset = graphQlLiteAsset();
  const store = new GraphQlLiteStore(root);
  try {
    const stored = await store.read();
    const sourceAfterRead = observeRepositoryGraphSource(root);
    if (stableJson(sourceAfterRead) !== stableJson(expectedSnapshot.source))
      throw new GraphFreshnessError(
        ["source-ahead"],
        "semantic graphの検証中にsourceが変化しました。再実行してください",
      );
    const observedGraphContentHash = semanticGraphContentHash(stored.snapshot);
    if (observedGraphContentHash !== expectedGraphContentHash)
      throw new GraphFreshnessError(
        ["projection-drift"],
        "semantic graphの保存投影が現在projectorの期待snapshotと一致しません。再構築してください",
      );
    const freshness = assessGraphFreshness({
      expectedSource: sourceAfterRead,
      expectedExtensionVersion: GRAPHQLITE_VERSION,
      expectedExtensionSha256: expectedAsset.sha256,
      manifest: stored.manifest,
      observedGraphContentHash,
      observedNodeCount: stored.snapshot.nodes.length,
      observedEdgeCount: stored.snapshot.edges.length,
    });
    if (!freshness.fresh || !freshness.exactEvidenceAllowed)
      throw new GraphFreshnessError(
        freshness.reasons,
        `semantic graphは再構築が必要です: ${freshness.reasons.join(", ")}`,
      );
    return {
      ...stored,
      freshness,
      observedSource: sourceAfterRead,
      expectedGraphContentHash,
      observedGraphContentHash,
    };
  } finally {
    await store.close();
  }
}

function graphQueryEvidence(
  stored: Awaited<ReturnType<typeof readFreshSemanticGraph>>,
  query: Readonly<Record<string, unknown>>,
  result: unknown,
  exactResult: boolean,
  includeInferred = false,
) {
  const exactEvidence =
    !includeInferred &&
    stored.freshness.exactEvidenceAllowed &&
    stored.expectedGraphContentHash === stored.observedGraphContentHash &&
    exactResult;
  return {
    evidenceVersion: "agent-skill-chain/graph-query-evidence/v1",
    exactEvidence,
    candidate: includeInferred,
    deterministicOnly: !includeInferred,
    authority: "none",
    mergeAuthorization: false,
    modeAuthorization: false,
    graph: {
      schemaVersion: stored.manifest.graphSchemaVersion,
      builderVersion: stored.manifest.graphBuilderVersion,
      extensionVersion: stored.manifest.extensionVersion,
      extensionSha256: stored.manifest.extensionSha256,
      graphContentHash: stored.manifest.graphContentHash,
      expectedGraphContentHash: stored.expectedGraphContentHash,
      nodeCount: stored.manifest.nodeCount,
      edgeCount: stored.manifest.edgeCount,
      generation: stored.manifest.generation,
      builtAt: stored.manifest.builtAt,
    },
    source: stored.manifest.source,
    query: {
      ...query,
      budget: DEFAULT_GRAPH_BUDGET,
      certaintyPolicy: includeInferred
        ? "include-inferred"
        : "deterministic-only",
    },
    resultDigest: crypto
      .createHash("sha256")
      .update(stableJson(result))
      .digest("hex"),
    freshness: stored.freshness,
  };
}

function printGraphFreshnessFailure(error: unknown): boolean {
  if (!(error instanceof GraphFreshnessError)) return false;
  print({
    status: "unavailable-or-stale",
    authority: "none",
    mergeAuthorization: false,
    modeAuthorization: false,
    exactEvidenceAllowed: false,
    reasons: error.reasons,
    recovery: error.recovery,
    next: "graph installとgraph rebuildを明示的に実行してください",
  });
  return true;
}

function assertGraphSourceUnchanged(
  root: string,
  expected: ReturnType<typeof observeRepositoryGraphSource>,
): void {
  const observed = observeRepositoryGraphSource(root);
  if (stableJson(observed) !== stableJson(expected))
    throw new GraphFreshnessError(
      ["source-ahead"],
      "semantic graphの探索中にsourceが変化しました。結果をEvidenceにせず再実行してください",
    );
}

function usageInputs(
  usage: CommandUsage,
  args: readonly string[],
): { flags: Flags; positionals: string[] } {
  if (usage.acceptsSpaceSeparatedFlags === true) {
    const { flags, artifacts } = workflowArguments([...args]);
    const merged: Flags = { ...flags };
    if (artifacts.length > 0) merged.artifact = artifacts[0] ?? "";
    return { flags: merged, positionals: [] };
  }
  const valueFlags = new Set(valueFlagNames(usage));
  const flags: Flags = {};
  const positionals: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [rawKey = "", ...rest] = arg.slice(2).split("=");
    if (rest.length === 0 && valueFlags.has(rawKey))
      throw spaceSeparatedFlagError(usage, rawKey);
    flags[rawKey] = rest.length ? rest.join("=") : true;
  }
  return { flags, positionals };
}

function worktreeCreateBoundaryPreflight(flags: Flags): void {
  if (
    flags.path !== undefined &&
    (typeof flags.path !== "string" || flags.path === "")
  )
    throw new Error("--pathを指定する場合は空でない値が必要です");
  if (typeof flags.path !== "string") return;
  const root = path.resolve(
    typeof flags.root === "string" ? flags.root : process.cwd(),
  );
  enforceTrustedWorktreeBoundary({
    repoRoot: root,
    worktreePath: flags.path,
    expectedRepository: typeof flags.repo === "string" ? flags.repo : undefined,
    trustedPolicy: loadOperationPolicy(root).policy,
  });
}

const USAGE_PREFLIGHT: Readonly<Record<string, (flags: Flags) => void>> =
  Object.freeze({
    "worktree create": worktreeCreateBoundaryPreflight,
  });

function enforceUsage(usage: CommandUsage, args: readonly string[]): void {
  const { flags, positionals } = usageInputs(usage, args);
  USAGE_PREFLIGHT[usageKey(usage.command, usage.subcommand)]?.(flags);
  const missing = missingRequiredFlags(usage, flags, positionals);
  if (missing.length > 0) throw missingFlagsError(usage, missing);
}

function isHelpToken(value: string | undefined): boolean {
  return value === "--help" || value === "-h";
}

export async function main(
  argv: string[],
  dependencies: { now?: () => Date; nodeVersion?: string } = {},
): Promise<number> {
  const [command, subcommand, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    print({
      usage: CLI_USAGE,
      lifecycle: PUBLIC_LIFECYCLE_COMMANDS.map(
        (name) => `npx agent-skill-chain ${name}`,
      ),
    });
    return 0;
  }
  const usage = findCommandUsage(command, subcommand);
  if (usage === undefined && isHelpToken(subcommand)) {
    const subcommands = COMMAND_USAGE.filter(
      (entry) => entry.command === command && entry.subcommand !== undefined,
    ).map((entry) => entry.subcommand ?? "");
    if (subcommands.length > 0)
      throw new CliValidationError(
        [`${command}にはsubcommandが必要です: ${subcommands.join("、")}`],
        `npx agent-skill-chain ${command} <${subcommands.join("|")}> --help でusageを確認してください`,
      );
  }
  if (usage !== undefined) {
    const usageArgs =
      usage.subcommand === undefined && subcommand !== undefined
        ? [subcommand, ...rest]
        : rest;
    if (usageArgs.some((argument) => isHelpToken(argument))) {
      print(renderUsage(usage));
      return 0;
    }
    enforceUsage(usage, usageArgs);
  }
  assertCommandRuntime(
    command,
    dependencies.nodeVersion ?? process.versions.node,
  );
  if (command === "routing" && subcommand === "roles") {
    const { flags } = parse(rest);
    const scope = required(flags, "scope");
    const result = validateRoleAssignment({
      scope,
      assignments: assignmentInput(required(flags, "assignments")),
    });
    print(
      result.valid
        ? result
        : roleTierFailure(
            "ASC-ROLE-ASSIGNMENT-001",
            "同一scopeのrole分離と独立contextを保証する",
            "identity",
            result.errors,
            scope,
            "異なるidentityとcontextへ再割当し、coordinatorを含めて再検証してください",
            "coordinatorによる担当割当",
          ),
    );
    return result.valid ? 0 : 1;
  }
  if (command === "routing" && subcommand === "tier") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const risk = required(flags, "risk");
    const mode = required(flags, "mode");
    const scope = required(flags, "scope");
    const model = required(flags, "model");
    const selected = modelTier(required(flags, "selected"), "selected");
    const choices = loadProjectPolicySet(root).choices[0];
    const configured =
      choices?.modelMapping && typeof choices.modelMapping !== "string"
        ? choices.modelMapping
        : undefined;
    const computed = requiredTier({ risk, mode, scope });
    const configuredMinimum = configured?.minimumTierByRisk?.[risk];
    const requiredMinimum =
      configuredMinimum &&
      MODEL_TIERS.indexOf(configuredMinimum) > MODEL_TIERS.indexOf(computed)
        ? configuredMinimum
        : computed;
    const result = validateTierSelection({
      required: requiredMinimum,
      selected,
      mapping: configured?.tierMapping ?? {},
      model,
      justification:
        typeof flags.justification === "string"
          ? flags.justification
          : undefined,
    });
    const output = { ...result, required: requiredMinimum, selected, model };
    print(
      result.valid
        ? output
        : roleTierFailure(
            "ASC-MODEL-TIER-001",
            "risk・mode・scopeに必要な能力tierを単調に保証する",
            risk,
            result.errors,
            scope,
            "trusted project choiceへmodel mappingを定義するか、必要tier以上を選択してください",
            "model mapping owner",
          ),
    );
    return result.valid ? 0 : 1;
  }
  if (command === "routing" && subcommand === "ceiling") {
    const { flags } = parse(rest);
    const issueRaw = required(flags, "issue");
    if (!/^[1-9]\d*$/u.test(issueRaw))
      throw new Error("--issueは正のIssue番号でなければなりません");
    const scope = required(flags, "scope");
    const result = validateProviderSelection({
      provider: required(flags, "provider"),
      selection: required(flags, "selection"),
      issue: Number(issueRaw),
      scope,
      now: typeof flags.now === "string" ? flags.now : new Date().toISOString(),
      override:
        typeof flags.override === "string"
          ? humanOverrideInput(flags.override)
          : undefined,
    });
    print(
      result.valid
        ? result
        : roleTierFailure(
            "ASC-PROVIDER-CEILING-001",
            "provider別の自律選択上限とscope拘束overrideを保証する",
            "authority",
            result.errors,
            scope,
            "上限内へ戻すか、対象Issueとscopeへ拘束された有効な人間overrideを提示してください",
            "対象scopeの人間指示者",
          ),
    );
    return result.valid ? 0 : 1;
  }
  if (command === "routing" && subcommand === "observe") {
    const { flags } = parse(rest);
    const provider = required(flags, "provider");
    const observation = await observeProvider(provider);
    print(observation);
    return observation.state === "available" ? 0 : 1;
  }
  if (command === "routing" && subcommand === "resolve") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const { modelMapping, mapping } = routingProject(root);
    const provider = modelMapping.roles.implementer.provider;
    const observation = await observeProvider(provider);
    const decision = resolveRouting({
      scope: required(flags, "scope"),
      coordinatorIdentity: required(flags, "coordinator"),
      implementerIdentity: required(flags, "implementer"),
      reviewerIdentity: required(flags, "reviewer"),
      availability: observation,
      mapping,
      modelMapping,
      requiredCapability: "coding",
      evaluatorRef: required(flags, "evaluator-ref"),
    });
    if (decision.state === "resolved") {
      print(decision);
      return 0;
    }
    print(
      routingFailure(
        decision.state,
        decision.ruleId,
        decision.reason,
        observation.entrypoint,
      ),
    );
    return 1;
  }
  if (command === "routing" && subcommand === "independence") {
    const { flags } = parse(rest);
    const result = checkRoutingIndependence({
      implementerIdentity: required(flags, "implementer"),
      reviewerIdentity: required(flags, "reviewer"),
      candidatePaths:
        typeof flags["candidate-paths"] === "string"
          ? flags["candidate-paths"].split(",").filter(Boolean)
          : [],
      trustedRef: required(flags, "trusted-ref"),
      candidateHead: required(flags, "candidate-head"),
      evaluatorRef: required(flags, "evaluator-ref"),
    });
    print(
      result.verdict === "independent"
        ? result
        : serializeDiagnostic({
            allowed: false,
            ...result,
            diagnostic: routingDiagnostic(
              result.ruleId ?? "FR-836-11",
              result.reason ?? "routing independenceを確認できません",
            ),
          }),
    );
    return result.verdict === "independent" ? 0 : 1;
  }
  if (command === "routing" && subcommand === "evidence") {
    const [operation, ...operationArgs] = rest;
    const { flags } = parse(operationArgs);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const storage = routingStorage(root);
    if (operation === "issue") {
      const apply = applyMode(flags);
      const input = {
        ...storage,
        baseSha: required(flags, "base-sha"),
        issue: Number(required(flags, "issue")),
        scope: required(flags, "scope"),
        role: required(flags, "role"),
        routeMode: required(flags, "route-mode"),
        provider: required(flags, "provider"),
        model: required(flags, "model"),
        modelSelection: required(flags, "model-selection"),
        routingReason: required(flags, "routing-reason"),
        mappingVersion: required(flags, "mapping-version"),
        reasoningEffort: required(flags, "reasoning-effort"),
        serviceTier: required(flags, "service-tier"),
        identity: required(flags, "identity"),
        evaluatorRef: required(flags, "evaluator-ref"),
      };
      if (!apply) {
        print({ preview: "routing evidenceを発行する", input });
        return 0;
      }
      print(issueRoutingEvidence(input));
      return 0;
    }
    if (operation === "complete") {
      const apply = applyMode(flags);
      const input = {
        ...storage,
        routingEvidenceId: required(flags, "evidence-id"),
        implementationHead: required(flags, "implementation-head"),
        endState: required(flags, "end-state"),
      };
      if (!apply) {
        print({ preview: "completion recordを追記する", input });
        return 0;
      }
      print(appendCompletionRecord(input));
      return 0;
    }
    if (operation === "state") {
      const apply = applyMode(flags);
      const input = {
        ...storage,
        routingEvidenceId: required(flags, "evidence-id"),
        state: required(flags, "state"),
        reason: required(flags, "reason"),
      };
      if (!apply) {
        print({ preview: "EvidenceStateRecordを追記する", input });
        return 0;
      }
      print(appendEvidenceStateRecord(input));
      return 0;
    }
    if (operation === "prune") {
      const apply = applyMode(flags);
      if (!apply) {
        print(previewEvidencePrune(storage));
        return 0;
      }
      if (flags.authorize !== "approved")
        throw new Error(
          "routing evidence prune --applyには--authorize=approvedが必要です",
        );
      print(
        applyEvidencePrune({
          ...storage,
          approvedDigest: required(flags, "digest"),
          targetIds: required(flags, "target-ids").split(",").filter(Boolean),
          authorize: "approved",
        }),
      );
      return 0;
    }
    throw new Error(
      "routing evidenceにはissue、complete、state、pruneのいずれかが必要です",
    );
  }
  if (command === "workflow" && subcommand === "verification-set") {
    const { flags, artifacts } = workflowArguments(rest);
    if (artifacts.length > 0)
      throw new Error("workflow verification-setで--artifactは使用できません");
    const unknown = Object.keys(flags).filter(
      (flag) => !["input", "root"].includes(flag),
    );
    if (unknown.length > 0)
      throw new Error(
        `workflow verification-setの未知optionです: --${unknown.join(", --")}`,
      );
    const root = path.resolve(flags.root ?? process.cwd());
    const input = readJsonInput(resolveContained(root, flags.input ?? ""));
    print(selectVerificationSet(parseVerificationSelectionInput(input)));
    return 0;
  }
  if (command === "workflow" && subcommand === "assess-discovery") {
    const { flags, artifacts } = workflowArguments(rest);
    if (artifacts.length > 0)
      throw new Error("workflow assess-discoveryで--artifactは使用できません");
    const unknown = Object.keys(flags).filter(
      (flag) => !["input", "root"].includes(flag),
    );
    if (unknown.length > 0)
      throw new Error(
        `workflow assess-discoveryの未知optionです: --${unknown.join(", --")}`,
      );
    const root = path.resolve(flags.root ?? process.cwd());
    const input = readJsonInput(resolveContained(root, flags.input ?? ""));
    print(
      assessImplementationDiscovery(parseImplementationDiscoveryInput(input)),
    );
    return 0;
  }
  if (command === "workflow" && subcommand === "promote-full") {
    const { flags, artifacts } = workflowArguments(rest);
    if (artifacts.length > 0)
      throw new Error("workflow promote-fullで--artifactは使用できません");
    const unknown = Object.keys(flags).filter(
      (flag) =>
        ![
          "input",
          "staging",
          "root",
          "promoted-at",
          "apply",
          "dry-run",
        ].includes(flag),
    );
    if (unknown.length > 0)
      throw new Error(
        `workflow promote-fullの未知optionです: --${unknown.join(", --")}`,
      );
    const root = path.resolve(flags.root ?? process.cwd());
    const stagingInput = flags.staging;
    if (!stagingInput)
      throw new Error("workflow promote-fullには--stagingが必要です");
    const staging = resolveContained(
      root,
      path.relative(root, path.resolve(root, stagingInput)),
    );
    const discovery = parseImplementationDiscoveryInput(
      readJsonInput(resolveContained(root, flags.input ?? "")),
    );
    const apply = workflowLifecycleApplyMode(flags);
    if (!apply) {
      print(previewWorkflowStagingPromotion({ staging, discovery }));
      return 0;
    }
    print(
      promoteWorkflowStagingToFull({
        staging,
        discovery,
        promotedAt: flags["promoted-at"] ?? new Date().toISOString(),
      }),
    );
    return 0;
  }
  if (command === "workflow" && subcommand === "poc-observation") {
    const { flags, artifacts } = workflowArguments(rest);
    if (artifacts.length > 0)
      throw new Error("workflow poc-observationで--artifactは使用できません");
    const unknown = Object.keys(flags).filter(
      (flag) => !["staging", "root", "apply", "dry-run"].includes(flag),
    );
    if (unknown.length > 0)
      throw new Error(
        `workflow poc-observationの未知optionです: --${unknown.join(", --")}`,
      );
    const root = path.resolve(flags.root ?? process.cwd());
    const stagingInput = flags.staging;
    if (!stagingInput)
      throw new Error("workflow poc-observationには--stagingが必要です");
    const staging = resolveContained(
      root,
      path.relative(root, path.resolve(root, stagingInput)),
    );
    const headSha = git(
      ["rev-parse", "--verify", "HEAD^{commit}"],
      root,
    ).stdout.trim();
    const apply = workflowLifecycleApplyMode(flags);
    if (!apply) {
      print({
        state: "preview",
        operation: "execute-poc-observation",
        staging,
        headSha,
        sandbox: "/usr/bin/bwrap",
        executor: process.execPath,
        next: "--applyで隔離fixtureの定義済みNode runnerを実行し、ASC計測Evidenceを固定します",
      });
      return 0;
    }
    print(
      executePocObservation({
        staging,
        headSha,
        observedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      }),
    );
    return 0;
  }
  if (command === "workflow" && subcommand === "steps") {
    const { flags, artifacts } = workflowArguments(rest);
    if (artifacts.length > 0)
      throw new Error("workflow stepsで--artifactは使用できません");
    const unknown = Object.keys(flags).filter((flag) => flag !== "mode");
    if (unknown.length > 0)
      throw new Error(
        `workflow stepsの未知optionです: --${unknown.join(", --")}`,
      );
    if (flags.mode) {
      const mode = workflowMode(flags.mode);
      print({
        mode,
        steps: WORKFLOW_STEPS.filter(({ step }) =>
          requiredSteps(mode).includes(step),
        ),
        sequence: MODE_STEP_SEQUENCES[mode],
        skippableSteps: skippableSteps(mode),
        neverSkippableSteps: NEVER_SKIPPABLE_STEPS,
      });
      return 0;
    }
    print({
      steps: WORKFLOW_STEPS,
      modes: Object.fromEntries(
        (["full", "quick", "poc"] as const).map((mode) => [
          mode,
          {
            sequence: MODE_STEP_SEQUENCES[mode],
            skippableSteps: skippableSteps(mode),
          },
        ]),
      ),
      neverSkippableSteps: NEVER_SKIPPABLE_STEPS,
    });
    return 0;
  }
  if (command === "workflow" && subcommand === "record") {
    const { flags, artifacts } = workflowArguments(rest);
    const unknown = Object.keys(flags).filter(
      (flag) =>
        ![
          "staging",
          "step",
          "evidence",
          "recorded-at",
          "review-session-digest",
        ].includes(flag),
    );
    if (unknown.length > 0)
      throw new Error(
        `workflow recordの未知optionです: --${unknown.join(", --")}`,
      );
    if (artifacts.length === 0)
      throw new Error("workflow recordには--artifactが1件以上必要です");
    const staging = flags.staging;
    const stepNumber = flags.step;
    const evidence = flags.evidence;
    if (!staging) throw new Error("workflow recordには--stagingが必要です");
    if (!stepNumber) throw new Error("workflow recordには--stepが必要です");
    if (!evidence) throw new Error("workflow recordには--evidenceが必要です");
    const journal = readWorkflowJournal(staging);
    const step = workflowStep(workflowStepNumber(stepNumber, "step"));
    if (!step) throw new Error("workflow step定義がありません");
    if (step.step === 0 || step.step === 11)
      throw new Error(
        "Step 0はstaging初期化専用、Step 11はdelivery終端専用です。workflow recordでは記録できません",
      );
    let entry: StepJournalEntry = {
      step: step.step,
      skillId: step.skillId,
      mode: journal.mode,
      recordedAt: flags["recorded-at"] ?? new Date().toISOString(),
      artifacts,
      evidence,
    };
    const repositoryRoot = path.resolve(staging, "../../../..");
    const needsHeadSha =
      step.step === 10 || (journal.mode === "poc" && step.step >= 9);
    const headSha = needsHeadSha
      ? git(
          ["rev-parse", "--verify", "HEAD^{commit}"],
          repositoryRoot,
        ).stdout.trim()
      : undefined;
    if (step.step === 10) {
      const session = assertConvergedReviewSession({
        staging,
        expectedDigest: required(flags, "review-session-digest"),
        currentHeadSha: headSha!,
      });
      entry = {
        ...entry,
        reviewSession: {
          sessionId: session.sessionId,
          roundDigest: session.latestRoundDigest,
          headSha: session.latestCandidateHeadSha,
        },
      };
    } else if (flags["review-session-digest"] !== undefined) {
      throw new Error(
        "--review-session-digestはworkflow record --step=10だけに指定できます",
      );
    }
    print(appendWorkflowJournalEntry({ staging, entry, headSha }));
    return 0;
  }
  if (command === "workflow" && subcommand === "verify") {
    const { flags, artifacts } = workflowArguments(rest);
    if (artifacts.length > 0)
      throw new Error("workflow verifyで--artifactは使用できません");
    const unknown = Object.keys(flags).filter(
      (flag) => !["staging", "up-to"].includes(flag),
    );
    if (unknown.length > 0)
      throw new Error(
        `workflow verifyの未知optionです: --${unknown.join(", --")}`,
      );
    if (!flags.staging)
      throw new Error("workflow verifyには--stagingが必要です");
    const upTo = flags["up-to"]
      ? workflowStepNumber(flags["up-to"], "up-to")
      : 11;
    const inspection = inspectWorkflowStaging(flags.staging, upTo);
    if (inspection.mode === "poc" && upTo >= 9) {
      const headSha = git(
        ["rev-parse", "--verify", "HEAD^{commit}"],
        path.resolve(inspection.staging, "../../../.."),
      ).stdout.trim();
      const observation = inspectStoredPocObservationEvidence(
        inspection.staging,
        headSha,
      );
      if (!observation.valid) {
        print(
          workflowDiagnostic(
            inspection.staging,
            inspection.mode,
            inspection.validation,
            [...inspection.errors, ...observation.errors],
          ),
        );
        return 1;
      }
      const binding = inspectCurrentPocJournalBinding(
        inspection.staging,
        headSha,
        upTo,
      );
      if (!binding.valid) {
        print(
          workflowDiagnostic(
            inspection.staging,
            inspection.mode,
            inspection.validation,
            binding.errors,
          ),
        );
        return 1;
      }
    }
    if (!inspection.valid) {
      print(
        workflowDiagnostic(
          inspection.staging,
          inspection.mode,
          inspection.validation,
          inspection.errors,
        ),
      );
      return 1;
    }
    print({
      valid: true,
      staging: inspection.staging,
      mode: inspection.mode,
      upToStep: upTo,
      completedSteps: inspection.completedSteps,
      nextStep: inspection.nextStep,
      message: `step ${upTo}までの必須Step記録は有効です`,
    });
    return 0;
  }
  if (command === "workflow")
    throw new Error(
      "workflowにはsteps、verification-set、assess-discovery、promote-full、record、verifyのいずれかが必要です",
    );
  if (command === "graph" && subcommand === "install") {
    const { flags } = parse(rest);
    const root = graphRoot(flags);
    const apply = applyMode(flags);
    const { GRAPHQLITE_COMMIT, installGraphQlLiteExtension } =
      await import("./adapters/graphqlite.js");
    const result = await installGraphQlLiteExtension(root, { apply });
    print({
      ...result,
      commit: GRAPHQLITE_COMMIT,
      authority: "none",
      mergeAuthorization: false,
      modeAuthorization: false,
      evidence: "version、asset名、size、SHA-256を固定して検証した",
    });
    return 0;
  }
  if (command === "graph" && subcommand === "rebuild") {
    const { flags } = parse(rest);
    const root = graphRoot(flags);
    const apply = applyMode(flags);
    const snapshot = buildRepositorySemanticGraph(root);
    const graphContentHash = semanticGraphContentHash(snapshot);
    if (!apply) {
      print({
        status: "preview",
        authority: "none",
        mergeAuthorization: false,
        modeAuthorization: false,
        source: snapshot.source,
        graphContentHash,
        nodeCount: snapshot.nodes.length,
        edgeCount: snapshot.edges.length,
        writes: ["worktree固有のruntime projection", "atomic current pointer"],
      });
      return 0;
    }
    const builtAt =
      typeof flags["built-at"] === "string"
        ? flags["built-at"]
        : (dependencies.now?.() ?? new Date()).toISOString();
    const { GRAPHQLITE_VERSION, GraphQlLiteStore, graphQlLiteAsset } =
      await import("./adapters/graphqlite.js");
    try {
      const store = new GraphQlLiteStore(root);
      try {
        const manifest = await store.replace(snapshot, builtAt, async () =>
          observeRepositoryGraphSource(root),
        );
        const readBack = await store.read();
        const currentSource = observeRepositoryGraphSource(root);
        const expectedAsset = graphQlLiteAsset();
        const freshness = assessGraphFreshness({
          expectedSource: currentSource,
          expectedExtensionVersion: GRAPHQLITE_VERSION,
          expectedExtensionSha256: expectedAsset.sha256,
          manifest,
          observedGraphContentHash: semanticGraphContentHash(readBack.snapshot),
          observedNodeCount: readBack.snapshot.nodes.length,
          observedEdgeCount: readBack.snapshot.edges.length,
        });
        if (!freshness.fresh || !freshness.exactEvidenceAllowed)
          throw new GraphFreshnessError(
            freshness.reasons,
            `semantic graph構築中のsource driftを検出しました: ${freshness.reasons.join(", ")}`,
          );
        print({
          status: "rebuilt",
          authority: "none",
          mergeAuthorization: false,
          modeAuthorization: false,
          manifest,
          readBackGraphContentHash: semanticGraphContentHash(readBack.snapshot),
        });
      } finally {
        await store.close();
      }
    } catch (error) {
      if (!printGraphFreshnessFailure(error)) throw error;
      return 1;
    }
    return 0;
  }
  if (command === "graph" && subcommand === "status") {
    const { flags } = parse(rest);
    const root = graphRoot(flags);
    try {
      const result = await readFreshSemanticGraph(root);
      print({
        status: "fresh",
        authority: "none",
        mergeAuthorization: false,
        modeAuthorization: false,
        exactEvidenceAllowed: result.freshness.exactEvidenceAllowed,
        manifest: result.manifest,
      });
      return 0;
    } catch (error) {
      if (!printGraphFreshnessFailure(error)) throw error;
      return 1;
    }
  }
  if (command === "graph" && subcommand === "impact") {
    const { flags } = parse(rest);
    const root = graphRoot(flags);
    const direction =
      typeof flags.direction === "string" ? flags.direction : "incoming";
    if (direction !== "incoming" && direction !== "outgoing")
      throw new Error("--directionはincomingまたはoutgoingが必要です");
    const starts = [...new Set(required(flags, "start").split(","))].sort();
    if (starts.some((start) => start === ""))
      throw new Error("--startに空のnode IDを指定できません");
    const edgeKinds = graphEdgeKinds(flags["edge-kinds"]);
    const includeInferred = graphBooleanFlag(
      flags["include-inferred"],
      "include-inferred",
    );
    let stored: Awaited<ReturnType<typeof readFreshSemanticGraph>>;
    try {
      stored = await readFreshSemanticGraph(root);
    } catch (error) {
      if (!printGraphFreshnessFailure(error)) throw error;
      return 1;
    }
    const result = traverseSemanticGraph(stored.snapshot, starts, {
      direction,
      edgeKinds,
      includeInferred,
    });
    try {
      assertGraphSourceUnchanged(root, stored.observedSource);
    } catch (error) {
      if (!printGraphFreshnessFailure(error)) throw error;
      return 1;
    }
    const evidence = graphQueryEvidence(
      stored,
      {
        command: "graph impact",
        starts,
        direction,
        edgeKinds: edgeKinds ?? [],
        includeInferred,
      },
      result,
      result.status === "complete",
      includeInferred,
    );
    print({
      ...result,
      candidate: includeInferred,
      exactEvidence: evidence.exactEvidence,
      authority: "none",
      mergeAuthorization: false,
      modeAuthorization: false,
      evidence,
    });
    return result.status === "complete" ? 0 : 1;
  }
  if (command === "graph" && subcommand === "path") {
    const { flags } = parse(rest);
    const root = graphRoot(flags);
    const from = required(flags, "from");
    const to = required(flags, "to");
    const edgeKinds = graphEdgeKinds(flags["edge-kinds"]);
    let stored: Awaited<ReturnType<typeof readFreshSemanticGraph>>;
    try {
      stored = await readFreshSemanticGraph(root);
    } catch (error) {
      if (!printGraphFreshnessFailure(error)) throw error;
      return 1;
    }
    const result = shortestSemanticPath(stored.snapshot, from, to, {
      edgeKinds,
    });
    try {
      assertGraphSourceUnchanged(root, stored.observedSource);
    } catch (error) {
      if (!printGraphFreshnessFailure(error)) throw error;
      return 1;
    }
    const evidence = graphQueryEvidence(
      stored,
      { command: "graph path", from, to, edgeKinds: edgeKinds ?? [] },
      result,
      result.status === "complete",
    );
    print({
      ...result,
      exactEvidence: evidence.exactEvidence,
      authority: "none",
      mergeAuthorization: false,
      modeAuthorization: false,
      evidence,
    });
    return result.status === "complete" ? 0 : 1;
  }
  if (command === "graph" && subcommand === "order") {
    const { flags } = parse(rest);
    const root = graphRoot(flags);
    const edgeKinds = graphEdgeKinds(required(flags, "edge-kinds"));
    let stored: Awaited<ReturnType<typeof readFreshSemanticGraph>>;
    try {
      stored = await readFreshSemanticGraph(root);
    } catch (error) {
      if (!printGraphFreshnessFailure(error)) throw error;
      return 1;
    }
    const result = topologicalSemanticOrder(stored.snapshot, edgeKinds);
    try {
      assertGraphSourceUnchanged(root, stored.observedSource);
    } catch (error) {
      if (!printGraphFreshnessFailure(error)) throw error;
      return 1;
    }
    const evidence = graphQueryEvidence(
      stored,
      { command: "graph order", edgeKinds: edgeKinds ?? [] },
      result,
      result.evidenceComplete,
    );
    print({
      ...result,
      exactEvidence: evidence.exactEvidence,
      gatePass: evidence.exactEvidence && result.gateConformant,
      authority: "none",
      mergeAuthorization: false,
      modeAuthorization: false,
      evidence,
    });
    return result.gateConformant ? 0 : 1;
  }
  if (command === "graph")
    throw new Error(`不明なgraph subcommandです: ${subcommand ?? ""}`);
  if (command === "issue" && subcommand === "create") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const assessment = readModeAssessment(required(flags, "assessment"));
    const requestedMode = required(flags, "mode");
    if (!["quick", "full", "poc"].includes(requestedMode))
      throw new Error("--modeはquick、full、pocのいずれかが必要です");
    const declarationFile = flags["poc-declaration"];
    if (requestedMode === "poc" && typeof declarationFile !== "string")
      throw new Error("--mode=pocには--poc-declarationが必要です");
    if (requestedMode !== "poc" && declarationFile !== undefined)
      throw new Error("--poc-declarationは--mode=pocだけで使用できます");
    const parsedPoc =
      typeof declarationFile === "string"
        ? parsePocDeclaration(
            fs.readFileSync(path.resolve(declarationFile), "utf8"),
          )
        : { errors: [] as string[] };
    if (parsedPoc.errors.length > 0)
      throw new Error(`PoC宣言が不正です: ${parsedPoc.errors.join("; ")}`);
    print(
      createIssueStaging(root, {
        title: required(flags, "title"),
        answers: assessment,
        requestedMode,
        ...(parsedPoc.declaration ? { poc: parsedPoc.declaration } : {}),
        changedFiles:
          typeof flags.changed === "string"
            ? flags.changed.split(",").filter(Boolean)
            : [],
        now: new Date(),
      }),
    );
    return 0;
  }
  if (command === "issue" && subcommand === "validate") {
    const { flags, positionals } = parse(rest);
    const target = positionals[0] ?? required(flags, "path");
    const stage = flags.stage;
    if (stage !== undefined && stage !== "requirements" && stage !== "design")
      throw new Error("--stageはrequirementsまたはdesignで指定してください");
    const result = validateIssue(path.resolve(target), {
      changedFiles:
        typeof flags.changed === "string"
          ? flags.changed.split(",").filter(Boolean)
          : [],
      stage: stage as IssueValidationStage | undefined,
    });
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === "issue" && subcommand === "sync") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const input = {
      operation: "issue.sync",
      repository: required(flags, "repo"),
      issue: Number(required(flags, "issue")),
      bodyFile: path.resolve(required(flags, "body-file")),
    };
    if (!apply) {
      print({ state: "preview", ...input });
      return 0;
    }
    if (flags.authorize !== "approved")
      throw new Error("Issue同期には--authorize=approvedが必要です");
    const bodyBefore = fs
      .readFileSync(input.bodyFile, "utf8")
      .replace(/\r\n/g, "\n")
      .trimEnd();
    const stagingPath =
      typeof flags["staging-path"] === "string"
        ? path.resolve(flags["staging-path"])
        : undefined;
    const checkpointRaw = flags.checkpoint;
    /**
     * **入力の不整合は同期の前に拒否する。** 後で拒否すると、Issueは同期済みなのに
     * commandが失敗した状態になり、利用者は何が起きたか判別できない（Issue #994）。
     *
     * 最終同期checkpointはquickとpocがStep 4、fullがStep 8である
     * （`.agent-skill-chain/skills/step-04-issue-sync/SKILL.md`）。
     * **fullのStep 4は最終同期ではないため同期記録を更新しない。**
     * 記録先はjournalであり、片方だけを渡した利用者へその手順まで返す。
     */
    if ((stagingPath === undefined) !== (checkpointRaw === undefined))
      throw new Error(
        "同期記録を更新する場合は--staging-pathと--checkpointを両方指定してください。最終同期checkpointはquickとpocがStep 4、fullがStep 8です。fullのStep 4では同期記録を更新せず、workflow record --step=4でtrackerをartifact、digest一致をevidenceとしてjournalへ残してください",
      );
    if (
      stagingPath !== undefined &&
      (typeof checkpointRaw !== "string" || !/^(?:4|8)$/u.test(checkpointRaw))
    )
      throw new Error("--checkpointは4または8で指定してください");
    const syncAndRecord = () => {
      if (stagingPath !== undefined)
        recoverPendingJournalTransaction(stagingPath);
      /**
       * **staging記録の書き込み可否も同期の前に確かめる。**
       * writer lockを副作用と記録の両方へ保持し、途中で昇格やjournal追記を割り込ませない。
       */
      const stagingBefore =
        stagingPath === undefined
          ? undefined
          : assertStagingSyncTarget(
              stagingPath,
              Number(checkpointRaw),
              {
                repository: input.repository,
                issue: input.issue,
              },
              { allowPromotionStep4: true },
            );
      const result = github("issue.sync", input, process.cwd());
      if (stagingPath === undefined) return result;
      if (
        Number(checkpointRaw) === 4 &&
        stagingBefore?.state === "promotion-active"
      )
        return {
          ...result,
          staging: stagingBefore,
          stagingRecordUpdated: false,
        };
      const bodyAfter = fs
        .readFileSync(input.bodyFile, "utf8")
        .replace(/\r\n/g, "\n")
        .trimEnd();
      const bodyDigest = crypto
        .createHash("sha256")
        .update(bodyBefore)
        .digest("hex");
      const readBackDigest = crypto
        .createHash("sha256")
        .update(bodyAfter)
        .digest("hex");
      const record = recordStagingSync(stagingPath, {
        tracker: result.url,
        checkpoint: Number(checkpointRaw),
        syncedAt:
          typeof flags["synced-at"] === "string"
            ? flags["synced-at"]
            : new Date().toISOString(),
        bodyDigest,
        readBackDigest,
      });
      return { ...result, staging: record };
    };
    const result =
      stagingPath === undefined
        ? syncAndRecord()
        : withStagingMutationLock(stagingPath, syncAndRecord);
    print(result);
    return 0;
  }
  if (command === "issue" && subcommand === "staging") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    if (flags.apply !== undefined && flags.apply !== true) {
      const reasons = ["--applyは値を付けずに指定してください"];
      print({
        state: "rejected",
        removed: [],
        retained: [],
        recovery: ["値を除いた--applyで新しいpreviewから再実行してください"],
        diagnostic: stagingCleanupDiagnostic(reasons),
      });
      return 1;
    }
    const retentionRaw =
      typeof flags["retention-days"] === "string"
        ? flags["retention-days"]
        : "0";
    if (!/^\d+$/u.test(retentionRaw)) {
      const reasons = ["--retention-daysは0以上の整数で指定してください"];
      print({
        state: "rejected",
        removed: [],
        retained: [],
        recovery: ["利用projectが決めた保持日数で再previewしてください"],
        diagnostic: stagingCleanupDiagnostic(reasons),
      });
      return 1;
    }
    const now =
      typeof flags.now === "string" ? flags.now : new Date().toISOString();
    const retentionDays = Number(retentionRaw);
    let plan: ReturnType<typeof planStagingCleanup>;
    try {
      plan = planStagingCleanup({ root, now, retentionDays });
    } catch (error) {
      const reasons = [error instanceof Error ? error.message : String(error)];
      print({
        state: "rejected",
        removed: [],
        retained: [],
        recovery: ["root、now、保持日数を確認して再previewしてください"],
        diagnostic: stagingCleanupDiagnostic(reasons),
      });
      return 1;
    }
    if (flags.apply !== true) {
      print(plan);
      return 0;
    }
    const result = applyStagingCleanup(
      {
        plan,
        approvedHash:
          typeof flags["approved-hash"] === "string"
            ? flags["approved-hash"]
            : "",
        root,
        now,
        retentionDays,
      },
      (target) => removeStagingTarget(plan.root, target),
    );
    print(
      result.state === "rejected"
        ? {
            ...result,
            diagnostic: stagingCleanupDiagnostic(
              result.retained.map((item) => item.reason),
            ),
          }
        : result,
    );
    return result.state === "completed" ? 0 : 1;
  }
  if (command === "project" && subcommand === "bootstrap") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const kind = required(flags, "kind");
    if (
      ![
        "cli",
        "api",
        "service",
        "library",
        "batch",
        "data",
        "ui",
        "theme",
        "responsive",
        "design-system",
      ].includes(kind)
    )
      throw new Error("--kindが不正です");
    print(
      bootstrapProject(root, {
        apply,
        newProject: flags["new-project"] === true,
        onboardExisting: flags["onboard-existing"] === true,
        projectKind: kind as ProjectKind,
      }),
    );
    return 0;
  }
  if (command === "spec" && subcommand === "validate") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const review =
      typeof flags.review === "string"
        ? readSpecReview(flags.review)
        : undefined;
    const result = validateSpecs(root, {
      changedFiles:
        typeof flags.changed === "string"
          ? flags.changed.split(",").filter(Boolean)
          : [],
      review,
    });
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === "review" && subcommand === "validate") {
    const { flags, positionals } = parse(rest);
    const file = positionals[0] ?? required(flags, "file");
    const result = evaluateReview(readJsonInput(file));
    if (result.approved) {
      const pending = {
        ...result,
        approved: false,
        status: "pending",
        errors: [
          ...result.errors,
          "file由来のGitHub metadataはauthorityではありません。review evidenceでtrusted providerを実観測してください",
        ],
      };
      print(pending);
      return 1;
    }
    print(result);
    return 1;
  }
  if (command === "review" && subcommand === "round") {
    const { flags, positionals } = parse(rest);
    const unknown = Object.keys(flags).filter(
      (flag) => !["staging", "file", "apply"].includes(flag),
    );
    if (unknown.length > 0)
      throw new Error(
        `review roundの未知optionです: --${unknown.join(", --")}`,
      );
    if (positionals.length > 0)
      throw new Error("review roundに位置引数は使用できません");
    const staging = required(flags, "staging");
    const file = path.resolve(required(flags, "file"));
    const round = parseReviewRoundInput(readJsonInput(file));
    const apply = flags.apply === true;
    if (flags.apply !== undefined && !apply)
      throw new Error("review round --applyに値は指定できません");
    const state = apply
      ? recordReviewRound({ staging, round })
      : previewReviewRound({ staging, round });
    print({ applied: apply, ...state });
    return 0;
  }
  if (command === "review" && subcommand === "evidence") {
    const { flags } = parse(rest);
    if (flags.external !== undefined)
      throw new Error(
        "--externalの自己申告JSONはreview証拠として使用できません。trusted GitHub providerの明示IDを指定してください",
      );
    if (flags["implementer-actor-id"] !== undefined)
      throw new Error(
        "--implementer-actor-idは自己申告authorityになるため使用できません。H_impl commit authorをGitHubから観測します",
      );
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const implementationCommitSha = required(flags, "implementation-commit");
    const finalCommitSha = required(flags, "final-commit");
    if (
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(implementationCommitSha) ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(finalCommitSha)
    )
      throw new Error(
        "implementation/final commitは完全なGit OIDで指定してください",
      );
    const artifactInput = required(flags, "artifact");
    const artifactFile = resolveContained(root, artifactInput);
    const artifactPath = path
      .relative(root, artifactFile)
      .split(path.sep)
      .join("/");
    if (artifactPath !== artifactInput)
      throw new Error(
        "--artifactは正規化済みrepository相対pathで指定してください",
      );
    const resolveCommit = (oid: string): string =>
      git(["rev-parse", "--verify", `${oid}^{commit}`], root).stdout.trim();
    if (
      resolveCommit(implementationCommitSha) !== implementationCommitSha ||
      resolveCommit(finalCommitSha) !== finalCommitSha
    )
      throw new Error("指定commitを完全OIDへ一意に解決できません");
    const implementationTreeSha = git(
      ["rev-parse", `${implementationCommitSha}^{tree}`],
      root,
    ).stdout.trim();
    const ancestry = git(
      ["merge-base", "--is-ancestor", implementationCommitSha, finalCommitSha],
      root,
      { allowFailure: true },
    );
    const changedPaths = git(
      [
        "diff",
        "--name-only",
        `${implementationCommitSha}..${finalCommitSha}`,
        "--",
      ],
      root,
    )
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    const blobOid = git(
      ["rev-parse", `${finalCommitSha}:${artifactPath}`],
      root,
    ).stdout.trim();
    const artifactContent = git(
      ["show", `${finalCommitSha}:${artifactPath}`],
      root,
    ).stdout;
    const repository = required(flags, "repo");
    const prRaw = required(flags, "pr");
    const runId = required(flags, "run-id");
    const reviewId = required(flags, "review-id");
    if (
      !/^[1-9]\d*$/u.test(prRaw) ||
      !/^[1-9]\d*$/u.test(runId) ||
      !/^[1-9]\d*$/u.test(reviewId)
    )
      throw new Error(
        "PR、Actions run、reviewは正のimmutable IDで指定してください",
      );
    const externalEvidence = github(
      "review.evidence",
      {
        repository,
        pr: Number(prRaw),
        runId,
        reviewId,
        implementationCommitSha,
      },
      root,
    );
    const result = buildReviewEvidence({
      implementationCommitSha,
      finalCommitSha,
      implementationTreeSha,
      implementationIsAncestor: ancestry.status === 0,
      changedPaths,
      artifact: {
        path: artifactPath,
        sha256: crypto
          .createHash("sha256")
          .update(artifactContent)
          .digest("hex"),
        blobOid,
      },
      externalEvidence,
    });
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === "trace" && subcommand === "validate") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const choices = loadProjectPolicySet(root).policy.projectChoices;
    const result = validateScenarioTrace(
      readJsonInput(path.resolve(required(flags, "evidence"))),
      { layers: choices?.testLayers },
    );
    print(result);
    return result.valid ? 0 : 1;
  }
  if (command === "conformance" && subcommand === "validate") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const contract = readJsonInput(path.resolve(required(flags, "contract")));
    const binding = readJsonInput(path.resolve(required(flags, "binding")));
    const evidence = readJsonInput(path.resolve(required(flags, "evidence")));
    const projectPolicyFile = path.join(
      root,
      ".agent-skill-chain",
      "project-policy.json",
    );
    const rules = fs.existsSync(projectPolicyFile)
      ? loadProjectPolicySet(root).rules
      : [];
    const result = validateRepositoryConformance(
      root,
      contract,
      binding,
      evidence,
      rules,
    );
    print(
      result.valid
        ? result
        : serializeDiagnostic({
            ...result,
            diagnostic: {
              ruleId: "ASC-CONFORMANCE-001",
              purpose: "機能拡張不変条件を実行可能な証拠へ結ぶ",
              risk: "quality",
              reasons: result.errors,
              scope: ["conformance"],
              checks: [
                "exact invariant、source、enforcement point、project rule参照、SCN、成功証拠を検証した",
              ],
              autoFixes: [],
              next: "不足するproject bindingまたは成功証拠を追加してください",
              requiredAuthority: "project owner",
              rollback: "不完全なbindingを適用しない",
            },
          }),
    );
    return result.valid ? 0 : 1;
  }
  if (command === "policy" && subcommand === "validate") {
    const { flags, positionals } = parse(rest);
    const file = path.resolve(positionals[0] ?? required(flags, "file"));
    const root = path.resolve(
      typeof flags.root === "string"
        ? flags.root
        : path.join(path.dirname(file), ".."),
    );
    const explicitKeys = [
      "trusted-commit",
      "expected-base-sha",
      "candidate-head-sha",
      "base-ref",
      "default-branch",
      "repo",
      "pr",
    ];
    const explicitMode = explicitKeys.some((key) => flags[key] !== undefined);
    let explicitTrusted;
    if (explicitMode) {
      const trustedCommit = required(flags, "trusted-commit");
      const expectedBaseSha = required(flags, "expected-base-sha");
      const candidateHeadSha = required(flags, "candidate-head-sha");
      const baseRef = required(flags, "base-ref");
      const defaultBranch = required(flags, "default-branch");
      const repository = required(flags, "repo");
      const prRaw = required(flags, "pr");
      if (!/^[1-9]\d*$/u.test(prRaw))
        throw new Error("--prは正のPR numberで指定してください");
      const pr = Number(prRaw);
      let provider;
      try {
        provider = github("policy.authority", { repository, pr }, root);
      } catch (error) {
        if (error instanceof GitHubProviderUnavailableError) {
          print(policyAuthorityFailure("pending", error.message));
          return 1;
        }
        throw error;
      }
      explicitTrusted = {
        trustedCommit,
        expectedBaseSha,
        candidateHeadSha,
        baseRef,
        defaultBranch,
        repository,
        pr,
        provider,
      };
      const entrypoint = path.resolve(
        root,
        ".agent-skill-chain/project-policy.json",
      );
      if (file !== entrypoint)
        throw new Error(
          "explicit PR validateのentrypointは.agent-skill-chain/project-policy.jsonに限定されます",
        );
      let trustedSet;
      let candidateSet;
      try {
        trustedSet = loadOperationPolicy(root, explicitTrusted);
        candidateSet = loadProjectPolicySetAtCommit(root, candidateHeadSha);
        if (
          candidateSet.manifest.schemaVersion !==
          "agent-skill-chain/project-policy-manifest/v1"
        )
          throw new Error(
            "explicit trusted commitを使うCI validateはcandidate commitの完全なfragmented project policy setを必須とします",
          );
      } catch (error) {
        print(
          policyAuthorityFailure(
            "rejected",
            error instanceof Error ? error.message : String(error),
          ),
        );
        return 1;
      }
      const effective = resolveEffectivePolicy(
        trustedSet.policy,
        candidateSet.policy,
      );
      if (!effective.valid) {
        print(
          serializeDiagnostic({
            allowed: false,
            candidateSetHash: candidateSet.setHash,
            trustedSetHash: trustedSet.setHash,
            diagnostic: effective.diagnostic,
          }),
        );
        return 1;
      }
      const candidateChoices = choicesFragmentSource(candidateSet);
      const comparison = compareTrustedPolicy(
        trustedSet.policy,
        effective.policy,
        {
          trustedConformance: conformanceDeclarationFromPolicySet(trustedSet),
          candidateConformance:
            conformanceDeclarationFromPolicySet(candidateSet),
          candidateChoicesRaw: candidateChoices?.raw,
          choicesFragmentPath: candidateChoices?.path,
        },
      );
      if (!comparison.allowed) {
        const result = {
          valid: false,
          status: "rejected",
          candidateSetHash: candidateSet.setHash,
          trustedSetHash: trustedSet.setHash,
          errors: comparison.rejected.flatMap((item) => item.reasons),
        };
        print(
          serializeDiagnostic({
            ...result,
            diagnostic: comparison.rejected[0],
          }),
        );
        return 1;
      }
      let recheckedProvider;
      try {
        recheckedProvider = github(
          "policy.authority",
          { repository, pr },
          root,
        );
      } catch (error) {
        print(
          policyAuthorityFailure(
            "pending",
            error instanceof Error ? error.message : String(error),
          ),
        );
        return 1;
      }
      if (!samePolicyAuthorityObservation(provider, recheckedProvider)) {
        print(
          policyAuthorityFailure(
            "pending",
            "provider authority tupleが検証中に変更されました",
          ),
        );
        return 1;
      }
      const result = {
        valid: true,
        status: "validated",
        candidateSetHash: candidateSet.setHash,
        candidateSemanticPolicyHash: candidateSet.semanticPolicyHash,
        candidateProvenance: candidateSet.provenance,
        trustedSetHash: trustedSet.setHash,
        trustedProvenance: trustedSet.provenance,
        stagedAdditions: comparison.stagedAdditions,
        errors: [],
        warnings: mergeMethodPolicyWarnings(candidateSet.policy),
      };
      print(
        result.valid
          ? result
          : serializeDiagnostic({
              ...result,
              diagnostic: comparison.rejected[0],
            }),
      );
      return result.valid ? 0 : 1;
    }
    const manifestRaw = fs.readFileSync(file, "utf8");
    const parsed = parseJsonStrict(manifestRaw, file);
    if (
      isRecord(parsed) &&
      parsed.schemaVersion === "agent-skill-chain/project-policy-manifest/v1"
    ) {
      let candidateSet;
      try {
        candidateSet = loadProjectPolicySet(root, { manifestRaw });
      } catch (error) {
        print({
          valid: false,
          errors: [error instanceof Error ? error.message : String(error)],
        });
        return 1;
      }
      const trustedSet = loadOperationPolicy(root);
      const effective = resolveEffectivePolicy(
        trustedSet.policy,
        candidateSet.policy,
      );
      if (!effective.valid) {
        print(
          serializeDiagnostic({
            allowed: false,
            candidateSetHash: candidateSet.setHash,
            trustedSetHash: trustedSet.setHash,
            diagnostic: effective.diagnostic,
          }),
        );
        return 1;
      }
      const candidateChoices = choicesFragmentSource(candidateSet);
      const comparison = compareTrustedPolicy(
        trustedSet.policy,
        effective.policy,
        {
          trustedConformance: conformanceDeclarationFromPolicySet(trustedSet),
          candidateConformance:
            conformanceDeclarationFromPolicySet(candidateSet),
          candidateChoicesRaw: candidateChoices?.raw,
          choicesFragmentPath: candidateChoices?.path,
        },
      );
      const result = {
        valid: comparison.allowed,
        candidateSetHash: candidateSet.setHash,
        candidateSemanticPolicyHash: candidateSet.semanticPolicyHash,
        trustedSetHash: trustedSet.setHash,
        trustedProvenance: trustedSet.provenance,
        stagedAdditions: comparison.stagedAdditions,
        errors: comparison.rejected.flatMap((item) => item.reasons),
        warnings: comparison.allowed
          ? mergeMethodPolicyWarnings(candidateSet.policy)
          : [],
      };
      print(
        result.valid
          ? result
          : serializeDiagnostic({
              ...result,
              diagnostic: comparison.rejected[0],
            }),
      );
      return result.valid ? 0 : 1;
    }
    const policy = parsed;
    const result = validatePolicy(policy);
    print(
      result.valid
        ? result
        : serializeDiagnostic({ ...result, diagnostic: result.diagnostics[0] }),
    );
    return result.valid ? 0 : 1;
  }
  if (command === "policy" && subcommand === "evaluate") {
    const { flags } = parse(rest);
    const trustedValue = readJsonInput(
      path.resolve(required(flags, "trusted")),
    );
    const candidateValue = readJsonInput(
      path.resolve(required(flags, "candidate")),
    );
    const trustedValidation = validatePolicy(trustedValue);
    const candidateValidation = validatePolicy(candidateValue);
    if (!trustedValidation.valid || !candidateValidation.valid) {
      const diagnostic =
        trustedValidation.diagnostics[0] ?? candidateValidation.diagnostics[0];
      print(
        serializeDiagnostic({
          allowed: false,
          code: "ASC-POLICY-INVALID",
          trustedErrors: trustedValidation.errors,
          candidateErrors: candidateValidation.errors,
          diagnostic,
        }),
      );
      return 1;
    }
    if (!isPolicyInput(trustedValue) || !isPolicyInput(candidateValue))
      throw new Error("検証済みpolicy入力の型確定に失敗しました");
    const result = compareTrustedPolicy(trustedValue, candidateValue);
    print(
      result.allowed
        ? result
        : serializeDiagnostic({ ...result, diagnostic: result.rejected[0] }),
    );
    return result.allowed ? 0 : 1;
  }
  if (command === "policy" && subcommand === "enforce") {
    const { flags } = parse(rest);
    const policy = readPolicyJson(path.resolve(required(flags, "policy")));
    const input = readEnforcementInput(path.resolve(required(flags, "input")));
    const result = enforceOperation({ ...input, policy });
    print(result.allowed ? result : serializeDiagnostic(result));
    return result.allowed ? 0 : 1;
  }
  if (command === "policy" && subcommand === "migrate") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const expectedRevision = apply
      ? requiredExpectedRevision(flags)
      : undefined;
    const operation =
      typeof flags.operation === "string" ? flags.operation : "apply";
    if (!["apply", "rollback", "retry", "recover"].includes(operation))
      throw new Error(
        "--operationはapply、rollback、retry、recoverのいずれかです",
      );
    const stateFile =
      typeof flags.state === "string" ? path.resolve(flags.state) : undefined;
    if (apply && !stateFile)
      throw new Error("--applyには--state=...が必要です");
    let result;
    const trustedFile =
      typeof flags.trusted === "string"
        ? path.resolve(flags.trusted)
        : undefined;
    const candidateFile =
      typeof flags.candidate === "string"
        ? path.resolve(flags.candidate)
        : undefined;
    const trusted = trustedFile ? readPolicyFileInput(trustedFile) : undefined;
    const candidate = candidateFile
      ? readPolicyFileInput(candidateFile)
      : undefined;
    if (operation === "apply") {
      if (!trusted || !candidate)
        throw new Error("applyには--trustedと--candidateが必要です");
      const trustedValidation = validatePolicy(assembledPolicy(trusted));
      const candidateValidation = validatePolicy(assembledPolicy(candidate));
      if (!trustedValidation.valid || !candidateValidation.valid) {
        const diagnostic =
          trustedValidation.diagnostics[0] ??
          candidateValidation.diagnostics[0];
        print(
          serializeDiagnostic({
            state: "rejected",
            allowed: false,
            diagnostic,
          }),
        );
        return 1;
      }
      if (typeof flags.manifest === "string") {
        const manifest = readMigrationManifest(path.resolve(flags.manifest));
        const plan = planFileMigration(
          path.resolve(manifest.root),
          trusted,
          candidate,
          manifest.entries ?? [],
        );
        if (apply) {
          const approvedPlanHash = required(flags, "approved-plan-hash");
          if (
            !("planFingerprint" in plan) ||
            approvedPlanHash !== plan.planFingerprint
          )
            throw new Error("approved plan hashがdry-run planと一致しません");
          const durableStateFile = stateFile;
          if (durableStateFile === undefined)
            throw new Error("--stateが必要です");
          const persist = (value: unknown): void =>
            writeFileAtomic(
              durableStateFile,
              `${JSON.stringify(value, null, 2)}\n`,
            );
          persist(plan);
          result = applyFileMigration(
            plan as MigrationState,
            trusted,
            candidate,
            { approvedPlanHash, expectedRevision, persist },
          );
        } else result = plan;
      } else {
        if (isPolicySet(trusted) || isPolicySet(candidate))
          throw new Error(
            "fragmented project policy setのmigrationにはraw inventoryを列挙する--manifestが必要です",
          );
        const plan = planMigration(trusted, candidate);
        if (apply && stateFile !== undefined)
          writeFileAtomic(stateFile, `${JSON.stringify(plan, null, 2)}\n`);
        result = apply
          ? applyMigration(plan, {
              approvedPlanHash: required(flags, "approved-plan-hash"),
              expectedRevision,
            })
          : plan;
      }
    } else {
      if (!stateFile || !fs.existsSync(stateFile))
        throw new Error("rollback/retryには既存の--stateが必要です");
      const loadedState = readMigrationState(stateFile);
      const state = loadedState.state;
      const fileMigrationState = loadedState.kind === "file";
      if (!apply) {
        print({
          state: "preview",
          operation,
          currentRevision: state.revision,
          requiredApproval: "approved-plan-hash",
          requiredExpectedRevision: state.revision,
        });
        return 0;
      }
      if (fileMigrationState) {
        if (!trusted || !candidate)
          throw new Error(
            "実manifestのrollback/retryには--trustedと--candidateが必要です",
          );
        const approvedPlanHash = required(flags, "approved-plan-hash");
        const persist = (value: unknown): void =>
          writeFileAtomic(stateFile, `${JSON.stringify(value, null, 2)}\n`);
        if (loadedState.kind !== "file")
          throw new Error("file migration stateの型確定に失敗しました");
        const migrationState = loadedState.state;
        result =
          operation === "rollback"
            ? rollbackFileMigration(migrationState, trusted, candidate, {
                approvedPlanHash,
                expectedRevision,
                persist,
              })
            : operation === "retry"
              ? retryFileMigration(migrationState, trusted, candidate, {
                  approvedPlanHash,
                  expectedRevision,
                  persist,
                })
              : recoverFileMigration(migrationState, trusted, candidate, {
                  approvedPlanHash,
                  expectedRevision,
                  persist,
                });
      } else {
        if (operation === "retry" && (!trusted || !candidate))
          throw new Error("retryには--trustedと--candidateが必要です");
        const authority = {
          approvedPlanHash: required(flags, "approved-plan-hash"),
          expectedRevision,
        };
        if (loadedState.kind !== "conceptual")
          throw new Error("conceptual migration stateの型確定に失敗しました");
        const conceptualState = loadedState.state;
        if (operation !== "rollback" && (!trusted || !candidate))
          throw new Error(
            "conceptual migration retryにはtrustedとcandidateが必要です",
          );
        if (operation === "rollback")
          result = rollbackMigration(conceptualState, authority);
        else {
          if (!trusted || !candidate)
            throw new Error(
              "conceptual migration retryにはtrustedとcandidateが必要です",
            );
          result = retryMigration(
            conceptualState,
            assembledPolicy(trusted),
            assembledPolicy(candidate),
            authority,
          );
        }
      }
    }
    if (apply && result.state === "rejected") {
      const reportFile =
        typeof flags.report === "string"
          ? path.resolve(flags.report)
          : `${stateFile}.report.json`;
      writeFileAtomic(reportFile, `${JSON.stringify(result, null, 2)}\n`);
    } else if (apply) {
      if (stateFile === undefined) throw new Error("--stateが必要です");
      writeFileAtomic(stateFile, `${JSON.stringify(result, null, 2)}\n`);
    }
    print(
      result.state === "rejected"
        ? serializeDiagnostic(result)
        : printableMigration(result),
    );
    return result.state === "rejected" || result.allowed === false ? 1 : 0;
  }
  if (command === "worktree" && subcommand === "create") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const trustedSet = loadOperationPolicy(root);
    const explicitWorktreePath =
      typeof flags.path === "string" ? flags.path : undefined;
    const issueRaw = required(flags, "issue");
    if (!/^[1-9]\d*$/u.test(issueRaw))
      throw new Error("--issueは1以上の整数で指定してください");
    const issueNumber = Number(issueRaw);
    if (!Number.isSafeInteger(issueNumber))
      throw new Error("--issueは安全な整数範囲で指定してください");
    const branch = required(flags, "branch");
    const slug = required(flags, "slug");
    const policy = trustedSet.policy.worktree ?? DEFAULT_WORKTREE_PLACEMENT;
    const currentTime = (dependencies.now ?? (() => new Date()))();
    const worktreePath =
      explicitWorktreePath !== undefined
        ? explicitWorktreePath
        : buildWorktreePath({ issueNumber, slug, currentTime, policy });
    if (explicitWorktreePath === undefined)
      enforceTrustedWorktreeBoundary({
        repoRoot: root,
        worktreePath,
        expectedRepository:
          typeof flags.repo === "string" ? flags.repo : undefined,
        trustedPolicy: trustedSet.policy,
      });
    const placement = validateWorktreePlacement({
      repoRoot: root,
      worktreePath,
      branch,
      issueNumber,
      slug,
      currentTime,
      policy,
      existing: cliRegisteredWorktrees(root),
    });
    if (!placement.valid) {
      print(
        serializeDiagnostic({
          allowed: false,
          code: "ASC-WORKTREE-PLACEMENT-001",
          diagnostic: {
            ruleId: "ASC-WORKTREE-PLACEMENT-001",
            purpose: "worktreeの配置・命名・重複境界を強制する",
            risk: "path",
            reasons: placement.errors,
            scope: ["worktree", "create"],
            checks: [
              "project policy、現在時刻、timestamp、path、Issue番号、slug、branch、登録済みworktreeを検証した",
            ],
            autoFixes: [],
            next: "--pathを省略するか、現在時刻から10分以内の規定名と許可されたbranch typeを指定してください",
            requiredAuthority: "不要",
            rollback: "worktreeを作成せず既存状態を保持する",
          },
        }),
      );
      return 1;
    }
    print(
      createWorktree({
        repoRoot: root,
        worktreePath,
        branch,
        base: required(flags, "base"),
        issueNumber,
        slug,
        currentTime,
        worktreePolicy: policy,
        remoteDefaultBranch: required(flags, "remote-default-branch"),
        remoteDefaultSha: required(flags, "remote-default-sha"),
        expectedRepository:
          typeof flags.repo === "string" ? flags.repo : undefined,
        trustedPolicy: trustedSet.policy,
        preview: !apply,
      }),
    );
    return 0;
  }
  if (command === "worktree" && subcommand === "survey") {
    const { flags } = parse(rest);
    if (flags.apply !== undefined)
      throw new Error(
        "worktree surveyはread-onlyのため--applyを受け付けません",
      );
    const root = path.resolve(required(flags, "root"));
    const format = flags.format ?? "json";
    if (format !== "json" && format !== "text")
      throw new Error("--formatはjsonまたはtextで指定してください");
    const survey = collectWorktreeSurvey(root);
    if (format === "text") printWorktreeSurveyText(survey);
    else print(survey);
    return survey.errors.length === 0 ? 0 : 1;
  }
  if (command === "worktree" && subcommand === "hygiene") {
    const { flags } = parse(rest);
    const root = required(flags, "root");
    if (flags.apply !== undefined && flags.apply !== true)
      throw new Error("--applyは値を付けずに指定してください");
    const report = previewWorkspaceHygiene({ root });
    if (flags.apply !== true) {
      print(report);
      return 0;
    }
    const result = applyWorkspaceHygiene(
      {
        report,
        approvedHash: required(flags, "approved-hash"),
        root,
        operations: hygieneOperations(flags),
      },
      (target) => removeHygieneTarget(report.root, target),
    );
    print(result);
    return 0;
  }
  if (command === "worktree" && subcommand === "finalize") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(required(flags, "root"));
    const target = path.resolve(required(flags, "path"));
    const evidence = readFinalizeEvidence(required(flags, "evidence"));
    if (flags.complete !== undefined) {
      if (flags.complete !== true)
        throw new Error("--completeは値を付けずに指定してください");
      if (
        flags["cleanup-authority"] !== undefined &&
        flags["cleanup-authority"] !== true
      )
        throw new Error("--cleanup-authorityは値を付けずに指定してください");
      return executeCompletionFlow({
        apply,
        root,
        target,
        evidence,
        mergeSha: required(flags, "merge-sha"),
        approvedDigest:
          typeof flags["approved-digest"] === "string"
            ? flags["approved-digest"]
            : "",
        cleanupAuthorityGranted: flags["cleanup-authority"] === true,
        authorized: flags.authorize === "approved",
      });
    }
    if (flags["update-root"] !== undefined && flags["update-root"] !== true)
      throw new Error("--update-rootは値を付けずに指定してください");
    const updateRoot = flags["update-root"] === true;
    const mergeSha = updateRoot ? required(flags, "merge-sha") : undefined;
    const ignoredPathAllowlist = finalizeIgnoredPathAllowlist(root);
    const state = inspectFinalizeState(
      root,
      target,
      evidence,
      ignoredPathAllowlist,
    );
    const initialRootObservation = mergeSha
      ? observeRootUpdate(root, mergeSha)
      : undefined;
    const reportState =
      initialRootObservation &&
      (evidence.base === initialRootObservation.defaultBranch ||
        evidence.base === initialRootObservation.upstreamRef)
        ? { ...state, baseSha: mergeSha }
        : state;
    const report = buildFinalizeReport(reportState);
    const cleanup = planWorktreeCleanup({
      repositoryRoot: root,
      target: { path: target, branch: state.branch },
      registered: registeredWorktrees(root),
      prMerged: state.prMerged === true,
      clean: state.dirty === false,
      trackedChanges: state.dirty,
      pushed: state.pushed,
      remoteBranch: state.remoteBranch,
      recoveryReachable: state.recoveryReachable,
      reachableFromDefaultBranch: state.reachableFromDefaultBranch,
      untracked: state.untracked,
      stashes: state.stashes,
      temporaryArtifacts: state.temporaryArtifacts,
      ignoredArtifacts: state.ignoredArtifacts,
      ignoredPathAllowlist,
    });
    let rootPlan = initialRootObservation
      ? planRootUpdate(initialRootObservation)
      : undefined;
    if (!apply) {
      print({
        ...report,
        cleanup,
        ...(rootPlan ? { rootUpdate: rootPlan } : {}),
      });
      return report.safe &&
        cleanup.state === "ready" &&
        (!rootPlan || rootPlan.state === "ready")
        ? 0
        : 1;
    }
    const approvedHash = required(flags, "report-hash");
    if (flags.authorize !== "approved")
      throw new Error("完了処理の適用には--authorize=approvedが必要です");
    if (!report.safe) {
      print(report);
      return 1;
    }
    if (!/^[a-f0-9]{64}$/u.test(approvedHash) || approvedHash !== report.hash)
      throw new Error("明示承認が報告ハッシュと一致しません");
    if (cleanup.state === "rejected") {
      print({ allowed: false, operation: "worktree.remove", ...cleanup });
      return 1;
    }
    const trustedPolicy = loadOperationPolicy(root).policy;
    if (mergeSha) {
      const initial = observeRootUpdate(root, mergeSha);
      const locallySafe =
        initial.rootPath.trim() !== "" &&
        initial.currentBranch === initial.defaultBranch &&
        !initial.dirty &&
        initial.untracked.length === 0 &&
        initial.upstreamRef !== undefined &&
        /^[a-f0-9]{40}$/iu.test(initial.mergeSha) &&
        initial.remoteSha === initial.mergeSha;
      if (locallySafe && initial.upstreamSha !== initial.remoteSha) {
        git(
          [
            "fetch",
            "--no-tags",
            "origin",
            `refs/heads/${initial.defaultBranch}:refs/remotes/origin/${initial.defaultBranch}`,
          ],
          root,
        );
      }
      rootPlan = planRootUpdate(observeRootUpdate(root, mergeSha));
      if (rootPlan.state === "rejected") {
        print(rootUpdateDiagnostic(rootPlan));
        return 1;
      }
      if (rootPlan.from !== rootPlan.to)
        git(["merge", "--ff-only", mergeSha], root);
      const observedHead = git(["rev-parse", "HEAD"], root).stdout.trim();
      if (observedHead !== mergeSha) {
        print(
          rootUpdateDiagnostic({
            state: "rejected",
            from: rootPlan.from,
            to: mergeSha,
            reasons: ["適用後のroot HEADが検証済みmerge SHAと一致しません"],
            recovery: [
              "root worktreeとorigin/mainの状態を確認し、変更を加えずに再検証する",
            ],
          }),
        );
        return 1;
      }
    }
    const currentIgnoredPathAllowlist = finalizeIgnoredPathAllowlist(root);
    const currentState = inspectFinalizeState(
      root,
      target,
      evidence,
      currentIgnoredPathAllowlist,
    );
    const currentCleanup = planWorktreeCleanup({
      repositoryRoot: root,
      target: { path: target, branch: currentState.branch },
      registered: registeredWorktrees(root),
      prMerged: currentState.prMerged === true,
      clean: currentState.dirty === false,
      trackedChanges: currentState.dirty,
      pushed: currentState.pushed,
      remoteBranch: currentState.remoteBranch,
      recoveryReachable: currentState.recoveryReachable,
      reachableFromDefaultBranch: currentState.reachableFromDefaultBranch,
      untracked: currentState.untracked,
      stashes: currentState.stashes,
      temporaryArtifacts: currentState.temporaryArtifacts,
      ignoredArtifacts: currentState.ignoredArtifacts,
      ignoredPathAllowlist: currentIgnoredPathAllowlist,
    });
    if (currentCleanup.state === "rejected") {
      print({
        allowed: false,
        operation: "worktree.remove",
        ...currentCleanup,
      });
      return 1;
    }
    const result = applyFinalize(
      {
        report,
        approvedHash,
        currentState,
        trustedPolicy,
      },
      (operation, payload) => {
        if (operation !== "worktree.remove")
          throw new Error("未対応の完了処理です");
        if (typeof payload.path !== "string")
          throw new Error("worktree pathが不正です");
        git(["worktree", "remove", payload.path], root);
      },
    );
    print(result);
    return 0;
  }
  if (command === "pr" && subcommand === "create") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const issueRaw = required(flags, "issue");
    if (!/^[1-9]\d*$/u.test(issueRaw))
      throw new Error("--issueは正のIssue番号で指定してください");
    const issue = Number(issueRaw);
    const repository = required(flags, "repo");
    const staging = resolvePullRequestStaging({
      root,
      staging: typeof flags.staging === "string" ? flags.staging : undefined,
      issue,
      repository,
    });
    const replayState = readStoredDeliveryState(staging);
    if (replayState?.pr) {
      const replayHead = required(flags, "head");
      const replayHeadSha = required(flags, "head-sha");
      const replayBase = required(flags, "base");
      if (
        replayState.create.repository !== repository.toLowerCase() ||
        replayState.create.issue !== issue ||
        replayState.create.headRef !== replayHead ||
        replayState.create.headSha !== replayHeadSha ||
        replayState.create.baseRef !== replayBase
      )
        throw new Error(
          "PR create再開入力が固定済みdelivery identityと一致しません",
        );
      if (replayState.state === "step11-recorded") {
        assertRecordedStep11Evidence(staging, replayState);
        print({
          state:
            replayState.step11?.outcome === "merged"
              ? "merged"
              : "pull_request_complete",
          url: replayState.pr.url,
          deliveryState: replayState,
          next: "固定済みStep 11終端Evidenceを再検証しました",
        });
        return 0;
      }
      const replayJournal = readWorkflowJournal(staging);
      const replayStep11 = replayJournal.entries.filter(
        (entry) => entry.step === 11,
      );
      if (replayState.state === "pr-bound" && replayStep11.length > 0) {
        assertStoredStagingContentDigest(
          staging,
          "PR停止終端journalからの復旧前",
        );
        const replayInspection = inspectWorkflowStaging(staging, 11);
        const replayTrustedSet = loadEffectiveTrustedPolicySet(
          root,
          replayBase,
        );
        const replayContinuation = decideDeliveryContinuation({
          workflowMode: replayInspection.mode,
          trustedMergeMode: replayTrustedSet.policy.merge.mode,
          assistedAuthorityVerified: false,
          mergeReadyVerified: false,
        });
        if (
          replayJournal.errors.length > 0 ||
          !replayInspection.validation.valid ||
          replayStep11.length !== 1 ||
          replayContinuation !== "stop-at-pr"
        )
          throw new Error(
            "PR停止終端のStep 11 journalからdelivery stateを安全に復旧できません",
          );
        if (!apply) {
          print({
            state: "preview",
            operation: "recover-pull-request-terminal-state",
            url: replayState.pr.url,
            deliveryState: replayState,
          });
          return 0;
        }
        const recovered = withStagingMutationLock(staging, () => {
          recoverPendingJournalTransaction(staging);
          assertStoredStagingContentDigest(
            staging,
            "PR停止終端journalからの復旧直前",
          );
          return finishBoundPullRequest(
            staging,
            readStoredDeliveryState(staging) ?? replayState,
            replayInspection.mode,
            {
              state: "waiting_for_human_review",
              url: replayState.pr!.url,
            },
          );
        });
        print(recovered.output);
        return recovered.exitCode;
      }
    }
    const inspection = inspectWorkflowStaging(staging, 10);
    const journal = readWorkflowJournal(staging);
    let workflowValidation = inspection.validation;
    let effectiveEntries = journal.entries;
    const overrideFile =
      typeof flags["workflow-override"] === "string"
        ? flags["workflow-override"]
        : undefined;
    const nonMissingFailure =
      inspection.errors.length > 0 ||
      workflowValidation.unexpectedSteps.length > 0 ||
      workflowValidation.outOfOrder.length > 0 ||
      workflowValidation.modeConflicts.length > 0 ||
      workflowValidation.errors.length > 0;
    if (overrideFile && workflowValidation.missingSteps.length > 0) {
      if (
        workflowValidation.missingSteps.includes(10) ||
        (inspection.mode === "poc" &&
          workflowValidation.missingSteps.includes(9))
      ) {
        print(
          workflowDiagnostic(staging, inspection.mode, workflowValidation, [
            "Step 10のreview session bindingとPoCのStep 9機械観測EvidenceはHumanOverrideできません",
          ]),
        );
        return 1;
      }
      if (nonMissingFailure) {
        print(
          workflowDiagnostic(staging, inspection.mode, workflowValidation, [
            ...inspection.errors,
            "HumanOverrideは欠落Step以外のjournal不整合を迂回できません",
          ]),
        );
        return 1;
      }
      const override = readJournalOverride(overrideFile);
      const now = new Date().toISOString();
      const overrideValidation = validateJournalHumanOverride({
        override,
        issue,
        now,
      });
      if (!overrideValidation.valid) {
        print(
          workflowDiagnostic(staging, inspection.mode, workflowValidation, [
            ...overrideValidation.errors,
          ]),
        );
        return 1;
      }
      const overrideEntries = workflowValidation.missingSteps.map((number) => {
        const definition = workflowStep(number);
        if (!definition) throw new Error(`step ${number}の定義がありません`);
        return {
          step: number,
          skillId: definition.skillId,
          mode: inspection.mode,
          recordedAt: now,
          artifacts: [`human-override:${override.instructedBy}`],
          evidence: override.reason,
          humanOverride: override,
        } satisfies StepJournalEntry;
      });
      effectiveEntries = [...effectiveEntries, ...overrideEntries];
      workflowValidation = validateStepJournal({
        mode: inspection.mode,
        entries: effectiveEntries,
        upToStep: 10,
      });
      if (workflowValidation.valid && apply)
        for (const entry of overrideEntries)
          appendWorkflowJournalEntry({ staging, entry });
    }
    const mandatoryRecorded = [4, 10].every((step) =>
      effectiveEntries.some((entry) => entry.step === step),
    );
    const stagingReady = inspection.state === "sync-verified";
    if (!workflowValidation.valid || !mandatoryRecorded || !stagingReady) {
      print(
        workflowDiagnostic(staging, inspection.mode, workflowValidation, [
          ...inspection.errors,
          ...(mandatoryRecorded
            ? []
            : [
                "step 4（Issue同期）とstep 10（実装レビュー）はPR作成前に必須です",
              ]),
          ...(stagingReady
            ? []
            : ["staging recordがsync-verifiedではありません"]),
        ]),
      );
      return 1;
    }
    const evidenceFile = path.resolve(required(flags, "evidence"));
    const evidence = readDeliveryEvidence(evidenceFile);
    const headSha = required(flags, "head-sha");
    if (!/^[a-f0-9]{40}$/u.test(headSha))
      throw new Error(
        "--head-shaは小文字の完全な40桁Git SHAで指定してください",
      );
    assertCurrentReviewJournalBinding(staging, headSha);
    if (inspection.mode === "poc") {
      const observation = inspectStoredPocObservationEvidence(staging, headSha);
      if (!observation.valid)
        throw new Error(
          `PoCのPR作成前poc-observation Evidenceが不正です: ${observation.errors.join("; ")}`,
        );
      const binding = inspectCurrentPocJournalBinding(staging, headSha, 10);
      if (!binding.valid)
        throw new Error(
          `PoCのPR作成前journal bindingが不正です: ${binding.errors.join("; ")}`,
        );
    }
    const canonicalRaw =
      typeof flags["canonical-issue"] === "string"
        ? flags["canonical-issue"]
        : issueRaw;
    if (!/^[1-9]\d*$/u.test(canonicalRaw))
      throw new Error("--canonical-issueは正のIssue番号で指定してください");
    const canonicalIssue = Number(canonicalRaw);
    if (canonicalIssue !== issue)
      throw new Error("--canonical-issueは--issueと一致させてください");
    const bodyFile = path.resolve(required(flags, "body-file"));
    if (!fs.existsSync(bodyFile))
      throw new Error(`--body-fileがありません: ${bodyFile}`);
    const head = required(flags, "head");
    const base = required(flags, "base");
    const localDefaultBranch = defaultBranch(root);
    if (base !== localDefaultBranch)
      throw new Error(
        `PR base ${base}がlocal origin/HEADの既定branch ${localDefaultBranch}と一致しません`,
      );
    const trustedSet = loadEffectiveTrustedPolicySet(root, base);
    const prCandidateChoices = loadConsumerChoicesFragmentAtCommit(
      root,
      headSha,
    );
    const commonInput = {
      apply,
      authorization:
        typeof flags.authorize === "string" ? flags.authorize : undefined,
      repository,
      issue,
      canonicalIssue,
      relatedIssues: positiveIssueList(flags.relates),
      head,
      headSha,
      base,
      body: fs.readFileSync(bodyFile, "utf8"),
      title: typeof flags.title === "string" ? flags.title : undefined,
      evidence,
      trustedPolicy: trustedSet.policy,
      candidatePolicy: loadConsumerPolicyAtCommit(root, headSha),
      candidateChoicesRaw: prCandidateChoices?.raw,
      choicesFragmentPath: prCandidateChoices?.path,
    };
    if (!apply) {
      const preview = createPullRequest(commonInput, () => {
        throw new Error("previewでGitHub操作を呼び出してはなりません");
      });
      print(preview);
      return 0;
    }
    if (flags.authorize !== "approved")
      throw new Error(
        "外部書き込みには明示的な承認--authorize=approvedが必要です",
      );
    /** 外部副作用より前に、同じ入力をpreview経路で完全検証する。 */
    const validatedPullRequest = createPullRequest(
      { ...commonInput, apply: false },
      () => {
        throw new Error("PR作成の事前検証でGitHub操作を呼び出してはなりません");
      },
    );
    if (validatedPullRequest.state !== "preview")
      throw new Error("PR作成の事前検証でGitHub操作を呼び出してはなりません");
    const pullRequestDigest = pullRequestContentDigest({
      title: validatedPullRequest.preview.title,
      body: validatedPullRequest.preview.body,
    });
    github("repository.assert-write", { repository }, root);
    const repositoryAuthority = github(
      "repository.authority",
      { repository },
      root,
    );
    const currentHead = github(
      "ref.inspect",
      { repository, branch: head },
      root,
    );
    const existingBefore = readStoredDeliveryState(staging);
    if (
      repositoryAuthority.repository !== repository ||
      repositoryAuthority.defaultBranch !== base
    )
      throw new Error("providerの既定branchが要求されたbaseと一致しません");
    if (
      !existingBefore &&
      trustedSet.provenance?.commitSha?.toLowerCase() !==
        repositoryAuthority.defaultBranchTipOid.toLowerCase()
    )
      throw new Error(
        "providerの既定branch tipがtrusted policy provenanceと一致しません",
      );
    if (currentHead.sha.toLowerCase() !== headSha.toLowerCase())
      throw new Error(
        "providerのremote head SHAがPR作成Evidenceと一致しません",
      );
    const observedBaseSha =
      existingBefore?.create.baseSha ?? repositoryAuthority.defaultBranchTipOid;
    if (inspection.mode === "poc")
      assertPocDeliveryChangeScope(staging, observedBaseSha, headSha);
    const result = withStagingMutationLock(staging, () => {
      recoverPendingJournalTransaction(staging);
      const lockedInspection = assertWorkflowReadyForDelivery(staging);
      assertCurrentReviewJournalBinding(staging, headSha);
      const stagingRecord = migrateLegacyStagingTrackerLocked(staging, {
        repository,
        issue,
      });
      const issueUrl = stagingRecord.tracker;
      if (
        typeof issueUrl !== "string" ||
        issueUrl.toLowerCase() !==
          `https://github.com/${repository}/issues/${issue}`.toLowerCase()
      )
        throw new Error(
          "PR作成時のstaging trackerがcanonical Issueと一致しません",
        );
      const currentBefore = readStoredDeliveryState(staging);
      const baseSha = currentBefore?.create.baseSha ?? observedBaseSha;
      const createIntent = {
        repository,
        issue,
        issueUrl,
        headRef: head,
        headSha,
        baseRef: base,
        baseSha,
        pullRequestDigest,
        bodyClosingDigest: closingContractDigest({
          canonicalIssue,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [canonicalIssue],
        }),
        preparedAt:
          currentBefore?.create.preparedAt ?? new Date().toISOString(),
      };
      const prepared = prepareStoredPullRequestCreation(staging, createIntent);
      let effectivePrepared = prepared;
      let providerConfirmedAbsent = false;
      if (currentBefore && !prepared.pr) {
        let recoveryReason =
          "PR作成要求がproviderへ到達したか断定できないため、自動再作成を禁止した";
        try {
          let exactMatches = 0;
          let mergedMatches = 0;
          let closedMatches = 0;
          const observedCandidates = github(
            "pr.find",
            { repository, head, base },
            root,
          );
          const matching = observedCandidates.flatMap((observed) => {
            try {
              if (
                observed.state !== "OPEN" &&
                observed.state !== "MERGED" &&
                observed.state !== "CLOSED"
              )
                return [];
              const binding = bindingFromCreatedPullRequest({
                state: prepared,
                observed,
                tracker: stagingRecord.tracker,
                boundAt: deliveryEventTime(prepared.create.preparedAt),
              });
              exactMatches += 1;
              if (observed.state === "MERGED") {
                mergedMatches += 1;
                return [];
              }
              if (observed.state === "CLOSED") {
                closedMatches += 1;
                return [];
              }
              return [binding];
            } catch {
              return [];
            }
          });
          if (exactMatches === 1 && matching.length === 1) {
            effectivePrepared = bindStoredPullRequest(staging, matching[0]!);
          } else if (exactMatches > 1) {
            recoveryReason = `固定済みidentityに一致する既存PRが一意ではありません: matches=${exactMatches}, open=${matching.length}, closed=${closedMatches}, merged=${mergedMatches}`;
          } else if (mergedMatches > 0) {
            recoveryReason = `固定済みidentityに一致するmerged PRを${mergedMatches}件観測したが、ASC merge authorization provenanceがないため自動完了できません`;
          } else if (closedMatches > 0) {
            recoveryReason = `固定済みidentityに一致するclosed PRを${closedMatches}件観測したため、重複PRの自動作成を禁止した`;
          } else if (
            observedCandidates.length === 0 &&
            prepared.state === "reconciliation-required" &&
            prepared.reconciliation?.phase === "create" &&
            prepared.create.dispatchClaimedAt === null &&
            prepared.create.baseSha === repositoryAuthority.defaultBranchTipOid
          ) {
            effectivePrepared =
              resumeStoredPullRequestCreationAfterConfirmedAbsence(staging);
            providerConfirmedAbsent = true;
            recoveryReason =
              "未消費claimのread-only照合失敗からexact absenceとbase不変を再確認したため、同一intentを一度だけ再開する";
          } else if (
            observedCandidates.length === 0 &&
            prepared.state === "create-prepared" &&
            prepared.create.dispatchClaimedAt === null &&
            prepared.create.baseSha === repositoryAuthority.defaultBranchTipOid
          ) {
            providerConfirmedAbsent = true;
            recoveryReason =
              "固定済みidentityのPRがproviderに存在しないことを確認したため、同一intentを一度だけ再試行する";
          } else if (
            observedCandidates.length === 0 &&
            prepared.state === "create-prepared" &&
            prepared.create.dispatchClaimedAt !== null
          ) {
            recoveryReason =
              "PR create dispatch claimは消費済みだがprovider反映を確認できないため、自動再送を禁止した";
          } else if (
            observedCandidates.length === 0 &&
            prepared.state === "create-prepared"
          ) {
            recoveryReason =
              "PR create intent固定後にprovider baseが前進し、固定baseへの新規PR作成を再認可できないため自動再送を禁止した";
          } else {
            recoveryReason = `同じhead/baseのprovider PRを${observedCandidates.length}件観測しましたが、固定済みidentityとの一致は${exactMatches}件です。既存PRを確認するまで新規作成しません`;
          }
        } catch (error) {
          recoveryReason = `既存PRのread-only照合に失敗しました: ${error instanceof Error ? error.message : String(error)}`;
        }
        effectivePrepared =
          readStoredDeliveryState(staging) ?? effectivePrepared;
        if (!effectivePrepared.pr && !providerConfirmedAbsent) {
          const reconciled =
            effectivePrepared.state === "create-prepared"
              ? requireStoredDeliveryReconciliation(staging, {
                  phase: "create",
                  reason: recoveryReason,
                  enteredAt: deliveryEventTime(
                    effectivePrepared.create.preparedAt,
                  ),
                })
              : effectivePrepared;
          return {
            exitCode: 1,
            output: {
              state: "reconciliation_required",
              reason: recoveryReason,
              deliveryState: reconciled,
              next: `head=${head}、base=${base}、HEAD=${headSha}に完全一致する既存PRをGitHubで照合してください。pr createは再実行しません`,
            },
          };
        }
      }
      let created:
        | ReturnType<typeof createPullRequest>
        | {
            state: "waiting_for_human_review";
            url: string;
            observation?: undefined;
            next: string;
          };
      let bound = effectivePrepared;
      if (effectivePrepared.pr) {
        created = {
          state: "waiting_for_human_review",
          url: effectivePrepared.pr.url,
          next:
            prepared.pr === null
              ? "provider read-backで既存PR bindingを復旧した"
              : "永続化済みPR bindingから再開した",
        };
      } else {
        if (
          trustedSet.provenance?.commitSha?.toLowerCase() !==
          repositoryAuthority.defaultBranchTipOid.toLowerCase()
        )
          throw new Error(
            "provider create再試行には現在の既定branch tipと一致するtrusted policy provenanceが必要です",
          );
        assertCurrentReviewJournalBinding(staging, headSha);
        const claimed = claimStoredPullRequestCreationDispatch(
          staging,
          deliveryEventTime(effectivePrepared.create.preparedAt),
        );
        if (!claimed.dispatchAllowed) {
          const retained =
            claimed.state.state === "create-prepared"
              ? requireStoredDeliveryReconciliation(staging, {
                  phase: "create",
                  reason:
                    "PR create dispatch claimは既に消費済みのためprovider createを再送しません",
                  enteredAt: deliveryEventTime(claimed.state.create.preparedAt),
                })
              : claimed.state;
          return {
            exitCode: 1,
            output: {
              state: "reconciliation_required",
              reason:
                "PR create dispatch claimは既に消費済みのためprovider createを再送しません",
              deliveryState: retained,
              next: "固定済みhead/base/Issueに一致するPRをproviderで照合してください",
            },
          };
        }
        effectivePrepared = claimed.state;
        try {
          created = createPullRequest(
            { ...commonInput, baseSha },
            (operation, payload) => github(operation, payload, root),
          );
        } catch (error) {
          const reconciled = requireStoredDeliveryReconciliation(staging, {
            phase: "create",
            reason: `provider createの成否を断定できないため同じ要求の自動再送を禁止した: ${error instanceof Error ? error.message : String(error)}`,
            enteredAt: deliveryEventTime(prepared.create.preparedAt),
          });
          return {
            exitCode: 1,
            output: {
              state: "reconciliation_required",
              reason: error instanceof Error ? error.message : String(error),
              deliveryState: reconciled,
              next: "固定済みhead/base/Issueに一致するPRをproviderで照合してください",
            },
          };
        }
        if (created.state === "rollback_required") {
          const reconciled = requireStoredDeliveryReconciliation(staging, {
            phase: "create",
            reason: `${created.reason}; createdUrl=${created.url}`,
            enteredAt: deliveryEventTime(prepared.create.preparedAt),
          });
          return {
            exitCode: 1,
            output: { ...created, deliveryState: reconciled },
          };
        }
        if (
          created.state !== "waiting_for_human_review" ||
          !created.observation
        )
          throw new Error("PR作成後のtrusted observationがありません");
        try {
          bound = bindStoredPullRequest(
            staging,
            bindingFromCreatedPullRequest({
              state: effectivePrepared,
              observed: created.observation,
              tracker: stagingRecord.tracker,
              boundAt: deliveryEventTime(prepared.create.preparedAt),
            }),
          );
        } catch (error) {
          const afterFailure = readStoredDeliveryState(staging);
          if (afterFailure?.pr) {
            bound = afterFailure;
          } else {
            const retained =
              afterFailure?.state === "create-prepared"
                ? requireStoredDeliveryReconciliation(staging, {
                    phase: "create",
                    reason: `作成済みPRのbinding永続化に失敗したため再作成を禁止した: ${error instanceof Error ? error.message : String(error)}`,
                    enteredAt: deliveryEventTime(
                      afterFailure.create.preparedAt,
                    ),
                  })
                : afterFailure;
            return {
              exitCode: 1,
              output: {
                ...created,
                state: "binding_recovery_required",
                reason: error instanceof Error ? error.message : String(error),
                deliveryState: retained,
                next: `作成済みPR ${created.url ?? "（URL不明）"} を確認し、pr createを再実行せず同じstagingでidentity照合を復旧してください`,
              },
            };
          }
        }
      }
      const continuation = decideDeliveryContinuation({
        workflowMode: lockedInspection.mode,
        trustedMergeMode: commonInput.trustedPolicy.merge.mode,
        assistedAuthorityVerified: false,
        mergeReadyVerified: false,
      });
      if (
        continuation === "wait-merge-ready" ||
        continuation === "wait-authority"
      )
        return {
          exitCode: 0,
          output: {
            ...created,
            state: "merge_pending",
            continuation,
            deliveryState: bound,
            next:
              continuation === "wait-authority"
                ? `PR ${created.url ?? "（URL不明）"} のowner authorityを待ち、Step 11を記録せずpr-boundから再開してください`
                : `PR ${created.url ?? "（URL不明）"} のrequired checks、review、HEAD、ruleset、mergeable状態を観測し、同じstagingを指定して独立したpr merge操作へ進んでください。Step 11はまだ完了していません`,
          },
        };
      if (continuation !== "stop-at-pr")
        throw new Error(`未対応のdelivery continuationです: ${continuation}`);
      return finishBoundPullRequest(
        staging,
        bound,
        lockedInspection.mode,
        created,
      );
    });
    print(result.output);
    return result.exitCode;
  }
  if (command === "pr" && subcommand === "reanchor") {
    const { flags } = parse(rest);
    return dispatchEvidenceReanchor(
      {
        apply: applyMode(flags),
        root: typeof flags.root === "string" ? flags.root : undefined,
        staging: required(flags, "staging"),
        newHeadSha: required(flags, "new-head"),
        newBaseSha: required(flags, "new-base"),
        reason: required(flags, "reason"),
        layer: "delivery",
      },
      dependencies,
    );
  }
  if (command === "review" && subcommand === "reanchor") {
    const { flags } = parse(rest);
    return dispatchEvidenceReanchor(
      {
        apply: applyMode(flags),
        root: typeof flags.root === "string" ? flags.root : undefined,
        staging: required(flags, "staging"),
        newHeadSha: required(flags, "new-head"),
        newBaseSha: required(flags, "new-base"),
        reason: required(flags, "reason"),
        layer: "review",
      },
      dependencies,
    );
  }
  if (command === "pr" && subcommand === "merge") {
    const { flags } = parse(rest);
    // Keep the public dispatch contract explicit; the handler performs the
    // semantic validation after these presence checks.
    required(flags, "repo");
    required(flags, "pr");
    required(flags, "method");
    required(flags, "staging");
    return handlePullRequestMerge(flags);
  }
  const lifecycleCommand = canonicalLifecycleCommand(command);
  if (["install", "update", "delete"].includes(lifecycleCommand)) {
    const forwarded = subcommand ? [subcommand, ...rest] : rest;
    const { flags, positionals } = parse(forwarded);
    const apply = lifecycleApplyMode(flags);
    const root = path.resolve(
      positionals[0] ??
        (typeof flags.root === "string" ? flags.root : process.cwd()),
    );
    print(
      lifecycleCommand === "install"
        ? init(root, { apply })
        : lifecycleCommand === "update"
          ? upgrade(root, { apply })
          : uninstall(root, { apply }),
    );
    return 0;
  }
  if (command === "doctor") {
    const forwarded = subcommand ? [subcommand, ...rest] : rest;
    const { flags, positionals } = parse(forwarded);
    const root = path.resolve(
      positionals[0] ??
        (typeof flags.root === "string" ? flags.root : process.cwd()),
    );
    let worktreeSurvey: WorktreeSurvey;
    try {
      worktreeSurvey = collectWorktreeSurvey(root);
    } catch (error) {
      worktreeSurvey = {
        entries: [],
        cleanupReady: [],
        retained: [],
        inProgress: [],
        errors: [
          `worktree走査に失敗しました: ${error instanceof Error ? error.message : "観測できません"}`,
        ],
      };
    }
    const result = doctor(root, worktreeSurvey);
    print(result);
    return result.healthy ? 0 : 1;
  }
  throw new Error(`不明なコマンドです: ${argv.join(" ")}`);
}
