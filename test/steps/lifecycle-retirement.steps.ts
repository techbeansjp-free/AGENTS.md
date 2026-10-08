import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  planLifecycleSettings,
  applyLifecycleSettings,
  AGENT_LIFECYCLE_COMMAND,
} from "../../src/domain/lifecycle-settings.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
const { Given, When, Then } = stepDefinitions<WorkflowWorld>();
Given("常時観測を廃止したASCを検証する", function () {
  this.value = false;
});
Then("旧記録を変更せず全操作を許可し利用者設定を保持する", function () {
  assert.equal(this.value, true);
});
When("廃止hookと旧登録の移行を状態異常込みで検証する", function () {
  const root = process.cwd();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "asc-retirement-"));
  try {
    fs.mkdirSync(path.join(fixture, ".claude"));
    const settings = {
      env: { USER_SETTING: "keep" },
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: AGENT_LIFECYCLE_COMMAND },
              { type: "command", command: "echo user-hook" },
            ],
          },
        ],
      },
    };
    fs.writeFileSync(
      path.join(fixture, ".claude/settings.local.json"),
      JSON.stringify(settings),
    );
    const plan = planLifecycleSettings(fixture, "install");
    applyLifecycleSettings(plan);
    const actual: unknown = JSON.parse(fs.readFileSync(plan.file, "utf8"));
    assert.deepEqual(actual, {
      env: { USER_SETTING: "keep" },
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "echo user-hook" }] },
          // install registers the host observer canonical group (Issue #1566).
          {
            matcher: "SendMessage",
            hooks: [
              {
                type: "command",
                command: "node",
                args: [
                  "${CLAUDE_PROJECT_DIR}/.claude/hooks/asc-host-observer.mjs",
                ],
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
    assert.equal(planLifecycleSettings(fixture, "install").changed, false);
    const state = path.join(
      fixture,
      ".agent-skill-chain/runtime/agent-lifecycle",
    );
    fs.mkdirSync(path.join(state, "worktree.lock"), { recursive: true });
    fs.writeFileSync(path.join(state, "stale.json"), "{broken stale state");
    const before = fs.readFileSync(path.join(state, "stale.json"), "utf8");
    let cases = 0;
    for (const event of [
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "SubagentStart",
      "SubagentStop",
      "SessionEnd",
    ]) {
      for (const tool of [
        "Bash",
        "ListAgents",
        "ToolSearch",
        "Agent",
        "Write",
        "Read",
      ]) {
        const run = spawnSync(
          process.execPath,
          [path.join(root, ".agent-skill-chain/hooks/asc-agent-lifecycle.mjs")],
          {
            env: { ...process.env, CLAUDE_PROJECT_DIR: fixture },
            input: JSON.stringify({
              hook_event_name: event,
              tool_name: tool,
              session_id: "new",
              cwd: fixture,
              tool_input: { command: "pwd" },
            }),
            encoding: "utf8",
          },
        );
        assert.equal(run.status, 0, run.stderr);
        assert.deepEqual(JSON.parse(run.stdout), {});
        cases++;
      }
    }
    assert.equal(
      fs.readFileSync(path.join(state, "stale.json"), "utf8"),
      before,
    );
    assert.deepEqual(fs.readdirSync(state).sort(), [
      "stale.json",
      "worktree.lock",
    ]);
    const large = spawnSync(
      process.execPath,
      [path.join(root, ".agent-skill-chain/hooks/asc-agent-lifecycle.mjs")],
      {
        env: { ...process.env, CLAUDE_PROJECT_DIR: fixture },
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: { content: "x".repeat(8 * 1024 * 1024) },
        }),
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(large.error, undefined);
    assert.equal(large.status, 0, large.stderr);
    assert.deepEqual(JSON.parse(large.stdout), {});
    assert.equal(
      fs.readFileSync(path.join(state, "stale.json"), "utf8"),
      before,
    );
    assert.deepEqual(fs.readdirSync(state).sort(), [
      "stale.json",
      "worktree.lock",
    ]);
    assert.equal(cases, 36);
    this.value = true;
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
