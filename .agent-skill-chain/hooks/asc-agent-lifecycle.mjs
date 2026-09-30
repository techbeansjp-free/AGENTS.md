#!/usr/bin/env node
/** Opt-in Claude Code lifecycle guard. State is operational, never workflow authority. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const MODES = ["observe", "warn", "enforce"];
const EVENTS = new Set([
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "PreToolUse",
]);
const HANDOFF =
  "作業状態をGit / staging / trackerへ固定し、Issue・worktree・stagingのpointerからfresh agentを起動してください。workflow advanceのresumeはadvisoryです。会話を継承せず、必要なreview・検証を続けてください。";
const validId = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const natural = (value) => Number.isSafeInteger(value) && value >= 0;
const digest = (value) => createHash("sha256").update(value).digest("hex");

function directory(parent, name) {
  const target = path.join(parent, name);
  try {
    fs.mkdirSync(target, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("lifecycle directoryが通常directoryではありません");
  return target;
}

function stateRoot() {
  if (!process.env.CLAUDE_PROJECT_DIR)
    throw new Error("CLAUDE_PROJECT_DIRが必要です");
  let root = fs.realpathSync(process.env.CLAUDE_PROJECT_DIR);
  for (const name of [".agent-skill-chain", "runtime", "agent-lifecycle"])
    root = directory(root, name);
  return root;
}

function readState(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024)
      throw new Error("lifecycle stateのfile境界が不正です");
    const state = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (
      state.version !== 1 ||
      !validId(state.sessionId) ||
      !Array.isArray(state.agents) ||
      !(state.budgetMode === undefined || MODES.includes(state.budgetMode)) ||
      !natural(state.maxTools) ||
      state.maxTools < 10 ||
      state.maxTools > 1000 ||
      !natural(state.resumeAttempts) ||
      !natural(state.dispatchAttempts) ||
      !natural(state.deniedDispatches)
    )
      throw new Error("lifecycle stateが不正です");
    const ids = new Set();
    for (const agent of state.agents) {
      if (
        !validId(agent.id) ||
        ids.has(agent.id) ||
        !["main", "subagent"].includes(agent.kind) ||
        !["active", "closed", "exhausted"].includes(agent.status) ||
        !natural(agent.tools) ||
        !natural(agent.starts) ||
        !natural(agent.deniedTools) ||
        !Number.isFinite(Date.parse(agent.startedAt)) ||
        !Number.isFinite(Date.parse(agent.lastSeenAt)) ||
        !(agent.endedAt === null || Number.isFinite(Date.parse(agent.endedAt)))
      )
        throw new Error("agent記録が不正です");
      ids.add(agent.id);
    }
    if (
      !state.agents.some(
        (agent) => agent.id === state.sessionId && agent.kind === "main",
      )
    )
      throw new Error("main記録がありません");
    // Older records never implicitly opt in to hard budget enforcement.
    state.budgetMode ??= "warn";
    return state;
  } finally {
    fs.closeSync(fd);
  }
}

function newAgent(id, kind, now) {
  return {
    id,
    kind,
    status: "active",
    tools: 0,
    starts: 1,
    deniedTools: 0,
    startedAt: now,
    lastSeenAt: now,
    endedAt: null,
    reason: null,
  };
}

function deny(reason, stop = false) {
  return {
    ...(stop ? { continue: false, stopReason: `${reason} ${HANDOFF}` } : {}),
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `${reason} ${HANDOFF}`,
    },
  };
}

function context(event, message) {
  return {
    hookSpecificOutput: { hookEventName: event, additionalContext: message },
  };
}

function budgetEnforced(state, agent) {
  return state.budgetMode === "enforce" && agent.kind === "subagent";
}

function transition(state, input, now) {
  const event = input.hook_event_name;
  if (
    event === "SubagentStop" &&
    (!validId(input.agent_id) || input.agent_id === state.sessionId)
  )
    return {};
  const id = input.agent_id ?? input.session_id;
  let agent = state.agents.find((entry) => entry.id === id);
  if (event === "SubagentStart") {
    if (!validId(input.agent_id) || id === state.sessionId)
      throw new Error("subagent identityが不正です");
    if (agent) {
      agent.starts += 1;
      state.resumeAttempts += 1;
      // Start cannot block. PreToolUse below refuses the reused identity.
      agent.status = "closed";
      agent.reason = "identity-reused";
      agent.endedAt ??= now;
    } else {
      agent = newAgent(id, "subagent", now);
      state.agents.push(agent);
    }
    return context(
      event,
      `ASC: one agent = one bounded work unit。tool目安${state.maxTools}、budget mode=${state.budgetMode}。${HANDOFF}`,
    );
  }
  if (event === "SessionStart") {
    const main = state.agents.find((entry) => entry.kind === "main");
    if (input.source === "resume") {
      main.starts += 1;
      state.resumeAttempts += 1;
    }
    return context(
      event,
      `ASC lifecycle: ${main.status}, tools=${main.tools}/${state.maxTools}。compactやsession再開で寿命はリセットしません。${HANDOFF}`,
    );
  }
  if (!agent) {
    if (event === "PreToolUse")
      return deny(
        "agentの開始記録がありません。hook登録を確認してください。",
        true,
      );
    return {};
  }
  agent.lastSeenAt = now;
  if (event === "SubagentStop" || event === "SessionEnd") {
    // SessionEnd is terminal for every child too; no automatic resurrection.
    const closing = event === "SessionEnd" ? state.agents : [agent];
    for (const entry of closing) {
      entry.status = entry.status === "exhausted" ? "exhausted" : "closed";
      entry.endedAt ??= now;
      entry.reason ??= event === "SessionEnd" ? "session-ended" : "returned";
    }
    return {};
  }
  if (event !== "PreToolUse") return {};
  if (
    agent.status !== "active" ||
    (budgetEnforced(state, agent) && agent.tools >= state.maxTools)
  ) {
    if (agent.status === "active") {
      agent.status = "exhausted";
      agent.reason = "tool-limit";
      agent.endedAt = now;
    }
    agent.deniedTools += 1;
    // Reporting is permitted, but no further work. Stop hooks never block completion.
    if (input.tool_name === "SubagentHandback") return {};
    return deny(
      `agentは${agent.status}です（tool ${agent.tools}/${state.maxTools}）。同じIDで追加作業を実行できません。`,
      true,
    );
  }
  agent.tools += 1; // Attempts, including denied dispatches; not API/model calls.
  const tool = input.tool_input ?? {};
  const legacyResume =
    ["Agent", "Task"].includes(input.tool_name) && tool.resume !== undefined;
  const message = input.tool_name === "SendMessage";
  if (legacyResume || message) {
    const recipient = state.agents.find(
      (entry) => entry.id === (tool.to ?? tool.recipient),
    );
    state.dispatchAttempts += 1;
    // Names/unknown/cross-session recipients cannot prove a live identity.
    if (
      legacyResume ||
      !recipient ||
      recipient.status !== "active" ||
      (budgetEnforced(state, recipient) && recipient.tools >= state.maxTools)
    ) {
      state.resumeAttempts += 1;
      state.deniedDispatches += 1;
      return deny(
        "旧agentのresume、終了済み・上限到達・identity未確認の宛先へのSendMessageを拒否しました。active agentへの連絡は正確なIDを指定してください。",
      );
    }
  }
  const reserve = Math.min(20, Math.floor(state.maxTools / 5));
  if (
    state.budgetMode !== "observe" &&
    agent.tools >= state.maxTools - reserve
  ) {
    return context(
      event,
      `ASC: tool試行${agent.tools}/${state.maxTools}（API call/context量ではありません）。${budgetEnforced(state, agent) ? "実験的強制停止まで残り" + Math.max(0, state.maxTools - agent.tools) + "回。状態保存は保証されません。" : "警告のみ。tool実行は継続可能です。"} 現在の変更と未完了状態を固定してください。${HANDOFF}`,
    );
  }
  return {};
}

function run(input) {
  const event = input.hook_event_name;
  if (!EVENTS.has(event)) return {};
  if (
    !validId(input.session_id) ||
    (input.agent_id !== undefined && !validId(input.agent_id))
  )
    throw new Error("session/agent identityがありません");
  const root = stateRoot();
  const key = digest(input.session_id);
  const lock = path.join(root, `${key}.lock`);
  // A contended or stale lock refuses this call; never remove another process's lock.
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt >= 50) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    const file = path.join(root, `${key}.json`);
    let state;
    try {
      state = readState(file);
    } catch (error) {
      if (
        error.code !== "ENOENT" ||
        event !== "SessionStart" ||
        !["startup", "clear"].includes(input.source)
      )
        throw error;
      const maxTools = Number(process.env.ASC_AGENT_MAX_TOOLS ?? "120");
      if (!Number.isSafeInteger(maxTools) || maxTools < 10 || maxTools > 1000)
        throw new Error("ASC_AGENT_MAX_TOOLSは10〜1000の整数です", {
          cause: error,
        });
      const budgetMode = process.env.ASC_AGENT_BUDGET_MODE ?? "warn";
      if (!MODES.includes(budgetMode))
        throw new Error("ASC_AGENT_BUDGET_MODEはobserve / warn / enforceです", {
          cause: error,
        });
      state = {
        version: 1,
        budgetMode,
        sessionId: input.session_id,
        maxTools,
        resumeAttempts: 0,
        dispatchAttempts: 0,
        deniedDispatches: 0,
        agents: [newAgent(input.session_id, "main", new Date().toISOString())],
      };
    }
    if (state.sessionId !== input.session_id)
      throw new Error("session identityが一致しません");
    const result = transition(state, input, new Date().toISOString());
    const temporary = path.join(lock, "state.json");
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    return result;
  } finally {
    fs.rmSync(lock, { recursive: true });
  }
}

function report() {
  const root = stateRoot();
  return fs
    .readdirSync(root)
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .sort()
    .map((name) => {
      const state = readState(path.join(root, name));
      return {
        ...state,
        agents: state.agents.map((agent) => ({
          ...agent,
          parent: agent.kind === "subagent" ? state.sessionId : null,
          generation: 1,
          observedLifetimeMs:
            Date.parse(agent.endedAt ?? agent.lastSeenAt) -
            Date.parse(agent.startedAt),
          contextMax: null,
          apiCalls: null,
          hostVersion: null,
        })),
      };
    });
}

let input;
try {
  if (process.argv.includes("--report"))
    process.stdout.write(`${JSON.stringify(report(), null, 2)}\n`);
  else {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(run(input))}\n`);
  }
} catch (error) {
  const reason = `ASC lifecycle記録を確認できません（${error.code ?? "invalid-state"}）。hook設定・記録・実行中processを確認し、新contextで再開してください。`;
  if (input?.hook_event_name === "PreToolUse")
    process.stdout.write(`${JSON.stringify(deny(reason, true))}\n`);
  else {
    process.stderr.write(`${reason}\n`);
    // Nonblocking on Stop: exit 2 would keep the old agent alive.
    process.exitCode = 1;
  }
}
