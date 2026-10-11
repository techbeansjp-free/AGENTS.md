import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../lib/process.js";
import { validateVerificationArgv } from "../domain/verification-run.js";
import {
  CANDIDATE_RISKS,
  decideCandidatePost,
  decideCandidatePreflight,
  type CandidateGap,
  type CandidateRisk,
  type CandidateRiskStatus,
} from "../domain/candidate-workflow.js";
import {
  observeCandidateBoundary,
  observeCandidateForkBase,
  observeCandidateGit,
} from "./candidate-git.js";
import { candidateAllowedPaths } from "./candidate-session.js";
import { runCandidateWorkerBoundary } from "./candidate-worker-boundary.js";
import { GIT_ENV } from "./review-diff.js";

export interface CandidateExecutionInput {
  root: string;
  intent: string;
  correctnessCriterion: string;
  allowedPaths: string[];
  risk: Partial<Record<CandidateRisk, CandidateRiskStatus>>;
  unresolved: string[];
  workerArgv: string[];
  targetTest: string[];
  gaps: CandidateGap[];
}

function assertNoIgnoredWorkerInputs(
  root: string,
  allowedPaths: readonly string[],
): void {
  const directories = [
    ...new Set(allowedPaths.map((item) => path.posix.dirname(item))),
  ];
  const ignored = git(
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      ...directories,
    ],
    root,
    { env: GIT_ENV },
  )
    .stdout.split("\0")
    .filter(Boolean);
  if (ignored.length > 0)
    throw new Error(
      `candidate Workerの書込領域にGit ignored fileがあります: ${ignored.join(", ")}`,
    );
}

function uncommittedPaths(root: string): string[] {
  const commands = [
    ["diff", "--name-only", "-z", "--no-renames", "--"],
    ["diff", "--cached", "--name-only", "-z", "--no-renames", "--"],
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
  ];
  return [
    ...new Set(
      commands.flatMap((argv) =>
        git(argv, root, { env: GIT_ENV }).stdout.split("\0").filter(Boolean),
      ),
    ),
  ].sort();
}

/** Preflight, isolated Worker and Git observation share one trusted Coordinator invocation. */
export function executeCandidate(input: CandidateExecutionInput) {
  const root = fs.realpathSync(input.root);
  const baseSha = observeCandidateBoundary(root).headSha;
  const allowedPaths = candidateAllowedPaths(input.allowedPaths);
  if (observeCandidateForkBase(root, baseSha) !== baseSha)
    throw new Error("candidate事前HEADがGit分岐点と一致しません");
  const preflight = decideCandidatePreflight({
    intent: input.intent,
    correctnessCriterion: input.correctnessCriterion,
    baseSha,
    isolatedWorktree: true,
    risk: input.risk,
    unresolved: input.unresolved,
  });
  if (preflight.route !== "candidate") return { ...preflight, baseSha };
  // Reject malformed verification before the Worker can mutate its disposable worktree.
  const command = validateVerificationArgv(
    input.targetTest,
    "candidate targetTest",
  );
  if (
    Object.keys(input.risk).some(
      (key) => !CANDIDATE_RISKS.includes(key as CandidateRisk),
    )
  )
    throw new Error("未知のcandidateリスク項目があります");
  assertNoIgnoredWorkerInputs(root, allowedPaths);
  const worker = runCandidateWorkerBoundary({
    root,
    allowedPaths,
    argv: input.workerArgv,
  });
  if (worker.status !== 0)
    throw new Error(
      `candidate Workerが失敗しました（終了値${worker.status}）: ${worker.stderr.slice(0, 500)}`,
    );
  assertNoIgnoredWorkerInputs(root, allowedPaths);
  const currentSha = git(["rev-parse", "HEAD"], root, {
    env: GIT_ENV,
  }).stdout.trim();
  if (currentSha !== baseSha)
    throw new Error("candidate Workerが事前HEADを変更しました");
  const changedPaths = uncommittedPaths(root);
  if (changedPaths.length === 0)
    throw new Error("candidate Workerが候補差分を作成しませんでした");
  const unexpected = changedPaths.filter(
    (item) => !allowedPaths.includes(item),
  );
  if (unexpected.length > 0)
    throw new Error(
      `candidate Workerが許可範囲外を変更しました: ${unexpected.join(", ")}`,
    );
  for (const relative of changedPaths) {
    const absolute = path.join(root, relative);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error(
        `candidate Workerの差分は通常fileが必要です: ${relative}`,
      );
  }
  // A private index keeps staging failures out of the caller's index. commit-tree
  // never executes repository hooks, and update-ref compares the exact preflight
  // HEAD so a concurrent move cannot be silently committed over.
  const indexDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "asc-candidate-index-"),
  );
  const indexEnv = { ...GIT_ENV, GIT_INDEX_FILE: path.join(indexDir, "index") };
  try {
    git(["read-tree", baseSha], root, { env: indexEnv });
    const stagedBlobs = new Map<string, { sha: string; mode: number } | null>();
    // Bypass repository-defined clean filters and Git hooks. Only the observed
    // regular-file bytes enter this private index.
    for (const relative of changedPaths) {
      const absolute = path.join(root, relative);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(absolute);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          git(["update-index", "--force-remove", "--", relative], root, {
            env: indexEnv,
          });
          stagedBlobs.set(relative, null);
          continue;
        }
        throw error;
      }
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error(
          `candidate staging対象が通常fileではありません: ${relative}`,
        );
      const blobSha = git(
        ["hash-object", "-w", "--no-filters", "--", relative],
        root,
        {
          env: indexEnv,
        },
      ).stdout.trim();
      if (!/^[0-9a-f]{40}$/.test(blobSha))
        throw new Error(`candidate blob SHAが不正です: ${relative}`);
      git(
        [
          "update-index",
          "--add",
          "--cacheinfo",
          stat.mode & 0o111 ? "100755" : "100644",
          blobSha,
          relative,
        ],
        root,
        { env: indexEnv },
      );
      stagedBlobs.set(relative, { sha: blobSha, mode: stat.mode & 0o111 });
    }
    const stagedPaths = git(
      ["diff", "--cached", "--name-only", "-z", "--no-renames", "--"],
      root,
      { env: indexEnv },
    )
      .stdout.split("\0")
      .filter(Boolean)
      .sort();
    if (stagedPaths.join("\0") !== changedPaths.join("\0"))
      throw new Error(
        "candidate staging中に差分が変更されました。隔離worktreeを破棄してください",
      );
    const stagedEntries = git(
      ["ls-files", "--stage", "-z", "--", ...allowedPaths],
      root,
      { env: indexEnv },
    )
      .stdout.split("\0")
      .filter(Boolean);
    if (
      stagedEntries.some(
        (entry) => !/^100(?:644|755) [0-9a-f]{40} 0\t/u.test(entry),
      )
    )
      throw new Error(
        "candidate stagingに通常file以外があります。隔離worktreeを破棄してください",
      );
    for (const relative of changedPaths) {
      const absolute = path.join(root, relative);
      const staged = stagedBlobs.get(relative);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(absolute);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === "ENOENT" &&
          staged === null
        )
          continue;
        throw new Error(
          `candidate staging後に作業fileが変更されました: ${relative}`,
          { cause: error },
        );
      }
      if (
        !staged ||
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o111) !== staged.mode ||
        git(["hash-object", "--no-filters", "--", relative], root, {
          env: indexEnv,
        }).stdout.trim() !== staged.sha
      )
        throw new Error(
          `candidate staging後に作業fileが変更されました: ${relative}`,
        );
    }
    const treeSha = git(["write-tree"], root, { env: indexEnv }).stdout.trim();
    if (
      git(["rev-parse", "HEAD"], root, { env: GIT_ENV }).stdout.trim() !==
      baseSha
    )
      throw new Error(
        "candidate commit前にHEADが移動しました。隔離worktreeを破棄してください",
      );
    const commitEnv = {
      ...GIT_ENV,
      GIT_AUTHOR_NAME: "ASC Candidate",
      GIT_AUTHOR_EMAIL: "candidate@localhost.invalid",
      GIT_COMMITTER_NAME: "ASC Candidate",
      GIT_COMMITTER_EMAIL: "candidate@localhost.invalid",
    };
    const commitSha = git(
      [
        "commit-tree",
        treeSha,
        "-p",
        baseSha,
        "-m",
        "asc: isolated candidate implementation",
      ],
      root,
      { env: commitEnv },
    ).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(commitSha))
      throw new Error("candidate commit objectが不正です");
    git(
      [
        "-c",
        "core.hooksPath=/dev/null",
        "update-ref",
        "HEAD",
        commitSha,
        baseSha,
      ],
      root,
      { env: GIT_ENV },
    );
    // An interruption here leaves a visibly dirty disposable worktree;
    // observeCandidateBoundary rejects it on the next run.
    git(["read-tree", treeSha], root, { env: GIT_ENV });
  } finally {
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
  const observed = observeCandidateGit(root, baseSha);
  if (observed.changedPaths.join("\0") !== changedPaths.join("\0"))
    throw new Error("candidate Workerの差分とcommitが一致しません");
  const testResult = runCandidateWorkerBoundary({
    root,
    allowedPaths: [],
    argv: command,
  });
  const afterTest = observeCandidateBoundary(root).headSha;
  if (afterTest !== observed.headSha)
    throw new Error("candidate差分と対象テストのHEADが一致しません");
  const targetTest = {
    headSha: afterTest,
    argv: command,
    exitCode: testResult.status,
    outputSha256: crypto
      .createHash("sha256")
      .update(testResult.stdout)
      .update("\0")
      .update(testResult.stderr)
      .digest("hex"),
    source: "cli-observed-isolated-target-test" as const,
    formalEvidence: false as const,
  };
  const decision = decideCandidatePost({
    observedPaths: observed.changedPaths,
    allowedPaths,
    targetTestsPassed: targetTest.exitCode === 0,
    gaps: input.gaps,
  });
  return {
    ...decision,
    ...observed,
    intent: input.intent,
    correctnessCriterion: input.correctnessCriterion,
    allowedPaths,
    targetTest,
    workerBoundary: worker.boundary,
    formalWorkflowUnchanged: true,
    independentReviewRequired: true,
    riskAssessmentSource: "caller-asserted" as const,
  };
}
