#!/usr/bin/env node
/**
 * Claude Codeの`PreToolUse(SendMessage)`だけで起動するstatelessなhost observer（Issue #1566）。
 *
 * **観測するだけで止めない。** 返すのはowner指定の警告2種か`{}`だけであり、
 * toolの許可・拒否・保留を表すkeyを組み立てる経路を持たない。終了codeは常に0である。
 *
 * **何も保存しない。** 読むのはstdinの1件と、host自身が保存した宛先subagent
 * transcriptの先頭262144 bytesだけである。fileを書かず、状態を持たず、
 * 外部processを起動しない。判別できない入力はすべて`{}`へ倒す（fail-open）。
 *
 * 判定条件の根拠はClaude Code 2.1.282の実payload
 * （`test/fixtures/host-observer/claude-code-2.1.282/`）だけである。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FRESH_WARNING =
  "ASC WARN: This Work Unit requires a fresh execution context. The observed Claude Code agent identity is being reused. Redispatch a fresh worker.";
const TERMINAL_WARNING =
  "ASC WARN: This agent completed a terminal ASC Work Unit. Do not continue ASC work in this context. Run workflow advance and dispatch a fresh worker.";
const HANDOFF_KIND = "asc-handoff/v1";
const STDIN_LIMIT = 8 * 1024 * 1024;
const TRANSCRIPT_LIMIT = 262144;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const WORK_UNIT_ID = /^[0-9a-f]{64}$/u;
const MAX_CANDIDATES = 64;
const MAX_STRING_DEPTH = 4;
const MAX_OBJECT_DEPTH = 16;
const MAX_NODES = 10000;
const NONE = Object.freeze({ kind: "none" });

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** handoffの4条件をすべて満たすobjectだけを認める。 */
function recognizedHandoff(value) {
  if (!isRecord(value) || value.kind !== HANDOFF_KIND) return undefined;
  const unit = value.workUnit;
  if (!isRecord(unit)) return undefined;
  if (
    typeof unit.workUnitId !== "string" ||
    !WORK_UNIT_ID.test(unit.workUnitId)
  )
    return undefined;
  if (
    typeof unit.freshContextRequired !== "boolean" ||
    typeof unit.terminalAfterHandback !== "boolean"
  )
    return undefined;
  return {
    workUnitId: unit.workUnitId,
    fresh: unit.freshContextRequired,
    terminal: unit.terminalAfterHandback,
  };
}

/** 引用符とescapeを考慮して`start`の`{`に対応する`}`の位置を返す。 */
function matchingBrace(text, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * 文字列へ埋め込まれたJSON objectを候補として切り出して走査する。
 *
 * hostのtranscriptではdispatch promptがJSON文字列として1段escapeされるため、
 * 行のtop-levelだけを見るとhandoffを確定できない。候補数と入れ子の段数に上限を置く。
 */
function searchString(text, strings, budget, accept) {
  if (strings >= MAX_STRING_DEPTH || !text.includes(HANDOFF_KIND))
    return undefined;
  let attempts = 0;
  let start = text.indexOf("{");
  while (start !== -1 && attempts < MAX_CANDIDATES) {
    attempts += 1;
    const end = matchingBrace(text, start);
    if (end === -1) {
      start = text.indexOf("{", start + 1);
      continue;
    }
    let parsed;
    let valid;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
      valid = true;
    } catch {
      valid = false;
    }
    if (!valid) {
      start = text.indexOf("{", start + 1);
      continue;
    }
    const found = search(parsed, 0, strings + 1, budget, accept);
    if (found) return found;
    start = text.indexOf("{", end + 1);
  }
  return undefined;
}

function search(value, depth, strings, budget, accept) {
  if (depth > MAX_OBJECT_DEPTH || budget.nodes >= MAX_NODES) return undefined;
  budget.nodes += 1;
  if (typeof value === "string")
    return searchString(value, strings, budget, accept);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = search(item, depth + 1, strings, budget, accept);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const handoff = recognizedHandoff(value);
  if (handoff && accept(handoff)) return handoff;
  for (const key of Object.keys(value)) {
    const found = search(value[key], depth + 1, strings, budget, accept);
    if (found) return found;
  }
  return undefined;
}

function findHandoff(value, accept) {
  return search(value, 0, 0, { nodes: 0 }, accept);
}

/**
 * 宛先transcriptの先頭だけを読取専用で読む。
 *
 * symlinkは`lstat`で拒否し、open後の`fstat`で同じ通常fileであることを確かめる。
 * FIFOへ差し替えられてもopenで待たないよう、定義されるOSでは`O_NONBLOCK`を加える。
 */
function readHead(file) {
  let observed;
  try {
    observed = fs.lstatSync(file);
  } catch {
    return undefined;
  }
  if (!observed.isFile()) return undefined;
  const nonblocking =
    typeof fs.constants.O_NONBLOCK === "number" ? fs.constants.O_NONBLOCK : 0;
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | nonblocking);
  } catch {
    return undefined;
  }
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== observed.dev ||
      opened.ino !== observed.ino
    )
      return undefined;
    const buffer = Buffer.alloc(TRANSCRIPT_LIMIT);
    let total = 0;
    while (total < TRANSCRIPT_LIMIT) {
      const count = fs.readSync(
        descriptor,
        buffer,
        total,
        TRANSCRIPT_LIMIT - total,
        total,
      );
      if (count === 0) break;
      total += count;
    }
    return buffer.toString("utf8", 0, total);
  } catch {
    return undefined;
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch {
      // 読取専用descriptorのclose失敗は判定に影響しない。
    }
  }
}

/**
 * transcript先頭の各行からterminal handoffを探す。
 *
 * 上限で切れた末尾の不完全行はJSONとして解釈できないため、行ごとの解析で捨てられる。
 */
function terminalHandoff(head) {
  for (const raw of head.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const found = findHandoff(parsed, (handoff) => handoff.terminal === true);
    if (found) return found;
  }
  return undefined;
}

/** 1入力から観測結果を決める。fresh mismatchを優先し、結果は高々1件である。 */
function decide(input, read) {
  if (!isRecord(input)) return NONE;
  if (input.hook_event_name !== "PreToolUse") return NONE;
  if (input.tool_name !== "SendMessage") return NONE;
  const toolInput = input.tool_input;
  if (!isRecord(toolInput)) return NONE;
  const to = toolInput.to;
  const sessionId = input.session_id;
  if (typeof to !== "string" || !IDENTIFIER.test(to)) return NONE;
  if (typeof sessionId !== "string" || !IDENTIFIER.test(sessionId)) return NONE;
  const body =
    typeof toolInput.message === "string"
      ? toolInput.message
      : toolInput.content;
  const fresh = findHandoff(body, (handoff) => handoff.fresh === true);
  if (fresh)
    return {
      kind: "fresh-mismatch",
      workUnitId: fresh.workUnitId,
      agentId: to,
    };
  const transcriptPath = input.transcript_path;
  if (
    typeof transcriptPath !== "string" ||
    transcriptPath.includes("\0") ||
    !path.isAbsolute(transcriptPath)
  )
    return NONE;
  const head = read(
    path.join(
      path.dirname(transcriptPath),
      sessionId,
      "subagents",
      `agent-${to}.jsonl`,
    ),
  );
  if (head === undefined) return NONE;
  const terminal = terminalHandoff(head);
  if (terminal)
    return {
      kind: "terminal-reuse",
      workUnitId: terminal.workUnitId,
      agentId: to,
    };
  return NONE;
}

function warning(text, result) {
  return {
    systemMessage: text,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `${text}\nworkUnitId: ${result.workUnitId}\nagentId: ${result.agentId}`,
    },
  };
}

/** 出力は警告2形と`{}`のどれかだけである。 */
function render(result) {
  if (result.kind === "fresh-mismatch") return warning(FRESH_WARNING, result);
  if (result.kind === "terminal-reuse")
    return warning(TERMINAL_WARNING, result);
  return {};
}

/** stdoutへの書込は1回だけにする。2回目以降は複数行JSONになりhostが解釈できない。 */
let written = false;
function emit(value) {
  if (written) return;
  written = true;
  try {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } catch {
    // stdoutが閉じていても終了codeは変えない。
  }
}

process.exitCode = 0;
process.stdout.on("error", () => {
  // EPIPE等は例外へ昇格させない。
});
process.on("uncaughtException", () => emit({}));
process.on("unhandledRejection", () => emit({}));

try {
  const chunks = [];
  let size = 0;
  let overflow = false;
  process.stdin.on("data", (chunk) => {
    if (overflow) return;
    size += chunk.length;
    if (size > STDIN_LIMIT) {
      overflow = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  process.stdin.on("end", () => {
    try {
      if (overflow) {
        emit({});
        return;
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      emit(render(decide(input, readHead)));
    } catch {
      emit({});
    }
  });
  process.stdin.on("error", () => emit({}));
} catch {
  emit({});
}
