import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  createIssueStaging,
  recordStagingSync,
  validateIssue,
} from "./domain/issue.js";
import {
  bootstrapProject,
  validateSpecs,
  type ProjectKind,
} from "./domain/spec.js";
import { buildReviewEvidence, evaluateReview } from "./domain/review.js";
import { createPullRequest, authorizeMerge } from "./domain/delivery.js";
import {
  createWorktree,
  canonicalWorktreePath,
  DEFAULT_WORKTREE_PLACEMENT,
  enforceTrustedWorktreeBoundary,
  inspectFinalizeState,
  validateWorktreePlacement,
} from "./domain/worktree.js";
import {
  applyWorkspaceHygiene,
  previewWorkspaceHygiene,
  type HygieneKind,
} from "./domain/hygiene.js";
import { applyStagingCleanup, planStagingCleanup } from "./domain/staging.js";
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
  loadConsumerPolicyAtCommit,
  conformanceDeclarationFromPolicySet,
  loadEffectiveTrustedPolicySet,
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
  github,
  GitHubProviderUnavailableError,
  samePolicyAuthorityObservation,
} from "./adapters/github.js";
import { git } from "./lib/process.js";
import { writeFileAtomic } from "./lib/atomic.js";
import { validateRepositoryConformance } from "./domain/conformance.js";
import { parseJsonStrict, resolveContained } from "./lib/security.js";
import {
  canonicalLifecycleCommand,
  CLI_USAGE,
  PUBLIC_LIFECYCLE_COMMANDS,
  routingDiagnostic,
  routingRecovery,
} from "./cli-contract.js";
import { type Policy, isRecord } from "./types.js";
import { type PolicySet } from "./domain/policy.js";
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
  appendWorkflowJournalEntry,
  inspectWorkflowStaging,
  readWorkflowJournal,
  resolvePullRequestStaging,
  workflowStep,
} from "./adapters/workflow-journal.js";
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
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (!argument.startsWith("--"))
      throw new Error(
        `workflow commandの位置引数は使用できません: ${argument}`,
      );
    const equal = argument.indexOf("=");
    const key = argument.slice(2, equal === -1 ? undefined : equal);
    let value = equal === -1 ? undefined : argument.slice(equal + 1);
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

function executeCompletionFlow(input: {
  flags: Flags;
  apply: boolean;
  root: string;
  target: string;
  evidence: ReturnType<typeof readFinalizeEvidence>;
}): number {
  const { flags, apply, root, target, evidence } = input;
  if (flags.complete !== true)
    throw new Error("--completeは値を付けずに指定してください");
  if (
    flags["cleanup-authority"] !== undefined &&
    flags["cleanup-authority"] !== true
  )
    throw new Error("--cleanup-authorityは値を付けずに指定してください");
  const cleanupAuthorityGranted = flags["cleanup-authority"] === true;
  const mergeSha = required(flags, "merge-sha");
  const approvedDigest =
    typeof flags["approved-digest"] === "string"
      ? flags["approved-digest"]
      : "";
  const initialRootObservation = observeRootUpdate(root, mergeSha);
  const initialRootPlan = planRootUpdate(initialRootObservation);
  const targetPresent = pathExists(target);
  const initialState = targetPresent
    ? inspectFinalizeState(root, target, evidence)
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
    clean: initialState
      ? initialState.dirty === false && initialState.untracked.length === 0
      : undefined,
    pushed: initialState?.pushed,
    recoveryReachable: initialState?.recoveryReachable,
    consumerAssets: initialState
      ? [
          ...initialState.untracked,
          ...initialState.temporaryArtifacts,
          ...initialState.ignoredArtifacts,
        ]
      : [],
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
  if (flags.authorize !== "approved")
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
  const currentState = inspectFinalizeState(root, target, evidence);
  const currentReport = buildFinalizeReport(currentState);
  const currentCleanup = planWorktreeCleanup({
    repositoryRoot: root,
    target: { path: target, branch: currentState.branch },
    registered: registeredWorktrees(root),
    prMerged: currentState.prMerged === true,
    clean: currentState.dirty === false && currentState.untracked.length === 0,
    pushed: currentState.pushed,
    recoveryReachable: currentState.recoveryReachable,
    consumerAssets: [
      ...currentState.untracked,
      ...currentState.temporaryArtifacts,
      ...currentState.ignoredArtifacts,
    ],
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

export async function main(argv: string[]): Promise<number> {
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
      (flag) => !["staging", "step", "evidence", "recorded-at"].includes(flag),
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
    const entry: StepJournalEntry = {
      step: step.step,
      skillId: step.skillId,
      mode: journal.mode,
      recordedAt: flags["recorded-at"] ?? new Date().toISOString(),
      artifacts,
      evidence,
    };
    print(appendWorkflowJournalEntry({ staging, entry }));
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
    throw new Error("workflowにはsteps、record、verifyのいずれかが必要です");
  if (command === "issue" && subcommand === "create") {
    const { flags } = parse(rest);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const assessment = readModeAssessment(required(flags, "assessment"));
    print(
      createIssueStaging(root, {
        title: required(flags, "title"),
        answers: assessment,
        now: new Date(),
      }),
    );
    return 0;
  }
  if (command === "issue" && subcommand === "validate") {
    const { flags, positionals } = parse(rest);
    const target = positionals[0] ?? required(flags, "path");
    const result = validateIssue(path.resolve(target), {
      changedFiles:
        typeof flags.changed === "string"
          ? flags.changed.split(",").filter(Boolean)
          : [],
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
    const result = github("issue.sync", input, process.cwd());
    const stagingPath =
      typeof flags["staging-path"] === "string"
        ? path.resolve(flags["staging-path"])
        : undefined;
    const checkpointRaw = flags.checkpoint;
    if ((stagingPath === undefined) !== (checkpointRaw === undefined))
      throw new Error(
        "同期記録を更新する場合は--staging-pathと--checkpointを両方指定してください",
      );
    if (stagingPath !== undefined) {
      if (
        typeof checkpointRaw !== "string" ||
        !/^(?:4|8)$/u.test(checkpointRaw)
      )
        throw new Error("--checkpointは4または8で指定してください");
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
      print({ ...result, staging: record });
      return 0;
    }
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
      const comparison = compareTrustedPolicy(
        trustedSet.policy,
        effective.policy,
        {
          trustedConformance: conformanceDeclarationFromPolicySet(trustedSet),
          candidateConformance:
            conformanceDeclarationFromPolicySet(candidateSet),
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
    const parsed = readJsonInput(file);
    if (
      isRecord(parsed) &&
      parsed.schemaVersion === "agent-skill-chain/project-policy-manifest/v1"
    ) {
      const candidateSet = loadProjectPolicySet(root);
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
      const comparison = compareTrustedPolicy(
        trustedSet.policy,
        effective.policy,
        {
          trustedConformance: conformanceDeclarationFromPolicySet(trustedSet),
          candidateConformance:
            conformanceDeclarationFromPolicySet(candidateSet),
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
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const trustedSet = loadOperationPolicy(root);
    const worktreePath = required(flags, "path");
    enforceTrustedWorktreeBoundary({
      repoRoot: root,
      worktreePath,
      expectedRepository:
        typeof flags.repo === "string" ? flags.repo : undefined,
      trustedPolicy: trustedSet.policy,
    });
    const issueRaw = required(flags, "issue");
    if (!/^[1-9]\d*$/u.test(issueRaw))
      throw new Error("--issueは1以上の整数で指定してください");
    const issueNumber = Number(issueRaw);
    if (!Number.isSafeInteger(issueNumber))
      throw new Error("--issueは安全な整数範囲で指定してください");
    const branch = required(flags, "branch");
    const slug = required(flags, "slug");
    const policy = trustedSet.policy.worktree ?? DEFAULT_WORKTREE_PLACEMENT;
    const placement = validateWorktreePlacement({
      repoRoot: root,
      worktreePath,
      branch,
      issueNumber,
      slug,
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
              "project policy、path、Issue番号、slug、branch、登録済みworktreeを検証した",
            ],
            autoFixes: [],
            next: "規定名の未登録pathと許可されたbranch typeを指定してください",
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
        worktreePolicy: policy,
        remoteDefaultBranch: required(flags, "remote-default-branch"),
        remoteDefaultSha: required(flags, "remote-default-sha"),
        expectedRepository:
          typeof flags.repo === "string" ? flags.repo : undefined,
        trustedPolicy: trustedSet.policy,
      }),
    );
    return 0;
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
    if (flags.complete !== undefined)
      return executeCompletionFlow({ flags, apply, root, target, evidence });
    if (flags["update-root"] !== undefined && flags["update-root"] !== true)
      throw new Error("--update-rootは値を付けずに指定してください");
    const updateRoot = flags["update-root"] === true;
    const mergeSha = updateRoot ? required(flags, "merge-sha") : undefined;
    const state = inspectFinalizeState(root, target, evidence);
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
      target: { path: target, branch: state.branch },
      registered: registeredWorktrees(root),
      prMerged: state.prMerged === true,
      clean: state.dirty === false && state.untracked.length === 0,
      pushed: state.pushed,
      recoveryReachable: state.recoveryReachable,
      consumerAssets: [
        ...state.untracked,
        ...state.temporaryArtifacts,
        ...state.ignoredArtifacts,
      ],
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
    const currentState = inspectFinalizeState(root, target, evidence);
    const currentCleanup = planWorktreeCleanup({
      target: { path: target, branch: currentState.branch },
      registered: registeredWorktrees(root),
      prMerged: currentState.prMerged === true,
      clean:
        currentState.dirty === false && currentState.untracked.length === 0,
      pushed: currentState.pushed,
      recoveryReachable: currentState.recoveryReachable,
      consumerAssets: [
        ...currentState.untracked,
        ...currentState.temporaryArtifacts,
        ...currentState.ignoredArtifacts,
      ],
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
    const staging = resolvePullRequestStaging({
      root,
      staging: typeof flags.staging === "string" ? flags.staging : undefined,
      issue,
    });
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
    if (!/^[a-f0-9]{40}$/iu.test(headSha))
      throw new Error("--head-shaは完全な40桁Git SHAで指定してください");
    const canonicalRaw =
      typeof flags["canonical-issue"] === "string"
        ? flags["canonical-issue"]
        : issueRaw;
    if (!/^[1-9]\d*$/u.test(canonicalRaw))
      throw new Error("--canonical-issueは正のIssue番号で指定してください");
    const canonicalIssue = Number(canonicalRaw);
    if (canonicalIssue !== issue)
      throw new Error("--canonical-issueは--issueと一致させてください");
    const input = {
      apply,
      authorization:
        typeof flags.authorize === "string" ? flags.authorize : undefined,
      repository: required(flags, "repo"),
      issue,
      canonicalIssue,
      relatedIssues: positiveIssueList(flags.relates),
      head: required(flags, "head"),
      headSha,
      base: required(flags, "base"),
      evidence,
      trustedPolicy: loadOperationPolicy(root).policy,
      candidatePolicy: loadConsumerPolicyAtCommit(root, headSha),
    };
    const created = createPullRequest(input, (operation, payload) =>
      github(operation, payload, root),
    );
    if (apply && created.state === "waiting_for_human_review") {
      const definition = workflowStep(11);
      if (!definition) throw new Error("step 11の定義がありません");
      if (typeof created.url !== "string" || created.url.trim() === "")
        throw new Error("PR作成後のURLがありません");
      const recorded = appendWorkflowJournalEntry({
        staging,
        entry: {
          step: 11,
          skillId: definition.skillId,
          mode: inspection.mode,
          recordedAt: new Date().toISOString(),
          artifacts: [created.url],
          evidence: "PR作成後のURLを確認しwaiting_for_human_reviewで停止した",
        },
      });
      print({ ...created, workflow: recorded });
      return 0;
    }
    print(created);
    return 0;
  }
  if (command === "pr" && subcommand === "merge") {
    const { flags } = parse(rest);
    const apply = applyMode(flags);
    const root = path.resolve(
      typeof flags.root === "string" ? flags.root : process.cwd(),
    );
    const repository = required(flags, "repo");
    const prRaw = required(flags, "pr");
    if (!/^[1-9]\d*$/u.test(prRaw))
      throw new Error("--prは正の整数で指定してください");
    const pr = Number(prRaw);
    const method = required(flags, "method");
    if (!["merge", "squash", "rebase"].includes(method))
      throw new Error("--methodが不正です");
    const base = defaultBranch(root);
    const trustedSet = loadEffectiveTrustedPolicySet(root, base);
    const trustedPolicy = trustedSet.policy;
    const inspected = github("pr.inspect", { repository, pr }, root);
    if (inspected.baseRefName !== base)
      throw new Error("PRの基点が検証済み既定ブランチではありません");
    if (
      trustedSet.provenance?.commitSha &&
      inspected.baseRefOid !== trustedSet.provenance.commitSha
    )
      throw new Error(
        "PR base SHAがtrusted policy setのcommit SHAと一致しません",
      );
    const protection = github(
      "branch.protection",
      { repository, branch: base },
      root,
    );
    const checks = (inspected.statusCheckRollup ?? [])
      .filter((item) => (item.conclusion ?? item.status) === "SUCCESS")
      .map((item) => item.name ?? item.context)
      .filter((item): item is string => typeof item === "string");
    const approvals = github("pr.reviews", { repository, pr }, root);
    if (typeof inspected.headRefOid !== "string")
      throw new Error("PR HEAD SHAが不正です");
    const implementation = github(
      "commit.inspect",
      { repository, sha: inspected.headRefOid },
      root,
    );
    if (implementation.sha !== inspected.headRefOid)
      throw new Error("実装commitのtrusted観測がPR HEADと一致しません");
    const authorization = authorizeMerge({
      trustedPolicy,
      method: method as "merge" | "squash" | "rebase",
      checks,
      approvals,
      headSha: inspected.headRefOid,
      prAuthorActorId: inspected.author?.id,
      implementationAuthorActorId: implementation.authorActorId,
      branch: inspected.headRefName ?? "",
      baseRef: inspected.baseRefName ?? "",
      headRef: inspected.headRefName ?? "",
      repositoryVerified: true,
      shaVerified: Boolean(inspected.headRefOid && inspected.baseRefOid),
      protectionVerified: protection.known && protection.protected,
      mergeableVerified:
        inspected.isDraft === false && inspected.mergeStateStatus === "CLEAN",
    });
    if (!authorization.allowed) {
      if (authorization.diagnostic) {
        print(serializeDiagnostic(authorization));
        return 1;
      }
      throw new Error(`マージを拒否しました: ${authorization.reason}`);
    }
    if (!apply) {
      print({
        state: "preview",
        authorization,
        pr: inspected.url,
        headSha: inspected.headRefOid,
        baseSha: inspected.baseRefOid,
      });
      return 0;
    }
    const rechecked = github("pr.inspect", { repository, pr }, root);
    if (
      rechecked.headRefOid !== inspected.headRefOid ||
      rechecked.baseRefOid !== inspected.baseRefOid ||
      rechecked.headRefName !== inspected.headRefName ||
      rechecked.baseRefName !== inspected.baseRefName ||
      rechecked.author?.id !== inspected.author?.id
    )
      throw new Error("マージ直前にPR状態が変化しました（TOCTOU）");
    const recheckedProtection = github(
      "branch.protection",
      { repository, branch: base },
      root,
    );
    const recheckedApprovals = github("pr.reviews", { repository, pr }, root);
    const recheckedChecks = (rechecked.statusCheckRollup ?? [])
      .filter((item) => (item.conclusion ?? item.status) === "SUCCESS")
      .map((item) => item.name ?? item.context)
      .filter((item): item is string => typeof item === "string");
    const reauthorization = authorizeMerge({
      trustedPolicy,
      method: method as "merge" | "squash" | "rebase",
      checks: recheckedChecks,
      approvals: recheckedApprovals,
      headSha: rechecked.headRefOid,
      prAuthorActorId: rechecked.author?.id,
      implementationAuthorActorId: implementation.authorActorId,
      branch: rechecked.headRefName ?? "",
      baseRef: rechecked.baseRefName ?? "",
      headRef: rechecked.headRefName ?? "",
      repositoryVerified: true,
      shaVerified: true,
      protectionVerified:
        recheckedProtection.known && recheckedProtection.protected,
      mergeableVerified:
        rechecked.isDraft === false && rechecked.mergeStateStatus === "CLEAN",
    });
    if (!reauthorization.allowed) {
      if (reauthorization.diagnostic) {
        print(serializeDiagnostic(reauthorization));
        return 1;
      }
      throw new Error(
        `マージ直前の再認可を拒否しました: ${reauthorization.reason}`,
      );
    }
    print(
      github(
        "pr.merge",
        { repository, pr, method: method as "merge" | "squash" | "rebase" },
        root,
      ),
    );
    return 0;
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
    const result = doctor(root);
    print(result);
    return result.healthy ? 0 : 1;
  }
  throw new Error(`不明なコマンドです: ${argv.join(" ")}`);
}
