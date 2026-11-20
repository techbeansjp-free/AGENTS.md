#!/usr/bin/env node
// テストの増え方を base と head で比べ、PR の CI の job summary と warning annotation に出す（#1732）。
// 報告と警告だけを行う。閾値を超えても、入力が欠けても、内部で失敗しても終了コードは常に 0。
// 足すときの判断基準は skills/asc/references/implementation.md と review.md にある。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 初期値は 2026-11-13〜11-20 に main へ merge した PR 47件の実測から決めた（#1732）。
// テストの行数の純増は最大 +175、+120 を超えたのは4件。追加したテスト数は最大 +12。
export const DEFAULT_THRESHOLDS = Object.freeze({
 netLines: 120,
 netTests: 8,
 newTestSeconds: 10,
 topSlow: 10,
});

const TEST_ROOT = 'test';
const EXCLUDED = ['test/fixtures/'];
const EXTENSIONS = new Set(['.mjs', '.cjs', '.js']);
// `foo.test(` や `regex.test(` を除くため、直前が識別子・`.`・`$` の呼出しは数えない。
const TEST_CALL = /(?<![\w.$])(?:test|it)(?:\.(?:skip|only|todo))?\s*\(/g;
const PROCESS = /\bchild_process\b/;
const GIT = /['"`]git['"`]/;
const LOCAL_IMPORT = /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/** `test/` の下のテストとその補助ファイルを、repository 相対 path → 本文の Map で返す。 */
export function readTestTree(root) {
 const files = new Map();
 const walk = (relative) => {
  let entries;
  try { entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true }); } catch (error) {
   if (error.code === 'ENOENT') return;
   throw error;
  }
  for (const entry of entries) {
   const child = `${relative}/${entry.name}`;
   if (EXCLUDED.some((prefix) => `${child}/`.startsWith(prefix))) continue;
   if (entry.isDirectory()) walk(child);
   else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) files.set(child, fs.readFileSync(path.join(root, child), 'utf8'));
  }
 };
 walk(TEST_ROOT);
 return files;
}

function countLines(text) {
 if (text === '') return 0;
 return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function localImports(file, text) {
 const found = [];
 for (const match of text.matchAll(LOCAL_IMPORT)) found.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1] ?? match[2])));
 return found;
}

/**
 * ファイル単位で、実プロセス・実 Git を起動するかを判定する。
 * 判定はそのファイルか、そのファイルが import する `test/` の下の補助ファイル（推移的）が
 * `child_process` を参照するか、`'git'` を文字列で書いているか。テスト1件ごとの判定ではなく概算。
 */
function classify(files) {
 const memo = new Map();
 const visit = (file, seen) => {
  if (memo.has(file)) return memo.get(file);
  const text = files.get(file);
  const result = { process: false, git: false };
  if (text === undefined || seen.has(file)) return result;
  seen.add(file);
  result.process = PROCESS.test(text);
  result.git = result.process && GIT.test(text);
  for (const imported of localImports(file, text)) {
   const child = visit(imported, seen);
   result.process ||= child.process;
   result.git ||= child.git;
  }
  memo.set(file, result);
  return result;
 };
 return new Map([...files.keys()].map((file) => [file, visit(file, new Set())]));
}

/** テスト数・行数・ファイル数・実プロセス/実 Git を起動するテストの数を数える。 */
export function measure(files) {
 const kinds = classify(files);
 const perFile = new Map();
 const total = { files: 0, tests: 0, lines: 0, processTests: 0, gitTests: 0 };
 for (const [file, text] of files) {
  const tests = [...text.matchAll(TEST_CALL)].length;
  const lines = countLines(text);
  const kind = kinds.get(file);
  perFile.set(file, { tests, lines, ...kind });
  total.files += 1;
  total.tests += tests;
  total.lines += lines;
  if (kind.process) total.processTests += tests;
  if (kind.git) total.gitTests += tests;
 }
 return { total, perFile };
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(value) {
 return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
  if (entity[0] !== '#') return XML_ENTITIES[entity.toLowerCase()] ?? whole;
  const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
  return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
 });
}

function attributes(raw) {
 const result = {};
 for (const match of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) result[match[1]] = unescapeXml(match[2]);
 return result;
}

/**
 * Node の junit reporter の出力から、最上位のテスト（`test(` 1回に当たる単位）の時間を取り出す。
 * subtest を持つテストは `testsuite` として出るので、最上位の `testsuite` と `testcase` の両方を数える。
 */
export function parseJunit(xml, root) {
 const results = [];
 let depth = 0;
 for (const match of xml.matchAll(/<(\/?)(testsuites|testsuite|testcase)\b([^>]*?)(\/?)>/g)) {
  const [, closing, tag, raw, selfClosing] = match;
  if (tag === 'testsuites') continue;
  if (closing) { depth -= 1; continue; }
  if (depth === 0) {
   const attrs = attributes(raw);
   const seconds = Number.parseFloat(attrs.time);
   if (attrs.name !== undefined && Number.isFinite(seconds)) {
    const absolute = attrs.file ?? '';
    const file = absolute && root ? path.relative(root, absolute).split(path.sep).join('/') : absolute;
    results.push({ name: attrs.name, file, seconds });
   }
  }
  if (!selfClosing) depth += 1;
 }
 return results;
}

/** head で変わったファイルにあり、base の同じファイルに名前が書かれていないテストを新しいテストとみなす。 */
function isNewTest(entry, base, head) {
 const headText = head.get(entry.file);
 const baseText = base.get(entry.file);
 if (headText === undefined || headText === baseText) return false;
 return baseText === undefined || !baseText.includes(entry.name);
}

/** base と head の比較から、報告と警告を組み立てる。入出力は行わない。 */
export function buildReport({ base, head, durations, thresholds = DEFAULT_THRESHOLDS }) {
 const before = measure(base).total;
 const after = measure(head).total;
 const delta = Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
 const warnings = [];
 if (delta.lines > thresholds.netLines) warnings.push({ title: 'テストの行数が増えています', message: `テストの行数が ${signed(delta.lines)} 行です（閾値 +${thresholds.netLines}）。PR 本文に、なぜ足すか、既存のテストで足りない理由を書いてください。` });
 if (delta.tests > thresholds.netTests) warnings.push({ title: 'テストの数が増えています', message: `テストの数が ${signed(delta.tests)} 件です（閾値 +${thresholds.netTests}）。PR 本文に、なぜ足すか、既存のテストで足りない理由を書いてください。` });
 let slowest = null;
 let slowNew = [];
 if (durations) {
  slowest = [...durations].sort((a, b) => b.seconds - a.seconds).slice(0, thresholds.topSlow);
  slowNew = durations.filter((entry) => entry.seconds > thresholds.newTestSeconds && isNewTest(entry, base, head)).sort((a, b) => b.seconds - a.seconds);
  for (const entry of slowNew) warnings.push({ title: '時間のかかる新しいテスト', file: entry.file, message: `新しいテスト「${entry.name}」が ${entry.seconds.toFixed(1)} 秒かかりました（閾値 ${thresholds.newTestSeconds} 秒）。もっと下の層で検査できないか、PR 本文に理由を書いてください。` });
 }
 return { before, after, delta, slowest, slowNew, warnings, thresholds };
}

function signed(value) {
 return value > 0 ? `+${value}` : String(value);
}

function ratio(part, whole) {
 return whole === 0 ? '-' : `${((part / whole) * 100).toFixed(1)}%`;
}

function cell(value) {
 return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** job summary の Markdown。 */
export function renderSummary(report) {
 const { before, after, delta, slowest, slowNew, warnings, thresholds } = report;
 const rows = [
  ['テスト数（`test(`・`it(` の呼出し）', before.tests, after.tests, signed(delta.tests)],
  ['テストの行数', before.lines, after.lines, signed(delta.lines)],
  ['テストのファイル数', before.files, after.files, signed(delta.files)],
  ['実プロセスを起動するテスト', `${before.processTests}（${ratio(before.processTests, before.tests)}）`, `${after.processTests}（${ratio(after.processTests, after.tests)}）`, signed(delta.processTests)],
  ['うち実 Git を起動するテスト', `${before.gitTests}（${ratio(before.gitTests, before.tests)}）`, `${after.gitTests}（${ratio(after.gitTests, after.tests)}）`, signed(delta.gitTests)],
 ];
 const lines = [
  '## テストの増え方（#1732）',
  '',
  warnings.length === 0 ? '閾値を超えた項目はありません。' : `閾値を超えた項目が ${warnings.length} 件あります。PR 本文に、なぜ足すか、既存のテストで足りない理由を書いてください。この報告は check を失敗にしません。`,
  '',
  '| 項目 | base | head | 増減 |',
  '|---|---:|---:|---:|',
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  '',
  `閾値: テストの行数 +${thresholds.netLines} 行、テスト数 +${thresholds.netTests} 件、新しいテスト1件 ${thresholds.newTestSeconds} 秒。実プロセス・実 Git の判定はファイル単位の概算（\`child_process\` の参照と、\`'git'\` の文字列）。`,
  '',
 ];
 if (slowest === null) {
  lines.push('テストの時間の記録がないため、時間のかかるテストは報告していません。', '');
 } else {
  lines.push(`### 時間のかかるテスト（上位 ${thresholds.topSlow} 件）`, '', '| 秒 | ファイル | テスト |', '|---:|---|---|');
  for (const entry of slowest) lines.push(`| ${entry.seconds.toFixed(1)} | ${cell(entry.file)} | ${cell(entry.name)} |`);
  lines.push('');
  if (slowNew.length > 0) {
   lines.push(`### ${thresholds.newTestSeconds} 秒を超えた新しいテスト`, '', '| 秒 | ファイル | テスト |', '|---:|---|---|');
   for (const entry of slowNew) lines.push(`| ${entry.seconds.toFixed(1)} | ${cell(entry.file)} | ${cell(entry.name)} |`);
   lines.push('');
  }
 }
 return `${lines.join('\n')}\n`;
}

function escapeData(value) {
 return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value) {
 return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** GitHub Actions の workflow command（`::warning`）。 */
export function renderAnnotations(warnings) {
 return warnings.map((warning) => {
  const properties = [`title=${escapeProperty(warning.title)}`];
  if (warning.file) properties.unshift(`file=${escapeProperty(warning.file)}`);
  return `::warning ${properties.join(',')}::${escapeData(warning.message)}\n`;
 }).join('');
}

function parseArgs(argv) {
 const options = {};
 for (const arg of argv) {
  const match = /^--(base|head|junit|summary)=(.*)$/.exec(arg);
  if (!match) throw new Error(`不明な引数です: ${arg}`);
  options[match[1]] = match[2];
 }
 if (!options.base || !options.head) throw new Error('--base=<dir> と --head=<dir> が必要です');
 return options;
}

/**
 * CLI 本体。報告だけを行い、どの経路でも 0 を返す。
 * `--summary` がなければ `GITHUB_STEP_SUMMARY`、それもなければ stdout に Markdown を出す。
 */
export function run(argv, env = process.env, out = process.stdout) {
 try {
  const options = parseArgs(argv);
  const head = readTestTree(options.head);
  const base = readTestTree(options.base);
  let durations = null;
  if (options.junit && fs.existsSync(options.junit)) durations = parseJunit(fs.readFileSync(options.junit, 'utf8'), options.head);
  const report = buildReport({ base, head, durations });
  const summary = renderSummary(report);
  const destination = options.summary ?? env.GITHUB_STEP_SUMMARY;
  if (destination) fs.appendFileSync(destination, summary);
  else out.write(summary);
  out.write(renderAnnotations(report.warnings));
 } catch (error) {
  out.write(renderAnnotations([{ title: 'テストの増え方を報告できませんでした', message: `報告だけの処理なので check は失敗にしません: ${error.message}` }]));
 }
 return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
 process.exitCode = run(process.argv.slice(2));
}
