import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { routingDiagnostic, routingRecovery } from "../../src/cli-contract.js";
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

function configureRoutingProject(root: string): void {
  const namespace = path.join(root, ".agent-skill-chain");
  const providers = path.join(namespace, "project", "providers");
  fs.mkdirSync(providers, { recursive: true });
  fs.copyFileSync(
    path.resolve("test", "fixtures", "routing", "capability-mapping.json"),
    path.join(providers, "capability-mapping.json"),
  );
  fs.copyFileSync(
    path.resolve(
      "test",
      "fixtures",
      "routing",
      "project-choice-configured.json",
    ),
    path.join(namespace, "project", "choices", "development.json"),
  );
  const manifestFile = path.join(namespace, "project-policy.json");
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.ok(typeof manifest === "object" && manifest !== null);
  Object.assign(manifest, {
    providerFiles: ["project/providers/capability-mapping.json"],
  });
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
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

Then("provider障害とmapping不一致は異なる再開条件を返す", function () {
  const provider = routingRecovery("FR-836-02");
  const mapping = routingRecovery("FR-836-10");
  assert.equal(provider.authority, "provider operator");
  assert.match(provider.next, /provider実行入口.*復旧/u);
  assert.equal(mapping.authority, "mapping owner");
  assert.match(mapping.next, /trusted mappingを更新/u);
  assert.notEqual(provider.resume, mapping.resume);
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
    configureRoutingProject(this.root);
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

Then("routing resolveは0でClaude fallbackを解決する", function () {
  assert.equal(this.resolveResult?.status, 0, this.resolveResult?.stderr);
  const decision = parseOutput(this.resolveResult!);
  assert.ok(isRecord(decision));
  assert.equal(decision.state, "resolved");
  assert.equal(decision.routeMode, "fallback");
  assert.equal(decision.provider, "claude");
  assert.equal(decision.modelSelection, "project_default");
});

Then("Codex利用不能の理由とClaude実装identityを返す", function () {
  const text = this.resolveResult?.stdout ?? "";
  assert.match(text, /preferred_implementer_unavailable/u);
  assert.match(text, /claude-coordinator/u);
  assert.match(text, /"implementer"/u);
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
    "--route-mode=fallback",
    "--provider=claude",
    "--model=project_default",
    "--model-selection=project_default",
    "--routing-reason=preferred_implementer_unavailable",
    "--mapping-version=fixture-v1",
    "--reasoning-effort=high",
    "--service-tier=default",
    "--identity=claude-coordinator",
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
    [1, 0, 0, 0, 0, 0, 0],
    this.commandResults
      .map((result) => result.stderr || result.stdout)
      .join("\n"),
  );
});

Then("authorizeなしのprune applyは拒否される", function () {
  assert.notEqual(this.unauthorizedPrune?.status, 0);
  assert.match(this.unauthorizedPrune?.stdout ?? "", /authorize|承認/u);
});
