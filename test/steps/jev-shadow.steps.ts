import assert from "node:assert/strict";
import { Before } from "@cucumber/cucumber";
import {
  buildJevShadowRecord,
  isJevShadowEligible,
  planJevShadowQuestion,
  type JevShadowQuestionPlan,
  type JevShadowRecord,
} from "../../src/domain/jev-shadow.js";
import type { DecisionExecutor } from "../../src/domain/decision-types.js";
import type { JevDispatchOutcome } from "../../src/domain/jev-dispatch.js";
import {
  appendJevShadowRecord,
  findJevShadowRecord,
} from "../../src/adapters/jev-shadow-store.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

/**
 * **クラスfield initializerに頼らない。** `jev-http-client.steps.ts`と同じ
 * 理由（`setWorldConstructor(WorkflowWorld)`。このfileのWorld型は実行時に
 * インスタンス化されない）で、`Before`hookが明示的に初期化する。
 */
class JevShadowWorld extends WorkflowWorld {
  executor!: DecisionExecutor;
  eligible: boolean | undefined = undefined;
  planInput!: {
    decisionTypeId: string;
    subjectRef: string;
    candidateSet?: readonly string[];
  };
  plan: JevShadowQuestionPlan | undefined = undefined;
  outcome!: JevDispatchOutcome;
  record: JevShadowRecord | undefined = undefined;
  primaryRoot = "";
  found: JevShadowRecord | undefined = undefined;
  appendError: unknown = undefined;
}

const { Given, When, Then } = stepDefinitions<JevShadowWorld>();

Before<JevShadowWorld>(function () {
  this.executor = { kind: "deterministic", resolverId: "DCAND-001" };
  this.planInput = { decisionTypeId: "DCAND-010", subjectRef: "fixture" };
  this.outcome = {
    kind: "ok",
    resolvedModel: "jev-1.13.0",
    answer: {
      choice: "not-minor",
      confidence: 0.9,
      probabilities: { "not-minor": 0.9 },
    },
    usage: { inputTokens: 1, outputTokens: 1 },
  };
});

function baseRecordInput(world: JevShadowWorld) {
  return {
    decisionRecordId: "DR-fixture0000",
    decisionTypeId: "DCAND-010",
    candidateHeadSha: "0".repeat(40),
    primaryProposedValue: "not-minor",
    primaryAuthorityMode: "one-way-escalation" as const,
    jevModel: "jev-latest",
    outcome: world.outcome,
    latencyMs: 100,
    dispatchedAt: "2026-09-26T00:00:00.000Z",
  };
}

Given("deterministic executorがある", function (this: JevShadowWorld) {
  this.executor = { kind: "deterministic", resolverId: "DCAND-001" };
});

Given("provider executorがある", function (this: JevShadowWorld) {
  this.executor = { kind: "provider", target: "jev" };
});

When("shadow適格性を判定する", function (this: JevShadowWorld) {
  this.eligible = isJevShadowEligible(this.executor);
});

Then("shadow適格性はfalseである", function (this: JevShadowWorld) {
  assert.equal(this.eligible, false);
});

Then("shadow適格性はtrueである", function (this: JevShadowWorld) {
  assert.equal(this.eligible, true);
});

Given("DCAND-010のshadow question入力がある", function (this: JevShadowWorld) {
  this.planInput = {
    decisionTypeId: "DCAND-010",
    subjectRef: "PR#1486 finding F-01",
  };
});

Given(
  "candidateSetが1件のDCAND-009のshadow question入力がある",
  function (this: JevShadowWorld) {
    this.planInput = {
      decisionTypeId: "DCAND-009",
      subjectRef: "reviewer選定 test",
      candidateSet: ["codex"],
    };
  },
);

Given(
  "candidateSetが2件のDCAND-009のshadow question入力がある",
  function (this: JevShadowWorld) {
    this.planInput = {
      decisionTypeId: "DCAND-009",
      subjectRef: "reviewer選定 test",
      candidateSet: ["codex", "claude"],
    };
  },
);

Given("DCAND-006のshadow question入力がある", function (this: JevShadowWorld) {
  this.planInput = {
    decisionTypeId: "DCAND-006",
    subjectRef: "PR#1486 finding F-02",
  };
});

When("shadow questionを計画する", function (this: JevShadowWorld) {
  this.plan = planJevShadowQuestion(this.planInput);
});

Then(
  "questionのoptionsはminorとnot-minorである",
  function (this: JevShadowWorld) {
    assert.deepEqual(this.plan?.question.options, ["minor", "not-minor"]);
  },
);

Then("shadow question計画はundefinedである", function (this: JevShadowWorld) {
  assert.equal(this.plan, undefined);
});

Then(
  "questionのoptionsはcandidateSetと一致する",
  function (this: JevShadowWorld) {
    assert.deepEqual(this.plan?.question.options, ["codex", "claude"]);
  },
);

Given(
  "primaryProposedValueと一致するok outcomeがある",
  function (this: JevShadowWorld) {
    this.outcome = {
      kind: "ok",
      resolvedModel: "jev-1.13.0",
      answer: {
        choice: "not-minor",
        confidence: 0.9,
        probabilities: { "not-minor": 0.9, minor: 0.1 },
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
);

Given("auth-error outcomeがある", function (this: JevShadowWorld) {
  this.outcome = { kind: "auth-error", detail: "bad key" };
});

When("shadow recordを構築する", function (this: JevShadowWorld) {
  this.record = buildJevShadowRecord(baseRecordInput(this));
});

Then(
  "shadow recordのmatchesPrimaryProposedValueはtrueである",
  function (this: JevShadowWorld) {
    assert.equal(this.record?.matchesPrimaryProposedValue, true);
  },
);

Then(
  "shadow recordのjevProposedValueはnullでoutcomeKindはauth-errorである",
  function (this: JevShadowWorld) {
    assert.equal(this.record?.jevProposedValue, null);
    assert.equal(this.record?.outcomeKind, "auth-error");
  },
);

Given("空のjev-shadow journalがある", function (this: JevShadowWorld) {
  this.primaryRoot = this.temp("asc-jevshadow-");
});

When("shadow recordを1件追記する", function (this: JevShadowWorld) {
  const record = buildJevShadowRecord(baseRecordInput(this));
  appendJevShadowRecord(this.primaryRoot, "fixture-staging", record);
  this.record = record;
});

When("同じdecisionRecordIdでもう1件追記する", function (this: JevShadowWorld) {
  try {
    appendJevShadowRecord(
      this.primaryRoot,
      "fixture-staging",
      buildJevShadowRecord(baseRecordInput(this)),
    );
  } catch (error) {
    this.appendError = error;
  }
});

Then(
  "同じdecisionRecordIdでshadow recordを検索できる",
  function (this: JevShadowWorld) {
    this.found = findJevShadowRecord(
      this.primaryRoot,
      "fixture-staging",
      this.record?.decisionRecordId ?? "",
    );
    assert.deepEqual(this.found, this.record);
  },
);

Then("shadow追記でエラーが投げられる", function (this: JevShadowWorld) {
  assert.ok(this.appendError instanceof Error);
});
