import { planWorkflowAdvance } from "../domain/workflow.js";
import { deriveAssuranceProjection } from "./workflow-assurance.js";
import { inspectWorkflowStaging, readWorkflowJournal, } from "./workflow-journal.js";
import { observeWorkflowResume } from "./workflow-resume.js";
import { planVerification } from "./verification-run.js";
import { assertConvergedReviewSession } from "./review-session.js";
import { observeWorkflowHandoff, workflowAgentDispatch, workflowExecutionContract, workflowReviewerAlternative, workflowVerificationContract, } from "./workflow-handoff.js";
/** Formal verification evidence may choose CLI work before an independent reviewer. */
export function shouldVerifyBeforeReview(input) {
    return (input.state === "ready" &&
        input.step === 10 &&
        input.role === "reviewer" &&
        (input.verificationObligationStatus === "unsatisfied" ||
            input.verificationObligationStatus === "invalidated") &&
        input.verificationPlan?.status === "required" &&
        input.verificationPlan.required.length > 0 &&
        !input.verificationPlan.latestFailed);
}
/** Read-only dispatch advice. Every mutation still re-observes its existing gate. */
export function observeWorkflowExecutionPlan(staging, inspection = inspectWorkflowStaging(staging), continuationFromHead) {
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
        implementationHeadBound: implementation?.implementationHeadSha !== undefined,
    });
    const handoff = observeWorkflowHandoff(staging, inspection.nextStep, resume, continuationFromHead);
    const known = handoff !== undefined && "kind" in handoff && handoff.workUnit
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
    const candidateAction = state === "ready" && known
        ? known.workUnit.contract
        : workflowExecutionContract(undefined, "coordinator", undefined);
    // Only Step 10 needs these expensive read-only gates. In particular, an
    // ordinary --plan must not rebuild the Impact graph just to show advice.
    let verificationGate;
    let verificationPlan;
    if (state === "ready" &&
        inspection.nextStep === 10 &&
        resume.baseSha !== null) {
        try {
            const check = planVerification({ staging });
            if (check.headSha !== resume.headSha)
                throw new Error("verify gateの観測HEADが最初のplan HEADから変化した");
            verificationPlan = check;
            verificationGate = {
                status: check.status === "observed"
                    ? "satisfied"
                    : check.status === "required" && resume.verification === null
                        ? "unsatisfied"
                        : "invalidated",
                reason: check.status === "observed"
                    ? "既存verify gateが現在HEAD・impact・trusted policyの合格記録を再照合した"
                    : (check.reason ?? "現在の条件に有効な合格検証記録がない"),
            };
        }
        catch (error) {
            verificationGate = {
                status: "unknown",
                reason: `既存verify gateを再照合できない: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    let reviewGate;
    if (state === "ready" &&
        inspection.nextStep === 10 &&
        resume.review?.status === "converged" &&
        resume.headSha !== null) {
        try {
            assertConvergedReviewSession({
                staging,
                expectedDigest: resume.review.latestRoundDigest,
                currentHeadSha: resume.headSha,
            });
            reviewGate = {
                status: "unknown",
                reason: "review sessionの収束とHEAD拘束は確認したが、正式review exportと独立性の証跡は未照合",
            };
        }
        catch (error) {
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
        verificationObligationStatus: projection.obligations.find((item) => item.id === "O-06")?.status,
        verificationPlan,
    });
    const action = verificationFirst && verificationPlan
        ? workflowVerificationContract({
            headSha: verificationPlan.headSha,
            impactDigest: verificationPlan.impactDigest,
            required: verificationPlan.required,
        })
        : candidateAction;
    const assurance = verificationFirst
        ? {
            ...projection,
            selectedWork: {
                obligationIds: ["O-06"],
                kind: "deterministic",
                evidenceRefs: projection.obligations.find((item) => item.id === "O-06")
                    ?.evidenceRefs ?? [],
            },
        }
        : projection;
    const alternative = state === "ready" && !verificationFirst
        ? workflowReviewerAlternative(handoff)
        : undefined;
    return {
        kind: "asc-execution-plan/v1",
        authority: "advisory",
        resume,
        state,
        step: inspection.nextStep ?? null,
        headSha: resume.headSha,
        boundary: known?.boundary ?? null,
        workUnitId: verificationFirst
            ? null
            : (known?.workUnit?.workUnitId ?? null),
        action,
        assurance,
        handoff: state === "ready" && known && !verificationFirst
            ? {
                ...known,
                workUnit: {
                    workUnitId: known.workUnit.workUnitId,
                    freshContextRequired: known.workUnit.freshContextRequired,
                    terminalAfterHandback: known.workUnit.terminalAfterHandback,
                    reuseForbidden: known.workUnit.reuseForbidden,
                },
            }
            : undefined,
        agentDispatch: state === "ready" && action.executor === "fresh-worker"
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
                                freshContextRequired: alternative.workUnit.freshContextRequired,
                                terminalAfterHandback: alternative.workUnit.terminalAfterHandback,
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
//# sourceMappingURL=workflow-execution-plan.js.map