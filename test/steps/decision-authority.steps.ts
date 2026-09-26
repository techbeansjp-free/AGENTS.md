import assert from "node:assert/strict";
import {
  resolveAuthorityDecision,
  type AuthorityDecisionInput,
  type AuthorityDecisionResult,
} from "../../src/domain/decision-authority.js";
import type { DecisionAuthorityMode } from "../../src/domain/decision-types.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface DecisionAuthorityWorld extends WorkflowWorld {
  input?: AuthorityDecisionInput;
  result?: AuthorityDecisionResult;
}

const { Given, When, Then } = stepDefinitions<DecisionAuthorityWorld>();

Given(
  'authorityMode {string} とproposedValue {string} がある',
  function (this: DecisionAuthorityWorld, mode: string, proposedValue: string) {
    this.input = {
      authorityMode: mode as DecisionAuthorityMode,
      proposedValue,
    };
  },
);

Given(
  'authorityMode {string} とproposedValue {string} があり確認者が無い',
  function (this: DecisionAuthorityWorld, mode: string, proposedValue: string) {
    this.input = {
      authorityMode: mode as DecisionAuthorityMode,
      proposedValue,
    };
  },
);

Given(
  'authorityMode {string} とproposedValue {string} があり確認者 {string} がいる',
  function (
    this: DecisionAuthorityWorld,
    mode: string,
    proposedValue: string,
    confirmedBy: string,
  ) {
    this.input = {
      authorityMode: mode as DecisionAuthorityMode,
      proposedValue,
      confirmedBy,
    };
  },
);

Given(
  'authorityMode {string} とproposedValue {string} があり安全側の値は{string}で確認者は無い',
  function (
    this: DecisionAuthorityWorld,
    mode: string,
    proposedValue: string,
    safeValue: string,
  ) {
    this.input = {
      authorityMode: mode as DecisionAuthorityMode,
      proposedValue,
      oneWaySafeValue: safeValue,
    };
  },
);

Given(
  'authorityMode {string} とproposedValue {string} があり安全側の値は{string}で確認者 {string} がいる',
  function (
    this: DecisionAuthorityWorld,
    mode: string,
    proposedValue: string,
    safeValue: string,
    confirmedBy: string,
  ) {
    this.input = {
      authorityMode: mode as DecisionAuthorityMode,
      proposedValue,
      oneWaySafeValue: safeValue,
      confirmedBy,
    };
  },
);

Given(
  'authorityMode {string} とproposedValue {string} があり候補集合は{string}である',
  function (
    this: DecisionAuthorityWorld,
    mode: string,
    proposedValue: string,
    candidateSetRaw: string,
  ) {
    this.input = {
      authorityMode: mode as DecisionAuthorityMode,
      proposedValue,
      candidateSet: candidateSetRaw.split(","),
    };
  },
);

When("resolveAuthorityDecisionを実行する", function (this: DecisionAuthorityWorld) {
  if (this.input === undefined) throw new Error("inputが未設定です");
  this.result = resolveAuthorityDecision(this.input);
});

Then(
  'effectiveValueは{string}で確認不要である',
  function (this: DecisionAuthorityWorld, expected: string) {
    assert.equal(this.result?.effectiveValue, expected);
    assert.equal(this.result?.requiresConfirmation, false);
    assert.equal(this.result?.rejected, false);
  },
);

Then("effectiveValueはnullで確認が必要である", function (this: DecisionAuthorityWorld) {
  assert.equal(this.result?.effectiveValue, null);
  assert.equal(this.result?.requiresConfirmation, true);
  assert.equal(this.result?.rejected, false);
});

Then("拒否される", function (this: DecisionAuthorityWorld) {
  assert.equal(this.result?.rejected, true);
  assert.equal(this.result?.effectiveValue, null);
});
