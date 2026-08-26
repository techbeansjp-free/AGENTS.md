import { isRecord } from "../types.js";
import {
  assessWorktreeRemovalSafety,
  resolveFinalizeIgnoredPathAllowlist,
} from "./worktree-removal-safety.js";

export type WorktreeDisposition =
  "in-progress" | "cleanup-ready" | "retain" | "primary";

export interface WorktreeObservation {
  repositoryRoot: string;
  path: string;
  branch: string;
  isPrimary: boolean;
  mergedIntoDefault: boolean;
  dirty: boolean;
  untracked: string[];
  ignoredArtifacts: string[];
  stashes: string[];
  unpushedCommits: number;
  pushed: boolean;
  remoteBranch: boolean;
  recoveryReachable: boolean;
}

export interface WorktreeSurveyEntry {
  path: string;
  branch: string;
  disposition: WorktreeDisposition;
  reasons: string[];
}

export interface WorktreeSurvey {
  entries: WorktreeSurveyEntry[];
  cleanupReady: string[];
  retained: string[];
  inProgress: string[];
  errors: string[];
}

const OBSERVATION_FIELDS = new Set([
  "path",
  "repositoryRoot",
  "branch",
  "isPrimary",
  "mergedIntoDefault",
  "dirty",
  "untracked",
  "ignoredArtifacts",
  "stashes",
  "unpushedCommits",
  "pushed",
  "remoteBranch",
  "recoveryReachable",
]);

function emptySurvey(errors: string[] = []): WorktreeSurvey {
  return {
    entries: [],
    cleanupReady: [],
    retained: [],
    inProgress: [],
    errors,
  };
}

function validationErrors(value: unknown, index: number): string[] {
  const prefix = `entry[${index}]`;
  if (!isRecord(value)) return [`${prefix}はobjectでなければなりません`];
  const errors: string[] = [];
  const unknown = Object.keys(value).filter(
    (field) => !OBSERVATION_FIELDS.has(field),
  );
  if (unknown.length > 0)
    errors.push(`${prefix}に未知fieldがあります: ${unknown.join(", ")}`);
  if (typeof value.path !== "string" || value.path.trim() === "")
    errors.push(`${prefix}.pathは空でない文字列でなければなりません`);
  if (
    typeof value.repositoryRoot !== "string" ||
    value.repositoryRoot.trim() === ""
  )
    errors.push(`${prefix}.repositoryRootは空でない文字列でなければなりません`);
  if (typeof value.branch !== "string" || value.branch.trim() === "")
    errors.push(`${prefix}.branchは空でない文字列でなければなりません`);
  for (const field of [
    "isPrimary",
    "mergedIntoDefault",
    "dirty",
    "recoveryReachable",
    "pushed",
    "remoteBranch",
  ])
    if (typeof value[field] !== "boolean")
      errors.push(`${prefix}.${field}はbooleanでなければなりません`);
  if (
    !Array.isArray(value.untracked) ||
    value.untracked.some((item) => typeof item !== "string")
  )
    errors.push(`${prefix}.untrackedは文字列配列でなければなりません`);
  for (const field of ["ignoredArtifacts", "stashes"])
    if (
      !Array.isArray(value[field]) ||
      value[field].some((item) => typeof item !== "string")
    )
      errors.push(`${prefix}.${field}は文字列配列でなければなりません`);
  if (
    !Number.isInteger(value.unpushedCommits) ||
    Number(value.unpushedCommits) < 0
  )
    errors.push(`${prefix}.unpushedCommitsは0以上の整数でなければなりません`);
  return errors;
}

function classify(
  observation: WorktreeObservation,
  ignoredPathAllowlist: unknown,
): WorktreeSurveyEntry {
  if (observation.isPrimary)
    return {
      path: observation.path,
      branch: observation.branch,
      disposition: "primary",
      reasons: ["repository root自身は後片付け対象ではありません"],
    };
  const assessment = assessWorktreeRemovalSafety({
    repositoryRoot: observation.repositoryRoot,
    worktreePath: observation.path,
    trackedChanges: observation.dirty,
    untracked: observation.untracked,
    ignoredArtifacts: observation.ignoredArtifacts,
    ignoredPathAllowlist,
    stashes: observation.stashes,
    pushed: observation.pushed,
    remoteBranch: observation.remoteBranch,
    merged: observation.mergedIntoDefault,
    recoveryReachable: observation.recoveryReachable,
    unpushedCommits: observation.unpushedCommits,
  });
  const reasons = assessment.reasons;
  if (!observation.mergedIntoDefault)
    return {
      path: observation.path,
      branch: observation.branch,
      disposition: "in-progress",
      reasons,
    };
  return reasons.length > 0
    ? {
        path: observation.path,
        branch: observation.branch,
        disposition: "retain",
        reasons,
      }
    : {
        path: observation.path,
        branch: observation.branch,
        disposition: "cleanup-ready",
        reasons: [
          "既定branchへmerge済みで、finalize共通の保持条件がありません",
        ],
      };
}

export function surveyWorktrees(
  value: unknown,
  ignoredPathAllowlist: unknown = resolveFinalizeIgnoredPathAllowlist(),
): WorktreeSurvey {
  if (!Array.isArray(value))
    return emptySurvey(["worktree観測は配列でなければなりません"]);
  const result = emptySurvey();
  const candidates: Array<{
    index: number;
    observation: WorktreeObservation;
  }> = [];
  for (const [index, entry] of value.entries()) {
    const errors = validationErrors(entry, index);
    if (errors.length > 0) {
      result.errors.push(...errors);
      continue;
    }
    candidates.push({ index, observation: entry as WorktreeObservation });
  }
  const pathCounts = new Map<string, number>();
  for (const { observation } of candidates)
    pathCounts.set(
      observation.path,
      (pathCounts.get(observation.path) ?? 0) + 1,
    );
  const duplicatePaths = new Set(
    [...pathCounts]
      .filter(([, count]) => count > 1)
      .map(([entryPath]) => entryPath),
  );
  for (const duplicatePath of duplicatePaths)
    result.errors.push(`worktree pathが重複しています: ${duplicatePath}`);
  for (const { observation } of candidates) {
    if (duplicatePaths.has(observation.path)) continue;
    const entry = classify(observation, ignoredPathAllowlist);
    result.entries.push(entry);
    if (entry.disposition === "cleanup-ready")
      result.cleanupReady.push(entry.path);
    else if (entry.disposition === "retain") result.retained.push(entry.path);
    else if (entry.disposition === "in-progress")
      result.inProgress.push(entry.path);
  }
  return result;
}
