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
// 文字列・template・コメント・正規表現の中は scanSource で取り除いてから数える。
const TEST_CALL = /(?<![\w.$])(?:test|it)(?:\.(?:skip|only|todo))?\s*\(/g;
const IMPORT = /\bfrom\s*"#(\d+)"|\bimport\s*\(?\s*"#(\d+)"|\brequire\s*\(\s*"#(\d+)"\s*\)/g;
const PROCESS_MODULES = new Set(['child_process', 'node:child_process']);
const REGEX_PREFIX = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|await|yield)$/;

/**
 * JavaScript の本文から、コメントを空白に、文字列と template を `"#<番号>"` に、正規表現を `/r/` に置き換える。
 * 文字列の値は `strings` に入れる（`${}` を含む template は値を null とし、中の式は数えない）。
 * 構文解析器ではなく、テスト数と import を数えるための概算。
 */
export function scanSource(text) {
 const strings = [];
 let code = '';
 let index = 0;
 const lastSignificant = () => code.replace(/\s+$/, '');
 while (index < text.length) {
  const char = text[index];
  const next = text[index + 1];
  if (char === '/' && next === '/') {
   const end = text.indexOf('\n', index);
   index = end < 0 ? text.length : end;
   code += ' ';
  } else if (char === '/' && next === '*') {
   const end = text.indexOf('*/', index + 2);
   const comment = text.slice(index, end < 0 ? text.length : end + 2);
   code += comment.replace(/[^\n]/g, ' ');
   index += comment.length;
  } else if (char === "'" || char === '"' || char === '`') {
   let value = '';
   let interpolated = false;
   let cursor = index + 1;
   let depth = 0;
   while (cursor < text.length) {
    const current = text[cursor];
    if (current === '\\') { value += text.slice(cursor, cursor + 2); cursor += 2; continue; }
    if (char === '`' && depth === 0 && current === '$' && text[cursor + 1] === '{') { interpolated = true; depth = 1; cursor += 2; continue; }
    if (depth > 0) {
     if (current === '{') depth += 1;
     else if (current === '}') depth -= 1;
     cursor += 1;
     continue;
    }
    if (current === char) break;
    if (char !== '`' && current === '\n') break;
    value += current;
    cursor += 1;
   }
   strings.push(interpolated ? null : value);
   code += `"#${strings.length - 1}"`;
   code += text.slice(index, cursor + 1).replace(/[^\n]/g, '').replace(/\n/g, '\n');
   index = cursor + 1;
  } else if (char === '/') {
   const before = lastSignificant();
   const previous = before[before.length - 1];
   if (previous === undefined || REGEX_PREFIX.has(previous) || REGEX_KEYWORDS.test(before)) {
    let cursor = index + 1;
    let inClass = false;
    while (cursor < text.length && text[cursor] !== '\n') {
     const current = text[cursor];
     if (current === '\\') { cursor += 2; continue; }
     if (current === '[') inClass = true;
     else if (current === ']') inClass = false;
     else if (current === '/' && !inClass) break;
     cursor += 1;
    }
    cursor += 1;
    while (cursor < text.length && /[a-z]/i.test(text[cursor])) cursor += 1;
    code += '/r/';
    index = cursor;
   } else {
    code += char;
    index += 1;
   }
  } else {
   code += char;
   index += 1;
  }
 }
 return { code, strings };
}

/** `test/` の下のテストとその補助ファイルを、repository 相対 path → 本文の Map で返す。`test/` がなければ null。 */
export function readTestTree(root) {
 if (!fs.statSync(path.join(root, TEST_ROOT), { throwIfNoEntry: false })?.isDirectory()) return null;
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

function localImports(file, scanned) {
 const found = [];
 for (const match of scanned.code.matchAll(IMPORT)) {
  const specifier = scanned.strings[Number(match[1] ?? match[2] ?? match[3])];
  if (typeof specifier === 'string' && /^\.{1,2}\//.test(specifier)) found.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
 }
 return found;
}

/**
 * ファイル単位で、実プロセス・実 Git を起動するかを判定する。
 * そのファイルと、そのファイルから import・require でたどれる `test/` の下のファイルのどれかが
 * `child_process` を import していれば実プロセス、さらにどれかが値がちょうど `git` の文字列を書いていれば実 Git。
 * 文字列の中に書いたサンプルは数えない。`src/` などテストの外を経由した起動は数えないので、少なめに出る概算。
 */
function classify(scannedFiles) {
 const own = new Map([...scannedFiles].map(([file, scanned]) => [file, {
  process: scanned.strings.some((value) => PROCESS_MODULES.has(value)),
  git: scanned.strings.includes('git'),
  imports: localImports(file, scanned),
 }]));
 const result = new Map();
 for (const file of own.keys()) {
  // 循環 import があっても取りこぼさないよう、たどれるファイルの集合を毎回求める。
  const reachable = new Set([file]);
  const pending = [file];
  while (pending.length > 0) {
   for (const imported of own.get(pending.pop()).imports) {
    if (!own.has(imported) || reachable.has(imported)) continue;
    reachable.add(imported);
    pending.push(imported);
   }
  }
  const flags = [...reachable].map((item) => own.get(item));
  const process = flags.some((item) => item.process);
  result.set(file, { process, git: process && flags.some((item) => item.git) });
 }
 return result;
}

/** テスト数・行数・ファイル数・実プロセス/実 Git を起動するテストの数を数える。 */
export function measure(files) {
 const scannedFiles = new Map([...files].map(([file, text]) => [file, scanSource(text)]));
 const kinds = classify(scannedFiles);
 const perFile = new Map();
 const total = { files: 0, tests: 0, lines: 0, processTests: 0, gitTests: 0 };
 for (const [file, text] of files) {
  const tests = [...scannedFiles.get(file).code.matchAll(TEST_CALL)].length;
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
 * Node 24 は subtest を持つ `testsuite` に `file` を付けないため、中の最初の `file` を使う。
 */
export function parseJunit(xml, root) {
 const results = [];
 let depth = 0;
 let open = null;
 const relative = (absolute) => (absolute && root ? path.relative(root, absolute).split(path.sep).join('/') : absolute);
 for (const match of xml.matchAll(/<(\/?)(testsuites|testsuite|testcase)\b((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
  const [, closing, tag, raw, selfClosing] = match;
  if (tag === 'testsuites') continue;
  if (closing) {
   depth -= 1;
   if (depth === 0) open = null;
   continue;
  }
  const attrs = attributes(raw);
  if (depth === 0) {
   const seconds = Number.parseFloat(attrs.time);
   if (attrs.name !== undefined && Number.isFinite(seconds)) {
    const entry = { name: attrs.name, file: relative(attrs.file ?? ''), seconds };
    results.push(entry);
    if (!selfClosing) open = entry;
   }
  } else if (open && open.file === '' && attrs.file) {
   open.file = relative(attrs.file);
  }
  if (!selfClosing) depth += 1;
 }
 return results;
}

/**
 * head で変わったファイルにあり、base の同じファイルに同じ名前の文字列がないテストを新しいテストとみなす。
 * 名前を `${}` で組み立てるテストと、名前を変えた・移したテストは新しいとみなす（警告が多めに出る側の概算）。
 */
function isNewTest(entry, base, head) {
 const headText = head.get(entry.file);
 const baseText = base.get(entry.file);
 if (headText === undefined || headText === baseText) return false;
 return baseText === undefined || !scanSource(baseText).strings.includes(entry.name);
}

/** base と head の比較から、報告と警告を組み立てる。入出力は行わない。 */
export function buildReport({ base, head, durations, thresholds = DEFAULT_THRESHOLDS }) {
 // base を読めなければ、増減も新しいテストも判定できない。空の base と比べて全体を純増と誤報しない。
 const comparable = base !== null;
 const after = measure(head).total;
 const before = comparable ? measure(base).total : null;
 const delta = comparable ? Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]])) : null;
 const warnings = [];
 if (!comparable) warnings.push({ title: 'テストの増え方を比較できませんでした', message: 'base の test/ を読めなかったため、増減と新しいテストは判定していません。check は失敗にしません。' });
 if (comparable && delta.lines > thresholds.netLines) warnings.push({ title: 'テストの行数が増えています', message: `テストの行数が ${signed(delta.lines)} 行です（閾値 +${thresholds.netLines}）。PR 本文に、なぜ足すか、既存のテストで足りない理由を書いてください。` });
 if (comparable && delta.tests > thresholds.netTests) warnings.push({ title: 'テストの数が増えています', message: `テストの数が ${signed(delta.tests)} 件です（閾値 +${thresholds.netTests}）。PR 本文に、なぜ足すか、既存のテストで足りない理由を書いてください。` });
 let slowest = null;
 let slowNew = [];
 if (durations) {
  slowest = [...durations].sort((a, b) => b.seconds - a.seconds).slice(0, thresholds.topSlow);
  slowNew = comparable ? durations.filter((entry) => entry.seconds > thresholds.newTestSeconds && isNewTest(entry, base, head)).sort((a, b) => b.seconds - a.seconds) : [];
  for (const entry of slowNew) warnings.push({ title: '時間のかかる新しいテスト', file: entry.file, message: `新しいテスト「${entry.name}」が ${entry.seconds.toFixed(1)} 秒かかりました（閾値 ${thresholds.newTestSeconds} 秒）。もっと下の層で検査できないか、PR 本文に理由を書いてください。` });
 }
 return { comparable, before, after, delta, slowest, slowNew, warnings, thresholds };
}

function signed(value) {
 return value > 0 ? `+${value}` : String(value);
}

function ratio(part, whole) {
 return whole === 0 ? '-' : `${((part / whole) * 100).toFixed(1)}%`;
}

function cell(value) {
 return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** job summary の Markdown。 */
export function renderSummary(report) {
 const { comparable, after, slowest, slowNew, warnings, thresholds } = report;
 const before = report.before ?? {};
 const delta = report.delta ?? {};
 const shown = (value) => (comparable ? value : '-');
 const rows = [
  ['テスト数（`test(`・`it(` の呼出し）', shown(before.tests), after.tests, shown(signed(delta.tests))],
  ['テストの行数', shown(before.lines), after.lines, shown(signed(delta.lines))],
  ['テストのファイル数', shown(before.files), after.files, shown(signed(delta.files))],
  ['実プロセスを起動するテスト', shown(`${before.processTests}（${ratio(before.processTests, before.tests)}）`), `${after.processTests}（${ratio(after.processTests, after.tests)}）`, shown(signed(delta.processTests))],
  ['うち実 Git を起動するテスト', shown(`${before.gitTests}（${ratio(before.gitTests, before.tests)}）`), `${after.gitTests}（${ratio(after.gitTests, after.tests)}）`, shown(signed(delta.gitTests))],
 ];
 const lines = [
  '## テストの増え方（#1732）',
  '',
  !comparable ? 'base の test/ を読めなかったため、増減と新しいテストは判定していません。この報告は check を失敗にしません。' : warnings.length === 0 ? '閾値を超えた項目はありません。' : `閾値を超えた項目が ${warnings.length} 件あります。PR 本文に、なぜ足すか、既存のテストで足りない理由を書いてください。この報告は check を失敗にしません。`,
  '',
  '| 項目 | base | head | 増減 |',
  '|---|---:|---:|---:|',
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  '',
  `閾値: テストの行数 +${thresholds.netLines} 行、テスト数 +${thresholds.netTests} 件、新しいテスト1件 ${thresholds.newTestSeconds} 秒。実プロセス・実 Git の判定はファイル単位の概算（\`test/\` の中でたどれる \`child_process\` の import と、値が \`git\` の文字列。\`src/\` を経由した起動は数えないので少なめに出る）。`,
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
  if (head === null) throw new Error(`head の test/ を読めません: ${options.head}`);
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
