#!/usr/bin/env node
/**
 * codexへの契約に「範囲を狭める語」があるのに規範の引用が無ければ起動を拒否する。
 *
 * 2026-08-28: #1024のStep 10でHigh 2件（H-01・H-03）がこの欠落から生じた。
 * **規約としてメモリに書いてあったが守られなかったため、強制点をここへ置く。**
 *
 * **shellではなくNodeで書く**（Issue #1105）。理由は2つある。
 * `check_source_quality.ts`が受理するsourceは`.ts`と`.mjs`だけであり、
 * `.sh`を配ると**利用者側の`source:check`が必ず落ちる**（`.claude`は除外
 * directoryに含まれない）。またJSONの解釈にjqを要求しなくなる。
 *
 * **判定の内容は移植前と同じである。** Issue #1105は配布の欠落だけを扱い、
 * hookが検査する内容を変えない。
 */
import fs from "node:fs";

/** 契約の範囲を狭める語。**1つでもあれば規範の引用を要求する。** */
const NARROWING = /だけ|のみ|対象外|外す|限る|含めない|実行しない/u;
/**
 * 要件ID。**カテゴリを挟む形も受理する。**
 * `REQ-SQ-008`のようなIDを拒否すると、引用の実質と無関係な文字列を足す運用に
 * なる（Issue #1233）。
 */
const REQUIREMENT_ID = /(FR|REQ|AC|NFR|INV|BR)(-[A-Z]+)*-[0-9]/u;
const QUOTED_LINE = /^> /mu;
const CONTRACT_FILE = /\/[^ "']+\.(?:txt|md)/gu;

/**
 * 「## 規範の引用」節の中身だけを取り出す。
 *
 * **3条件を独立に見ない。** 見出しがどこかにあり、`> `がどこかにあり、要件IDが
 * どこかにあるだけでは、無関係な文字列で通過する（偽陰性）。
 */
export function citationSection(document) {
  const lines = document.split("\n");
  const start = lines.findIndex((line) => /^## 規範の引用\s*$/u.test(line));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** 契約fileが規範の引用を備えているかを返す純関数。 */
export function hasNormativeCitation(document) {
  const section = citationSection(document);
  if (section === "") return false;
  return QUOTED_LINE.test(section) && REQUIREMENT_ID.test(section);
}

export function denialReason(file) {
  return (
    `契約 ${file} に範囲を狭める語（だけ・のみ・対象外・外す・限る・含めない・実行しない）があるのに、` +
    "規範の引用がありません。「## 規範の引用」節を作り、その節の中に該当する要件ID" +
    "（FR-/REQ-/AC-/NFR-/INV-/BR-。REQ-SQ-008 のようにカテゴリを挟む形も可）と、" +
    "その原文を > 行で引用してください。節の外に置いた引用やIDは数えません。要約で代替しないこと。"
  );
}

/**
 * commandが参照する契約fileのうち、最初に拒否すべきものを返す。
 *
 * **読めないfileと引用済みのfileは飛ばす。** 判定できないものを拒否側へ倒すと、
 * 無関係な起動まで止まる。
 */
export function firstUncitedContract(command, readFile) {
  if (!command.includes("codex exec")) return undefined;
  const files = [...new Set(command.match(CONTRACT_FILE) ?? [])].sort();
  for (const file of files) {
    const document = readFile(file);
    if (document === undefined) continue;
    if (!NARROWING.test(document)) continue;
    if (hasNormativeCitation(document)) continue;
    return file;
  }
  return undefined;
}

function readInput() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readInput());
  } catch {
    return;
  }
  const command = payload?.tool_input?.command;
  if (typeof command !== "string") return;
  const file = firstUncitedContract(command, (candidate) => {
    try {
      return fs.statSync(candidate).isFile()
        ? fs.readFileSync(candidate, "utf8")
        : undefined;
    } catch {
      return undefined;
    }
  });
  if (file === undefined) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denialReason(file),
      },
    }),
  );
}

main();
