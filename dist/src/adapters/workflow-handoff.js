import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { git } from "../lib/process.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { readStoredStagingRecord } from "../domain/staging.js";
import { PLAN_SEAL_ARTIFACTS, PLAN_AMENDMENT_FILE, } from "../domain/plan-seal.js";
import { MODE_DECISION_FILE, STEP_JOURNAL_FILE } from "../domain/workflow.js";
import { readStoredReviewSession, REVIEW_SESSION_FILE, } from "./review-session-store.js";
import { GIT_ENV, evidenceOnlySuffix } from "./review-diff.js";
import { effectiveReviewBlocking, pendingReviewFindingIds, isReviewSessionConverged, } from "../domain/review-convergence.js";
const ROLES = {
    1: "request",
    2: "requirements",
    3: "readiness-reviewer",
    5: "design",
    6: "planning",
    7: "readiness-reviewer",
    9: "implementation",
};
const STEP_SKILLS = [
    "stage",
    "request",
    "requirements",
    "requirements-review",
    "issue-sync",
    "design",
    "plan",
    "design-review",
    "design-sync",
    "implement",
    "review",
    "pr",
];
/** Pointers only: no artifact bodies or new authority. Paths are relative to their owner. */
function handoffReads(step, mode, role, reviewRound) {
    if (step === undefined || STEP_SKILLS[step] === undefined)
        return undefined;
    const skillStep = role === "correction" ? 9 : step;
    const plans = mode === undefined ? [] : PLAN_SEAL_ARTIFACTS[mode];
    const inputs = step === 1
        ? [MODE_DECISION_FILE, "00_要求定義.md"]
        : step < 9
            ? plans.slice(0, step <= 2 ? 1 : step <= 5 ? 2 : step === 6 ? 3 : 4)
            : role === "correction" || (step === 10 && (reviewRound ?? 1) > 1)
                ? [REVIEW_SESSION_FILE]
                : [...plans, PLAN_AMENDMENT_FILE];
    return {
        skill: `.agent-skill-chain/skills/step-${String(skillStep).padStart(2, "0")}-${STEP_SKILLS[skillStep]}/SKILL.md`,
        staging: inputs,
    };
}
/** Optional execution advice; never an approval or a substitute for workflow gates. */
export function observeWorkflowHandoff(staging, step, resume, continuationFromHead) {
    if ((process.env.ASC_EXECUTION_CONTEXT_MODE ?? "short-lived") !== "short-lived")
        return undefined;
    if (resume.errors.length > 0 || resume.headSha === null)
        return { state: "blocked", errors: resume.errors };
    try {
        const worktree = stagingRepositoryRoot(staging);
        const session = readStoredReviewSession(staging);
        let role = step === undefined ? "coordinator" : (ROLES[step] ?? "coordinator");
        let reviewRound = null;
        let findingIds = [];
        if (step === 10) {
            const sameHead = session?.latestCandidateHeadSha === resume.headSha;
            role =
                session !== null &&
                    isReviewSessionConverged(session) &&
                    (sameHead ||
                        evidenceOnlySuffix(worktree, session.latestCandidateHeadSha, resume.headSha) !== undefined)
                    ? "coordinator"
                    : sameHead &&
                        session?.status === "active" &&
                        pendingReviewFindingIds(session).length === 0
                        ? "correction"
                        : "reviewer";
            reviewRound =
                (session?.rounds.length ?? 0) + (role === "reviewer" ? 1 : 0);
            findingIds = session ? effectiveReviewBlocking(session) : [];
        }
        const hash = (relative) => {
            const file = path.join(staging, relative);
            if (!fs.existsSync(file))
                return null;
            const stat = fs.lstatSync(file);
            if (!stat.isFile() ||
                stat.isSymbolicLink() ||
                stat.nlink !== 1 ||
                stat.size > 2 * 1024 * 1024)
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
            .update(JSON.stringify({
            staging,
            headSha: resume.headSha,
            step: step ?? null,
            role,
            reviewRound,
            boundary,
            continuationFromHead: continuationFromHead ?? null,
        }))
            .digest("hex");
        const record = readStoredStagingRecord(staging);
        return {
            kind: "asc-handoff/v1",
            authority: "advisory",
            issue: record?.tracker ?? null,
            read: handoffReads(step, record?.mode, role, reviewRound),
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
    }
    catch (error) {
        return {
            state: "blocked",
            errors: [error instanceof Error ? error.message : String(error)],
        };
    }
}
/** Ready-to-use one-shot Agent arguments derived from repository state. */
export function workflowAgentDispatch(handoff) {
    if (!handoff ||
        !("kind" in handoff) ||
        !handoff.workUnit ||
        handoff.role === "coordinator")
        return undefined;
    return {
        subagent_type: "general-purpose",
        description: `ASC Step ${handoff.step} ${handoff.role} ${handoff.workUnit.workUnitId.slice(0, 12)}`,
        prompt: JSON.stringify({
            handoff,
            prompt: "指定workUnitId専用のfresh one-shot workerです。worktreeでresume.commandをpreviewしhandoff/alternativesのHEAD・boundary・workUnitIdを照合。不一致なら再dispatchを要求。read.skillとread.stagingの必要節から始め、確定済みmode/Step/上流判断を再推論しない。Skillが指定する契約と独立検証は維持。担当だけを完了し、workUnitId/status/HEAD/検証記録ID/blocker/nextのcompact JSONを返す。詳細はGit/staging/finding、Step/round記録はcoordinator。返却後terminal、追加作業にはASC_REDISPATCH_REQUIRED。",
        }),
    };
}
//# sourceMappingURL=workflow-handoff.js.map