import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { normalizeReadPath } from "../../scripts/report_session_tokens.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class SessionTokenWorld extends WorkflowWorld {
  tokenRoot = "";
  tokenLog = "";
  tokenStaging = "";
  tokenStdout = "";
  tokenStatus: number | null = null;
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

Then("token様の名前は除外し単語で区切った長いfile名は保持する", function () {
  const root = "/repo";
  assert.deepEqual(
    [
      "test/steps/issue-development-considerations.steps.ts",
      "docs/0123456789abcdef0123456789abcdef.md",
      `docs/${TOKEN_LIKE_NAME}`,
      "docs/ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "docs/abcdefghijklmnopqrstuvwxyzabcdefgh.md",
    ].map((candidate) => normalizeReadPath(candidate, root, root) ?? null),
    [
      "test/steps/issue-development-considerations.steps.ts",
      null,
      null,
      null,
      "docs/abcdefghijklmnopqrstuvwxyzabcdefgh.md",
    ],
  );
});
