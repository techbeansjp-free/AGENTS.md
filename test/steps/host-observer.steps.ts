import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { AGENT_LIFECYCLE_COMMAND } from "../../src/domain/lifecycle-settings.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import { type WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * Issue #1566のhost observerを子processとして起動し、stdin・一時directoryの
 * transcript・環境変数を接合部にして検査する。
 *
 * **期待値は製品の定数から導出しない。** 警告文言・正規形entry・検証済みversionは
 * ここへ字面で持つ。製品側と同じ向きにずれても検出できるようにするためである。
 */
const OBSERVER = path.resolve(".agent-skill-chain/hooks/asc-host-observer.mjs");
const CLI = path.resolve("dist/bin/agent-skill-chain.js");
const FIXTURE_DIRECTORY = path.resolve(
  "test/fixtures/host-observer/claude-code-2.1.282",
);
const FIXTURES = {
  exp1: "exp1-fresh-a-b-resume-a.jsonl",
  exp2: "exp2-nested-worktree-background-dontask.jsonl",
  exp3: "exp3-session-resume-compact.jsonl",
} as const;
const FRESH_TEXT =
  "ASC WARN: This Work Unit requires a fresh execution context. The observed Claude Code agent identity is being reused. Redispatch a fresh worker.";
const TERMINAL_TEXT =
  "ASC WARN: This agent completed a terminal ASC Work Unit. Do not continue ASC work in this context. Run workflow advance and dispatch a fresh worker.";
const PERMISSION_KEYS = [
  "permissionDecision",
  "decision",
  "continue",
  "stopReason",
];
const OBSERVER_ARG =
  "${CLAUDE_PROJECT_DIR}/.claude/hooks/asc-host-observer.mjs";
const CANONICAL_HOOK = {
  type: "command",
  command: "node",
  args: [OBSERVER_ARG],
  timeout: 10,
};
const CANONICAL_GROUP = { matcher: "SendMessage", hooks: [CANONICAL_HOOK] };
const DOCTOR_NEXT =
  "登録は新しいClaude Code sessionから有効になります。検証済みversion（2.1.282）以外でhook errorが表示される場合は、delete --applyまたは.claude/settings.local.jsonのASC所有entryの削除で無効化できます";
const DIAGNOSTIC_UNREGISTERED =
  "host observerが.claude/settings.local.jsonのPreToolUse（matcher SendMessage）に登録されていません。update --root=. --applyで登録できます";
const DIAGNOSTIC_ASSET_MISSING =
  "host observer資産.claude/hooks/asc-host-observer.mjsがありません。update --root=. --applyで配置できます";

interface ObserverCase {
  label: string;
  stdin: string | Buffer;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface ObserverRun {
  label: string;
  status: number | null;
  stdout: string;
  stderr: string;
  stdin: string | Buffer;
}

interface HostObserverState {
  root: string;
  store: string;
  project: string;
  cases: ObserverCase[];
  runs: ObserverRun[];
  expected: Map<string, unknown>;
  before?: Map<string, string>;
  after?: Map<string, string>;
  markers: string[];
  baseline?: ObserverRun[];
  values: Record<string, string>;
  texts: Record<string, string>;
}

interface HostLifecycleState {
  roots: Record<string, string>;
  outputs: Record<string, Record<string, unknown>>;
  settingsBefore?: Record<string, unknown>;
  advance: Record<string, Record<string, unknown>>;
}

interface FixtureEvent {
  index: number;
  event: string;
  identity: Record<string, unknown>;
  toolInput: Record<string, unknown> | null;
  toolInputShape: Record<string, unknown> | null;
}

type HostObserverWorld = WorkflowWorld & {
  hostObserver?: HostObserverState;
  hostLifecycle?: HostLifecycleState;
};

const { Given, When, Then } = stepDefinitions<HostObserverWorld>();

/** Cucumber Expressionの`{}`・`()`・`/`を字面として扱うため、全stepを完全一致の正規表現で定義する。 */
function exact(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")}$`, "u");
}

function state(world: HostObserverWorld): HostObserverState {
  if (!world.hostObserver) {
    const root = world.temp("asc-hostobs-");
    const store = path.join(root, "home", ".claude", "projects", "slug");
    const project = path.join(root, "project");
    fs.mkdirSync(store, { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    world.hostObserver = {
      root,
      store,
      project,
      cases: [],
      runs: [],
      expected: new Map(),
      markers: [],
      values: {},
      texts: {},
    };
  }
  return world.hostObserver;
}

function workUnitId(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function handoff(
  id: unknown,
  fresh: unknown = true,
  terminal: unknown = true,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "asc-handoff/v1",
    authority: "advisory",
    issue: "https://example.invalid/issues/1",
    step: 9,
    role: "implementation",
    workUnit: {
      workUnitId: id,
      freshContextRequired: fresh,
      terminalAfterHandback: terminal,
      reuseForbidden: true,
    },
    ...overrides,
  };
}

/** `workflow advance`のdispatch promptと同じ形（`{"handoff":…,"prompt":…}`の後に文章が続く）。 */
function dispatchPrompt(value: unknown, prompt = "worker prompt"): string {
  return `${JSON.stringify({ handoff: value, prompt })}\n追加入力pointer: {作業treeは別} を参照する`;
}

/** handoffの前に`{`を含む文章を置き、最初の`{`だけを候補にする実装を落とす。 */
function freshMessage(id: string): string {
  return `進行役の前置き{注記}です。${dispatchPrompt(handoff(id, true, true))}`;
}

function transcriptLine(content: string, agentId: string): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: true,
    agentId,
    type: "user",
    message: { role: "user", content },
    uuid: "00000000-0000-4000-8000-000000000000",
  });
}

const ASSISTANT_LINE = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text: "done" }] },
});

function terminalTranscript(id: string, agentId: string, prompt?: string) {
  return `${transcriptLine(dispatchPrompt(handoff(id, true, true), prompt), agentId)}\n${ASSISTANT_LINE}\n`;
}

function placeTranscript(
  store: string,
  sessionId: string,
  agentId: string,
  body: string | Buffer,
): string {
  const file = path.join(
    store,
    sessionId,
    "subagents",
    `agent-${agentId}.jsonl`,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function sendMessage(
  s: HostObserverState,
  sessionId: string,
  to: unknown,
  message: unknown = "作業を続けてください。",
): Record<string, unknown> {
  return {
    session_id: sessionId,
    transcript_path: path.join(s.store, `${sessionId}.jsonl`),
    cwd: s.project,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "SendMessage",
    tool_input: { to, message, summary: "s" },
    tool_use_id: "toolu_fixture",
  };
}

function expectedWarning(text: string, id: string, agentId: string) {
  return {
    systemMessage: text,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `${text}\nworkUnitId: ${id}\nagentId: ${agentId}`,
    },
  };
}

function loadFixture(name: keyof typeof FIXTURES): FixtureEvent[] {
  return fs
    .readFileSync(path.join(FIXTURE_DIRECTORY, FIXTURES[name]), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FixtureEvent);
}

function substitute(value: unknown, s: HostObserverState): unknown {
  if (typeof value === "string")
    return value
      .replaceAll("<CLAUDE_PROJECT_STORE>", s.store)
      .replaceAll("<PROJECT>", s.project)
      .replaceAll("<HOME>", path.join(s.root, "home"));
  if (Array.isArray(value)) return value.map((item) => substitute(item, s));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, s)]),
    );
  return value;
}

/** fixtureのidentityへtool_inputを合成してhook入力へ戻す。 */
function hookInput(
  event: FixtureEvent,
  s: HostObserverState,
  toolInput?: Record<string, unknown>,
): Record<string, unknown> {
  const input = substitute(event.identity, s) as Record<string, unknown>;
  if (event.toolInput !== null || toolInput !== undefined)
    input.tool_input = {
      ...((substitute(event.toolInput, s) as Record<string, unknown> | null) ??
        {}),
      ...(toolInput ?? {}),
    };
  return input;
}

/** fixture全eventの既定入力。Agentにはfresh handoff、SendMessageにはhandoffの無い本文を与える。 */
function defaultFixtureInput(
  event: FixtureEvent,
  s: HostObserverState,
  message = "作業を続けてください。",
): Record<string, unknown> {
  const tool = event.identity.tool_name;
  if (tool === "Agent")
    return hookInput(event, s, {
      prompt: dispatchPrompt(handoff(workUnitId(`agent-${event.index}`))),
    });
  if (tool === "SendMessage") return hookInput(event, s, { message });
  if (tool === "Bash") return hookInput(event, s, { command: "echo probe" });
  return hookInput(event, s);
}

function fixtureCases(s: HostObserverState, message?: string): ObserverCase[] {
  return (["exp1", "exp2", "exp3"] as const).flatMap((name) =>
    loadFixture(name).map((event) => ({
      label: `${name}#${event.index}`,
      stdin: JSON.stringify(defaultFixtureInput(event, s, message)),
    })),
  );
}

function add(s: HostObserverState, label: string, input: unknown): void {
  s.cases.push({
    label,
    stdin: typeof input === "string" ? input : JSON.stringify(input),
  });
}

function runObserver(s: HostObserverState, item: ObserverCase): ObserverRun {
  const result = spawnSync(process.execPath, [OBSERVER], {
    input: item.stdin,
    encoding: "utf8",
    env: item.env ?? { ...process.env },
    cwd: item.cwd ?? s.project,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    label: item.label,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    stdin: item.stdin,
  };
}

/** observerはhost versionで分岐しない（FR-03）。未検証versionを示す環境で再実行し出力を比べる。 */
Then(
  exact("AI_AGENTが未検証のhost versionを示す環境でも同じ警告を返す"),
  function () {
    const s = state(this);
    assert.ok(s.runs.length > 0);
    for (const item of s.runs) {
      assert.notEqual(item.stdout, "{}\n", item.label);
      const again = runObserver(s, {
        label: `${item.label}-unverified-host`,
        stdin: item.stdin,
        env: { ...process.env, AI_AGENT: "claude-code_9-9-999" },
      });
      assert.equal(again.status, 0);
      assert.equal(again.stdout, item.stdout, item.label);
    }
  },
);

function runAll(s: HostObserverState): ObserverRun[] {
  s.runs = s.cases.map((item) => runObserver(s, item));
  return s.runs;
}

function run(s: HostObserverState, label: string): ObserverRun {
  const found = s.runs.find((item) => item.label === label);
  assert.ok(found, `${label}の実行結果がありません`);
  return found;
}

/** stdoutは1行のJSONでなければならない。複数行はhostが解釈できない。 */
function output(item: ObserverRun): unknown {
  assert.equal(item.status, 0, `${item.label}: exit ${item.status}`);
  assert.equal(item.stderr, "", `${item.label}: stderr`);
  assert.match(item.stdout, /^[^\n]*\n$/u, `${item.label}: 1行出力`);
  return JSON.parse(item.stdout) as unknown;
}

function assertEmpty(item: ObserverRun): void {
  assert.deepEqual(output(item), {}, item.label);
  assert.equal(item.stdout, "{}\n", item.label);
}

function assertNoPermissionKeys(item: ObserverRun): void {
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(
        PERMISSION_KEYS.includes(key),
        false,
        `${item.label}: ${key}`,
      );
      visit(child);
    }
  };
  visit(output(item));
}

function sha256(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function snapshot(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const key = path.relative(root, file);
      const stat = fs.lstatSync(file);
      if (entry.isDirectory()) {
        result.set(key, `directory:${stat.mode}`);
        walk(file);
      } else if (entry.isFile())
        result.set(key, `file:${stat.mode}:${sha256(file)}`);
      else result.set(key, `other:${stat.mode}`);
    }
  };
  walk(root);
  return result;
}

// ---------------------------------------------------------------- SCN-001

Given(
  exact(
    "freshContextRequiredがtrueのASC handoffをmessageに含むPreToolUse(SendMessage)入力がある",
  ),
  function () {
    const s = state(this);
    s.values.workUnitId = workUnitId("scn-001");
    s.values.to = "a136d8cde23fa70ea";
    s.texts.input = JSON.stringify(
      sendMessage(
        s,
        "796fc6a0-0f0c-4184-912e-6722ba8b91f6",
        s.values.to,
        freshMessage(s.values.workUnitId),
      ),
    );
    s.cases = [{ label: "fresh", stdin: s.texts.input }];
  },
);

Given(exact("入力は未知のkeyを含む"), function () {
  const s = state(this);
  const input = JSON.parse(s.texts.input!) as Record<string, unknown>;
  input.unknown_future_field = { nested: [1, "x"] };
  (input.tool_input as Record<string, unknown>).recipient = "unknown";
  (input.tool_input as Record<string, unknown>).future = { a: 1 };
  s.cases = [{ label: "fresh", stdin: JSON.stringify(input) }];
});

When(exact("observerを実行する"), function () {
  runAll(state(this));
});

Then(exact("exit codeは0である"), function () {
  for (const item of state(this).runs)
    assert.equal(item.status, 0, `${item.label}: ${item.stderr}`);
});

Then(
  exact("systemMessageはfresh mismatchのowner指定文言と完全一致する"),
  function () {
    const s = state(this);
    const parsed = output(run(s, "fresh")) as { systemMessage?: unknown };
    assert.equal(parsed.systemMessage, FRESH_TEXT);
    assert.deepEqual(
      parsed,
      expectedWarning(FRESH_TEXT, s.values.workUnitId!, s.values.to!),
    );
  },
);

Then(exact("additionalContextはworkUnitIdと宛先agent_idを含む"), function () {
  const s = state(this);
  const parsed = output(run(s, "fresh")) as {
    hookSpecificOutput: { additionalContext: string };
  };
  const lines = parsed.hookSpecificOutput.additionalContext.split("\n");
  assert.deepEqual(lines, [
    FRESH_TEXT,
    `workUnitId: ${s.values.workUnitId}`,
    `agentId: ${s.values.to}`,
  ]);
});

Then(
  exact("出力はpermissionDecision・decision・continueを含まない"),
  function () {
    for (const item of state(this).runs) assertNoPermissionKeys(item);
  },
);

// ---------------------------------------------------------------- SCN-002

Given(
  exact(
    "宛先agentのsubagent transcript先頭にterminalAfterHandbackがtrueのASC handoffがある",
  ),
  function () {
    const s = state(this);
    s.values.session = "s-002";
    s.values.to = "aterminal00000002";
    s.values.terminalId = workUnitId("scn-002-terminal");
    placeTranscript(
      s.store,
      s.values.session,
      s.values.to,
      terminalTranscript(s.values.terminalId, s.values.to),
    );
  },
);

When(
  exact("messageにASC handoffを含まないSendMessage入力でobserverを実行する"),
  function () {
    const s = state(this);
    s.runs = [
      runObserver(s, {
        label: "terminal",
        stdin: JSON.stringify(sendMessage(s, s.values.session!, s.values.to)),
      }),
    ];
  },
);

Then(
  exact("systemMessageはterminal reuseのowner指定文言と完全一致する"),
  function () {
    const s = state(this);
    const parsed = output(run(s, "terminal")) as { systemMessage?: unknown };
    assert.equal(parsed.systemMessage, TERMINAL_TEXT);
    assert.deepEqual(
      parsed,
      expectedWarning(TERMINAL_TEXT, s.values.terminalId!, s.values.to!),
    );
  },
);

When(
  exact("messageにfresh handoffを含むSendMessage入力でobserverを実行する"),
  function () {
    const s = state(this);
    s.values.freshId = workUnitId("scn-002-fresh");
    s.runs = [
      runObserver(s, {
        label: "both",
        stdin: JSON.stringify(
          sendMessage(
            s,
            s.values.session!,
            s.values.to,
            freshMessage(s.values.freshId),
          ),
        ),
      }),
    ];
  },
);

Then(exact("警告はfresh mismatchの1件だけである"), function () {
  const s = state(this);
  assert.deepEqual(
    output(run(s, "both")),
    expectedWarning(FRESH_TEXT, s.values.freshId!, s.values.to!),
  );
});

// ---------------------------------------------------------------- SCN-003

Given(
  exact("messageにも宛先transcriptにもASC handoffが無いSendMessage入力がある"),
  function () {
    const s = state(this);
    const to = "aplain00000000001";
    placeTranscript(
      s.store,
      "s-003-plain",
      to,
      `${transcriptLine("asc-handoff/v1 という語だけを含む{文章}", to)}\n${JSON.stringify({ kind: "other", workUnit: { workUnitId: workUnitId("x"), freshContextRequired: true, terminalAfterHandback: true } })}\n`,
    );
    add(
      s,
      "plain",
      sendMessage(s, "s-003-plain", to, "asc-handoff/v1 の{説明}だけ"),
    );
    add(s, "non-string-message", {
      ...sendMessage(s, "s-003-plain", to),
      tool_input: { to, message: 42 },
    });
  },
);

Given(
  exact(
    "宛先transcriptが存在しない、またはdirectoryで読めないSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    const session = "s-003-unreadable";
    add(s, "missing", sendMessage(s, session, "amissing000000001"));
    fs.mkdirSync(
      path.join(s.store, session, "subagents", "agent-adirectory0000001.jsonl"),
      { recursive: true },
    );
    add(s, "directory", sendMessage(s, session, "adirectory0000001"));
    if (process.platform !== "win32") {
      // symlinkの先にterminal handoffがあっても読まない（lstatとfstatの照合）。
      const real = path.join(s.root, "outside-terminal.jsonl");
      fs.writeFileSync(
        real,
        terminalTranscript(workUnitId("symlink"), "asymlink000000001"),
      );
      const link = path.join(
        s.store,
        session,
        "subagents",
        "agent-asymlink000000001.jsonl",
      );
      fs.symlinkSync(real, link);
      add(s, "symlink", sendMessage(s, session, "asymlink000000001"));
    }
  },
);

Given(
  exact(
    "SessionStart・SubagentStart・SubagentStop・PostToolUse・PostToolUseFailure・PreToolUse(Bash)・PreToolUse(Edit)・PreToolUse(Agent)の入力がある",
  ),
  function () {
    const s = state(this);
    const session = "s-003-events";
    const to = "aevents000000001";
    placeTranscript(
      s.store,
      session,
      to,
      terminalTranscript(workUnitId("events-terminal"), to),
    );
    const base = {
      session_id: session,
      transcript_path: path.join(s.store, `${session}.jsonl`),
      cwd: s.project,
    };
    const message = freshMessage(workUnitId("events-fresh"));
    add(s, "SessionStart", {
      ...base,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    add(s, "SubagentStart", {
      ...base,
      hook_event_name: "SubagentStart",
      agent_id: to,
      agent_type: "general-purpose",
    });
    add(s, "SubagentStop", {
      ...base,
      hook_event_name: "SubagentStop",
      agent_id: to,
      agent_type: "general-purpose",
    });
    for (const event of ["PostToolUse", "PostToolUseFailure"])
      add(s, `${event}(SendMessage)`, {
        ...base,
        hook_event_name: event,
        tool_name: "SendMessage",
        tool_input: { to, message },
      });
    for (const tool of ["Bash", "Edit", "Agent"])
      add(s, `PreToolUse(${tool})`, {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: {
          to,
          message,
          prompt: message,
          command: "echo probe",
          file_path: "src/a.ts",
        },
      });
  },
);

Given(
  exact(
    "tool_input.to・session_id・transcript_pathのいずれかが欠けhandoffを含まないSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    const session = "s-003-missing";
    const to = "amissingfield0001";
    placeTranscript(
      s.store,
      session,
      to,
      terminalTranscript(workUnitId("missing-field"), to),
    );
    const complete = sendMessage(s, session, to);
    const withoutTo = structuredClone(complete);
    delete (withoutTo.tool_input as Record<string, unknown>).to;
    add(s, "without-to", withoutTo);
    const withoutSession = structuredClone(complete);
    delete withoutSession.session_id;
    add(s, "without-session", withoutSession);
    const withoutTranscript = structuredClone(complete);
    delete withoutTranscript.transcript_path;
    add(s, "without-transcript", withoutTranscript);
    add(s, "relative-transcript", {
      ...complete,
      transcript_path: `relative/${session}.jsonl`,
    });
    add(s, "nul-transcript", {
      ...complete,
      transcript_path: `${complete.transcript_path as string}\0x`,
    });
    const withoutToolInput = structuredClone(complete);
    delete withoutToolInput.tool_input;
    add(s, "without-tool-input", withoutToolInput);
  },
);

Given(exact("判定中に例外が起きる型のworkUnitを持つ入力がある"), function () {
  const s = state(this);
  const session = "s-003-types";
  const variants: Array<[string, unknown]> = [
    ["string", "work-unit"],
    ["array", [1, 2]],
    ["number", 42],
    ["null", null],
    [
      "nested-id",
      {
        workUnitId: { toString: "x" },
        freshContextRequired: true,
        terminalAfterHandback: true,
      },
    ],
  ];
  for (const [name, workUnit] of variants) {
    const to = `atype${name.replaceAll("-", "")}`;
    const bad = { kind: "asc-handoff/v1", workUnit };
    placeTranscript(
      s.store,
      session,
      to,
      `${transcriptLine(dispatchPrompt(bad), to)}\n`,
    );
    add(s, `type-${name}`, sendMessage(s, session, to, dispatchPrompt(bad)));
  }
  let deep: unknown = handoff(workUnitId("deep"), true, true);
  for (let index = 0; index < 40; index += 1) deep = { nested: deep };
  add(
    s,
    "deep",
    sendMessage(
      s,
      session,
      "atypedeep",
      `asc-handoff/v1 ${JSON.stringify(deep)}`,
    ),
  );
  add(s, "tool-input-string", {
    ...sendMessage(s, session, "atypes"),
    tool_input: "asc-handoff/v1",
  });
  add(s, "tool-input-null", {
    ...sendMessage(s, session, "atypes"),
    tool_input: null,
  });
  add(s, "to-number", sendMessage(s, session, 12345));
});

Given(
  exact(
    "workUnitIdが16進64桁でない、またはfreshContextRequiredが文字列のhandoffを含むSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    const session = "s-003-invalid";
    const id = workUnitId("invalid");
    const bad: Array<[string, Record<string, unknown>]> = [
      ["uppercase", handoff(id.toUpperCase(), true, true)],
      ["short", handoff(id.slice(0, 63), true, true)],
      ["long", handoff(`${id}0`, true, true)],
      ["fresh-string", handoff(id, "true", true)],
      ["terminal-string", handoff(id, true, "true")],
      ["kind-suffix", handoff(id, true, true, { kind: "asc-handoff/v1x" })],
      ["kind-missing", handoff(id, true, true, { kind: undefined })],
    ];
    for (const [name, value] of bad) {
      const to = `ainvalid${name.replaceAll("-", "")}`;
      // 同じ不完全handoffをtranscript側にも置き、terminal経路でも認めないことを確かめる。
      placeTranscript(
        s.store,
        session,
        to,
        `${transcriptLine(dispatchPrompt(value), to)}\n`,
      );
      add(
        s,
        `message-${name}`,
        sendMessage(s, session, to, dispatchPrompt(value)),
      );
    }
  },
);

Given(
  exact(
    "宛先transcriptの最初のuser行のdispatch promptにASC handoffが無く、後続行とtool_result blockだけにterminal handoffがあるSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    const session = "s-003-toolresult";
    const resultLine = (agentId: string) =>
      JSON.stringify({
        isSidechain: true,
        agentId,
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_advance",
              content: dispatchPrompt(
                handoff(workUnitId("read-only"), true, true),
              ),
            },
          ],
        },
      });
    // workflow advanceの出力を読んだだけのagent。担当したのは別の通常taskである。
    const reader = "areader000000001";
    placeTranscript(
      s.store,
      session,
      reader,
      `${transcriptLine("通常taskを処理してください。", reader)}\n${ASSISTANT_LINE}\n${resultLine(reader)}\n`,
    );
    add(s, "tool-result-line", sendMessage(s, session, reader));
    // 最初のuser行がtool_result blockを持つ場合も、text block以外は見ない。
    const block = "ablock0000000001";
    placeTranscript(
      s.store,
      session,
      block,
      `${resultLine(block)}\n${ASSISTANT_LINE}\n`,
    );
    add(s, "tool-result-block", sendMessage(s, session, block));
    // 後続のuser行がtext本文でhandoffを持っても、最初のuser行ではないため見ない。
    const later = "alaterline000001";
    placeTranscript(
      s.store,
      session,
      later,
      `${transcriptLine("通常taskを処理してください。", later)}\n${ASSISTANT_LINE}\n${terminalTranscript(workUnitId("later-line"), later)}`,
    );
    add(s, "later-user-line", sendMessage(s, session, later));
  },
);

Given(
  exact(
    "宛先transcriptのsession_id directoryまたはsubagents directoryがsymlinkで、その先にterminal handoffがあるSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    if (process.platform === "win32") return;
    const outside = path.join(s.root, "outside-store");
    const to = "alinkeddir000001";
    // session_id directoryそのものがsymlink。
    placeTranscript(
      outside,
      "s-003-real",
      to,
      terminalTranscript(workUnitId("linked-session"), to),
    );
    fs.symlinkSync(
      path.join(outside, "s-003-real"),
      path.join(s.store, "s-003-linked-session"),
      "dir",
    );
    add(s, "linked-session", sendMessage(s, "s-003-linked-session", to));
    // subagents directoryだけがsymlink。
    fs.mkdirSync(path.join(s.store, "s-003-linked-subagents"));
    fs.symlinkSync(
      path.join(outside, "s-003-real", "subagents"),
      path.join(s.store, "s-003-linked-subagents", "subagents"),
      "dir",
    );
    add(s, "linked-subagents", sendMessage(s, "s-003-linked-subagents", to));
  },
);

Given(
  exact(
    "走査文字数または候補数の上限に達した後にだけfresh handoffが現れるSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    const body = JSON.stringify(handoff(workUnitId("budget"), true, false));
    // 63個の未閉鎖`{`がそれぞれ末尾まで走査し、合計がおよそ130万文字になる。
    const steps = `asc-handoff/v1 ${"{".repeat(63)}${"a".repeat(20800)}${body}`;
    assert.ok(steps.length < TRANSCRIPT_LIMIT);
    add(
      s,
      "scan-budget",
      sendMessage(s, "s-003-budget", "abudgetsteps0001", steps),
    );
    // 外側の文字列が候補64回を使い切る。内側の文字列の先頭の候補がhandoffである。
    const nested = `asc-handoff/v1 ${"{".repeat(63)}${JSON.stringify({ a: `asc-handoff/v1 ${body}` })}`;
    add(
      s,
      "candidate-budget",
      sendMessage(s, "s-003-budget", "abudgetcands0001", nested),
    );
  },
);

/** 文字列ごと・入れ子の段ごとに上限を数える実装では、走査が段数分だけ累積する（R1-A-02）。 */
function unclosedNesting(level: number, pad: number): string {
  const head = `asc-handoff/v1 ${"{".repeat(63)}`;
  if (level === 0) return `${head}${"a".repeat(pad)}`;
  return `${head}${JSON.stringify({ a: unclosedNesting(level - 1, pad) })}${"a".repeat(pad)}`;
}

Given(
  exact(
    "4段の入れ子それぞれに63個の未閉鎖の{を持つ7 MB超のmessageを含むSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    const stdin = JSON.stringify(
      sendMessage(
        s,
        "s-003-crafted",
        "acrafted00000001",
        unclosedNesting(3, 1_900_000),
      ),
    );
    assert.ok(Buffer.byteLength(stdin) > 7_000_000);
    assert.ok(Buffer.byteLength(stdin) < 8 * 1024 * 1024);
    s.cases.push({ label: "crafted", stdin });
  },
);

Then(exact("出力は{}、exit codeは0、stderrは空である"), function () {
  const s = state(this);
  assert.ok(s.runs.length > 0);
  for (const item of s.runs) assertEmpty(item);
});

// ---------------------------------------------------------------- SCN-004

const TRANSCRIPT_LIMIT = 262144;

/** handoff行の末尾（`}`）がちょうど`endByte`バイト目になるtranscriptを作る。 */
function boundaryTranscript(id: string, agentId: string, endByte: number) {
  const line = transcriptLine(dispatchPrompt(handoff(id, true, true)), agentId);
  const prefix = '{"type":"progress","pad":"';
  const suffix = '"}\n';
  const padding =
    endByte - Buffer.byteLength(line) - prefix.length - suffix.length;
  assert.ok(padding > 0);
  const body = `${prefix}${"x".repeat(padding)}${suffix}${line}\n${ASSISTANT_LINE}\n`;
  assert.equal(
    Buffer.byteLength(body.slice(0, body.indexOf(line) + line.length)),
    endByte,
  );
  return body;
}

Given(
  exact(
    "terminal handoffが先頭256 KiB以内にあるtranscriptと256 KiBより後ろだけにあるtranscriptがある",
  ),
  function () {
    const s = state(this);
    s.values.session = "s-004";
    s.values.insideId = workUnitId("inside");
    placeTranscript(
      s.store,
      s.values.session,
      "ainside0000000001",
      boundaryTranscript(
        s.values.insideId,
        "ainside0000000001",
        TRANSCRIPT_LIMIT,
      ),
    );
    placeTranscript(
      s.store,
      s.values.session,
      "aoverbyone0000001",
      boundaryTranscript(
        workUnitId("over"),
        "aoverbyone0000001",
        TRANSCRIPT_LIMIT + 1,
      ),
    );
    placeTranscript(
      s.store,
      s.values.session,
      "aoutside00000001",
      boundaryTranscript(workUnitId("outside"), "aoutside00000001", 300000),
    );
  },
);

When(exact("それぞれを宛先としてobserverを実行する"), function () {
  const s = state(this);
  for (const to of [
    "ainside0000000001",
    "aoverbyone0000001",
    "aoutside00000001",
  ])
    add(s, to, sendMessage(s, s.values.session!, to));
  runAll(s);
});

Then(exact("前者だけがterminal reuse警告を返し後者は{}を返す"), function () {
  const s = state(this);
  assert.deepEqual(
    output(run(s, "ainside0000000001")),
    expectedWarning(TERMINAL_TEXT, s.values.insideId!, "ainside0000000001"),
  );
  assertEmpty(run(s, "aoverbyone0000001"));
  assertEmpty(run(s, "aoutside00000001"));
});

When(
  exact(
    "fresh handoffが先頭262144文字以内で終わるmessageと262144文字より後ろで終わるmessageでobserverを実行する",
  ),
  function () {
    const s = state(this);
    s.values.messageInsideId = workUnitId("message-inside");
    /** handoff objectの閉じ括弧がちょうど`endChar`文字目になるmessage。 */
    const message = (id: string, endChar: number): string => {
      const body = JSON.stringify(handoff(id, true, false));
      const text = `${"x".repeat(endChar - body.length)}${body} 後続`;
      assert.equal(text.indexOf(body) + body.length, endChar);
      return text;
    };
    s.cases = [
      {
        label: "message-inside",
        stdin: JSON.stringify(
          sendMessage(
            s,
            "s-004-message",
            "amsginside000001",
            message(s.values.messageInsideId, TRANSCRIPT_LIMIT),
          ),
        ),
      },
      {
        label: "message-over",
        stdin: JSON.stringify(
          sendMessage(
            s,
            "s-004-message",
            "amsgover00000001",
            message(workUnitId("message-over"), TRANSCRIPT_LIMIT + 1),
          ),
        ),
      },
    ];
    runAll(s);
  },
);

Then(exact("前者だけがfresh mismatch警告を返し後者は{}を返す"), function () {
  const s = state(this);
  assert.deepEqual(
    output(run(s, "message-inside")),
    expectedWarning(FRESH_TEXT, s.values.messageInsideId!, "amsginside000001"),
  );
  assertEmpty(run(s, "message-over"));
});

// ---------------------------------------------------------------- SCN-005

Given(
  exact(
    "入力が不正JSON、空、JSON配列、数値、1 MiBの不正文字列のいずれかである",
  ),
  function () {
    const s = state(this);
    add(s, "invalid-json", '{"hook_event_name":"PreToolUse",');
    add(s, "empty", "");
    add(s, "array", "[1,2]");
    add(s, "number", "42");
    add(s, "one-mebibyte", `{${"x".repeat(1024 * 1024)}`);
    // 8 MiBの読取上限を超える入力は、警告に当たる内容でも`{}`へ倒す。
    const huge = sendMessage(
      s,
      "s-005",
      "ahuge000000000001",
      freshMessage(workUnitId("huge")),
    );
    huge.padding = "y".repeat(9 * 1024 * 1024);
    add(s, "over-limit", huge);
  },
);

// ---------------------------------------------------------------- SCN-006

Given(
  exact(
    "EXP-1 fixtureのcoordinatorによるAgent A・Bの起動入力と、それぞれのagentIdがある",
  ),
  function () {
    const s = state(this);
    const events = loadFixture("exp1");
    const launches = events.filter(
      (event) =>
        event.event === "PreToolUse" &&
        event.identity.tool_name === "Agent" &&
        event.identity.agent_id === undefined,
    );
    const starts = events.filter((event) => event.event === "SubagentStart");
    assert.equal(launches.length, 2);
    s.values.a = starts[0]!.identity.agent_id as string;
    s.values.b = starts[1]!.identity.agent_id as string;
    s.values.session = events[0]!.identity.session_id as string;
    for (const [label, event] of [
      ["launch-A", launches[0]!],
      ["launch-B", launches[1]!],
    ] as const)
      add(
        s,
        label,
        hookInput(event, s, {
          prompt: dispatchPrompt(handoff(workUnitId(label))),
        }),
      );
    s.values.sendIndex = String(
      events.findIndex((event) => event.identity.tool_name === "SendMessage"),
    );
  },
);

When(
  exact(
    "各入力でobserverを実行し、Bへfresh handoffをSendMessageする入力でも実行する",
  ),
  function () {
    const s = state(this);
    const event = loadFixture("exp1")[Number(s.values.sendIndex)]!;
    s.values.freshId = workUnitId("scn-006-fresh");
    add(
      s,
      "send-B",
      hookInput(event, s, {
        to: s.values.b,
        message: freshMessage(s.values.freshId),
      }),
    );
    runAll(s);
  },
);

Then(exact("A・Bの起動はどちらも{}である"), function () {
  const s = state(this);
  assertEmpty(run(s, "launch-A"));
  assertEmpty(run(s, "launch-B"));
});

Then(exact("AとBのagentIdは異なる"), function () {
  const s = state(this);
  assert.match(s.values.a!, /^[A-Za-z0-9_-]{1,128}$/u);
  assert.match(s.values.b!, /^[A-Za-z0-9_-]{1,128}$/u);
  assert.notEqual(s.values.a, s.values.b);
});

Then(
  exact("Bへの送信の警告はBのagent_idを含みAのagent_idを含まない"),
  function () {
    const s = state(this);
    const item = run(s, "send-B");
    assert.deepEqual(
      output(item),
      expectedWarning(FRESH_TEXT, s.values.freshId!, s.values.b!),
    );
    assert.equal(item.stdout.includes(s.values.a!), false);
  },
);

// ---------------------------------------------------------------- SCN-007

Given(exact("Aのtranscript先頭にterminal handoffがある"), function () {
  const s = state(this);
  for (const name of ["exp1", "exp3"] as const) {
    const events = loadFixture(name);
    const agent = events.find((event) => event.event === "SubagentStart")!
      .identity.agent_id as string;
    const session = events[0]!.identity.session_id as string;
    s.values[`${name}-agent`] = agent;
    s.values[`${name}-id`] = workUnitId(`${name}-terminal`);
    // EXP-3側はcontentをtext blockの配列で持つ形にする。
    const prompt = dispatchPrompt(handoff(s.values[`${name}-id`]!, true, true));
    placeTranscript(
      s.store,
      session,
      agent,
      name === "exp1"
        ? terminalTranscript(s.values[`${name}-id`]!, agent)
        : `${JSON.stringify({
            isSidechain: true,
            agentId: agent,
            type: "user",
            message: {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", data: "" } },
                { type: "text", text: prompt },
              ],
            },
          })}\n${ASSISTANT_LINE}\n`,
    );
  }
});

Given(
  exact(
    "EXP-1の同一session内、EXP-3のsession resume後、/compact後のAへのSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    const exp1 = loadFixture("exp1").filter(
      (event) =>
        event.event === "PreToolUse" &&
        event.identity.tool_name === "SendMessage",
    );
    const exp3 = loadFixture("exp3").filter(
      (event) =>
        event.event === "PreToolUse" &&
        event.identity.tool_name === "SendMessage",
    );
    assert.equal(exp1.length, 1);
    assert.equal(exp3.length, 2);
    const cases: Array<[string, FixtureEvent, string]> = [
      ["same-session", exp1[0]!, "exp1"],
      ["after-resume", exp3[0]!, "exp3"],
      ["after-compact", exp3[1]!, "exp3"],
    ];
    for (const [label, event, name] of cases) {
      assert.equal(event.toolInput?.to, s.values[`${name}-agent`]);
      add(s, label, defaultFixtureInput(event, s));
      s.expected.set(
        label,
        expectedWarning(
          TERMINAL_TEXT,
          s.values[`${name}-id`]!,
          s.values[`${name}-agent`]!,
        ),
      );
    }
  },
);

When(exact("各入力でobserverを実行する"), function () {
  runAll(state(this));
});

Then(
  exact("いずれもterminal reuse警告を返しAのagent_idを付記する"),
  function () {
    const s = state(this);
    assert.equal(s.expected.size, 3);
    for (const [label, expected] of s.expected)
      assert.deepEqual(output(run(s, label)), expected, label);
  },
);

// ---------------------------------------------------------------- SCN-008

Given(
  exact(
    "同じpreview由来の同一workUnitIdのhandoffを渡す2件のPreToolUse(Agent)入力がある",
  ),
  function () {
    const s = state(this);
    s.values.same = workUnitId("same-preview");
    const launches = loadFixture("exp1").filter(
      (event) =>
        event.event === "PreToolUse" && event.identity.tool_name === "Agent",
    );
    for (const [index, event] of launches.entries())
      add(
        s,
        `agent-${index}`,
        hookInput(event, s, {
          prompt: dispatchPrompt(handoff(s.values.same, true, true)),
        }),
      );
  },
);

Given(
  exact(
    "宛先agent_idがworkUnitIdと同じ文字列のSendMessage入力と異なる文字列のSendMessage入力がある",
  ),
  function () {
    const s = state(this);
    const message = freshMessage(s.values.same!);
    add(s, "send-same", sendMessage(s, "s-008", s.values.same, message));
    add(s, "send-other", sendMessage(s, "s-008", "a227ddd38a2c6a2e1", message));
  },
);

Then(exact("2件のAgent起動はどちらも{}である"), function () {
  const s = state(this);
  assertEmpty(run(s, "agent-0"));
  assertEmpty(run(s, "agent-1"));
});

Then(exact("2件のSendMessageの判定結果は同じである"), function () {
  const s = state(this);
  const same = output(run(s, "send-same"));
  const other = output(run(s, "send-other"));
  assert.deepEqual(
    same,
    expectedWarning(FRESH_TEXT, s.values.same!, s.values.same!),
  );
  assert.deepEqual(
    other,
    expectedWarning(FRESH_TEXT, s.values.same!, "a227ddd38a2c6a2e1"),
  );
});

// ---------------------------------------------------------------- SCN-009

Given(
  exact("EXP-2 fixtureのisolation worktree内Agentの全event入力がある"),
  function () {
    const s = state(this);
    const events = loadFixture("exp2");
    assert.equal(
      events.some((event) => event.toolInput?.isolation === "worktree"),
      true,
    );
    for (const event of events)
      add(s, `exp2#${event.index}`, defaultFixtureInput(event, s));
  },
);

Then(exact("すべて{}でありpermission系keyを含まない"), function () {
  const s = state(this);
  assert.equal(s.runs.length, 33);
  for (const item of s.runs) {
    assertEmpty(item);
    assertNoPermissionKeys(item);
  }
});

// ---------------------------------------------------------------- SCN-010

Given(
  exact(
    "session_idが異なる2件の入力と、別sessionのtranscriptが置かれたdirectoryがある",
  ),
  function () {
    const s = state(this);
    const to = "ashared000000001";
    s.values.otherId = workUnitId("other-session");
    placeTranscript(
      s.store,
      "other-session-0001",
      to,
      terminalTranscript(s.values.otherId, to),
    );
    add(s, "self", sendMessage(s, "self-session-0001", to));
    add(s, "other", sendMessage(s, "other-session-0001", to));
    s.values.freshId = workUnitId("self-fresh");
    add(
      s,
      "self-fresh",
      sendMessage(s, "self-session-0001", to, freshMessage(s.values.freshId)),
    );
  },
);

Then(
  exact("出力はpermission系keyを含まず、判定は宛先とhandoffだけで決まる"),
  function () {
    const s = state(this);
    for (const item of s.runs) assertNoPermissionKeys(item);
    assertEmpty(run(s, "self"));
    assert.deepEqual(
      output(run(s, "other")),
      expectedWarning(TERMINAL_TEXT, s.values.otherId!, "ashared000000001"),
    );
    assert.deepEqual(
      output(run(s, "self-fresh")),
      expectedWarning(FRESH_TEXT, s.values.freshId!, "ashared000000001"),
    );
  },
);

// ---------------------------------------------------------------- SCN-011

Given(
  exact("EXP-3 fixtureのSubagentStartなしのSubagentStop入力を処理した後である"),
  function () {
    const s = state(this);
    const events = loadFixture("exp3");
    const started = new Set(
      events
        .filter((event) => event.event === "SubagentStart")
        .map((event) => event.identity.agent_id),
    );
    const orphan = events.filter(
      (event) =>
        event.event === "SubagentStop" && !started.has(event.identity.agent_id),
    );
    assert.equal(orphan.length, 1);
    const stop = runObserver(s, {
      label: "orphan-stop",
      stdin: JSON.stringify(hookInput(orphan[0]!, s)),
    });
    assertEmpty(stop);
    s.baseline = [stop];
  },
);

When(
  exact("次のWork UnitのPreToolUse(Agent)入力でobserverを実行する"),
  function () {
    const s = state(this);
    const launch = loadFixture("exp3").find(
      (event) =>
        event.event === "PreToolUse" && event.identity.tool_name === "Agent",
    )!;
    add(
      s,
      "next-agent",
      hookInput(launch, s, {
        prompt: dispatchPrompt(handoff(workUnitId("next-work-unit"))),
      }),
    );
    runAll(s);
  },
);

Then(exact("出力は{}でありexit codeは0である"), function () {
  const s = state(this);
  assertEmpty(run(s, "next-agent"));
  assert.equal(run(s, "next-agent").status, 0);
});

// ---------------------------------------------------------------- SCN-012

Given(
  exact("PermissionRequestとPermissionDeniedの入力を処理した後である"),
  function () {
    const s = state(this);
    const request = loadFixture("exp1").find(
      (event) => event.event === "PermissionRequest",
    )!;
    const denied = {
      ...hookInput(request, s),
      hook_event_name: "PermissionDenied",
      reason: "denied by mode",
    };
    s.baseline = [
      runObserver(s, {
        label: "request",
        stdin: JSON.stringify(hookInput(request, s)),
      }),
      runObserver(s, { label: "denied", stdin: JSON.stringify(denied) }),
    ];
    for (const item of s.baseline) assertEmpty(item);
  },
);

When(
  exact(
    "次のWork UnitのPreToolUse(Agent)入力とhandoffの無いSendMessage入力でobserverを実行する",
  ),
  function () {
    const s = state(this);
    const events = loadFixture("exp1");
    const agent = events.find(
      (event) =>
        event.event === "PreToolUse" && event.identity.tool_name === "Agent",
    )!;
    const send = events.find(
      (event) =>
        event.event === "PreToolUse" &&
        event.identity.tool_name === "SendMessage",
    )!;
    add(
      s,
      "agent",
      hookInput(agent, s, {
        prompt: dispatchPrompt(handoff(workUnitId("after-denied"))),
      }),
    );
    add(s, "send", defaultFixtureInput(send, s));
    runAll(s);
  },
);

Then(exact("どちらも{}である"), function () {
  const s = state(this);
  assertEmpty(run(s, "agent"));
  assertEmpty(run(s, "send"));
});

// ---------------------------------------------------------------- SCN-013

Given(
  exact(
    ".agent-skill-chain配下に旧lifecycle state fileがあり、古いterminal handoffを持つtranscriptがある",
  ),
  function () {
    const s = state(this);
    const stateDirectory = path.join(
      s.project,
      ".agent-skill-chain/runtime/agent-lifecycle",
    );
    fs.mkdirSync(stateDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(stateDirectory, "state.json"),
      JSON.stringify({
        reservations: [{ agentId: "a136d8cde23fa70ea", status: "exhausted" }],
        denied: true,
      }),
    );
    const events = loadFixture("exp1");
    s.values.agent = events.find((event) => event.event === "SubagentStart")!
      .identity.agent_id as string;
    s.values.session = events[0]!.identity.session_id as string;
    s.values.oldId = workUnitId("old-terminal");
    placeTranscript(
      s.store,
      s.values.session,
      s.values.agent,
      terminalTranscript(s.values.oldId, s.values.agent),
    );
  },
);

When(exact("fixture全件と警告対象入力でobserverを実行する"), function () {
  const s = state(this);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: s.project };
  s.cases = [
    ...fixtureCases(s),
    {
      label: "warn-fresh",
      stdin: JSON.stringify(
        sendMessage(
          s,
          s.values.session!,
          s.values.agent,
          freshMessage(workUnitId("fresh-013")),
        ),
      ),
    },
    {
      label: "warn-terminal",
      stdin: JSON.stringify(sendMessage(s, s.values.session!, s.values.agent)),
    },
  ].map((item) => ({ ...item, env }));
  s.baseline = runAll(s);
  fs.rmSync(path.join(s.project, ".agent-skill-chain"), {
    recursive: true,
    force: true,
  });
  runAll(s);
});

Then(exact("どの出力もpermission系keyを含まない"), function () {
  const s = state(this);
  for (const item of [...s.baseline!, ...s.runs]) assertNoPermissionKeys(item);
});

Then(
  exact("旧state fileを削除して実行した場合と出力が同一である"),
  function () {
    const s = state(this);
    assert.equal(s.baseline!.length, 106 + 2);
    // 経過時間は観測値ではないため、出力・終了code・stderrだけを比べる。
    const observable = ({ label, status, stdout, stderr }: ObserverRun) => ({
      label,
      status,
      stdout,
      stderr,
    });
    assert.deepEqual(s.runs.map(observable), s.baseline!.map(observable));
    assert.deepEqual(
      output(run(s, "warn-terminal")),
      expectedWarning(TERMINAL_TEXT, s.values.oldId!, s.values.agent!),
    );
    assert.equal(
      (output(run(s, "warn-fresh")) as { systemMessage: string }).systemMessage,
      FRESH_TEXT,
    );
  },
);

// ---------------------------------------------------------------- SCN-014

Given(
  exact(
    "2つのworktreeのcwdで同じrelative pathを対象とするPreToolUse(Edit)とPreToolUse(Write)の入力がある",
  ),
  function () {
    const s = state(this);
    for (const name of ["wt-a", "wt-b"]) {
      const cwd = path.join(s.root, name);
      fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
      for (const tool of ["Edit", "Write"])
        for (const target of [
          "src/shared.ts",
          path.join(cwd, "src", "shared.ts"),
        ])
          s.cases.push({
            label: `${name}-${tool}-${target}`,
            cwd,
            stdin: JSON.stringify({
              session_id: `session-${name}`,
              transcript_path: path.join(s.store, `session-${name}.jsonl`),
              cwd,
              permission_mode: "default",
              hook_event_name: "PreToolUse",
              tool_name: tool,
              tool_input: {
                file_path: target,
                old_string: "a",
                new_string: "b",
                content: "b",
              },
              tool_use_id: `toolu-${name}`,
            }),
          });
    }
  },
);

Then(exact("すべて{}である"), function () {
  const s = state(this);
  assert.equal(s.runs.length, 8);
  for (const item of s.runs) assertEmpty(item);
});

// ---------------------------------------------------------------- SCN-015

Given(exact("fixture全件と警告対象入力がある"), function () {
  const s = state(this);
  const home = path.join(s.root, "home");
  const temporary = path.join(s.root, "tmp");
  fs.mkdirSync(temporary, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    CLAUDE_PROJECT_DIR: s.project,
  };
  const messageMarker = "SECRETMESSAGEMARKER7f3a";
  const transcriptMarker = "SECRETTRANSCRIPTMARKER9c1e";
  s.markers = [messageMarker, transcriptMarker];
  const to = "asecret000000001";
  const session = "s-015";
  s.values.terminalId = workUnitId("secret-terminal");
  placeTranscript(
    s.store,
    session,
    to,
    terminalTranscript(s.values.terminalId, to, `${transcriptMarker} 本文`),
  );
  s.values.freshId = workUnitId("secret-fresh");
  s.cases = [
    ...fixtureCases(s, `${messageMarker} 本文`),
    {
      label: "warn-fresh",
      stdin: JSON.stringify(
        sendMessage(
          s,
          session,
          to,
          `${messageMarker}${freshMessage(s.values.freshId)}${messageMarker}`,
        ),
      ),
    },
    {
      label: "warn-terminal",
      stdin: JSON.stringify(
        sendMessage(s, session, to, `${messageMarker} 本文 ${messageMarker}`),
      ),
    },
  ].map((item) => ({ ...item, env, cwd: s.project }));
});

When(
  exact("実行前後でproject directoryとHOME相当directoryを比較する"),
  function () {
    const s = state(this);
    s.before = snapshot(s.root);
    runAll(s);
    s.after = snapshot(s.root);
  },
);

Then(exact("内容は同一である"), function () {
  const s = state(this);
  assert.ok(s.before!.size > 0);
  assert.deepEqual([...s.after!.entries()], [...s.before!.entries()]);
  assert.deepEqual(
    output(run(s, "warn-fresh")),
    expectedWarning(FRESH_TEXT, s.values.freshId!, "asecret000000001"),
  );
  assert.deepEqual(
    output(run(s, "warn-terminal")),
    expectedWarning(TERMINAL_TEXT, s.values.terminalId!, "asecret000000001"),
  );
});

Then(exact("出力はmessage本文とtranscript本文の文字列を含まない"), function () {
  const s = state(this);
  for (const item of s.runs)
    for (const marker of [...s.markers, "本文", "worker prompt"]) {
      assert.equal(item.stdout.includes(marker), false, item.label);
      assert.equal(item.stderr.includes(marker), false, item.label);
    }
});

// ---------------------------------------------------------------- SCN-016

const WORKFLOW = ".github/workflows/host-observer-portability.yml";

function sourceFiles(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(path.join(directory, entry.name))
        : entry.name.endsWith(".ts")
          ? [path.join(directory, entry.name)]
          : [],
    );
}

Given(
  exact(
    "observer本体、workflow・review・deliveryのsource、.github/workflowsの新規workflowがある",
  ),
  function () {
    const s = state(this);
    s.texts.observer = fs.readFileSync(OBSERVER, "utf8");
    s.texts.workflow = fs.readFileSync(WORKFLOW, "utf8");
  },
);

When(exact("importとAPI利用とworkflow定義を静的に検査する"), function () {
  const s = state(this);
  const observer = s.texts.observer!;
  const imports = [
    ...observer.matchAll(
      /\bimport\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gu,
    ),
    ...observer.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/gu),
    ...observer.matchAll(/\brequire\s*\(\s*["']([^"']+)["']/gu),
  ].map((match) => match[1]!);
  s.values.imports = JSON.stringify(imports.sort());
  const forbidden: Array<[string, RegExp]> = [
    ["child_process", /child_process/u],
    ["/tmp", /\/tmp\b/u],
    ["os.tmpdir", /\btmpdir\b/u],
    ["/bin/sh", /\/bin\/sh|cmd\.exe|powershell/iu],
    [
      "exec",
      /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/u,
    ],
    ["timer", /\b(?:setTimeout|setInterval|setImmediate)\b|Atomics\.wait/u],
    ["process.exit", /\bprocess\.exit\s*\(/u],
    [
      "fs write",
      /\.(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rename|renameSync|unlink|unlinkSync|rm|rmSync|createWriteStream)\s*\(/u,
    ],
  ];
  s.values.violations = JSON.stringify(
    forbidden
      .filter(([, pattern]) => pattern.test(observer))
      .map(([name]) => name),
  );
});

Then(
  exact(
    "observerのimportはnode:fs、node:path、node:process、node:cryptoに限られchild_processと固定temp pathを含まない",
  ),
  function () {
    const s = state(this);
    const imports = JSON.parse(s.values.imports!) as string[];
    assert.ok(imports.length > 0);
    for (const specifier of imports)
      assert.ok(
        ["node:fs", "node:path", "node:process", "node:crypto"].includes(
          specifier,
        ),
        specifier,
      );
    assert.deepEqual(JSON.parse(s.values.violations!), []);
  },
);

Then(
  exact("workflow・review・deliveryのsourceはobserverを参照しない"),
  function () {
    const files = sourceFiles("src");
    const gates = files.filter((file) =>
      /(?:^|[\\/])(?:workflow|review|delivery)[^\\/]*\.ts$/u.test(file),
    );
    assert.ok(
      gates.length >= 6,
      `workflow・review・delivery source ${gates.length}件`,
    );
    // 登録と配布を担うlifecycleの2 file以外はobserverを名指ししない。
    const allowed = new Set([
      path.join("src", "domain", "lifecycle.ts"),
      path.join("src", "domain", "lifecycle-settings.ts"),
    ]);
    for (const file of files)
      if (!allowed.has(file))
        assert.equal(
          fs.readFileSync(file, "utf8").includes("asc-host-observer"),
          false,
          file,
        );
  },
);

Then(
  exact(
    "新規CI workflowはubuntu-latest、macos-latest、windows-latestでshellを介さずobserverのportable testを実行し、読取権限だけを持つ",
  ),
  function () {
    const s = state(this);
    const workflow = s.texts.workflow!;
    const lines = workflow.split(/\r?\n/u).map((line) => line.trim());
    const onIndex = lines.indexOf("on:");
    assert.ok(onIndex >= 0);
    assert.equal(lines[onIndex + 1], "pull_request:");
    assert.equal(
      /pull_request_target|workflow_run|push:/u.test(workflow),
      false,
    );
    const permissions = lines.indexOf("permissions:");
    assert.ok(permissions >= 0);
    assert.equal(lines[permissions + 1], "contents: read");
    assert.equal(/:\s*write\b/u.test(workflow), false);
    assert.ok(lines.includes("fail-fast: false"));
    assert.ok(lines.includes("timeout-minutes: 10"));
    const matrix = /^\s*os:\s*\[([^\]]*)\]\s*$/mu.exec(workflow);
    assert.ok(matrix, "matrix.os");
    assert.deepEqual(
      matrix[1]!
        .split(",")
        .map((item) => item.trim())
        .sort(),
      ["macos-latest", "ubuntu-latest", "windows-latest"],
    );
    assert.ok(lines.includes("runs-on: ${{ matrix.os }}"));
    // Node.jsは準備するが版とactionの版は固定しない（将来の正当な更新でtestを落とさない）。
    assert.ok(
      lines.some((line) => /^uses: actions\/setup-node@\S+$/u.test(line)),
    );
    assert.equal(
      lines.filter((line) => line.startsWith("run:")).length,
      1,
      "run step",
    );
    assert.ok(
      lines.includes("run: node --test test/host-observer/portable.test.mjs"),
    );
    // OSごとの既定shellを変えず、shell構文に依存しない1 commandだけを実行する。
    assert.equal(/^\s*shell:/mu.test(workflow), false);
    assert.equal(/npm (?:ci|run|install|test)/u.test(workflow), false);
    assert.ok(fs.existsSync("test/host-observer/portable.test.mjs"));
  },
);

// ---------------------------------------------------------------- SCN-017

const MATRIX_SPEC = "docs/specs/06_外部インターフェース/02_ホスト観測契約.md";
const SHAPE_TYPES = ["string", "number", "boolean", "object", "array", "null"];

Given(
  exact(
    "test/fixtures/host-observer/claude-code-2.1.282/の3 fileとdocs/specsのCapability Matrixがある",
  ),
  function () {
    const s = state(this);
    for (const [name, file] of Object.entries(FIXTURES))
      s.texts[name] = fs.readFileSync(
        path.join(FIXTURE_DIRECTORY, file),
        "utf8",
      );
    s.texts.matrix = fs.readFileSync(MATRIX_SPEC, "utf8");
  },
);

When(exact("内容を機械検査する"), function () {
  const s = state(this);
  const violations: string[] = [];
  const shapes: Array<Record<string, unknown>> = [];
  let count = 0;
  for (const name of Object.keys(FIXTURES)) {
    const text = s.texts[name]!;
    for (const pattern of [
      /\/home\//u,
      /\/Users\//u,
      /\/tmp\//u,
      /\/root\//u,
      /[A-Za-z]:\\\\/u,
      /"env"/u,
      /"ppid"/u,
      /"pid"/u,
    ])
      if (pattern.test(text)) violations.push(`${name}: ${String(pattern)}`);
    for (const line of text.split(/\r?\n/u).filter((item) => item.length > 0)) {
      count += 1;
      const event = JSON.parse(line) as FixtureEvent & { hostVersion: unknown };
      if (event.hostVersion !== "2.1.282")
        violations.push(`${name}#${event.index}: hostVersion`);
      const visit = (value: unknown, where: string): void => {
        if (typeof value === "string") {
          if (
            (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value)) &&
            !value.startsWith("<")
          )
            violations.push(`${where}: 絶対path`);
          return;
        }
        if (typeof value !== "object" || value === null) return;
        for (const [key, child] of Object.entries(value)) {
          if (["prompt", "message", "content", "command", "env"].includes(key))
            violations.push(`${where}.${key}: 本文・環境変数`);
          visit(child, `${where}.${key}`);
        }
      };
      visit(event.identity, `${name}#${event.index}.identity`);
      visit(event.toolInput, `${name}#${event.index}.toolInput`);
      for (const value of Object.values(event.toolInputShape ?? {}))
        if (typeof value !== "string" || !SHAPE_TYPES.includes(value))
          violations.push(`${name}#${event.index}.toolInputShape: 値`);
      if (
        event.event === "PreToolUse" &&
        event.identity.tool_name === "SendMessage"
      )
        shapes.push(event.toolInputShape ?? {});
    }
  }
  s.values.violations = JSON.stringify(violations);
  s.values.count = String(count);
  s.values.shapes = JSON.stringify(shapes);
});

Then(
  exact("3 fileが存在し、絶対path・環境変数・PID・prompt本文を含まない"),
  function () {
    const s = state(this);
    assert.equal(s.values.count, "106");
    assert.deepEqual(JSON.parse(s.values.violations!), []);
  },
);

Then(
  exact(
    "PreToolUse(SendMessage)のeventはtool_inputのkey名と型を保持しtoとmessageが文字列である",
  ),
  function () {
    const s = state(this);
    const shapes = JSON.parse(s.values.shapes!) as Array<
      Record<string, unknown>
    >;
    assert.equal(shapes.length, 3);
    for (const shape of shapes) {
      assert.equal(shape.to, "string");
      assert.equal(shape.message, "string");
    }
  },
);

Then(exact("Matrixはhost version 2.1.282を記録している"), function () {
  const s = state(this);
  assert.match(s.texts.matrix!, /Capability Matrix/u);
  assert.match(s.texts.matrix!, /Claude Code 2\.1\.282/u);
  assert.match(
    s.texts.matrix!,
    /test\/fixtures\/host-observer\/claude-code-2\.1\.282\//u,
  );
});

// ---------------------------------------------------------------- SCN-018

Given(
  exact(
    "tool_input.toまたはsession_idが..、path区切り、空、129文字の入力がある",
  ),
  function () {
    const s = state(this);
    // `..`が一時directoryの外へ出ないよう、storeを2段深くする。
    const store = path.join(s.store, "nested", "store");
    const terminal = (agent: string) =>
      terminalTranscript(workUnitId(`id-${agent}`), "ainvalid");
    const transcriptPath = (session: string) =>
      path.join(store, `${session}.jsonl`);
    const place = (file: string, agent: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, terminal(agent));
    };
    const session = "s-018";
    const badTo = ["..", "a/b", "a\\b", "", "a".repeat(129), "a.b", "a b"];
    for (const to of badTo) {
      // 形式検証を外した実装が読むはずの位置へterminal handoffを置く。
      const candidate = path.join(
        store,
        session,
        "subagents",
        `agent-${to}.jsonl`,
      );
      if (!fs.existsSync(candidate) || fs.lstatSync(candidate).isFile())
        place(candidate, to);
      s.cases.push({
        label: `to:${to}`,
        stdin: JSON.stringify({
          ...sendMessage(s, session, to),
          transcript_path: transcriptPath(session),
        }),
      });
    }
    const agent = "avalid0000000001";
    for (const badSession of ["..", "a/b", "", "s".repeat(129), "s.x"]) {
      place(
        path.join(store, badSession, "subagents", `agent-${agent}.jsonl`),
        agent,
      );
      s.cases.push({
        label: `session:${badSession}`,
        stdin: JSON.stringify({
          ...sendMessage(s, badSession, agent),
          transcript_path: transcriptPath(badSession),
        }),
      });
    }
    // 128文字は判定対象である。
    s.values.longTo = "b".repeat(128);
    s.values.longSession = "c".repeat(128);
    s.values.longToId = workUnitId("long-to");
    s.values.longSessionId = workUnitId("long-session");
    placeTranscript(
      store,
      session,
      s.values.longTo,
      terminalTranscript(s.values.longToId, s.values.longTo),
    );
    placeTranscript(
      store,
      s.values.longSession,
      agent,
      terminalTranscript(s.values.longSessionId, agent),
    );
    s.cases.push(
      {
        label: "to:128",
        stdin: JSON.stringify({
          ...sendMessage(s, session, s.values.longTo),
          transcript_path: transcriptPath(session),
        }),
      },
      {
        label: "session:128",
        stdin: JSON.stringify({
          ...sendMessage(s, s.values.longSession, agent),
          transcript_path: transcriptPath(s.values.longSession),
        }),
      },
    );
  },
);

Then(exact("transcriptを読まず出力は{}である"), function () {
  const s = state(this);
  for (const item of s.runs)
    if (!item.label.endsWith(":128")) assertEmpty(item);
  assert.deepEqual(
    output(run(s, "to:128")),
    expectedWarning(TERMINAL_TEXT, s.values.longToId!, s.values.longTo!),
  );
  assert.deepEqual(
    output(run(s, "session:128")),
    expectedWarning(TERMINAL_TEXT, s.values.longSessionId!, "avalid0000000001"),
  );
});

// ---------------------------------------------------------------- SCN-019

function featureScenarioIds(directory: string): Set<string> {
  const ids = new Set<string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".feature"))
        for (const match of fs
          .readFileSync(file, "utf8")
          .matchAll(/^\s*Scenario(?: Outline)?:\s*(SCN-[A-Z0-9-]+)/gmu))
          ids.add(match[1]!);
    }
  };
  walk(directory);
  return ids;
}

Given(
  exact("docs/specs/02_要件のREQ-WF-1546節と要件一覧の同行がある"),
  function () {
    const s = state(this);
    const workflow = fs.readFileSync(
      "docs/specs/02_要件/01_ワークフロー要件.md",
      "utf8",
    );
    const lines = workflow.split(/\r?\n/u);
    const start = lines.findIndex((line) => /^###\s+REQ-WF-1546\b/u.test(line));
    assert.ok(start >= 0, "REQ-WF-1546節");
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,3}\s/u.test(line));
    s.texts.section = [
      lines[start]!,
      ...(end < 0 ? rest : rest.slice(0, end)),
    ].join("\n");
    const list = fs.readFileSync("docs/specs/02_要件/00_要件一覧.md", "utf8");
    const row = list
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("| REQ-WF-1546 |"));
    assert.equal(row.length, 1, "要件一覧のREQ-WF-1546行");
    s.texts.row = row[0]!;
  },
);

When(exact("引用されたSCN IDを抽出する"), function () {
  const s = state(this);
  const text = `${s.texts.section!}\n${s.texts.row!}`;
  s.values.cited = JSON.stringify([
    ...new Set(
      [...text.matchAll(/SCN-[A-Z0-9]+(?:-[A-Z0-9]+)*/gu)].map(
        (match) => match[0],
      ),
    ),
  ]);
});

Then(
  exact("すべてtest/featuresに実在しSCN-INT-AGENTLIFE-を含まない"),
  function () {
    const s = state(this);
    const cited = JSON.parse(s.values.cited!) as string[];
    const existing = featureScenarioIds(path.resolve("test/features"));
    assert.ok(cited.includes("SCN-UNIT-HOSTOBS-019"), JSON.stringify(cited));
    for (const id of cited) {
      assert.equal(id.startsWith("SCN-INT-AGENTLIFE-"), false, id);
      assert.ok(existing.has(id), `${id}がtest/featuresに実在しません`);
    }
    assert.equal(
      /AGENTLIFE/u.test(`${s.texts.section!}${s.texts.row!}`),
      false,
    );
  },
);

// ============================================================ integration

function lifecycle(world: HostObserverWorld): HostLifecycleState {
  world.hostLifecycle ??= { roots: {}, outputs: {}, advance: {} };
  return world.hostLifecycle;
}

function cli(args: string[], cwd?: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function cliJson(args: string[], cwd?: string): Record<string, unknown> {
  const result = cli(args, cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

const SETTINGS = ".claude/settings.local.json";

function readSettings(root: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(root, SETTINGS), "utf8"),
  ) as Record<string, unknown>;
}

function writeSettings(root: string, settings: unknown): void {
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(root, SETTINGS),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}

type HookGroup = { matcher?: string; hooks: Array<Record<string, unknown>> };

function observerHooks(settings: Record<string, unknown>) {
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  return Object.entries(hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      group.hooks
        .filter((hook) => JSON.stringify(hook).includes("asc-host-observer"))
        .map((hook) => ({ event, matcher: group.matcher, hook })),
    ),
  );
}

function managedRecord(root: string): Record<string, string> {
  return (
    JSON.parse(
      fs.readFileSync(
        path.join(root, ".agent-skill-chain/managed-assets.json"),
        "utf8",
      ),
    ) as { files: Record<string, string> }
  ).files;
}

const USER_WRITE_GROUP = {
  matcher: "Write",
  hooks: [{ type: "command", command: "echo user", timeout: 9 }],
};
const USER_SAME_GROUP_COMMAND = { type: "command", command: "echo same-group" };
/** 接頭辞だけが違う利用者hook。`endsWith`へ広げた所有判定はこれを奪う。 */
const USER_PREFIX_GROUP = {
  matcher: "Bash",
  hooks: [
    {
      type: "command",
      command: "node",
      args: ["${CLAUDE_PROJECT_DIR}/tools/asc-host-observer.mjs"],
    },
  ],
};
/** commandだけが違う利用者hook。`command === "node"`を外した所有判定はこれを奪う。 */
const USER_COMMAND_GROUP = {
  matcher: "Agent",
  hooks: [{ type: "command", command: "bun", args: [OBSERVER_ARG] }],
};
const USER_POST_GROUP = {
  matcher: "Edit",
  hooks: [{ type: "command", command: "echo post" }],
};
const USER_PERMISSIONS = { allow: ["Read(*)"], deny: ["Bash(rm:*)"] };

Given(exact("空のproject一時directoryがある"), function () {
  lifecycle(this).roots.main = this.temp("asc-hostobs-int-");
});

When(exact("install --applyを実行する"), function () {
  const l = lifecycle(this);
  l.outputs.preview = cliJson(["install", `--root=${l.roots.main}`]);
  l.outputs.apply = cliJson(["install", `--root=${l.roots.main}`, "--apply"]);
});

Then(
  exact(".claude/hooks/asc-host-observer.mjsがmanaged assetとして配置される"),
  function () {
    const l = lifecycle(this);
    const deployed = path.join(
      l.roots.main!,
      ".claude/hooks/asc-host-observer.mjs",
    );
    assert.equal(fs.lstatSync(deployed).isFile(), true);
    assert.equal(sha256(deployed), sha256(OBSERVER));
    const files = managedRecord(l.roots.main!);
    assert.equal(
      files[".claude/hooks/asc-host-observer.mjs"],
      sha256(OBSERVER),
    );
    assert.equal(
      files[".agent-skill-chain/hooks/asc-host-observer.mjs"],
      sha256(OBSERVER),
    );
  },
);

Then(
  exact(
    "settings.local.jsonのPreToolUseにmatcher SendMessage・command node・args・timeout 10のASC-owned entryが1件だけある",
  ),
  function () {
    const l = lifecycle(this);
    assert.deepEqual(readSettings(l.roots.main!), {
      hooks: { PreToolUse: [CANONICAL_GROUP] },
    });
    for (const key of ["preview", "apply"]) {
      const configuration = l.outputs[key]!.configuration as Record<
        string,
        unknown
      >;
      assert.equal(configuration.changed, true, key);
      assert.equal(configuration.restart, "new-session", key);
    }
  },
);

Then(exact("Bash・Edit・Agent等のmatcherへのobserver登録は無い"), function () {
  const l = lifecycle(this);
  assert.deepEqual(observerHooks(readSettings(l.roots.main!)), [
    { event: "PreToolUse", matcher: "SendMessage", hook: CANONICAL_HOOK },
  ]);
});

Given(
  exact(
    "settings.local.jsonに利用者のhook、permissions、同group内の他command、envがある",
  ),
  function () {
    const l = lifecycle(this);
    l.roots.main = this.temp("asc-hostobs-int-");
    l.settingsBefore = {
      permissions: USER_PERMISSIONS,
      env: { KEEP: "yes" },
      hooks: {
        PreToolUse: [
          USER_WRITE_GROUP,
          {
            matcher: "SendMessage",
            hooks: [CANONICAL_HOOK, USER_SAME_GROUP_COMMAND],
          },
          USER_PREFIX_GROUP,
          USER_COMMAND_GROUP,
        ],
        PostToolUse: [USER_POST_GROUP],
      },
    };
    writeSettings(l.roots.main, l.settingsBefore);
  },
);

Given(
  exact("ASC-owned observer entryの重複と旧asc-agent-lifecycle entryがある"),
  function () {
    const l = lifecycle(this);
    const settings = structuredClone(l.settingsBefore!) as {
      hooks: Record<string, HookGroup[]>;
    };
    settings.hooks.PreToolUse!.push(
      CANONICAL_GROUP,
      // timeoutだけを改変したASC-owned hookも所有を移さない。
      { matcher: "SendMessage", hooks: [{ ...CANONICAL_HOOK, timeout: 99 }] },
      {
        matcher: "Agent",
        hooks: [
          { type: "command", command: AGENT_LIFECYCLE_COMMAND, timeout: 15 },
        ],
      },
    );
    settings.hooks.PostToolUse!.unshift({
      matcher: "*",
      hooks: [{ ...CANONICAL_HOOK, timeout: 30 }],
    });
    writeSettings(l.roots.main!, settings);
  },
);

When(exact("install --applyとupdate --applyを実行する"), function () {
  const l = lifecycle(this);
  const root = l.roots.main!;
  l.outputs.install = cliJson(["install", `--root=${root}`, "--apply"]);
  l.outputs.afterInstall = readSettings(root);
  l.outputs.update = cliJson(["update", `--root=${root}`, "--apply"]);
  const bytes = fs.readFileSync(path.join(root, SETTINGS), "utf8");
  // 2回目のupdateは正規形を保ち、何も変えない（収束の冪等性）。
  l.outputs.again = cliJson(["update", `--root=${root}`, "--apply"]);
  assert.equal(fs.readFileSync(path.join(root, SETTINGS), "utf8"), bytes);
  // 正規形と同じgroupでもPreToolUse以外に置かれていれば収束対象である。
  const moved = this.temp("asc-hostobs-int-");
  writeSettings(moved, { hooks: { PostToolUse: [CANONICAL_GROUP] } });
  cliJson(["install", `--root=${moved}`, "--apply"]);
  l.outputs.moved = readSettings(moved);
});

Then(exact("利用者の項目は意味的に不変である"), function () {
  const l = lifecycle(this);
  const expected = {
    permissions: USER_PERMISSIONS,
    env: { KEEP: "yes" },
    hooks: {
      PreToolUse: [
        USER_WRITE_GROUP,
        { matcher: "SendMessage", hooks: [USER_SAME_GROUP_COMMAND] },
        USER_PREFIX_GROUP,
        USER_COMMAND_GROUP,
        CANONICAL_GROUP,
      ],
      PostToolUse: [USER_POST_GROUP],
    },
  };
  assert.deepEqual(l.outputs.afterInstall, expected);
  assert.deepEqual(readSettings(l.roots.main!), expected);
  assert.equal(
    (l.outputs.again!.configuration as Record<string, unknown>).changed,
    false,
  );
});

Then(
  exact("ASC-owned observer entryは1件であり旧lifecycle entryは除去されている"),
  function () {
    const l = lifecycle(this);
    const settings = readSettings(l.roots.main!);
    const owned = observerHooks(settings).filter(
      ({ hook }) =>
        hook.command === "node" &&
        JSON.stringify(hook.args) === JSON.stringify([OBSERVER_ARG]),
    );
    assert.deepEqual(owned, [
      { event: "PreToolUse", matcher: "SendMessage", hook: CANONICAL_HOOK },
    ]);
    assert.equal(
      JSON.stringify(settings).includes("asc-agent-lifecycle"),
      false,
    );
    assert.deepEqual(l.outputs.moved, {
      hooks: { PreToolUse: [CANONICAL_GROUP] },
    });
  },
);

Given(exact("install済みで利用者のhookとpermissionsがある"), function () {
  const l = lifecycle(this);
  const root = this.temp("asc-hostobs-int-");
  l.roots.main = root;
  cliJson(["install", `--root=${root}`, "--apply"]);
  const settings = readSettings(root) as { hooks: Record<string, HookGroup[]> };
  settings.hooks.PreToolUse!.unshift(USER_WRITE_GROUP);
  // 重複したASC-owned entryもすべて除去する。
  settings.hooks.PreToolUse!.push(CANONICAL_GROUP);
  writeSettings(root, { permissions: USER_PERMISSIONS, ...settings });
});

When(exact("delete --applyを実行する"), function () {
  const l = lifecycle(this);
  l.outputs.delete = cliJson(["delete", `--root=${l.roots.main}`, "--apply"]);
});

Then(
  exact(
    "observer entryと.claude/hooks/asc-host-observer.mjsは無く、利用者の項目は残る",
  ),
  function () {
    const l = lifecycle(this);
    const root = l.roots.main!;
    assert.deepEqual(readSettings(root), {
      permissions: USER_PERMISSIONS,
      hooks: { PreToolUse: [USER_WRITE_GROUP] },
    });
    assert.equal(
      fs.existsSync(path.join(root, ".claude/hooks/asc-host-observer.mjs")),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(root, ".agent-skill-chain/hooks/asc-host-observer.mjs"),
      ),
      false,
    );
  },
);

/** 展開先・正本・managed runtimeの3複写。record記載のまま全部を消す。 */
const OBSERVER_COPIES = [
  ".claude/hooks/asc-host-observer.mjs",
  ".agent-skill-chain/hooks/asc-host-observer.mjs",
  ".agent-skill-chain/managed-runtime/.agent-skill-chain/hooks/asc-host-observer.mjs",
];
const DOCTOR_STATES = [
  "registered",
  "unregistered",
  "missing",
  "recordedMissing",
  "tampered",
];

Given(
  exact(
    "登録済み、未登録、資産欠落、record記載済み資産欠落、資産改変の5状態のprojectがある",
  ),
  function () {
    const l = lifecycle(this);
    for (const name of DOCTOR_STATES) {
      const root = this.temp(`asc-hostobs-${name}-`);
      cliJson(["install", `--root=${root}`, "--apply"]);
      l.roots[name] = root;
    }
    // 所有hookがSendMessage以外のmatcherにだけある状態は登録済みと数えない。
    writeSettings(l.roots.unregistered!, {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [CANONICAL_HOOK] }] },
    });
    // 本Issue以前のversionでinstallし未updateのproject: recordにも展開先にもobserverが無い。
    const missing = l.roots.missing!;
    fs.rmSync(path.join(missing, ".claude/hooks/asc-host-observer.mjs"));
    const record = path.join(missing, ".agent-skill-chain/managed-assets.json");
    const parsed = JSON.parse(fs.readFileSync(record, "utf8")) as {
      files: Record<string, string>;
    };
    delete parsed.files[".claude/hooks/asc-host-observer.mjs"];
    fs.writeFileSync(record, `${JSON.stringify(parsed, null, 2)}\n`);
    // recordに載ったまま3複写だけが消えた状態（R1-P-01）。
    const recordedMissing = l.roots.recordedMissing!;
    const recorded = managedRecord(recordedMissing);
    for (const copy of OBSERVER_COPIES) {
      assert.equal(typeof recorded[copy], "string", copy);
      fs.rmSync(path.join(recordedMissing, copy));
    }
    // 在るが内容がmanaged digestと一致しない状態は改ざんとして扱う。
    fs.appendFileSync(
      path.join(l.roots.tampered!, ".claude/hooks/asc-host-observer.mjs"),
      "\n// tampered\n",
    );
  },
);

When(exact("それぞれでdoctorを実行する"), function () {
  const l = lifecycle(this);
  for (const name of DOCTOR_STATES) {
    const result = cli(["doctor", `--root=${l.roots[name]}`]);
    l.outputs[name] = JSON.parse(result.stdout) as Record<string, unknown>;
  }
});

function hostObserver(
  output: Record<string, unknown>,
): Record<string, unknown> {
  return (output.hooks as Record<string, unknown>).hostObserver as Record<
    string,
    unknown
  >;
}

Then(
  exact(
    "hooks.hostObserverはregistered・assetPresent・diagnostics・verifiedHostVersion 2.1.282・authority advisoryを報告する",
  ),
  function () {
    const l = lifecycle(this);
    assert.deepEqual(hostObserver(l.outputs.registered!), {
      registered: true,
      assetPresent: true,
      healthy: true,
      diagnostics: [],
      verifiedHostVersion: "2.1.282",
      authority: "advisory",
      next: DOCTOR_NEXT,
    });
    assert.deepEqual(hostObserver(l.outputs.unregistered!), {
      registered: false,
      assetPresent: true,
      healthy: false,
      diagnostics: [DIAGNOSTIC_UNREGISTERED],
      verifiedHostVersion: "2.1.282",
      authority: "advisory",
      next: DOCTOR_NEXT,
    });
    assert.deepEqual(hostObserver(l.outputs.missing!), {
      registered: true,
      assetPresent: false,
      healthy: false,
      diagnostics: [DIAGNOSTIC_ASSET_MISSING],
      verifiedHostVersion: "2.1.282",
      authority: "advisory",
      next: DOCTOR_NEXT,
    });
    assert.deepEqual(hostObserver(l.outputs.recordedMissing!), {
      registered: true,
      assetPresent: false,
      healthy: false,
      diagnostics: OBSERVER_COPIES.map(
        (copy) =>
          `host observer資産${copy}がありません。update --root=. --applyで配置できます`,
      ),
      verifiedHostVersion: "2.1.282",
      authority: "advisory",
      next: DOCTOR_NEXT,
    });
  },
);

Then(
  exact(
    "未登録と資産欠落はdiagnosticsに名指しされ、新しいsessionで有効になる旨を示す",
  ),
  function () {
    const l = lifecycle(this);
    for (const name of ["unregistered", "missing"]) {
      const observed = hostObserver(l.outputs[name]!);
      assert.match(
        (observed.diagnostics as string[]).join("\n"),
        /host observer/u,
      );
      assert.match(observed.next as string, /新しいClaude Code session/u);
    }
  },
);

Then(
  exact("doctor全体のhealthyは資産改変を除く4状態で同じである"),
  function () {
    const l = lifecycle(this);
    const states = [
      "registered",
      "unregistered",
      "missing",
      "recordedMissing",
    ].map((name) => l.outputs[name]!);
    for (const output of states) {
      assert.equal(output.healthy, true, JSON.stringify(output.adapters));
      const global = (output.adapters as { diagnostics: string[] }).diagnostics;
      assert.deepEqual(global, []);
    }
  },
);

Then(
  exact("資産改変ではdoctor全体がmanaged hashの不一致で不健全である"),
  function () {
    const output = lifecycle(this).outputs.tampered!;
    assert.equal(output.healthy, false);
    assert.deepEqual(
      (output.adapters as { diagnostics: string[] }).diagnostics,
      [".claude/hooks/asc-host-observer.mjs: managed hashが一致しません"],
    );
    // 改変は欠落ではないため、observer欄は資産ありと報告する。
    assert.equal(hostObserver(output).assetPresent, true);
  },
);

Given(
  exact(
    "observer資産が異常終了する内容に置き換えられた状態と欠落した状態がある",
  ),
  function () {
    const l = lifecycle(this);
    const root = this.initRepo();
    cliJson(["install", `--root=${root}`, "--apply"]);
    fs.writeFileSync(
      path.join(root, ".gitignore"),
      ".claude/\n.agents/\n.codex/\n.agent-skill-chain/runtime/\n.agent-skill-chain/managed*\n.agent-skill-chain/tmp/\n",
    );
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture install"], { cwd: root });
    l.roots.main = root;
    l.roots.staging = createIssueStaging(root, {
      title: "host-observer",
      requestedMode: "full",
      now: new Date("2026-10-07T00:00:00Z"),
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [id, { answer: true, evidence: "fixture" }]),
      ),
    }).path;
  },
);

When(exact("workflow advanceのpreviewを実行する"), function () {
  const l = lifecycle(this);
  const root = l.roots.main!;
  const observer = path.join(root, ".claude/hooks/asc-host-observer.mjs");
  const preview = () =>
    cliJson(["workflow", "advance", `--staging=${l.roots.staging}`], root);
  l.advance.normal = preview();
  fs.writeFileSync(observer, "process.exit(1);\n");
  l.advance.broken = preview();
  fs.rmSync(observer);
  l.advance.missing = preview();
});

Then(
  exact("targetStep、state、agentDispatchは正常な状態と同一である"),
  function () {
    const l = lifecycle(this);
    const pick = (value: Record<string, unknown>) => ({
      targetStep: value.targetStep,
      state: value.state,
      agentDispatch: value.agentDispatch,
    });
    assert.ok(l.advance.normal!.agentDispatch);
    assert.notEqual(l.advance.normal!.targetStep, undefined);
    assert.deepEqual(pick(l.advance.broken!), pick(l.advance.normal!));
    assert.deepEqual(pick(l.advance.missing!), pick(l.advance.normal!));
  },
);
