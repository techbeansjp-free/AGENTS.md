import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import { STEP_JOURNAL_FILE } from "../../src/domain/workflow.js";
import { observeWorkflowExecutionPlan } from "../../src/adapters/workflow-execution-plan.js";
import {
  observeWorkflowHandoff,
  workflowExecutionContract,
  workflowReviewerAlternative,
  type WorkflowExecutionContract,
} from "../../src/adapters/workflow-handoff.js";
import { observeWorkflowResume } from "../../src/adapters/workflow-resume.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import { fixtureInstant } from "../support/fixture-instant.js";
import { git } from "../../src/lib/process.js";

class ExecutionPlanWorld extends WorkflowWorld {
  root = "";
  staging = "";
  snapshot = "";
  step = 0;
  role = "";
  action?: WorkflowExecutionContract;
  plans: ReturnType<typeof observeWorkflowExecutionPlan>[] = [];
  alternative?: ReturnType<typeof workflowReviewerAlternative>;
  originalId = "";
  refusal = false;
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
        ...(extras.some((option) => option.startsWith("--plan="))
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
    if (this.step === 11)
      assert.ok(
        this.action.allowedOperations[0]?.requiredFlags.includes(
          "from-summary",
        ),
      );
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
  assert.ok(plan.agentDispatch);
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
});
