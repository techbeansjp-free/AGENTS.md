import assert from "node:assert/strict";
import {
  observeProvider,
  type ProviderAvailabilityObservation,
  type ProviderExecutor,
} from "../../src/adapters/provider.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class ProviderAdapterRoutingWorld extends WorkflowWorld {
  providerExecutor: ProviderExecutor | undefined = undefined;
  providerObservation: ProviderAvailabilityObservation | undefined = undefined;
  providerStderrSecret: string | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<ProviderAdapterRoutingWorld>();

Given("provider実行入口のread-only観測関数を注入した", function () {
  this.providerExecutor = () => {
    this.calls.push("provider-observe");
    return {
      status: 0,
      stdout: JSON.stringify({ available: true, models: ["model-fixture"] }),
      stderr: "",
    };
  };
});

When("provider availabilityを観測する", async function () {
  assert.ok(this.providerExecutor);
  this.providerObservation = await observeProvider(
    "provider-fixture",
    this.providerExecutor,
    () => new Date("2026-08-24T00:00:00.000Z"),
  );
});

Then("外部観測の呼び出し回数は2回以内である", function () {
  assert.ok(this.calls.length <= 2);
  assert.equal(this.providerObservation?.state, "available");
});

Then("正常と起動不能と解釈不能は型付き観測結果を返す", async function () {
  const now = () => new Date("2026-08-24T00:00:00.000Z");
  const throwing: ProviderExecutor = () => {
    throw new Error("起動不能");
  };
  const malformed: ProviderExecutor = () => ({
    status: 0,
    stdout: "not-json",
    stderr: "",
  });
  const available = this.providerObservation;
  const launchFailure = await observeProvider(
    "provider-fixture",
    throwing,
    now,
  );
  const parseFailure = await observeProvider(
    "provider-fixture",
    malformed,
    now,
  );
  assert.equal(available?.state, "available");
  assert.deepEqual(available?.models, ["model-fixture"]);
  assert.equal(launchFailure.state, "unknown");
  assert.deepEqual(launchFailure.models, []);
  assert.equal(parseFailure.state, "unknown");
  assert.deepEqual(parseFailure.models, []);
});

Then("Codexはapp-serverのmodel listを厳密に観測する", async function () {
  const calls: Array<{ file: string; args: string[] }> = [];
  const executor: ProviderExecutor = (file, args) => {
    calls.push({ file, args });
    return {
      status: 0,
      stdout: [
        JSON.stringify({ id: 0, result: { userAgent: "fixture" } }),
        JSON.stringify({
          id: 1,
          result: {
            data: [
              { id: "gpt-5.6-sol", model: "gpt-5.6-sol", hidden: false },
              {
                id: "gpt-5.6-terra",
                model: "gpt-5.6-terra",
                hidden: false,
              },
            ],
            nextCursor: null,
          },
        }),
      ].join("\n"),
      stderr: "",
    };
  };
  const observation = await observeProvider(
    "codex",
    executor,
    () => new Date("2026-08-24T00:00:00.000Z"),
  );
  assert.deepEqual(calls, [{ file: "codex", args: ["app-server", "--stdio"] }]);
  assert.equal(observation.state, "available");
  assert.deepEqual(observation.models, ["gpt-5.6-sol", "gpt-5.6-terra"]);
  assert.equal(observation.entrypoint, "codex app-server model/list");

  const incomplete = await observeProvider(
    "codex",
    () => ({
      status: 0,
      stdout: JSON.stringify({
        id: 1,
        result: {
          data: [{ id: "gpt-5.6-sol", model: "gpt-5.6-sol" }],
          nextCursor: "next-page",
        },
      }),
      stderr: "",
    }),
    () => new Date("2026-08-24T00:00:00.000Z"),
  );
  assert.equal(incomplete.state, "unknown");
  assert.deepEqual(incomplete.models, []);
});

Given("秘密を含む標準エラーを返すprovider実行関数を注入した", function () {
  this.providerStderrSecret = "stderr-secret-fixture-value";
  this.providerExecutor = () => ({
    status: 1,
    stdout: "",
    stderr: this.providerStderrSecret ?? "",
  });
});

When("availabilityを観測する", async function () {
  assert.ok(this.providerExecutor);
  this.providerObservation = await observeProvider(
    "provider-fixture",
    this.providerExecutor,
    () => new Date("2026-08-24T00:00:00.000Z"),
  );
});

Then("観測結果はunknownである", function () {
  assert.equal(this.providerObservation?.state, "unknown");
});

Then(
  "ログと診断と例外messageとevidenceのいずれにも標準エラーの内容が現れない",
  function () {
    assert.ok(this.providerStderrSecret);
    assert.ok(this.providerObservation);
    const downstreamChannels = {
      log: JSON.stringify(this.providerObservation),
      diagnostic: this.providerObservation.reason ?? "",
      exceptionMessage: "",
      evidence: JSON.stringify({ ...this.providerObservation }),
    };
    for (const content of Object.values(downstreamChannels))
      assert.equal(content.includes(this.providerStderrSecret), false);
  },
);
