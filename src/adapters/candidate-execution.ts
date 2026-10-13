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
  CANDIDATE_GIT_ENV,
  assertNoCandidateFilters,
  observeCandidateBoundary,
  observeCandidateForkBase,
  observeCandidateGit,
  observeRemovedAccessGuard,
} from "./candidate-git.js";
import { candidateAllowedPaths } from "./candidate-session.js";
import {
  runCandidateCodexWorker,
  type CodexCandidateUsage,
} from "./candidate-codex-worker.js";
import {
  makeDirectoriesRemovable,
  runCandidateWorkerBoundary,
} from "./candidate-worker-boundary.js";

export interface CandidateExecutionInput {
  root: string;
  intent: string;
  correctnessCriterion: string;
  allowedPaths: string[];
  risk: Partial<Record<CandidateRisk, CandidateRiskStatus>>;
  unresolved: string[];
  workerArgv?: string[];
  workerProvider?: "codex";
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
    { env: CANDIDATE_GIT_ENV },
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
        git(argv, root, { env: CANDIDATE_GIT_ENV })
          .stdout.split("\0")
          .filter(Boolean),
      ),
    ),
  ].sort();
}

interface CandidateFileSnapshot {
  bytes: Buffer;
  mode: number;
}

interface CandidateImport {
  relative: string;
  file: CandidateFileSnapshot | null;
  original: CandidateFileSnapshot | null;
}

function readCandidateFile(
  file: string,
  relative: string,
  remainingBytes: number,
): CandidateFileSnapshot | null {
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const before = fs.fstatSync(fd);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > Math.min(16 * 1024 * 1024, remainingBytes)
    )
      throw new Error(
        `candidate import対象が通常fileではないかsize上限を超えます: ${relative}`,
      );
    const bytes = Buffer.alloc(before.size);
    let readBytes = 0;
    while (readBytes < bytes.length) {
      const count = fs.readSync(
        fd,
        bytes,
        readBytes,
        bytes.length - readBytes,
        null,
      );
      if (count === 0) break;
      readBytes += count;
    }
    const extra = Buffer.alloc(1);
    const extraBytes = fs.readSync(fd, extra, 0, 1, null);
    const after = fs.fstatSync(fd);
    if (
      readBytes !== before.size ||
      extraBytes !== 0 ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error(
        `candidate import対象が読取中に変更されました: ${relative}`,
      );
    return { bytes, mode: before.mode & 0o777 };
  } finally {
    fs.closeSync(fd);
  }
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
    allowedPaths,
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
  // The Worker can write an allowed parent directory. Run it in a separate
  // throwaway worktree and import only the validated allowed files.
  const workerRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "asc-candidate-copy-"),
  );
  let workerRegistered = false;
  let workerBoundary: "host-enforced" | "codex-profile" | undefined;
  let workerUsage: CodexCandidateUsage | null = null;
  let workerElapsedMs: number | null = null;
  let changedPaths: string[] = [];
  let imports: CandidateImport[] = [];
  let workerFailure: unknown;
  try {
    git(["worktree", "add", "--detach", "--", workerRoot, baseSha], root, {
      env: CANDIDATE_GIT_ENV,
    });
    workerRegistered = true;
    assertNoIgnoredWorkerInputs(workerRoot, allowedPaths);
    const worker =
      input.workerProvider === "codex"
        ? runCandidateCodexWorker({
            root: workerRoot,
            allowedPaths,
            intent: input.intent,
            correctnessCriterion: input.correctnessCriterion,
          })
        : runCandidateWorkerBoundary({
            root: workerRoot,
            allowedPaths,
            argv: input.workerArgv ?? [],
          });
    workerBoundary = worker.boundary;
    workerUsage = "usage" in worker ? worker.usage : null;
    workerElapsedMs = "elapsedMs" in worker ? worker.elapsedMs : null;
    if (worker.status !== 0)
      throw new Error(
        `candidate Workerが失敗しました（終了値${worker.status}）: ${worker.stderr.slice(0, 500)}`,
      );
    assertNoCandidateFilters(workerRoot);
    assertNoIgnoredWorkerInputs(workerRoot, allowedPaths);
    if (
      git(["rev-parse", "HEAD"], workerRoot, {
        env: CANDIDATE_GIT_ENV,
      }).stdout.trim() !== baseSha
    )
      throw new Error("candidate Workerが事前HEADを変更しました");
    changedPaths = uncommittedPaths(workerRoot);
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
      const source = path.join(workerRoot, relative);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(source);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error(
          `candidate Workerの差分は通常fileが必要です: ${relative}`,
        );
    }
    let remainingBytes = 64 * 1024 * 1024;
    imports = changedPaths.map((relative) => {
      const file = readCandidateFile(
        path.join(workerRoot, relative),
        relative,
        remainingBytes,
      );
      remainingBytes -= file?.bytes.length ?? 0;
      const original = readCandidateFile(
        path.join(root, relative),
        relative,
        remainingBytes,
      );
      remainingBytes -= original?.bytes.length ?? 0;
      return { relative, file, original };
    });
    if (observeCandidateBoundary(root).headSha !== baseSha)
      throw new Error("candidate import前に元worktreeが変更されました");
  } catch (error) {
    workerFailure = error;
  }
  const cleanupErrors: unknown[] = [];
  if (workerRegistered) {
    try {
      git(["worktree", "remove", "--force", "--", workerRoot], root, {
        env: CANDIDATE_GIT_ENV,
      });
    } catch (first) {
      try {
        // Git may already have removed registration before deletion fails.
        // Remove the owned temp directory, then verify both artifacts are gone.
        makeDirectoriesRemovable(workerRoot);
        fs.rmSync(workerRoot, { recursive: true, force: true });
        const registered = git(["worktree", "list", "--porcelain"], root, {
          env: CANDIDATE_GIT_ENV,
        })
          .stdout.split("\n")
          .some((line) => line === `worktree ${workerRoot}`);
        if (registered)
          throw new Error("candidate一時worktreeのGit登録が残っています", {
            cause: first,
          });
      } catch (second) {
        cleanupErrors.push(first, second);
      }
    }
  }
  try {
    fs.rmSync(workerRoot, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (workerFailure !== undefined && cleanupErrors.length > 0)
    throw new AggregateError(
      [workerFailure, ...cleanupErrors],
      `candidate Workerとcleanupが失敗しました: ${cleanupErrors.map(String).join("; ").slice(0, 800)}`,
    );
  if (workerFailure !== undefined) throw workerFailure;
  if (cleanupErrors.length > 0)
    throw new AggregateError(
      cleanupErrors,
      `candidate一時worktreeのcleanupが失敗しました: ${cleanupErrors.map(String).join("; ").slice(0, 800)}`,
    );
  if (workerBoundary === undefined)
    throw new Error("candidate Worker境界を観測できません");
  if (observeCandidateBoundary(root).headSha !== baseSha)
    throw new Error("candidate staging前に元worktreeが変更されました");
  // Build the private index and commit object from bounded Worker snapshots.
  // The caller's worktree is never modified. Git failures leave it intact.
  // A private index keeps staging failures out of the caller's index, while
  // commit-tree never executes repository hooks. A later HEAD observation
  // rejects concurrent changes before the result worktree is returned.
  const indexDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "asc-candidate-index-"),
  );
  const indexEnv = {
    ...CANDIDATE_GIT_ENV,
    GIT_INDEX_FILE: path.join(indexDir, "index"),
  };
  let publishedCommitSha: string;
  try {
    git(["-c", "core.hooksPath=/dev/null", "read-tree", baseSha], root, {
      env: indexEnv,
    });
    const stagedBlobs = new Map<string, { sha: string; mode: number } | null>();
    // hash-object reads a Coordinator-owned copy of the validated Worker bytes.
    // The caller's worktree is still untouched if any Git operation fails.
    for (const item of imports) {
      if (item.file === null) {
        git(
          [
            "-c",
            "core.hooksPath=/dev/null",
            "update-index",
            "--force-remove",
            "--",
            item.relative,
          ],
          root,
          { env: indexEnv },
        );
        stagedBlobs.set(item.relative, null);
        continue;
      }
      const blobFile = path.join(indexDir, `blob-${crypto.randomUUID()}`);
      let blobSha: string;
      try {
        fs.writeFileSync(blobFile, item.file.bytes, {
          flag: "wx",
          mode: 0o600,
        });
        blobSha = git(
          ["hash-object", "-w", "--no-filters", "--", blobFile],
          root,
          { env: indexEnv },
        ).stdout.trim();
      } finally {
        fs.rmSync(blobFile, { force: true });
      }
      if (!/^[0-9a-f]{40}$/.test(blobSha))
        throw new Error(`candidate blob SHAが不正です: ${item.relative}`);
      git(
        [
          "-c",
          "core.hooksPath=/dev/null",
          "update-index",
          "--add",
          "--cacheinfo",
          item.file.mode & 0o111 ? "100755" : "100644",
          blobSha,
          item.relative,
        ],
        root,
        { env: indexEnv },
      );
      stagedBlobs.set(item.relative, {
        sha: blobSha,
        mode: item.file.mode & 0o111,
      });
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
    for (const item of imports) {
      const staged = stagedBlobs.get(item.relative);
      if (
        item.file === null
          ? staged !== null
          : !staged || staged.mode !== (item.file.mode & 0o111)
      )
        throw new Error(
          `candidate stagingのsnapshotが一致しません: ${item.relative}`,
        );
    }
    const treeSha = git(["write-tree"], root, { env: indexEnv }).stdout.trim();
    if (
      git(["rev-parse", "HEAD"], root, {
        env: CANDIDATE_GIT_ENV,
      }).stdout.trim() !== baseSha
    )
      throw new Error(
        "candidate commit前にHEADが移動しました。隔離worktreeを破棄してください",
      );
    const commitEnv = {
      ...CANDIDATE_GIT_ENV,
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
    publishedCommitSha = commitSha;
  } finally {
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
  if (observeCandidateBoundary(root).headSha !== baseSha)
    throw new Error(
      "candidate元worktreeが変更されました。候補commitは公開しません",
    );
  const outputRoot = fs.mkdtempSync(
    path.join(path.dirname(root), ".asc-candidate-result-"),
  );
  try {
    // Materialize the commit only in a new, unpredictable worktree. The
    // caller's worktree is never overwritten, so concurrent edits survive.
    git(
      ["worktree", "add", "--detach", "--", outputRoot, publishedCommitSha],
      root,
      {
        env: CANDIDATE_GIT_ENV,
      },
    );
    const observed = observeCandidateGit(outputRoot, baseSha);
    if (observed.headSha !== publishedCommitSha)
      throw new Error("candidate publication後にHEADが変更されました");
    if (observed.changedPaths.join("\0") !== changedPaths.join("\0"))
      throw new Error("candidate Workerの差分とcommitが一致しません");
    const testResult = runCandidateWorkerBoundary({
      root: outputRoot,
      allowedPaths: [],
      argv: command,
    });
    const afterTest = observeCandidateBoundary(outputRoot).headSha;
    if (afterTest !== publishedCommitSha)
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
      removedAccessGuard: observeRemovedAccessGuard(
        outputRoot,
        baseSha,
        publishedCommitSha,
      ),
    });
    if (observeCandidateBoundary(root).headSha !== baseSha)
      throw new Error("candidate元worktreeが実行中に変更されました");
    return {
      ...decision,
      ...observed,
      intent: input.intent,
      correctnessCriterion: input.correctnessCriterion,
      allowedPaths,
      targetTest,
      workerBoundary,
      workerUsage,
      workerElapsedMs,
      formalWorkflowUnchanged: true,
      independentReviewRequired: true,
      riskAssessmentSource: "caller-asserted" as const,
      candidateWorktree: outputRoot,
    };
  } catch (error) {
    try {
      const registered = git(["worktree", "list", "--porcelain"], root, {
        env: CANDIDATE_GIT_ENV,
      })
        .stdout.split("\n")
        .some((line) => line === `worktree ${outputRoot}`);
      if (registered) {
        try {
          git(["worktree", "remove", "--force", "--", outputRoot], root, {
            env: CANDIDATE_GIT_ENV,
          });
        } catch (removeError) {
          makeDirectoriesRemovable(outputRoot);
          fs.rmSync(outputRoot, { recursive: true, force: true });
          const stillRegistered = git(
            ["worktree", "list", "--porcelain"],
            root,
            {
              env: CANDIDATE_GIT_ENV,
            },
          )
            .stdout.split("\n")
            .some((line) => line === `worktree ${outputRoot}`);
          if (stillRegistered)
            throw new Error(
              "candidate出力worktreeの登録が残っています。破棄が必要です",
              { cause: removeError },
            );
        }
      }
      fs.rmSync(outputRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "candidate出力とcleanupが失敗しました。出力worktreeを破棄してください",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
