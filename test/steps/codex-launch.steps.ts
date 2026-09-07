import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  launchCodex,
  type CodexLaunchInput,
} from "../../src/adapters/codex-launch.js";
import { executeCodex } from "../../src/adapters/codex-execution.js";
import {
  CODEX_ADOPTION_SELECTOR,
  validateCodexTier,
} from "../../src/domain/role.js";
import { git } from "../../src/lib/process.js";
import { isRecord } from "../../src/types.js";
import { findPackageModelSlugViolations } from "../../scripts/check_conformance.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import {
  codexFixtureScript,
  withProviderPath,
} from "../support/provider-fixture.js";

class CodexLaunchWorld extends WorkflowWorld {
  launchRoot = "";
  binaryRoot = "";
  launchInput: CodexLaunchInput | undefined;
  expectedStates: string[] = [];
  observedStates: string[] = [];
}
const { Given, When, Then } = stepDefinitions<CodexLaunchWorld>();

function catalog(
  model = "future-model-a",
  additional: unknown[] = [],
  config: unknown = {},
) {
  return (
    [
      { id: 2, result: { config } },
      {
        id: 1,
        result: {
          data: [
            {
              model,
              isDefault: true,
              supportedReasoningEfforts: [{ reasoningEffort: "high" }],
            },
            ...additional,
          ],
          nextCursor: null,
        },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n"
  );
}

function commitTrusted(root: string): void {
  git(["add", ".agent-skill-chain"], root);
  git(["commit", "-q", "-m", "trusted fixture", "--allow-empty"], root);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"], root);
  git(
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    root,
  );
}

Given("最新Codex起動用のtrusted projectと隔離実行入口がある", function () {
  this.expectedStates = [];
  this.observedStates = [];
  this.launchRoot = this.initRepo();
  const namespace = path.join(this.launchRoot, ".agent-skill-chain");
  fs.mkdirSync(namespace);
  for (const relative of ["project", "policy"])
    fs.cpSync(
      path.resolve(".agent-skill-chain", relative),
      path.join(namespace, relative),
      { recursive: true },
    );
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/project-policy.json"),
    path.join(namespace, "project-policy.json"),
  );
  commitTrusted(this.launchRoot);
  fs.writeFileSync(
    path.join(this.launchRoot, "task.txt"),
    "task with $(touch forbidden) and `touch forbidden` token=private-test-value",
  );
  this.launchInput = {
    root: this.launchRoot,
    scope: "issue-1257",
    coordinator: "a",
    implementer: "b",
    reviewer: "c",
    implementerContext: "context-b",
    reviewerContext: "context-c",
    risk: "identity",
    mode: "full",
    promptFile: "task.txt",
    sandbox: "read-only",
  };
  this.binaryRoot = this.temp("codex-launch-bin-");
  fs.writeFileSync(path.join(this.binaryRoot, "catalog.jsonl"), catalog());
  const executable = path.join(this.binaryRoot, "codex");
  fs.writeFileSync(executable, codexFixtureScript(this.binaryRoot));
  fs.chmodSync(executable, 0o755);
});

When("公式推奨をAからBへ変更して公開CLIを2回起動する", function () {
  assert.ok(this.launchInput);
  const cli = path.resolve("dist/bin/agent-skill-chain.js");
  const refused = spawnSync(
    process.execPath,
    [
      cli,
      "routing",
      "launch",
      `--root=${this.launchRoot}`,
      "--scope=issue-1257",
      "--coordinator=a",
      "--implementer=b",
      "--reviewer=c",
      "--implementer-context=context-b",
      "--reviewer-context=context-c",
      "--risk=identity",
      "--mode=full",
      "--prompt-file=task.txt",
      "--model=caller-fixed-model",
    ],
    { cwd: this.launchRoot, encoding: "utf8" },
  );
  assert.equal(refused.status, 1);
  assert.equal(fs.existsSync(path.join(this.binaryRoot, "calls.jsonl")), false);

  for (const model of ["future-model-a", "future-model-b"]) {
    fs.writeFileSync(
      path.join(this.binaryRoot, "catalog.jsonl"),
      catalog(model),
    );
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "routing",
        "launch",
        `--root=${this.launchRoot}`,
        "--scope=issue-1257",
        "--coordinator=a",
        "--implementer=b",
        "--reviewer=c",
        "--implementer-context=context-b",
        "--reviewer-context=context-c",
        "--risk=identity",
        "--mode=full",
        "--prompt-file=task.txt",
      ],
      {
        cwd: this.launchRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${this.binaryRoot}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const output: unknown = JSON.parse(result.stdout);
    assert.ok(isRecord(output));
    assert.equal(output.selectedModel, model);
    assert.equal(output.dispatchedModel, model);
    assert.equal(output.modelEvidence, "dispatch_arguments");
    assert.equal(output.adoptedTier, "critical");
    assert.equal(result.stdout.includes("private-test-value"), false);
    for (const [requested, expectedStatus] of [
      [model, 0],
      ["stale-model", 1],
    ] as const) {
      const tierResult = spawnSync(
        process.execPath,
        [
          cli,
          "routing",
          "tier",
          `--root=${this.launchRoot}`,
          "--provider=codex",
          "--risk=identity",
          "--mode=full",
          "--scope=issue-1257",
          `--model=${requested}`,
          "--selected=critical",
        ],
        {
          cwd: this.launchRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${this.binaryRoot}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      assert.equal(
        tierResult.status,
        expectedStatus,
        tierResult.stdout + tierResult.stderr,
      );
    }
  }
});

Then("固定名なしで各回の具体modelとhighと標準速度を実execへ渡す", function () {
  fs.writeFileSync(
    path.join(this.binaryRoot, "catalog.jsonl"),
    catalog("future-model-b", [], {
      model_catalog_json: "/private-catalog-location",
    }),
  );
  const diagnostic = spawnSync(
    process.execPath,
    [
      path.resolve("dist/bin/agent-skill-chain.js"),
      "routing",
      "tier",
      `--root=${this.launchRoot}`,
      "--provider=codex",
      "--risk=identity",
      "--mode=full",
      "--scope=issue-1257",
      "--model=future-model-b",
      "--selected=critical",
    ],
    {
      cwd: this.launchRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${this.binaryRoot}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
  assert.equal(diagnostic.status, 1);
  assert.match(diagnostic.stdout, /model_catalog_json指定を解除/u);
  assert.equal(diagnostic.stdout.includes("private-catalog-location"), false);

  const calls: unknown[] = fs
    .readFileSync(path.join(this.binaryRoot, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
  assert.equal(calls.length, 2);
  calls.forEach((call, index) => {
    assert.ok(isRecord(call));
    assert.ok(Array.isArray(call.args));
    assert.equal(
      call.args[call.args.indexOf("--model") + 1],
      ["future-model-a", "future-model-b"][index],
    );
    assert.ok(call.args.includes('model_reasoning_effort="high"'));
    assert.ok(call.args.includes('service_tier="default"'));
    assert.ok(call.args.includes('model_provider="openai"'));
    assert.ok(call.args.includes("--ephemeral"));
    assert.equal(call.args.includes("--ignore-user-config"), false);
    assert.equal(call.args.includes(CODEX_ADOPTION_SELECTOR), false);
    assert.equal(call.args[call.args.indexOf("--sandbox") + 1], "read-only");
  });
  assert.equal(fs.existsSync(path.join(this.launchRoot, "forbidden")), false);
});

When(
  "非推奨の新しそうな名前を選ばず一意の公式推奨だけを起動する",
  async function () {
    assert.ok(this.launchInput);
    let selected = "";
    const result = await launchCodex(this.launchInput, {
      observeExecutor: () => ({
        status: 0,
        stderr: "",
        stdout: catalog("current-official", [
          {
            model: "z-future-999",
            isDefault: false,
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          },
        ]),
      }),
      execute: async (input) => {
        selected = input.model;
        return { state: "succeeded", exitCode: 0, reason: "fixture" };
      },
    });
    this.observedStates.push(result.state);
    this.expectedStates.push("succeeded");
    assert.equal(result.state, "succeeded");
    assert.equal(selected, "current-official");
  },
);

When(
  "公式推奨不明と曖昧とhigh非対応とcustom catalogで起動しない",
  async function () {
    assert.ok(this.launchInput);
    const missing =
      JSON.stringify({ id: 1, result: { data: [], nextCursor: null } }) + "\n";
    const cases = [
      missing,
      catalog("a", [
        {
          model: "b",
          isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: "high" }],
        },
      ]),
      catalog().replaceAll('"high"', '"low"'),
      catalog("a", [], { model_catalog_json: "/custom.json" }),
      catalog().replace('"isDefault":true', '"isDefault":false'),
      catalog("a", [], { model_provider: "custom" }),
      catalog().replace(
        '"isDefault":true',
        '"hidden":"false","isDefault":true',
      ),
      catalog() + catalog(),
      "malformed\n",
    ];
    for (const stdout of cases) {
      let count = 0;
      const result = await launchCodex(this.launchInput, {
        observeExecutor: () => ({
          status: 0,
          stderr: "private-test-value",
          stdout,
        }),
        execute: async () => {
          count++;
          return { state: "succeeded", exitCode: 0, reason: "unexpected" };
        },
      });
      this.observedStates.push(result.state);
      this.expectedStates.push("rejected");
      assert.equal(result.state, "rejected");
      assert.equal(count, 0);
      assert.equal(
        JSON.stringify(result).includes("private-test-value"),
        false,
      );
    }
  },
);

When("candidate追加と旧slug台帳でtrusted採用不足を補えない", async function () {
  assert.ok(this.launchInput);
  let driftDispatches = 0;
  const drift = await launchCodex(this.launchInput, {
    observeExecutor: () => {
      commitTrusted(this.launchRoot);
      return { status: 0, stdout: catalog(), stderr: "" };
    },
    execute: async () => {
      driftDispatches++;
      return { state: "succeeded", exitCode: 0, reason: "unexpected" };
    },
  });
  assert.equal(drift.state, "rejected");
  assert.equal(driftDispatches, 0);
  const file = path.join(
    this.launchRoot,
    ".agent-skill-chain/project/choices/development.json",
  );
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(
    isRecord(value) &&
      isRecord(value.modelMapping) &&
      isRecord(value.modelMapping.tierMapping),
  );
  delete value.modelMapping.tierMapping[CODEX_ADOPTION_SELECTOR];
  value.modelMapping.tierMapping["future-model-a"] = "critical";
  fs.writeFileSync(file, JSON.stringify(value));
  commitTrusted(this.launchRoot);
  value.modelMapping.tierMapping[CODEX_ADOPTION_SELECTOR] = "critical";
  fs.writeFileSync(file, JSON.stringify(value));
  let count = 0;
  const result = await launchCodex(this.launchInput, {
    execute: async () => {
      count++;
      return { state: "succeeded", exitCode: 0, reason: "unexpected" };
    },
  });
  this.observedStates.push(result.state);
  this.expectedStates.push("rejected");
  assert.equal(result.state, "rejected");
  assert.match(result.reason, /trusted.*selector|trusted.*tierMapping/u);
  assert.equal(count, 0);
  const violations = findPackageModelSlugViolations(this.launchRoot);
  assert.equal(violations.length, 0);
  const projectFile = path.join(
    this.launchRoot,
    ".agent-skill-chain/project/providers/capability-mapping.json",
  );
  fs.writeFileSync(
    projectFile,
    JSON.stringify({ fixed: "gpt-future-fixture" }),
  );
  assert.ok(
    findPackageModelSlugViolations(this.launchRoot).some((entry) =>
      entry.path.endsWith("providers/capability-mapping.json"),
    ),
  );
  const fixtures = path.join(this.launchRoot, "test/fixtures");
  fs.mkdirSync(fixtures, { recursive: true });
  fs.writeFileSync(
    path.join(fixtures, "history.json"),
    JSON.stringify({ model: "gpt-fixture-history" }),
  );
  assert.equal(
    findPackageModelSlugViolations(this.launchRoot).some((entry) =>
      entry.path.startsWith("test/"),
    ),
    false,
  );
  assert.equal(
    validateCodexTier({
      required: "critical",
      mapping: { [CODEX_ADOPTION_SELECTOR]: "standard" },
    }).valid,
    false,
  );
});

When(
  "完了と失敗と不明と時間容量上限を区別し秘密を出力しない",
  async function () {
    await withProviderPath(this.binaryRoot, async () => {
      for (const [behavior, expected] of [
        ["complete", "succeeded"],
        ["failed", "failed"],
        ["missing", "unknown"],
        ["timeout", "unknown"],
        ["overflow", "unknown"],
      ]) {
        fs.writeFileSync(path.join(this.binaryRoot, "behavior"), behavior!);
        const result = await executeCodex(
          {
            root: this.launchRoot,
            prompt: "private-test-value",
            model: "future-model-a",
            sandbox: "read-only",
          },
          {
            timeoutMs: behavior === "timeout" ? 100 : 3000,
            maxOutputBytes: 1000,
          },
        );
        this.observedStates.push(result.state);
        this.expectedStates.push(expected!);
        assert.equal(result.state, expected, JSON.stringify(result));
        assert.equal(
          JSON.stringify(result).includes("private-test-value"),
          false,
        );
      }
    });
  },
);

When(
  "promptのshell文字列はデータとなりpathとcontext不正はdispatch前に拒否する",
  async function () {
    assert.ok(this.launchInput);
    const input = this.launchInput;
    await withProviderPath(this.binaryRoot, async () => {
      const good = await launchCodex({ ...input, sandbox: "workspace-write" });
      this.observedStates.push(good.state);
      this.expectedStates.push("succeeded");
      assert.equal(good.state, "succeeded");
      assert.equal(
        fs.existsSync(path.join(this.launchRoot, "forbidden")),
        false,
      );
    });
    fs.symlinkSync(
      path.join(this.launchRoot, "task.txt"),
      path.join(this.launchRoot, "link.txt"),
    );
    for (const promptFile of ["../task.txt", "link.txt", "task\u202e.txt"]) {
      await assert.rejects(launchCodex({ ...input, promptFile }));
    }
    const invalid = await launchCodex({
      ...input,
      reviewerContext: input.implementerContext,
    });
    this.observedStates.push(invalid.state);
    this.expectedStates.push("rejected");
    assert.equal(invalid.state, "rejected");
  },
);

Then("最新Codex起動の受け入れ条件を満たす", function () {
  assert.ok(this.observedStates.length > 0);
  assert.deepEqual(this.observedStates, this.expectedStates);
});
