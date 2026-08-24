import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  observeProvider,
  type ProviderAvailabilityObservation,
  type ProviderExecutor,
} from "../../src/adapters/provider.js";
import { run, runJsonlSession } from "../../src/lib/process.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class ProviderAdapterRoutingWorld extends WorkflowWorld {
  providerExecutor: ProviderExecutor | undefined = undefined;
  providerObservation: ProviderAvailabilityObservation | undefined = undefined;
  providerStderrSecret: string | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<ProviderAdapterRoutingWorld>();

Given("provider実行入口のread-only観測関数を注入した", function () {
  this.providerExecutor = (_file, _args, _cwd, options) => {
    this.calls.push(JSON.stringify(options));
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
  assert.equal(
    this.providerObservation?.state,
    "available",
    JSON.stringify(this.providerObservation),
  );
});

Then("全provider観測は10秒のtimeout上限を受け取る", function () {
  assert.deepEqual(this.calls, [
    JSON.stringify({ allowFailure: true, timeoutMs: 10_000 }),
  ]);
  const timedOut = run(
    process.execPath,
    ["-e", "setInterval(() => undefined, 1000)"],
    process.cwd(),
    { allowFailure: true, timeoutMs: 20 },
  );
  assert.equal(timedOut.status, 1);
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
              {
                id: "gpt-5.6-sol",
                model: "gpt-5.6-sol",
                hidden: false,
                isDefault: true,
                supportedReasoningEfforts: [
                  { reasoningEffort: "low" },
                  { reasoningEffort: "high" },
                ],
              },
              {
                id: "gpt-5.6-terra",
                model: "gpt-5.6-terra",
                hidden: false,
                isDefault: false,
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium" },
                  { reasoningEffort: "high" },
                ],
              },
            ],
            nextCursor: null,
          },
        }),
      ]
        .join("\n")
        .concat("\n"),
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
  assert.deepEqual(
    observation.modelMetadata.filter((model) => model.recommended),
    [
      {
        model: "gpt-5.6-sol",
        recommended: true,
        supportedReasoningEfforts: ["low", "high"],
      },
    ],
  );
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

Then("Codex JSONLの末尾が部分行でも確定応答で観測完了する", async function () {
  const executableDirectory = this.temp("asc-codex-jsonl-");
  const executable = path.join(executableDirectory, "codex");
  const response = JSON.stringify({
    id: 1,
    result: {
      data: [
        {
          model: "model-fixture",
          isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: "high" }],
        },
      ],
      nextCursor: null,
    },
  });
  fs.writeFileSync(
    executable,
    [
      "#!/usr/bin/env node",
      "process.stdin.resume();",
      `process.stdout.write(${JSON.stringify(`${response}\n{"partial":`)});`,
      "process.stdin.on('end', () => process.exit(0));",
      "setTimeout(() => process.exit(2), 500);",
    ].join("\n"),
  );
  fs.chmodSync(executable, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${executableDirectory}${path.delimiter}${originalPath ?? ""}`;
  try {
    const observation = await observeProvider(
      "codex",
      undefined,
      () => new Date("2026-08-24T00:00:00.000Z"),
    );
    assert.equal(observation.state, "available");
    assert.deepEqual(observation.models, ["model-fixture"]);
  } finally {
    process.env.PATH = originalPath;
  }
});

Given("秘密を含む標準エラーを返すprovider実行関数を注入した", function () {
  this.providerStderrSecret = "token=stderr-secret-fixture-value";
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
  async function () {
    assert.ok(this.providerStderrSecret);
    assert.ok(this.providerObservation);
    const exceptionMessages: string[] = [];
    try {
      run(
        process.execPath,
        [
          "-e",
          `process.stderr.write(${JSON.stringify(this.providerStderrSecret)}); process.exit(1)`,
        ],
        process.cwd(),
      );
    } catch (error) {
      exceptionMessages.push(
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      await runJsonlSession(
        process.execPath,
        [
          "-e",
          `process.stderr.write(${JSON.stringify(this.providerStderrSecret)}); process.exit(1)`,
        ],
        process.cwd(),
        { input: "", timeoutMs: 1_000, isComplete: () => false },
      );
    } catch (error) {
      exceptionMessages.push(
        error instanceof Error ? error.message : String(error),
      );
    }
    assert.equal(exceptionMessages.length, 2);
    const downstreamChannels = {
      log: JSON.stringify(this.providerObservation),
      diagnostic: this.providerObservation.reason ?? "",
      exceptionMessage: exceptionMessages.join("\n"),
      evidence: JSON.stringify({ ...this.providerObservation }),
    };
    for (const content of Object.values(downstreamChannels))
      assert.equal(content.includes(this.providerStderrSecret), false);
  },
);
