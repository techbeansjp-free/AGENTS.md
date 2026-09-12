import assert from "node:assert/strict";
import {
  observeProvider,
  type ProviderAvailabilityObservation,
  type ProviderExecutor,
} from "../../src/adapters/provider.js";
import { run, runJsonlSession } from "../../src/lib/process.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

/**
 * 期待値は実装から導出せず、この file 内の literal で持つ（Issue #1341）。
 * 実装側の argv 組み立てを参照して expected を作ると、argv が壊れる変異で
 * 期待値も同じ向きへずれて検出できなくなる。
 */
const EXPECTED_ENTRYPOINT = "provider-fixture models list --json";

class ProviderObservationDiagnosticWorld extends WorkflowWorld {
  diagnosticExecutor: ProviderExecutor | undefined = undefined;
  diagnosticObservation: ProviderAvailabilityObservation | undefined =
    undefined;
  diagnosticStderrSecret: string | undefined = undefined;
  diagnosticMissingProvider: string | undefined = undefined;
  launchFailureFlags: Array<boolean | undefined> = [];
}

const { Given, When, Then } =
  stepDefinitions<ProviderObservationDiagnosticWorld>();

Given("終了値3で終了する実行入口を持つproviderがある", function () {
  this.diagnosticExecutor = () => ({ status: 3, stdout: "", stderr: "" });
});

Given("起動に失敗する実行入口を持つproviderがある", function () {
  this.diagnosticExecutor = () => {
    throw new Error("spawn ENOENT");
  };
});

Given(
  "stderrへ秘密を書いて終了値3で終了する実行入口を持つproviderがある",
  function () {
    this.diagnosticStderrSecret = "token=obsdiag-stderr-secret-fixture";
    this.diagnosticExecutor = () => ({
      status: 3,
      stdout: "",
      stderr: this.diagnosticStderrSecret ?? "",
    });
  },
);

When("失敗診断のためにproviderを観測する", async function () {
  assert.ok(this.diagnosticExecutor);
  this.diagnosticObservation = await observeProvider(
    "provider-fixture",
    this.diagnosticExecutor,
    () => new Date("2026-09-12T00:00:00.000Z"),
  );
});

Then("entrypointは{string}である", function (expected: string) {
  assert.equal(this.diagnosticObservation?.state, "unknown");
  assert.equal(this.diagnosticObservation?.entrypoint, expected);
});

Then("reasonは{string}である", function (expected: string) {
  assert.equal(this.diagnosticObservation?.state, "unknown");
  assert.equal(this.diagnosticObservation?.reason, expected);
});

Then(
  "観測結果のどのfieldにもstderrの本文が現れない",
  function (this: ProviderObservationDiagnosticWorld) {
    const secret = this.diagnosticStderrSecret;
    assert.ok(secret);
    assert.equal(this.diagnosticObservation?.state, "unknown");
    assert.equal(
      JSON.stringify(this.diagnosticObservation).includes(secret),
      false,
    );
    assert.equal(this.diagnosticObservation?.entrypoint, EXPECTED_ENTRYPOINT);
    assert.equal(
      this.diagnosticObservation?.reason,
      "provider実行入口のread-only観測が失敗しました（終了値3）",
    );
  },
);

/**
 * **実在しない実行fileはmockでは作れない。** 既定executorは`run`を通り、
 * `allowFailure: true`のとき起動失敗を終了値1へ写す。throwするmockだけを
 * 検査していると、この経路の欠陥を検出できない（Issue #1341のREV-01）。
 */
Given("実在しない実行fileを指すproviderがある", function () {
  this.diagnosticMissingProvider = "provider-that-does-not-exist-1341";
});

When("既定executorで失敗診断のためにproviderを観測する", async function () {
  assert.ok(this.diagnosticMissingProvider);
  this.diagnosticObservation = await observeProvider(
    this.diagnosticMissingProvider,
    undefined,
    () => new Date("2026-09-12T00:00:00.000Z"),
  );
});

Then("reasonに終了値が現れない", function () {
  assert.equal(this.diagnosticObservation?.state, "unknown");
  assert.equal(/終了値/u.test(this.diagnosticObservation?.reason ?? ""), false);
});

Given(
  "受け取ったargsを書き換えてから終了値3で終了する実行入口を持つproviderがある",
  function () {
    this.diagnosticExecutor = (_file, args) => {
      args.splice(0, args.length, "mutated-by-executor");
      return { status: 3, stdout: "", stderr: "" };
    };
  },
);

/**
 * **`launchFailure`は「子processが1つも起動しなかった」だけを意味する。**
 *
 * timeoutと出力上限超過では子processは起動しており、`error.code`だけを見て
 * 旗を立てると「起動できません」という誤った診断になる（Issue #1341のREV-03）。
 */
const MISSING_FILE = "provider-binary-that-does-not-exist-1341";
const SLOW_ARGS = ["-e", "setTimeout(() => {}, 5000)"];

Given(
  "実在しない実行fileと、起動してから打ち切られる実行fileがある",
  function () {
    this.launchFailureFlags = [];
  },
);

When("同期実行でそれぞれを実行する", function () {
  const missing = run(MISSING_FILE, [], process.cwd(), {
    allowFailure: true,
    timeoutMs: 5000,
  });
  const timedOut = run("node", SLOW_ARGS, process.cwd(), {
    allowFailure: true,
    timeoutMs: 50,
  });
  assert.equal(missing.status, 1);
  assert.equal(timedOut.status, 1);
  this.launchFailureFlags = [missing.launchFailure, timedOut.launchFailure];
});

When("JSONLセッションでそれぞれを実行する", async function () {
  const session = (file: string, args: string[], timeoutMs: number) =>
    runJsonlSession(file, args, process.cwd(), {
      allowFailure: true,
      input: "",
      timeoutMs,
      isComplete: () => false,
    });
  const missing = await session(MISSING_FILE, [], 5000);
  const timedOut = await session("node", SLOW_ARGS, 50);
  assert.equal(missing.status, 1);
  assert.equal(timedOut.status, 1);
  this.launchFailureFlags = [missing.launchFailure, timedOut.launchFailure];
});

Then("実在しない方だけが起動失敗として報告される", function () {
  assert.deepEqual(this.launchFailureFlags, [true, undefined]);
});
