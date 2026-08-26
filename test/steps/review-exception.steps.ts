import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  REVIEW_EXCEPTION_SCHEMA_VERSION,
  validateReviewExceptions,
} from "../../src/domain/conformance.js";
import { fixtureInstant } from "../support/fixture-instant.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

const RECORD = ".agent-skill-chain/review-exceptions.json";

function baseException(): Record<string, unknown> {
  return {
    exceptionId: "RVX-EXAMPLE-001",
    kind: "reported-success-without-review",
    condition: "外部reviewerのcheckがpassと表示されるがreviewが実行されない",
    detection: "review commentとapprovalの実体を観測して未実行と判定する",
    approvalSource: "repository ownerの明示指示",
    approver: "repository owner",
    scope: "本repositoryのPR全般",
    coversIrreversibleDistribution: false,
    reason: "待機してもreviewが得られる保証がないため",
    approvedAt: fixtureInstant({ daysAgo: 1 }),
    expiresAt: null,
    unsatisfiedRequirement: "exact-head reviewを含む外部証拠の要件",
    record: "review artifactへ本exceptionIdと観測値を記録する",
  };
}

function check(
  exceptions: Record<string, unknown>[],
  now = fixtureInstant(),
): { valid: boolean; errors: string[]; active: string[] } {
  return validateReviewExceptions({
    document: {
      schemaVersion: REVIEW_EXCEPTION_SCHEMA_VERSION,
      exceptions,
    },
    now,
  });
}

const CHECKS: Readonly<Record<string, () => void>> = {
  "SCN-UNIT-RVX-001": () => {
    const document = JSON.parse(
      fs.readFileSync(path.resolve(RECORD), "utf8"),
    ) as unknown;
    const result = validateReviewExceptions({
      document,
      now: fixtureInstant(),
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  },
  "SCN-UNIT-RVX-002": () => {
    const entry = baseException();
    delete entry.approver;
    const result = check([entry]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("approver")));
  },
  "SCN-UNIT-RVX-003": () => {
    const result = check([{ ...baseException(), memo: "余分" }]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("未知field")));
  },
  "SCN-UNIT-RVX-004": () => {
    const result = check([
      { ...baseException(), expiresAt: fixtureInstant({ daysAgo: 1 }) },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("失効しています")));
  },
  "SCN-UNIT-RVX-005": () => {
    const result = check([{ ...baseException(), expiresAt: null }]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.active, ["RVX-EXAMPLE-001"]);
  },
  "SCN-UNIT-RVX-006": () => {
    const entry = baseException();
    delete entry.expiresAt;
    const result = check([entry]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("expiresAt")));
  },
  "SCN-UNIT-RVX-007": () => {
    const result = check([{ ...baseException(), kind: "transient-failure" }]);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.includes("例外にできません")),
      result.errors.join(" / "),
    );
  },
  "SCN-UNIT-RVX-008": () => {
    const result = check([{ ...baseException(), kind: "unknown-kind" }]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("kind")));
  },
  "SCN-UNIT-RVX-009": () => {
    const result = check([baseException(), baseException()]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("重複")));
  },
  "SCN-UNIT-RVX-010": () => {
    const result = check([baseException()], "昨日");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("現在時刻")));
    assert.deepEqual(result.active, []);
  },
  "SCN-UNIT-RVX-012": () => {
    const result = check([
      {
        ...baseException(),
        coversIrreversibleDistribution: true,
        expiresAt: null,
      },
    ]);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.includes("無期限にできません")),
      result.errors.join(" / "),
    );
  },
  "SCN-UNIT-RVX-013": () => {
    const result = check([
      {
        ...baseException(),
        coversIrreversibleDistribution: true,
        expiresAt: fixtureInstant({ daysAhead: 30 }),
      },
    ]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.active, ["RVX-EXAMPLE-001"]);
  },
  "SCN-UNIT-RVX-011": () => {
    const result = check([
      { ...baseException(), expiresAt: fixtureInstant({ daysAhead: 30 }) },
    ]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.active, ["RVX-EXAMPLE-001"]);
  },
};

Given("review例外検査の準備がある", function () {
  this.value = undefined;
});

When("{string}のreview例外検査を実行する", function (scenario: string) {
  const check = CHECKS[scenario];
  if (!check) return;
  check();
  this.validationOutcome = { valid: true };
});

Then("review例外検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
