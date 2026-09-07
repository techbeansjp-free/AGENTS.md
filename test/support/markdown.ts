/**
 * Markdownの「表示される本文」だけを取り出す。
 *
 * HTMLコメント、fenced code block、indented code blockへ退避した文字列を、
 * 契約の充足証拠にしないための共通規則である。**この規則を各step fileへ
 * 複製しない。**
 *
 * fenceの閉鎖はCommonMarkの3条件に合わせる。**同じ文字であること、開始以上の
 * 長さであること、info stringを持たないこと。** 先頭数文字へ潰すと、
 * ` ```typescript `のようなinfo string付きの行を閉鎖と誤読し、fence内の
 * 後続行が表示本文として抽出される（`scripts/check_file_audit.ts`が
 * PR #1192の外部指摘で同じ是正を受けている。PR #1270で再発した）。
 */
type FenceDelimiter = {
  readonly character: string;
  readonly length: number;
  readonly infoString: string;
};

function fenceDelimiter(line: string): FenceDelimiter | undefined {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  const run = match?.[1];
  if (!run) return undefined;
  return {
    character: run[0]!,
    length: run.length,
    infoString: (match[2] ?? "").trim(),
  };
}

function closesFence(open: FenceDelimiter, candidate: FenceDelimiter): boolean {
  return (
    candidate.character === open.character &&
    candidate.length >= open.length &&
    candidate.infoString.length === 0
  );
}

/**
 * 1行からHTMLコメント区間を取り除く。閉じないコメントが始まる場合は`undefined`。
 */
function stripComments(line: string): string | undefined {
  let rest = line;
  let out = "";
  for (;;) {
    const open = rest.indexOf("<!--");
    if (open < 0) return out + rest;
    out += rest.slice(0, open);
    const close = rest.indexOf("-->", open + 4);
    if (close < 0) return undefined;
    rest = rest.slice(close + 3);
  }
}

export function visibleMarkdownLines(markdown: string): string[] {
  const lines: string[] = [];
  let openFence: FenceDelimiter | undefined;
  let inComment = false;
  for (const line of markdown.split(/\r?\n/u)) {
    const delimiter = fenceDelimiter(line);
    if (openFence !== undefined) {
      if (delimiter && closesFence(openFence, delimiter)) openFence = undefined;
      continue;
    }
    if (delimiter !== undefined) {
      openFence = delimiter;
      continue;
    }
    /**
     * **indented code blockの除外をコメント処理より前へ置く。**
     *
     * 後ろへ置くと、`    行 <!-- 補足 -->`のようにindentした行でもコメント分岐が
     * 先に可視行として積み、**code block内の文字列が契約の充足証拠になる**
     * （Issue #1274、PR #1277の外部指摘）。fenceの内側は上で既に落としている。
     */
    if (!inComment && /^(?: {4}|\t)/u.test(line)) continue;
    /**
     * **コメントの外にある可視内容を落とさない。**
     *
     * 以前は`<!--`を含む行を丸ごと捨てていたため、`| 行 | 値 | <!-- 補足 -->`の
     * ような**可視の表行が検査から消えた**（Issue #1274、独立reviewerのMedium-2）。
     * コメント区間だけを取り除き、残りが空白でなければ可視行として残す。
     */
    if (inComment) {
      const close = line.indexOf("-->");
      if (close < 0) continue;
      inComment = false;
      const rest = stripComments(line.slice(close + 3));
      if (rest === undefined) {
        // 同じ行で次のコメントが開いて閉じない。可視部分だけを残す。
        const tail = line.slice(close + 3);
        const head = tail.slice(0, tail.indexOf("<!--"));
        inComment = true;
        if (head.trim() !== "") lines.push(head);
        continue;
      }
      if (rest.trim() !== "") lines.push(rest);
      continue;
    }
    if (line.includes("<!--")) {
      const visible = stripComments(line);
      if (visible === undefined) {
        inComment = true;
        const head = line.slice(0, line.indexOf("<!--"));
        if (head.trim() !== "") lines.push(head);
        continue;
      }
      if (visible.trim() !== "") lines.push(visible);
      continue;
    }
    lines.push(line);
  }
  return lines;
}

export function visibleMarkdown(markdown: string): string {
  return visibleMarkdownLines(markdown).join("\n");
}
