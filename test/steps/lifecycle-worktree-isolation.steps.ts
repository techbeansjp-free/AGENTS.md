import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();
const hook = path.resolve(".agent-skill-chain/hooks/asc-agent-lifecycle.mjs");
const cli = path.resolve("dist/bin/agent-skill-chain.js");
interface Fixture {
  root: string;
  linked: string;
  dispatch: Record<string, unknown>;
  localDispatch: Record<string, unknown>;
  result?: string;
}
function call(
  f: Fixture,
  session: string,
  event: string,
  extra: Record<string, unknown> = {},
) {
  const result = spawnSync(process.execPath, [hook], {
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: f.root,
      ASC_WORKFLOW_CLI: cli,
      ASC_EXECUTION_CONTEXT_MODE: "short-lived",
    },
    input: JSON.stringify({
      session_id: session,
      hook_event_name: event,
      ...extra,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function allow(result: string) {
  assert.doesNotMatch(result, /"deny"|"continue":false/u);
}
function deny(result: string) {
  assert.match(result, /"deny"/u);
}
function dispatch(f: Fixture, session = "B", local = false) {
  return call(f, session, "PreToolUse", {
    tool_name: "Agent",
    tool_use_id: "writer",
    tool_input: local ? f.localDispatch : f.dispatch,
  });
}
Given("lifecycle隔離用の2つのGit worktreeとsessionがある", function () {
  const root = this.initRepo();
  fs.writeFileSync(path.join(root, ".gitignore"), ".agent-skill-chain/\n");
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  git("add", ".gitignore");
  git("commit", "-qm", "isolation fixture");
  const linked = path.join(this.temp("asc-worktree-isolation-"), "linked");
  git("worktree", "add", "-b", "isolated", linked);
  const preview = (worktree: string) => {
    const staging = createIssueStaging(worktree, {
      title: "lifecycle-isolation",
      now: new Date("2026-10-05T00:00:00Z"),
      requestedMode: "full",
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
      ),
    }).path;
    const r = spawnSync(
      process.execPath,
      [cli, "workflow", "advance", `--staging=${staging}`],
      {
        cwd: worktree,
        env: { ...process.env, ASC_EXECUTION_CONTEXT_MODE: "short-lived" },
        encoding: "utf8",
      },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const parsed = JSON.parse(r.stdout) as {
      agentDispatch: Record<string, unknown>;
    };
    assert.ok(parsed.agentDispatch);
    return parsed.agentDispatch;
  };
  const fixture: Fixture = {
    root,
    linked,
    dispatch: preview(linked),
    localDispatch: preview(root),
  };
  this.value = fixture;
  for (const session of ["A", "B"])
    allow(call(fixture, session, "SessionStart", { source: "startup" }));
});
When(
  "先行sessionに{string}を残して{string}worktreeの担当を起動する",
  function (activity: string, target: string) {
    const f = this.value as Fixture;
    if (activity === "書込み中" || activity === "古い未完了記録") {
      allow(
        call(f, "A", "PreToolUse", {
          tool_name: "Bash",
          tool_use_id: "unfinished",
        }),
      );
    } else {
      allow(
        call(f, "A", "PreToolUse", {
          tool_name: "Agent",
          tool_use_id: "unfinished",
          tool_input: { prompt: "調査", subagent_type: "Explore" },
        }),
      );
      if (activity === "subagent実行中") {
        allow(
          call(f, "A", "SubagentStart", {
            agent_id: "child",
            agent_type: "Explore",
          }),
        );
        allow(call(f, "A", "PostToolUse", { tool_use_id: "unfinished" }));
      }
    }
    const stateRoot = path.join(
      f.root,
      ".agent-skill-chain/runtime/agent-lifecycle",
    );
    const file = fs.readdirSync(stateRoot).find(
      (name) =>
        name.endsWith(".json") &&
        (
          JSON.parse(fs.readFileSync(path.join(stateRoot, name), "utf8")) as {
            sessionId: string;
          }
        ).sessionId === "A",
    );
    assert.ok(file);
    const source = path.join(stateRoot, file);
    if (activity === "古い未完了記録") {
      const state = JSON.parse(fs.readFileSync(source, "utf8")) as {
        agents: { startedAt: string; lastSeenAt: string }[];
        worktree?: string;
      };
      for (const agent of state.agents)
        agent.startedAt = agent.lastSeenAt = "2020-01-01T00:00:00Z";
      delete state.worktree; // Legacy records must remain scoped without recovery.
      fs.writeFileSync(source, JSON.stringify(state) + "\n");
    }
    const before = fs.readFileSync(source, "utf8");
    f.result = dispatch(f, "B", target === "同じ");
    assert.equal(fs.readFileSync(source, "utf8"), before);
  },
);
When("{string}で拒否されたツールの予約を回収する", function (event: string) {
  const f = this.value as Fixture;
  for (const id of ["refused", "still-running"])
    allow(call(f, "B", "PreToolUse", { tool_name: "Bash", tool_use_id: id }));
  const notify = (id: string) =>
    call(
      f,
      "B",
      event,
      event === "PostToolBatch"
        ? {
            tool_calls: [
              {
                tool_name: "Bash",
                tool_use_id: id,
                tool_response: "denied SECRET",
              },
            ],
          }
        : { tool_use_id: id, tool_name: "Bash", reason: "denied SECRET" },
    );
  allow(notify("unknown"));
  deny(dispatch(f));
  allow(notify("refused"));
  deny(dispatch(f)); // An unrelated running tool must still protect this session.
  allow(notify("still-running"));
  f.result = dispatch(f);
  const report = spawnSync(process.execPath, [hook, "--report"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: f.linked },
    encoding: "utf8",
  });
  assert.equal(report.status, 0, report.stderr);
  assert.doesNotMatch(report.stdout, /SECRET/u);
});
Then("lifecycle隔離判定は{string}になる", function (expected: string) {
  const result = (this.value as Fixture).result;
  assert.ok(result);
  if (expected === "allow") allow(result);
  else deny(result);
});
