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
import { type WorkflowWorld, stepDefinitions } from "../support/world.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
const { Given, When, Then } = stepDefinitions<WorkflowWorld>();
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
  assert.equal(
    fs.existsSync(path.join(root, ".claude/settings.local.json")),
    false,
  );
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
  assert.equal(fs.existsSync(stateDir), false);
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
      (updated.hooks[event] ?? [])
        .flatMap((entry) => entry.hooks)
        .filter((hook) => hook.command === AGENT_LIFECYCLE_COMMAND).length,
      0,
    );
  fs.writeFileSync(file, JSON.stringify({ ...updated, disableAllHooks: true }));
  upgrade(root, { apply: true });
  const disabled = doctor(root);
  assert.equal(disabled.healthy, true);
  assert.equal(
    disabled.hooks.agentLifecycle.configurationDiagnostics
      .disabledByLocalSettings,
    false,
  );
  assert.equal(
    (JSON.parse(fs.readFileSync(file, "utf8")) as { disableAllHooks: boolean })
      .disableAllHooks,
    true,
  );
  fs.writeFileSync(file, JSON.stringify(updated, null, 2) + "\n");
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
  const before = JSON.stringify({
    permissions: { allow: ["Read(*)"] },
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: AGENT_LIFECYCLE_COMMAND }] },
      ],
    },
  });
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
  const peer = JSON.stringify({
    permissions: { allow: ["Grep(*)"] },
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: AGENT_LIFECYCLE_COMMAND }] },
      ],
    },
  });
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
  "envなしのworkflow dispatchはmanaged runtimeを使いhook観測に依存しない",
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
    assert.deepEqual(JSON.parse(call("PreToolUse", input)), {});
    fs.writeFileSync(cli, original);
    const lock = path.join(
      root,
      ".agent-skill-chain/managed-assets-mutation.lock",
    );
    fs.mkdirSync(lock);
    assert.deepEqual(JSON.parse(call("PreToolUse", input)), {});
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
    assert.deepEqual(JSON.parse(call("PreToolUse", input)), {});
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
  assert.equal(
    fs.existsSync(path.join(root, ".claude/settings.local.json")),
    false,
  );
  assert.equal(doctor(root).hooks.agentLifecycle.healthy, true);
  this.value = true;
});

When("deleteのpreviewとapplyはcustomized ASC登録だけを除去する", function () {
  const root = this.temp("asc-zero-delete-");
  init(root, { apply: true });
  const file = path.join(root, ".claude/settings.local.json");
  const hook = {
    type: "command",
    command: AGENT_LIFECYCLE_COMMAND,
    timeout: 30,
  };
  const userHook = { type: "command", command: "echo user", timeout: 7 };
  const user = { permissions: { allow: ["Read(*)"] }, env: { KEEP: "yes" } };
  const settings = {
    ...user,
    hooks: {
      PreToolUse: [{ matcher: "Agent", hooks: [hook, userHook] }],
      SessionStart: [{ hooks: [{ ...hook, timeout: 15, async: false }] }],
    },
  };
  fs.writeFileSync(file, JSON.stringify(settings));
  const before = fs.readFileSync(file, "utf8");
  const cli = path.resolve("dist/bin/agent-skill-chain.js");
  const preview = spawnSync(
    process.execPath,
    [cli, "delete", `--root=${root}`],
    { encoding: "utf8" },
  );
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  const report = JSON.parse(preview.stdout) as {
    configuration: { target: string; operation: string; changed: boolean };
  };
  assert.equal(report.configuration.target, ".claude/settings.local.json");
  assert.equal(report.configuration.operation, "delete");
  assert.equal(report.configuration.changed, true);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(
    fs.existsSync(path.join(root, ".claude/hooks/asc-agent-lifecycle.mjs")),
    true,
  );
  const apply = spawnSync(
    process.execPath,
    [cli, "delete", `--root=${root}`, "--apply"],
    { encoding: "utf8" },
  );
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  assert.deepEqual(
    (JSON.parse(apply.stdout) as { configuration: unknown }).configuration,
    report.configuration,
  );
  assert.deepEqual(read(root), {
    ...user,
    hooks: { PreToolUse: [{ matcher: "Agent", hooks: [userHook] }] },
  });
  assert.equal(
    fs.existsSync(path.join(root, ".claude/hooks/asc-agent-lifecycle.mjs")),
    false,
  );
  assert.equal(planLifecycleSettings(root, "delete").report.changed, false);
  this.value = true;
});

When("updateは廃止runtimeを整理し変更済み残存fileを信頼しない", function () {
  const source = this.temp("asc-zero-obsolete-source-");
  init(source, { apply: true });
  const oldPackage = path.join(source, MANAGED_RUNTIME);
  const obsoleteKey = `${MANAGED_RUNTIME}/dist/src/obsolete.js`;
  fs.writeFileSync(
    path.join(oldPackage, "dist/src/obsolete.js"),
    "export const old = true;\n",
  );
  for (const variant of ["clean", "modified", "raced"]) {
    const modified = variant !== "clean";
    const initiallyModified = variant === "modified";
    const root = this.initRepo();
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
    const obsolete = path.join(root, obsoleteKey);
    assert.equal(
      doctor(root).hooks.agentLifecycle.healthy,
      false,
      "current packageのinventoryと異なる記録を拒否する",
    );
    if (initiallyModified)
      fs.appendFileSync(obsolete, "// user modification\n");
    let before = fs.readFileSync(obsolete, "utf8");
    const preview = upgrade(root, { apply: false });
    assert.ok(preview.obsoleteRuntime.includes(obsoleteKey));
    assert.equal(preview.removable?.includes(obsoleteKey), !initiallyModified);
    assert.equal(preview.retained.includes(obsoleteKey), initiallyModified);
    assert.equal(fs.readFileSync(obsolete, "utf8"), before);
    const originalLink = fs.linkSync;
    let raced = false;
    let applied: ReturnType<typeof upgrade>;
    try {
      if (variant === "raced") {
        // Snapshot capability probing happens after classification and before
        // removal. A peer edit here must invalidate the earlier removable set.
        fs.linkSync = (from, to) => {
          if (!raced) {
            raced = true;
            fs.appendFileSync(obsolete, "// peer edit after classification\n");
            before = fs.readFileSync(obsolete, "utf8");
          }
          originalLink(from, to);
        };
      }
      applied = upgrade(root, { apply: true });
    } finally {
      fs.linkSync = originalLink;
    }
    assert.equal(raced, variant === "raced");
    assert.equal(applied.removed?.includes(obsoleteKey), !modified);
    assert.equal(applied.retained.includes(obsoleteKey), modified);
    assert.equal(fs.existsSync(obsolete), modified);
    if (modified) assert.equal(fs.readFileSync(obsolete, "utf8"), before);
    // The immutable anchor may mention old files; the last snapshot may not.
    const record = JSON.parse(
      fs.readFileSync(
        path.join(root, ".agent-skill-chain/managed-assets.json"),
        "utf8",
      ),
    ) as { files: Record<string, string> };
    assert.ok(record.files[obsoleteKey]);
    const snapshots = fs.readdirSync(
      path.join(root, ".agent-skill-chain/managed-assets-records"),
    );
    assert.equal(snapshots.length, 1);
    const snapshot = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          ".agent-skill-chain/managed-assets-records",
          snapshots[0]!,
        ),
        "utf8",
      ),
    ) as { record: { files: Record<string, string> } };
    assert.equal(snapshot.record.files[obsoleteKey], undefined);
    assert.equal(doctor(root).hooks.agentLifecycle.healthy, !modified);
    const staging = createIssueStaging(root, {
      title: "obsolete-runtime",
      requestedMode: "full",
      now: new Date("2026-10-04T00:00:00Z"),
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
      ),
    }).path;
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.ASC_EXECUTION_CONTEXT_MODE;
    delete env.ASC_WORKFLOW_CLI;
    const execute = () =>
      spawnSync(
        process.execPath,
        [
          path.join(root, ".claude/hooks/asc-agent-lifecycle.mjs"),
          "--trusted-workflow-read",
          `--worktree=${root}`,
          `--staging=${staging}`,
        ],
        { cwd: root, env, encoding: "utf8" },
      );
    const run = execute();
    if (modified) {
      assert.notEqual(run.status, 0, run.stdout + run.stderr);
      fs.unlinkSync(obsolete);
      assert.equal(doctor(root).hooks.agentLifecycle.healthy, true);
      assert.equal(execute().status, 1);
    } else assert.equal(run.status, 1, run.stdout + run.stderr);
  }
  this.value = true;
});

When("旧CLIの移行はPOSIXとWindowsの絶対pathだけを認識する", function () {
  const root = this.temp("asc-zero-path-syntax-");
  fs.mkdirSync(path.join(root, ".claude"));
  const file = path.join(root, ".claude/settings.local.json");
  const legacy = [
    "/Users/example/agent-skill-chain/v0.4.23/dist/bin/agent-skill-chain.js",
    String.raw`C:\Users\example\agent-skill-chain\v0.4.23\dist\bin\agent-skill-chain.js`,
    "C:/Users/example/agent-skill-chain/v0.4.23/dist/bin/agent-skill-chain.js",
    String.raw`\\server\share\agent-skill-chain\v0.4.23\dist\bin\agent-skill-chain.js`,
  ];
  const custom = [
    "agent-skill-chain/v0.4.23/dist/bin/agent-skill-chain.js",
    String.raw`C:agent-skill-chain\v0.4.23\dist\bin\agent-skill-chain.js`,
    "/custom/emergency.js",
    "/Users/example/other-package/v0.4.23/dist/bin/agent-skill-chain.js",
    String.raw`/tmp/custom\agent-skill-chain\v0.4.23\dist\bin\agent-skill-chain.js`,
  ];
  for (const cli of [...legacy, ...custom]) {
    fs.writeFileSync(
      file,
      JSON.stringify({ env: { KEEP: "yes", ASC_WORKFLOW_CLI: cli } }),
    );
    applyLifecycleSettings(planLifecycleSettings(root, "install"));
    assert.equal(
      read(root).env?.ASC_WORKFLOW_CLI,
      legacy.includes(cli) ? undefined : cli,
      cli,
    );
    assert.equal(read(root).env?.KEEP, "yes");
  }
  this.value = true;
});
