import assert from "node:assert/strict";
import { Before } from "@cucumber/cucumber";
import {
  parseEvaluationLabelInput,
  type EvaluationLabel,
} from "../../src/domain/evaluation-label.js";
import {
  appendEvaluationLabel,
  findEvaluationLabel,
} from "../../src/adapters/evaluation-label-store.js";
import { appendDecisionJournalRecord } from "../../src/adapters/decision-journal-store.js";
import type { DecisionJournalRecord } from "../../src/domain/decision-journal.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

/**
 * **クラスfield initializerに頼らない。** `jev-http-client.steps.ts`と同じ
 * 理由で、`Before`hookが明示的に初期化する。
 */
class EvaluationLabelWorld extends WorkflowWorld {
  parseError: unknown = undefined;
  label: EvaluationLabel | undefined = undefined;
  primaryRoot = "";
  decisionRecordId = "";
  appendError: unknown = undefined;
  found: EvaluationLabel | undefined = undefined;
  pendingInput: unknown = undefined;
}

const { Given, When, Then } = stepDefinitions<EvaluationLabelWorld>();

Before<EvaluationLabelWorld>(function () {
  this.decisionRecordId = "DR-fixture-evallabel";
});

Given(
  "evidenceRefsが空のevidence-adjudicated入力がある",
  function (this: EvaluationLabelWorld) {
    this.pendingInput = {
      decisionRecordId: "DR-1",
      referenceValue: "not-minor",
      labelSource: "evidence-adjudicated",
      evidenceRefs: [],
      labeledAt: "2026-09-26T00:00:00.000Z",
    };
  },
);

Given(
  "evidenceRefsを省略したowner-adjudicated入力がある",
  function (this: EvaluationLabelWorld) {
    this.pendingInput = {
      decisionRecordId: "DR-1",
      referenceValue: "not-minor",
      labelSource: "owner-adjudicated",
      labeledAt: "2026-09-26T00:00:00.000Z",
    };
  },
);

Given(
  "未知のlabelSourceを持つ入力がある",
  function (this: EvaluationLabelWorld) {
    this.pendingInput = {
      decisionRecordId: "DR-1",
      referenceValue: "not-minor",
      labelSource: "guess",
      evidenceRefs: ["x"],
      labeledAt: "2026-09-26T00:00:00.000Z",
    };
  },
);

Given(
  "independent-reviewのlabelSourceを持つ有効な入力がある",
  function (this: EvaluationLabelWorld) {
    this.pendingInput = {
      decisionRecordId: "DR-1",
      referenceValue: "not-minor",
      labelSource: "independent-review",
      evidenceRefs: ["docs/reviews/1486_レビュー.md"],
      labeledAt: "2026-09-26T00:00:00.000Z",
    };
  },
);

When("evaluation label入力を解析する", function (this: EvaluationLabelWorld) {
  try {
    this.label = parseEvaluationLabelInput(this.pendingInput);
  } catch (error) {
    this.parseError = error;
  }
});

Then("解析でエラーが投げられる", function (this: EvaluationLabelWorld) {
  assert.ok(this.parseError instanceof Error);
});

Then(
  "解析結果のevidenceRefsは空配列である",
  function (this: EvaluationLabelWorld) {
    assert.equal(this.parseError, undefined);
    assert.deepEqual(this.label?.evidenceRefs, []);
  },
);

Then(
  "解析結果のlabelSourceはindependent-reviewである",
  function (this: EvaluationLabelWorld) {
    assert.equal(this.parseError, undefined);
    assert.equal(this.label?.labelSource, "independent-review");
  },
);

function fixtureDecisionRecord(
  decisionRecordId: string,
): DecisionJournalRecord {
  return {
    decisionRecordId,
    decisionTypeId: "DCAND-010",
    inputDigest: "fixture-digest",
    subjectRef: "fixture subject",
    candidateHeadSha: "0".repeat(40),
    executor: { kind: "provider", target: "jev" },
    providerModel: "jev-latest",
    providerVersion: "jev/v1",
    proposedValue: "not-minor",
    effectiveValue: "not-minor",
    authorityMode: "one-way-escalation",
    adjudicationReason: "fixture",
    latencyMs: 10,
    cost: 0,
    decidedAt: "2026-09-26T00:00:00.000Z",
  };
}

Given(
  "decision journalが空のprimaryRootがある",
  function (this: EvaluationLabelWorld) {
    this.primaryRoot = this.temp("asc-evallabel-empty-");
  },
);

Given(
  "decisionRecordIdが記録済みのprimaryRootがある",
  function (this: EvaluationLabelWorld) {
    this.primaryRoot = this.temp("asc-evallabel-seeded-");
    appendDecisionJournalRecord(
      this.primaryRoot,
      "fixture-staging",
      fixtureDecisionRecord(this.decisionRecordId),
    );
  },
);

When(
  "存在しないdecisionRecordIdでlabelを追記する",
  function (this: EvaluationLabelWorld) {
    try {
      appendEvaluationLabel(this.primaryRoot, "fixture-staging", {
        decisionRecordId: "DR-does-not-exist",
        referenceValue: "not-minor",
        labelSource: "owner-adjudicated",
        evidenceRefs: [],
        labeledAt: "2026-09-26T00:00:00.000Z",
      });
    } catch (error) {
      this.appendError = error;
    }
  },
);

When(
  "そのdecisionRecordIdでlabelを追記する",
  function (this: EvaluationLabelWorld) {
    const label: EvaluationLabel = {
      decisionRecordId: this.decisionRecordId,
      referenceValue: "not-minor",
      labelSource: "evidence-adjudicated",
      evidenceRefs: ["test/features/unit/evaluation-label.feature:1"],
      labeledAt: "2026-09-26T00:00:00.000Z",
    };
    appendEvaluationLabel(this.primaryRoot, "fixture-staging", label);
    this.label = label;
  },
);

When(
  "同じdecisionRecordIdでもう1件labelを追記する",
  function (this: EvaluationLabelWorld) {
    try {
      appendEvaluationLabel(this.primaryRoot, "fixture-staging", {
        decisionRecordId: this.decisionRecordId,
        referenceValue: "minor",
        labelSource: "owner-adjudicated",
        evidenceRefs: [],
        labeledAt: "2026-09-26T00:00:01.000Z",
      });
    } catch (error) {
      this.appendError = error;
    }
  },
);

Then("追記でエラーが投げられる", function (this: EvaluationLabelWorld) {
  assert.ok(this.appendError instanceof Error);
});

Then(
  "追記したlabelを同じdecisionRecordIdで検索できる",
  function (this: EvaluationLabelWorld) {
    this.found = findEvaluationLabel(
      this.primaryRoot,
      "fixture-staging",
      this.decisionRecordId,
    );
    assert.deepEqual(this.found, this.label);
  },
);
