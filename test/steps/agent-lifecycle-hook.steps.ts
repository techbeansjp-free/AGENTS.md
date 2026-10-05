import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  init,
  doctor,
  uninstall,
  inspectAgentLifecycleRegistration,
} from "../../src/domain/lifecycle.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class AgentLifecycleWorld extends WorkflowWorld {
  lifecycleRoot = "";
  lifecycleOutput = "";
}
const { Given, When, Then } = stepDefinitions<AgentLifecycleWorld>();
const hook = path.resolve(".agent-skill-chain/hooks/asc-agent-lifecycle.mjs");
function event(
  root: string,
  name: string,
  extra: Record<string, unknown> = {},
  budgetMode = "enforce",
) {
  return spawnSync(process.execPath, [hook], {
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      ASC_EXECUTION_CONTEXT_MODE: "compatible",
      ASC_AGENT_MAX_TOOLS: "10",
      ASC_AGENT_BUDGET_MODE: budgetMode,
    },
    input: JSON.stringify({
      session_id: "session-1",
      hook_event_name: name,
      ...extra,
    }),
    encoding: "utf8",
  });
}
function invoke(root: string, extra: Record<string, unknown> = {}) {
  const result = event(root, "PreToolUse", {
    tool_name: "Read",
    tool_input: {},
    ...extra,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
Given("lifecycle hookを登録した新規sessionがある", function () {
  this.lifecycleRoot = this.temp("asc-agent-lifecycle-");
  const result = event(this.lifecycleRoot, "SessionStart", {
    source: "startup",
  });
  assert.equal(result.status, 0, result.stderr);
});
When("lifecycleの{string}を実行する", function (operation: string) {
  const root = this.lifecycleRoot;
  const start = () => event(root, "SubagentStart", { agent_id: "agent-a" });
  const stop = () => event(root, "SubagentStop", { agent_id: "agent-a" });
  const send = (to: string) =>
    invoke(root, {
      tool_name: "SendMessage",
      tool_input: { to, message: "SECRET-PROMPT" },
    });
  switch (operation) {
    case "lock所有者書込み失敗後の再試行": {
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import fs from 'node:fs';
          const write = fs.writeFileSync;
          fs.writeFileSync = (file, ...args) => {
            if (String(file).endsWith('/worktree.lock/owner.json'))
              throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
            return write(file, ...args);
          };
          await import(${JSON.stringify(hook)});`,
        ],
        {
          env: { ...process.env, CLAUDE_PROJECT_DIR: root },
          input: JSON.stringify({
            session_id: "session-1",
            hook_event_name: "PreToolUse",
            tool_name: "Read",
          }),
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /ENOSPC/u);
      assert.match(result.stdout, /"deny"/u);
      assert.equal(
        fs.existsSync(
          path.join(
            root,
            ".agent-skill-chain/runtime/agent-lifecycle/worktree.lock",
          ),
        ),
        false,
      );
      this.lifecycleOutput = invoke(root);
      break;
    }
    case "fresh clear":
      event(root, "SessionStart", { source: "clear", session_id: "session-2" });
      this.lifecycleOutput = invoke(root, { session_id: "session-2" });
      break;
    case "同じIDのclear":
      for (let index = 0; index < 10; index += 1) invoke(root);
      event(root, "SessionStart", { source: "clear" });
      this.lifecycleOutput = invoke(root);
      break;
    case "identityのない終了event":
      event(root, "SubagentStop");
      this.lifecycleOutput = invoke(root);
      break;
    case "session再開":
      this.lifecycleOutput = event(root, "SessionStart", {
        source: "resume",
      }).stdout;
      break;
    case "完了後SendMessage":
      start();
      stop();
      this.lifecycleOutput = send("agent-a");
      break;
    case "activeへの連絡":
      start();
      this.lifecycleOutput = send("agent-a");
      break;
    case "名前での迂回":
      start();
      this.lifecycleOutput = send("implementer");
      break;
    case "legacy resume":
      this.lifecycleOutput = invoke(root, {
        tool_name: "Agent",
        tool_input: { resume: "old-agent" },
      });
      break;
    case "完了後の直接tool":
      start();
      stop();
      this.lifecycleOutput = invoke(root, { agent_id: "agent-a" });
      break;
    case "同じIDの再起動":
      start();
      stop();
      start();
      this.lifecycleOutput = invoke(root, { agent_id: "agent-a" });
      break;
    case "fresh agent":
      start();
      stop();
      event(root, "SubagentStart", { agent_id: "agent-b" });
      this.lifecycleOutput = invoke(root, { agent_id: "agent-b" });
      break;
    case "main上限とcompact":
      for (let index = 0; index < 10; index += 1) invoke(root);
      event(root, "SessionStart", { source: "compact" });
      this.lifecycleOutput = invoke(root);
      break;
    case "subagent上限":
      start();
      for (let index = 0; index < 10; index += 1)
        invoke(root, { agent_id: "agent-a" });
      this.lifecycleOutput = invoke(root, { agent_id: "agent-a" });
      break;
    case "handoff警告":
      for (let index = 0; index < 7; index += 1) invoke(root);
      this.lifecycleOutput = invoke(root);
      break;
    case "上限後の結果返却":
      start();
      for (let index = 0; index < 10; index += 1)
        invoke(root, { agent_id: "agent-a" });
      this.lifecycleOutput = invoke(root, {
        agent_id: "agent-a",
        tool_name: "SubagentHandback",
      });
      break;
    case "未登録agent":
      this.lifecycleOutput = invoke(root, { agent_id: "missing" });
      break;
    case "終了session再開":
      event(root, "SessionEnd");
      event(root, "SessionStart", { source: "resume" });
      this.lifecycleOutput = invoke(root);
      break;
    case "破損記録": {
      const directory = path.join(
        root,
        ".agent-skill-chain/runtime/agent-lifecycle",
      );
      const file = fs
        .readdirSync(directory)
        .find((name) => name.endsWith(".json"));
      assert.ok(file);
      fs.writeFileSync(path.join(directory, file), "{}");
      this.lifecycleOutput = invoke(root);
      break;
    }
    default:
      throw new Error(`unknown fixture: ${operation}`);
  }
});
Then("lifecycle判定は{string}である", function (expected: string) {
  const output = this.lifecycleOutput;
  if (expected === "deny") assert.match(output, /"permissionDecision":"deny"/u);
  else if (expected === "warning") {
    assert.match(output, /tool試行8\/10/u);
    assert.doesNotMatch(output, /"deny"/u);
  } else {
    assert.doesNotMatch(output, /"deny"/u);
    assert.doesNotMatch(output, /"continue":false/u);
  }
});
Then("lifecycle計測は本文を含まず終了と再利用試行を区別する", function () {
  const root = this.lifecycleRoot;
  event(root, "SubagentStart", { agent_id: "agent-a" });
  event(root, "SubagentStop", { agent_id: "agent-a" });
  invoke(root, {
    tool_name: "SendMessage",
    tool_input: { to: "agent-a", message: "SECRET-PROMPT" },
  });
  const report = spawnSync(process.execPath, [hook, "--report"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /"deniedDispatches": 1/u);
  assert.match(report.stdout, /"status": "closed"/u);
  assert.match(report.stdout, /"observedLifetimeMs":/u);
  assert.match(report.stdout, /"contextMax": null/u);
  assert.doesNotMatch(report.stdout, /SECRET-PROMPT/u);
});
Then("lifecycle hookの配布と削除は設定を変更しない", function () {
  const root = this.lifecycleRoot;
  fs.mkdirSync(path.join(root, ".claude"));
  const settings = path.join(root, ".claude/settings.local.json");
  fs.writeFileSync(settings, '{"keep":true}\n');
  init(root, { apply: true });
  const deployed = path.join(root, ".claude/hooks/asc-agent-lifecycle.mjs");
  assert.equal(
    fs.readFileSync(deployed, "utf8"),
    fs.readFileSync(hook, "utf8"),
  );
  assert.equal(doctor(root).healthy, true);
  uninstall(root, { apply: true });
  assert.equal(fs.existsSync(deployed), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), {
    keep: true,
  });
});
Then("lifecycle記録のsymlinkは境界外を書き換えない", function () {
  const root = this.temp("asc-agent-lifecycle-link-");
  const outside = this.temp("asc-agent-lifecycle-outside-");
  fs.mkdirSync(path.join(root, ".agent-skill-chain"));
  fs.symlinkSync(outside, path.join(root, ".agent-skill-chain/runtime"));
  const result = event(root, "SessionStart", { source: "startup" });
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.match(invoke(root), /"permissionDecision":"deny"/u);
});

Then("lifecycle上限はmodel loopの継続も停止する", function () {
  event(this.lifecycleRoot, "SubagentStart", { agent_id: "budget-agent" });
  for (let index = 0; index < 10; index += 1)
    invoke(this.lifecycleRoot, { agent_id: "budget-agent" });
  assert.match(
    invoke(this.lifecycleRoot, { agent_id: "budget-agent" }),
    /"continue":false/u,
  );
});
Then("lifecycleの並行toolは上限を超えて許可されない", async function () {
  const root = this.lifecycleRoot;
  event(root, "SubagentStart", { agent_id: "parallel-agent" });
  const calls = Array.from(
    { length: 14 },
    () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [hook], {
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: root,
            ASC_AGENT_MAX_TOOLS: "10",
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve(output)
            : reject(new Error(`hook exited ${code}`)),
        );
        child.stdin.end(
          JSON.stringify({
            session_id: "session-1",
            agent_id: "parallel-agent",
            hook_event_name: "PreToolUse",
            tool_name: "Read",
            tool_input: {},
          }),
        );
      }),
  );
  const results = await Promise.all(calls);
  assert.equal(
    results.filter((output) => !output.includes('"deny"')).length,
    10,
  );
  assert.equal(
    results.filter((output) => output.includes('"continue":false')).length,
    4,
  );
});
Then("lifecycle登録診断はevent不足と非同期登録を報告する", function () {
  const absent = inspectAgentLifecycleRegistration("{}", "short-lived");
  assert.equal(absent.missingEvents.length, 9);
  assert.equal(absent.healthy, false);
  assert.equal(absent.configurationDiagnostics.timeoutValid, true);
  assert.ok(
    absent.diagnostics.every((message) => !message.includes("timeout")),
  );
  const entry = {
    hooks: [
      {
        type: "command",
        command:
          'node "$CLAUDE_PROJECT_DIR/.claude/hooks/asc-agent-lifecycle.mjs"',
      },
    ],
  };
  const events = [
    "SessionStart",
    "SessionEnd",
    "SubagentStart",
    "SubagentStop",
    "PreToolUse",
  ];
  const hooks: Record<string, unknown> = Object.fromEntries(
    events.map((event) => [event, [entry]]),
  );
  assert.deepEqual(
    inspectAgentLifecycleRegistration(JSON.stringify({ hooks })).missingEvents,
    ["PostToolUse", "PostToolUseFailure", "PermissionDenied", "PostToolBatch"],
  );
  assert.deepEqual(
    inspectAgentLifecycleRegistration(JSON.stringify({ hooks }), "short-lived")
      .missingEvents,
    ["PostToolUse", "PostToolUseFailure", "PermissionDenied", "PostToolBatch"],
  );
  assert.deepEqual(
    inspectAgentLifecycleRegistration(
      JSON.stringify({
        hooks,
        env: { ASC_EXECUTION_CONTEXT_MODE: "short-lived" },
      }),
      "compatible",
    ).missingEvents,
    ["PostToolUse", "PostToolUseFailure", "PermissionDenied", "PostToolBatch"],
  );
  fs.mkdirSync(path.join(this.lifecycleRoot, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(this.lifecycleRoot, ".claude/settings.local.json"),
    JSON.stringify({
      hooks,
      env: { ASC_EXECUTION_CONTEXT_MODE: "short-lived" },
    }),
  );
  assert.deepEqual(
    doctor(this.lifecycleRoot).hooks.agentLifecycle.missingEvents,
    ["PostToolUse", "PostToolUseFailure", "PermissionDenied", "PostToolBatch"],
  );
  const beforeSettings = fs.readFileSync(
    path.join(this.lifecycleRoot, ".claude/settings.local.json"),
    "utf8",
  );
  const configured = doctor(this.lifecycleRoot).hooks.agentLifecycle
    .configuration;
  assert.equal(configured.target, ".claude/settings.local.json");
  assert.equal(configured.apply, false);
  assert.equal(configured.restart, "new-session");
  assert.equal(configured.repair, "install/update --root=. --apply");
  const fragment = {
    env: {
      ASC_EXECUTION_CONTEXT_MODE: "short-lived",
      ASC_WORKFLOW_CLI: path.resolve("dist/bin/agent-skill-chain.js"),
    },
    hooks: Object.fromEntries(
      [
        "SessionStart",
        "SessionEnd",
        "SubagentStart",
        "SubagentStop",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PermissionDenied",
        "PostToolBatch",
      ].map((name) => [
        name,
        [{ hooks: [{ ...entry.hooks[0], timeout: 30 }] }],
      ]),
    ),
  };
  assert.deepEqual(
    inspectAgentLifecycleRegistration(JSON.stringify(fragment), "compatible")
      .missingEvents,
    [],
  );
  for (const invalid of [{ timeout: 15 }, { async: true, timeout: 30 }]) {
    const duplicate = {
      ...fragment,
      hooks: {
        ...fragment.hooks,
        PreToolUse: [
          ...fragment.hooks.PreToolUse,
          { matcher: "Agent", hooks: [{ ...entry.hooks[0], ...invalid }] },
        ],
      },
    };
    assert.equal(
      inspectAgentLifecycleRegistration(
        JSON.stringify(duplicate),
        "compatible",
        "",
      ).healthy,
      false,
    );
  }
  for (const event of ["PreToolUse", "SubagentStart"]) {
    for (const matcher of [undefined, "Agent"]) {
      const duplicate = {
        ...fragment,
        hooks: {
          ...fragment.hooks,
          [event]: [
            ...fragment.hooks[event],
            { matcher, hooks: [{ ...entry.hooks[0], timeout: 30 }] },
          ],
        },
      };
      const result = inspectAgentLifecycleRegistration(
        JSON.stringify(duplicate),
        "compatible",
        "",
      );
      assert.deepEqual(result.missingEvents, []);
      assert.equal(result.healthy, false);
      assert.deepEqual(result.configurationDiagnostics.duplicateEvents, [
        event,
      ]);
      assert.match(result.diagnostics.join(), /複数登録/u);
    }
  }
  const unrelated = {
    ...fragment,
    hooks: {
      ...fragment.hooks,
      PreToolUse: [
        ...fragment.hooks.PreToolUse,
        {
          hooks: [
            {
              type: "command",
              command: "node unrelated-hook.mjs",
              timeout: 30,
            },
          ],
        },
      ],
    },
  };
  assert.equal(
    inspectAgentLifecycleRegistration(
      JSON.stringify(unrelated),
      "compatible",
      "",
    ).healthy,
    true,
  );
  for (const command of [
    'echo "$CLAUDE_PROJECT_DIR/.claude/hooks/asc-agent-lifecycle.mjs"',
    "true # .claude/hooks/asc-agent-lifecycle.mjs",
    'echo node "$CLAUDE_PROJECT_DIR/.claude/hooks/asc-agent-lifecycle.mjs"',
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/asc-agent-lifecycle.mjs.backup"',
  ]) {
    const nonExecuting = {
      ...fragment,
      hooks: Object.fromEntries(
        Object.keys(fragment.hooks).map((event) => [
          event,
          [{ hooks: [{ type: "command", command, timeout: 30 }] }],
        ]),
      ),
    };
    const result = inspectAgentLifecycleRegistration(
      JSON.stringify(nonExecuting),
      "compatible",
      "",
    );
    assert.equal(result.healthy, false);
    assert.deepEqual(result.configuredEvents, []);
    assert.equal(result.missingEvents.length, 9);
    assert.match(result.diagnostics.join(), /canonical command/u);
  }
  const canonical = fragment.hooks.SubagentStart[0].hooks[0].command;
  for (const command of [
    ` ${canonical}`,
    `echo ${canonical}`,
    `true && ${canonical}`,
  ]) {
    const ambiguous = {
      ...fragment,
      hooks: {
        ...fragment.hooks,
        SubagentStart: [
          ...fragment.hooks.SubagentStart,
          { hooks: [{ type: "command", command, timeout: 30 }] },
        ],
      },
    };
    const result = inspectAgentLifecycleRegistration(
      JSON.stringify(ambiguous),
      "compatible",
      "",
    );
    assert.equal(result.healthy, false);
    assert.deepEqual(result.missingEvents, []);
    assert.deepEqual(result.configurationDiagnostics.noncanonicalEvents, [
      "SubagentStart",
    ]);
    assert.deepEqual(result.configurationDiagnostics.duplicateEvents, [
      "SubagentStart",
    ]);
  }
  assert.equal(Object.keys(fragment.hooks).length, 9);
  const diagnose = (cli: string | null, timeout = 30) =>
    inspectAgentLifecycleRegistration(
      JSON.stringify({
        env: {
          ASC_EXECUTION_CONTEXT_MODE: "short-lived",
          ASC_WORKFLOW_CLI: cli,
        },
        hooks: Object.fromEntries(
          Object.keys(fragment.hooks).map((event) => [
            event,
            [{ hooks: [{ ...entry.hooks[0], timeout }] }],
          ]),
        ),
      }),
      "compatible",
      "",
    );
  assert.equal(diagnose(null).healthy, false);
  assert.match(
    diagnose(null).diagnostics.join(),
    /managed workflow CLIがありません/u,
  );
  assert.equal(
    diagnose("relative/cli.js").configurationDiagnostics.cliAbsolute,
    false,
  );
  assert.equal(diagnose("relative/cli.js").healthy, false);
  assert.equal(
    diagnose(path.join(this.lifecycleRoot, "missing-cli.js")).healthy,
    false,
  );
  assert.equal(diagnose(this.lifecycleRoot).healthy, false);
  assert.equal(diagnose(fragment.env.ASC_WORKFLOW_CLI, 15).healthy, false);
  assert.equal(diagnose(fragment.env.ASC_WORKFLOW_CLI, 30).healthy, true);
  assert.equal(
    diagnose(fragment.env.ASC_WORKFLOW_CLI, 30).configurationDiagnostics
      .cliExists,
    true,
  );
  assert.equal(
    inspectAgentLifecycleRegistration(
      JSON.stringify({ hooks: fragment.hooks }),
      "compatible",
      "",
    ).healthy,
    true,
  );

  assert.equal(
    fs.readFileSync(
      path.join(this.lifecycleRoot, ".claude/settings.local.json"),
      "utf8",
    ),
    beforeSettings,
  );
  hooks.PermissionDenied = [entry];
  hooks.PostToolBatch = [entry];
  hooks.PostToolUse = [entry];
  hooks.PostToolUseFailure = [{ hooks: [{ ...entry.hooks[0], async: true }] }];
  assert.deepEqual(
    inspectAgentLifecycleRegistration(JSON.stringify({ hooks }), "short-lived")
      .missingEvents,
    ["PostToolUseFailure"],
  );
  hooks.PostToolUseFailure = [entry];
  assert.deepEqual(
    inspectAgentLifecycleRegistration(JSON.stringify({ hooks }), "short-lived")
      .missingEvents,
    [],
  );
  hooks.PreToolUse = [{ hooks: [{ ...entry.hooks[0], async: true }] }];
  assert.deepEqual(
    inspectAgentLifecycleRegistration(JSON.stringify({ hooks })).missingEvents,
    ["PreToolUse"],
  );
  assert.equal(
    inspectAgentLifecycleRegistration(undefined).missingEvents.length,
    9,
  );
  assert.equal(inspectAgentLifecycleRegistration("{}").runtimeVerified, false);
});

Then("lifecycleの既定とmode別budgetはmainを停止しない", function () {
  for (const mode of ["", "observe", "warn", "enforce"]) {
    const root = this.temp("asc-agent-mode-");
    // Empty mode means genuinely absent env var, including the caller's env.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      ASC_EXECUTION_CONTEXT_MODE: "compatible",
      ASC_AGENT_MAX_TOOLS: "10",
    };
    delete env.ASC_AGENT_BUDGET_MODE;
    if (mode) env.ASC_AGENT_BUDGET_MODE = mode;
    else delete env.ASC_AGENT_MAX_TOOLS;
    const limit = mode ? 10 : 120;
    const call = (name: string, extra: Record<string, unknown> = {}) => {
      const result = spawnSync(process.execPath, [hook], {
        env,
        encoding: "utf8",
        input: JSON.stringify({
          session_id: "mode-session",
          hook_event_name: name,
          ...extra,
        }),
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as {
        continue?: boolean;
        hookSpecificOutput?: {
          permissionDecision?: string;
          additionalContext?: string;
        };
      };
    };
    call("SessionStart", { source: "startup" });
    call("SubagentStart", { agent_id: "mode-child" });
    // Changing the environment must not escalate an existing warn session.
    env.ASC_AGENT_BUDGET_MODE = mode === "enforce" ? "warn" : "enforce";
    for (let i = 0; i < limit + 2; i += 1) {
      const main = call("PreToolUse", { tool_name: "Read" });
      assert.notEqual(main.continue, false);
      assert.notEqual(main.hookSpecificOutput?.permissionDecision, "deny");
      const child = call("PreToolUse", {
        agent_id: "mode-child",
        tool_name: "Read",
      });
      assert.equal(child.continue === false, mode === "enforce" && i >= limit);
      if (mode === "observe") assert.deepEqual(child, {});
      else if (mode !== "enforce" && i >= limit - Math.min(20, limit / 5) - 1)
        assert.match(
          child.hookSpecificOutput?.additionalContext ?? "",
          /警告のみ/u,
        );
    }
    const send = call("PreToolUse", {
      tool_name: "SendMessage",
      tool_input: { to: "mode-child" },
    });
    assert.equal(
      send.hookSpecificOutput?.permissionDecision === "deny",
      mode === "enforce",
    );
    call("SubagentStop", { agent_id: "mode-child" });
    assert.equal(
      call("PreToolUse", {
        tool_name: "SendMessage",
        tool_input: { to: "mode-child" },
      }).hookSpecificOutput?.permissionDecision,
      "deny",
    );
  }
});

Then("main再開は計測を保持しsubagentを復活させない", function () {
  const root = this.lifecycleRoot;
  const report = () => {
    const result = spawnSync(process.execPath, [hook, "--report"], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return (
      JSON.parse(result.stdout) as Array<{
        resumeAttempts: number;
        agents: Array<{
          id: string;
          status: string;
          starts: number;
          tools: number;
          startedAt: string;
          endedAt: string | null;
        }>;
      }>
    )[0];
  };
  event(root, "SubagentStart", { agent_id: "resume-child" });
  for (let i = 0; i < 12; i += 1) invoke(root);
  const before = report();
  event(root, "SessionEnd");
  const paused = report();
  assert.equal(paused.agents[0].status, "paused");
  assert.ok(paused.agents[0].endedAt);
  assert.equal(
    paused.agents.find((a) => a.id === "resume-child")?.status,
    "closed",
  );
  for (let i = 0; i < 2; i += 1) {
    event(root, "SessionStart", { source: "resume" });
    const resumed = report();
    assert.equal(resumed.agents[0].status, "active");
    assert.equal(resumed.agents[0].endedAt, null);
    assert.equal(resumed.agents[0].startedAt, before.agents[0].startedAt);
    assert.equal(resumed.agents[0].tools, before.agents[0].tools + i);
    assert.equal(resumed.agents[0].starts, before.agents[0].starts + i + 1);
    assert.equal(resumed.resumeAttempts, before.resumeAttempts + i + 1);
    assert.doesNotMatch(invoke(root), /"deny"|"continue":false/u);
    event(root, "SessionEnd");
  }
  event(root, "SessionStart", { source: "resume" });
  assert.match(
    invoke(root, {
      tool_name: "SendMessage",
      tool_input: { to: "resume-child" },
    }),
    /"deny"/u,
  );
  event(root, "SubagentStart", { agent_id: "resume-child" });
  assert.match(invoke(root, { agent_id: "resume-child" }), /"deny"/u);
  event(root, "SubagentStart", { agent_id: "fresh-after-resume" });
  assert.doesNotMatch(
    invoke(root, { agent_id: "fresh-after-resume" }),
    /"deny"/u,
  );
  // Upgrade compatibility: only main may recover old closed/exhausted records.
  const directory = path.join(
    root,
    ".agent-skill-chain/runtime/agent-lifecycle",
  );
  const file = path.join(
    directory,
    fs.readdirSync(directory).find((name) => name.endsWith(".json"))!,
  );
  for (const status of ["closed", "exhausted"]) {
    const state = JSON.parse(fs.readFileSync(file, "utf8")) as {
      agents: Array<{ status: string }>;
    };
    state.agents[0].status = status;
    fs.writeFileSync(file, JSON.stringify(state));
    event(root, "SessionStart", { source: "resume" });
    assert.doesNotMatch(invoke(root), /"deny"|"continue":false/u);
  }
});
