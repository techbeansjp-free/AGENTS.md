import fs from 'node:fs';
import path from 'node:path';
import { git } from '../lib/exec.js';
import { repoRoot } from '../lib/paths.js';
import { defaultLiveFileRoots, defaultReferenceFileRoots, defaultVocabFileRoots, walkTextFiles } from '../lib/scan.js';
import { parseForbiddenTerms } from '../lib/glossary.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';
import { routes } from '../lib/cli-routes.js';
import { collectAdrRecords, checkAdrSymmetry } from '../lib/adr-consistency.js';

const VOCAB_USAGE = `
使い方: agent-skill-chain lint vocab [path...]

path: 検査対象パス（省略時はリポジトリ全体の生きたファイル）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反箇所（ファイル:行）を標準エラー出力へ。
`;

const REFERENCES_USAGE = `
使い方: agent-skill-chain lint references [path...]

path: 検査対象パス（省略時はリポジトリ全体の生きたファイル）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反箇所（ファイル:行）を標準エラー出力へ。
`;

const ADR_USAGE = `
使い方: agent-skill-chain lint adr check

check: 検査を実行するサブコマンド（他のサブコマンドは将来拡張）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反ADR ID・理由を標準エラー出力へ。
`;

const SECRETS_USAGE = `
使い方: agent-skill-chain lint secrets <path...>
       agent-skill-chain lint secrets --diff <base-ref>

path...: 検査対象ファイル（1つ以上必須）。全行を検査する。
--diff <base-ref>: \`git diff <base-ref>...HEAD\` で追加された行（+始まり）のみを検査する（CI向け）。

出力:
  成功時（違反なし）: 終了コード0。
  失敗時（違反あり）: 終了コード1以上。違反箇所（ファイル:行）を標準エラー出力へ。
`;

function resolveTargets(args: string[], root: string, defaultRoots: (root: string) => string[] = defaultLiveFileRoots): string[] {
  return args.length > 0 ? args.map((p) => path.resolve(p)) : defaultRoots(root);
}

// バッククォートで囲まれたインラインコードスパン。スパン内は実コード・実パスの引用であり
// 散文としての禁止語誤用ではないため、vocab検査の対象外とする。
const BACKTICK_SPAN_RE = /`[^`]*`/g;

// `<placeholder>` 形式のプレースホルダトークン（例: `<issue-id>`、`<gate>`）。設定値・命名規則が
// 使う実際のプレースホルダ構文であり、散文中の語の言い換えではないため対象外とする。
const PLACEHOLDER_SPAN_RE = /<[^<>\n]*>/g;

// ASCII のパス・識別子構成文字（英数字・`_.-{},/`）のみからなる連続runで、かつ `/` を1つ以上含む
// もの（例: `.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md`）。日本語の助詞・
// 句読点はこの文字集合に含まれないため、散文中で禁止語が単独の語として使われている箇所（例:
// 「`issue`の説明」）まで誤って対象外にすることはない。
const PATH_TOKEN_RE = /[\w.{}\-,/]+/g;

/** 行内の指定範囲 [start, start+length) が、バッククォートスパン・プレースホルダスパン・
 * スラッシュを含むパス風トークンのいずれかに完全に包含される場合、散文の誤用ではなく
 * 正当な技術的参照（コード引用・プレースホルダ・ファイルパス）とみなし検査対象から除外する。
 *
 * ただし禁止語自体がパス形式の文字列（docs/GLOSSARY.md が定義する、旧ディレクトリ名への言及
 * そのものを禁止する種類の禁止語）である場合はこれらの除外を一切適用しない。この種の禁止語は
 * 「パス風に見えるから誤検出」なのではなく、禁止されているパス文字列そのものであるため、
 * バッククォートや `/` の有無に関わらず常に検出しなければならない（除外すると禁止語自体が
 * 検査不能になってしまう）。 */
function isCodeLikeReference(
  line: string,
  start: number,
  length: number,
  banned: string,
  ext: string,
  inFrontmatter: boolean,
): boolean {
  if (banned.includes('/')) return false;
  const end = start + length;
  const containedIn = (re: RegExp): boolean => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index <= start && end <= m.index + m[0].length) return true;
    }
    return false;
  };
  if (containedIn(BACKTICK_SPAN_RE)) return true;
  if (containedIn(PLACEHOLDER_SPAN_RE)) return true;
  if (containedInPathToken(line, start, end)) return true;
  return isIdentifierContext(line, start, end, banned, ext, inFrontmatter);
}

function containedInPathToken(line: string, start: number, end: number): boolean {
  PATH_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_TOKEN_RE.exec(line))) {
    const tokenStart = m.index;
    const tokenEnd = m.index + m[0].length;
    if (tokenStart <= start && end <= tokenEnd && m[0].includes('/')) return true;
  }
  return false;
}

// ---- 識別子文脈判定（ISSUE-178 DESIGN.md「A. lint-vocab識別子認識」／Issue #187 ADR-1） ----
//
// コード・YAML・CLIサブコマンドの各識別子文脈として禁止語が出現する箇所を、散文の誤用と
// 区別して検査対象から除外する。上記の既存3除外（バッククォート・placeholder・パストークン）を
// 後退させない後段の追加判定として動作する（isCodeLikeReference の最後で呼び出す）。
//
// Issue #187 ADR-1: YAML識別子文脈・CLIサブコマンド文脈は、対象ファイルの拡張子（ext）で
// 適用可否をディスパッチする。動詞ホワイトリストや YAML 風構文が散文（.md）中に偶然
// 出現しただけの禁止語混入を、ファイル種別を見ずに一律で識別子文脈と誤判定し検出漏れさせる
// 構造的抜け穴（Issue #178 finding-1）を塞ぐため。YAML文脈は真の YAML/YML ファイル
// （.yaml/.yml）のみに、CLIサブコマンド文脈は散文（.md）以外（コード・設定・スクリプト）に
// 限定して適用する。コード識別子文脈・外部語彙allowlistは全ファイル種別で共通のまま維持する。

const IDENT_CHAR_RE = /[A-Za-z0-9_]/;

/** Issue #187 ADR-1: YAML識別子文脈（キー構文・flow-sequence構文）を適用する拡張子。 */
const YAML_CONTEXT_EXTENSIONS = new Set(['.yaml', '.yml']);

/** Issue #187 ADR-1: 散文ファイル（Markdown）かどうか。散文では CLI サブコマンド文脈判定を
 * 適用しない（正当な CLI/コード参照はバッククォートで示すのが正規形であるため）。 */
function isProseFile(ext: string): boolean {
  return ext === '.md';
}

interface IdentifierRun {
  runStart: number;
  runEnd: number;
}

/** [start, end) を含む最大の識別子文字（英数字・アンダースコア）runを返す。[start, end) の
 * いずれかの文字が識別子文字でなければ undefined（= 禁止語自体がASCII識別子文字のみで
 * 構成されていない。日本語の禁止語はこの時点で常にundefinedになり、識別子文脈の対象外のまま
 * 散文誤用として引き続き検出される）。 */
function identifierRunAt(line: string, start: number, end: number): IdentifierRun | undefined {
  for (let i = start; i < end; i++) {
    if (!IDENT_CHAR_RE.test(line[i])) return undefined;
  }
  let runStart = start;
  while (runStart > 0 && IDENT_CHAR_RE.test(line[runStart - 1])) runStart--;
  let runEnd = end;
  while (runEnd < line.length && IDENT_CHAR_RE.test(line[runEnd])) runEnd++;
  return { runStart, runEnd };
}

/** `_` 区切り→各chunk内をcamelCase境界（小文字/数字→大文字の遷移直前）でさらに分割する。 */
function splitIdentifierSegments(run: string): string[] {
  return run
    .split('_')
    .filter((chunk) => chunk.length > 0)
    .flatMap((chunk) => chunk.split(/(?<=[a-z0-9])(?=[A-Z])/));
}

/** A-1 コード識別子文脈: snake_case/camelCase/SCREAMING_SNAKE_CASEの複合識別子の一部として
 * 禁止語が出現する場合に除外する。run長が禁止語長と等しい（単独の語そのもの）場合は対象外
 * （要件1「単独の`issue`は識別子文脈と誤認しない」）。
 *
 * 非散文ファイル（コード・設定・スクリプト）では、区切り文字（`_`・camelCase境界）が無い
 * 英語の屈折形（例: `issues`・`issued`）も、runが禁止語より長い時点でASCII識別子・トークン内部の
 * 部分文字列であり単独の禁止語出現ではないため区別なく除外する（ISSUE-283）。散文（.md）では
 * 日本語文中に直接隣接する屈折形（例:「issuesを一覧する」）が禁止語の誤用でありうるため、
 * この広い除外を適用せず従来通りsegment一致のみを識別子文脈として扱う。 */
function isCodeIdentifierContext(line: string, run: IdentifierRun, banned: string, ext: string): boolean {
  const runText = line.slice(run.runStart, run.runEnd);
  if (runText.length <= banned.length) return false;
  if (!isProseFile(ext)) return true;
  return splitIdentifierSegments(runText).some((seg) => seg.toLowerCase() === banned.toLowerCase());
}

function prevNonSpaceChar(line: string, pos: number): string | undefined {
  let i = pos - 1;
  while (i >= 0 && line[i] === ' ') i--;
  return i >= 0 ? line[i] : undefined;
}

function nextNonSpaceChar(line: string, pos: number): string | undefined {
  let i = pos;
  while (i < line.length && line[i] === ' ') i++;
  return i < line.length ? line[i] : undefined;
}

/** Issue #484: 拡張子に対応する単一行コメント開始記号。
 * Issue #510: test/integration/lint.test.tsの回帰テストがコメント部分のみを検査対象へ絞り込む
 * ためexportし、コメント判定ロジックの重複実装を避ける。 */
export function commentMarkerFor(ext: string): string | undefined {
  if (ext === '.ts') return '//';
  if (ext === '.sh' || ext === '.yaml' || ext === '.yml') return '#';
  return undefined;
}

/** Issue #487: 引用符付き文字列の外側にある最初の単一行コメント開始記号を返す。
 * Issue #510: test/integration/lint.test.tsの回帰テストから再利用するためexportする。 */
export function findUnquotedCommentMarkerIndex(line: string, marker: string): number {
  let quote: "'" | '"' | undefined;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote !== undefined) {
      if (char === '\\') {
        i++;
      } else if (char === quote) {
        quote = undefined;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (line.startsWith(marker, i)) {
      return i;
    }
  }

  return -1;
}

/** Issue #484: 禁止語が単一行コメント開始以降にあるかを判定する。
 * Issue #510: test/integration/lint.test.tsの回帰テストから再利用するためexportする。 */
export function isInSingleLineComment(line: string, pos: number, ext: string): boolean {
  const marker = commentMarkerFor(ext);
  if (marker === undefined) return false;
  const markerPos = findUnquotedCommentMarkerIndex(line, marker);
  return markerPos !== -1 && markerPos < pos;
}

/** Issue #469: 単一引用符で囲まれたコード値リテラル文脈。runが禁止語そのもので、
 * 配列要素または関数呼び出し引数の構文境界にある場合に限り除外する。 */
function isQuotedLiteralContext(line: string, run: IdentifierRun, banned: string, ext: string): boolean {
  if (isInSingleLineComment(line, run.runStart, ext)) return false;

  const runText = line.slice(run.runStart, run.runEnd);
  if (runText.length !== banned.length) return false;

  if (line[run.runStart - 1] !== "'" || line[run.runEnd] !== "'") return false;

  const before = prevNonSpaceChar(line, run.runStart - 1);
  const after = nextNonSpaceChar(line, run.runEnd + 1);
  return (before === '[' || before === '(' || before === ',') && (after === ']' || after === ')' || after === ',');
}

/** A-2 YAML識別子文脈（キー構文＋flow-sequence要素）: runが禁止語そのもの（複合でない）の
 * 場合に限り判定する。 */
function isYamlIdentifierContext(line: string, run: IdentifierRun, banned: string): boolean {
  const runText = line.slice(run.runStart, run.runEnd);
  if (runText.length !== banned.length) return false;

  // (a) キー構文: 直前が「行頭からの空白＋任意の`- `」のみ、直後（空白を挟んでよい）が`:`。
  const prefix = line.slice(0, run.runStart);
  const isKeyPrefix = /^\s*(-\s+)?$/.test(prefix);
  const isKeySuffix = /^\s*:/.test(line.slice(run.runEnd));
  if (isKeyPrefix && isKeySuffix) return true;

  // (b) flow-sequence要素: 直前（空白を挟んでよい）が`[`または`,`、直後（同様）が`,`または`]`。
  const before = prevNonSpaceChar(line, run.runStart);
  const after = nextNonSpaceChar(line, run.runEnd);
  if ((before === '[' || before === ',') && (after === ',' || after === ']')) return true;

  return false;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function stripQuotes(token: string): string {
  return token.replace(/^"+|"+$/g, '');
}

let cachedCliVerbs: Set<string> | undefined;

/** cli-routes.ts の2トークンキー（例: `issue start`）の2トークン目をverbホワイトリストとして
 * 導出する。ハードコード二重管理・ドリフトを防ぐ（ISSUE-178 DESIGN.md「A-3」）。
 *
 * 遅延評価する: lint.ts は cli-routes.ts を import し、cli-routes.ts は lint.ts の各サブコマンド
 * ハンドラを routes オブジェクトに登録するため相互import（循環）になる。ESM の循環import自体は
 * 許容されるが、トップレベルで即時に routes を読むと初期化順序次第で TDZ エラーになりうるため、
 * 実行時（CLIディスパッチ完了後）に初めて評価される関数内に閉じ込める。 */
function cliVerbs(): Set<string> {
  if (!cachedCliVerbs) {
    cachedCliVerbs = new Set(
      Object.keys(routes)
        .map((key) => key.split(' '))
        .filter((parts) => parts.length === 2)
        .map((parts) => parts[1]),
    );
  }
  return cachedCliVerbs;
}

/** A-3 CLIサブコマンド文脈: runが禁止語そのもの（複合でない）で、独立したシェルトークンとして
 * 出現し、前後いずれかのトークンが既知CLI verbホワイトリストに含まれる場合に除外する。
 * 「生の隣接文字」（空白スキップ無し）で境界を判定するため、日本語の仮名文字が直接隣接する
 * 場合（例:「`issue`について」）は境界条件を満たさず誤って除外しない。 */
function isCliSubcommandContext(line: string, run: IdentifierRun, banned: string): boolean {
  const runText = line.slice(run.runStart, run.runEnd);
  if (runText.length !== banned.length) return false;

  const before = run.runStart > 0 ? line[run.runStart - 1] : undefined;
  const after = run.runEnd < line.length ? line[run.runEnd] : undefined;
  const isBoundary = (c: string | undefined): boolean => c === undefined || c === ' ' || c === '"';
  if (!isBoundary(before) || !isBoundary(after)) return false;

  const tokens = tokenize(line);
  const idx = tokens.findIndex((t) => t.start <= run.runStart && run.runEnd <= t.end);
  if (idx === -1) return false;
  const prevToken = idx > 0 ? stripQuotes(tokens[idx - 1].text) : undefined;
  const nextToken = idx < tokens.length - 1 ? stripQuotes(tokens[idx + 1].text) : undefined;
  const verbs = cliVerbs();
  return (prevToken !== undefined && verbs.has(prevToken)) || (nextToken !== undefined && verbs.has(nextToken));
}

/** A-4 外部語彙の明示許可リスト: 改名不可・バッククォート付与不可の既知の少数の完全一致
 * トークンのみを列挙する（ISSUE-178 DESIGN.md「A-4」）。正規表現・部分一致は持たない。 */
const EXTERNAL_VOCAB_ALLOWLIST: readonly string[] = ['blank_issues_enabled'];

function isExternalVocabAllowlisted(line: string, run: IdentifierRun, ext: string): boolean {
  const runText = line.slice(run.runStart, run.runEnd);
  if (EXTERNAL_VOCAB_ALLOWLIST.includes(runText)) return true;
  // GitHub Actionsが定義するGITHUB_TOKEN permission key。散文の複数形まで除外せず、
  // 真のYAML key位置にある改名不能な外部schema語彙だけを許可する。
  return (
    YAML_CONTEXT_EXTENSIONS.has(ext) &&
    runText === 'issues' &&
    /^\s*(-\s+)?$/.test(line.slice(0, run.runStart)) &&
    /^\s*:/.test(line.slice(run.runEnd))
  );
}

/** ハイフンを含む識別子文字集合（ケバブケーストークン境界の拡張用）。`IDENT_CHAR_RE` は
 * ハイフンを含まないため、`identifierRunAt` が返す run はハイフンで分断された最初のセグメント
 * （例: `issue-start` の `issue` 部分のみ）に留まる。 */
const KEBAB_CHAR_RE = /[A-Za-z0-9_-]/;

/** run の左右をハイフン区切りの識別子文字へ拡張し、ケバブケースの完全なトークンを返す。 */
function expandToKebabToken(line: string, run: IdentifierRun): string {
  let start = run.runStart;
  while (start > 0 && KEBAB_CHAR_RE.test(line[start - 1])) start--;
  let end = run.runEnd;
  while (end < line.length && KEBAB_CHAR_RE.test(line[end])) end++;
  return line.slice(start, end);
}

/** 行頭がYAMLキー構文（`key: `、`key:`の直後に値が続く形）であるかを判定する。 */
const YAML_KEY_PREFIX_RE = /^[A-Za-z_][\w-]*:\s*/;

/** 値全体が空白を含まない単一のケバブケース識別子（例: `issue-start`）と完全一致するかを判定する。
 * `description:`・`when_to_use:` のような自由記述（散文）フィールドは複数語・空白を含むため
 * この正規表現に一致せず、識別子文脈の除外対象から外れる。 */
const KEBAB_IDENTIFIER_VALUE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Markdownファイル（SKILL.md等）先頭のYAMLフロントマターにおける、キーの値側のケバブケース
 * 識別子文脈。フロントマターの`name:`フィールド等でディレクトリ名と一致させるためkebab-case識別子
 * （例: `issue-start`）を値に持つ場合、`issue`のようなセグメントが単独の禁止語と誤認される
 * （手動implementation-gateレビュー指摘: skill-name-frontmatter-mismatch の是正で顕在化）。
 * `isYamlIdentifierContext`（.yaml/.yml限定・キー自体が禁止語と完全一致する場合のみを扱う）とは
 * 対象が異なるため独立実装する: 本関数は「値」側のケバブケース複合語のセグメント一致を扱う。
 * `inFrontmatter`（行が先頭`---`〜`---`ブロック内かどうか）とYAMLキー構文の両方に加え、値全体が
 * 単一のケバブケース識別子（`KEBAB_IDENTIFIER_VALUE_RE`）である場合のみ適用する。`description:`・
 * `when_to_use:` のような自由記述（散文）フィールドの値はこの条件を満たさないため対象外のままとなり、
 * 散文中のハイフン複合語に含まれる禁止語は引き続き検出される（手動implementation-gateレビュー指摘:
 * lint-frontmatter-exemption-too-broad の是正）。 */
function isMarkdownFrontmatterValueContext(
  line: string,
  run: IdentifierRun,
  banned: string,
  ext: string,
  inFrontmatter: boolean,
): boolean {
  if (ext !== '.md' || !inFrontmatter) return false;
  const keyMatch = YAML_KEY_PREFIX_RE.exec(line);
  if (!keyMatch) return false;
  const value = line.slice(keyMatch[0].length).trim();
  if (!KEBAB_IDENTIFIER_VALUE_RE.test(value)) return false;
  const token = expandToKebabToken(line, run);
  if (token.length <= banned.length || !token.includes('-')) return false;
  return token
    .split(/[-_]/)
    .flatMap((seg) => seg.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .some((seg) => seg.toLowerCase() === banned.toLowerCase());
}

function isIdentifierContext(
  line: string,
  start: number,
  end: number,
  banned: string,
  ext: string,
  inFrontmatter: boolean,
): boolean {
  const run = identifierRunAt(line, start, end);
  if (!run) return false;
  if (isCodeIdentifierContext(line, run, banned, ext)) return true;
  if (YAML_CONTEXT_EXTENSIONS.has(ext) && isYamlIdentifierContext(line, run, banned)) return true;
  if (!isProseFile(ext) && isCliSubcommandContext(line, run, banned)) return true;
  if (!isProseFile(ext) && isQuotedLiteralContext(line, run, banned, ext)) return true;
  if (isMarkdownFrontmatterValueContext(line, run, banned, ext, inFrontmatter)) return true;
  return isExternalVocabAllowlisted(line, run, ext);
}

/** 行中に出現する banned の全箇所を走査し、いずれもコード的参照（バッククォート・
 * プレースホルダ・パス風トークン）に包含されない箇所が1つでもあれば、散文の誤用として検出する。
 * `ext` は当該ファイルの拡張子（例: '.md'）。Issue #187 ADR-1: YAML/CLIサブコマンド識別子文脈の
 * 適用可否をファイル種別でディスパッチするために isCodeLikeReference へ伝播する。 */
function hasProseViolation(line: string, banned: string, ext: string, inFrontmatter: boolean): boolean {
  let searchFrom = 0;
  while (true) {
    const idx = line.indexOf(banned, searchFrom);
    if (idx === -1) return false;
    if (!isCodeLikeReference(line, idx, banned.length, banned, ext, inFrontmatter)) return true;
    searchFrom = idx + banned.length;
  }
}

/** 先頭が`---`単独行で始まり、その次に現れる`---`単独行までの間（境界のdelimiter行自体は含まない）を
 * Markdownのフロントマターブロックとみなし、その範囲内にある0-basedの行indexの集合を返す。
 * 先頭行が`---`でない、または閉じ側の`---`が見つからない場合は空集合（フロントマター無し）。 */
function computeFrontmatterLineIndices(lines: string[]): Set<number> {
  const indices = new Set<number>();
  if (lines[0]?.trim() !== '---') return indices;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') return indices;
    indices.add(i);
  }
  // 閉じ側の`---`が見つからなかった場合はフロントマターが未確定であり、識別子文脈の
  // 適用対象を誤って広げないよう空集合を返す。
  return new Set<number>();
}

export async function vocab(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(VOCAB_USAGE);
      return 0;
    }
    const root = repoRoot();
    const glossaryPath = path.join(root, 'docs', 'GLOSSARY.md');
    const forbidden = parseForbiddenTerms(glossaryPath);
    const files = walkTextFiles(resolveTargets(args, root, defaultVocabFileRoots));

    const violations: string[] = [];
    for (const file of files) {
      const ext = path.extname(file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const frontmatterLines = ext === '.md' ? computeFrontmatterLineIndices(lines) : new Set<number>();
      lines.forEach((line, index) => {
        for (const { banned, correctTerm } of forbidden) {
          if (hasProseViolation(line, banned, ext, frontmatterLines.has(index))) {
            violations.push(`${file}:${index + 1}: 禁止語 '${banned}' が見つかりました（'${correctTerm}' を使用してください）`);
          }
        }
      });
    }

    if (violations.length > 0) {
      process.stderr.write(`${violations.join('\n')}\n`);
      return 1;
    }
    return ok();
  });
}

// 禁止参照が指す見出しテキストは括弧の手前で終わるのが通例（見出し名の直後に補足の丸括弧が
// 続く記法があり、括弧内は見出しの補足であって参照本体ではないため）、開き括弧の類でも捕捉を止める。
const SECTION_REF_RE = /§([^\s、。,\)）(（「」『』【】]+)/gu;
const FILE_LINE_REF_RE = /\b[\w./-]+\.\w{1,10}:[0-9]+\b/g;

// 違反メッセージの組み立て（下記 references 関数内）で使う節番号記号そのもの。ソース中に生の
// 記号を直接埋め込むと、lint references 自身の SECTION_REF_RE が自己言及として誤検出するため、
// Unicodeエスケープ経由で参照する（実行時に得られる出力文字列は不変。機械処理用エラー出力での
// 使用は許可されている）。
const SECTION_SIGIL = '\u00a7';

function extractHeadings(filePath: string): string[] {
  const headings: string[] = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (m) headings.push(m[1].trim().replace(/\s+/g, ''));
  }
  return headings;
}

/** 末尾の英数字・ローマ数字風コード（例: 見出し「不変条件 I1〜I8」に対する参照「§不変条件I7」の
 * 「I7」部分）を取り除いた芯部分で比較する。AGENTS.md I1〜I8 のような、見出し内に列挙された
 * 安定IDへの参照は本文の「陳腐化防止」原則の対象外（安定ID使用は明示的に許可されている）。 */
function headingCore(value: string): string {
  return value.replace(/(?:[・、,]?[0-9A-Za-z〜～\-]+)+$/u, '');
}

/** 「§3.2を参照」のように、禁止パターン自体を例示する引用（「」・バッククォート囲み）は
 * ルール本文中の説明であって実際の参照ではないため対象外とする。 */
function isQuotedExample(line: string, matchIndex: number | undefined, matchLength: number, open: string, close: string): boolean {
  if (matchIndex === undefined) return false;
  return line[matchIndex - 1] === open && line[matchIndex + matchLength] === close;
}

function isResolvable(captured: string, headings: string[]): boolean {
  if (headings.some((h) => h.startsWith(captured) || captured.startsWith(h))) return true;
  const core = headingCore(captured);
  if (!core) return false;
  return headings.some((h) => headingCore(h) === core);
}

export async function references(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(REFERENCES_USAGE);
      return 0;
    }
    const root = repoRoot();
    const files = walkTextFiles(resolveTargets(args, root, defaultReferenceFileRoots));
    const headings = [...new Set(files.filter((f) => f.endsWith('.md')).flatMap((f) => extractHeadings(f)))];

    const violations: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(SECTION_REF_RE)) {
          if (isQuotedExample(line, match.index, match[0].length, '「', '」')) continue;
          const captured = match[1].replace(/\s+/g, '');
          if (!isResolvable(captured, headings)) {
            violations.push(`${file}:${index + 1}: 禁止参照 '${SECTION_SIGIL}${match[1]}'（見出しテキストで解決できないセクション番号参照）`);
          }
        }
        for (const match of line.matchAll(FILE_LINE_REF_RE)) {
          if (isQuotedExample(line, match.index, match[0].length, '`', '`')) continue;
          violations.push(`${file}:${index + 1}: 禁止参照 '${match[0]}'（ファイルパス＋行番号参照）`);
        }
      });
    }

    if (violations.length > 0) {
      process.stderr.write(`${violations.join('\n')}\n`);
      return 1;
    }
    return ok();
  });
}

export async function adr(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(ADR_USAGE);
      return 0;
    }
    if (args[0] !== 'check') {
      process.stderr.write(`未知のサブコマンドです: '${args[0] ?? ''}'（'check' のみ対応）\n`);
      return 1;
    }

    const root = repoRoot();
    const byId = collectAdrRecords(root);
    const violations = checkAdrSymmetry(byId);

    if (violations.length > 0) {
      process.stderr.write(`${violations.join('\n')}\n`);
      return 1;
    }
    return ok();
  });
}

// ---- lint secrets（ISSUE-178 DESIGN.md「D. secret scan CI」） ----
//
// 既知のsecretフォーマットの接頭辞に限定した軽量な自前正規表現ベースの検査。エントロピー
// ベースの汎用検出は持たない（誤検出率を抑えるため）。lint vocab/lint references と同じ
// 「軽量な自前実装＋薄いshラッパー」アーキテクチャを踏襲する。

interface SecretPattern {
  name: string;
  re: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'AWS Access Key ID', re: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS Secret Access Key', re: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i },
  { name: 'GitHub PAT', re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,48}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[0-9A-Za-z]{24,}\b/ },
  { name: 'PEM秘密鍵ヘッダ', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
];

function detectSecrets(line: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(line)) hits.push(name);
  }
  return hits;
}

function reportViolations(violations: string[]): number {
  if (violations.length > 0) {
    process.stderr.write(`${violations.join('\n')}\n`);
    return 1;
  }
  return ok();
}

function scanFilesForSecrets(files: string[]): number {
  const violations: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const name of detectSecrets(line)) {
        violations.push(`${file}:${index + 1}: secretパターン '${name}' の疑いがある文字列が見つかりました`);
      }
    });
  }
  return reportViolations(violations);
}

interface DiffAddedLine {
  file: string;
  lineNumber: number;
  text: string;
}

/** unified diff（`git diff <base>...HEAD`の出力）から、追加された行（`+`始まり、`+++`ヘッダを
 * 除く）のみを新ファイル側の行番号付きで抽出する。 */
function parseDiffAddedLines(diffText: string): DiffAddedLine[] {
  const result: DiffAddedLine[] = [];
  let currentFile = '';
  let newLineNo = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ')) {
      const m = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
      currentFile = m ? m[1] : '';
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLineNo = parseInt(hunk[1], 10);
      continue;
    }
    if (line.startsWith('+')) {
      result.push({ file: currentFile, lineNumber: newLineNo, text: line.slice(1) });
      newLineNo++;
      continue;
    }
    if (line.startsWith('-')) continue; // 削除行は新ファイルに存在しないため行番号を進めない
    if (line.startsWith(' ')) {
      newLineNo++;
    }
  }
  return result;
}

function scanDiffForSecrets(root: string, baseRef: string): number {
  const diff = git(['diff', `${baseRef}...HEAD`], root);
  if (diff.status !== 0) {
    throw new Error(`git diff ${baseRef}...HEAD が失敗しました（終了コード ${diff.status}）: ${diff.stderr.trim()}`);
  }
  const diffText = diff.stdout;
  const violations: string[] = [];
  for (const added of parseDiffAddedLines(diffText)) {
    for (const name of detectSecrets(added.text)) {
      violations.push(`${added.file}:${added.lineNumber}: secretパターン '${name}' の疑いがある文字列が見つかりました`);
    }
  }
  return reportViolations(violations);
}

export async function secrets(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(SECRETS_USAGE);
      return 0;
    }
    if (args[0] === '--diff') {
      const baseRef = args[1];
      if (!baseRef) {
        process.stderr.write("'--diff' には base-ref の指定が必要です\n");
        return 1;
      }
      return scanDiffForSecrets(repoRoot(), baseRef);
    }
    if (args.length === 0) {
      process.stderr.write('検査対象パスを1つ以上指定してください（またはヘルプ: lint secrets -h）\n');
      return 1;
    }
    return scanFilesForSecrets(args.map((p) => path.resolve(p)));
  });
}
