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
  staging: string;
  result?: string;
}
function call(
  f: Fixture,
  session: string,
  event: string,
  extra: Record<string, unknown> = {},
  projectRoot = f.root,
) {
  const result = spawnSync(process.execPath, [hook], {
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectRoot,
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
  return call(
    f,
    session,
    "PreToolUse",
    {
      tool_name: "Agent",
      tool_use_id: "writer",
      tool_input: local ? f.localDispatch : f.dispatch,
    },
    local ? f.root : f.linked,
  );
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
  const stagings: Record<string, string> = {};
  const preview = (worktree: string) => {
    const staging = createIssueStaging(worktree, {
      title: "lifecycle-isolation",
      now: new Date("2026-10-05T00:00:00Z"),
      requestedMode: "full",
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
      ),
    }).path;
    stagings[worktree] = staging;
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
    staging: stagings[root]!,
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
        resourceOperations?: unknown[];
        inFlightWrites?: string[];
      };
      for (const agent of state.agents)
        agent.startedAt = agent.lastSeenAt = "2020-01-01T00:00:00Z";
      delete state.worktree; // Legacy records must remain scoped without recovery.
      delete state.resourceOperations;
      state.inFlightWrites = ["unfinished"];
      fs.writeFileSync(source, JSON.stringify(state) + "\n");
    }
    const before = fs.readFileSync(source, "utf8");
    if (target !== "同じ")
      allow(call(f, "B", "SessionStart", { source: "startup" }, f.linked));
    f.result = dispatch(f, "B", target === "同じ");
    if (activity === "古い未完了記録") {
      deny(dispatch(f, "B", true));
      allow(
        call(f, "B", "PreToolUse", {
          tool_name: "Write",
          tool_use_id: "legacy-source",
          tool_input: {
            file_path: path.join(f.root, "src/legacy-parallel.ts"),
          },
        }),
      );
    }
    assert.equal(fs.readFileSync(source, "utf8"), before);
  },
);
When("{string}で拒否されたツールの予約を回収する", function (event: string) {
  const f = this.value as Fixture;
  for (const id of ["refused", "still-running"])
    allow(
      call(f, "B", "PreToolUse", {
        tool_name: "Write",
        tool_use_id: id,
        tool_input: { file_path: path.join(f.staging, id + ".json") },
      }),
    );
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
  deny(dispatch(f, "B", true));
  allow(notify("refused"));
  deny(dispatch(f, "B", true)); // An unrelated running tool must still protect this session.
  allow(notify("still-running"));
  f.result = dispatch(f, "B", true);
  const report = spawnSync(process.execPath, [hook, "--report"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: f.root },
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

When("制御資源の競合と安全な並行操作を検査する", function () {
  const f = this.value as Fixture;
  const write = (session: string, id: string, file: string) =>
    call(f, session, "PreToolUse", {
      tool_name: "Write",
      tool_use_id: id,
      tool_input: { file_path: file, content: "SECRET" },
    });
  const journalA = path.join(
    f.root,
    ".agent-skill-chain/tmp/issues/a/journal/steps.jsonl",
  );
  const journalB = path.join(
    f.root,
    ".agent-skill-chain/tmp/issues/b/journal/steps.jsonl",
  );
  fs.mkdirSync(path.dirname(journalA), { recursive: true });
  const alias = path.join(f.root, "source-looking-alias");
  fs.symlinkSync(path.dirname(journalA), alias);
  allow(write("A", "journal-a", journalA));
  deny(write("B", "symlink-conflict", path.join(alias, "steps.jsonl")));
  const dangling = path.join(f.root, "dangling-source-alias");
  fs.symlinkSync(journalA, dangling);
  deny(write("B", "dangling-conflict", dangling));
  const backing = path.join(path.dirname(journalA), "hardlinked.json");
  fs.writeFileSync(backing, "{}");
  const hardlink = path.join(f.root, "source-hardlink.json");
  fs.linkSync(backing, hardlink);
  deny(write("B", "hardlink-conflict", hardlink));
  deny(write("A", "journal-a", path.join(f.root, "src/reused-id.ts")));
  const conflict = write("B", "same-journal", journalA);
  deny(conflict);
  assert.match(conflict, /ASC Isolate/u);
  assert.ok(conflict.includes(journalA));
  allow(write("B", "journal-b", journalB));
  deny(write("B", "foreign-source", path.join(f.linked, "src/auth.ts")));
  const foreignControl = write(
    "B",
    "foreign-control",
    path.join(f.linked, ".agent-skill-chain/journal.json"),
  );
  deny(foreignControl);
  assert.match(foreignControl, /resource-context-unavailable/u);
  allow(write("A", "source-a", path.join(f.root, "src/auth.ts")));
  allow(write("B", "source-b", path.join(f.root, "src/auth.ts")));
  allow(call(f, "B", "PreToolUse", { tool_name: "Read", tool_use_id: "read" }));
  allow(call(f, "B", "PostToolUse", { tool_use_id: "journal-b" }));
  allow(call(f, "A", "PermissionDenied", { tool_use_id: "journal-a" }));
  allow(write("B", "after-settle", journalA));
  allow(call(f, "B", "PostToolUse", { tool_use_id: "after-settle" }));
  const opaque = call(f, "A", "PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "opaque",
    tool_input: { command: "custom-command" },
  });
  allow(opaque);
  assert.match(opaque, /ASC Warn/u);
  allow(write("B", "parallel-source", path.join(f.root, "src/another.ts")));
  deny(write("B", "opaque-conflict", journalB));
  allow(
    call(f, "A", "PostToolBatch", { tool_calls: [{ tool_use_id: "opaque" }] }),
  );
  const git = (session: string, id: string) =>
    call(f, session, "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: id,
      cwd: f.root,
      tool_input: { command: "git add src/auth.ts" },
    });
  allow(git("A", "git-a"));
  deny(git("B", "git-b"));
  allow(write("B", "git-unrelated-journal", journalB));
  allow(call(f, "B", "PostToolUse", { tool_use_id: "git-unrelated-journal" }));
  allow(call(f, "A", "PostToolUse", { tool_use_id: "git-a" }));
  f.result = git("B", "git-retry");
});

When("peerの状態を壊して読取と編集の継続範囲を検査する", function () {
  const f = this.value as Fixture;
  const directory = path.join(
    f.root,
    ".agent-skill-chain/runtime/agent-lifecycle",
  );
  const peer = fs.readdirSync(directory).find(
    (name) =>
      name.endsWith(".json") &&
      (
        JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) as {
          sessionId: string;
        }
      ).sessionId === "A",
  );
  assert.ok(peer);
  fs.writeFileSync(path.join(directory, peer), "{}");
  const read = call(f, "B", "PreToolUse", {
    tool_name: "Read",
    tool_use_id: "read-with-unknown",
  });
  allow(read);
  assert.match(read, /ASC Warn/u);
  const edit = call(f, "B", "PreToolUse", {
    tool_name: "Edit",
    tool_use_id: "source-with-unknown",
    tool_input: { file_path: path.join(f.root, "src/auth.ts") },
  });
  allow(edit);
  assert.match(edit, /ASC Warn/u);
  deny(
    call(f, "B", "PreToolUse", {
      tool_name: "Write",
      tool_use_id: "control-with-unknown",
      tool_input: {
        file_path: path.join(f.root, ".agent-skill-chain/journal.json"),
      },
    }),
  );
  deny(
    call(f, "A", "PreToolUse", {
      tool_name: "Write",
      tool_input: { file_path: path.join(f.root, "src/auth.ts") },
    }),
  );
  f.result = call(f, "A", "PreToolUse", { tool_name: "Read" });
  assert.match(f.result, /ASC Warn/u);
  assert.equal(fs.readFileSync(path.join(directory, peer), "utf8"), "{}");
});

When("foreign handoffの妥当性とhost実行能力を分けて検査する", function () {
  const f = this.value as Fixture;
  const result = call(f, "B", "PreToolUse", {
    tool_name: "Agent",
    tool_use_id: "foreign",
    tool_input: f.dispatch,
  });
  deny(result); // Native hook protocol holds only this unbound dispatch.
  assert.match(result, /ASC Degrade \[execution-root-unavailable\]/u);
  assert.match(result, /handoffは無効ではありません/u);
  const report = spawnSync(process.execPath, [hook, "--report"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: f.root },
    encoding: "utf8",
  });
  assert.equal(report.status, 0, report.stderr);
  const states = JSON.parse(report.stdout) as {
    sessionId: string;
    pendingHandoff?: unknown;
    blockedResources: string[];
  }[];
  const state = states.find((entry) => entry.sessionId === "B")!;
  assert.ok(!state.pendingHandoff);
  assert.deepEqual(state.blockedResources, []);
  allow(
    call(f, "B", "PreToolUse", {
      tool_name: "Agent",
      tool_use_id: "normal-task",
      tool_input: { subagent_type: "Explore", prompt: "別の調査を続ける" },
    }),
  );
  allow(
    call(
      f,
      "fresh-worker-host",
      "SessionStart",
      { source: "startup" },
      f.linked,
    ),
  );
  f.result = dispatch(f, "fresh-worker-host");
});

When("各workerの編集とforeign worktreeへの直接変更を区別する", function () {
  const f = this.value as Fixture;
  for (const root of [f.root, f.linked]) {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/auth.ts"), "original");
  }
  for (const [session, root] of [
    ["local-worker", f.root],
    ["linked-worker", f.linked],
  ]) {
    allow(call(f, session, "SessionStart", { source: "startup" }, root));
    allow(
      call(
        f,
        session,
        "PreToolUse",
        {
          tool_name: "Edit",
          tool_use_id: "own-source",
          tool_input: { file_path: path.join(root, "src/auth.ts") },
        },
        root,
      ),
    );
  }
  const runtime = path.join(
    f.linked,
    ".agent-skill-chain/runtime/agent-lifecycle",
  );
  const snapshot = () =>
    fs
      .readdirSync(runtime)
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(runtime, name), "utf8")]);
  const before = snapshot();
  deny(
    call(f, "local-worker", "PreToolUse", {
      tool_name: "NotebookEdit",
      tool_use_id: "notebook-field-conflict",
      tool_input: {
        file_path: path.join(f.root, "src/auth.ts"),
        notebook_path: path.join(f.linked, "src/auth.ts"),
      },
    }),
  );
  allow(
    call(f, "local-worker", "PreToolUse", {
      tool_name: "NotebookEdit",
      tool_use_id: "notebook-local-field",
      tool_input: {
        file_path: path.join(f.linked, "src/auth.ts"),
        notebook_path: path.join(f.root, "src/auth.ts"),
      },
    }),
  );

  const nested = path.join(f.root, ".worktrees/nested");
  const added = spawnSync(
    "git",
    ["worktree", "add", "-b", "nested-isolation", nested],
    { cwd: f.root, encoding: "utf8" },
  );
  assert.equal(added.status, 0, added.stderr);
  deny(
    call(f, "local-worker", "PreToolUse", {
      tool_name: "Write",
      tool_use_id: "nested",
      tool_input: { file_path: path.join(nested, "src/auth.ts") },
    }),
  );
  deny(
    call(f, "local-worker", "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: "nested-git",
      cwd: nested,
      tool_input: { command: "git add src/auth.ts" },
    }),
  );
  const linkedFile = path.join(f.root, "foreign-hardlink.ts");
  fs.linkSync(path.join(f.linked, "src/auth.ts"), linkedFile);
  deny(
    call(f, "local-worker", "PreToolUse", {
      tool_name: "Write",
      tool_use_id: "hardlink-escape",
      tool_input: { file_path: linkedFile },
    }),
  );
  fs.unlinkSync(linkedFile);

  const alias = path.join(f.root, "linked-source-alias");
  fs.symlinkSync(path.join(f.linked, "src"), alias);
  for (const tool of ["Write", "Edit", "NotebookEdit"]) {
    for (const file of [
      path.join(f.linked, "src/auth.ts"),
      path.join(alias, "auth.ts"),
      path.join(f.linked, "src/new.ts"),
    ]) {
      const result = call(f, "local-worker", "PreToolUse", {
        tool_name: tool,
        tool_use_id: tool + file,
        tool_input: { file_path: file, notebook_path: file },
      });
      deny(result);
      assert.match(result, /resource-context-unavailable/);
    }
  }
  allow(
    call(f, "local-worker", "PreToolUse", {
      tool_name: "Read",
      tool_use_id: "foreign-read",
      tool_input: { file_path: path.join(f.linked, "src/auth.ts") },
    }),
  );
  deny(
    call(f, "local-worker", "PreToolUse", {
      tool_name: "Bash",
      tool_use_id: "foreign-git",
      cwd: f.linked,
      tool_input: { command: "git add src/auth.ts" },
    }),
  );
  assert.deepEqual(snapshot(), before);
  assert.equal(
    fs.readFileSync(path.join(f.linked, "src/auth.ts"), "utf8"),
    "original",
  );
  f.result = call(f, "local-worker", "PreToolUse", {
    tool_name: "Edit",
    tool_use_id: "after-denial",
    tool_input: { file_path: path.join(f.root, "src/auth.ts") },
  });
});
