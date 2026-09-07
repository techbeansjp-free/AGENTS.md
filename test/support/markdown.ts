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
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.includes("<!--")) {
      if (!line.includes("-->")) inComment = true;
      continue;
    }
    /** indented code blockは4スペースまたはtabで始まる。表の行はindentしない。 */
    if (/^(?: {4}|\t)/u.test(line)) continue;
    lines.push(line);
  }
  return lines;
}

export function visibleMarkdown(markdown: string): string {
  return visibleMarkdownLines(markdown).join("\n");
}
