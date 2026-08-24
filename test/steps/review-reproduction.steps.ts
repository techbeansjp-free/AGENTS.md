import assert from "node:assert/strict";
import { evaluateReview } from "../../src/domain/review.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class ReviewReproductionWorld extends WorkflowWorld {
  reviewInput: unknown = undefined;
  reviewResult: ReturnType<typeof evaluateReview> | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<ReviewReproductionWorld>();

Given("再現結果を持たないresolvedの外部レビュー指摘がある", function () {
  this.reviewInput = {
    round: 3,
    findings: [
      {
        id: "EXT-01",
        severity: "High",
        status: "resolved",
        evidence: "外部レビュー指摘",
      },
    ],
  };
});

When("外部レビュー指摘を分類する", function () {
  this.reviewResult = evaluateReview(this.reviewInput);
});

Then("指摘分類を拒否する", function () {
  assert.equal(this.reviewResult?.approved, false);
  assert.ok(
    this.reviewResult?.errors.some((error) => error.includes("再現結果")),
    this.reviewResult?.errors.join("; "),
  );
});

Then("現コードでの再現手順と再現結果を要求する", function () {
  assert.ok(
    this.reviewResult?.errors.some(
      (error) => error.includes("再現手順") && error.includes("再現結果"),
    ),
    this.reviewResult?.errors.join("; "),
  );
});
