import { planWorkflowAdvance } from "../domain/workflow.js";
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
} from "./workflow-handoff.js";

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
  const handoff = observeWorkflowHandoff(
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
  if (plan.state !== "complete" && !known)
    errors.push("short-lived handoffを観測できないためdispatchできません");
  const blocked = plan.state === "blocked" || errors.length > 0;
  const state = blocked
    ? "blocked"
    : plan.state === "complete"
      ? "complete"
      : "ready";
  const action =
    state === "ready" && known
      ? known.workUnit!.contract
      : workflowExecutionContract(undefined, "coordinator", undefined);
  // Only Step 10 needs these expensive read-only gates. In particular, an
  // ordinary --plan must not rebuild the Impact graph just to show advice.
  let verificationGate:
    | { status: "satisfied" | "invalidated" | "unknown"; reason: string }
    | undefined;
  if (
    state === "ready" &&
    inspection.nextStep === 10 &&
    resume.verification !== null &&
    resume.baseSha !== null
  ) {
    try {
      const check = planVerification({ staging });
      verificationGate = {
        status: check.status === "observed" ? "satisfied" : "invalidated",
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
  const assurance = deriveAssuranceProjection({
    staging,
    mode: inspection.mode,
    nextStep: inspection.nextStep,
    journalSteps: journal.entries.map((entry) => entry.step),
    journalValid: journal.errors.length === 0 && inspection.valid,
    resume,
    action,
    role: known?.role,
    verificationGate,
    reviewGate,
  });
  const alternative =
    state === "ready" ? workflowReviewerAlternative(handoff) : undefined;
  return {
    kind: "asc-execution-plan/v1" as const,
    authority: "advisory" as const,
    resume,
    state,
    step: inspection.nextStep ?? null,
    headSha: resume.headSha,
    boundary: known?.boundary ?? null,
    workUnitId: known?.workUnit?.workUnitId ?? null,
    action,
    assurance,
    handoff:
      state === "ready" && known
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
