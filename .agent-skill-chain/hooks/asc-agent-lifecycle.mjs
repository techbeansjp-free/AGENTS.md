#!/usr/bin/env node
/** Opt-in Claude Code lifecycle guard. State is operational, never workflow authority. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const MODES = ["observe", "warn", "enforce"];
const EVENTS = new Set([
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "PreToolUse",
  "PostToolBatch",
  "PostToolUse",
  "PostToolUseFailure",
]);
const HANDOFF =
  "作業状態はGit / staging / trackerを正本とし、Issue・worktree・stagingのpointerから復旧できます。mainは継続・resume可能でfresh contextは推奨です。完了subagentの追加作業はfresh agentへ渡してください。workflow advanceのresumeはadvisoryです。必要なreview・検証を続けてください。";
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

function readState(file, snapshot = false) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024)
      throw new Error("lifecycle stateのfile境界が不正です");
    const source = fs.readFileSync(fd, "utf8");
    const state = JSON.parse(source);
    if (
      state.version !== 1 ||
      !validId(state.sessionId) ||
      !Array.isArray(state.agents) ||
      !(state.budgetMode === undefined || MODES.includes(state.budgetMode)) ||
      ![undefined, "compatible", "short-lived"].includes(
        state.executionContextMode,
      ) ||
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
        !["active", "paused", "closed", "exhausted"].includes(agent.status) ||
        (agent.status === "paused" && agent.kind !== "main") ||
        !natural(agent.tools) ||
        !natural(agent.starts) ||
        !natural(agent.deniedTools) ||
        !(agent.toolBatches === undefined || natural(agent.toolBatches)) ||
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
    state.executionContextMode ??= "compatible";
    return snapshot ? { state, recoveryDigest: digest(source) } : state;
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

// Pointer contracts constrain dispatch, not workflow approval. Every gate still reads
// repository state independently. No prompt, finding body, or tool result is stored.
const HANDOFF_KEYS = [
  "kind",
  "authority",
  "issue",
  "branch",
  "worktree",
  "staging",
  "headSha",
  "step",
  "role",
  "reviewSessionId",
  "reviewRound",
  "findingIds",
  "boundary",
  "resume",
];
const ROLES = {
  1: ["request"],
  2: ["requirements"],
  3: ["readiness-reviewer"],
  5: ["design"],
  6: ["planning"],
  7: ["readiness-reviewer"],
  9: ["implementation"],
  10: ["reviewer", "correction"],
};
const hashPattern = /^[a-f0-9]{64}$/u;
function repositoryGit(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  if (result.status !== 0) throw new Error("handoff Gitを観測できません");
  return result.stdout.trim();
}
function boundaryHash(staging, relative) {
  const file = path.join(staging, relative);
  try {
    if (fs.realpathSync(file) !== file) throw new Error("handoff symlink境界");
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024)
        throw new Error("handoff file境界");
      return digest(fs.readFileSync(fd));
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      // Dangling links are not absent records.
      if (fs.lstatSync(file, { throwIfNoEntry: false })) throw error;
      return null;
    }
    throw error;
  }
}
function parseHandoff(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > 16384)
    throw new Error("handoffは16KiB以下のpointer JSONが必要です");
  const h = JSON.parse(source);
  if (
    !h ||
    Object.keys(h).sort().join() !== [...HANDOFF_KEYS].sort().join() ||
    h.kind !== "asc-handoff/v1" ||
    h.authority !== "advisory" ||
    !ROLES[h.step]?.includes(h.role) ||
    ![h.worktree, h.staging, h.branch].every(validId) ||
    !/^[a-f0-9]{40,64}$/u.test(h.headSha) ||
    !(
      h.issue === null ||
      /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[1-9]\d*$/u.test(
        h.issue,
      )
    ) ||
    !(h.reviewSessionId === null || validId(h.reviewSessionId)) ||
    !(
      h.reviewRound === null ||
      (natural(h.reviewRound) && h.reviewRound > 0)
    ) ||
    !Array.isArray(h.findingIds) ||
    h.findingIds.length > 256 ||
    !h.findingIds.every(
      (id) => typeof id === "string" && /^[A-Z][A-Z0-9._-]{1,127}$/u.test(id),
    ) ||
    !h.boundary ||
    Object.keys(h.boundary).sort().join() !== "reviewSha256,stepsSha256" ||
    !hashPattern.test(h.boundary.stepsSha256) ||
    !(
      h.boundary.reviewSha256 === null ||
      hashPattern.test(h.boundary.reviewSha256)
    ) ||
    !h.resume ||
    Object.keys(h.resume).sort().join() !== "command,staging" ||
    h.resume.command !== "workflow advance" ||
    h.resume.staging !== h.staging
  )
    throw new Error("workflow advanceのhandoff JSONが必要です");
  return h;
}
// Natural-language tasks are lifecycle-managed, not ASC workflow evidence.
// Structured requests remain strict: a broken pointer must never fall back to a task.
function dispatchContract(prompt) {
  if (typeof prompt !== "string" || prompt.trim() === "")
    throw new Error("Agentには空でないpromptが必要です");
  if (/^\s*\{/u.test(prompt)) {
    let value;
    try {
      value = JSON.parse(prompt);
    } catch {
      if (/"(?:kind|handoff)"\s*:/u.test(prompt))
        throw new Error(
          "構造化promptが不正です。handoff JSONを再取得してください",
        );
    }
    if (value && Object.hasOwn(value, "handoff")) {
      if (
        Object.keys(value).sort().join() !== "handoff,prompt" ||
        typeof value.prompt !== "string" ||
        value.prompt.trim() === ""
      )
        throw new Error(
          "handoff envelopeにはhandoffと空でないpromptだけが必要です",
        );
      return { handoff: parseHandoff(JSON.stringify(value.handoff)) };
    }
    if (value && Object.hasOwn(value, "kind"))
      return { handoff: parseHandoff(prompt) };
  }
  return {
    task: {
      worktree: fs.realpathSync(process.env.CLAUDE_PROJECT_DIR),
    },
  };
}
function checkTask(task) {
  if (
    !task ||
    task.worktree !== fs.realpathSync(process.env.CLAUDE_PROJECT_DIR)
  )
    throw new Error(
      "taskの起動記録がありません。fresh agentへ再委譲してください",
    );
}
function checkHandoff(h, exactHead, acquireWriter = false) {
  const root = fs.realpathSync(process.env.CLAUDE_PROJECT_DIR);
  if (
    h.worktree !== root ||
    fs.realpathSync(h.staging) !== h.staging ||
    !h.staging.startsWith(root + path.sep) ||
    repositoryGit(root, ["rev-parse", "--show-toplevel"]) !== root ||
    repositoryGit(root, ["symbolic-ref", "--short", "HEAD"]) !== h.branch
  )
    throw new Error("handoff worktree/branch/staging不一致");
  if (exactHead && repositoryGit(root, ["rev-parse", "HEAD"]) !== h.headSha)
    throw new Error("handoff HEAD不一致");
  if (
    boundaryHash(h.staging, "journal/steps.jsonl") !== h.boundary.stepsSha256 ||
    boundaryHash(h.staging, "review-session.json") !== h.boundary.reviewSha256
  )
    throw new Error(
      "handoff境界が変更されました。状態を返却しfresh contextから再開してください",
    );
  if (
    (h.role === "reviewer" || (acquireWriter && workflowWriter(h, root))) &&
    repositoryGit(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      `:(top,exclude,literal)${path.relative(root, h.staging).split(path.sep).join("/")}`,
    ]) !== ""
  )
    throw new Error(
      "candidateに追跡または未追跡の未commit変更があります。変更を解消またはcommitし、handoffを再取得してください",
    );
}
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function verifyDispatch(h) {
  const cli = process.env.ASC_WORKFLOW_CLI;
  if (!cli || !path.isAbsolute(cli) || !fs.statSync(cli).isFile())
    throw new Error(
      "fresh dispatchには信頼済みASC_WORKFLOW_CLIの絶対path設定が必要です",
    );
  const result = spawnSync(
    process.execPath,
    [cli, "workflow", "advance", `--staging=${h.staging}`],
    {
      cwd: h.worktree,
      env: { ...process.env, ASC_EXECUTION_CONTEXT_MODE: "short-lived" },
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const preview = result.status === 0 ? JSON.parse(result.stdout) : null;
  if (
    !preview ||
    ![preview.handoff, ...(preview.handoffAlternatives ?? [])].some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(h),
    )
  )
    throw new Error(
      "handoffがrepositoryから再取得したworkflow advanceと一致しません",
    );
}
function reviewerCommands(h) {
  const cli = process.env.ASC_WORKFLOW_CLI;
  if (!cli || !path.isAbsolute(cli) || !fs.statSync(cli).isFile())
    throw new Error(
      "Reviewerの読取CLIにはASC_WORKFLOW_CLIの絶対path設定が必要です",
    );
  return {
    resume: `node ${shellQuote(cli)} workflow advance ${shellQuote("--staging=" + h.staging)}`,
    gitPrefix: `git -C ${shellQuote(h.worktree)} --no-pager `,
  };
}
function reviewerReadAllowed(h, input) {
  if (["Read", "Glob", "Grep"].includes(input.tool_name)) return true;
  if (input.tool_name !== "Bash") return false;
  const command = input.tool_input?.command;
  const allowed = reviewerCommands(h);
  if (command === allowed.resume) return true;
  if (typeof command !== "string" || !command.startsWith(allowed.gitPrefix))
    return false;
  const tail = command.slice(allowed.gitPrefix.length);
  // Literal commit IDs only; no shell syntax, pathspecs, external diff or textconv.
  return /^(?:diff --no-ext-diff --no-textconv '[a-f0-9]{40}(?:[a-f0-9]{24})?' '[a-f0-9]{40}(?:[a-f0-9]{24})?'|show --no-ext-diff --no-textconv '[a-f0-9]{40}(?:[a-f0-9]{24})?'|log --format=oneline -n 20 '[a-f0-9]{40}(?:[a-f0-9]{24})?') --$/u.test(
    tail,
  );
}

// Planning roles also write repository artifacts. Reviewer/coordinator do not.
function workflowWriter(handoff, worktree) {
  return (
    !!handoff &&
    handoff.worktree === worktree &&
    !["reviewer", "coordinator"].includes(handoff.role)
  );
}
function unfinishedWorker(agent) {
  return ["active", "exhausted"].includes(agent.status) && !agent.stoppedAt;
}
let peerStates = [];
const sessionStates = (state) => [state, ...peerStates];
function writerReservations(state, worktree) {
  return sessionStates(state).flatMap((session) => [
    ...(workflowWriter(session.pendingHandoff?.handoff, worktree)
      ? [
          {
            sessionId: session.sessionId,
            agentId: null,
            state: "pending",
            handoff: session.pendingHandoff.handoff,
          },
        ]
      : []),
    ...session.agents
      .filter(
        (agent) =>
          unfinishedWorker(agent) && workflowWriter(agent.handoff, worktree),
      )
      .map((agent) => ({
        sessionId: session.sessionId,
        agentId: agent.id,
        state: "active",
        handoff: agent.handoff,
      })),
  ]);
}
function workflowWriteReserved(state, worktree) {
  return writerReservations(state, worktree).length > 0;
}
const TASK_READ_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "SendMessage",
  "SubagentHandback",
]);

function executionGuard(state, agent, input, verifiedHandoff) {
  const worktree = fs.realpathSync(process.env.CLAUDE_PROJECT_DIR);
  const reservations = writerReservations(state, worktree);
  const owner = reservations.some(
    (reservation) =>
      reservation.sessionId === state.sessionId &&
      reservation.agentId === agent.id,
  );
  if (
    reservations.length &&
    !owner &&
    !TASK_READ_TOOLS.has(input.tool_name) &&
    !(agent.kind === "main" && ["Agent", "Task"].includes(input.tool_name))
  )
    return deny(
      "このworktreeはASC writerが占有しています。main・別sessionも読取と連絡のみ可能です。書込み・Bashはwriterの終了を待つか別worktreeを使用してください",
    );
  if (state.executionContextMode !== "short-lived") return undefined;
  const tool = input.tool_input ?? {};
  if (input.tool_name === "SubagentHandback") return {};
  if (agent.kind === "subagent") {
    try {
      if (agent.contextIsolation !== "fresh")
        throw new Error(
          "short-lived workerのcontext分離が未確認または継承です。fresh agentへ返却してください",
        );
      if (agent.dispatchScope === "task") {
        checkTask(agent.task);
        if (
          workflowWriteReserved(state, agent.task.worktree) &&
          !TASK_READ_TOOLS.has(input.tool_name)
        )
          return deny(
            "同一worktreeのASC writerが開始待ちまたは稼働中です。通常taskはRead / Glob / Grep / WebSearch / WebFetchと連絡・返却だけ実行できます。書込み・Bashは完了を待つか別worktreeを使用してください",
          );
      } else {
        const h = parseHandoff(JSON.stringify(agent.handoff));
        checkHandoff(h, h.role === "reviewer");
        if (h.role === "reviewer" && !reviewerReadAllowed(h, input))
          return deny(
            "ReviewerはRead / Glob / Grep、指定した読取CLI/Git commandと結果返却だけを実行できます",
          );
      }
    } catch (error) {
      return deny(error.message);
    }
  }
  if (
    ["Agent", "Task"].includes(input.tool_name) &&
    tool.resume === undefined
  ) {
    if (agent.kind !== "main")
      return deny("fresh dispatchはcoordinatorが行います");
    if (tool.subagent_type === "fork")
      return deny(
        "short-livedではmainのconversationを継承するforkを使用できません",
      );
    try {
      const contract = dispatchContract(tool.prompt);
      const h = contract.handoff;
      if (
        ((h || tool.subagent_type !== undefined) &&
          !validId(tool.subagent_type)) ||
        !validId(input.tool_use_id)
      )
        throw new Error("dispatch type/tool_use_idが必要です");
      if (
        (h && state.pendingHandoff) ||
        (!h &&
          state.pendingHandoff &&
          (tool.subagent_type === undefined ||
            state.pendingHandoff.agentType === tool.subagent_type)) ||
        (h &&
          state.pendingTasks?.some(
            (entry) =>
              entry.agentType === undefined ||
              entry.agentType === tool.subagent_type,
          ))
      )
        throw new Error(
          "同じtypeの通常taskとASC workerの開始を識別できません。先行dispatchの開始/完了観測を待つか、別typeを使用してください",
        );
      if (
        workflowWriter(h, h?.worktree) &&
        (workflowWriteReserved(state, h.worktree) ||
          sessionStates(state).some(
            (session) =>
              (session.inFlightWrites?.length ?? 0) > 0 ||
              (session.pendingDispatches?.length ?? 0) > 0 ||
              session.pendingTasks?.some(
                (entry) => entry.task?.worktree === h.worktree,
              ) ||
              session.agents.some(
                (entry) =>
                  entry.kind === "subagent" &&
                  !entry.handoff &&
                  unfinishedWorker(entry),
              ),
          ))
      )
        throw new Error(
          "同一worktreeにwriter・未終了task・実行中の書込みがあります。完了を待つか別worktreeを使用してください。event欠落は--reportでownerを確認してください",
        );
      if (h) {
        checkHandoff(h, true, true);
        if (verifiedHandoff !== JSON.stringify(h))
          throw new Error(
            verifiedHandoff?.error ??
              "handoffの事前検証がありません。fresh previewから再委譲してください",
          );
        if (h.role === "reviewer") reviewerCommands(h);
      }
      if (
        state.agents.some(
          (entry) =>
            entry.kind === "subagent" &&
            entry.status === "active" &&
            h &&
            entry.handoff?.staging === h.staging,
        )
      )
        throw new Error(
          "同じstagingのworker終了を待ってからfresh dispatchしてください",
        );
      const pending = {
        ...contract,
        agentType: tool.subagent_type,
        toolUseId: input.tool_use_id,
        parentId: agent.id,
      };
      if (h) state.pendingHandoff = pending;
      else {
        state.pendingTasks ??= [];
        if (
          state.pendingTasks.some(
            (entry) => entry.toolUseId === input.tool_use_id,
          )
        )
          throw new Error("重複したtask dispatch IDです");
        state.pendingTasks.push(pending);
      }
    } catch (error) {
      return deny(
        `${error.message} 通常の単発taskは自然言語で委譲できます。ASC工程担当はworkflow advance --staging=<path>のagentDispatchをAgent引数へ渡してください。旧形式ではhandoffをJSON.stringifyしてpromptへ渡してください。`,
      );
    }
  }
  if (input.tool_name === "SendMessage") {
    const recipient = state.agents.find(
      (entry) => entry.id === (tool.to ?? tool.recipient),
    );
    if (recipient?.dispatchScope === "task") {
      try {
        checkTask(recipient.task);
        return undefined;
      } catch (error) {
        return deny(error.message);
      }
    }
    // Communication may only repeat the assigned pointer contract. A new unit
    // always needs a new Agent call, even if the previous child is still active.
    try {
      const h = parseHandoff(tool.message ?? tool.content);
      if (
        !recipient?.handoff ||
        JSON.stringify(h) !== JSON.stringify(recipient.handoff)
      )
        throw new Error("active contextへ別work unitを追加できません");
      checkHandoff(h, true);
    } catch (error) {
      return deny(error.message);
    }
  }
  return undefined;
}

function transition(state, input, now, verifiedHandoff) {
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
      agent.resumeAttempts = (agent.resumeAttempts ?? 0) + 1;
      state.resumeAttempts += 1;
      // Start cannot block. PreToolUse below refuses the reused identity.
      agent.status = "closed";
      agent.reason = "identity-reused";
      agent.endedAt ??= now;
    } else {
      agent = newAgent(id, "subagent", now);
      agent.contextIsolation =
        input.agent_type === "fork"
          ? "inherited"
          : validId(input.agent_type)
            ? "fresh"
            : "unknown";
      state.agents.push(agent);
      if (
        state.executionContextMode === "short-lived" &&
        agent.contextIsolation === "inherited"
      ) {
        agent.status = "closed";
        agent.reason = "inherited-context";
        agent.endedAt = now;
        return context(
          event,
          "short-livedではforkを実行できません。作業せず返却してください。",
        );
      }
      if (state.executionContextMode === "short-lived") {
        // Task starts have no tool_use_id. Same-type task dispatches carry the
        // same lifecycle-only contract, so no per-prompt identity is claimed.
        const pending =
          state.pendingHandoff &&
          state.pendingHandoff.agentType === input.agent_type
            ? state.pendingHandoff
            : state.pendingTasks?.find(
                (entry) =>
                  entry.agentType === undefined ||
                  entry.agentType === input.agent_type,
              );
        if (pending && validId(input.agent_type)) {
          try {
            if (pending.task) checkTask(pending.task);
            else
              checkHandoff(
                parseHandoff(JSON.stringify(pending.handoff)),
                true,
                true,
              );
          } catch {
            state.pendingHandoff = null;
            return context(
              event,
              "ASC handoffがstaleです。実作業をせずcoordinatorへ返却してください。",
            );
          }
          agent.dispatchScope = pending.task ? "task" : "workflow";
          if (pending.task) agent.task = pending.task;
          else agent.handoff = pending.handoff;
          agent.parentId = pending.parentId;
          agent.generation = 1;
          agent.handoffFrom = pending.handoff
            ? (state.agents
                .filter(
                  (entry) =>
                    entry.kind === "subagent" &&
                    entry.id !== id &&
                    entry.handoff?.staging === pending.handoff.staging,
                )
                .at(-1)?.id ?? null)
            : null;
          if (pending.handoff) state.pendingHandoff = null;
        }
      }
    }
    return context(
      event,
      `ASC: one agent = one bounded work unit。${agent.dispatchScope === "task" ? "通常taskです。依頼された単位を完了して返却してください。ASCのStep/role/HEAD検証済みworkerではなく、結果はreview承認証跡になりません。実装後の是正・別Issueはfresh agentへ渡してください。" : ""}${agent.handoff ? "担当pointer: " + JSON.stringify(agent.handoff) + "。repositoryからresumeを再取得し担当だけを実施。検証・commit・返却後に終了し、Step/round記録はcoordinatorが行う。" : ""}tool目安${state.maxTools}、budget mode=${state.budgetMode}。${HANDOFF}${agent.handoff?.role === "reviewer" ? " 読取command: " + JSON.stringify(reviewerCommands(agent.handoff)) + "。Gitはdiff --no-ext-diff --no-textconv '<baseSHA>' '<headSHA>' -- / show --no-ext-diff --no-textconv '<SHA>' -- / log --format=oneline -n 20 '<SHA>' --だけをgitPrefixへ続けて実行可能。" : ""}`,
    );
  }
  if (event === "SessionStart") {
    const main = state.agents.find((entry) => entry.kind === "main");
    if (input.source === "resume") {
      main.starts += 1;
      main.resumeAttempts = (main.resumeAttempts ?? 0) + 1;
      state.resumeAttempts += 1;
      // Also accepts main records closed/exhausted by earlier hook versions.
      main.status = "active";
      main.endedAt = null;
      main.reason = null;
      main.lastSeenAt = now;
    }
    return context(
      event,
      `ASC lifecycle: ${main.status}, tools=${main.tools}/${state.maxTools}。compactやsession再開で計測はリセットしません。長寿命sessionではfresh contextも利用できます。${HANDOFF}${state.executionContextMode === "short-lived" ? " 通常の単発taskは自然言語でfresh Agentへ委譲できます。ASCの工程担当はworkflow advance --staging=<path>のagentDispatchをAgent引数へそのまま渡してください（handoff JSONの手組みは不要。旧形式ではhandoffをJSON.stringifyしてpromptへ渡します）。工程担当を通常taskへ格下げせず、起動拒否時もmainが実装・是正を代行しないでください。拒否理由を修正して再委譲し、復旧不能なら理由を利用者へ返してください。" : ""}`,
    );
  }
  if (["PostToolUse", "PostToolUseFailure"].includes(event)) {
    if (state.pendingHandoff?.toolUseId === input.tool_use_id)
      state.pendingHandoff = null;
    if (state.pendingTasks)
      state.pendingTasks = state.pendingTasks.filter(
        (entry) => entry.toolUseId !== input.tool_use_id,
      );
    return {};
  }
  if (event === "PostToolBatch") {
    if (agent) {
      agent.toolBatches = (agent.toolBatches ?? 0) + 1;
      agent.lastSeenAt = now;
    }
    return {};
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
      if (entry.kind === "subagent") entry.stoppedAt = now;
      entry.status =
        entry.kind === "main"
          ? "paused"
          : entry.status === "exhausted"
            ? "exhausted"
            : "closed";
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
  const guarded = executionGuard(state, agent, input, verifiedHandoff);
  if (guarded !== undefined) return guarded;
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

function acquireWorktreeLock(root) {
  const lock = path.join(root, "worktree.lock");
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
    fs.writeFileSync(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    try {
      fs.rmSync(lock, { recursive: true, force: true });
    } catch {
      // Preserve the acquisition failure if cleanup also fails.
    }
    throw error;
  }
  return lock;
}
function recoverSession() {
  const flag = (name) =>
    process.argv
      .find((arg) => arg.startsWith(name + "="))
      ?.slice(name.length + 1);
  const sessionId = flag("--recover-session");
  const expected = flag("--expected-digest");
  if (
    !validId(sessionId) ||
    !/^[a-f0-9]{64}$/u.test(expected ?? "") ||
    !process.argv.includes("--owner-stopped")
  )
    throw new Error(
      "owner停止の明示確認とsession ID・reportのdigestが必要です",
    );
  const root = stateRoot();
  const lock = acquireWorktreeLock(root);
  try {
    const file = path.join(root, `${digest(sessionId)}.json`);
    const state = readState(file);
    if (
      state.sessionId !== sessionId ||
      digest(fs.readFileSync(file)) !== expected
    )
      throw new Error("復旧対象がreport後に変わりました。再確認してください");
    const now = new Date().toISOString();
    for (const agent of state.agents) {
      agent.status = "closed";
      agent.stoppedAt = now;
      agent.endedAt ??= now;
      agent.reason = "explicit-owner-stopped-recovery";
    }
    state.pendingHandoff = null;
    state.pendingTasks = [];
    state.pendingDispatches = [];
    state.inFlightWrites = [];
    state.recoveredAt = now;
    const temporary = path.join(lock, "state.json");
    fs.writeFileSync(temporary, JSON.stringify(state) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    return {
      recovered: true,
      sessionId,
      previousDigest: expected,
      next: "旧sessionは再開せず新sessionを使用してください",
    };
  } finally {
    fs.rmSync(lock, { recursive: true });
  }
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
  const file = path.join(root, `${key}.json`);
  let verifiedHandoff;
  // The trusted CLI can be slow. Never hold the session lock while it runs:
  // unrelated tasks must still be able to start, report tools and finish.
  if (
    event === "PreToolUse" &&
    ["Agent", "Task"].includes(input.tool_name) &&
    input.tool_input?.resume === undefined &&
    (!input.agent_id || input.agent_id === input.session_id)
  ) {
    const snapshot = readState(file);
    if (snapshot.executionContextMode === "short-lived") {
      try {
        const { handoff } = dispatchContract(input.tool_input?.prompt);
        if (handoff) {
          checkHandoff(handoff, true, true);
          verifyDispatch(handoff);
          verifiedHandoff = JSON.stringify(handoff);
        }
      } catch (error) {
        verifiedHandoff = { error: error.message };
      }
    }
  }
  const lock = acquireWorktreeLock(root);
  try {
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
      const executionContextMode =
        process.env.ASC_EXECUTION_CONTEXT_MODE ?? "compatible";
      if (!["compatible", "short-lived"].includes(executionContextMode))
        throw new Error(
          "ASC_EXECUTION_CONTEXT_MODEはcompatible / short-livedです",
          { cause: error },
        );
      state = {
        version: 1,
        executionContextMode,
        budgetMode,
        sessionId: input.session_id,
        maxTools,
        resumeAttempts: 0,
        dispatchAttempts: 0,
        deniedDispatches: 0,
        agents: [newAgent(input.session_id, "main", new Date().toISOString())],
      };
    }
    if (state.recoveredAt)
      throw new Error("明示復旧で閉鎖済みのsessionです。新sessionが必要です");
    if (state.sessionId !== input.session_id)
      throw new Error("session identityが一致しません");
    peerStates = fs
      .readdirSync(root)
      .filter(
        (name) => /^[a-f0-9]{64}\.json$/u.test(name) && name !== `${key}.json`,
      )
      .map((name) => readState(path.join(root, name)));
    const result = transition(
      state,
      input,
      new Date().toISOString(),
      verifiedHandoff,
    );
    const actorId = input.agent_id ?? state.sessionId;
    const actor = state.agents.find((entry) => entry.id === actorId);
    if (
      event === "PreToolUse" &&
      actor?.kind === "main" &&
      result.hookSpecificOutput?.permissionDecision !== "deny" &&
      result.continue !== false
    ) {
      const id = input.tool_use_id ?? `unobserved:${actorId}`;
      if (["Agent", "Task"].includes(input.tool_name)) {
        if (!state.pendingHandoff) {
          state.pendingDispatches ??= [];
          if (!state.pendingDispatches.includes(id))
            state.pendingDispatches.push(id);
        }
      } else if (!TASK_READ_TOOLS.has(input.tool_name)) {
        state.inFlightWrites ??= [];
        if (!state.inFlightWrites.includes(id)) state.inFlightWrites.push(id);
      }
    }
    if (["PostToolUse", "PostToolUseFailure"].includes(event)) {
      for (const field of ["inFlightWrites", "pendingDispatches"])
        if (state[field])
          state[field] = state[field].filter((id) => id !== input.tool_use_id);
    }
    if (event === "SessionEnd") {
      state.inFlightWrites = [];
      state.pendingDispatches = [];
      state.pendingTasks = [];
      state.pendingHandoff = null;
    }
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
      const { state, recoveryDigest } = readState(path.join(root, name), true);
      return {
        ...state,
        worktreeLock: fs.existsSync(path.join(root, "worktree.lock"))
          ? {
              path: path.join(root, "worktree.lock"),
              next: "owner.jsonのPIDと全host停止を確認するまで削除しない。TTL解除なし",
            }
          : null,
        recoveryDigest,
        writerReservations: writerReservations(
          state,
          fs.realpathSync(process.env.CLAUDE_PROJECT_DIR),
        ),
        recovery:
          "TTLでは解除しません。owner sessionと子processの終了を確認し、--recover-session=<sessionId> --expected-digest=<recoveryDigest> --owner-stoppedで明示復旧してください",
        agents: state.agents.map((agent) => ({
          ...agent,
          parent: agent.parentId ?? null,
          generation: agent.kind === "main" ? 0 : (agent.generation ?? null),
          contextIsolation: agent.contextIsolation ?? "unknown",
          dispatchScope:
            agent.kind === "main"
              ? "coordinator"
              : agent.handoff
                ? "workflow"
                : (agent.dispatchScope ?? "unbound"),
          role: agent.handoff?.role ?? null,
          workflowStep: agent.handoff?.step ?? null,
          reviewSessionId: agent.handoff?.reviewSessionId ?? null,
          reviewRound: agent.handoff?.reviewRound ?? null,
          modelCycleProxy: agent.toolBatches ?? null,
          modelCycleProxyKind:
            agent.toolBatches === undefined ? null : "PostToolBatch",
          freshHandoffTo:
            state.agents.find((next) => next.handoffFrom === agent.id)?.id ??
            null,
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
  if (process.argv.some((arg) => arg.startsWith("--recover-session=")))
    process.stdout.write(`${JSON.stringify(recoverSession())}\n`);
  else if (process.argv.includes("--report"))
    process.stdout.write(`${JSON.stringify(report(), null, 2)}\n`);
  else {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(run(input))}\n`);
  }
} catch (error) {
  const reason = `ASC lifecycle記録を確認できません（${error.code ?? "invalid-state"}）。hook設定・--report・実行中processを確認してください。残存予約はowner停止確認と明示復旧が必要で、新sessionだけでは解除されません。`;
  if (input?.hook_event_name === "PreToolUse")
    process.stdout.write(`${JSON.stringify(deny(reason, true))}\n`);
  else {
    process.stderr.write(`${reason}\n`);
    // Nonblocking on Stop: exit 2 would keep the old agent alive.
    process.exitCode = 1;
  }
}
