import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import type { StepJournalEntry } from "../domain/workflow.js";
import { isSecuritySensitivePath } from "../domain/impact-set.js";
import {
  CANDIDATE_GIT_ENV,
  assertNoCandidateFilters,
} from "./candidate-git.js";
import { observeReviewDiff } from "./review-diff.js";
import { resolveGitWorkspace } from "./review-workspace.js";
import {
  readStagingLayout,
  stagingExcludePathspec,
} from "../domain/staging-layout.js";

function resolveTrustedForkBase(
  root: string,
  headSha: string,
  pinnedTip?: string,
) {
  const trustedTip =
    pinnedTip ??
    git(["rev-parse", "--verify", "refs/remotes/origin/HEAD^{commit}"], root, {
      env: CANDIDATE_GIT_ENV,
    }).stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(trustedTip))
    throw new Error("trusted既定branch tipが不正です");
  const bases = git(["merge-base", "--all", headSha, trustedTip], root, {
    env: CANDIDATE_GIT_ENV,
  })
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  if (bases.length !== 1 || !/^[a-f0-9]{40}$/u.test(bases[0]!))
    throw new Error(
      "Candidate結果とtrusted既定branchの一意な分岐点がありません",
    );
  return { baseSha: bases[0]!, trustedTipSha: trustedTip };
}

/** The first result commit is Coordinator-owned; later commits are review corrections. */
function assertCandidateLineage(
  root: string,
  baseSha: string,
  headSha: string,
): void {
  const commits = git(
    ["rev-list", "--first-parent", "--reverse", `${baseSha}..${headSha}`],
    root,
    { env: CANDIDATE_GIT_ENV },
  )
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  const total = Number(
    git(["rev-list", "--count", `${baseSha}..${headSha}`], root, {
      env: CANDIDATE_GIT_ENV,
    }).stdout.trim(),
  );
  if (commits.length === 0 || commits.length !== total)
    throw new Error("Candidate修正履歴にmergeまたは欠落があります");
  let parent = baseSha;
  for (const [index, commit] of commits.entries()) {
    const parents = git(["rev-list", "--parents", "-n", "1", commit], root, {
      env: CANDIDATE_GIT_ENV,
    })
      .stdout.trim()
      .split(" ");
    if (parents.length !== 2 || parents[1] !== parent)
      throw new Error("Candidate修正履歴が単一直列ではありません");
    if (index === 0) {
      const subject = git(["show", "-s", "--format=%B", commit], root, {
        env: CANDIDATE_GIT_ENV,
      }).stdout.trim();
      if (subject !== "asc: isolated candidate implementation")
        throw new Error("Candidate結果commitの形式が一致しません");
    }
    parent = commit;
  }
}

/** Re-observe a result commit; caller risk, gaps and target test are never promoted. */
export function observeCandidateAdoption(
  rootInput: string,
  requestFile: string,
) {
  const root = fs.realpathSync(rootInput);
  const workspace = resolveGitWorkspace(root);
  if (
    path.basename(root).startsWith(".asc-candidate-result-") === false ||
    workspace.activeRoot === workspace.primaryRoot ||
    git(["symbolic-ref", "-q", "HEAD"], root, {
      env: CANDIDATE_GIT_ENV,
      allowFailure: true,
    }).status === 0
  )
    throw new Error("正式採用にはdetachedのCandidate結果用worktreeが必要です");
  assertNoCandidateFilters(root);
  const headSha = git(["rev-parse", "--verify", "HEAD^{commit}"], root, {
    env: CANDIDATE_GIT_ENV,
  }).stdout.trim();
  const trustedFork = resolveTrustedForkBase(root, headSha);
  const baseSha = trustedFork.baseSha;
  assertCandidateLineage(root, baseSha, headSha);
  const status = git(
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      stagingExcludePathspec(readStagingLayout(root)),
    ],
    root,
    { env: CANDIDATE_GIT_ENV },
  ).stdout;
  if (status !== "")
    throw new Error("Candidate結果worktreeに未記録の変更があります");
  const diff = observeReviewDiff(root, baseSha, headSha);
  if (diff.changedPaths.length === 0)
    throw new Error("Candidate結果に実装差分がありません");
  if (diff.changedPaths.some(isSecuritySensitivePath))
    throw new Error("セキュリティ関連差分は実装先行採用せず上流確認が必要です");
  const requestStat = fs.lstatSync(requestFile);
  if (
    !requestStat.isFile() ||
    requestStat.isSymbolicLink() ||
    requestStat.nlink !== 1
  )
    throw new Error("正式要求成果物はsymlinkでない通常fileが必要です");
  const request = fs.readFileSync(requestFile);
  if (request.length === 0 || request.length > 256 * 1024)
    throw new Error("正式要求成果物のサイズが不正です");
  const requestDigest = crypto
    .createHash("sha256")
    .update(request)
    .digest("hex");
  if (
    git(["rev-parse", "HEAD"], root, {
      env: CANDIDATE_GIT_ENV,
    }).stdout.trim() !== headSha
  )
    throw new Error("Candidate採用観測中にHEADが変更されました");
  return {
    baseSha,
    trustedTipSha: trustedFork.trustedTipSha,
    headSha,
    changedPaths: diff.changedPaths,
    diffDigest: diff.digest,
    requestDigest,
    advisoryTargetTestIsFormalEvidence: false as const,
    independentReviewRequired: true as const,
  };
}

/** Recompute a recorded adoption from immutable Git commits and sealed request bytes. */
export function verifyRecordedCandidateAdoption(
  root: string,
  requestFile: string,
  entry: StepJournalEntry,
): string[] {
  if (!entry.candidateAdoption) return [];
  const errors: string[] = [];
  try {
    const headSha = entry.implementationHeadSha;
    if (!headSha) throw new Error("採用記録にimplementation HEADがありません");
    const observed = observeReviewDiff(
      root,
      entry.candidateAdoption.baseSha,
      headSha,
    );
    if (observed.digest !== entry.candidateAdoption.diffDigest)
      errors.push("採用記録のGit差分digestが一致しません");
    if (
      observed.changedPaths.length === 0 ||
      observed.changedPaths.some(isSecuritySensitivePath)
    )
      errors.push("採用対象の差分が空かセキュリティ関連です");
    assertCandidateLineage(root, entry.candidateAdoption.baseSha, headSha);
    if (
      entry.candidateAdoption.baseSha !==
      resolveTrustedForkBase(
        root,
        headSha,
        entry.candidateAdoption.trustedTipSha,
      ).baseSha
    )
      errors.push(
        "採用commitの基点がtrusted既定branchとの分岐点と一致しません",
      );
    const requestStat = fs.lstatSync(requestFile);
    if (
      !requestStat.isFile() ||
      requestStat.isSymbolicLink() ||
      requestStat.nlink !== 1 ||
      requestStat.size > 256 * 1024
    )
      errors.push("正式要求成果物の形式またはsizeが不正です");
    else if (
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(requestFile))
        .digest("hex") !== entry.candidateAdoption.requestDigest
    )
      errors.push("採用記録の正式要求digestが一致しません");
  } catch (error) {
    errors.push(
      `採用記録を再計算できません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return errors;
}
