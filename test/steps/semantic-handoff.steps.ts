import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  function () {
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
    fs.writeFileSync(path.join(root, ".gitignore"), ".agent-skill-chain/\n");
    git("add", ".gitignore");
    git("commit", "-qm", "ignore fixture state");
    const call = (name: string, extra: Record<string, unknown> = {}) => {
      const result = spawnSync(process.execPath, [hook], {
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: root,
          ASC_EXECUTION_CONTEXT_MODE: "short-lived",
          ASC_WORKFLOW_CLI: path.resolve("dist/bin/agent-skill-chain.js"),
          ASC_AGENT_BUDGET_MODE: "warn",
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
      };
      const h = rereview ? preview.handoffAlternatives?.[0] : preview.handoff;
      assert.ok(h && "kind" in h, JSON.stringify(h));
      assert.equal(h.step, step);
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
    const dispatch = (h: unknown, id: string) =>
      call("PreToolUse", {
        tool_name: "Agent",
        tool_use_id: id,
        tool_input: {
          subagent_type: "general-purpose",
          prompt: JSON.stringify(h),
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
    allowed(call("SessionStart", { source: "startup" }));
    const request = pointer(1);
    allowed(dispatch(request, "dispatch-request"));
    start("request");
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
    fs.writeFileSync(journal, original);
    recordStep(1);
    allowed(dispatch(pointer(2), "dispatch-requirements"));
    start("requirements");
    allowed(tool("requirements"));
    stop("requirements");
    for (const step of [2, 3, 4, 5, 6, 7, 8]) recordStep(step);
    const impl = pointer(9);
    allowed(dispatch(impl, "dispatch-impl"));
    start("impl");
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
      allowed(dispatch(h, `dispatch-r${round}`));
      start(`r${round}`);
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
    const reviewCli = (...args: string[]) => {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve("dist/bin/agent-skill-chain.js"),
          "review",
          "round",
          ...args,
        ],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    reviewCli(
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
    reviewCli(`--staging=${staging}`, `--file=${roundFile}`, "--apply");
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
    assert.match(report.stdout, /"modelCycleProxy": 1/u);
    assert.match(report.stdout, /"modelCycleProxy": null/u);
    assert.match(report.stdout, /"freshHandoffTo": "r1"/u);
    assert.doesNotMatch(report.stdout, /SECRET-/u);
    this.value = true;
  },
);
