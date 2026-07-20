import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { defaultLiveFileRoots, defaultVocabFileRoots, walkTextFiles } from '../lib/scan.js';
import { parseForbiddenTerms } from '../lib/glossary.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';

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
// 「issueの説明」）まで誤って対象外にすることはない。
const PATH_TOKEN_RE = /[\w.{}\-,/]+/g;

/** 行内の指定範囲 [start, start+length) が、バッククォートスパン・プレースホルダスパン・
 * スラッシュを含むパス風トークンのいずれかに完全に包含される場合、散文の誤用ではなく
 * 正当な技術的参照（コード引用・プレースホルダ・ファイルパス）とみなし検査対象から除外する。
 *
 * ただし禁止語自体がパス形式の文字列（例: GLOSSARY.md の `.agent-skill-chain/source`。旧パス名への
 * 言及そのものを禁止する意図）である場合はこれらの除外を一切適用しない。この種の禁止語は
 * 「パス風に見えるから誤検出」なのではなく、禁止されているパス文字列そのものであるため、
 * バッククォートや `/` の有無に関わらず常に検出しなければならない（除外すると禁止語自体が
 * 検査不能になってしまう）。 */
function isCodeLikeReference(line: string, start: number, length: number, banned: string): boolean {
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
  return containedInPathToken(line, start, end);
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

/** 行中に出現する banned の全箇所を走査し、いずれもコード的参照（バッククォート・
 * プレースホルダ・パス風トークン）に包含されない箇所が1つでもあれば、散文の誤用として検出する。 */
function hasProseViolation(line: string, banned: string): boolean {
  let searchFrom = 0;
  while (true) {
    const idx = line.indexOf(banned, searchFrom);
    if (idx === -1) return false;
    if (!isCodeLikeReference(line, idx, banned.length, banned)) return true;
    searchFrom = idx + banned.length;
  }
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
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const { banned, correctTerm } of forbidden) {
          if (hasProseViolation(line, banned)) {
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

// §参照が指す見出しテキストは括弧の手前で終わるのが通例（例:「§不変条件I7（仕様⇔検証の追跡）」の
// 括弧内は見出しの補足であり参照本体ではない）ため、開き括弧の類でも捕捉を止める。
const SECTION_REF_RE = /§([^\s、。,\)）(（「」『』【】]+)/gu;
const FILE_LINE_REF_RE = /\b[\w./-]+\.\w{1,10}:[0-9]+\b/g;

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
    const files = walkTextFiles(resolveTargets(args, root));
    const headings = [...new Set(files.filter((f) => f.endsWith('.md')).flatMap((f) => extractHeadings(f)))];

    const violations: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(SECTION_REF_RE)) {
          if (isQuotedExample(line, match.index, match[0].length, '「', '」')) continue;
          const captured = match[1].replace(/\s+/g, '');
          if (!isResolvable(captured, headings)) {
            violations.push(`${file}:${index + 1}: 禁止参照 '§${match[1]}'（見出しテキストで解決できないセクション番号参照）`);
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

interface AdrFrontmatter {
  id: string;
  status: string;
  supersedes: string[];
  'superseded-by': string | null;
}

function parseAdrFrontmatter(text: string): AdrFrontmatter | undefined {
  const match = /```yaml\n([\s\S]*?)```/.exec(text);
  if (!match) return undefined;
  const lines = match[1].split('\n');
  const get = (key: string): string | undefined => {
    const line = lines.find((l) => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim() : undefined;
  };
  const id = get('id');
  const status = get('status');
  if (!id || !status) return undefined;
  const supersedesRaw = get('supersedes') ?? '[]';
  const supersedes = [...supersedesRaw.matchAll(/ADR-[0-9]+/g)].map((m) => m[0]);
  const supersededByRaw = get('superseded-by') ?? 'null';
  const supersededBy = supersededByRaw === 'null' ? null : supersededByRaw.replace(/^["']|["']$/g, '');
  return { id, status, supersedes, 'superseded-by': supersededBy };
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
    const adrDir = path.join(root, 'docs', 'adr');
    const files = fs.existsSync(adrDir) ? fs.readdirSync(adrDir).filter((f) => f.endsWith('.md')) : [];
    const byId = new Map<string, AdrFrontmatter>();
    for (const file of files) {
      const fm = parseAdrFrontmatter(fs.readFileSync(path.join(adrDir, file), 'utf8'));
      if (fm) byId.set(fm.id, fm);
    }

    const violations: string[] = [];
    for (const [id, fm] of byId) {
      for (const supersededId of fm.supersedes) {
        const target = byId.get(supersededId);
        if (!target) {
          violations.push(`${id}: supersedes が指す ${supersededId} が存在しません`);
        } else if (target['superseded-by'] !== id) {
          violations.push(`${id} と ${supersededId}: supersedes ⇔ superseded-by が非対称です`);
        }
      }
      if (fm['superseded-by']) {
        const target = byId.get(fm['superseded-by']);
        if (!target) {
          violations.push(`${id}: superseded-by が指す ${fm['superseded-by']} が存在しません`);
        } else if (!target.supersedes.includes(id)) {
          violations.push(`${id} と ${fm['superseded-by']}: superseded-by ⇔ supersedes が非対称です`);
        }
      }
    }

    if (violations.length > 0) {
      process.stderr.write(`${violations.join('\n')}\n`);
      return 1;
    }
    return ok();
  });
}
