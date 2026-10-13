import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import {
  STEP_JOURNAL_FILE,
  WORKFLOW_STEPS,
} from "../../src/domain/workflow.js";
import {
  observeWorkflowExecutionPlan,
  shouldVerifyBeforeReview,
} from "../../src/adapters/workflow-execution-plan.js";
import {
  deriveAssuranceProjection,
  type AssuranceProjection,
} from "../../src/adapters/workflow-assurance.js";
import {
  observeWorkflowHandoff,
  workflowExecutionContract,
  workflowReviewerAlternative,
  workflowVerificationContract,
  type WorkflowExecutionContract,
} from "../../src/adapters/workflow-handoff.js";
import { observeWorkflowResume } from "../../src/adapters/workflow-resume.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import { fixtureInstant } from "../support/fixture-instant.js";
import { git } from "../../src/lib/process.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import {
  buildReviewRoundDraft,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { installTrustedVerificationPolicy } from "../support/trusted-verification-policy.js";

class ExecutionPlanWorld extends WorkflowWorld {
  root = "";
  staging = "";
  snapshot = "";
  step = 0;
  role = "";
  action?: WorkflowExecutionContract;
  plans: ReturnType<typeof observeWorkflowExecutionPlan>[] = [];
  assurance?: AssuranceProjection;
  evidenceProjections?: {
    unresolved: AssuranceProjection;
    valid: AssuranceProjection;
    stale: AssuranceProjection;
  };
  quickReviewProjections?: {
    stale: AssuranceProjection;
    corrected: AssuranceProjection;
    invalidated: AssuranceProjection;
  };
  alternative?: ReturnType<typeof workflowReviewerAlternative>;
  originalId = "";
  refusal = false;
  verificationGateKind = "";
  verificationObligationStatus:
    "satisfied" | "unsatisfied" | "unknown" | "invalidated" = "unknown";
  latestVerificationFailed = false;
  verificationSelected = false;
}
const { Given, When, Then } = stepDefinitions<ExecutionPlanWorld>();
function snapshot(world: ExecutionPlanWorld): string {
  const files = fs
    .readdirSync(world.staging, { recursive: true })
    .map(String)
    .sort();
  return JSON.stringify({
    files: files
      .filter((file) => fs.statSync(path.join(world.staging, file)).isFile())
      .map((file) => [
        file,
        fs.readFileSync(path.join(world.staging, file), "utf8"),
      ]),
    status: git(["status", "--porcelain"], world.root).stdout,
    head: git(["rev-parse", "HEAD"], world.root).stdout,
  });
}
async function runPlan(staging: string, extras: string[] = []) {
  const output = process.stdout.write;
  let text = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    text += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return {
      status: await main([
        "workflow",
        "advance",
        `--staging=${staging}`,
        ...(extras.some(
          (option) => option.startsWith("--plan=") || option === "--apply",
        )
          ? []
          : ["--plan"]),
        ...extras,
      ]),
      text,
    };
  } finally {
    process.stdout.write = output;
  }
}
Given(
  "execution契約のStep「{int}」とrole「{word}」がある",
  function (step: number, role: string) {
    this.step = step;
    this.role = role;
  },
);
When("execution契約を導出する", function () {
  this.action = workflowExecutionContract(this.step, this.role, undefined);
});

Given(
  "Step11のdelivery状態「{word}」とmerge方針「{word}」がある",
  function (state: string, mode: string) {
    this.step = 11;
    this.role = "coordinator";
    this.value = { state, mode };
  },
);
When("Step11の実行契約を導出する", function () {
  const value = this.value as { state: string; mode: string };
  const trustedMergeMode =
    value.mode === "poc"
      ? "disabled"
      : (value.mode as "disabled" | "assisted" | "automatic");
  this.action = workflowExecutionContract(
    11,
    "coordinator",
    undefined,
    value.mode === "poc" ? "poc" : "quick",
    value.state === "none"
      ? undefined
      : {
          state: value.state as
            "pr-bound" | "merge-prepared" | "merge-observed",
          pr: 2,
          trustedMergeMode,
        },
  );
});
Then(
  "最初の操作は「{word}」で承認flagは「{word}」である",
  function (operation: string, authorize: string) {
    assert.ok(this.action);
    assert.equal(
      this.action.allowedOperations[0]?.operation ?? "none",
      operation,
    );
    assert.equal(
      this.action.allowedOperations.some((item) =>
        item.requiredFlags.includes("authorize"),
      ),
      authorize === "true",
    );
    const value = this.value as { state: string; mode: string };
    if (value.state === "pr-bound" && value.mode === "assisted")
      assert.equal(
        this.action.allowedOperations[0]?.requiredFlags.includes("authorize"),
        true,
      );
  },
);
Then(
  "executorは「{word}」で最大1遷移と正式gate完了条件を持つ",
  function (executor: string) {
    assert.ok(this.action);
    assert.equal(this.action.executor, executor);
    assert.equal(this.action.maxTransitions, 1);
    if (executor === "none") {
      assert.deepEqual(this.action.allowedOperations, []);
      return;
    }
    assert.ok(this.action.semanticReason.length > 0);
    assert.ok(
      this.action.preconditions.some(
        (condition) =>
          condition.id === "boundary-current" &&
          condition.expected.includes("開始前"),
      ),
    );
    assert.equal(
      this.action.completionConditions.some(
        (condition) => condition.id === "boundary-current",
      ),
      false,
    );
    assert.ok(
      this.action.completionConditions.some(
        (condition) =>
          condition.id === "formal-gate" &&
          condition.expected.includes("結果HEAD"),
      ),
    );
    assert.ok(this.action.proofObligations.length > 0);
    assert.ok(this.action.proofObligations.length < 7);
    if ([5, 6, 7].includes(this.step)) {
      const design = this.action.proofObligations.find(
        (item) => item.kind === "Design",
      );
      assert.match(design?.question ?? "", /docs\/specs\/02_要件\//u);
      assert.match(design?.question ?? "", /no-spec-impact/u);
      assert.match(design?.question ?? "", /既存の要件IDで足りるなら参照/u);
    }
    assert.equal(
      this.action.unconfirmed.length,
      this.action.proofObligations.length,
    );
    assert.equal(
      JSON.stringify(this.action).includes('"fulfilled":true'),
      false,
    );
    if (this.role === "reviewer" || this.role === "readiness-reviewer")
      assert.ok(
        this.action.proofObligations.every(
          (item) => item.judgedBy === "independent-reviewer",
        ),
      );
    if (this.step === 11)
      assert.ok(
        this.action.proofObligations.some(
          (item) => item.judgedBy === "human-policy",
        ),
      );
    assert.ok(
      this.action.completionConditions.some(
        (condition) => condition.id === "formal-gate",
      ),
    );
    assert.equal(
      JSON.stringify(this.action).includes('"approved":true'),
      false,
    );
    if (this.step === 4 || this.step === 8)
      assert.deepEqual(this.action.allowedOperations[0]?.argv, [
        "workflow",
        "advance",
        "--dry-run",
      ]);
    if (this.step === 11) {
      assert.ok(
        this.action.allowedOperations[0]?.requiredFlags.includes("evidence"),
      );
      assert.ok(
        this.action.allowedOperations.some(
          (item) =>
            item.when === "reviewed-summary-available" &&
            item.requiredFlags.includes("from-summary"),
        ),
      );
      assert.ok(
        this.action.requiredInputs.some(
          (item) => item.path === "H_impl:--from-summary" && !item.required,
        ),
      );
    }
    if (this.step === 4 || this.step === 8) {
      const apply = this.action.allowedOperations[1]!;
      assert.ok(apply.requiredFlags.includes("expected-body-sha256"));
      assert.equal(
        apply.inputBindings?.["expected-body-sha256"],
        "preview-sync.sync.bodySha256",
      );
      assert.ok(apply.argv.includes("--prepare-next"));
    }
    if (this.step === 11)
      assert.ok(
        this.action.allowedOperations[1]?.requiredFlags.includes("authorize"),
      );
    if (
      this.action.executor === "fresh-worker" &&
      this.action.proofObligations.some((item) => item.kind === "Verification")
    ) {
      assert.ok(
        this.action.proofObligations
          .filter((item) => item.kind === "Verification")
          .every(
            (item) => item.judgedBy !== "cli" && item.question.includes("十分"),
          ),
      );
      if (this.step === 9 || this.step === 10)
        assert.deepEqual(this.action.machineChecks, [
          {
            observedBy: "cli",
            commands: ["verify run", "review export"],
            facts: ["HEAD", "scope", "trusted-command", "result"],
            selfDeclarationAccepted: false,
          },
        ]);
    }
    if (this.step === 9 || (this.step === 10 && this.role !== "coordinator")) {
      assert.equal(
        this.action.allowedOperations.find(
          (operation) => operation.operation === "observe-verification",
        )?.when,
        "required-command-unknown",
      );
      assert.match(
        this.action.allowedOperations.find(
          (operation) => operation.operation === "run-required-verification",
        )?.requiredTrailingArgv ?? "",
        /known formally required trusted command/u,
      );
    }
    if ([1, 2, 3, 5, 6, 7, 9, 10].includes(this.step)) {
      const completion = this.action.coordinatorCompletion;
      assert.ok(completion);
      assert.equal(completion.owner, "coordinator");
      assert.equal(completion.gateReobservationRequired, true);
      assert.equal(
        this.action.allowedOperations.some(
          (operation) =>
            operation.argv[0] === "workflow" &&
            ["advance", "record"].includes(operation.argv[1] ?? ""),
        ),
        false,
      );
      if (this.step < 10)
        assert.ok(completion.operations[0]?.argv.includes("--prepare-next"));
      else if (this.role === "correction")
        assert.ok(completion.operations[0]?.argv.includes("--step=9"));
      else if (this.role === "reviewer")
        assert.deepEqual(completion.operations[0]?.argv, [
          "review",
          "round",
          "--apply",
        ]);
      else
        assert.equal(
          completion.operations.find((operation) =>
            operation.argv.includes("--step=10"),
          )?.inputBindings["review-session-digest"],
          "review export.latestRoundDigest",
        );
      if (this.step === 9)
        assert.equal(
          completion.operations[1]?.inputBindings["continue-from"],
          "executionPlan.headSha at work-unit entry",
        );
    }
    if (this.step === 1 || this.step === 5)
      assert.equal(
        this.action.allowedOperations.some(
          (operation) =>
            operation.argv[0] === "issue" && operation.argv[1] === "validate",
        ),
        false,
      );
    if ([2, 3, 6, 7].includes(this.step))
      assert.ok(
        this.action.allowedOperations.some((operation) =>
          operation.argv.includes(
            `--stage=${this.step <= 3 ? "requirements" : "design"}`,
          ),
        ),
      );
    if (this.role === "reviewer")
      assert.equal(this.action.allowedOperations[0]?.mode, "read");
  },
);
Given("executionPlan用の隔離full stagingがある", function () {
  this.plans = [];
  this.refusal = false;
  this.root = this.initRepo();
  this.staging = createIssueStaging(this.root, {
    title: "execution-plan",
    requestedMode: "full",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: false, evidence: "fixture scope observed" },
      ]),
    ),
    now: new Date(fixtureInstant()),
  }).path;
  this.snapshot = snapshot(this);
});
When("workflow advanceのplanを2回観測する", async function () {
  for (let i = 0; i < 2; i += 1) {
    const result = await runPlan(this.staging);
    assert.equal(result.status, 0, result.text);
    this.plans.push(
      JSON.parse(result.text) as ReturnType<
        typeof observeWorkflowExecutionPlan
      >,
    );
  }
});
Then("同じHEAD境界のfresh契約だけが返り保存内容は不変である", function () {
  assert.deepEqual(this.plans[0], this.plans[1]);
  const plan = this.plans[0]!;
  assert.equal(plan.kind, "asc-execution-plan/v1");
  assert.equal(plan.authority, "advisory");
  assert.equal(plan.state, "ready");
  assert.equal(plan.step, 1);
  assert.equal(
    plan.action.allowedOperations.some(
      (operation) => operation.operation === "validate-artifact",
    ),
    false,
  );
  assert.equal(plan.action.executor, "fresh-worker");
  assert.equal(plan.assurance.authority, "advisory");
  assert.equal(plan.assurance.observedHeadSha, plan.headSha);
  assert.equal(plan.assurance.observedMode, "full");
  assert.equal(
    plan.assurance.obligations.find((item) => item.id === "O-01")?.status,
    "unsatisfied",
  );
  assert.deepEqual(plan.assurance.selectedWork.obligationIds, ["O-01", "O-02"]);
  assert.equal(plan.assurance.selectedWork.kind, "semantic");
  assert.ok(plan.agentDispatch);
  const dispatched = JSON.parse(plan.agentDispatch.prompt) as {
    handoff: { headSha: string; workUnit: { workUnitId: string } };
  };
  assert.equal(dispatched.handoff.headSha, plan.headSha);
  assert.equal(dispatched.handoff.workUnit.workUnitId, plan.workUnitId);
  assert.equal(plan.agentDispatch.prompt.includes('"contract"'), false);
  assert.ok(Buffer.byteLength(plan.agentDispatch.prompt) < 2500);
  assert.match(plan.workUnitId!, /^[a-f0-9]{64}$/u);
  assert.ok(
    plan.action.requiredInputs.some((input) => input.path === "00_要求定義.md"),
  );
  assert.equal(snapshot(this), this.snapshot);
});
When("planに禁止option「{word}」を指定する", async function (option: string) {
  try {
    const result = await runPlan(this.staging, [option]);
    this.refusal = result.status !== 0;
  } catch (error) {
    if (option.includes("=__present__"))
      assert.match(String(error), /値を付けず/u);
    this.refusal = true;
  }
});
Then("planは拒否され保存内容は不変である", function () {
  assert.equal(this.refusal, true);
  assert.equal(snapshot(this), this.snapshot);
});
When("journalを破損させてexecutionPlanを観測する", function () {
  fs.appendFileSync(
    path.join(this.staging, STEP_JOURNAL_FILE),
    "invalid-json\n",
  );
  this.plans.push(observeWorkflowExecutionPlan(this.staging));
});
Then("executorはnoneでdispatchがなくblocked理由を返す", function () {
  const plan = this.plans[0]!;
  assert.equal(plan.state, "blocked");
  assert.equal(plan.action.executor, "none");
  assert.equal(plan.agentDispatch, undefined);
  assert.equal(plan.assurance.selectedWork.kind, "none");
  assert.equal(
    plan.assurance.obligations.find((item) => item.id === "O-01")?.status,
    "unknown",
  );
  assert.ok(plan.errors.length > 0);
});
When("correction handoffのreviewer代替を導出する", function () {
  const handoff = observeWorkflowHandoff(
    this.staging,
    9,
    observeWorkflowResume(this.staging),
  );
  assert.ok(handoff && "kind" in handoff && handoff.workUnit);
  const correction = {
    ...handoff,
    step: 10,
    role: "correction",
    workUnit: {
      ...handoff.workUnit,
      contract: workflowExecutionContract(10, "correction", handoff.read),
    },
  };
  this.originalId = correction.workUnit.workUnitId;
  this.alternative = workflowReviewerAlternative(correction);
  this.assurance = deriveAssuranceProjection({
    staging: this.staging,
    mode: "full",
    nextStep: 10,
    journalSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    journalValid: true,
    resume: observeWorkflowResume(this.staging),
    action: correction.workUnit.contract,
    role: correction.role,
  });
});
Then("reviewerには別workUnitIdと独立read契約だけがある", function () {
  assert.ok(this.alternative);
  assert.equal(this.alternative.role, "reviewer");
  assert.notEqual(this.alternative.workUnit.workUnitId, this.originalId);
  assert.equal(this.alternative.workUnit.contract.executor, "fresh-worker");
  assert.equal(
    this.alternative.workUnit.contract.allowedOperations[0]?.mode,
    "read",
  );
  assert.match(this.alternative.read.skill, /step-10-review/u);
  assert.equal(this.assurance?.selectedWork.kind, "semantic");
});

When("後続HEADと失敗検証記録を投影する", function () {
  const resume = observeWorkflowResume(this.staging);
  this.assurance = deriveAssuranceProjection({
    staging: this.staging,
    mode: "full",
    nextStep: 10,
    journalSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    journalValid: true,
    resume: {
      ...resume,
      implementation: { headSha: "a".repeat(40), matchesHead: false },
      verification: {
        headSha: "b".repeat(40),
        scope: "full",
        passed: false,
        recordDigest: "c".repeat(64),
        matchesImplementationHead: false,
      },
    },
    action: workflowExecutionContract(10, "reviewer", undefined, "full"),
    role: "reviewer",
  });
});
Then("失敗検証だけが失効し後続HEADは判定不能になる", function () {
  assert.ok(this.assurance);
  assert.equal(this.assurance.authority, "advisory");
  assert.equal(
    this.assurance.obligations.find((item) => item.id === "O-05")?.status,
    "unknown",
  );
  assert.equal(
    this.assurance.obligations.find((item) => item.id === "O-06")?.status,
    "invalidated",
  );
  assert.equal(this.assurance.selectedWork.kind, "independent-review");
  assert.equal(snapshot(this), this.snapshot);
});

When("要件readinessと最終reviewの責務を投影する", function () {
  this.assurance = deriveAssuranceProjection({
    staging: this.staging,
    mode: "full",
    nextStep: 3,
    journalSteps: [0, 1, 2],
    journalValid: true,
    resume: observeWorkflowResume(this.staging),
    action: workflowExecutionContract(
      3,
      "readiness-reviewer",
      undefined,
      "full",
    ),
    role: "readiness-reviewer",
  });
});
Then("readinessだけをStep3に割り当て最終reviewを混同しない", function () {
  assert.ok(this.assurance);
  assert.equal(this.assurance.selectedWork.kind, "independent-review");
  assert.deepEqual(this.assurance.selectedWork.obligationIds, ["O-R3"]);
  assert.equal(
    this.assurance.obligations.find((item) => item.id === "O-07")?.status,
    "unsatisfied",
  );
  assert.equal(snapshot(this), this.snapshot);
});

When("同じStep10で検証とreviewの有効性を変えて投影する", function () {
  const resume = observeWorkflowResume(this.staging);
  const common = {
    staging: this.staging,
    mode: "full" as const,
    nextStep: 10,
    journalSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    journalValid: true,
    resume,
    action: workflowExecutionContract(10, "reviewer", undefined, "full"),
    role: "reviewer",
  };
  const unresolved = deriveAssuranceProjection(common);
  const valid = deriveAssuranceProjection({
    ...common,
    verificationGate: { status: "satisfied", reason: "verify gate observed" },
    reviewGate: { status: "unknown", reason: "review export pending" },
  });
  const stale = deriveAssuranceProjection({
    ...common,
    verificationGate: { status: "invalidated", reason: "policy changed" },
    reviewGate: { status: "unknown", reason: "review export pending" },
  });
  this.evidenceProjections = { unresolved, valid, stale };
});
Then("有効な検証だけ選択から外しreview exportは残す", function () {
  assert.ok(this.evidenceProjections);
  const { unresolved, valid, stale } = this.evidenceProjections;
  assert.deepEqual(unresolved.selectedWork.obligationIds, [
    "O-06",
    "O-07",
    "O-09",
  ]);
  assert.deepEqual(valid.selectedWork.obligationIds, ["O-07", "O-09"]);
  assert.deepEqual(stale.selectedWork.obligationIds, ["O-06", "O-07", "O-09"]);
  assert.equal(
    stale.obligations.find((item) => item.id === "O-06")?.status,
    "invalidated",
  );
  assert.equal(
    valid.obligations.find((item) => item.id === "O-07")?.status,
    "unknown",
  );
});

Given(
  "Step10の候補role「{word}」とgate「{word}」と責務「{word}」と最新失敗「{word}」がある",
  function (role: string, gate: string, obligation: string, failed: string) {
    this.role = role;
    this.verificationGateKind = gate;
    this.verificationObligationStatus = obligation as
      "satisfied" | "unsatisfied" | "unknown" | "invalidated";
    this.latestVerificationFailed = failed === "true";
  },
);
When("Evidenceから次のWork Unitを選ぶ", function () {
  const candidate = workflowExecutionContract(10, this.role, undefined, "full");
  const plan =
    this.verificationGateKind === "none"
      ? undefined
      : {
          status: this.verificationGateKind as
            "required" | "observed" | "blocked",
          required: [{ scope: "full" as const, command: ["npm", "test"] }],
          latestFailed: this.latestVerificationFailed,
        };
  this.verificationSelected = shouldVerifyBeforeReview({
    state: "ready",
    step: 10,
    role: this.role,
    verificationObligationStatus: this.verificationObligationStatus,
    verificationPlan: plan,
  });
  this.action = this.verificationSelected
    ? workflowVerificationContract({
        headSha: "a".repeat(40),
        impactDigest: "b".repeat(64),
        required: plan!.required,
      })
    : candidate;
});
Then(
  "検証先行の選択は「{word}」で正式reviewの記録を先行しない",
  function (selected: string) {
    assert.ok(this.action);
    assert.equal(this.verificationSelected, selected === "true");
    if (this.verificationSelected) {
      assert.equal(this.action.executor, "cli");
      assert.deepEqual(
        this.action.proofObligations.map((item) => item.kind),
        ["Verification"],
      );
      assert.deepEqual(
        this.action.allowedOperations.find(
          (item) => item.operation === "run-required-verification",
        )?.argv,
        ["verify", "run", "--reuse"],
      );
      assert.equal(this.action.coordinatorCompletion, undefined);
      assert.equal(JSON.stringify(this.action).includes("--step=10"), false);
      assert.equal(
        JSON.stringify(this.action).includes("review export"),
        false,
      );
      assert.ok(
        this.action.completionConditions.some(
          (item) => item.id === "replan-before-review",
        ),
      );
    } else if (this.role === "reviewer") {
      assert.equal(this.action.executor, "fresh-worker");
    }
  },
);

Given("正式検証未実施のStep10 reviewer候補が隔離repositoryにある", function () {
  this.root = this.initRepo();
  const command = [
    process.execPath,
    "-e",
    "require('node:fs').appendFileSync('.verify-count', 'run\\n')",
  ];
  fs.writeFileSync(
    path.join(this.root, ".gitignore"),
    ".agent-skill-chain/tmp/\n.verify-count\n",
  );
  git(["add", ".gitignore"], this.root);
  git(["commit", "-qm", "ignore fixture observations"], this.root);
  const base = installTrustedVerificationPolicy(this.root, {
    fullCommand: command,
    targetedRunner: [process.execPath, "-e", "process.exit(0)"],
  });
  fs.writeFileSync(
    path.join(this.root, "implementation.txt"),
    "first implementation\n",
  );
  git(["add", "implementation.txt"], this.root);
  git(["commit", "-qm", "implementation"], this.root);
  const head = git(["rev-parse", "HEAD"], this.root).stdout.trim();
  this.staging = createIssueStaging(this.root, {
    title: "verification before review",
    requestedMode: "quick",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: true, evidence: "bounded fixture scope" },
      ]),
    ),
    now: new Date(fixtureInstant()),
  }).path;
  for (const step of [1, 4, 9]) {
    appendWorkflowJournalEntry({
      staging: this.staging,
      entry: {
        step,
        skillId: WORKFLOW_STEPS.find((item) => item.step === step)!.skillId,
        mode: "quick",
        recordedAt: fixtureInstant(),
        artifacts: [`artifact-${step}`],
        evidence: `fixture step ${step} evidence`,
        ...(step === 9 ? { implementationHeadSha: head } : {}),
      },
    });
  }
  const draft = buildReviewRoundDraft({
    staging: this.staging,
    headSha: head,
    baseSha: base,
    scopeIds: ["fixture"],
    acceptanceCriteriaIds: ["AC-fixture"],
    invariantIds: [],
  });
  recordReviewRound({
    staging: this.staging,
    round: { ...draft.round, findings: [] },
  });
  fs.appendFileSync(
    path.join(this.root, "implementation.txt"),
    "additional implementation\n",
  );
  git(["add", "implementation.txt"], this.root);
  git(["commit", "-qm", "additional implementation needs review"], this.root);
  this.snapshot = fs.readFileSync(
    path.join(this.staging, STEP_JOURNAL_FILE),
    "utf8",
  );
  this.plans = [];
});

When("収束reviewの実装HEADへ戻して検証と再planを実行する", async function () {
  git(["reset", "--hard", "HEAD~1"], this.root);
  const before = observeWorkflowExecutionPlan(this.staging);
  assert.equal(before.step, 10);
  assert.equal(before.action.executor, "cli");
  assert.deepEqual(before.assurance.selectedWork.obligationIds, ["O-06"]);
  assert.equal(before.agentDispatch, undefined);
  const run = before.action.allowedOperations.find(
    (item) => item.operation === "run-required-verification",
  );
  assert.ok(run);
  const output = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    const status = await main([
      ...run.argv,
      `--staging=${this.staging}`,
      `--scope=${run.inputBindings!.scope}`,
      "--",
      ...(JSON.parse(run.requiredTrailingArgv!) as string[]),
    ]);
    assert.equal(status, 0);
  } finally {
    process.stdout.write = output;
  }
  this.plans = [before, observeWorkflowExecutionPlan(this.staging)];
});
Then("検証後は独立reviewを繰り返さずcoordinatorがexportへ進む", function () {
  const after = this.plans[1]!;
  assert.equal(after.state, "ready");
  assert.equal(after.action.executor, "cli");
  assert.equal(after.agentDispatch, undefined);
  assert.ok(
    after.action.coordinatorCompletion?.operations.some(
      (item) => item.argv.join(" ") === "review export",
    ),
  );
  assert.equal(
    after.assurance.obligations.find((item) => item.id === "O-06")?.status,
    "satisfied",
  );
});

When("実CLIのplanから必要検証を実行して再planする", async function () {
  const first = await runPlan(this.staging);
  assert.equal(first.status, 0, first.text);
  const plan = JSON.parse(first.text) as ReturnType<
    typeof observeWorkflowExecutionPlan
  >;
  this.plans.push(plan);
  assert.equal(plan.step, 10);
  assert.equal(plan.action.executor, "cli");
  assert.equal(plan.agentDispatch, undefined);
  assert.equal(plan.handoff, undefined);
  assert.equal(plan.alternatives, undefined);
  assert.equal(plan.workUnitId, null);
  assert.deepEqual(plan.assurance.selectedWork.obligationIds, ["O-06"]);
  assert.equal(
    plan.assurance.obligations.find((item) => item.id === "O-06")?.status,
    "unsatisfied",
  );
  assert.equal(plan.action.coordinatorCompletion, undefined);
  const operations = plan.action.allowedOperations.filter(
    (item) => item.operation === "run-required-verification",
  );
  assert.equal(operations.length, 1);
  for (const operation of operations) {
    const output = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      const status = await main([
        ...operation.argv,
        `--staging=${this.staging}`,
        `--scope=${operation.inputBindings!.scope}`,
        "--",
        ...(JSON.parse(operation.requiredTrailingArgv!) as string[]),
      ]);
      assert.equal(status, 0);
    } finally {
      process.stdout.write = output;
    }
  }
  const after = await runPlan(this.staging);
  assert.equal(after.status, 0, after.text);
  this.plans.push(
    JSON.parse(after.text) as ReturnType<typeof observeWorkflowExecutionPlan>,
  );
  const repeated = await runPlan(this.staging);
  assert.equal(repeated.status, 0, repeated.text);
  this.plans.push(
    JSON.parse(repeated.text) as ReturnType<
      typeof observeWorkflowExecutionPlan
    >,
  );
});

Then(
  "CLIだけが検証を一度実行しStep10未記録で独立reviewerへ復帰する",
  function () {
    for (const plan of this.plans.slice(1)) {
      assert.equal(plan.step, 10);
      assert.equal(plan.action.executor, "fresh-worker");
      assert.equal(plan.handoff?.role, "reviewer");
      assert.ok(plan.agentDispatch);
      assert.equal(
        plan.assurance.obligations.find((item) => item.id === "O-06")?.status,
        "satisfied",
      );
    }
    assert.equal(
      fs.readFileSync(path.join(this.root, ".verify-count"), "utf8"),
      "run\n",
    );
    assert.equal(
      fs.readFileSync(path.join(this.staging, STEP_JOURNAL_FILE), "utf8"),
      this.snapshot,
    );
  },
);

When("Step2の参照入力と正式出力を持つ実行契約を導出する", function () {
  this.action = workflowExecutionContract(
    2,
    "requirements",
    {
      skill: ".agent-skill-chain/skills/step-02-requirements/SKILL.md",
      staging: ["00_要求定義.md"],
      optionalStaging: [],
    },
    "full",
  );
});
Then("Step2の正式artifactは01だけで00は参照入力に留まる", function () {
  assert.ok(this.action);
  assert.deepEqual(this.action.recordArtifacts, ["01_要件定義.md"]);
  assert.ok(
    this.action.requiredInputs.some((item) => item.path === "00_要求定義.md"),
  );
  assert.equal(this.action.recordArtifacts?.includes("00_要求定義.md"), false);
  assert.match(
    this.action.coordinatorCompletion?.operations[0]?.inputBindings.artifact ??
      "",
    /action\.recordArtifacts/u,
  );
});

async function runPreview(staging: string) {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await main([
      "workflow",
      "advance",
      `--staging=${staging}`,
      "--dry-run",
    ]);
    return { status, output };
  } finally {
    process.stdout.write = original;
  }
}

When("通常advanceとplanを同じ状態で観測する", async function () {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await main([
      "workflow",
      "advance",
      `--staging=${this.staging}`,
      "--dry-run",
    ]);
    assert.equal(status, 0, output);
  } finally {
    process.stdout.write = original;
  }
  this.value = JSON.parse(output) as Record<string, unknown>;
  const planned = await runPlan(this.staging);
  assert.equal(planned.status, 0, planned.text);
  this.plans = [
    JSON.parse(planned.text) as ReturnType<typeof observeWorkflowExecutionPlan>,
  ];
});
Then("どちらもCLI検証を選びreviewer dispatchを提示しない", function () {
  const preview = this.value as Record<string, unknown>;
  const plan = this.plans[0];
  assert.ok(plan);
  assert.equal(preview.handoff, undefined);
  assert.equal(preview.agentDispatch, undefined);
  assert.deepEqual(preview.action, plan.action);
  assert.equal(plan.action.executor, "cli");
  assert.equal(plan.handoff, undefined);
  assert.equal(plan.agentDispatch, undefined);
  assert.ok(
    plan.action.allowedOperations.some(
      (operation) => operation.operation === "run-required-verification",
    ),
  );
});

When("compatible文脈で通常advanceを観測する", async function () {
  const previous = process.env.ASC_EXECUTION_CONTEXT_MODE;
  process.env.ASC_EXECUTION_CONTEXT_MODE = "compatible";
  try {
    const result = await runPreview(this.staging);
    this.error = result.status;
    this.value = JSON.parse(result.output) as Record<string, unknown>;
  } finally {
    if (previous === undefined) delete process.env.ASC_EXECUTION_CONTEXT_MODE;
    else process.env.ASC_EXECUTION_CONTEXT_MODE = previous;
  }
});
Then("互換previewは成功しdispatchを持たない", function () {
  const result = this.value as Record<string, unknown>;
  assert.equal(this.error, 0);
  assert.equal(result.handoff, undefined);
  assert.equal(result.agentDispatch, undefined);
});

When("review sessionを破損させ通常advanceを観測する", async function () {
  fs.writeFileSync(path.join(this.staging, "review-session.json"), "broken");
  const result = await runPreview(this.staging);
  this.error = result.status;
  this.value = JSON.parse(result.output) as Record<string, unknown>;
});
Then("実行選択の停止と修復可能な理由を返す", function () {
  const result = this.value as Record<string, unknown>;
  assert.equal(this.error, 0);
  assert.equal(result.state, "delegated");
  assert.equal(result.executionState, "blocked");
  assert.ok(Array.isArray(result.executionErrors));
  assert.ok((result.executionErrors as string[]).length > 0);
  assert.equal(result.handoff, undefined);
  assert.equal(result.agentDispatch, undefined);
  assert.equal((result.action as { executor: string }).executor, "none");
  assert.match(String(result.next), /workflow advance --plan/u);
});

function prepareQuickRequest(
  world: ExecutionPlanWorld,
  candidate: boolean,
  sensitive = false,
): void {
  const primary = world.initRepo();
  if (candidate) {
    const base = git(["rev-parse", "HEAD"], primary).stdout.trim();
    const changedPath = sensitive ? "src/authorization.js" : "README.md";
    if (sensitive) fs.mkdirSync(path.join(primary, "src"));
    fs.writeFileSync(path.join(primary, changedPath), "# Candidate result\n");
    git(["add", changedPath], primary);
    git(["commit", "-qm", "asc: isolated candidate implementation"], primary);
    const head = git(["rev-parse", "HEAD"], primary).stdout.trim();
    git(["reset", "--hard", base], primary);
    const result = path.join(
      path.dirname(primary),
      `.asc-candidate-result-${path.basename(primary)}`,
    );
    git(["worktree", "add", "--detach", result, head], primary);
    world.root = result;
  } else {
    world.root = primary;
  }
  world.staging = createIssueStaging(world.root, {
    title: "completed-quick-request",
    requestedMode: "quick",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: true, evidence: "既存仕様と対象差分から確認済み" },
      ]),
    ),
    now: new Date(fixtureInstant()),
  }).path;
  world.plans = [observeWorkflowExecutionPlan(world.staging)];
}
Given("Step1の隔離quick stagingと未完成の00がある", function () {
  prepareQuickRequest(this, true);
});
Given("Candidate出自のないStep1の隔離quick stagingがある", function () {
  prepareQuickRequest(this, false);
});
Given("Candidateの危険差分があるStep1の隔離quick stagingがある", function () {
  prepareQuickRequest(this, true, true);
});
When("00を完成させてEvidenceから次のWork Unitを選ぶ", async function () {
  const file = path.join(this.staging, "00_要求定義.md");
  const filled = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) =>
      line.startsWith("## ")
        ? line
        : line
            .replaceAll("applicable / not-applicable", "not-applicable")
            .replace(/（[^）\n]+）/gu, "既存仕様と対象差分で確認済み")
            .replace(/<[^>\n]+>/gu, "確認済み")
            .replace(/\{[^}\n]+\}/gu, "確認済み"),
    )
    .join("\n");
  fs.writeFileSync(
    file,
    `${filled}\nScenario: SCN-FIXTURE-EXECPLAN-001 完成済みQuick要求を検証する\n  Given 正式要求がある\n  When 対象差分を確認する\n  Then 受け入れ条件を満たす\n`,
  );
  this.snapshot = snapshot(this);
  const planned = await runPlan(this.staging);
  assert.equal(planned.status, 0, planned.text);
  this.plans.push(
    JSON.parse(planned.text) as ReturnType<typeof observeWorkflowExecutionPlan>,
  );
});
Then(
  "未完成時はfresh Workerで完成後はCLIのみを示し正式記録はまだ行わない",
  function () {
    const before = this.plans[0]!;
    const after = this.plans[1]!;
    assert.equal(before.state, "ready");
    assert.equal(before.action.executor, "fresh-worker");
    assert.equal(after.state, "ready", after.errors.join("; "));
    assert.equal(after.action.executor, "cli");
    assert.equal(after.agentDispatch, undefined);
    assert.equal(after.handoff, undefined);
    assert.equal(after.workUnitId, null);
    assert.equal(
      after.action.allowedOperations[0]?.operation,
      "record-completed-request",
    );
    assert.equal(after.action.allowedOperations.length, 1);
    assert.equal(after.assurance.selectedWork.kind, "deterministic");
    assert.deepEqual(after.assurance.selectedWork.obligationIds, [
      "O-01",
      "O-02",
      "O-03",
    ]);
    for (const id of ["O-01", "O-02", "O-03"]) {
      const obligation = after.assurance.obligations.find(
        (item) => item.id === id,
      );
      assert.ok(obligation);
      assert.equal(obligation.status, "unsatisfied");
      assert.equal(obligation.requiredWork, "deterministic");
      assert.match(obligation.reasons.join("; "), /独立reviewで未確認/u);
    }
    assert.match(after.action.unconfirmed.join("; "), /独立review/u);
    const latest = JSON.parse(
      fs
        .readFileSync(path.join(this.staging, STEP_JOURNAL_FILE), "utf8")
        .trim()
        .split("\n")
        .at(-1)!,
    ) as { step: number };
    assert.equal(latest.step, 0);
    assert.equal(snapshot(this), this.snapshot);
  },
);

When("完成済み00を正式gateで1回記録する", async function () {
  const operation = this.plans[1]?.action.allowedOperations[0];
  const candidateHead = operation?.argv.find((arg) =>
    arg.startsWith("--candidate-head="),
  );
  assert.ok(candidateHead);
  const output = await runPlan(this.staging, [
    "--apply",
    "--prepare-next",
    candidateHead,
    "--artifact=00_要求定義.md",
    "--evidence=既存基準とCandidate差分から要求を確認した",
  ]);
  assert.equal(output.status, 0, output.text);
  this.value = JSON.parse(output.text) as Record<string, unknown>;
});
Then("Step1だけが記録されStep4以降の契約は維持される", function () {
  const entries = fs
    .readFileSync(path.join(this.staging, STEP_JOURNAL_FILE), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { step: number });
  assert.deepEqual(
    entries.map((entry) => entry.step),
    [0, 1],
  );
  const next = observeWorkflowExecutionPlan(this.staging);
  assert.equal(next.step, 4);
  assert.equal(next.action.executor, "cli");
  assert.equal(
    next.assurance.obligations.find((item) => item.id === "O-01")?.status,
    "unknown",
  );
  for (const id of ["O-02", "O-03"]) {
    const obligation = next.assurance.obligations.find(
      (item) => item.id === id,
    );
    assert.equal(obligation?.status, "unknown");
    assert.equal(obligation?.requiredWork, "independent-review");
  }
  assert.equal(
    next.assurance.obligations.find((item) => item.id === "O-07")?.status,
    "unsatisfied",
  );
  assert.equal(
    next.assurance.obligations.find((item) => item.id === "O-06")?.status,
    "unsatisfied",
  );
});

Then(
  "Candidate出自がなければ完成済み00でもfresh Workerを維持する",
  function () {
    const after = this.plans[1]!;
    assert.equal(after.state, "ready", after.errors.join("; "));
    assert.equal(after.action.executor, "fresh-worker");
    assert.ok(after.agentDispatch);
    assert.equal(after.assurance.selectedWork.kind, "semantic");
    assert.equal(snapshot(this), this.snapshot);
  },
);

Then("危険差分があれば完成済み00でもCLI記録へ進まない", function () {
  const after = this.plans[1]!;
  assert.equal(after.state, "ready", after.errors.join("; "));
  assert.equal(after.action.executor, "fresh-worker");
  assert.ok(after.agentDispatch);
  assert.equal(snapshot(this), this.snapshot);
});

When("plan後にCandidate HEADが変わった状態で正式記録を試す", async function () {
  const operation = this.plans[1]?.action.allowedOperations[0];
  const candidateHead = operation?.argv.find((arg) =>
    arg.startsWith("--candidate-head="),
  );
  assert.ok(candidateHead);
  fs.appendFileSync(path.join(this.root, "README.md"), "changed after plan\n");
  git(["add", "README.md"], this.root);
  git(["commit", "-qm", "candidate moved after plan"], this.root);
  this.snapshot = fs.readFileSync(
    path.join(this.staging, STEP_JOURNAL_FILE),
    "utf8",
  );
  await assert.rejects(
    runPlan(this.staging, [
      "--apply",
      candidateHead,
      "--artifact=00_要求定義.md",
      "--evidence=plan後の状態を再確認した",
    ]),
    /Candidate HEADがplan時から変更/u,
  );
});
Then("古いCandidate計画ではStep1を記録しない", function () {
  assert.equal(
    fs.readFileSync(path.join(this.staging, STEP_JOURNAL_FILE), "utf8"),
    this.snapshot,
  );
});

Given("Quick reviewの隔離fixtureがある", function () {
  this.root = this.initRepo();
  this.staging = createIssueStaging(this.root, {
    title: "quick review binding",
    requestedMode: "quick",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
    ),
    now: new Date(fixtureInstant()),
  }).path;
});
When("Quick reviewの現在HEAD拘束と失効を証明責務へ投影する", function () {
  const base = observeWorkflowResume(this.staging);
  const oldHead = "a".repeat(40);
  const currentHead = "b".repeat(40);
  const common = {
    staging: this.staging,
    mode: "quick" as const,
    nextStep: 11,
    journalSteps: [0, 1, 4, 9, 10],
    journalValid: true,
    action: { executor: "cli" as const },
    resume: {
      ...base,
      headSha: currentHead,
      implementation: { headSha: oldHead, matchesHead: false },
      review: {
        status: "converged" as const,
        latestRoundDigest: "digest",
        candidateHeadSha: currentHead,
        rounds: 2,
        matchesImplementationHead: false,
      },
    },
  };
  this.quickReviewProjections = {
    stale: deriveAssuranceProjection({
      ...common,
      resume: {
        ...common.resume,
        review: {
          ...common.resume.review,
          candidateHeadSha: oldHead,
          matchesImplementationHead: true,
        },
      },
      quickReviewBindingValid: false,
    }),
    corrected: deriveAssuranceProjection({
      ...common,
      quickReviewBindingValid: true,
    }),
    invalidated: deriveAssuranceProjection({
      ...common,
      quickReviewBindingValid: true,
      reviewGate: { status: "invalidated", reason: "review失効" },
    }),
  };
});
Then("古いreviewは未確定で修正後の正式reviewだけが責務を満たす", function () {
  assert.ok(this.quickReviewProjections);
  for (const id of ["O-01", "O-02", "O-03"]) {
    const status = (value: AssuranceProjection) =>
      value.obligations.find((item) => item.id === id)?.status;
    assert.equal(status(this.quickReviewProjections.stale), "unknown");
    assert.equal(status(this.quickReviewProjections.corrected), "satisfied");
    assert.equal(status(this.quickReviewProjections.invalidated), "unknown");
  }
});
