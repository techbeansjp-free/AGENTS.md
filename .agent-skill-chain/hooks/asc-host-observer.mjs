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
 * **仕事量は1回の起動全体で有界である。** 文字列は先頭262144文字だけを走査し、
 * 候補の切り出し回数と括弧対応の走査文字数は入れ子の全段で共有する上限を持つ。
 * 上限に達したら判別不能として`{}`を返す。
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
  "ASC WARN: This agent belongs to a terminal ASC Work Unit. Continue here only if this message is part of the still-active Work Unit; after handback, run workflow advance and dispatch a fresh worker.";
const HANDOFF_KIND = "asc-handoff/v1";
const STDIN_LIMIT = 8 * 1024 * 1024;
const TRANSCRIPT_LIMIT = 262144;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const WORK_UNIT_ID = /^[0-9a-f]{64}$/u;
const SCAN_LIMIT = 262144;
const MAX_CANDIDATES = 64;
const MAX_SCAN_STEPS = 4 * SCAN_LIMIT;
const MAX_STRING_DEPTH = 4;
const MAX_OBJECT_DEPTH = 16;
const MAX_NODES = 10000;
const NONE = Object.freeze({ kind: "none" });

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * handoffの5条件（`kind`、`workUnitId`の形式、`freshContextRequired`・
 * `terminalAfterHandback`・`reuseForbidden`が真偽値）をすべて満たすobjectだけを認める。
 */
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
    typeof unit.terminalAfterHandback !== "boolean" ||
    typeof unit.reuseForbidden !== "boolean"
  )
    return undefined;
  return {
    workUnitId: unit.workUnitId,
    fresh: unit.freshContextRequired,
    terminal: unit.terminalAfterHandback,
    reuseForbidden: unit.reuseForbidden,
  };
}

/**
 * 引用符とescapeを考慮して`start`の`{`に対応する`}`の位置を返す。
 *
 * 走査した文字数を全段共有の`budget.steps`から引き、尽きたら`-1`を返す。
 */
function matchingBrace(text, start, budget) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    if (budget.steps >= MAX_SCAN_STEPS) return -1;
    budget.steps += 1;
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
 * 行のtop-levelだけを見るとhandoffを確定できない。走査は先頭`SCAN_LIMIT`文字に限り、
 * 候補数と走査文字数は入れ子の全段で共有する上限、入れ子の段数にも上限を置く。
 */
function searchString(value, strings, budget, accept) {
  if (strings >= MAX_STRING_DEPTH) return undefined;
  const text = value.length > SCAN_LIMIT ? value.slice(0, SCAN_LIMIT) : value;
  if (!text.includes(HANDOFF_KIND)) return undefined;
  let start = text.indexOf("{");
  while (start !== -1 && budget.candidates < MAX_CANDIDATES) {
    budget.candidates += 1;
    const end = matchingBrace(text, start, budget);
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
  return search(value, 0, 0, { nodes: 0, candidates: 0, steps: 0 }, accept);
}

/**
 * 宛先transcriptの先頭だけを読取専用で読む。
 *
 * `directory`（`transcript_path`のdirectory部分、hostのproject store）より下の
 * `<session_id>`・`subagents`・`agent-<to>.jsonl`の各要素を順に`lstat`し、symlinkを
 * 辿らない。中間要素は実directory、末端は通常fileだけを認める。open後の`fstat`で
 * 末端が同じ通常fileであることを確かめる。`lstat`とopenの間の差し替えは防げないが、
 * それにはhost storeへの書込みが要り、結果はadvisory警告1件に留まる。
 * FIFOへ差し替えられてもopenで待たないよう、定義されるOSでは`O_NONBLOCK`を加える。
 */
function readHead(directory, segments) {
  let file = directory;
  let observed;
  try {
    for (let index = 0; index < segments.length; index += 1) {
      file = path.join(file, segments[index]);
      observed = fs.lstatSync(file);
      const last = index === segments.length - 1;
      if (last ? !observed.isFile() : !observed.isDirectory()) return undefined;
    }
  } catch {
    return undefined;
  }
  if (observed === undefined) return undefined;
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
 * 最初の`type: "user"`行の`message.content`（dispatch prompt）だけからterminal handoff
 * （`terminalAfterHandback`と`reuseForbidden`が共に`true`）を探す。
 *
 * 分かるのは宛先がterminal Work Unitの担当としてdispatchされたことまでであり、
 * handback済みか実行中かは区別しない。区別には完了記録が要り、observerはそれを持たない。
 *
 * 後続行（tool_result・assistant等）は宛先が担当したWork Unitを表さない。例えば
 * `workflow advance`の出力を読んだだけのagentはtool_resultにhandoffを持つが、
 * そのWork Unitを担当していない（TERM-ASC-1566-05の反例）。contentが配列なら
 * `type: "text"`の要素の`text`だけを見る。上限で切れた末尾の不完全行はJSONとして
 * 解釈できないため、行ごとの解析で捨てられる。
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
    if (!isRecord(parsed) || parsed.type !== "user") continue;
    const message = parsed.message;
    if (!isRecord(message)) return undefined;
    const content = message.content;
    const prompt =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter(
                (block) =>
                  isRecord(block) &&
                  block.type === "text" &&
                  typeof block.text === "string",
              )
              .map((block) => block.text)
          : undefined;
    if (prompt === undefined) return undefined;
    return findHandoff(
      prompt,
      (handoff) => handoff.terminal === true && handoff.reuseForbidden === true,
    );
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
  const head = read(path.dirname(transcriptPath), [
    sessionId,
    "subagents",
    `agent-${to}.jsonl`,
  ]);
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
