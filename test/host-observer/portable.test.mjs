/**
 * host observerのportable fixture test（Issue #1566、FR-10）。
 *
 * ubuntu・macos・windowsのNode.js 24で`node --test`だけで実行する。依存packageと
 * buildを要さず、observerを子processとして起動して判定の結果を比べる。
 * pathは`path.join`と`os.tmpdir()`で組み立て、CRLFでcheckoutされたJSONLも読む。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OBSERVER = path.join(
  ROOT,
  ".agent-skill-chain",
  "hooks",
  "asc-host-observer.mjs",
);
const FIXTURES = path.join(
  ROOT,
  "test",
  "fixtures",
  "host-observer",
  "claude-code-2.1.282",
);
const FRESH_TEXT =
  "ASC WARN: This Work Unit requires a fresh execution context. The observed Claude Code agent identity is being reused. Redispatch a fresh worker.";
const TERMINAL_TEXT =
  "ASC WARN: This agent belongs to a terminal ASC Work Unit. Continue here only if this message is part of the still-active Work Unit; after handback, run workflow advance and dispatch a fresh worker.";
const FRESH_ID = "1".repeat(64);
const TERMINAL_ID = "2".repeat(64);

function temporaryStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asc-hostobs-portable-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function handoff(id) {
  return {
    kind: "asc-handoff/v1",
    workUnit: {
      workUnitId: id,
      freshContextRequired: true,
      terminalAfterHandback: true,
      reuseForbidden: true,
    },
  };
}

function dispatch(id, value = handoff(id)) {
  return `前置き{注記} ${JSON.stringify({ handoff: value, prompt: "p" })} 後続`;
}

/** 宛先transcriptを置く。先頭行はdispatch prompt、以降は`rest`の各行である。 */
function placeTranscript(store, agentId, prompt, rest = []) {
  const directory = path.join(store, "portable-session", "subagents");
  fs.mkdirSync(directory, { recursive: true });
  const lines = [
    { type: "user", message: { role: "user", content: prompt } },
    ...rest,
  ];
  fs.writeFileSync(
    path.join(directory, `agent-${agentId}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
}

function sendMessage(store, toolInput) {
  return {
    session_id: "portable-session",
    transcript_path: path.join(store, "portable-session.jsonl"),
    cwd: store,
    hook_event_name: "PreToolUse",
    tool_name: "SendMessage",
    tool_input: toolInput,
  };
}

function observe(input) {
  const result = spawnSync(process.execPath, [OBSERVER], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function warning(text, id, agentId) {
  return {
    systemMessage: text,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `${text}\nworkUnitId: ${id}\nagentId: ${agentId}`,
    },
  };
}

test("fresh handoffを含むSendMessageはfresh mismatchを返す", (t) => {
  const store = temporaryStore(t);
  assert.deepEqual(
    observe(sendMessage(store, { to: "agentA", message: dispatch(FRESH_ID) })),
    warning(FRESH_TEXT, FRESH_ID, "agentA"),
  );
});

test("messageが文字列でなければcontentのfresh handoffを読む", (t) => {
  const store = temporaryStore(t);
  assert.deepEqual(
    observe(
      sendMessage(store, {
        to: "agentC",
        message: { kind: "structured" },
        content: dispatch(FRESH_ID),
      }),
    ),
    warning(FRESH_TEXT, FRESH_ID, "agentC"),
  );
});

test("宛先transcript先頭のterminal handoffはterminal reuseを返す", (t) => {
  const store = temporaryStore(t);
  const directory = path.join(store, "portable-session", "subagents");
  fs.mkdirSync(directory, { recursive: true });
  const line = JSON.stringify({
    type: "user",
    message: { role: "user", content: dispatch(TERMINAL_ID) },
  });
  // Windowsのcheckout変換と同じCRLF改行で置く。
  fs.writeFileSync(
    path.join(directory, "agent-agentB.jsonl"),
    `${line}\r\n{"type":"assistant"}\r\n`,
  );
  assert.deepEqual(
    observe(sendMessage(store, { to: "agentB", message: "続けてください" })),
    warning(TERMINAL_TEXT, TERMINAL_ID, "agentB"),
  );
});

test("送信本文のfresh handoffは宛先transcriptのterminal handoffより優先する", (t) => {
  const store = temporaryStore(t);
  const directory = path.join(store, "portable-session", "subagents");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "agent-agentD.jsonl"),
    `${JSON.stringify({ type: "user", message: { role: "user", content: dispatch(TERMINAL_ID) } })}\n`,
  );
  assert.deepEqual(
    observe(sendMessage(store, { to: "agentD", message: dispatch(FRESH_ID) })),
    warning(FRESH_TEXT, FRESH_ID, "agentD"),
  );
});

test("真偽値でないfreshContextRequiredのhandoffは認めない", (t) => {
  const store = temporaryStore(t);
  const value = handoff(FRESH_ID);
  value.workUnit.freshContextRequired = "true";
  assert.deepEqual(
    observe(
      sendMessage(store, {
        to: "agentE",
        message: JSON.stringify({ handoff: value, prompt: "p" }),
      }),
    ),
    {},
  );
});

test("reuseForbiddenがtrueでないterminal handoffはterminal reuseを返さない", (t) => {
  const store = temporaryStore(t);
  const variants = [
    ["false", false],
    ["missing", undefined],
    ["string", "true"],
  ];
  for (const [name, reuseForbidden] of variants) {
    const value = handoff(TERMINAL_ID);
    if (reuseForbidden === undefined) delete value.workUnit.reuseForbidden;
    else value.workUnit.reuseForbidden = reuseForbidden;
    const agentId = `agentR${name}`;
    placeTranscript(store, agentId, dispatch(TERMINAL_ID, value));
    assert.deepEqual(
      observe(sendMessage(store, { to: agentId, message: "続けてください" })),
      {},
      name,
    );
  }
});

test("reuseForbiddenがfalseでもfresh handoffはfresh mismatchを返す", (t) => {
  const store = temporaryStore(t);
  const value = handoff(FRESH_ID);
  value.workUnit.reuseForbidden = false;
  assert.deepEqual(
    observe(
      sendMessage(store, { to: "agentH", message: dispatch(FRESH_ID, value) }),
    ),
    warning(FRESH_TEXT, FRESH_ID, "agentH"),
  );
});

test("handback前の実行中workerとhandback後のworkerへ同じterminal警告を返す", (t) => {
  const store = temporaryStore(t);
  // 実行中: dispatch promptの後にtool_useだけがあり、返却の応答はまだ無い。
  placeTranscript(store, "agentRunning", dispatch(TERMINAL_ID), [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash", input: {} }],
      },
    },
  ]);
  // handback後: 最終の応答まで書かれている。
  placeTranscript(store, "agentReturned", dispatch(TERMINAL_ID), [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "handback report" }],
      },
    },
  ]);
  assert.deepEqual(
    observe(sendMessage(store, { to: "agentRunning", message: "途中の指示" })),
    warning(TERMINAL_TEXT, TERMINAL_ID, "agentRunning"),
  );
  assert.deepEqual(
    observe(sendMessage(store, { to: "agentReturned", message: "是正依頼" })),
    warning(TERMINAL_TEXT, TERMINAL_ID, "agentReturned"),
  );
});

test("最初のuser行以外にだけあるterminal handoffは認めない", (t) => {
  const store = temporaryStore(t);
  const directory = path.join(store, "portable-session", "subagents");
  fs.mkdirSync(directory, { recursive: true });
  // workflow advanceの出力をtool_resultとして読んだだけのagent。
  const lines = [
    { type: "user", message: { role: "user", content: "通常task" } },
    { type: "assistant", message: { role: "assistant", content: [] } },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: dispatch(TERMINAL_ID) }],
      },
    },
  ];
  fs.writeFileSync(
    path.join(directory, "agent-agentF.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\r\n")}\r\n`,
  );
  assert.deepEqual(
    observe(sendMessage(store, { to: "agentF", message: "続けてください" })),
    {},
  );
});

test("入れ子の未閉鎖括弧を含む大きなmessageでも{}を返す", (t) => {
  const store = temporaryStore(t);
  const nest = (level) => {
    const head = `asc-handoff/v1 ${"{".repeat(63)}`;
    const tail = "a".repeat(1_900_000);
    return level === 0
      ? `${head}${tail}`
      : `${head}${JSON.stringify({ a: nest(level - 1) })}${tail}`;
  };
  assert.deepEqual(
    observe(sendMessage(store, { to: "agentG", message: nest(3) })),
    {},
  );
});

test("malformedな入力は{}を返す", () => {
  for (const input of ["{bad", "", "[1]", "42"])
    assert.deepEqual(observe(input), {});
});

test("fixture 106 event全件は{}を返す", (t) => {
  const store = temporaryStore(t);
  let count = 0;
  for (const file of fs.readdirSync(FIXTURES).sort()) {
    const lines = fs
      .readFileSync(path.join(FIXTURES, file), "utf8")
      .split("\n")
      .map((line) => line.replace(/\r$/u, ""))
      .filter((line) => line.length > 0);
    for (const line of lines) {
      const event = JSON.parse(line);
      const input = JSON.parse(
        JSON.stringify(event.identity)
          .replaceAll("<CLAUDE_PROJECT_STORE>", store.replaceAll("\\", "\\\\"))
          .replaceAll("<PROJECT>", store.replaceAll("\\", "\\\\")),
      );
      if (event.toolInput !== null) {
        input.tool_input = { ...event.toolInput };
        if (input.tool_name === "SendMessage")
          input.tool_input.message = "続けてください";
      }
      assert.deepEqual(observe(input), {}, `${file}#${event.index}`);
      count += 1;
    }
  }
  assert.equal(count, 106);
});
