import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import { enforceTrustedBoundary } from "./enforcement.js";
import { type Policy, type RuleObservation } from "../types.js";
import {
  isSafeFinalizeIgnoredPathPrefix,
  resolveFinalizeIgnoredPathAllowlist,
} from "./worktree-removal-safety.js";

export interface WorktreePlacementPolicy {
  root: string;
  namePattern: string;
  branchPattern: string;
  allowedBranchTypes: string[];
  base: string;
  cleanup: string;
  finalizeIgnoredPathAllowlist?: string[];
}

export const DEFAULT_WORKTREE_PLACEMENT: WorktreePlacementPolicy = {
  root: ".worktrees",
  namePattern: "{timestamp}-{issueNumber}-{slug}",
  branchPattern: "{type}/{issueNumber}-{slug}",
  allowedBranchTypes: ["feature", "fix", "refactor", "test", "docs", "chore"],
  base: "remote-default-branch",
  cleanup: "after-merge",
  finalizeIgnoredPathAllowlist: [],
};

interface RegisteredWorktree {
  path: string;
  branch: string;
}

const CONTROL = /\p{C}/u;
const WORKTREE_NAME = /^(\d{8}_\d{6})-(\d+)-([a-z0-9][a-z0-9-]*)$/u;
const BRANCH_NAME = /^([a-z][a-z0-9-]{0,31})\/(\d+)-([a-z0-9][a-z0-9-]*)$/u;
const WORKTREE_TIMESTAMP = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/u;
export const WORKTREE_NAME_FORMAT = "<YYYYMMDD_HHMMSS>-<Issue番号>-<slug>";
export const WORKTREE_TIMESTAMP_MAX_AGE_MINUTES = 10;
const WORKTREE_TIMESTAMP_MAX_AGE_MS =
  WORKTREE_TIMESTAMP_MAX_AGE_MINUTES * 60 * 1000;

function validTime(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function parseLocalTimestamp(value: string): Date | undefined {
  const match = WORKTREE_TIMESTAMP.exec(value);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  )
    return undefined;
  const parsed = new Date(0);
  parsed.setFullYear(year, month - 1, day);
  parsed.setHours(hour, minute, second, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute ||
    parsed.getSeconds() !== second
  )
    return undefined;
  return parsed;
}

function localTimestamp(value: Date): string {
  if (!validTime(value))
    throw new Error("worktree pathの構成には有効な現在時刻が必要です");
  const year = value.getFullYear();
  if (year < 0 || year > 9999)
    throw new Error("worktree pathの現在時刻は4桁年で指定してください");
  const pad = (part: number, length = 2): string =>
    String(part).padStart(length, "0");
  return `${pad(year, 4)}${pad(value.getMonth() + 1)}${pad(value.getDate())}_${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`;
}

export function buildWorktreePath(input: {
  issueNumber: number;
  slug: string;
  currentTime: Date;
  policy?: WorktreePlacementPolicy;
}): string {
  if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber < 1)
    throw new Error("Issue番号は1以上の安全な整数でなければなりません");
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(input.slug))
    throw new Error("slugは小文字英数字とhyphenで指定してください");
  const policy = input.policy ?? DEFAULT_WORKTREE_PLACEMENT;
  const policyErrors = placementPolicyErrors(policy);
  if (policyErrors.length > 0)
    throw new Error(`worktree policyが不正です: ${policyErrors.join("; ")}`);
  return `${policy.root}/${localTimestamp(input.currentTime)}-${input.issueNumber}-${input.slug}`;
}

function placementPolicyErrors(policy: WorktreePlacementPolicy): string[] {
  const errors: string[] = [];
  const constants: Array<
    [
      Exclude<keyof WorktreePlacementPolicy, "finalizeIgnoredPathAllowlist">,
      string,
    ]
  > = [
    ["root", DEFAULT_WORKTREE_PLACEMENT.root],
    ["namePattern", DEFAULT_WORKTREE_PLACEMENT.namePattern],
    ["branchPattern", DEFAULT_WORKTREE_PLACEMENT.branchPattern],
    ["base", DEFAULT_WORKTREE_PLACEMENT.base],
    ["cleanup", DEFAULT_WORKTREE_PLACEMENT.cleanup],
  ];
  for (const [field, expected] of constants)
    if (policy[field] !== expected)
      errors.push(`worktree policyの${field}が不正です`);
  if (
    policy.allowedBranchTypes.length < 1 ||
    policy.allowedBranchTypes.length > 32 ||
    new Set(policy.allowedBranchTypes).size !==
      policy.allowedBranchTypes.length ||
    policy.allowedBranchTypes.some(
      (item) => !/^[a-z][a-z0-9-]{0,31}$/u.test(item),
    )
  )
    errors.push("worktree policyのallowedBranchTypesが不正です");
  const finalizeIgnoredPathAllowlist =
    policy.finalizeIgnoredPathAllowlist ?? [];
  if (
    !Array.isArray(finalizeIgnoredPathAllowlist) ||
    finalizeIgnoredPathAllowlist.length > 64 ||
    new Set(finalizeIgnoredPathAllowlist).size !==
      finalizeIgnoredPathAllowlist.length ||
    finalizeIgnoredPathAllowlist.some(
      (prefix) => !isSafeFinalizeIgnoredPathPrefix(prefix),
    )
  )
    errors.push("worktree policyのfinalizeIgnoredPathAllowlistが不正です");
  return errors;
}

function collisionKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function issueFromRegistered(entry: RegisteredWorktree): number | undefined {
  const branch = BRANCH_NAME.exec(entry.branch);
  if (branch?.[2]) return Number(branch[2]);
  const directory = WORKTREE_NAME.exec(path.basename(entry.path));
  return directory?.[2] ? Number(directory[2]) : undefined;
}

export function validateWorktreePlacement(input: {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  issueNumber: number;
  slug: string;
  currentTime: Date;
  policy?: WorktreePlacementPolicy;
  existing: Array<{ path: string; branch: string }>;
}): { valid: boolean; errors: string[] } {
  const policy = input.policy ?? DEFAULT_WORKTREE_PLACEMENT;
  const errors = placementPolicyErrors(policy);
  const add = (message: string): void => {
    if (!errors.includes(message)) errors.push(message);
  };
  if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber < 1)
    add("Issue番号は1以上の安全な整数でなければなりません");
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(input.slug))
    add("slugは小文字英数字とhyphenで指定してください");
  if (CONTROL.test(input.worktreePath))
    add("worktree pathにUnicode制御文字を使用できません");
  if (input.worktreePath !== input.worktreePath.normalize("NFC"))
    add("worktree pathはNFC正規化済みでなければなりません");
  if (path.isAbsolute(input.worktreePath))
    add("worktree pathはrepository相対pathで指定してください");
  const segments = input.worktreePath.split(/[\\/]/u);
  if (segments.includes("..")) add("worktree pathに親参照を使用できません");

  const worktreeRoot = path.resolve(input.repoRoot, policy.root);
  const destination = path.resolve(input.repoRoot, input.worktreePath);
  const relative = path.relative(worktreeRoot, destination);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).length !== 1
  )
    add("worktreeは.worktreesの直接の子へ作成してください");

  const directoryName = path.basename(destination);
  const directory = WORKTREE_NAME.exec(directoryName);
  if (!directory) add("worktree directory名が規定書式ではありません");
  else {
    if (!validTime(input.currentTime))
      add("worktree timestampの検証には有効な現在時刻が必要です");
    else {
      const timestamp = parseLocalTimestamp(directory[1] ?? "");
      if (!timestamp)
        add("worktree directory名のtimestampがlocal timeとして不正です");
      else {
        const age = input.currentTime.getTime() - timestamp.getTime();
        if (age < 0) add("worktree directory名のtimestampが未来です");
        else if (age > WORKTREE_TIMESTAMP_MAX_AGE_MS)
          add(
            "worktree directory名のtimestampは現在時刻以前かつ10分以内でなければなりません",
          );
      }
    }
    if (Number(directory[2]) !== input.issueNumber)
      add("worktree directory名のIssue番号が一致しません");
    if (directory[3] !== input.slug)
      add("worktree directory名のslugが一致しません");
  }

  const branch = BRANCH_NAME.exec(input.branch);
  if (!branch) add("branch名が規定書式ではありません");
  else {
    if (!policy.allowedBranchTypes.includes(branch[1] ?? ""))
      add("branch typeはproject policyのallowlistに含まれていません");
    if (Number(branch[2]) !== input.issueNumber)
      add("branch名のIssue番号が一致しません");
    if (branch[3] !== input.slug) add("branch名のslugが一致しません");
  }

  const candidatePathKey = collisionKey(destination);
  const candidateBranchKey = collisionKey(input.branch);
  for (const existing of input.existing) {
    const existingPath = path.isAbsolute(existing.path)
      ? path.resolve(existing.path)
      : path.resolve(input.repoRoot, existing.path);
    if (collisionKey(existingPath) === candidatePathKey)
      add("登録済みworktree pathと重複またはcase・Unicode衝突しています");
    if (collisionKey(existing.branch) === candidateBranchKey)
      add("登録済みbranchと重複またはcase・Unicode衝突しています");
    if (issueFromRegistered(existing) === input.issueNumber)
      add("同じIssue番号の登録済みworktreeが存在します");
  }
  return { valid: errors.length === 0, errors };
}

export function matchesTargetWorktree(input: {
  candidatePath: string;
  candidateBranch: string;
  targetPath: string;
  targetBranch: string;
}): boolean {
  return (
    input.candidatePath === input.targetPath &&
    input.candidateBranch === input.targetBranch
  );
}

function githubRepository(remote: string): string | undefined {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/.exec(
      remote.trim(),
    );
  return match?.[1];
}

/** Resolve the nearest existing ancestor so a symlinked parent cannot disguise a missing destination. */
function canonicalDestination(target: string): string {
  let current = path.resolve(target);
  const missing: string[] = [];
  while (true) {
    try {
      return path.resolve(fs.realpathSync(current), ...missing);
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function canonicalWorktreePath(target: string): string {
  return canonicalDestination(target);
}

function pathEntryExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return false;
    throw error;
  }
}

function registeredWorktrees(repoRoot: string): RegisteredWorktree[] {
  const records: RegisteredWorktree[] = [];
  let current: Partial<RegisteredWorktree> = {};
  const flush = (): void => {
    if (current.path && current.branch)
      records.push({ path: current.path, branch: current.branch });
    current = {};
  };
  const output = git(["worktree", "list", "--porcelain"], repoRoot).stdout;
  for (const line of output.split(/\r?\n/u)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) current.path = line.slice(9);
    if (line.startsWith("branch refs/heads/")) current.branch = line.slice(18);
  }
  flush();
  return records;
}

export function enforceTrustedWorktreeBoundary(input: {
  repoRoot: string;
  worktreePath: string;
  expectedRepository?: string;
  trustedPolicy?: Policy;
}): {
  repositoryRoot: string;
  canonicalDestination: string;
  rootMismatch: boolean;
  gitInternal: boolean;
  destinationConflict: boolean;
  repositoryMismatch: boolean;
} {
  const actualRoot = git(
    ["rev-parse", "--show-toplevel"],
    input.repoRoot,
  ).stdout.trim();
  const repositoryRoot = fs.realpathSync(input.repoRoot);
  const rootMismatch = fs.realpathSync(actualRoot) !== repositoryRoot;
  const destination = path.resolve(input.repoRoot, input.worktreePath);
  const canonical = canonicalDestination(destination);
  const gitCommonRaw = git(
    ["rev-parse", "--git-common-dir"],
    input.repoRoot,
  ).stdout.trim();
  const gitCommon = fs.realpathSync(path.resolve(input.repoRoot, gitCommonRaw));
  const gitRelative = path.relative(gitCommon, canonical);
  const gitInternal =
    gitRelative === "" ||
    (!gitRelative.startsWith(`..${path.sep}`) &&
      gitRelative !== ".." &&
      !path.isAbsolute(gitRelative));
  const destinationConflict =
    canonical === repositoryRoot || pathEntryExists(destination);
  const remote = git(["remote", "get-url", "origin"], input.repoRoot, {
    allowFailure: true,
  });
  let repositoryMismatch = remote.status !== 0;
  if (input.expectedRepository) {
    repositoryMismatch =
      repositoryMismatch ||
      githubRepository(remote.stdout) !== input.expectedRepository;
  }
  if (input.trustedPolicy) {
    const observations = input.trustedPolicy.rules
      .filter((rule) => rule.scope.includes("worktree"))
      .map((rule): RuleObservation | undefined =>
        rule.riskClass === "path"
          ? {
              ruleId: rule.ruleId,
              violated: gitInternal,
              reasons: ["worktree作成先がGit common dir内です"],
              checks: ["destinationとGit common dirを比較した"],
            }
          : rule.riskClass === "identity"
            ? {
                ruleId: rule.ruleId,
                violated:
                  rootMismatch || destinationConflict || repositoryMismatch,
                reasons: [
                  "repository、root、destinationまたはoriginの同一性が一致しません",
                ],
                checks: ["actual repositoryとremoteを検査した"],
              }
            : undefined,
      )
      .filter(
        (observation): observation is RuleObservation =>
          observation !== undefined,
      );
    const enforcement = enforceTrustedBoundary({
      policy: input.trustedPolicy,
      boundary: "worktree",
      observations,
    });
    if (!enforcement.allowed)
      throw new Error(
        `${enforcement.diagnostic?.ruleId ?? "ASC-WORKTREE"}: ${enforcement.diagnostic?.reasons.join("; ") ?? "boundary違反"}`,
      );
  }
  return {
    repositoryRoot,
    canonicalDestination: canonical,
    rootMismatch,
    gitInternal,
    destinationConflict,
    repositoryMismatch,
  };
}

function sourceStatusExcludingTarget(
  repoRoot: string,
  destination: string,
): string {
  const relative = path
    .relative(repoRoot, destination)
    .split(path.sep)
    .join("/");
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  )
    throw new Error("worktree作成先をstatus比較の対象外にできません");
  return git(
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      `:(exclude,top)${relative}`,
    ],
    repoRoot,
  ).stdout;
}

export function createWorktree(input: {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  base: string;
  issueNumber: number;
  slug: string;
  currentTime: Date;
  worktreePolicy?: WorktreePlacementPolicy;
  remoteDefaultBranch: string;
  remoteDefaultSha: string;
  expectedRepository?: string;
  trustedPolicy?: Policy;
}) {
  const boundary = enforceTrustedWorktreeBoundary(input);
  const {
    repositoryRoot,
    canonicalDestination: canonical,
    rootMismatch,
    gitInternal,
    destinationConflict,
    repositoryMismatch,
  } = boundary;
  const policy = input.worktreePolicy ?? DEFAULT_WORKTREE_PLACEMENT;
  const placement = validateWorktreePlacement({
    repoRoot: input.repoRoot,
    worktreePath: input.worktreePath,
    branch: input.branch,
    issueNumber: input.issueNumber,
    slug: input.slug,
    currentTime: input.currentTime,
    policy,
    existing: registeredWorktrees(input.repoRoot),
  });
  if (!placement.valid)
    throw new Error(`worktree配置が不正です: ${placement.errors.join("; ")}`);
  const destination = path.resolve(input.repoRoot, input.worktreePath);
  const worktreeRoot = path.resolve(repositoryRoot, policy.root);
  const canonicalWorktreeRoot = canonicalDestination(worktreeRoot);
  const rootRelative = path.relative(repositoryRoot, canonicalWorktreeRoot);
  const rootEscaped =
    rootRelative !== policy.root ||
    rootRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rootRelative);
  const placementRelative = path.relative(canonicalWorktreeRoot, canonical);
  const placementEscaped =
    placementRelative === "" ||
    placementRelative === ".." ||
    placementRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(placementRelative) ||
    placementRelative.split(path.sep).length !== 1;
  if (rootMismatch) throw new Error("リポジトリ直下パスが一致しません");
  if (rootEscaped || placementEscaped)
    throw new Error("worktree作成先が規定rootからsymlink経由で脱出しています");
  if (gitInternal) throw new Error("Git内部領域へworktreeを作成できません");
  if (destinationConflict)
    throw new Error("worktree作成先は未作成の専用パスにしてください");
  if (repositoryMismatch)
    throw new Error("originのリポジトリ同一性が一致しません");
  const baseCheck = git(
    ["rev-parse", "--verify", `${input.base}^{commit}`],
    input.repoRoot,
    { allowFailure: true },
  );
  if (baseCheck.status !== 0) throw new Error("基点コミットを検証できません");
  if (!/^[0-9a-f]{40}$/iu.test(input.remoteDefaultSha))
    throw new Error("remote default branch SHAは40桁hexで指定してください");
  const remoteHead = git(
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    input.repoRoot,
    { allowFailure: true },
  );
  const expectedRemoteRef = `refs/remotes/origin/${input.remoteDefaultBranch}`;
  if (remoteHead.status !== 0 || remoteHead.stdout.trim() !== expectedRemoteRef)
    throw new Error("remote default branchがorigin/HEADと一致しません");
  const remoteDefault = git(
    ["rev-parse", "--verify", `${expectedRemoteRef}^{commit}`],
    input.repoRoot,
    { allowFailure: true },
  );
  if (
    remoteDefault.status !== 0 ||
    remoteDefault.stdout.trim().toLowerCase() !==
      input.remoteDefaultSha.toLowerCase() ||
    baseCheck.stdout.trim().toLowerCase() !==
      input.remoteDefaultSha.toLowerCase()
  )
    throw new Error(
      "基点は取得済みremote default branch commitと一致しなければなりません",
    );
  const dirtyBefore = sourceStatusExcludingTarget(input.repoRoot, destination);
  git(
    ["worktree", "add", "-b", input.branch, destination, input.base],
    input.repoRoot,
  );
  const dirtyAfter = sourceStatusExcludingTarget(input.repoRoot, destination);
  if (dirtyAfter !== dirtyBefore)
    throw new Error(
      "作業元worktreeの状態が予期せず変化しました。復旧のため両方のworktreeを保持してください",
    );
  return {
    path: destination,
    branch: input.branch,
    base: baseCheck.stdout.trim(),
    sourceDirtyPreserved: true,
  };
}

export function inspectFinalizeState(
  repoRoot: string,
  worktreePath: string,
  evidence: {
    repository: string;
    base: string;
    specConsistent: boolean | "unknown";
    testsPassed: boolean | "unknown";
    reviewApproved: boolean | "unknown";
    prMerged: boolean | "unknown";
  },
  ignoredPathAllowlist: string[] = resolveFinalizeIgnoredPathAllowlist(),
) {
  const listed = git(["worktree", "list", "--porcelain"], repoRoot).stdout;
  const exact = `worktree ${path.resolve(worktreePath)}\n`;
  if (!listed.includes(exact))
    throw new Error("対象は登録済みworktreeではありません");
  const branch = git(["branch", "--show-current"], worktreePath).stdout.trim();
  const headSha = git(["rev-parse", "HEAD"], worktreePath).stdout.trim();
  const baseSha = git(["rev-parse", evidence.base], worktreePath).stdout.trim();
  const status = git(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    worktreePath,
  )
    .stdout.split("\n")
    .filter(Boolean);
  const untracked = status
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  const ignoredArtifacts = git(
    ["ls-files", "--others", "--ignored", "--exclude-standard"],
    worktreePath,
  )
    .stdout.split("\n")
    .filter(Boolean);
  const temporaryArtifacts = [...untracked, ...ignoredArtifacts].filter(
    (file) => /(^|\/)(\.pending-|.*\.tmp-|tmp\/|.*\.log$)/.test(file),
  );
  const stashes = git(["stash", "list"], worktreePath)
    .stdout.split("\n")
    .filter(Boolean);
  const recovery = inspectRecoveryState(worktreePath, headSha);
  return {
    repositoryRoot: path.resolve(repoRoot),
    repository: evidence.repository,
    worktree: path.resolve(worktreePath),
    branch,
    base: evidence.base,
    headSha,
    baseSha,
    dirty: status.some((line) => !line.startsWith("?? ")),
    untracked,
    stashes,
    temporaryArtifacts,
    ignoredArtifacts,
    ignoredPathAllowlist,
    pushed: recovery.pushed,
    remoteBranch: recovery.remoteBranch,
    prMerged: evidence.prMerged,
    specConsistent: evidence.specConsistent,
    testsPassed: evidence.testsPassed,
    reviewApproved: evidence.reviewApproved,
    recoveryRef: recovery.recoveryRef,
    recoveryReachable: recovery.recoveryReachable,
  };
}

export function inspectRecoveryState(
  worktreePath: string,
  knownHeadSha?: string,
) {
  const headSha =
    knownHeadSha ?? git(["rev-parse", "HEAD"], worktreePath).stdout.trim();
  const upstream = git(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    worktreePath,
    { allowFailure: true },
  );
  const remoteSha =
    upstream.status === 0
      ? git(["rev-parse", "@{upstream}"], worktreePath, { allowFailure: true })
      : { status: 1, stdout: "" };
  const recoveryRef =
    upstream.status === 0 ? upstream.stdout.trim() : undefined;
  const pushed = remoteSha.status === 0 && remoteSha.stdout.trim() === headSha;
  return {
    pushed,
    remoteBranch: upstream.status === 0,
    recoveryRef,
    recoveryReachable: Boolean(recoveryRef) && pushed,
  };
}

export { githubRepository };
