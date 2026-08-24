import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { routingDiagnostic } from "../../src/cli-contract.js";
import type { Diagnostic } from "../../src/types.js";
import { isRecord } from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

class RoutingCliWorld extends WorkflowWorld {
  diagnostic: Diagnostic | undefined = undefined;
  root = "";
  cliEnvironment: NodeJS.ProcessEnv = process.env;
  resolveResult: CommandResult | undefined = undefined;
  commandResults: CommandResult[] = [];
  unauthorizedPrune: CommandResult | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<RoutingCliWorld>();

function execute(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): CommandResult {
  const cli = path.resolve(
    process.cwd(),
    "dist",
    "bin",
    "agent-skill-chain.js",
  );
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
}

function parseOutput(result: CommandResult): unknown {
  return JSON.parse(result.stdout) as unknown;
}

Given("routing解決が拒否された", function () {
  this.value = { ruleId: "FR-836-02", reason: "providerを利用できません" };
});

When("routing診断を整形する", function () {
  this.diagnostic = routingDiagnostic("FR-836-02", "providerを利用できません");
});

Then(
  "診断はrule IDと目的とリスクと根拠と次の操作と必要authorityとrollbackを持つ",
  function () {
    const diagnostic = this.diagnostic;
    assert.ok(diagnostic);
    assert.deepEqual(
      [
        diagnostic.ruleId,
        diagnostic.purpose,
        diagnostic.risk,
        diagnostic.reasons,
        diagnostic.next,
        diagnostic.requiredAuthority,
        diagnostic.rollback,
      ].map((value) =>
        Array.isArray(value) ? value.length > 0 : value !== "",
      ),
      [true, true, true, true, true, true, true],
    );
  },
);

Then("routing診断の必須項目はいずれも空でない", function () {
  assert.ok(this.diagnostic?.reasons.every((reason) => reason.trim() !== ""));
});

Given(
  "routing CLI用の隔離projectと利用不能なprovider実行入口がある",
  function () {
    this.root = this.temp("asc-routing-cli-");
    fs.cpSync(
      path.resolve(".agent-skill-chain", "project"),
      path.join(this.root, ".agent-skill-chain", "project"),
      { recursive: true },
    );
    fs.copyFileSync(
      path.resolve(".agent-skill-chain", "project-policy.json"),
      path.join(this.root, ".agent-skill-chain", "project-policy.json"),
    );
    const emptyPath = this.temp("asc-routing-path-");
    this.cliEnvironment = { ...process.env, PATH: emptyPath };
  },
);

When("product実装taskの担当をrouting CLIから解決する", function () {
  this.resolveResult = execute(
    [
      "routing",
      "resolve",
      `--root=${this.root}`,
      "--scope=T07-cli",
      "--coordinator=claude-coordinator",
      "--implementer=codex-implementer",
      "--reviewer=independent-reviewer",
      "--evaluator-ref=trusted-evaluator-ref",
    ],
    this.root,
    this.cliEnvironment,
  );
});

Then("routing resolveは非0で実装を開始しない", function () {
  assert.notEqual(this.resolveResult?.status, 0);
  assert.doesNotMatch(
    this.resolveResult?.stdout ?? "",
    /"state":\s*"resolved"/u,
  );
});

Then(
  "利用不能の根拠と確認済み入口と安全なfallback候補と必要authorityと停止点と再開条件を返す",
  function () {
    const text = this.resolveResult?.stdout ?? "";
    for (const expected of [
      "provider実行入口",
      "checkedEntrypoint",
      "safeFallback",
      "requiredAuthority",
      "stopPoint",
      "resumeCondition",
    ])
      assert.match(text, new RegExp(expected, "u"));
  },
);

Then("安全なfallback候補は存在しないと明示する", function () {
  assert.match(this.resolveResult?.stdout ?? "", /候補なし/u);
});

When("routingの7サブコマンドを隔離projectで実行する", function () {
  const common = [`--root=${this.root}`];
  const evidenceArgs = [
    ...common,
    "--apply",
    `--base-sha=${"a".repeat(40)}`,
    "--issue=836",
    "--scope=T07-cli",
    "--role=implementer",
    "--provider=codex",
    "--model=model-fixture",
    "--mapping-version=fixture-v1",
    "--reasoning-effort=high",
    "--service-tier=default",
    "--identity=codex-implementer",
    "--evaluator-ref=trusted-evaluator-ref",
  ];
  const issueResult = execute(
    ["routing", "evidence", "issue", ...evidenceArgs],
    this.root,
    this.cliEnvironment,
  );
  const issueOutput = parseOutput(issueResult);
  assert.ok(isRecord(issueOutput));
  assert.equal(typeof issueOutput.id, "string", issueResult.stdout);
  const evidenceId = issueOutput.id as string;
  this.commandResults = [
    execute(
      ["routing", "observe", "--provider=codex"],
      this.root,
      this.cliEnvironment,
    ),
    this.resolveResult!,
    execute(
      [
        "routing",
        "independence",
        "--implementer=codex-implementer",
        "--reviewer=independent-reviewer",
        "--trusted-ref=trusted-ref",
        `--candidate-head=${"b".repeat(40)}`,
        "--evaluator-ref=trusted-ref",
      ],
      this.root,
      this.cliEnvironment,
    ),
    issueResult,
    execute(
      [
        "routing",
        "evidence",
        "complete",
        ...common,
        "--apply",
        `--evidence-id=${evidenceId}`,
        `--implementation-head=${"b".repeat(40)}`,
        "--end-state=completed",
      ],
      this.root,
      this.cliEnvironment,
    ),
    execute(
      [
        "routing",
        "evidence",
        "state",
        ...common,
        "--apply",
        `--evidence-id=${evidenceId}`,
        "--state=invalidated",
        "--reason=fixture-invalidated",
      ],
      this.root,
      this.cliEnvironment,
    ),
    execute(
      ["routing", "evidence", "prune", ...common, "--dry-run"],
      this.root,
      this.cliEnvironment,
    ),
  ];
  this.unauthorizedPrune = execute(
    ["routing", "evidence", "prune", ...common, "--apply"],
    this.root,
    this.cliEnvironment,
  );
});

Then("7サブコマンドは定義済みの終了codeを返す", function () {
  assert.deepEqual(
    this.commandResults.map((result) => result.status),
    [1, 1, 0, 0, 0, 0, 0],
    this.commandResults
      .map((result) => result.stderr || result.stdout)
      .join("\n"),
  );
});

Then("authorizeなしのprune applyは拒否される", function () {
  assert.notEqual(this.unauthorizedPrune?.status, 0);
  assert.match(this.unauthorizedPrune?.stdout ?? "", /authorize|承認/u);
});
