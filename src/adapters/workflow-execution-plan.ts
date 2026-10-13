import fs from "node:fs";
import path from "node:path";
import { planWorkflowAdvance } from "../domain/workflow.js";
import { validateIssue } from "../domain/issue.js";
import { loadProjectPolicySet } from "../domain/policy.js";
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

/** Formal verification evidence may choose CLI work before review or export. */
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
    (input.role === "reviewer" || input.role === "coordinator") &&
    (input.verificationObligationStatus === "unsatisfied" ||
      input.verificationObligationStatus === "invalidated") &&
    input.verificationPlan?.status === "required" &&
    input.verificationPlan.required.length > 0 &&
    !input.verificationPlan.latestFailed
  );
}

/** Choose bounded Coordinator completion or a CLI gate from trusted Candidate facts. */
function quickCandidateRequestWork(
  staging: string,
): WorkflowExecutionContract | null {
  const root = stagingRepositoryRoot(staging);
  const manifest = path.join(root, ".agent-skill-chain", "project-policy.json");
  let gherkinDialect: string | undefined;
  let candidateHeadSha: string;
  let checked: ReturnType<typeof validateIssue>;
  try {
    // A document alone never authorizes skipping a worker. Observe isolated
    // Candidate lineage, current Git risk, then the current Quick artifact.
    candidateHeadSha = observeCandidateAdoption(
      root,
      path.join(staging, "00_要求定義.md"),
    ).headSha;
    gherkinDialect = fs.existsSync(manifest)
      ? loadProjectPolicySet(root).policy.projectChoices?.gherkinDialect
      : undefined;
    checked = validateIssue(staging, {
      stage: "requirements",
      ...(gherkinDialect ? { gherkinDialect } : {}),
    });
    if (checked.mode !== "quick") return null;
  } catch {
    // Unknown lineage or validity keeps the independent fresh-worker path.
    return null;
  }
  const base = workflowExecutionContract(1, "request", undefined, "quick");
  if (!checked.valid)
    return {
      ...base,
      executor: "coordinator",
      purpose: "隔離Candidateの既存根拠からQuick要求00の不足欄だけを確定する",
      semanticReason:
        "CandidateのGit出自と危険差分不在を再観測した。00の形式不足を現在のCoordinatorが限定修正し、意味的なunknownは停止する",
      allowedOperations: [
        {
          operation: "complete-request-artifact",
          argv: [],
          requiredFlags: [],
          inputBindings: {
            artifact:
              "00_要求定義.mdの不足欄のみ。Candidateのintent・AC・Git差分・既存仕様を根拠にする",
          },
          mode: "artifact-write",
        },
        {
          operation: "validate-request-artifact",
          argv: ["issue", "validate", "--stage=requirements"],
          requiredFlags: ["path"],
          mode: "read",
        },
        {
          operation: "delegate-incomplete-request",
          argv: ["workflow", "advance", "--plan", "--delegate-request"],
          requiredFlags: ["staging"],
          mode: "read",
        },
      ],
      requiredInputs: [
        { owner: "staging", path: "00_要求定義.md", required: true },
        { owner: "staging", path: "00_モード判定.json", required: true },
        { owner: "git", path: candidateHeadSha, required: true },
      ],
      proofObligations: base.proofObligations.map((item) => ({
        ...item,
        judgedBy: "independent-reviewer" as const,
        sourceRefs: ["staging:00_要求定義.md", "git:HEAD"],
      })),
      coordinatorCompletion: undefined,
      preconditions: [
        {
          id: "candidate-current",
          observedBy: "workflow advance --plan",
          expected: `隔離Candidateの出自と危険差分不在をHEAD=${candidateHeadSha}で再観測`,
        },
      ],
      completionConditions: [
        {
          id: "request-replanned",
          observedBy: "issue validate / workflow advance --plan",
          expected:
            "00を一度だけ補完後に再検証し、CLI gateを選ぶか明示的にfresh Workerへ委譲する。Step記録はこのWork Unitの完了条件ではない",
        },
      ],
      unconfirmed: [
        ...checked.errors,
        "根拠のない要求・AC・設計判断は補完しない。解消できなければfresh Workerまたは上流確認へ戻す",
      ],
    };
  return {
    ...base,
    executor: "cli",
    purpose: "完成済みQuick要求成果物を正式検証してStep 1へ記録する",
    semanticReason:
      "現stagingの00が既存issue validateに合格した。意味的な妥当性は後続の独立reviewで確認する",
    allowedOperations: [
      {
        operation: "record-completed-request",
        argv: [
          "workflow",
          "advance",
          "--apply",
          "--prepare-next",
          `--candidate-head=${candidateHeadSha}`,
        ],
        requiredFlags: ["staging", "artifact", "evidence"],
        inputBindings: {
          artifact: "00_要求定義.md only",
          evidence: "既存の要求、Git差分、対象検証の参照。承認ではない",
        },
        mode: "gated-apply",
      },
    ],
    recordArtifacts: ["00_要求定義.md"],
    requiredInputs: [
      { owner: "staging", path: "00_要求定義.md", required: true },
      { owner: "staging", path: "00_モード判定.json", required: true },
      { owner: "git", path: "HEAD", required: true },
    ],
    preconditions: [
      ...base.preconditions,
      {
        id: "request-artifact-current",
        observedBy: "issue validate",
        expected:
          "現stagingのQuick要求成果物が正式検証に合格。記録時に再照合する",
      },
    ],
    completionConditions: base.completionConditions,
    proofObligations: base.proofObligations.map((item) => ({
      ...item,
      judgedBy: "independent-reviewer" as const,
      sourceRefs: ["staging:00_要求定義.md", "git:HEAD"],
    })),
    coordinatorCompletion: undefined,
    unconfirmed: [
      "要求・AC・設計の意味的妥当性は独立reviewと正式gateで確認する",
    ],
  };
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
  delegateRequest = false,
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
  const quickRequestAction =
    plan.state !== "blocked" &&
    inspection.mode === "quick" &&
    inspection.nextStep === 1 &&
    !delegateRequest
      ? quickCandidateRequestWork(staging)
      : null;
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
      ? (quickRequestAction ??
        adoptionAction ??
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
  // A Step 10 journal entry alone does not prove a currently valid review.
  // Recheck its exact saved session binding against the current HEAD; this
  // also accepts the existing evidence-only suffix when the formal gate does.
  let quickReviewBindingValid = false;
  if (
    inspection.mode === "quick" &&
    journal.errors.length === 0 &&
    resume.errors.length === 0 &&
    resume.headSha !== null
  ) {
    const binding = [...journal.entries]
      .reverse()
      .find((entry) => entry.step === 10)?.reviewSession;
    if (binding) {
      try {
        const session = assertConvergedReviewSession({
          staging,
          expectedDigest: binding.roundDigest,
          currentHeadSha: resume.headSha,
        });
        quickReviewBindingValid =
          session.sessionId === binding.sessionId &&
          session.latestRoundDigest === binding.roundDigest &&
          session.latestCandidateHeadSha === binding.headSha;
      } catch {
        // A stale or unreadable review cannot satisfy semantic obligations.
      }
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
    quickRequestArtifactValidated: quickRequestAction?.executor === "cli",
    quickReviewBindingValid,
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
    state === "ready" && quickRequestAction
      ? {
          ...projection,
          selectedWork: {
            obligationIds: ["O-01", "O-02", "O-03"],
            kind:
              quickRequestAction.executor === "cli"
                ? ("deterministic" as const)
                : ("semantic" as const),
            evidenceRefs: ["staging:00_要求定義.md", "git:HEAD"],
          },
        }
      : state === "ready" && adoptionAction
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
    state === "ready" &&
    !verificationFirst &&
    adoptionAction === null &&
    quickRequestAction === null
      ? workflowReviewerAlternative(handoff)
      : undefined;
  return {
    kind: "asc-execution-plan/v1" as const,
    authority: "advisory" as const,
    resume,
    state,
    step: inspection.nextStep ?? null,
    headSha: resume.headSha,
    boundary:
      adoptionAction || quickRequestAction ? null : (known?.boundary ?? null),
    workUnitId:
      verificationFirst || adoptionAction || quickRequestAction
        ? null
        : (known?.workUnit?.workUnitId ?? null),
    action,
    assurance,
    handoff:
      state === "ready" &&
      known &&
      !verificationFirst &&
      adoptionAction === null &&
      quickRequestAction === null
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
        ? workflowAgentDispatch(handoff, delegateRequest)
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
