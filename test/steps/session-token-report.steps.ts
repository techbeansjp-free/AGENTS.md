import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  type SessionTokenReport,
  normalizeReadPath,
  normalizeProviderUsage,
} from "../../scripts/report_session_tokens.js";
import { reportCodexE2E } from "../../scripts/report_codex_e2e.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class SessionTokenWorld extends WorkflowWorld {
  tokenRoot = "";
  providerUsages: ReturnType<typeof normalizeProviderUsage>[] = [];
  tokenLog = "";
  tokenStaging = "";
  tokenStdout = "";
  tokenStatus: number | null = null;
  codexReport?: ReturnType<typeof reportCodexE2E>;
}

const { Given, When, Then } = stepDefinitions<SessionTokenWorld>();

/** 拡張子付きでもtoken様の英数字列を含むpathは出力しない（F-1517-R1-01）。 */
const TOKEN_LIKE_NAME = `sk-${"A1b2C3d4E5".repeat(4)}.txt`;

const SECRETS = [
  TOKEN_LIKE_NAME,
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
  fs.writeFileSync(path.join(root, "docs", TOKEN_LIKE_NAME), "token\n");
  /** 出力してよいのは追跡済みfileだけである。token様の名前のfileは追跡しない。 */
  for (const args of [
    ["init", "-q"],
    ["add", "docs/a.md"],
  ])
    assert.equal(spawnSync("git", ["-C", root, ...args]).status, 0);
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
        content: [
          read("/etc/passwd"),
          read("/etc/passwd"),
          read(path.join(root, "docs", TOKEN_LIKE_NAME)),
          read(path.join(root, "docs", TOKEN_LIKE_NAME)),
        ],
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

function runTokenScript(logs: readonly string[], options: string[]): string {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("scripts/report_session_tokens.ts"),
      ...logs,
      ...options,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

When("token集計scriptを実行する", function () {
  this.tokenStdout = runTokenScript(
    [this.tokenLog],
    [`--staging=${this.tokenStaging}`, `--root=${this.tokenRoot}`],
  );
  this.tokenStatus = 0;
});

Then(
  "subagent logの明示指定・同じlogの二重指定・別名pathでも同じcallを一度だけ数えsubagentの親を保つ",
  function () {
    const options = [
      `--staging=${this.tokenStaging}`,
      `--root=${this.tokenRoot}`,
    ];
    const subagent = path.join(
      path.dirname(this.tokenLog),
      "main-session",
      "subagents",
      "agent-x.jsonl",
    );
    const alias = path.join(this.temp("asc-token-alias-"), "alias.jsonl");
    fs.symlinkSync(this.tokenLog, alias);
    assert.deepEqual(
      JSON.parse(
        runTokenScript(
          [this.tokenLog, this.tokenLog, subagent, alias],
          options,
        ),
      ),
      JSON.parse(this.tokenStdout),
    );
    /** 別名を先に指定しても、session IDと親子関係は実pathから決まる。 */
    assert.deepEqual(
      JSON.parse(runTokenScript([alias, this.tokenLog], options)),
      JSON.parse(this.tokenStdout),
    );
    /** subagentを先に明示しても、親は配置から決まり合計は変わらない。 */
    const reversed = JSON.parse(
      runTokenScript([subagent, this.tokenLog], options),
    ) as {
      sessions: { id: string; kind: string; parent: string | null }[];
      totals: Record<string, unknown>;
    };
    assert.deepEqual(
      reversed.sessions.map((session) => [
        session.id,
        session.kind,
        session.parent,
      ]),
      [
        ["agent-x", "subagent", "main-session"],
        ["main-session", "main", null],
      ],
    );
    assert.deepEqual(
      [reversed.totals.sessions, reversed.totals.calls, reversed.totals.total],
      [2, 5, 6671],
    );
  },
);

Then(
  "Step別の稼働時間は異なるsessionのcall間隔を数えずsession内の間隔をStep区間で分ける",
  function () {
    const directory = this.temp("asc-token-active-");
    const log = (name: string, times: string[]) => {
      const file = path.join(directory, `${name}.jsonl`);
      fs.writeFileSync(
        file,
        times
          .map((at, index) =>
            assistant({
              id: `${name}-${index}`,
              at,
              usage: [1, 0, 0, 1],
              content: [],
              cwd: this.tokenRoot,
            }),
          )
          .join("\n"),
      );
      return file;
    };
    const staging = (recordedAt: string) => {
      const dir = this.temp("asc-token-active-staging-");
      fs.mkdirSync(path.join(dir, "journal"));
      fs.writeFileSync(
        path.join(dir, "journal", "steps.jsonl"),
        `${JSON.stringify({ step: 0, recordedAt })}\n`,
      );
      return dir;
    };
    const activeOf = (stdout: string) => {
      const report = JSON.parse(stdout) as {
        steps: { step: number | "pre"; calls: number; activeMs: number }[];
        totals: { activeMs: number };
      };
      return [
        report.steps.map((step) => [step.step, step.calls, step.activeMs]),
        report.totals.activeMs,
      ];
    };
    /** 10:00と10:01の別sessionは稼働0である。 */
    assert.deepEqual(
      activeOf(
        runTokenScript(
          [
            log("first", ["2026-09-01T10:00:00.000Z"]),
            log("second", ["2026-09-01T10:01:00.000Z"]),
          ],
          [
            `--staging=${staging("2026-09-01T09:00:00.000Z")}`,
            `--root=${this.tokenRoot}`,
          ],
        ),
      ),
      [
        [
          ["pre", 0, 0],
          [0, 2, 0],
        ],
        0,
      ],
    );
    /** 1 session内の10:00→10:04はStep境界10:02で2分ずつに分かれる。 */
    assert.deepEqual(
      activeOf(
        runTokenScript(
          [
            log("split", [
              "2026-09-01T10:00:00.000Z",
              "2026-09-01T10:04:00.000Z",
            ]),
          ],
          [
            `--staging=${staging("2026-09-01T10:02:00.000Z")}`,
            `--root=${this.tokenRoot}`,
          ],
        ),
      ),
      [
        [
          ["pre", 1, 120000],
          [0, 1, 120000],
        ],
        240000,
      ],
    );
  },
);

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
        contextPerCall: { median: 1205, p95: 3001, max: 3001 },
        observedLifetimeMs: 1200000,
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
        contextPerCall: { median: 652.5, p95: 702, max: 702 },
        observedLifetimeMs: 300000,
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

Then(
  "追跡済みfileだけを出力しtoken様の名前や未追跡のpathを出さない",
  function () {
    const root = "/repo";
    const tracked = new Set([
      "test/steps/issue-development-considerations.steps.ts",
      "docs/a.md",
    ]);
    assert.deepEqual(
      [
        "test/steps/issue-development-considerations.steps.ts",
        "/repo/docs/a.md",
        `docs/${TOKEN_LIKE_NAME}`,
        "docs/ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij.txt",
        "docs/abcdefghijklmnopqrstuvwxyzabcdefgh.md",
        "docs/aB3dE5fG7hJ9_kL2mN4pQ6rS8-tU1vW3xY5zA7.txt",
        "docs/b.md",
        "../outside/docs/a.md",
        "https://example.com/docs/a.md",
      ].map(
        (candidate) =>
          normalizeReadPath(candidate, root, root, tracked) ?? null,
      ),
      [
        "test/steps/issue-development-considerations.steps.ts",
        "docs/a.md",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    );
  },
);

Then(
  "重複tool記録を再読込と誤認せず孫workerのcacheを一度だけ集計する",
  function () {
    const directory = this.temp("asc-token-descendants-");
    const main = path.join(directory, "parent.jsonl");
    const childDirectory = path.join(directory, "parent", "subagents");
    const grandchildDirectory = path.join(childDirectory, "child", "subagents");
    fs.mkdirSync(grandchildDirectory, { recursive: true });
    const read = (id: string) => ({
      type: "tool_use",
      id,
      name: "Read",
      input: { file_path: path.join(this.tokenRoot, "docs/a.md") },
    });
    const log = (id: string, content: unknown[]) =>
      assistant({
        id,
        at: "2026-09-01T10:00:00.000Z",
        usage: [1, 2, 3, 4],
        content,
        cwd: this.tokenRoot,
      });
    // Replayed content blocks are one read; two distinct tool IDs are two reads.
    fs.writeFileSync(
      main,
      [
        log("parent-call", [read("read-1")]),
        log("parent-call", [read("read-1"), read("read-2")]),
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(childDirectory, "child.jsonl"),
      log("child-call", []),
    );
    const grandchild = path.join(grandchildDirectory, "grandchild.jsonl");
    fs.writeFileSync(grandchild, log("grandchild-call", []));
    // A descendant alias back to its ancestor must neither loop nor double count.
    fs.symlinkSync(main, path.join(grandchildDirectory, "parent-alias.jsonl"));
    const report = JSON.parse(
      runTokenScript([main], [`--root=${this.tokenRoot}`]),
    ) as SessionTokenReport;
    assert.deepEqual(
      report.sessions.map((session: { id: string; parent: string | null }) => [
        session.id,
        session.parent,
      ]),
      [
        ["parent", null],
        ["child", "parent"],
        ["grandchild", "child"],
      ],
    );
    assert.deepEqual(report.sessions[0]!.repeatedReads, [
      { path: "docs/a.md", count: 2 },
    ]);
    assert.deepEqual(
      [
        report.totals.calls,
        report.totals.input,
        report.totals.cacheCreation,
        report.totals.cacheRead,
        report.totals.output,
        report.totals.total,
      ],
      [3, 3, 6, 9, 12, 30],
    );
    const automatic = JSON.parse(
      runTokenScript([main, grandchild], [`--root=${this.tokenRoot}`]),
    ) as SessionTokenReport;
    assert.deepEqual(automatic.totals, report.totals);
    assert.deepEqual(
      [...automatic.sessions].sort((a: { id: string }, b: { id: string }) =>
        a.id.localeCompare(b.id),
      ),
      [...report.sessions].sort((a: { id: string }, b: { id: string }) =>
        a.id.localeCompare(b.id),
      ),
    );
  },
);

Given("異なるcache包含方式と欠測のprovider usageがある", function () {
  this.providerUsages = [];
});
When("CodexとClaudeの観測済みusageを正規化する", function () {
  this.providerUsages = [
    normalizeProviderUsage("codex", {
      input_tokens: 100,
      cached_input_tokens: 80,
      output_tokens: 10,
    }),
    normalizeProviderUsage(
      "claude",
      {
        input_tokens: 20,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 5,
        output_tokens: 10,
      },
      0.02,
    ),
    normalizeProviderUsage("claude", { input_tokens: 20, output_tokens: 10 }),
    normalizeProviderUsage(
      "codex",
      { input_tokens: -1, output_tokens: 10 },
      Number.NaN,
    ),
  ];
});
Then("provider別のcache包含関係を守り欠測値を補わずに集計する", function () {
  const [codex, claude, missing, invalid] = this.providerUsages;
  assert.equal(codex?.totalProcessed, 110);
  assert.equal(codex?.cacheWrite, null);
  assert.equal(codex?.costUsd, null);
  assert.equal(claude?.totalProcessed, 115);
  assert.equal(claude?.costUsd, 0.02);
  assert.equal(missing?.totalProcessed, null);
  assert.equal(invalid?.totalProcessed, null);
});

Given("Codex HostとWorkerのusage logと欠測Reviewerがある", function () {
  this.tokenRoot = this.temp("asc-e2e-tokens-");
  const usage = {
    input_tokens: 100,
    cached_input_tokens: 90,
    cache_write_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 5,
  };
  const event = JSON.stringify({
    type: "token_usage_record",
    timestamp: "2026-10-13T00:00:01.000Z",
    payload: { response_id: "same", root_turn_id: "target", usage },
  });
  fs.writeFileSync(
    path.join(this.tokenRoot, "host.jsonl"),
    `${event}\n${event}\n`,
  );
  fs.writeFileSync(
    path.join(this.tokenRoot, "reviewer.jsonl"),
    `${JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      },
    })}\n`,
  );
  fs.writeFileSync(
    path.join(this.tokenRoot, "zero.jsonl"),
    `${JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
      },
    })}\n`,
  );
  fs.writeFileSync(
    path.join(this.tokenRoot, "worker.jsonl"),
    `${JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 50,
        cached_input_tokens: 40,
        cache_write_input_tokens: 0,
        output_tokens: 10,
        reasoning_output_tokens: 2,
      },
    })}\n`,
  );
});
When("Codex E2E計測を集計する", function () {
  this.codexReport = reportCodexE2E({
    agents: [
      {
        id: "parent",
        format: "codex-host",
        files: [path.join(this.tokenRoot, "host.jsonl")],
        startedAt: "2026-10-13T00:00:00.000Z",
        endedAt: "2026-10-13T00:00:03.000Z",
        rootTurnId: "target",
      },
      {
        id: "worker",
        format: "codex-exec",
        files: [path.join(this.tokenRoot, "worker.jsonl")],
        startedAt: "2026-10-13T00:00:01.000Z",
        endedAt: "2026-10-13T00:00:02.000Z",
      },
      {
        id: "reviewer",
        format: "codex-exec",
        files: [path.join(this.tokenRoot, "reviewer.jsonl")],
        startedAt: null,
        endedAt: null,
      },
      {
        id: "zero-usage-review",
        format: "codex-exec",
        files: [path.join(this.tokenRoot, "zero.jsonl")],
        startedAt: null,
        endedAt: null,
      },
      {
        id: "missing-worker",
        format: "codex-exec",
        files: [path.join(this.tokenRoot, "missing.jsonl")],
        startedAt: null,
        endedAt: null,
      },
    ],
    phases: [
      { name: "work", at: "2026-10-13T00:00:00.000Z" },
      { name: "complete", at: "2026-10-13T00:00:03.000Z" },
    ],
  });
});
Then(
  "cacheを二重計上せず工程別使用量を示し全Agent合計は欠測にする",
  function () {
    const report = this.codexReport;
    assert.ok(report);
    assert.equal(report.agents[0]?.calls, 1);
    assert.equal(report.agents[0]?.processedTokens, 120);
    assert.equal(report.agents[1]?.processedTokens, 60);
    assert.equal(report.agents[2]?.processedTokens, null);
    assert.equal(report.agents[2]?.wallMs, null);
    assert.equal(report.agents[3]?.processedTokens, null);
    assert.equal(report.agents[4]?.processedTokens, null);
    assert.equal(report.observedLowerBound, 180);
    assert.equal(report.allDeclaredAgentProcessedTokens, null);
    assert.equal(report.phases[0]?.wallMs, 3000);
    assert.equal(report.phases[0]?.hostAgentUsage[0]?.processedTokens, 120);
  },
);

Given("完了と不完全のCodex rollout logがある", function () {
  this.tokenRoot = this.temp("asc-e2e-rollout-");
  const usage = {
    input_tokens: 100,
    cached_input_tokens: 80,
    cache_write_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 5,
  };
  const started = {
    type: "event_msg",
    timestamp: "2026-10-13T00:00:00.000Z",
    payload: { type: "task_started" },
  };
  const response = {
    type: "token_usage_record",
    timestamp: "2026-10-13T00:00:01.000Z",
    payload: {
      response_id: "response-1",
      root_turn_id: "turn-1",
      usage,
      thread_token_usage: usage,
    },
  };
  const completed = {
    type: "event_msg",
    timestamp: "2026-10-13T00:00:03.000Z",
    payload: { type: "task_complete" },
  };
  fs.writeFileSync(
    path.join(this.tokenRoot, "complete.jsonl"),
    [started, response, completed]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  fs.writeFileSync(
    path.join(this.tokenRoot, "partial.jsonl"),
    [started, response].map((event) => JSON.stringify(event)).join("\n"),
  );
  const secondUsage = {
    input_tokens: 60,
    cached_input_tokens: 40,
    cache_write_input_tokens: 0,
    output_tokens: 10,
    reasoning_output_tokens: 2,
  };
  fs.writeFileSync(
    path.join(this.tokenRoot, "empty-turn.jsonl"),
    [
      { ...started, payload: { type: "task_started", turn_id: "empty" } },
      { ...completed, payload: { type: "task_complete", turn_id: "empty" } },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  fs.writeFileSync(
    path.join(this.tokenRoot, "two-turns.jsonl"),
    [
      started,
      response,
      completed,
      {
        ...started,
        timestamp: "2026-10-13T00:00:04.000Z",
      },
      {
        ...response,
        timestamp: "2026-10-13T00:00:05.000Z",
        payload: {
          response_id: "response-2",
          root_turn_id: "turn-2",
          usage: secondUsage,
          thread_token_usage: {
            input_tokens: 160,
            cached_input_tokens: 120,
            cache_write_input_tokens: 0,
            output_tokens: 30,
            reasoning_output_tokens: 7,
          },
        },
      },
      {
        ...completed,
        timestamp: "2026-10-13T00:00:06.000Z",
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  fs.writeFileSync(
    path.join(this.tokenRoot, "builtin-missing.jsonl"),
    [
      started,
      {
        type: "response_item",
        timestamp: "2026-10-13T00:00:02.000Z",
        payload: { type: "web_search_call" },
      },
      completed,
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  fs.writeFileSync(
    path.join(this.tokenRoot, "trailing-missing.jsonl"),
    [
      started,
      response,
      {
        type: "response_item",
        timestamp: "2026-10-13T00:00:02.000Z",
        payload: { type: "message", role: "assistant" },
      },
      completed,
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
});

When("rolloutの工程別usageを集計する", function () {
  this.codexReport = reportCodexE2E({
    agents: [
      {
        id: "complete",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "complete.jsonl")],
        startedAt: null,
        endedAt: null,
        rootTurnId: "turn-1",
      },
      {
        id: "partial",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "partial.jsonl")],
        startedAt: null,
        endedAt: null,
        rootTurnId: "turn-1",
      },
    ],
    phases: [
      { name: "before", at: "2026-10-13T00:00:00.000Z" },
      { name: "response", at: "2026-10-13T00:00:01.000Z" },
      { name: "after", at: "2026-10-13T00:00:02.000Z" },
      { name: "end", at: "2026-10-13T00:00:03.000Z" },
    ],
  });
});

Then("rolloutの完全性とAgent列挙の未検証を区別する", function () {
  const report = this.codexReport;
  assert.ok(report);
  assert.equal(report.agents[0]?.coverage, "complete");
  assert.equal(report.agents[1]?.coverage, "partial");
  assert.deepEqual(
    report.phases.map((phase) =>
      phase.hostAgentUsage.map((agent) => [
        agent.coverage,
        agent.processedTokens,
      ]),
    ),
    [
      [
        ["complete", 0],
        ["missing", null],
      ],
      [
        ["complete", 120],
        ["partial", 120],
      ],
      [
        ["complete", 0],
        ["missing", null],
      ],
    ],
  );
  assert.equal(report.observedLowerBound, 240);
  assert.equal(report.allDeclaredAgentProcessedTokens, null);
  assert.equal(report.agentInventoryCoverage, "unverified");
  assert.equal(report.actualAllAgentProcessedTokens, null);
  const trailing = reportCodexE2E({
    agents: [
      {
        id: "trailing-missing",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "trailing-missing.jsonl")],
        startedAt: null,
        endedAt: null,
      },
    ],
    phases: [
      { name: "trailing", at: "2026-10-13T00:00:02.000Z" },
      { name: "end", at: "2026-10-13T00:00:03.000Z" },
    ],
  });
  assert.equal(trailing.agents[0]?.coverage, "partial");
  assert.equal(trailing.phases[0]?.hostAgentUsage[0]?.coverage, "missing");
  assert.equal(trailing.allDeclaredAgentProcessedTokens, null);
  const builtin = reportCodexE2E({
    agents: [
      {
        id: "builtin-missing",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "builtin-missing.jsonl")],
        startedAt: null,
        endedAt: null,
      },
    ],
    phases: [
      { name: "builtin", at: "2026-10-13T00:00:02.000Z" },
      { name: "end", at: "2026-10-13T00:00:03.000Z" },
    ],
  });
  assert.equal(builtin.agents[0]?.coverage, "missing");
  assert.equal(builtin.phases[0]?.hostAgentUsage[0]?.coverage, "missing");
  assert.equal(builtin.allDeclaredAgentProcessedTokens, null);
  const twoTurns = reportCodexE2E({
    agents: [
      {
        id: "two-turns",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "two-turns.jsonl")],
        startedAt: null,
        endedAt: null,
      },
    ],
    phases: [
      { name: "between", at: "2026-10-13T00:00:03.000Z" },
      { name: "end", at: "2026-10-13T00:00:04.000Z" },
    ],
  });
  assert.equal(twoTurns.agents[0]?.coverage, "complete");
  assert.equal(twoTurns.phases[0]?.hostAgentUsage[0]?.processedTokens, 0);
  assert.equal(twoTurns.allDeclaredAgentProcessedTokens, 190);
  const selectedTurn = reportCodexE2E({
    agents: [
      {
        id: "selected-turn",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "two-turns.jsonl")],
        startedAt: null,
        endedAt: null,
        rootTurnId: "turn-2",
      },
    ],
    phases: [
      { name: "second-idle", at: "2026-10-13T00:00:04.000Z" },
      { name: "second-response", at: "2026-10-13T00:00:05.000Z" },
      { name: "end", at: "2026-10-13T00:00:06.000Z" },
    ],
  });
  assert.equal(selectedTurn.agents[0]?.coverage, "complete");
  assert.equal(selectedTurn.phases[0]?.hostAgentUsage[0]?.processedTokens, 0);
  assert.equal(selectedTurn.phases[1]?.hostAgentUsage[0]?.processedTokens, 70);
  assert.equal(selectedTurn.allDeclaredAgentProcessedTokens, 70);
  const bounded = reportCodexE2E({
    agents: [
      {
        id: "bounded",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "complete.jsonl")],
        startedAt: "2026-10-13T00:00:02.000Z",
        endedAt: "2026-10-13T00:00:03.000Z",
      },
    ],
    phases: [
      { name: "excluded", at: "2026-10-13T00:00:00.000Z" },
      { name: "selected", at: "2026-10-13T00:00:02.000Z" },
      { name: "end", at: "2026-10-13T00:00:03.000Z" },
    ],
  });
  assert.equal(bounded.phases[0]?.hostAgentUsage[0]?.coverage, "missing");
  assert.equal(bounded.phases[1]?.hostAgentUsage[0]?.processedTokens, 0);
  const boundedTurn = reportCodexE2E({
    agents: [
      {
        id: "bounded-turn",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "complete.jsonl")],
        startedAt: "2026-10-13T00:00:02.000Z",
        endedAt: "2026-10-13T00:00:03.000Z",
        rootTurnId: "turn-1",
      },
    ],
    phases: [
      { name: "selected", at: "2026-10-13T00:00:02.000Z" },
      { name: "end", at: "2026-10-13T00:00:03.000Z" },
    ],
  });
  assert.equal(boundedTurn.agents[0]?.coverage, "complete");
  assert.equal(boundedTurn.phases[0]?.hostAgentUsage[0]?.processedTokens, 0);
  assert.equal(boundedTurn.allDeclaredAgentProcessedTokens, 0);
  const emptyTurn = reportCodexE2E({
    agents: [
      {
        id: "empty-turn",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "empty-turn.jsonl")],
        startedAt: null,
        endedAt: null,
        rootTurnId: "empty",
      },
    ],
    phases: [
      { name: "idle", at: "2026-10-13T00:00:00.000Z" },
      { name: "end", at: "2026-10-13T00:00:03.000Z" },
    ],
  });
  assert.equal(emptyTurn.agents[0]?.coverage, "complete");
  assert.equal(emptyTurn.phases[0]?.hostAgentUsage[0]?.processedTokens, 0);
  assert.equal(emptyTurn.allDeclaredAgentProcessedTokens, 0);
  const outside = reportCodexE2E({
    agents: [
      {
        id: "outside",
        format: "codex-rollout",
        files: [path.join(this.tokenRoot, "complete.jsonl")],
        startedAt: "2026-10-13T01:00:00.000Z",
        endedAt: "2026-10-13T02:00:00.000Z",
      },
    ],
    phases: [
      { name: "unobserved", at: "2026-10-13T01:00:00.000Z" },
      { name: "end", at: "2026-10-13T02:00:00.000Z" },
    ],
  });
  assert.equal(outside.agents[0]?.coverage, "missing");
  assert.equal(outside.agents[0]?.processedTokens, null);
  assert.equal(outside.phases[0]?.hostAgentUsage[0]?.coverage, "missing");
  assert.equal(outside.allDeclaredAgentProcessedTokens, null);
});
