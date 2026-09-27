import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class SessionTokenWorld extends WorkflowWorld {
  tokenRoot = "";
  tokenLog = "";
  tokenStaging = "";
  tokenStdout = "";
  tokenStatus: number | null = null;
}

const { Given, When, Then } = stepDefinitions<SessionTokenWorld>();

const SECRETS = [
  "SECRET-PROMPT",
  "SECRET-TEXT",
  "SECRET-BASH",
  "SECRET-RESULT",
  "example.com",
  "/etc/passwd",
] as const;

function assistant(input: {
  id: string;
  at: string;
  usage: [number, number, number, number];
  content: unknown[];
  cwd: string;
}): string {
  const [inputTokens, cacheCreation, cacheRead, output] = input.usage;
  return JSON.stringify({
    type: "assistant",
    timestamp: input.at,
    cwd: input.cwd,
    message: {
      id: input.id,
      content: input.content,
      usage: {
        input_tokens: inputTokens,
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
        output_tokens: output,
      },
    },
  });
}

Given("本体とsubagentのfixture logとjournalがある", function () {
  const root = this.temp("asc-token-root-");
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "a.md"), "# a\n");
  const logs = this.temp("asc-token-logs-");
  const main = path.join(logs, "main-session.jsonl");
  const read = (file: string) => ({
    type: "tool_use",
    name: "Read",
    input: { file_path: file },
  });
  fs.writeFileSync(
    main,
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-09-01T09:59:00.000Z",
        message: { content: "SECRET-PROMPT" },
      }),
      assistant({
        id: "msg_a",
        at: "2026-09-01T10:00:00.000Z",
        usage: [10, 1000, 0, 50],
        content: [read(path.join(root, "docs", "a.md"))],
        cwd: root,
      }),
      assistant({
        id: "msg_a",
        at: "2026-09-01T10:00:01.000Z",
        usage: [10, 1000, 0, 50],
        content: [
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "cat docs/a.md && echo SECRET-BASH" },
          },
        ],
        cwd: root,
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-09-01T10:00:30.000Z",
        message: {
          content: [{ type: "tool_result", content: "SECRET-RESULT" }],
        },
      }),
      assistant({
        id: "msg_b",
        at: "2026-09-01T10:02:00.000Z",
        usage: [5, 200, 1000, 20],
        content: [
          { type: "text", text: "SECRET-TEXT" },
          read("https://example.com/x"),
          read("https://example.com/x"),
        ],
        cwd: root,
      }),
      "{not json",
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-01T10:03:00.000Z",
        message: { id: "msg_no_usage", content: [] },
      }),
      assistant({
        id: "msg_c",
        at: "2026-09-01T10:20:00.000Z",
        usage: [1, 0, 3000, 10],
        content: [read("/etc/passwd"), read("/etc/passwd")],
        cwd: root,
      }),
      "",
    ].join("\n"),
  );
  const subagents = path.join(logs, "main-session", "subagents");
  fs.mkdirSync(subagents, { recursive: true });
  fs.writeFileSync(
    path.join(subagents, "agent-x.jsonl"),
    [
      assistant({
        id: "msg_d",
        at: "2026-09-01T10:03:00.000Z",
        usage: [2, 300, 400, 30],
        content: [],
        cwd: root,
      }),
      assistant({
        id: "msg_e",
        at: "2026-09-01T10:08:00.000Z",
        usage: [3, 0, 600, 40],
        content: [],
        cwd: root,
      }),
      "",
    ].join("\n"),
  );
  const staging = this.temp("asc-token-staging-");
  fs.mkdirSync(path.join(staging, "journal"));
  fs.writeFileSync(
    path.join(staging, "journal", "steps.jsonl"),
    [
      JSON.stringify({ step: 0, recordedAt: "2026-09-01T10:02:00.000Z" }),
      JSON.stringify({ step: 1, recordedAt: "2026-09-01T10:10:00.000Z" }),
      "",
    ].join("\n"),
  );
  this.tokenRoot = root;
  this.tokenLog = main;
  this.tokenStaging = staging;
});

When("token集計scriptを実行する", function () {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("scripts/report_session_tokens.ts"),
      this.tokenLog,
      `--staging=${this.tokenStaging}`,
      `--root=${this.tokenRoot}`,
    ],
    { encoding: "utf8" },
  );
  this.tokenStatus = result.status;
  this.tokenStdout = result.stdout;
  assert.equal(result.status, 0, result.stderr);
});

Then(
  "session・subagent・Step別合計とcache_read\\/callのmedian・p95・maxとskip行数を返し本文を出力しない",
  function () {
    const report = JSON.parse(this.tokenStdout) as {
      sessions: Record<string, unknown>[];
      steps: Record<string, unknown>[];
      totals: Record<string, unknown>;
      resumeOverhead: unknown;
    };
    assert.deepEqual(report.sessions, [
      {
        id: "main-session",
        kind: "main",
        parent: null,
        calls: 3,
        input: 16,
        cacheCreation: 1200,
        cacheRead: 4000,
        output: 80,
        total: 5296,
        fresh: 1296,
        cacheReadPerCall: { median: 1000, p95: 3000, max: 3000 },
        firstCallContext: 1010,
        startedAt: "2026-09-01T10:00:00.000Z",
        endedAt: "2026-09-01T10:20:00.000Z",
        activeMs: 120000,
        repeatedReads: [{ path: "docs/a.md", count: 2 }],
        skippedLines: 2,
      },
      {
        id: "agent-x",
        kind: "subagent",
        parent: "main-session",
        calls: 2,
        input: 5,
        cacheCreation: 300,
        cacheRead: 1000,
        output: 70,
        total: 1375,
        fresh: 375,
        cacheReadPerCall: { median: 500, p95: 600, max: 600 },
        firstCallContext: 702,
        startedAt: "2026-09-01T10:03:00.000Z",
        endedAt: "2026-09-01T10:08:00.000Z",
        activeMs: 300000,
        repeatedReads: [],
        skippedLines: 0,
      },
    ]);
    assert.deepEqual(
      report.steps.map((step) => [
        step.step,
        step.from,
        step.to,
        step.calls,
        step.input,
        step.cacheCreation,
        step.cacheRead,
        step.output,
      ]),
      [
        ["pre", null, "2026-09-01T10:02:00.000Z", 1, 10, 1000, 0, 50],
        [
          0,
          "2026-09-01T10:02:00.000Z",
          "2026-09-01T10:10:00.000Z",
          3,
          10,
          500,
          2000,
          90,
        ],
        [1, "2026-09-01T10:10:00.000Z", null, 1, 1, 0, 3000, 10],
      ],
    );
    assert.deepEqual(
      [
        report.totals.calls,
        report.totals.input,
        report.totals.cacheCreation,
        report.totals.cacheRead,
        report.totals.output,
        report.totals.total,
        report.totals.fresh,
        report.totals.cacheReadPerCall,
        report.totals.sessions,
        report.totals.activeMs,
        report.totals.wallClockMs,
        report.totals.skippedLines,
      ],
      [
        5,
        21,
        1500,
        5000,
        150,
        6671,
        1671,
        { median: 600, p95: 3000, max: 3000 },
        2,
        420000,
        1200000,
        2,
      ],
    );
    assert.deepEqual(report.resumeOverhead, {
      sessions: [
        { id: "main-session", context: 1010 },
        { id: "agent-x", context: 702 },
      ],
      total: 1712,
    });
    for (const secret of [...SECRETS, this.tokenRoot])
      assert.equal(this.tokenStdout.includes(secret), false, secret);
  },
);
