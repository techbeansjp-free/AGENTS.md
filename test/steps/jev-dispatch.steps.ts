import assert from "node:assert/strict";
import {
  buildJevChoiceRequestBody,
  parseJevChoiceResponse,
  validateJevEgressPayload,
  type JevChoiceQuestionSpec,
  type JevDispatchOutcome,
  type JevEgressValidation,
} from "../../src/domain/jev-dispatch.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class JevDispatchWorld extends WorkflowWorld {
  question: JevChoiceQuestionSpec = {
    key: "q",
    options: ["a", "b"],
    criteria: { a: "x", b: "y" },
  };
  state: Record<string, unknown> = {};
  buildError: unknown = undefined;
  builtBody: ReturnType<typeof buildJevChoiceRequestBody> | undefined =
    undefined;
  egress: JevEgressValidation | undefined = undefined;
  responseStatus = 200;
  responseBody: unknown = {};
  responseRetryAfterMs: number | null = null;
  outcome: JevDispatchOutcome | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<JevDispatchWorld>();

Given("optionsが1件のchoice questionがある", function (this: JevDispatchWorld) {
  this.question = { key: "q", options: ["a"], criteria: { a: "x" } };
});

Given(
  "criteriaが一部欠けたchoice questionがある",
  function (this: JevDispatchWorld) {
    this.question = { key: "q", options: ["a", "b"], criteria: { a: "x" } };
  },
);

Given(
  "optionsが重複するchoice questionがある",
  function (this: JevDispatchWorld) {
    this.question = { key: "q", options: ["a", "a"], criteria: { a: "x" } };
  },
);

Given("正常なchoice questionがある", function (this: JevDispatchWorld) {
  this.question = {
    key: "q",
    options: ["a", "b"],
    criteria: { a: "x", b: "y" },
  };
});

When("choice requestを構築する", function (this: JevDispatchWorld) {
  try {
    this.builtBody = buildJevChoiceRequestBody({
      model: "jev-latest",
      question: this.question,
      state: {},
    });
  } catch (error) {
    this.buildError = error;
  }
});

Then("requestの構築でエラーが投げられる", function (this: JevDispatchWorld) {
  assert.ok(this.buildError instanceof Error);
});

Then(
  "構築されたrequestはmodel・questions・stateを含む",
  function (this: JevDispatchWorld) {
    assert.equal(this.buildError, undefined);
    assert.ok(this.builtBody);
    assert.equal(this.builtBody?.model, "jev-latest");
    assert.deepEqual(Object.keys(this.builtBody?.questions ?? {}), ["q"]);
    assert.deepEqual(this.builtBody?.state, {});
  },
);

Given("apiKeyというkeyを含むstateがある", function (this: JevDispatchWorld) {
  this.state = { nested: { apiKey: "sk-abcdef" } };
});

Given(
  "上限を超える長さの文字列を含むstateがある",
  function (this: JevDispatchWorld) {
    this.state = { note: "x".repeat(9000) };
  },
);

Given(
  "通常のcontext文字列だけを含むstateがある",
  function (this: JevDispatchWorld) {
    this.state = { context: "reviewer選定の対象" };
  },
);

When("stateをegress検証する", function (this: JevDispatchWorld) {
  this.egress = validateJevEgressPayload(this.state);
});

Then(
  "egress検証はokがfalseで理由に禁止key名が含まれる",
  function (this: JevDispatchWorld) {
    assert.equal(this.egress?.ok, false);
    assert.ok(
      this.egress?.ok === false && this.egress.reason.includes("禁止key名"),
    );
  },
);

Then(
  "egress検証はokがfalseで理由に上限が含まれる",
  function (this: JevDispatchWorld) {
    assert.equal(this.egress?.ok, false);
    assert.ok(this.egress?.ok === false && this.egress.reason.includes("上限"));
  },
);

Then("egress検証はokがtrueである", function (this: JevDispatchWorld) {
  assert.equal(this.egress?.ok, true);
});

Given("期待形状の200応答がある", function (this: JevDispatchWorld) {
  this.responseStatus = 200;
  this.responseBody = {
    model: "jev-1.13.0",
    answers: {
      q: {
        type: "choice",
        choice: "a",
        confidence: 0.9,
        probabilities: { a: 0.9, b: 0.1 },
      },
    },
    usage: { input_tokens: 10, output_tokens: 2 },
  };
});

Given("answersの形状が不正な200応答がある", function (this: JevDispatchWorld) {
  this.responseStatus = 200;
  this.responseBody = {
    model: "jev-1.13.0",
    answers: { q: { type: "choice" } },
  };
});

Given("401応答がある", function (this: JevDispatchWorld) {
  this.responseStatus = 401;
  this.responseBody = {
    detail: {
      error_type: "authentication_error",
      message: "Cannot authenticate",
    },
  };
});

Given("422応答がある", function (this: JevDispatchWorld) {
  this.responseStatus = 422;
  this.responseBody = {
    detail: [
      {
        type: "dict_type",
        loc: ["body", "questions", "q", "choice", "criteria"],
        msg: "Input should be a valid dictionary",
      },
    ],
  };
});

Given("400応答がある", function (this: JevDispatchWorld) {
  this.responseStatus = 400;
  this.responseBody = {
    detail: { error_type: "api_usage_error", message: "Unknown model" },
  };
});

Given("retryAfterMs付きの429応答がある", function (this: JevDispatchWorld) {
  this.responseStatus = 429;
  this.responseBody = {};
  this.responseRetryAfterMs = 3000;
});

Given("500応答がある", function (this: JevDispatchWorld) {
  this.responseStatus = 500;
  this.responseBody = { detail: "boom" };
});

When("応答を解析する", function (this: JevDispatchWorld) {
  this.outcome = parseJevChoiceResponse(
    this.responseStatus,
    "q",
    this.responseBody,
    this.responseRetryAfterMs,
  );
});

Then(
  "outcomeはokでchoiceとconfidenceとusageを持つ",
  function (this: JevDispatchWorld) {
    assert.equal(this.outcome?.kind, "ok");
    assert.ok(
      this.outcome?.kind === "ok" && this.outcome.answer.choice === "a",
    );
    assert.ok(
      this.outcome?.kind === "ok" && this.outcome.usage.inputTokens === 10,
    );
  },
);

Then("outcomeはschema-errorである", function (this: JevDispatchWorld) {
  assert.equal(this.outcome?.kind, "schema-error");
});

Then("outcomeはauth-errorである", function (this: JevDispatchWorld) {
  assert.equal(this.outcome?.kind, "auth-error");
});

Then(
  "outcomeはschema-errorであり理由にlocが含まれる",
  function (this: JevDispatchWorld) {
    assert.equal(this.outcome?.kind, "schema-error");
    assert.ok(
      this.outcome?.kind === "schema-error" &&
        this.outcome.detail.includes("criteria"),
    );
  },
);

Then("outcomeはusage-errorである", function (this: JevDispatchWorld) {
  assert.equal(this.outcome?.kind, "usage-error");
});

Then(
  "outcomeはrate-limitedでretryAfterMsが3000である",
  function (this: JevDispatchWorld) {
    assert.equal(this.outcome?.kind, "rate-limited");
    assert.ok(
      this.outcome?.kind === "rate-limited" &&
        this.outcome.retryAfterMs === 3000,
    );
  },
);

Then(
  "outcomeはunexpected-statusでstatusが500である",
  function (this: JevDispatchWorld) {
    assert.equal(this.outcome?.kind, "unexpected-status");
    assert.ok(
      this.outcome?.kind === "unexpected-status" && this.outcome.status === 500,
    );
  },
);
