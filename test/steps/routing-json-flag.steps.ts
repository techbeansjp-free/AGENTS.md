import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { isRecord } from "../../src/types.js";

interface JsonFlagWorld extends WorkflowWorld {
  usages: Array<Record<string, unknown>>;
  argvs: Array<{ label: string; args: string[] }>;
  results: Array<{ label: string; result: SpawnSyncReturns<string> }>;
}

const { Given, When, Then } = stepDefinitions<JsonFlagWorld>();
const cli = path.resolve("dist/bin/agent-skill-chain.js");

function run(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

function reasonsOf(result: SpawnSyncReturns<string>): string[] {
  const output = JSON.parse(result.stdout) as unknown;
  const diagnostic =
    isRecord(output) &&
    isRecord(output.result) &&
    isRecord(output.result.diagnostic)
      ? output.result.diagnostic
      : undefined;
  return Array.isArray(diagnostic?.reasons)
    ? (diagnostic.reasons as string[])
    : [];
}

const OVERRIDE = {
  provider: "claude",
  selection: "fable",
  issue: 1340,
  scope: "issue-1340",
  instructedBy: "owner",
  instructedAt: "2026-09-12T00:00:00Z",
  expiresAt: "2026-09-13T00:00:00Z",
};
const ASSIGNMENTS = [
  { role: "coordinator", identity: "coord", context: "coord-context" },
  { role: "implementer", identity: "impl", context: "impl-context" },
  { role: "reviewer", identity: "rev", context: "rev-context" },
];

Given("routing rolesとrouting ceilingのusageがある", function () {
  this.usages = [
    ["routing", "roles", "--help"],
    ["routing", "ceiling", "--help"],
  ].map((args) => JSON.parse(run(args).stdout) as Record<string, unknown>);
});

When("両subcommandの--helpを表示する", function () {
  assert.equal(this.usages.length, 2);
});

Then(
  "--assignmentsと--overrideはJSON型で説明と実行例はinline JSONを示す",
  function () {
    const [roles, ceiling] = this.usages;
    const required = roles?.requiredFlags as Array<Record<string, string>>;
    const assignments = required.find((flag) =>
      flag.flag.startsWith("--assignments="),
    );
    assert.equal(assignments?.flag, "--assignments=<JSON>");
    assert.match(assignments?.description ?? "", /inline JSON/u);
    assert.match(assignments?.description ?? "", /path/u);
    assert.match(String(roles?.example), /--assignments='\[\{/u);
    const optional = ceiling?.optionalFlags as Array<Record<string, string>>;
    const override = optional.find((flag) =>
      flag.flag.startsWith("--override="),
    );
    assert.equal(override?.flag, "--override=<JSON>");
    assert.match(override?.description ?? "", /inline JSON/u);
    assert.match(override?.description ?? "", /path/u);
    assert.match(override?.description ?? "", /\{"provider"/u);
  },
);

Given("file pathをJSON flagへ渡すargvがある", function () {
  this.argvs = [
    {
      label: "roles",
      args: [
        "routing",
        "roles",
        "--scope=issue-1340",
        "--assignments=/tmp/secret-assignments.json",
      ],
    },
    {
      label: "ceiling",
      args: [
        "routing",
        "ceiling",
        "--provider=claude",
        "--selection=fable",
        "--issue=1340",
        "--scope=issue-1340",
        "--override=./secret-override.json",
      ],
    },
  ];
});

Given("先頭空白付きのinline JSONをJSON flagへ渡すargvがある", function () {
  this.argvs = [
    {
      label: "roles",
      args: [
        "routing",
        "roles",
        "--scope=issue-1340",
        `--assignments=  ${JSON.stringify(ASSIGNMENTS)}`,
      ],
    },
    {
      label: "ceiling",
      args: [
        "routing",
        "ceiling",
        "--provider=claude",
        "--selection=fable",
        "--issue=1340",
        "--scope=issue-1340",
        "--now=2026-09-12T12:00:00Z",
        `--override=  ${JSON.stringify(OVERRIDE)}`,
      ],
    },
  ];
});

When("routing rolesとrouting ceilingを実行する", function () {
  this.results = this.argvs.map(({ label, args }) => ({
    label,
    result: run(args),
  }));
});

Then(
  "両方とも終了値1でreasonsにinline JSONを渡す案内を含み値本文を含まない",
  function () {
    for (const { label, result } of this.results) {
      assert.equal(result.status, 1, `${label}: ${result.stderr}`);
      const reasons = reasonsOf(result);
      const flag = label === "roles" ? "--assignments" : "--override";
      const matching = reasons.filter(
        (reason) =>
          reason.includes(`${flag}にはinline JSONを渡します`) &&
          reason.includes("pathではありません"),
      );
      assert.equal(matching.length, 1, `${label}: ${reasons.join("; ")}`);
      assert.doesNotMatch(result.stdout, /secret-/u);
      assert.doesNotMatch(result.stdout, /offset 0/u);
    }
  },
);

Then("変更前と同じ判定を返す", function () {
  const roles = this.results.find((item) => item.label === "roles")?.result;
  assert.equal(roles?.status, 0, roles?.stdout);
  const ceiling = this.results.find((item) => item.label === "ceiling")?.result;
  // ownerのoverrideは有効期限内で拘束値が一致するので選択上限を超えても受理される
  assert.equal(ceiling?.status, 0, ceiling?.stdout);
});
