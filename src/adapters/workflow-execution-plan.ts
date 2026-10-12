import path from "node:path";
import { planWorkflowAdvance } from "../domain/workflow.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { isReviewSessionConverged } from "../domain/review-convergence.js";
import { observeCandidateAdoption } from "./candidate-adoption.js";
import {
  readStoredReviewSession,
  REVIEW_SESSION_FILE,
} from "./review-session-store.js";
import { deriveAssuranceProjection } from "./workflow-assurance.js";
import {
  inspectWorkflowStaging,
  readWorkflowJournal,
} from "./workflow-journal.js";
import { observeWorkflowResume } from "./workflow-resume.js";
import { planVerification } from "./verification-run.js";
import { assertConvergedReviewSession } from "./review-session.js";
import {
  observeWorkflowHandoff,
  workflowAgentDispatch,
  workflowExecutionContract,
  workflowReviewerAlternative,
  workflowVerificationContract,
  type WorkflowExecutionContract,
} from "./workflow-handoff.js";

/** Formal verification evidence may choose CLI work before an independent reviewer. */
export function shouldVerifyBeforeReview(input: {
  state: "ready" | "blocked" | "complete";
  step: number | undefined;
  role: string | undefined;
  verificationObligationStatus:
    "satisfied" | "unsatisfied" | "unknown" | "invalidated" | undefined;
  verificationPlan:
    | Pick<
        ReturnType<typeof planVerification>,
        "status" | "required" | "latestFailed"
      >
    | undefined;
}): boolean {
  return (
    input.state === "ready" &&
    input.step === 10 &&
    input.role === "reviewer" &&
    (input.verificationObligationStatus === "unsatisfied" ||
      input.verificationObligationStatus === "invalidated") &&
    input.verificationPlan?.status === "required" &&
    input.verificationPlan.required.length > 0 &&
    !input.verificationPlan.latestFailed
  );
}

/** Advisory only: candidate-adopt rechecks every gate when it mutates the journal. */
function candidateAdoptionWork(
  staging: string,
): WorkflowExecutionContract | null {
  const root = stagingRepositoryRoot(staging);
  if (!path.basename(root).startsWith(".asc-candidate-result-")) return null;
  const review = readStoredReviewSession(staging);
  if (review === null || !isReviewSessionConverged(review)) return null;
  let candidate: ReturnType<typeof observeCandidateAdoption>;
  try {
    candidate = observeCandidateAdoption(
      root,
      path.join(staging, "00_要求定義.md"),
    );
  } catch (error) {
    // A reviewer correction may be uncommitted. Keep the Step 9 work unit
    // available; the formal adoption command still rejects the dirty tree.
    if (
      error instanceof Error &&
      error.message === "Candidate結果worktreeに未記録の変更があります"
    )
      return null;
    throw error;
  }
  if (
    review.anchor.diffBaseSha !== candidate.baseSha ||
    review.latestCandidateHeadSha !== candidate.headSha
  )
    return null;
  const base = workflowExecutionContract(9, "coordinator", undefined, "quick");
  return {
    ...base,
    executor: "cli",
    purpose: "独立review済みCandidateを正式なStep 9採用記録へ進める",
    semanticReason:
      "隔離Candidateの実差分と収束reviewが同じbase・HEADに拘束されている",
    allowedOperations: [
      {
        operation: "preview-candidate-adoption",
        argv: ["workflow", "candidate-adopt"],
        requiredFlags: ["staging"],
        mode: "read",
      },
      {
        operation: "adopt-reviewed-candidate",
        argv: ["workflow", "candidate-adopt", "--apply"],
        requiredFlags: ["staging"],
        mode: "gated-apply",
      },
    ],
    requiredInputs: [
      { owner: "staging", path: "00_要求定義.md", required: true },
      { owner: "staging", path: REVIEW_SESSION_FILE, required: true },
      { owner: "git", path: "HEAD", required: true },
    ],
    preconditions: [
      {
        id: "candidate-adoption-gate",
        observedBy: "workflow candidate-adopt",
        expected: `quick Step 4 sealと同期、収束review、base=${candidate.baseSha}、HEAD=${candidate.headSha}を再検証する`,
      },
    ],
    completionConditions: [
      {
        id: "candidate-adoption-recorded",
        observedBy: "workflow advance --plan",
        expected:
          "Step 9のcandidateAdoption記録後にStep 10と正式検証を選択する",
      },
    ],
    machineChecks: [
      {
        observedBy: "cli",
        commands: ["workflow candidate-adopt"],
        facts: ["Git差分、要求digest、Planning Seal、収束review、exact HEAD"],
        selfDeclarationAccepted: false,
      },
    ],
    unconfirmed: ["正式検証、Step 10 review、Deliveryは未完了"],
  };
}

/** Read-only dispatch advice. Every mutation still re-observes its existing gate. */
export function observeWorkflowExecutionPlan(
  staging: string,
  inspection = inspectWorkflowStaging(staging),
  continuationFromHead?: string,
) {
  const resume = observeWorkflowResume(staging);
  const journal = readWorkflowJournal(staging);
  const implementation = [...journal.entries]
    .reverse()
    .find((entry) => entry.step === 9);
  const plan = planWorkflowAdvance({
    mode: inspection.mode,
    ...(inspection.currentStep === undefined
      ? {}
      : { currentStep: inspection.currentStep }),
    ...(inspection.nextStep === undefined
      ? {}
      : { nextStep: inspection.nextStep }),
    valid: inspection.valid,
    errors: inspection.errors,
    implementationHeadBound:
      implementation?.implementationHeadSha !== undefined,
  });
  const adoptionAction =
    plan.state !== "blocked" &&
    inspection.mode === "quick" &&
    inspection.nextStep === 9
      ? candidateAdoptionWork(staging)
      : null;
  const handoff = adoptionAction
    ? undefined
    : observeWorkflowHandoff(
        staging,
        inspection.nextStep,
        resume,
        continuationFromHead,
      );
  const known =
    handoff !== undefined && "kind" in handoff && handoff.workUnit
      ? handoff
      : undefined;
  const errors = [
    ...plan.reasons,
    ...resume.errors,
    ...journal.errors,
    ...(handoff && "errors" in handoff ? (handoff.errors ?? []) : []),
  ];
  if (plan.state !== "complete" && !known && adoptionAction === null)
    errors.push("short-lived handoffを観測できないためdispatchできません");
  const blocked = plan.state === "blocked" || errors.length > 0;
  const state = blocked
    ? "blocked"
    : plan.state === "complete"
      ? "complete"
      : "ready";
  const candidateAction =
    state === "ready"
      ? (adoptionAction ??
        known?.workUnit?.contract ??
        workflowExecutionContract(undefined, "coordinator", undefined))
      : workflowExecutionContract(undefined, "coordinator", undefined);
  // Only Step 10 needs these expensive read-only gates. In particular, an
  // ordinary --plan must not rebuild the Impact graph just to show advice.
  let verificationGate:
    | {
        status: "satisfied" | "unsatisfied" | "invalidated" | "unknown";
        reason: string;
      }
    | undefined;
  let verificationPlan: ReturnType<typeof planVerification> | undefined;
  if (
    state === "ready" &&
    inspection.nextStep === 10 &&
    resume.baseSha !== null
  ) {
    try {
      const check = planVerification({ staging });
      if (check.headSha !== resume.headSha)
        throw new Error("verify gateの観測HEADが最初のplan HEADから変化した");
      verificationPlan = check;
      verificationGate = {
        status:
          check.status === "observed"
            ? "satisfied"
            : check.status === "required" && resume.verification === null
              ? "unsatisfied"
              : "invalidated",
        reason:
          check.status === "observed"
            ? "既存verify gateが現在HEAD・impact・trusted policyの合格記録を再照合した"
            : (check.reason ?? "現在の条件に有効な合格検証記録がない"),
      };
    } catch (error) {
      verificationGate = {
        status: "unknown",
        reason: `既存verify gateを再照合できない: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  let reviewGate:
    | { status: "satisfied" | "invalidated" | "unknown"; reason: string }
    | undefined;
  if (
    state === "ready" &&
    inspection.nextStep === 10 &&
    resume.review?.status === "converged" &&
    resume.headSha !== null
  ) {
    try {
      assertConvergedReviewSession({
        staging,
        expectedDigest: resume.review.latestRoundDigest,
        currentHeadSha: resume.headSha,
      });
      reviewGate = {
        status: "unknown",
        reason:
          "review sessionの収束とHEAD拘束は確認したが、正式review exportと独立性の証跡は未照合",
      };
    } catch (error) {
      reviewGate = {
        status: "unknown",
        reason: `既存review session gateを再照合できない: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  // Project the existing formal observations before selecting who works next.
  // The projection is advisory; the verified plan still owns runnable argv.
  const projection = deriveAssuranceProjection({
    staging,
    mode: inspection.mode,
    nextStep: inspection.nextStep,
    journalSteps: journal.entries.map((entry) => entry.step),
    journalValid: journal.errors.length === 0 && inspection.valid,
    resume,
    action: candidateAction,
    role: known?.role,
    verificationGate,
    reviewGate,
  });
  const verificationFirst = shouldVerifyBeforeReview({
    state,
    step: inspection.nextStep,
    role: known?.role,
    verificationObligationStatus: projection.obligations.find(
      (item) => item.id === "O-06",
    )?.status,
    verificationPlan,
  });
  const action =
    verificationFirst && verificationPlan
      ? workflowVerificationContract({
          headSha: verificationPlan.headSha,
          impactDigest: verificationPlan.impactDigest,
          required: verificationPlan.required,
        })
      : candidateAction;
  const assurance =
    state === "ready" && adoptionAction
      ? {
          ...projection,
          selectedWork: {
            obligationIds: ["O-05"],
            kind: "deterministic" as const,
            evidenceRefs: ["git:HEAD", "staging:review-session"],
          },
        }
      : verificationFirst
        ? {
            ...projection,
            selectedWork: {
              obligationIds: ["O-06"],
              kind: "deterministic" as const,
              evidenceRefs:
                projection.obligations.find((item) => item.id === "O-06")
                  ?.evidenceRefs ?? [],
            },
          }
        : projection;
  const alternative =
    state === "ready" && !verificationFirst && adoptionAction === null
      ? workflowReviewerAlternative(handoff)
      : undefined;
  return {
    kind: "asc-execution-plan/v1" as const,
    authority: "advisory" as const,
    resume,
    state,
    step: inspection.nextStep ?? null,
    headSha: resume.headSha,
    boundary: adoptionAction ? null : (known?.boundary ?? null),
    workUnitId:
      verificationFirst || adoptionAction
        ? null
        : (known?.workUnit?.workUnitId ?? null),
    action,
    assurance,
    handoff:
      state === "ready" &&
      known &&
      !verificationFirst &&
      adoptionAction === null
        ? {
            ...known,
            workUnit: {
              workUnitId: known.workUnit!.workUnitId,
              freshContextRequired: known.workUnit!.freshContextRequired,
              terminalAfterHandback: known.workUnit!.terminalAfterHandback,
              reuseForbidden: known.workUnit!.reuseForbidden,
            },
          }
        : undefined,
    agentDispatch:
      state === "ready" && action.executor === "fresh-worker"
        ? workflowAgentDispatch(handoff)
        : undefined,
    ...(alternative === undefined
      ? {}
      : {
          alternatives: [
            {
              handoff: {
                ...alternative,
                workUnit: {
                  workUnitId: alternative.workUnit.workUnitId,
                  freshContextRequired:
                    alternative.workUnit.freshContextRequired,
                  terminalAfterHandback:
                    alternative.workUnit.terminalAfterHandback,
                  reuseForbidden: alternative.workUnit.reuseForbidden,
                },
              },
              action: alternative.workUnit.contract,
              agentDispatch: workflowAgentDispatch(alternative),
            },
          ],
        }),
    errors,
  };
}
