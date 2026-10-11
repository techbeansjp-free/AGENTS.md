import crypto from "node:crypto";
import fs from "node:fs";
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
    if (fs.existsSync(absolute) && !fs.lstatSync(absolute).isFile())
      throw new Error(
        `candidate Workerの差分は通常fileが必要です: ${relative}`,
      );
  }
  git(["add", "-A", "--", ...allowedPaths], root, { env: GIT_ENV });
  git(["commit", "-m", "asc: isolated candidate implementation"], root, {
    env: GIT_ENV,
  });
  const observed = observeCandidateGit(root, baseSha);
  if (observed.changedPaths.join("\0") !== changedPaths.join("\0"))
    throw new Error("candidate Workerの差分とcommitが一致しません");
  const command = validateVerificationArgv(
    input.targetTest,
    "candidate targetTest",
  );
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
