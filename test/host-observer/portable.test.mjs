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
  "ASC WARN: This agent completed a terminal ASC Work Unit. Do not continue ASC work in this context. Run workflow advance and dispatch a fresh worker.";
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

function dispatch(id) {
  return `前置き{注記} ${JSON.stringify({ handoff: handoff(id), prompt: "p" })} 後続`;
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
