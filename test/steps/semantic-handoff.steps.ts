import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import type { observeWorkflowHandoff } from "../../src/adapters/workflow-handoff.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import { WORKFLOW_STEPS } from "../../src/domain/workflow.js";
import {
  advanceReviewSession,
  type ReviewSessionState,
  type ReviewRoundInput,
} from "../../src/domain/review-convergence.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();
Given("semantic handoff検査用の隔離環境を用意する", function () {
  this.value = false;
});
Then("semantic handoffの正常系と拒否系が成立する", function () {
  assert.equal(this.value, true);
});
const hook = path.resolve(".agent-skill-chain/hooks/asc-agent-lifecycle.mjs");
When(
  "fresh contextで実装と複数review roundを完走し反例を拒否する",
  async function () {
    const root = this.initRepo();
    const staging = createIssueStaging(root, {
      title: "semantic-handoff",
      now: new Date("2026-10-01T00:00:00Z"),
      requestedMode: "full",
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
      ),
    }).path;
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    fs.writeFileSync(
      path.join(root, ".gitignore"),
      ".agent-skill-chain/runtime/\n",
    );
    git("add", ".gitignore");
    git("commit", "-qm", "ignore fixture state");
    const call = (
      name: string,
      extra: Record<string, unknown> = {},
      environment: Record<string, string> = {},
    ) => {
      const result = spawnSync(process.execPath, [hook], {
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: root,
          ASC_EXECUTION_CONTEXT_MODE: "short-lived",
          ASC_WORKFLOW_CLI: path.resolve("dist/bin/agent-skill-chain.js"),
          ASC_AGENT_BUDGET_MODE: "warn",
          ...environment,
        },
        input: JSON.stringify({
          session_id: "semantic-session",
          hook_event_name: name,
          ...extra,
        }),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    const allowed = (result: string) =>
      assert.doesNotMatch(result, /"deny"|"continue":false/u);
    const denied = (result: string) => assert.match(result, /"deny"/u);
    const dispatchPrompts = new Map<string, string>();
    const pointer = (
      step: number,
      targetStaging = staging,
      rereview = false,
    ) => {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve("dist/bin/agent-skill-chain.js"),
          "workflow",
          "advance",
          `--staging=${targetStaging}`,
        ],
        {
          cwd: root,
          env: { ...process.env, ASC_EXECUTION_CONTEXT_MODE: "short-lived" },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const preview = JSON.parse(result.stdout) as {
        handoff: ReturnType<typeof observeWorkflowHandoff>;
        handoffAlternatives?: ReturnType<typeof observeWorkflowHandoff>[];
        agentDispatch?: { subagent_type: string; prompt: string };
        agentDispatchAlternatives?: { subagent_type: string; prompt: string }[];
      };
      const h = rereview ? preview.handoffAlternatives?.[0] : preview.handoff;
      assert.ok(h && "kind" in h, JSON.stringify(h));
      assert.equal(h.step, step);
      const args = rereview
        ? preview.agentDispatchAlternatives?.[0]
        : preview.agentDispatch;
      if (h.role === "coordinator") assert.equal(args, undefined);
      else {
        assert.equal(args?.subagent_type, "general-purpose");
        const envelope = JSON.parse(args!.prompt) as {
          handoff: unknown;
          prompt: string;
        };
        assert.deepEqual(envelope.handoff, h);
        assert.match(envelope.prompt, /Step skill/u);
        dispatchPrompts.set(JSON.stringify(h), args!.prompt);
      }
      return h;
    };
    const recordStep = (step: number) =>
      appendWorkflowJournalEntry({
        staging,
        entry: {
          step,
          skillId: WORKFLOW_STEPS.find((item) => item.step === step)!.skillId,
          mode: "full",
          recordedAt: "2026-10-01T00:00:00.000Z",
          artifacts: [`fixture-${step}`],
          evidence: "fixture completed",
          ...(step === 9
            ? { implementationHeadSha: git("rev-parse", "HEAD") }
            : {}),
        },
        ...(step === 9 ? { headSha: git("rev-parse", "HEAD") } : {}),
      });
    const dispatch = (h: unknown, id: string, agentType = "general-purpose") =>
      call("PreToolUse", {
        tool_name: "Agent",
        tool_use_id: id,
        tool_input: {
          subagent_type: agentType,
          prompt: dispatchPrompts.get(JSON.stringify(h)) ?? JSON.stringify(h),
        },
      });
    const start = (id: string) =>
      allowed(
        call("SubagentStart", { agent_id: id, agent_type: "general-purpose" }),
      );
    const stop = (id: string) =>
      allowed(call("SubagentStop", { agent_id: id }));
    const tool = (id: string, name = "Read") =>
      call("PreToolUse", { agent_id: id, tool_name: name, tool_input: {} });
    const startup = call("SessionStart", { source: "startup" });
    allowed(startup);
    assert.match(startup, /mainが実装・是正を代行しない/u);
    const plain = (
      id: string,
      prompt = "ok とだけ返す SECRET-task",
      agentType = "general-purpose",
    ) =>
      call("PreToolUse", {
        tool_name: "Agent",
        tool_use_id: id,
        tool_input: { subagent_type: agentType, prompt },
      });
    const assertWriterIsolation = (id: string) => {
      allowed(plain(`dispatch-${id}`, "並行調査", "Explore"));
      allowed(call("SubagentStart", { agent_id: id, agent_type: "Explore" }));
      allowed(tool(id, "Read"));
      denied(tool(id, "Write"));
      denied(tool(id, "Bash"));
      stop(id);
      allowed(call("PostToolUse", { tool_use_id: `dispatch-${id}` }));
    };
    denied(plain("plain-fork", "ok", "fork"));
    const broken = plain("broken-pointer", '{"kind":"asc-handoff/v1"');
    denied(broken);
    assert.doesNotMatch(broken, /Unexpected token/u);
    assert.match(broken, /workflow advance --staging=<path>/u);
    assert.match(broken, /JSON.stringify/u);
    allowed(
      call("PreToolUse", {
        tool_name: "Agent",
        tool_use_id: "omitted-type",
        tool_input: { prompt: "何も調べず「ok」とだけ返してください。" },
      }),
    );
    denied(dispatch(pointer(1), "ambiguous-omitted-type"));
    allowed(
      call("SubagentStart", {
        agent_id: "default-task",
        agent_type: "Explore",
      }),
    );
    allowed(tool("default-task"));
    stop("default-task");
    allowed(call("PostToolUse", { tool_use_id: "omitted-type" }));
    denied(plain("empty", ""));
    allowed(plain("markdown-prompt", "[#377] 調査してください"));
    start("markdown-task");
    allowed(tool("markdown-task"));
    stop("markdown-task");
    allowed(call("PostToolUse", { tool_use_id: "markdown-prompt" }));
    allowed(plain("plain-one"));
    allowed(plain("plain-two", "別Issueを調査する SECRET-two"));
    const request = pointer(1);
    denied(dispatch(request, "ambiguous-workflow"));
    start("task-two");
    start("task-one");
    allowed(tool("task-one", "Edit"));
    allowed(tool("task-two", "Bash"));
    allowed(
      call("PreToolUse", {
        tool_name: "SendMessage",
        tool_input: {
          to: "task-one",
          message: "進捗を返してください SECRET-message",
        },
      }),
    );
    stop("task-one");
    denied(tool("task-one", "Edit"));
    denied(
      call("PreToolUse", {
        tool_name: "SendMessage",
        tool_input: { to: "task-one", message: "次のIssueを実装" },
      }),
    );
    start("task-one");
    denied(tool("task-one"));
    stop("task-two");
    allowed(call("PostToolUse", { tool_use_id: "plain-one" }));
    allowed(call("PostToolUse", { tool_use_id: "plain-two" }));
    allowed(plain("plain-failure"));
    allowed(call("PostToolUseFailure", { tool_use_id: "plain-failure" }));
    // A slow trusted CLI must not hold the lock and reject unrelated hook calls.
    const slowCli = path.join(root, ".agent-skill-chain/runtime/slow-cli.mjs");
    const ready = `${slowCli}.ready`;
    const release = `${slowCli}.release`;
    fs.writeFileSync(
      slowCli,
      `
      import fs from 'node:fs';
      import { spawnSync } from 'node:child_process';
      fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
      for (let attempt = 0; attempt < 1000 && !fs.existsSync(${JSON.stringify(release)}); attempt += 1)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      const result = spawnSync(process.execPath, [${JSON.stringify(path.resolve("dist/bin/agent-skill-chain.js"))}, ...process.argv.slice(2)], { encoding: 'utf8' });
      process.stdout.write(result.stdout);
      process.exit(result.status ?? 1);
    `,
    );
    const slow = spawn(process.execPath, [hook], {
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        ASC_EXECUTION_CONTEXT_MODE: "short-lived",
        ASC_WORKFLOW_CLI: slowCli,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let slowOutput = "";
    slow.stdout.on("data", (chunk: Buffer) => {
      slowOutput += chunk.toString();
    });
    const slowDone = new Promise<number | null>((resolve, reject) => {
      slow.once("error", reject);
      slow.once("close", resolve);
    });
    slow.stdin.end(
      JSON.stringify({
        session_id: "semantic-session",
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_use_id: "slow-dispatch",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: JSON.stringify(request),
        },
      }),
    );
    try {
      for (
        let attempt = 0;
        attempt < 1000 && !fs.existsSync(ready);
        attempt += 1
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(fs.existsSync(ready));
      allowed(plain("during-cli", "並行調査", "Explore"));
      allowed(
        call("SubagentStart", {
          agent_id: "during-cli-agent",
          agent_type: "Explore",
        }),
      );
      allowed(tool("during-cli-agent"));
      stop("during-cli-agent");
      allowed(call("PostToolUse", { tool_use_id: "during-cli" }));
    } finally {
      fs.writeFileSync(release, "release");
      assert.equal(await slowDone, 0);
    }
    allowed(slowOutput);
    allowed(call("PostToolUseFailure", { tool_use_id: "slow-dispatch" }));

    allowed(plain("writer-blocking-task", "調査", "Explore"));
    denied(dispatch(request, "pending-task-blocks-writer"));
    allowed(
      call("SubagentStart", {
        agent_id: "writer-blocking-agent",
        agent_type: "Explore",
      }),
    );
    allowed(call("PostToolUse", { tool_use_id: "writer-blocking-task" }));
    const activeTaskDenial = dispatch(request, "active-task-blocks-writer");
    denied(activeTaskDenial);
    assert.match(activeTaskDenial, /完了を待つか別worktree/u);
    stop("writer-blocking-agent");

    const peer = (event: string, input: Record<string, unknown> = {}) =>
      call(
        event,
        { ...input, session_id: "peer-session" },
        { ASC_EXECUTION_CONTEXT_MODE: "compatible" },
      );
    allowed(peer("SessionStart", { source: "startup" }));
    allowed(
      peer("PreToolUse", {
        tool_name: "Bash",
        tool_use_id: "peer-shell",
        tool_input: { command: "true" },
      }),
    );
    denied(dispatch(request, "peer-shell-blocks-writer"));
    allowed(peer("PostToolUse", { tool_use_id: "peer-shell" }));
    allowed(
      peer("PreToolUse", {
        tool_name: "Agent",
        tool_use_id: "peer-agent",
        tool_input: { prompt: "調査" },
      }),
    );
    denied(dispatch(request, "peer-pending-blocks-writer"));
    allowed(
      peer("SubagentStart", { agent_id: "peer-child", agent_type: "Explore" }),
    );
    allowed(peer("PostToolUse", { tool_use_id: "peer-agent" }));
    denied(dispatch(request, "peer-active-blocks-writer"));
    allowed(peer("SubagentStop", { agent_id: "peer-child" }));

    const exhausted = (event: string, input: Record<string, unknown> = {}) =>
      call(
        event,
        { ...input, session_id: "exhaustion-isolation" },
        {
          ASC_AGENT_BUDGET_MODE: "enforce",
          ASC_AGENT_MAX_TOOLS: "10",
        },
      );
    const exhaustedDispatch = () =>
      exhausted("PreToolUse", {
        tool_name: "Agent",
        tool_use_id: "exhaustion-workflow",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: JSON.stringify(request),
        },
      });
    allowed(exhausted("SessionStart", { source: "startup" }));
    allowed(
      exhausted("PreToolUse", {
        tool_name: "Agent",
        tool_use_id: "exhaustion-task",
        tool_input: { subagent_type: "Explore", prompt: "調査" },
      }),
    );
    allowed(
      exhausted("SubagentStart", {
        agent_id: "exhausted-task",
        agent_type: "Explore",
      }),
    );
    allowed(exhausted("PostToolUse", { tool_use_id: "exhaustion-task" }));
    for (let attempt = 0; attempt < 11; attempt += 1)
      exhausted("PreToolUse", {
        agent_id: "exhausted-task",
        tool_name: "Read",
      });
    denied(exhaustedDispatch());
    allowed(exhausted("SubagentStop", { agent_id: "exhausted-task" }));
    allowed(exhaustedDispatch());
    allowed(
      exhausted("SubagentStart", {
        agent_id: "exhausted-writer",
        agent_type: "general-purpose",
      }),
    );
    for (let attempt = 0; attempt < 11; attempt += 1)
      exhausted("PreToolUse", {
        agent_id: "exhausted-writer",
        tool_name: "Read",
      });
    allowed(
      exhausted("PreToolUse", {
        tool_name: "Agent",
        tool_use_id: "after-writer",
        tool_input: { subagent_type: "Explore", prompt: "調査" },
      }),
    );
    allowed(
      exhausted("SubagentStart", {
        agent_id: "after-writer",
        agent_type: "Explore",
      }),
    );
    denied(
      exhausted("PreToolUse", { agent_id: "after-writer", tool_name: "Edit" }),
    );
    allowed(exhausted("SubagentStop", { agent_id: "exhausted-writer" }));
    allowed(
      exhausted("PreToolUse", { agent_id: "after-writer", tool_name: "Edit" }),
    );
    allowed(exhausted("SessionEnd"));

    denied(dispatch(request, "fork-dispatch", "fork"));
    allowed(
      call("SubagentStart", {
        agent_id: "unexpected-fork",
        agent_type: "fork",
      }),
    );
    denied(tool("unexpected-fork"));
    allowed(
      dispatch(
        { handoff: request, prompt: "担当Stepを実施 SECRET-envelope" },
        "dispatch-request",
      ),
    );
    denied(plain("ambiguous-task"));
    allowed(plain("parallel-explore", "並行調査 SECRET-explore", "Explore"));
    allowed(
      call("SubagentStart", { agent_id: "explore", agent_type: "Explore" }),
    );
    allowed(tool("explore"));
    denied(tool("explore", "Bash")); // Pending writer already reserves the boundary.
    start("request");
    for (const name of ["Read", "Glob", "Grep", "WebSearch", "WebFetch"])
      allowed(tool("explore", name));
    for (const name of [
      "Edit",
      "Write",
      "NotebookEdit",
      "Bash",
      "mcp__filesystem__write_file",
    ])
      denied(tool("explore", name));
    for (const tool_name of [
      "Edit",
      "Write",
      "Bash",
      "mcp__filesystem__write_file",
    ]) {
      denied(
        call("PreToolUse", { tool_name, tool_use_id: `main-${tool_name}` }),
      );
      denied(
        peer("PreToolUse", { tool_name, tool_use_id: `peer-${tool_name}` }),
      );
    }
    allowed(peer("PreToolUse", { tool_name: "Read" }));
    allowed(call("PreToolUse", { tool_name: "Read" }));
    denied(
      call("PreToolUse", { session_id: "second-writer", tool_name: "Edit" }),
    );
    allowed(tool("request", "Edit"));
    allowed(tool("request"));
    denied(
      dispatch(
        { ...request, step: 2, role: "requirements" },
        "forged-next-unit",
      ),
    );
    denied(
      call("PreToolUse", {
        tool_name: "SendMessage",
        tool_input: {
          to: "request",
          message: JSON.stringify({
            ...request,
            step: 2,
            role: "requirements",
          }),
        },
      }),
    );
    const journal = path.join(staging, "journal/steps.jsonl");
    const original = fs.readFileSync(journal, "utf8");
    fs.appendFileSync(journal, "\n");
    const stale = tool("request");
    denied(stale);
    assert.doesNotMatch(stale, /"continue":false/u);
    allowed(tool("request", "SubagentHandback"));
    stop("request");
    allowed(tool("explore", "Bash"));
    allowed(tool("explore", "Edit"));
    stop("explore");
    allowed(call("PostToolUse", { tool_use_id: "parallel-explore" }));
    fs.writeFileSync(journal, original);
    allowed(
      peer("PreToolUse", {
        tool_name: "Bash",
        tool_use_id: "stale-peer-write",
      }),
    );
    denied(dispatch(request, "stale-peer-blocks-writer"));
    const peerReport = spawnSync(process.execPath, [hook, "--report"], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      encoding: "utf8",
    });
    const recoverable = (
      JSON.parse(peerReport.stdout) as {
        sessionId: string;
        recoveryDigest: string;
      }[]
    ).find((entry) => entry.sessionId === "peer-session")!;
    const recover = (expected: string, confirmed: boolean) =>
      spawnSync(
        process.execPath,
        [
          hook,
          "--recover-session=peer-session",
          `--expected-digest=${expected}`,
          ...(confirmed ? ["--owner-stopped"] : []),
        ],
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: "utf8" },
      );
    assert.notEqual(recover(recoverable.recoveryDigest, false).status, 0);
    assert.notEqual(recover("f".repeat(64), true).status, 0);
    assert.equal(recover(recoverable.recoveryDigest, true).status, 0);
    denied(peer("PreToolUse", { tool_name: "Edit" }));
    recordStep(1);
    allowed(dispatch(pointer(2), "dispatch-requirements"));
    start("requirements");
    allowed(tool("requirements"));
    stop("requirements");
    for (const step of [2, 3, 4, 5, 6, 7, 8]) recordStep(step);
    const impl = pointer(9);
    allowed(dispatch(impl, "dispatch-impl"));
    start("impl");
    assertWriterIsolation("during-implementation");
    allowed(tool("impl", "Bash"));
    stop("impl");
    recordStep(9);
    denied(tool("impl"));
    denied(
      call("PreToolUse", {
        tool_name: "Agent",
        tool_input: { resume: "impl" },
      }),
    );
    let session: ReviewSessionState | null = null;
    const anchor = {
      scopeIds: ["SCOPE-TEST"],
      acceptanceCriteriaIds: ["AC-TEST"],
      invariantIds: [],
      diffBaseSha: git("rev-parse", "HEAD"),
      initialHeadSha: git("rev-parse", "HEAD"),
      initialDiffDigest: "a".repeat(64),
    };
    for (let round = 1; round <= 3; round += 1) {
      const h = pointer(10);
      assert.equal(h.role, "reviewer");
      assert.equal(h.reviewRound, round);
      const ghost = path.join(root, "ghost-fix.ts");
      fs.writeFileSync(ghost, "export const fixed = true;\n");
      denied(dispatch(h, `untracked-r${round}`));
      fs.unlinkSync(ghost);
      allowed(dispatch(h, `dispatch-r${round}`));
      start(`r${round}`);
      fs.writeFileSync(ghost, "export const fixed = true;\n");
      denied(tool(`r${round}`));
      fs.unlinkSync(ghost);
      allowed(tool(`r${round}`));
      allowed(
        call("PreToolUse", {
          agent_id: `r${round}`,
          tool_name: "Bash",
          tool_input: {
            command: `node '${path.resolve("dist/bin/agent-skill-chain.js")}' workflow advance '--staging=${staging}'`,
          },
        }),
      );
      allowed(
        call("PreToolUse", {
          agent_id: `r${round}`,
          tool_name: "Bash",
          tool_input: {
            command: `git -C '${root}' --no-pager show --no-ext-diff --no-textconv '${h.headSha}' --`,
          },
        }),
      );
      denied(
        call("PreToolUse", {
          agent_id: `r${round}`,
          tool_name: "Bash",
          tool_input: {
            command: `git -C '${root}' --no-pager show --no-ext-diff --no-textconv '${h.headSha}' --; touch attack`,
          },
        }),
      );
      denied(tool(`r${round}`, "Write"));
      denied(tool(`r${round}`, "Bash"));
      allowed(
        call("PostToolBatch", {
          agent_id: `r${round}`,
          tool_calls: [{ tool_response: "SECRET-BODY" }],
        }),
      );
      stop(`r${round}`);
      session = advanceReviewSession(session, {
        round,
        previousRoundDigest: session?.latestRoundDigest ?? null,
        anchor,
        candidateHeadSha: git("rev-parse", "HEAD"),
        focus: {
          previousBlocking: round === 1 ? [] : ["F-001"],
          fixedDiff: round === 1 ? [] : ["code.txt"],
          adjacentScope: [],
        },
        findings: [
          {
            id: "F-001",
            severity: "High",
            status: "valid",
            source: "review",
            relation: "acceptance-violation",
            evidence: "fixture",
            path: "code.txt",
            contractId: "AC-TEST",
            causedByFindingId: null,
          },
        ],
      });
      fs.writeFileSync(
        path.join(staging, "review-session.json"),
        JSON.stringify(session),
      );
      if (round === 3) break;
      const correction = pointer(10);
      assert.equal(correction.role, "correction");
      assert.equal(correction.reviewSessionId, session.sessionId);
      assert.deepEqual(correction.findingIds, ["F-001"]);
      denied(
        call("PreToolUse", {
          tool_name: "SendMessage",
          tool_input: { to: "impl", message: JSON.stringify(correction) },
        }),
      );
      allowed(dispatch(correction, `dispatch-c${round}`));
      start(`c${round}`);
      assertWriterIsolation(`during-correction-${round}`);
      allowed(tool(`c${round}`, "Bash"));
      fs.writeFileSync(path.join(root, "code.txt"), `fix ${round}\n`);
      git("add", "code.txt");
      git("commit", "-qm", `fix ${round}`);
      allowed(tool(`c${round}`));
      stop(`c${round}`);
      recordStep(9);
    }
    assert.equal(session?.status, "active");
    const unchangedCorrection = pointer(10);
    allowed(dispatch(unchangedCorrection, "dispatch-unchanged"));
    start("unchanged");
    const rereview = pointer(10, staging, true);
    assert.equal(rereview.role, "reviewer");
    assert.equal(rereview.reviewRound, 4);
    assert.equal(rereview.headSha, unchangedCorrection.headSha);
    denied(dispatch(rereview, "premature-rereview"));
    stop("unchanged");
    allowed(dispatch(rereview, "dispatch-r4"));
    start("r4");
    allowed(tool("r4"));
    denied(tool("r4", "Write"));
    stop("r4");
    const roundFile = path.join(this.temp("asc-same-head-"), "round.json");
    const reviewCli = (mode: string, ...args: string[]) => {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve("dist/bin/agent-skill-chain.js"),
          "review",
          "round",
          ...args,
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, ASC_EXECUTION_CONTEXT_MODE: mode },
        },
      );
      if (mode === "compatible") {
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /実Git差分が空/u);
        assert.equal(fs.existsSync(roundFile), false);
      } else assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    reviewCli(
      "compatible",
      "--init",
      `--staging=${staging}`,
      `--head=${rereview.headSha}`,
      `--out=${roundFile}`,
    );
    reviewCli(
      "short-lived",
      "--init",
      `--staging=${staging}`,
      `--head=${rereview.headSha}`,
      `--out=${roundFile}`,
    );
    const draft = JSON.parse(
      fs.readFileSync(roundFile, "utf8"),
    ) as ReviewRoundInput;
    assert.equal(draft.round, 4);
    assert.deepEqual(draft.focus.fixedDiff, []);
    assert.deepEqual(draft.focus.previousBlocking, ["F-001"]);
    assert.equal(draft.candidateHeadSha, unchangedCorrection.headSha);
    fs.writeFileSync(
      roundFile,
      JSON.stringify({
        ...draft,
        findings: draft.findings.map((finding) => ({
          ...finding,
          status: "false-positive",
          evidence:
            "Independent reviewer confirmed existing code meets AC-TEST",
        })),
      }),
    );
    reviewCli(
      "short-lived",
      `--staging=${staging}`,
      `--file=${roundFile}`,
      "--apply",
    );
    session = JSON.parse(
      fs.readFileSync(path.join(staging, "review-session.json"), "utf8"),
    ) as ReviewSessionState;
    assert.equal(session.status, "converged");
    assert.equal(session.rounds.length, 4);
    assert.equal(pointer(10).role, "coordinator");
    denied(dispatch({ ...impl, headSha: "f".repeat(40) }, "stale-head"));
    denied(
      dispatch({ ...pointer(10), extra: "SECRET-PROMPT" }, "text-injection"),
    );
    const recoveryStaging = createIssueStaging(root, {
      title: "recovery-fixture",
      requestedMode: "full",
      now: new Date("2026-10-01T00:00:00Z"),
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
      ),
    }).path;
    const recovery = pointer(1, recoveryStaging);
    allowed(dispatch(recovery, "failed-spawn"));
    allowed(call("PostToolUseFailure", { tool_use_id: "unrelated" }));
    denied(dispatch(recovery, "still-pending"));
    allowed(call("PostToolUseFailure", { tool_use_id: "failed-spawn" }));
    allowed(dispatch(recovery, "missing-start"));
    allowed(call("PostToolUse", { tool_use_id: "missing-start" }));
    start("unbound");
    denied(tool("unbound"));
    stop("unbound");
    allowed(call("SessionEnd"));
    allowed(call("SessionStart", { source: "resume" }));
    allowed(call("PreToolUse", { tool_name: "Read" }));
    denied(tool("impl"));
    const report = spawnSync(process.execPath, [hook, "--report"], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      encoding: "utf8",
    });
    assert.equal(report.status, 0, report.stderr);
    const reports = JSON.parse(report.stdout) as {
      sessionId: string;
      agents: {
        id: string;
        contextIsolation: string;
        dispatchScope: string;
        workflowStep: number | null;
      }[];
    }[];
    const agents = reports.find(
      (entry) => entry.sessionId === "semantic-session",
    )!.agents;
    assert.equal(
      agents.find((agent) => agent.id === "unexpected-fork")?.contextIsolation,
      "inherited",
    );
    assert.equal(
      agents.find((agent) => agent.id === "r1")?.contextIsolation,
      "fresh",
    );
    assert.equal(
      agents.find((agent) => agent.id === "semantic-session")?.contextIsolation,
      "unknown",
    );
    assert.equal(
      agents.find((agent) => agent.id === "task-two")?.dispatchScope,
      "task",
    );
    assert.equal(
      agents.find((agent) => agent.id === "task-two")?.workflowStep,
      null,
    );
    assert.equal(
      agents.find((agent) => agent.id === "r1")?.dispatchScope,
      "workflow",
    );
    assert.equal(
      agents.find((agent) => agent.id === "unbound")?.dispatchScope,
      "unbound",
    );
    assert.match(report.stdout, /"modelCycleProxy": 1/u);
    assert.match(report.stdout, /"modelCycleProxy": null/u);
    assert.match(report.stdout, /"freshHandoffTo": "r1"/u);
    assert.doesNotMatch(report.stdout, /SECRET-/u);
    this.value = true;
  },
);
