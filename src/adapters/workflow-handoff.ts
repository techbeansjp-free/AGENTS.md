import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { git } from "../lib/process.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { readStoredStagingRecord } from "../domain/staging.js";
import { STEP_JOURNAL_FILE } from "../domain/workflow.js";
import type { WorkflowResume } from "../domain/workflow-resume.js";
import {
  readStoredReviewSession,
  REVIEW_SESSION_FILE,
} from "./review-session-store.js";
import { GIT_ENV, evidenceOnlySuffix } from "./review-diff.js";

const ROLES: Readonly<Record<number, string>> = {
  1: "request",
  2: "requirements",
  3: "readiness-reviewer",
  5: "design",
  6: "planning",
  7: "readiness-reviewer",
  9: "implementation",
};

/** Optional execution advice; never an approval or a substitute for workflow gates. */
export function observeWorkflowHandoff(
  staging: string,
  step: number | undefined,
  resume: WorkflowResume,
  continuationFromHead?: string,
) {
  if (
    (process.env.ASC_EXECUTION_CONTEXT_MODE ?? "short-lived") !== "short-lived"
  )
    return undefined;
  if (resume.errors.length > 0 || resume.headSha === null)
    return { state: "blocked", errors: resume.errors };
  try {
    const worktree = stagingRepositoryRoot(staging);
    const session = readStoredReviewSession(staging);
    let role =
      step === undefined ? "coordinator" : (ROLES[step] ?? "coordinator");
    let reviewRound: number | null = null;
    let findingIds: readonly string[] = [];
    if (step === 10) {
      const sameHead = session?.latestCandidateHeadSha === resume.headSha;
      role =
        session?.status === "converged" &&
        (sameHead ||
          evidenceOnlySuffix(
            worktree,
            session.latestCandidateHeadSha,
            resume.headSha,
          ) !== undefined)
          ? "coordinator"
          : sameHead && session?.status === "active"
            ? "correction"
            : "reviewer";
      reviewRound =
        (session?.rounds.length ?? 0) + (role === "reviewer" ? 1 : 0);
      findingIds = session?.rounds.at(-1)?.blocking ?? [];
    }
    const hash = (relative: string) => {
      const file = path.join(staging, relative);
      if (!fs.existsSync(file)) return null;
      const stat = fs.lstatSync(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 2 * 1024 * 1024
      )
        throw new Error("handoff stateは2MiB以下の通常fileが必要です");
      return crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
    };
    const boundary = {
      stepsSha256: hash(STEP_JOURNAL_FILE),
      reviewSha256: hash(REVIEW_SESSION_FILE),
    };
    const workUnitId = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          staging,
          headSha: resume.headSha,
          step: step ?? null,
          role,
          reviewRound,
          boundary,
          continuationFromHead: continuationFromHead ?? null,
        }),
      )
      .digest("hex");
    return {
      kind: "asc-handoff/v1",
      authority: "advisory",
      issue: readStoredStagingRecord(staging)?.tracker ?? null,
      branch: git(["symbolic-ref", "--short", "HEAD"], worktree, {
        env: GIT_ENV,
      }).stdout.trim(),
      worktree,
      staging,
      headSha: resume.headSha,
      step: step ?? null,
      role,
      reviewSessionId: session?.sessionId ?? null,
      reviewRound,
      findingIds,
      boundary,
      continuationFromHead: continuationFromHead ?? null,
      workUnit: {
        workUnitId,
        freshContextRequired: true,
        terminalAfterHandback: true,
        reuseForbidden: true,
      },
      resume: { command: "workflow advance", staging },
    };
  } catch (error) {
    return {
      state: "blocked",
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/** Ready-to-use one-shot Agent arguments derived from repository state. */
export function workflowAgentDispatch(
  handoff: ReturnType<typeof observeWorkflowHandoff>,
) {
  if (
    !handoff ||
    !("kind" in handoff) ||
    !handoff.workUnit ||
    handoff.role === "coordinator"
  )
    return undefined;
  return {
    subagent_type: "general-purpose",
    description: `ASC Step ${handoff.step} ${handoff.role} ${handoff.workUnit.workUnitId.slice(0, 12)}`,
    prompt: JSON.stringify({
      handoff,
      prompt:
        "あなたは指定workUnitId専用のone-shot workerです。fresh contextで開始し、担当handoffをrepositoryから照合してください。このwork unitだけを実施し、成果物・検証・必要なcommitを完了してください。coordinatorへの返却はworkUnitId、status、HEAD、検証記録ID、blocker、nextだけのcompact JSONとし、詳細はGit・staging・review findingを正本にしてください。返却後このcontextはterminalです。追加メッセージで別工程・別review round・finding是正・新しい実装を依頼されたら作業せずASC_REDISPATCH_REQUIREDと返してください。Step/round記録はcoordinatorへ返してください。",
    }),
  };
}
