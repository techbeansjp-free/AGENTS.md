import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import { resolveContained } from "../lib/security.js";
import { computeImpactSet } from "./impact-set.js";

export const RELATED_FILE_LIMIT = 20;
export const RELATED_STEM_MATCH_LIMIT = 10;
export const REVIEW_COLLECTION_BYTE_LIMIT = 1024 * 1024;

export interface SupplementalReviewDiffCollection {
  target: "diff";
  changed: string[];
  related: string[];
  truncated: boolean;
  promptBody: string;
}

export interface SupplementalReviewStagingCollection {
  target: "staging";
  changed: string[];
  promptBody: string;
}

const ID_PATTERN = /\b(?:AC|FR|NFR|INV|RQ|OUTCOME|DC|TERM-ASC)-\d+\b/g;

/** ERE metacharacterをescapeする（stemを`git grep -E`のpatternへ安全に埋め込むため）。 */
function escapeExtendedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * import/require/exportのmodule specifier内でstemが使われているかを狙う、
 * 依存関係寄りのpattern（CodeRabbitのcode graphに相当するAST解析は持たないため、
 * `import ... from "..."`・`require("...")`・`import("...")`の字面で近似する）。
 * 一致は「呼び出し元/呼び出し先」の強い根拠として扱い、RELATED_STEM_MATCH_LIMIT
 * （汎用stem対策の閾値）を適用しない。そのため、module specifierの末尾segmentが
 * stemと完全一致する場合だけを対象にする（先頭は任意のpath prefix、末尾は任意の
 * 拡張子だけを許す）。前後を無制限にすると`config`が`configuration.js`や
 * `old-config.js`にも一致し、閾値を迂回する無関係importでlimitを消費してしまう
 * （CodeRabbit指摘）。
 */
function importReferencePattern(stem: string): string {
  const escaped = escapeExtendedRegex(stem);
  return `(import|require|from)[^"']*["']([^"']*/)?${escaped}(\\.[^/"']+)?["']`;
}

function runRelatedFileGrep(
  root: string,
  headSha: string,
  grepArgs: string[],
): { matches: string[] } | { skipped: true } {
  const grep = git(grepArgs, root, {
    allowFailure: true,
    maxBufferBytes: REVIEW_COLLECTION_BYTE_LIMIT,
  });
  // 過剰な一致は非specificなstemと同等に扱う。検索失敗とは区別する。
  if (
    grep.stderr.startsWith(
      `git ${grepArgs.join(" ")}を実行できませんでした（ENOBUFS）:`,
    )
  )
    return { skipped: true };
  if (grep.status > 1 || grep.stderr !== "")
    throw new Error("関連fileの探索を安全に完了できませんでした");
  return {
    matches: grep.stdout.split("\0").filter((line) => line !== ""),
  };
}

function targetedImpactRelated(
  root: string,
  baseSha: string,
  headSha: string,
): string[] | undefined {
  try {
    const impact = computeImpactSet({ root, baseSha, headSha });
    if (impact.mode !== "targeted") return undefined;
    return impact.adjacent.map(({ path: adjacentPath }) => adjacentPath);
  } catch {
    return undefined;
  }
}

function toCandidatePath(line: string, headSha: string): string {
  return line.startsWith(`${headSha}:`) ? line.slice(headSha.length + 1) : line;
}

/**
 * Step 10相当の対象を収集する。base..headの変更fileと、その呼び出し元
 * （fileの識別子を含む他file）を関連fileとして追加する。dotfileと
 * 広範囲に現れる汎用名は検索根拠にしない。上限件数で打ち切る。
 *
 * 関連file検出は2段構え: (1) import/require/exportのmodule specifier内で
 * stemが使われている一致は依存関係の強い根拠として無条件で採用し、
 * 汎用stemの閾値を適用しない（over-exclusionでcross-file findingが
 * 落ちるのを防ぐ）。(2) それ以外の全文一致は従来通り閾値で足切りする。
 */
export function collectSupplementalReviewDiff(
  root: string,
  baseSha: string,
  headSha: string,
  limit: number = RELATED_FILE_LIMIT,
): SupplementalReviewDiffCollection {
  const changed = git(
    ["diff", "--name-only", "-z", `${baseSha}..${headSha}`],
    root,
    { maxBufferBytes: REVIEW_COLLECTION_BYTE_LIMIT },
  )
    .stdout.split("\0")
    .filter((value) => value !== "");
  const diffText = git(["diff", `${baseSha}..${headSha}`], root, {
    maxBufferBytes: REVIEW_COLLECTION_BYTE_LIMIT,
  }).stdout;
  if (Buffer.byteLength(diffText, "utf8") > REVIEW_COLLECTION_BYTE_LIMIT)
    throw new Error("review差分が1MiBを超えました");

  const related: string[] = [];
  let truncated = false;
  /**
   * **影響集合がtargetedなら、その隣接範囲を関連fileにする**（REQ-WF-039）。
   * 意味Graphのimport edgeから導出した直接import元・import先であり、stemの
   * 字面一致より根拠が強い。fullのとき（影響を証明できないとき）と、SHAを
   * exact commitへ解決できない等で導出自体ができないときは従来の探索へ戻る。
   */
  const impactRelated = targetedImpactRelated(root, baseSha, headSha);
  if (impactRelated !== undefined) {
    related.push(...impactRelated.slice(0, limit));
    truncated = impactRelated.length > limit;
  }
  for (const changedPath of impactRelated === undefined ? changed : []) {
    if (truncated) break;
    const basename = path.basename(changedPath);
    const extension = path.extname(basename);
    if (basename.startsWith(".") && extension === "") continue;
    const stem = path.basename(basename, extension);
    if (stem === "") continue;

    const addCandidates = (matches: string[]): void => {
      for (const line of matches) {
        if (truncated) return;
        const candidate = toCandidatePath(line, headSha);
        if (
          candidate === "" ||
          changed.includes(candidate) ||
          related.includes(candidate)
        )
          continue;
        if (related.length >= limit) {
          truncated = true;
          return;
        }
        related.push(candidate);
      }
    };

    const preciseResult = runRelatedFileGrep(root, headSha, [
      "grep",
      "-l",
      "-z",
      "-E",
      "-e",
      importReferencePattern(stem),
      headSha,
    ]);
    /**
     * precise検索は閾値を適用しない無条件signalなので、ENOBUFSで取得自体に
     * 失敗した場合は「非specificだから除外」（生成側の判定）と区別し、
     * 収集不能を`truncated`で呼出し元へ伝える（CodeRabbit指摘）。
     */
    if ("skipped" in preciseResult) {
      truncated = true;
      break;
    }
    addCandidates(preciseResult.matches);
    if (truncated) break;

    const genericResult = runRelatedFileGrep(root, headSha, [
      "grep",
      "-l",
      "-z",
      "--fixed-strings",
      "-e",
      stem,
      headSha,
    ]);
    if ("skipped" in genericResult) continue;
    if (genericResult.matches.length > RELATED_STEM_MATCH_LIMIT) continue;
    addCandidates(genericResult.matches);
  }

  const relatedSections: string[] = [];
  let collectedBytes = Buffer.byteLength(diffText, "utf8");
  for (const relatedPath of related) {
    if (
      git(["cat-file", "-e", `${headSha}:${relatedPath}`], root, {
        allowFailure: true,
      }).status !== 0
    )
      continue;
    const body = git(["show", `${headSha}:${relatedPath}`], root, {
      maxBufferBytes: REVIEW_COLLECTION_BYTE_LIMIT,
    }).stdout;
    const section = `### ${relatedPath}\n${body}`;
    collectedBytes += Buffer.byteLength(section, "utf8") + 2;
    if (collectedBytes > REVIEW_COLLECTION_BYTE_LIMIT)
      throw new Error("review差分と関連fileが1MiBを超えました");
    relatedSections.push(section);
  }
  const relatedText = relatedSections.join("\n\n");

  const promptBody =
    `## diff (${baseSha}..${headSha})\n${diffText}\n\n` +
    `## 関連ファイル（未変更、上限${limit}件、呼び出し元・呼び出し先の文脈として提供）\n${relatedText}`;

  return { target: "diff", changed, related, truncated, promptBody };
}

/**
 * Step 03/07相当の対象を収集する。staging path配下に存在する文書を
 * 読み込み、ID出現箇所を抽出してprompt本文へ含める（FR-1428-03）。
 * どのfile名が存在するかは利用projectのstaging構成に依存するため、
 * 固定のfile一覧を要求せず、存在するものだけを対象にする。
 */
export function collectSupplementalReviewStaging(
  root: string,
  stagingPath: string,
): SupplementalReviewStagingCollection {
  const resolvedStaging = resolveContained(root, stagingPath);
  const entries = fs
    .readdirSync(resolvedStaging, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  if (entries.length > 100)
    throw new Error("review対象文書が100件を超えました");

  const changed: string[] = [];
  const sections: string[] = [];
  let collectedBytes = 0;
  for (const name of entries) {
    const file = path.join(resolvedStaging, name);
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    let text: string;
    try {
      const stat = fs.fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size > REVIEW_COLLECTION_BYTE_LIMIT - collectedBytes
      )
        throw new Error("review対象文書が1MiBを超えました");
      text = fs.readFileSync(fd, "utf8");
    } finally {
      fs.closeSync(fd);
    }
    changed.push(name);
    const ids = [...new Set(text.match(ID_PATTERN) ?? [])].sort();
    const section = `### ${name}\n出現ID: ${ids.length > 0 ? ids.join("、") : "（なし）"}\n\n${text}`;
    collectedBytes += Buffer.byteLength(section, "utf8") + 2;
    if (collectedBytes > REVIEW_COLLECTION_BYTE_LIMIT)
      throw new Error("review対象文書が1MiBを超えました");
    sections.push(section);
  }

  const promptBody = sections.join("\n\n");

  return { target: "staging", changed, promptBody };
}
