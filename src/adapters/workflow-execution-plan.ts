import { planWorkflowAdvance } from "../domain/workflow.js";
import {
  inspectWorkflowStaging,
  readWorkflowJournal,
} from "./workflow-journal.js";
import { observeWorkflowResume } from "./workflow-resume.js";
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
