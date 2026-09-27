import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  aggregateShardResults,
  executedLocations,
  partitionScenarios,
  resolveShardCount,
  type ShardAggregate,
  type ShardResult,
} from "../../scripts/run_cucumber_shards.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class CucumberShardsWorld extends WorkflowWorld {
  shardLocations: string[] = [];
  shardPartition: string[][] | undefined = undefined;
  shardEnvValue: string | undefined = undefined;
  shardResults: ShardResult[] = [];
  shardAggregate: ShardAggregate | undefined = undefined;
  shardListConfig = "";
  shardTemporaryRoot = "";
  shardRun:
    { status: number | null; stdout: string; stderr: string } | undefined =
    undefined;
}

const { Given, When, Then } = stepDefinitions<CucumberShardsWorld>();

function locations(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `test/features/sample.feature:${index * 3 + 4}`,
  );
}

function thrownMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail("診断で拒否されませんでした");
}

function successfulShard(index: number, assigned: string[]): ShardResult {
  return {
    index,
    assigned,
    exitCode: 0,
    signal: null,
    executed: assigned,
    elapsedSeconds: 1,
  };
}

/**
 * 1 featureのmessage記録を組み立てる。Scenario 2件（3行・6行）、Scenario Outline 1件
 * （9行、Examples行13行）、Rule配下のScenario 1件（17行）を持ち、`executedPickles`に
 * 挙げたpickleだけを開始・完了させる。`retriedPickles`は再試行される途中の完了だけを持つ。
 */
function messageRecord(
  executedPickles: string[],
  retriedPickles: string[] = [],
): string {
  const uri = "test/features/sample.feature";
  const envelopes: unknown[] = [
    {
      gherkinDocument: {
        uri,
        feature: {
          children: [
            { scenario: { id: "s1", location: { line: 3 }, examples: [] } },
            { scenario: { id: "s2", location: { line: 6 }, examples: [] } },
            {
              scenario: {
                id: "s3",
                location: { line: 9 },
                examples: [
                  { tableBody: [{ id: "r1", location: { line: 13 } }] },
                ],
              },
            },
            {
              rule: {
                children: [
                  {
                    scenario: {
                      id: "s4",
                      location: { line: 17 },
                      examples: [],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
    { pickle: { id: "p1", uri, astNodeIds: ["s1"] } },
    { pickle: { id: "p2", uri, astNodeIds: ["s2"] } },
    { pickle: { id: "p3", uri, astNodeIds: ["s3", "r1"] } },
    { pickle: { id: "p4", uri, astNodeIds: ["s4"] } },
  ];
  for (const pickle of retriedPickles)
    envelopes.push(
      { testCase: { id: `t-${pickle}`, pickleId: pickle } },
      { testCaseStarted: { id: `c-${pickle}`, testCaseId: `t-${pickle}` } },
      {
        testCaseFinished: {
          testCaseStartedId: `c-${pickle}`,
          willBeRetried: true,
        },
      },
    );
  for (const pickle of executedPickles)
    envelopes.push(
      { testCase: { id: `t-${pickle}`, pickleId: pickle } },
      { testCaseStarted: { id: `c-${pickle}`, testCaseId: `t-${pickle}` } },
      {
        testCaseFinished: {
          testCaseStartedId: `c-${pickle}`,
          willBeRetried: false,
        },
      },
    );
  return envelopes.map((envelope) => JSON.stringify(envelope)).join("\n");
}

Given("scenario位置が{int}件ある", function (count: number) {
  this.shardLocations = locations(count);
});

Given("同じscenario位置が2回現れる", function () {
  this.shardLocations = [...locations(2), locations(1)[0]];
});

When("shard数{int}で分配する", function (shardCount: number) {
  try {
    this.shardPartition = partitionScenarios(this.shardLocations, shardCount);
  } catch (error) {
    this.error = error;
  }
});

Then(
  "{int}つのshardの合併は{int}件の全集合と一致し重複が無い",
  function (shardCount: number, total: number) {
    const partition = this.shardPartition ?? [];
    assert.equal(partition.length, shardCount);
    const union = partition.flat();
    assert.equal(union.length, total);
    assert.equal(new Set(union).size, total);
    assert.deepEqual([...union].sort(), [...this.shardLocations].sort());
    for (const shard of partition) assert.ok(shard.length > 0);
  },
);

Then(
  "shardは{int}つだけ作られ各{int}件を持つ",
  function (shardCount: number, size: number) {
    const partition = this.shardPartition ?? [];
    assert.equal(partition.length, shardCount);
    for (const shard of partition) assert.equal(shard.length, size);
    assert.deepEqual(partition.flat().sort(), [...this.shardLocations].sort());
  },
);

Then("分配は重複位置を名指しする診断で拒否される", function () {
  assert.equal(this.shardPartition, undefined);
  assert.ok(this.error instanceof Error);
  assert.match(
    this.error.message,
    /scenario位置が重複しています: test\/features\/sample\.feature:4$/u,
  );
});

Then("空の全集合の分配は0件を名指しする診断で拒否される", function () {
  assert.match(
    thrownMessage(() => partitionScenarios([], 2)),
    /実行するscenarioが0件です/u,
  );
});

Given("環境変数ASC_TEST_SHARDSが{string}である", function (value: string) {
  this.shardEnvValue = value;
});

When("shard数を解決する", function () {
  try {
    this.value = resolveShardCount(this.shardEnvValue, 4, 100);
  } catch (error) {
    this.error = error;
  }
});

Then("正の整数を要求する診断で拒否される", function () {
  assert.equal(this.value, undefined);
  assert.ok(this.error instanceof Error);
  assert.match(
    this.error.message,
    /ASC_TEST_SHARDSは1以上の10進整数が必要です: "0"/u,
  );
  for (const invalid of ["", "-1", "1.5", "02", "four"])
    assert.match(
      thrownMessage(() => resolveShardCount(invalid, 4, 100)),
      /1以上の10進整数が必要です/u,
    );
  assert.equal(resolveShardCount("3", 4, 100), 3);
  assert.equal(resolveShardCount(undefined, 4, 100), 4);
  assert.equal(resolveShardCount(undefined, 4, 2), 2);
});

Given("2つのshardがともに終了値0で割当どおりのscenarioを実行した", function () {
  this.shardResults = [
    successfulShard(0, locations(2)),
    successfulShard(1, locations(3).slice(2)),
  ];
});

Given("1つのshardがSIGKILLで終了した", function () {
  this.shardResults = [
    successfulShard(0, locations(1)),
    {
      ...successfulShard(1, locations(2).slice(1)),
      exitCode: null,
      signal: "SIGKILL",
    },
  ];
});

Given("1つのshardのmessage記録が存在しない", function () {
  this.shardResults = [
    { ...successfulShard(0, locations(1)), executed: null },
    successfulShard(1, locations(2).slice(1)),
  ];
});

Given("1つのshardが終了値0で割当4件のうち3件だけを実行した", function () {
  const assigned = [
    "test/features/sample.feature:3",
    "test/features/sample.feature:6",
    "test/features/sample.feature:13",
    "test/features/sample.feature:17",
  ];
  const executed = executedLocations(messageRecord(["p1", "p3", "p4"], ["p2"]));
  assert.deepEqual(executed, [
    "test/features/sample.feature:13",
    "test/features/sample.feature:17",
    "test/features/sample.feature:3",
  ]);
  this.shardResults = [{ ...successfulShard(0, assigned), executed }];
});

When("結果を集約する", function () {
  this.shardAggregate = aggregateShardResults(this.shardResults);
});

Then("全体は成功で終了値0になる", function () {
  assert.equal(this.shardAggregate?.passed, true);
  assert.equal(
    this.shardAggregate?.lines.at(-1),
    "全体: 2 shard、割当3件、実行3件、成功",
  );
});

Then("全体は失敗で要約はそのshardとsignalを名指しする", function () {
  assert.equal(this.shardAggregate?.passed, false);
  assert.match(
    this.shardAggregate?.lines[1] ?? "",
    /^shard 2\/2: .*失敗（signal SIGKILLで終了）$/u,
  );
  assert.match(this.shardAggregate?.lines.at(-1) ?? "", /失敗$/u);
});

Then("全体は失敗で要約はそのshardの記録欠落を名指しする", function () {
  assert.equal(this.shardAggregate?.passed, false);
  assert.match(
    this.shardAggregate?.lines[0] ?? "",
    /^shard 1\/2: 割当1件 実行不明件 .*失敗（message記録を読めません）$/u,
  );
  assert.match(this.shardAggregate?.lines.at(-1) ?? "", /失敗$/u);
});

Then("全体は失敗で要約は未実行の位置を名指しする", function () {
  assert.equal(this.shardAggregate?.passed, false);
  assert.match(
    this.shardAggregate?.lines[0] ?? "",
    /^shard 1\/1: 割当4件 実行3件 .*失敗（未実行のscenario位置: test\/features\/sample\.feature:6）$/u,
  );
  const extra = aggregateShardResults([
    {
      ...successfulShard(0, ["test/features/sample.feature:3"]),
      executed: [
        "test/features/sample.feature:3",
        "test/features/sample.feature:6",
      ],
    },
  ]);
  assert.equal(extra.passed, false);
  assert.match(
    extra.lines[0] ?? "",
    /失敗（割当外のscenario位置: test\/features\/sample\.feature:6）$/u,
  );
});

Given("成功するscenario4件を持つfixture設定がある", function () {
  this.shardListConfig = "test/fixtures/cucumber-shards/list-pass.mjs";
});

Given("成功3件と失敗1件を持つfixture設定がある", function () {
  this.shardListConfig = "test/fixtures/cucumber-shards/list-mixed.mjs";
});

When("shard数{int}でshard実行scriptを実行する", function (shardCount: number) {
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/run_cucumber_shards.ts",
      `--config=${this.shardListConfig}`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ASC_TEST_SHARDS: String(shardCount) },
    },
  );
  this.shardRun = {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
  };
});

Then("終了値は0で全体の実行件数は{int}件になる", function (executed: number) {
  assert.equal(this.shardRun?.status, 0, this.shardRun?.stdout);
  assert.match(
    this.shardRun?.stdout ?? "",
    new RegExp(
      `全体: 2 shard、割当${executed}件、実行${executed}件、成功`,
      "u",
    ),
  );
});

Then("終了値は非0で要約は失敗したshardを名指しする", function () {
  assert.equal(this.shardRun?.status, 1, this.shardRun?.stdout);
  const stdout = this.shardRun?.stdout ?? "";
  assert.match(stdout, /^shard 2\/2: 割当2件 実行2件 .*失敗（終了値1）$/mu);
  assert.match(stdout, /^shard 1\/2: 割当2件 実行2件 .*成功$/mu);
  assert.match(stdout, /全体: 2 shard、割当4件、実行4件、失敗/u);
});

Given("構文errorのfeatureを含むfixture設定がある", function () {
  this.shardListConfig = "test/fixtures/cucumber-shards/list-broken.mjs";
});

Then("終了値は非0で診断は構文errorのfeatureを名指しする", function () {
  assert.equal(this.shardRun?.status, 1, this.shardRun?.stdout);
  assert.match(
    this.shardRun?.stderr ?? "",
    /featureを読み込めません: test\/fixtures\/cucumber-shards\/broken\/broken\.feature:\d+ /u,
  );
  assert.doesNotMatch(this.shardRun?.stdout ?? "", /shardで実行します/u);
});

Given(
  "1件がすぐ終わり1件が中断されるまで終わらないfixture設定がある",
  function () {
    this.shardListConfig = "test/fixtures/cucumber-shards/list-slow.mjs";
  },
);

When(
  "shard数{int}でshard実行scriptを起動し実行中にSIGTERMを送る",
  { timeout: 60_000 },
  async function (shardCount: number) {
    this.shardTemporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "asc-shard-signal-"),
    );
    this.temporaryDirectories.push(this.shardTemporaryRoot);
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/run_cucumber_shards.ts",
        `--config=${this.shardListConfig}`,
      ],
      {
        env: {
          ...process.env,
          ASC_TEST_SHARDS: String(shardCount),
          TMPDIR: this.shardTemporaryRoot,
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const closed = new Promise<number | null>((resolve) =>
      child.on("close", (code) => resolve(code)),
    );
    /** shardの子processが起動し待機stepへ入るまで待ってから送る。 */
    for (
      let attempt = 0;
      attempt < 300 && !stdout.includes("shardで実行します");
      attempt += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    child.kill("SIGTERM");
    this.shardRun = { status: await closed, stdout, stderr };
  },
);

Then(
  "終了値は非0で実行中のshardの中断だけが出力され一時directoryが残らない",
  function () {
    assert.equal(this.shardRun?.status, 1, this.shardRun?.stderr);
    const stdout = this.shardRun?.stdout ?? "";
    /** shard 1は終了済みで1回だけ出力され、実行中のshard 2だけが中断として出力される。 */
    assert.equal(stdout.split("===== shard 1/2 =====").length - 1, 1);
    assert.doesNotMatch(stdout, /shard 1（SIGTERMで中断）/u);
    assert.match(stdout, /===== shard 2（SIGTERMで中断） =====/u);
    assert.match(stdout, /SIGTERMを受けて中断しました\n$/u);
    assert.deepEqual(
      fs
        .readdirSync(this.shardTemporaryRoot)
        .filter((entry) => entry.startsWith("asc-cucumber-shards-")),
      [],
    );
  },
);
