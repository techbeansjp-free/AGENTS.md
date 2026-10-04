import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  init,
  upgrade,
  uninstall,
  doctor,
} from "../../src/domain/lifecycle.js";
import {
  AGENT_LIFECYCLE_COMMAND,
  AGENT_LIFECYCLE_EVENTS,
  MANAGED_RUNTIME,
  planLifecycleSettings,
  applyLifecycleSettings,
} from "../../src/domain/lifecycle-settings.js";
import { stepDefinitions } from "../support/world.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
const { Given, When, Then } = stepDefinitions();
Given("zero-config検証用の隔離filesystemを準備する", function () {
  this.value = false;
});
Then("zero-configの受入条件を満たす", function () {
  assert.equal(this.value, true);
});
const read = (root: string) =>
  JSON.parse(
    fs.readFileSync(path.join(root, ".claude/settings.local.json"), "utf8"),
  ) as {
    env?: Record<string, string>;
    hooks: Record<
      string,
      Array<{ hooks: Array<{ command: string; timeout: number }> }>
    >;
    permissions?: unknown;
  };

When("空projectのinstallは設定とtrusted runtimeを自動構成する", function () {
  const root = this.temp("asc-zero-fresh-");
  const cli = path.resolve("dist/bin/agent-skill-chain.js");
  const preview = spawnSync(
    process.execPath,
    [cli, "install", `--root=${root}`],
    { encoding: "utf8" },
  );
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal(fs.existsSync(path.join(root, ".claude")), false);
  const applied = spawnSync(
    process.execPath,
    [cli, "install", `--root=${root}`, "--apply"],
    { encoding: "utf8" },
  );
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const settings = read(root);
  assert.equal(settings.env, undefined);
  assert.equal(Object.keys(settings.hooks).length, 7);
  for (const event of AGENT_LIFECYCLE_EVENTS) {
    assert.equal(settings.hooks[event].length, 1);
    assert.equal(settings.hooks[event][0].hooks[0].timeout, 30);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root };
  delete env.ASC_WORKFLOW_CLI;
  delete env.ASC_EXECUTION_CONTEXT_MODE;
  const result = spawnSync(
    process.execPath,
    [path.join(root, ".claude/hooks/asc-agent-lifecycle.mjs")],
    {
      env,
      encoding: "utf8",
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "fresh-zero",
        source: "startup",
      }),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const stateDir = path.join(
    root,
    ".agent-skill-chain/runtime/agent-lifecycle",
  );
  const state = fs.readdirSync(stateDir).find((name) => name.endsWith(".json"));
  assert.ok(state);
  assert.equal(
    (
      JSON.parse(fs.readFileSync(path.join(stateDir, state), "utf8")) as {
        executionContextMode: string;
      }
    ).executionContextMode,
    "short-lived",
  );
  const localCli = path.join(
    root,
    MANAGED_RUNTIME,
    "dist/bin/agent-skill-chain.js",
  );
  const version = spawnSync(process.execPath, [localCli, "--version"], {
    encoding: "utf8",
  });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(doctor(root).hooks.agentLifecycle.healthy, true);
  this.value = true;
  assert.equal(doctor(root).hooks.agentLifecycle.runtimeVerified, false);
  this.value = true;
});

When("旧lifecycle設定のupdateとdeleteは利用者設定を保持する", function () {
  const root = this.temp("asc-zero-migrate-");
  init(root, { apply: true });
  const userHook = {
    matcher: "Write",
    hooks: [{ type: "command", command: "echo user", timeout: 9 }],
  };
  const permissions = { allow: ["Read(*)"] };
  const legacy = {
    permissions,
    env: {
      KEEP: "yes",
      ASC_EXECUTION_CONTEXT_MODE: "short-lived",
      ASC_WORKFLOW_CLI:
        "/Users/example/.local/lib/agent-skill-chain/v0.4.23/dist/bin/agent-skill-chain.js",
    },
    hooks: {
      PreToolUse: [
        userHook,
        {
          matcher: "Agent",
          hooks: [
            { type: "command", command: AGENT_LIFECYCLE_COMMAND, timeout: 15 },
            { type: "command", command: AGENT_LIFECYCLE_COMMAND, timeout: 15 },
          ],
        },
      ],
    },
  };
  const file = path.join(root, ".claude/settings.local.json");
  fs.writeFileSync(file, JSON.stringify(legacy));
  const before = fs.readFileSync(file, "utf8");
  upgrade(root, { apply: false });
  assert.equal(fs.readFileSync(file, "utf8"), before);
  upgrade(root, { apply: true });
  const updated = read(root);
  assert.deepEqual(updated.env, { KEEP: "yes" });
  assert.deepEqual(updated.permissions, permissions);
  assert.deepEqual(updated.hooks.PreToolUse[0], userHook);
  for (const event of AGENT_LIFECYCLE_EVENTS)
    assert.equal(
      updated.hooks[event]
        .flatMap((entry) => entry.hooks)
        .filter((hook) => hook.command === AGENT_LIFECYCLE_COMMAND).length,
      1,
    );
  const canonical = fs.readFileSync(file, "utf8");
  upgrade(root, { apply: true });
  assert.equal(fs.readFileSync(file, "utf8"), canonical);
  updated.env = {
    KEEP: "yes",
    ASC_EXECUTION_CONTEXT_MODE: "compatible",
    ASC_WORKFLOW_CLI: "/custom/emergency.js",
  };
  fs.writeFileSync(file, JSON.stringify(updated));
  upgrade(root, { apply: true });
  assert.deepEqual(read(root).env, updated.env);
  uninstall(root, { apply: true });
  this.value = true;
  assert.deepEqual(read(root), {
    permissions,
    env: updated.env,
    hooks: { PreToolUse: [userHook] },
  });
});

When("shared設定の公開失敗と競合は利用者のbytesを保持する", function () {
  const root = this.temp("asc-zero-failure-");
  fs.mkdirSync(path.join(root, ".claude"));
  const file = path.join(root, ".claude/settings.local.json");
  const before = '{"permissions":{"allow":["Read(*)"]}}\n';
  fs.writeFileSync(file, before);
  const plan = planLifecycleSettings(root, "install");
  const original = fs.fsyncSync;
  try {
    fs.fsyncSync = () => {
      throw new Error("injected fsync failure");
    };
    assert.throws(() => applyLifecycleSettings(plan), /injected/u);
  } finally {
    fs.fsyncSync = original;
  }
  assert.equal(fs.readFileSync(file, "utf8"), before);
  let changed = false;
  const peer = '{"permissions":{"allow":["Grep(*)"]}}\n';
  try {
    fs.fsyncSync = (fd) => {
      if (!changed) {
        changed = true;
        fs.writeFileSync(file, peer);
      }
      original(fd);
    };
    assert.throws(() => applyLifecycleSettings(plan), /並行変更/u);
  } finally {
    fs.fsyncSync = original;
  }
  assert.equal(fs.readFileSync(file, "utf8"), peer);
  applyLifecycleSettings(planLifecycleSettings(root, "install"));
  assert.deepEqual(read(root).permissions, { allow: ["Grep(*)"] });
  this.value = true;
});

When("runtimeの改変と更新中はhealthyにならない", function () {
  const root = this.temp("asc-zero-runtime-");
  init(root, { apply: true });
  const cli = path.join(root, MANAGED_RUNTIME, "dist/bin/agent-skill-chain.js");
  const original = fs.readFileSync(cli);
  fs.appendFileSync(cli, "\n// modified\n");
  assert.equal(doctor(root).healthy, false);
  assert.equal(doctor(root).hooks.agentLifecycle.healthy, false);
  assert.ok(
    upgrade(root, { apply: true }).retained.includes(
      `${MANAGED_RUNTIME}/dist/bin/agent-skill-chain.js`,
    ),
  );
  fs.writeFileSync(cli, original);
  const lock = path.join(
    root,
    ".agent-skill-chain/managed-assets-mutation.lock",
  );
  fs.mkdirSync(lock);
  assert.equal(doctor(root).healthy, false);
  assert.throws(() => upgrade(root, { apply: true }), /lock|操作/u);
  fs.rmdirSync(lock);
  assert.equal(doctor(root).hooks.agentLifecycle.healthy, true);
  this.value = true;
});

When(
  "envなしのworkflow dispatchはmanaged runtimeを使い改変と更新競合を拒否する",
  function () {
    const root = this.initRepo();
    init(root, { apply: true });
    fs.writeFileSync(
      path.join(root, ".gitignore"),
      ".claude/\n.agents/\n.codex/\n.agent-skill-chain/runtime/\n.agent-skill-chain/managed*\n.agent-skill-chain/tmp/\n",
    );
    for (const args of [
      ["add", "."],
      ["commit", "-qm", "fixture install"],
    ]) {
      const git = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(git.status, 0, git.stderr);
    }
    const staging = createIssueStaging(root, {
      title: "zero-config",
      requestedMode: "full",
      now: new Date("2026-10-04T00:00:00Z"),
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
      ),
    }).path;
    const cli = path.join(
      root,
      MANAGED_RUNTIME,
      "dist/bin/agent-skill-chain.js",
    );
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.ASC_EXECUTION_CONTEXT_MODE;
    delete env.ASC_WORKFLOW_CLI;
    const preview = spawnSync(
      process.execPath,
      [cli, "workflow", "advance", `--staging=${staging}`],
      { cwd: root, env, encoding: "utf8" },
    );
    assert.equal(preview.status, 0, preview.stdout + preview.stderr);
    const { agentDispatch } = JSON.parse(preview.stdout) as {
      agentDispatch: Record<string, unknown>;
    };
    assert.ok(agentDispatch, preview.stdout);
    const hook = path.join(root, ".claude/hooks/asc-agent-lifecycle.mjs");
    const call = (event: string, extra: Record<string, unknown> = {}) => {
      const result = spawnSync(process.execPath, [hook], {
        env,
        encoding: "utf8",
        input: JSON.stringify({
          session_id: "zero-workflow",
          hook_event_name: event,
          ...extra,
        }),
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    call("SessionStart", { source: "startup" });
    const input = {
      tool_name: "Agent",
      tool_use_id: "workflow-1",
      tool_input: agentDispatch,
    };
    const original = fs.readFileSync(cli);
    fs.appendFileSync(cli, "\n// tamper\n");
    assert.match(call("PreToolUse", input), /deny/u);
    fs.writeFileSync(cli, original);
    const lock = path.join(
      root,
      ".agent-skill-chain/managed-assets-mutation.lock",
    );
    fs.mkdirSync(lock);
    assert.match(call("PreToolUse", input), /deny/u);
    assert.equal(fs.existsSync(lock), true);
    fs.rmdirSync(lock);
    const imported = path.join(root, MANAGED_RUNTIME, "dist/src/cli.js");
    const originalImport = fs.readFileSync(imported);
    fs.appendFileSync(imported, "\n// retained unowned import\n");
    fs.rmSync(path.join(root, ".agent-skill-chain/managed-assets.json"));
    fs.rmSync(path.join(root, ".agent-skill-chain/managed-assets-records"), {
      recursive: true,
      force: true,
    });
    const recovered = upgrade(root, { apply: true, recoverRecord: true });
    assert.ok(
      recovered.retained.includes(`${MANAGED_RUNTIME}/dist/src/cli.js`),
    );
    assert.match(call("PreToolUse", input), /未登録|deny/u);
    fs.writeFileSync(imported, originalImport);
    upgrade(root, { apply: true });
    const accepted = call("PreToolUse", input);
    assert.doesNotMatch(accepted, /deny/u, accepted);
    assert.equal(fs.existsSync(lock), false);
    assert.doesNotMatch(
      call("SubagentStart", {
        agent_id: "fresh-worker",
        agent_type: "general-purpose",
      }),
      /deny/u,
    );
    this.value = true;
  },
);

When("version更新は古いCLI pathなしでruntimeを更新する", function () {
  const source = this.temp("asc-zero-cache-");
  init(source, { apply: true });
  const oldPackage = path.join(source, MANAGED_RUNTIME);
  const metadata = path.join(oldPackage, "package.json");
  const parsed = JSON.parse(fs.readFileSync(metadata, "utf8")) as {
    version: string;
  };
  parsed.version = "0.4.23";
  fs.writeFileSync(metadata, JSON.stringify(parsed));
  const root = this.temp("asc-zero-version-");
  const install = spawnSync(
    process.execPath,
    [
      path.join(oldPackage, "dist/bin/agent-skill-chain.js"),
      "install",
      `--root=${root}`,
      "--apply",
    ],
    { encoding: "utf8" },
  );
  assert.equal(install.status, 0, install.stdout + install.stderr);
  fs.rmSync(source, { recursive: true, force: true });
  const localCli = path.join(
    root,
    MANAGED_RUNTIME,
    "dist/bin/agent-skill-chain.js",
  );
  const before = spawnSync(process.execPath, [localCli, "--version"], {
    encoding: "utf8",
  });
  assert.equal(before.status, 0, before.stderr);
  assert.equal(
    (
      JSON.parse(
        fs.readFileSync(
          path.join(root, MANAGED_RUNTIME, "package.json"),
          "utf8",
        ),
      ) as { version: string }
    ).version,
    "0.4.23",
  );
  upgrade(root, { apply: true });
  const after = spawnSync(process.execPath, [localCli, "--version"], {
    encoding: "utf8",
  });
  assert.equal(after.status, 0, after.stderr);
  assert.notEqual(
    (
      JSON.parse(
        fs.readFileSync(
          path.join(root, MANAGED_RUNTIME, "package.json"),
          "utf8",
        ),
      ) as { version: string }
    ).version,
    "0.4.23",
  );
  assert.equal(read(root).env, undefined);
  assert.equal(doctor(root).hooks.agentLifecycle.healthy, true);
  this.value = true;
});
