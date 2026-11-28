// Shared harness: scoring of the full trials (app fixtures, #1817), the truncated design trials (three messages, #1820
// stage 2) and the scenario trials (an app fixture variant whose answer states a procedure), and the decision rule.
// From docs/evidence/1820-write-tools-read/stage2/harness/score.mjs (kept: projectRelative, parseTrace, markersOk,
// initProblems, countedReads, entryHop / bodyRead / reach / referenceRead / applied / misselect / unselected /
// secondaryRead / overapplication, selectCounted = mandatory one-time replacements, summarize, perCase letters, the
// design facts). Parameterised:
// - a case may name its references per condition (referencesByCondition: e.g. B [] when the rule is in the body itself,
//   S ["merge-permission.md"] when it moved to a reference); applied = body, one of those references (none listed:
//   true) and the markers, as #1817. Every row records the ASC references it read (ascReferencesRead), whether the
//   markers matched without the listed reference (markersWithoutReference), the bytes of the ASC files it read
//   (ascBytesRead, from the trial's work/ copy via sizeOf) and its input tokens (input + cache read + cache write);
// - the rule is conditions.json rule (verdictOf): body share at least minBodyRate and against the baseline (gt or ge),
//   applied not lower, overapplication at most baseline + negSlack, optionally per-case applied not lower for the
//   scenario kinds and the efficiency means not higher on the common kinds;
// - scoring takes the raw trace texts (scoreTrials), so no published trace is needed (owner decision B of #1823).
// No model call.
import path from 'node:path';
import {loadConditions} from './apply-condition.mjs';

export const ASC_SKILLS = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
// #1840: the distributed Skill names of the releases measured (conditions.json ascSkills, e.g. 17 with warranty-scope);
// without it the 16 names above.
export const ascSkillsOf = (conds) => conds?.ascSkills ?? ASC_SKILLS;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (called, s) => called === s || called.endsWith(`:${s}`);

// Project-root-relative form of a tool path, or null when it is outside the root. macOS /private/tmp and /tmp are the same.
export function projectRelative(p, root) {
  if (!p || !root) return null;
  if (!path.posix.isAbsolute(root) && (p === root || p.startsWith(`${root}/`))) {
    const rel = path.posix.normalize(p.slice(root.length + 1) || '.');
    return rel === '.' || rel.startsWith('..') ? null : rel;
  }
  const strip = (x) => x.replace(/^\/private(?=\/(tmp|var)\/)/, '');
  const abs = strip(path.posix.normalize(path.posix.isAbsolute(p) ? p : path.posix.join(root, p)));
  const rel = path.posix.relative(strip(path.posix.normalize(root)), abs);
  return rel === '' || rel.startsWith('..') || path.posix.isAbsolute(rel) ? null : rel;
}

// Stream-json of `claude -p`: assistant events grouped into messages by message.id, in order of first appearance.
export function parseTrace(text) {
  const lines = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const results = new Map();
  for (const l of lines) if (l.type === 'user' && Array.isArray(l.message?.content)) for (const c of l.message.content) if (c.type === 'tool_result') results.set(c.tool_use_id, c);
  const messages = [];
  const byId = new Map();
  for (const l of lines.filter((x) => x.type === 'assistant')) {
    const id = l.message?.id ?? `anon-${messages.length}`;
    if (!byId.has(id)) { const m = {id, uses: [], texts: []}; byId.set(id, m); messages.push(m); }
    for (const c of l.message?.content ?? []) {
      if (c.type === 'tool_use') byId.get(id).uses.push(c);
      else if (c.type === 'text') byId.get(id).texts.push(c.text);
    }
  }
  const result = lines.findLast((l) => l.type === 'result') ?? null;
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init') ?? null;
  const uses = messages.flatMap((m) => m.uses);
  const texts = messages.flatMap((m) => m.texts);
  return {init, cwd: init?.cwd ?? null, result, messages, results, uses,
    reads: uses.filter((u) => u.name === 'Read' && results.has(u.id) && !results.get(u.id).is_error).map((u) => String(u.input?.file_path ?? '')),
    skills: uses.filter((u) => u.name === 'Skill').map((u) => String(u.input?.skill ?? '')),
    // #1845: the Skill calls whose result is present and not an error.
    okSkills: uses.filter((u) => u.name === 'Skill' && results.has(u.id) && !results.get(u.id).is_error).map((u) => String(u.input?.skill ?? '')),
    readAttempts: uses.filter((u) => u.name === 'Read').length,
    text: typeof result?.result === 'string' && result.result ? result.result : texts.join('\n')};
}

// #1840: a named check on a text: {pattern} or {all: [patterns]} must match, and {unless} (optional) must not.
export const groupOk = (g, text) => (g.all ?? [g.pattern]).every((p) => new RegExp(p, 'i').test(text)) && !(g.unless && new RegExp(g.unless, 'i').test(text));
const patternOf = (x) => (typeof x === 'string' ? x : x.pattern);
// #1840: answerQuota {min, groups: [{id, viewpoint, pattern | all, unless}]}: the groups that pass, by id.
export const markerGroupsOf = (k, text) => Object.fromEntries((k.answerQuota?.groups ?? []).map((g) => [g.id, groupOk(g, text)]));
// #1840: the deductions (answerNone: a pattern or {id, pattern}) found in a text, by id (or pattern).
export const markerDeductionsOf = (k, text) => (k.answerNone ?? []).filter((g) => new RegExp(patternOf(g), 'i').test(text)).map((g) => (typeof g === 'string' ? g : g.id));

export function markersOk(k, text) {
  const low = text.toLowerCase();
  return (k.answerAll ?? []).every((a) => low.includes(a.toLowerCase())) &&
    ((k.answerAny ?? []).length === 0 || k.answerAny.some((a) => new RegExp(a, 'i').test(text))) &&
    (k.answerGroups ?? []).every((g) => new RegExp(g, 'i').test(text)) &&
    // #1840: at least min of the named groups (calibrated against the earlier scoring, "k of n").
    // A group with report: true is shown in markerGroups but not counted (e.g. a viewpoint the Skill answers scored 0 on).
    (!k.answerQuota || k.answerQuota.groups.filter((g) => !g.report && groupOk(g, text)).length >= k.answerQuota.min) &&
    // #1840: a deduction of an earlier evaluation (e.g. a legal assertion) is a pattern that must not appear.
    markerDeductionsOf(k, text).length === 0;
}

// #1840 re-review High: the lines of the files that existed before the trial, trimmed (empty lines left out). The base of
// a trial (baseLinesFor; priorFiles() lists the fixture's HEAD, priorTexts(rels) reads it, null for a new file) is every file at the fixture's HEAD whose path matches cases.json markerBase.pathPattern (the
// installed templates) and the earlier text of every file the trial wrote. A written file's lines equal to a base line
// (compared line by line after trimming) are left out before the markers are matched, so a copied template scores nothing.
export const baseLinesOf = (texts) => new Set(texts.filter((x) => typeof x === 'string').flatMap((t) => t.split('\n').map((l) => l.trim()).filter(Boolean)));
export const withoutBaseLines = (text, base) => (base && base.size ? text.split('\n').filter((l) => !base.has(l.trim())).join('\n') : text);
export function baseLinesFor(spec, written, {priorTexts = null, priorFiles = null} = {}) {
  if (!spec.markerBase) return null;
  if (!priorTexts || !priorFiles) throw new Error('cases.json markerBase needs the files of the fixture before the trial (priorTexts, priorFiles)');
  const re = new RegExp(spec.markerBase.pathPattern);
  return baseLinesOf(priorTexts([...new Set([...priorFiles().filter((f) => re.test(f)), ...written])]));
}
// The text the answer markers are matched on: the answer, and with markerText "answer+writes" the written files' texts
// ({rel, text}) without the base lines. Returns {text, excludedLines}.
export function markerTextOf(spec, answer, written, base = null) {
  if (spec.markerText !== 'answer+writes') return {text: answer, excludedLines: 0};
  const texts = written.map((w) => w.text).filter((x) => typeof x === 'string');
  const kept = texts.map((x) => withoutBaseLines(x, base));
  const lines = (x) => x.split('\n').filter((l) => l.trim()).length;
  return {text: [answer, ...kept].join('\n'), excludedLines: texts.reduce((a, x, i) => a + lines(x) - lines(kept[i]), 0)};
}

// #1845: the code of a JavaScript/TypeScript text, with the comments and the string literals (and the literal parts of
// template literals; their ${...} expressions stay code) replaced by spaces, the line breaks kept. A regular expression
// literal stays code but is skipped as one token, so a quote inside it does not open a string. A small scanner, not a
// parser: `/` is a regular expression after an operator (not `++`/`--`), an opening bracket, a comma, a keyword or the
// start, else a division (also after `)`: `if (x) /re/` is misread, a known limit; `of` is an identifier, so
// `for (x of /re/g)` is misread too). JSX text is code (not left out).
// Used by a writes forbid entry with scope "code" (e.g. a decimal literal is a violation in `price * 1.1`, not in
// `// 1bp = 0.01%` or in `'10.9'`).
export const CODE_FILE = /\.(c|m)?(j|t)sx?$/i;
export function codeText(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let i = a; i < b; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' '; };
  const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
  let i = 0, prev = '';
  const braces = []; // per open brace: true when it opened a ${ of a template literal
  const template = (start) => { // from the char after a backtick (or the } closing a ${), to the next backtick or ${
    let j = start;
    while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
    blank(start, Math.min(j, src.length));
    if (src[j] === '$') { braces.push(true); prev = '{'; return j + 2; }
    prev = 'x'; return j + 1;
  };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      // #1845 CodeRabbit: a backslash before CRLF continues the line as one unit.
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] !== '\\' ? 1 : src[j + 1] === '\r' && src[j + 2] === '\n' ? 3 : 2;
      blank(i + 1, Math.min(j, src.length)); i = j + 1; prev = 'x'; continue;
    }
    if (c === '`') { i = template(i + 1); continue; }
    if (c === '{') { braces.push(false); prev = '{'; i++; continue; }
    if (c === '}') { if (braces.pop()) { i = template(i + 1); continue; } prev = '}'; i++; continue; }
    if (c === '/') {
      // #1845 review L1: after `++` or `--` (prev '++'/'--') a `/` is a division (`n++ / 2`).
      const regexStart = prev === '' || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || KEYWORDS.has(prev);
      if (regexStart) {
        let j = i + 1, cls = false;
        while (j < src.length && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
        j++;
        while (j < src.length && /[a-z]/i.test(src[j])) j++;
        i = j; prev = 'x'; continue;
      }
      prev = '/'; i++; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < src.length && /[\w$]/.test(src[j])) j++; prev = src.slice(i, j); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < src.length && /[\w.]/.test(src[j])) j++; prev = 'x'; i = j; continue; }
    if ((c === '+' || c === '-') && d === c) { prev = c + c; i += 2; continue; }
    prev = c; i++;
  }
  return out.join('');
}
// The text a forbid entry is matched on: scope "code" takes the code of a JavaScript/TypeScript file (codeText); other
// files and entries without scope see the whole text (as before #1845).
const forbidTextOf = (e, rel, text) => (e.scope === 'code' && CODE_FILE.test(String(rel ?? '')) ? codeText(text) : text);

// #1840: the checks of a writes definition on the texts of the files under its pathPattern. Each require/forbid entry
// {id, pattern, group?, viewpoint?}: the groups name what failed (e.g. facts, history, status) for the separate report.
// #1840 re-review High: with requireWithoutBase (and a base), the require patterns are matched on the texts without the
// base lines (a copied template line does not satisfy them); the forbid patterns always see the whole text.
// #1845: a forbid entry with scope "code" sees only the code of a JavaScript/TypeScript file (forbidTextOf); requireFiles
// [{id, pattern}] (optional) needs, for each entry, a written file whose path matches (e.g. both FN-003 and SCR-005),
// the missing ones in writeFilesMissing.
export function writeChecks(w, files, fileText, {base = null} = {}) {
  const texts = files.map((f) => (fileText ? fileText(f) : null));
  const all = texts.filter((x) => typeof x === 'string').map((x) => (w.requireWithoutBase ? withoutBaseLines(x, base) : x)).join('\n');
  const out = {written: files, writeMissingText: texts.some((x) => typeof x !== 'string'),
    writeRequireMissing: (w.require ?? []).filter((e) => !new RegExp(e.pattern, 'i').test(all)).map((e) => e.id),
    writeViolations: (w.forbid ?? []).filter((e) => texts.some((x, i) => typeof x === 'string' && new RegExp(e.pattern, 'i').test(forbidTextOf(e, files[i], x)))).map((e) => e.id)};
  if (w.requireFiles) out.writeFilesMissing = w.requireFiles.filter((e) => !files.some((f) => new RegExp(e.pattern).test(f))).map((e) => e.id);
  const entries = [...(w.require ?? []), ...(w.forbid ?? []), ...(w.requireFiles ?? [])];
  if (entries.some((e) => e.group)) {
    const failed = new Set([...out.writeRequireMissing, ...out.writeViolations, ...(out.writeFilesMissing ?? [])]);
    out.writeFailedGroups = [...new Set(entries.filter((e) => failed.has(e.id)).map((e) => e.group ?? 'other'))];
  }
  return out;
}

// #1840: the files a trial wrote (a Write, Edit or MultiEdit with a non-error result), project-relative, in order.
// #1844: with a level that has Bash, the trace object also carries changedFiles (collect.mjs: every file the trial changed
// or created by any tool, from meta.json workFiles); they are added after the tool writes.
export function writtenFiles(t) {
  const out = [];
  for (const u of t.uses) {
    if (!['Write', 'Edit', 'MultiEdit'].includes(u.name)) continue;
    const r = t.results.get(u.id);
    const rel = r && !r.is_error ? projectRelative(String(u.input?.file_path ?? ''), t.cwd) : null;
    if (rel && !out.includes(rel)) out.push(rel);
  }
  for (const f of t.changedFiles ?? []) if (!out.includes(f)) out.push(f);
  return out;
}

// #1844: the Bash commands of a trace whose result is present and not an error (a command that exited 0).
export const okCommands = (t) => t.uses.filter((u) => u.name === 'Bash' && t.results.has(u.id) && !t.results.get(u.id).is_error).map((u) => String(u.input?.command ?? ''));
const resultTextOf = (r) => (typeof r?.content === 'string' ? r.content : Array.isArray(r?.content) ? r.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '');
// #1844 review H1: a command entry {id, pattern, exclude?, resultPattern?} ran when a Bash call's command matches pattern
// and not exclude, its result is present and not an error, and (with resultPattern) the result text matches resultPattern.
// The exit status alone is not enough: a pipeline exits with its last command (`start … | head` exits 0 when start
// stopped in the main checkout), so cases.json asks for the schema of the start output in the result.
export function commandRan(e, t) {
  return t.uses.some((u) => {
    if (u.name !== 'Bash') return false;
    const c = String(u.input?.command ?? ''), r = t.results.get(u.id);
    return new RegExp(e.pattern).test(c) && !(e.exclude && new RegExp(e.exclude).test(c)) && Boolean(r) && !r.is_error && (!e.resultPattern || new RegExp(e.resultPattern).test(resultTextOf(r)));
  });
}

// #1844: the files a Bash command read, from its text (a small splitter, not a shell parser: quotes are removed, not
// interpreted; parts are split at ;, &&, ||, |, & and new lines; a here-document's body is text).
// - strict reads (bashReadPaths; rule-read): the file operands of READ_COMMANDS (the pattern of grep/rg and the script of
//   sed/awk/jq are not operands; -f FILE is), a < input, `git show <rev>:<path>`, `git blame <path>`, resolved against
//   the session cwd as it stands after the earlier Bash calls (Claude Code keeps a cd inside the project for the next
//   call; review M1) and a cd earlier in the same command (a cd in a ( … ) subshell is not kept). Unexpanded globs and
//   directories are not counted, so a strict read is never more than the command named.
// - possible reads (bashPossibleReads; the forbidden reads, review M1): every strict read and, for any Bash call with a
//   result (also a non-zero exit, its output may still have been shown), the operands of more reading commands (sort,
//   cut, diff, xxd, …), globs expanded against the project files, a directory searched recursively (grep -r, rg, ag,
//   ack, git grep, find … -exec, a list fed to xargs) as every file under it, and "unbounded" for output whose files the
//   text does not name (git show <rev>, git log -p, git diff <rev>, git cat-file -p <sha>). cases.json bashMention (a
//   pattern on the command text, e.g. project/rules) adds the calls that name a rule's place in another way (cd into it,
//   node -e, cp). What remains uncounted is listed in the README of the config.
export const READ_COMMANDS = new Set(['cat', 'head', 'tail', 'sed', 'awk', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'nl', 'bat', 'view', 'strings', 'jq']);
const MORE_READERS = new Set(['tac', 'rev', 'cut', 'sort', 'uniq', 'paste', 'column', 'fold', 'od', 'xxd', 'hexdump', 'base64', 'diff', 'cmp', 'comm', 'join', 'iconv', 'zcat', 'gzcat', 'bzcat', 'xzcat', 'fmt', 'pr', 'expand', 'unexpand', 'ag', 'ack']);
const SEARCHERS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const WRAPPERS = new Set(['env', 'command', 'time', 'nice', 'nohup', 'exec', 'builtin', 'sudo']);
const OPT_ARGS = {
  grep: ['-e', '-f', '-A', '-B', '-C', '-m', '-d', '-D', '--regexp', '--file', '--include', '--exclude', '--exclude-dir', '--max-count', '--context', '--after-context', '--before-context', '--label'],
  rg: ['-e', '-f', '-g', '-t', '-T', '-A', '-B', '-C', '-m', '-M', '-j', '-E', '-d', '--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--max-count', '--context', '--after-context', '--before-context', '--max-columns', '--threads', '--encoding', '--sort', '--sortr', '--max-depth'],
  ag: ['-G', '-A', '-B', '-C', '-m', '--ignore-dir', '--ignore', '--file-search-regex'], ack: ['-A', '-B', '-C', '-m', '--ignore-dir', '--type'],
  sed: ['-e', '-f', '--expression', '--file', '-l'], awk: ['-f', '-v', '-F'], jq: ['-f', '--from-file', '--indent'],
  head: ['-n', '-c'], tail: ['-n', '-c'], cut: ['-d', '-f', '-c', '-b'], sort: ['-k', '-t', '-o', '-S', '-T'], nl: ['-b', '-s', '-w', '-v', '-i', '-n'],
  xxd: ['-l', '-s', '-c', '-g'], od: ['-N', '-j', '-t', '-A'], hexdump: ['-n', '-s', '-e'], diff: ['-U', '-C', '--label', '-x', '-X'], uniq: ['-f', '-s'], fold: ['-w'], column: ['-s', '-c'],
};
const OPT_ARGS2 = {jq: ['--arg', '--argjson', '--slurpfile', '--rawfile']};
const FILE_OPTS = new Set(['-f', '--file', '--from-file']);
const isGlob = (w) => /[*?[]/.test(w);
const stripHeredocs = (s) => String(s).replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (m) => m.split('\n')[0].replace(/<<-?.*$/, ''));
const wordsOf = (part) => (part.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ''));
// The words of a part without redirections, and its < inputs.
function splitRedirects(words) {
  const args = [], inputs = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '<') { if (words[i + 1]) inputs.push(words[++i]); continue; }
    if (/^<[^<(]/.test(w)) { inputs.push(w.slice(1)); continue; }
    if (/^[0-9&]*>>?$/.test(w) || /^[0-9]*<<<?$/.test(w)) { i++; continue; }
    if (/^[0-9&]*(>>?|<<)/.test(w)) continue;
    args.push(w);
  }
  return {args, inputs};
}
const expandBraces = (w) => { const m = /^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/.exec(w); return m ? m[2].split(',').flatMap((x) => expandBraces(`${m[1]}${x}${m[3]}`)) : [w]; };
// A glob on a project-relative path as a regular expression (no globstar; * and ? do not match a leading dot).
export function globRegExp(rel, {prefix = false} = {}) {
  const seg = (s) => {
    let out = /^[*?[]/.test(s) ? '(?!\\.)' : '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '*') out += '[^/]*';
      else if (c === '?') out += '[^/]';
      else if (c === '[') { const j = s.indexOf(']', i + 2); if (j < 0) { out += '\\['; continue; } out += `[${s.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = j; }
      else out += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
    return out;
  };
  return new RegExp(`^${rel.split('/').map(seg).join('/')}${prefix ? '(/.*)?' : ''}$`);
}

// One Bash command: {reads, possible, unbounded, dir}; dir is the cwd after it (null: unknown), keep whether it lasts.
export function bashScan(command, root, start = root, files = []) {
  const reads = [], possible = [];
  let unbounded = false;
  let dir = start, kept = start;
  const relOf = (abs) => (projectRelative(`${abs}/__x__`, root) === '__x__' ? '' : projectRelative(abs, root));
  const push = (arr, r) => { if (r && !arr.includes(r)) arr.push(r); };
  const resolve = (d, w) => (path.posix.isAbsolute(w) ? path.posix.normalize(w) : d === null ? null : path.posix.resolve(d, w));
  // A strict read of a literal operand (also possible).
  const literal = (d, w, strict) => {
    const p = w.replace(/[)]+$/, '');
    if (!p) return;
    if (d === null && !path.posix.isAbsolute(p)) { for (const f of files) if (f === p.replace(/^\.\//, '') || f.endsWith(`/${p.replace(/^\.\//, '')}`)) push(possible, f); return; }
    const rel = relOf(resolve(d, p));
    if (rel === null || rel === '') return;
    if (strict) push(reads, rel);
    push(possible, rel);
  };
  // A possible read of an operand: a glob against the files; with deep, a directory as every file under it.
  const loose = (d, w, {deep = false, skipHidden = false} = {}) => {
    for (const x of expandBraces(w.replace(/[)]+$/, ''))) {
      if (!x) continue;
      const abs = resolve(d, x);
      if (abs === null) { if (!isGlob(x)) literal(null, x, false); else unbounded = true; continue; }
      const rel = relOf(abs);
      if (rel === null) continue;
      if (isGlob(rel)) { const re = globRegExp(rel, {prefix: deep}); for (const f of files) if (re.test(f)) push(possible, f); continue; }
      if (rel) push(possible, rel);
      if (deep) for (const f of files) if (rel === '' || f.startsWith(`${rel}/`)) { const below = rel ? f.slice(rel.length + 1) : f; if (!skipHidden || !below.split('/').some((s) => s.startsWith('.'))) push(possible, f); }
    }
  };
  const text = stripHeredocs(command);
  const parts = text.split(/&&|\|\||;|\|&?|\n|(?<![>&<0-9])&(?![>&])/);
  const all = parts.map((part) => ({part, ...splitRedirects(wordsOf(part))}));
  const head = (args) => { const a = [...args]; while (a.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0]) || WRAPPERS.has(path.posix.basename(a[0])) || a[0] === '!')) a.shift(); return a; };
  const cmdOf = (a) => path.posix.basename(String(a[0] ?? '').replace(/^[({]+/, ''));
  // xargs feeds a list into a reading command: every operand of the whole command is then a possible read.
  const xargsReader = all.some(({args}) => { const a = head(args); if (cmdOf(a) !== 'xargs') return false; const rest = a.slice(1); let i = 0; while (i < rest.length && rest[i].startsWith('-')) i += /^-[IdELnPs]$/.test(rest[i]) ? 2 : 1; const c = path.posix.basename(rest[i] ?? ''); return READ_COMMANDS.has(c) || MORE_READERS.has(c); });
  let outer;
  for (const {part, args: raw, inputs} of all) {
    // A ( … ) subshell: its cd ends with it.
    if (/^\s*\(/.test(part) && outer === undefined) outer = dir;
    scanPart(part, raw, inputs);
    if (/\)\s*$/.test(part) && outer !== undefined) { dir = outer; outer = undefined; }
  }
  function scanPart(part, raw, inputs) {
    for (const f of inputs) literal(dir, f, true);
    let a = head(raw);
    if (!a.length) return;
    let cmd = cmdOf(a);
    const sub = outer !== undefined;
    if (cmd === 'cd' || cmd === 'pushd') {
      const target = a[1];
      // cd alone or to ~ leaves the project (reset by the next call); cd - or a computed target: unknown.
      dir = !target || target.startsWith('~') ? '/' : target === '-' || /[$`*?]/.test(target) ? null : resolve(dir, target);
      if (!sub) kept = dir;
      return;
    }
    if (cmd === 'popd') { dir = null; if (!sub) kept = dir; return; }
    if (SHELLS.has(cmd) && a.includes('-c')) { const inner = a[a.indexOf('-c') + 1]; if (inner) { const s = bashScan(inner, root, dir, files); for (const r of s.reads) push(reads, r); for (const r of s.possible) push(possible, r); unbounded ||= s.unbounded; } return; }
    if (cmd === 'xargs') { const rest = a.slice(1); let i = 0; while (i < rest.length && rest[i].startsWith('-')) i += /^-[IdELnPs]$/.test(rest[i]) ? 2 : 1; a = rest.slice(i); cmd = cmdOf(a); if (!a.length) return; }
    if (xargsReader) for (const w of a.slice(1)) if (!w.startsWith('-')) loose(dir, w, {deep: true});
    if (cmd === 'git') {
      let i = 1;
      while (i < a.length && a[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(a[i]) ? 2 : 1;
      const subc = a[i], rest = a.slice(i + 1), ops = rest.filter((w) => !w.startsWith('-'));
      const wtRoot = () => { const r = dir === null ? null : relOf(dir); const m = r === null ? null : /^(\.worktrees\/[^/]+)(\/|$)/.exec(r); return m ? path.posix.join(root, m[1]) : root; };
      const noPatch = rest.some((w) => /^(--stat|--name-only|--name-status|-s|--no-patch|--shortstat|--numstat|--summary|--raw)$/.test(w));
      if (subc === 'show' || subc === 'cat-file') {
        for (const w of ops) { const m = /^[^:]*:(.+)$/.exec(w); if (m) literal(m[1].startsWith('./') || m[1].startsWith('../') ? dir : wtRoot(), m[1], true); else if (!noPatch && !/^(blob|tree|commit|tag)$/.test(w)) unbounded = true; }
        if (subc === 'show' && !ops.length && !noPatch) unbounded = true;
      } else if (subc === 'log' && rest.some((w) => /^(-p|-u|--patch|--full-diff|-L.*)$/.test(w)) && !noPatch) unbounded = true;
      else if (subc === 'diff' && !noPatch && ops.some((w) => /\.\.|^(HEAD|@)[~^]|^[0-9a-f]{7,40}$|^(origin\/|main$|master$)/.test(w))) unbounded = true;
      else if (subc === 'blame') { for (const w of ops) literal(dir, w, true); }
      else if (subc === 'grep') { const hasE = rest.some((w) => FILE_OPTS.has(w) || w === '-e'); const paths = ops.slice(hasE ? 0 : 1).filter((w) => w !== '--'); if (paths.some((w) => /^(HEAD|@)|^[0-9a-f]{7,40}$/.test(w))) unbounded = true; for (const w of paths.length ? paths : ['.']) loose(dir, w, {deep: true}); }
      return;
    }
    if (cmd === 'find') {
      const reader = a.some((w, k) => /^-(exec|execdir|ok|okdir)$/.test(w) && (READ_COMMANDS.has(path.posix.basename(a[k + 1] ?? '')) || MORE_READERS.has(path.posix.basename(a[k + 1] ?? ''))));
      if (reader || xargsReader) { const st = []; for (const w of a.slice(1)) { if (/^-[HLP]$/.test(w)) continue; if (/^[-(!]/.test(w)) break; st.push(w); } for (const w of st.length ? st : ['.']) loose(dir, w, {deep: true}); }
      return;
    }
    const strict = READ_COMMANDS.has(cmd), reader = strict || MORE_READERS.has(cmd);
    if (!reader) return;
    const opts = OPT_ARGS[SEARCHERS.has(cmd) && cmd !== 'rg' && cmd !== 'ag' && cmd !== 'ack' ? 'grep' : cmd] ?? [], opts2 = OPT_ARGS2[cmd] ?? [];
    const flagsSeen = [], ops = [];
    let explicitPattern = false;
    for (let i = 1; i < a.length; i++) {
      const w = a[i];
      if (w === '--') { ops.push(...a.slice(i + 1)); break; }
      if (opts2.includes(w)) { if (w === '--slurpfile' || w === '--rawfile') literal(dir, a[i + 2] ?? '', true); i += 2; continue; }
      if (w === '-d' && a[i + 1] === 'recurse' && SEARCHERS.has(cmd)) { flagsSeen.push('-drecurse'); i++; continue; }
      if (opts.includes(w)) { if (FILE_OPTS.has(w) && (SEARCHERS.has(cmd) || ['sed', 'awk', 'jq'].includes(cmd))) { literal(dir, a[i + 1] ?? '', true); explicitPattern = true; } if (w === '-e' || w === '--regexp' || w === '--expression') explicitPattern = true; i++; continue; }
      if (/^--(regexp|file|expression)=/.test(w)) { explicitPattern = true; if (/^--file=/.test(w)) literal(dir, w.slice(7), true); continue; }
      if (w.startsWith('-') && w !== '-') { flagsSeen.push(w); continue; }
      ops.push(w);
    }
    // The pattern of a search, the script of sed/awk and the filter of jq are not files.
    if ((SEARCHERS.has(cmd) || ['sed', 'awk', 'jq'].includes(cmd)) && !explicitPattern && !(cmd === 'rg' && flagsSeen.includes('--files'))) ops.shift();
    const recursive = ['rg', 'ag', 'ack'].includes(cmd) || (SEARCHERS.has(cmd) && flagsSeen.some((w) => /^-[A-Za-z]*[rR]/.test(w) || /^--(dereference-)?recursive$/.test(w) || w === '-drecurse')) || (cmd === 'diff' && flagsSeen.some((w) => /^-[A-Za-z]*r/.test(w)));
    const skipHidden = (cmd === 'rg' || cmd === 'ag') && !flagsSeen.some((w) => /^(--hidden|-\.|--unrestricted|-u+)$/.test(w) || /^-[A-Za-z]*u/.test(w));
    for (const w of ops) {
      if (/^\d+$/.test(w)) continue;
      if (isGlob(w) || /\{[^}]*,/.test(w)) loose(dir, w, {deep: recursive, skipHidden});
      else { literal(dir, w, strict); if (recursive) loose(dir, w, {deep: true, skipHidden}); }
    }
    if (recursive && !ops.length) loose(dir, '.', {deep: true, skipHidden});
  }
  return {reads, possible, unbounded, dir: kept};
}
export const bashReadsOf = (command, root, start = root) => bashScan(command, root, start).reads;

// #1844 review M1: the Bash calls of a trace in order, with the cwd carried from one call to the next (a cd that ends
// outside the project is not kept, as Claude Code resets it). files: the project-relative files the globs and directories
// are expanded against (score.mjs projectFilesOf).
export function bashTraceReads(t, files = []) {
  const reads = [], possible = [], commands = [];
  let unbounded = 0, dir = t.cwd;
  for (const u of t.uses) {
    if (u.name !== 'Bash' || !t.results.has(u.id)) continue;
    const c = String(u.input?.command ?? '');
    const s = bashScan(c, t.cwd, dir, files);
    if (!t.results.get(u.id).is_error) for (const r of s.reads) if (!reads.includes(r)) reads.push(r);
    for (const r of s.possible) if (!possible.includes(r)) possible.push(r);
    if (s.unbounded) unbounded += 1;
    commands.push(c);
    dir = s.dir === null ? null : projectRelative(`${s.dir}/__x__`, t.cwd) === null ? t.cwd : s.dir;
  }
  return {reads, possible, unbounded, commands};
}
export const bashReadPaths = (t) => bashTraceReads(t).reads;
// The project files for the expansion: the fixture at its HEAD (priorFiles), the files the trial changed, and the same
// files under each worktree of .worktrees/ (the names given, from the changed files, or "~" when none is known).
export function projectFilesOf({priorFiles = null, changedFiles = null, worktrees = null} = {}) {
  const base = [...new Set([...(priorFiles ? priorFiles() : []), ...(changedFiles ?? [])])];
  const names = new Set(worktrees ?? []);
  for (const f of changedFiles ?? []) { const m = /^\.worktrees\/([^/]+)\//.exec(f); if (m) names.add(m[1]); }
  if (!names.size) names.add('~');
  const plain = base.filter((f) => !f.startsWith('.worktrees/'));
  return [...new Set([...base, ...[...names].flatMap((n) => plain.map((f) => `.worktrees/${n}/${f}`))])];
}

// #1840: the case-level checks beyond the Skill body (all optional; a case without them gets none of these fields):
// - expectReads [{id, pattern}]: each pattern (a regular expression on the project-relative path) matched by a counted Read;
// - forbidReads [{id, pattern}]: no counted Read matches (a rule that does not apply, a template that is not needed);
// - forbidSkills [name]: no Skill call, Claude Code entry or body Read of these Skills (ASC or the user's own);
// - writes {pathPattern, mustWrite, require: [re], forbid: [{id, pattern}]}: the files written under pathPattern, read
//   from the trial's work/ copy at the end (fileText), hold every require pattern (over all of them) and no forbid pattern
//   (the diff must not break a rule); mustWrite needs at least one such file.
// #1844 review M1: with a level that has Bash, bash {possible, unbounded, commands} (bashTraceReads): a forbidden read is
// also a possible Bash read, any read when a call's output is unbounded, or a call whose text matches the entry's
// bashMention; forbiddenReadsStrict keeps the strict count beside it. Without it (level W) as before.
export function caseChecks(k, rel, t, {fileText = null, skills = ASC_SKILLS, base = null, bash = null} = {}) {
  const out = {};
  const hit = (p) => rel.some((r) => new RegExp(p).test(r));
  const loose = bash ? [...new Set([...rel, ...bash.possible])] : rel;
  const looseHit = (e) => (bash ? bash.unbounded > 0 || loose.some((r) => new RegExp(e.pattern).test(r)) || Boolean(e.bashMention && bash.commands.some((c) => new RegExp(e.bashMention).test(c))) : hit(e.pattern));
  if (k.expectReads) { out.expectReads = Object.fromEntries(k.expectReads.map((e) => [e.id, hit(e.pattern)])); out.expectReadsAll = Object.values(out.expectReads).every(Boolean); }
  if (k.forbidReads) {
    out.forbiddenReads = k.forbidReads.filter(looseHit).map((e) => e.id); out.forbidReadsOk = out.forbiddenReads.length === 0;
    if (bash) out.forbiddenReadsStrict = k.forbidReads.filter((e) => hit(e.pattern)).map((e) => e.id);
  }
  // #1844: expectCommands [{id, pattern, exclude?, resultPattern?}]: each entry ran (commandRan; review H1).
  if (k.expectCommands) { out.expectCommands = Object.fromEntries(k.expectCommands.map((e) => [e.id, commandRan(e, t)])); out.commandsAll = Object.values(out.expectCommands).every(Boolean); }
  if (k.forbidSkills) {
    out.forbiddenSkills = k.forbidSkills.filter((s) => t.skills.some((c) => same(c, s)) || (bash?.unbounded > 0) || loose.some((r) => r === `.claude/skills/${s}/SKILL.md` || (skills.includes(s) && new RegExp(`^\\.agent-skill-chain/(managed-runtime/)?skills/${esc(s)}/SKILL\\.md$`).test(r))));
    out.forbidSkillsOk = out.forbiddenSkills.length === 0;
  }
  if (k.writes) {
    const w = k.writes;
    const files = writtenFiles(t).filter((f) => new RegExp(w.pathPattern).test(f));
    Object.assign(out, writeChecks(w, files, fileText, {base}));
    // #1844 review L2: a file under pathPattern changed only in a commit HEAD no longer reaches (a removed worktree, another
    // branch, a stash; meta.json unreachedFiles) cannot be checked: it is written, listed and not checkable (writeMissingText).
    const lost = (t.unreachedFiles ?? []).filter((f) => new RegExp(w.pathPattern).test(f) && !files.includes(f));
    if (lost.length) { out.writeUnreached = lost; out.written = [...out.written, ...lost]; out.writeMissingText = true; }
    out.writeOk = (!w.mustWrite || out.written.length > 0) && !out.writeMissingText && out.writeRequireMissing.length === 0 && out.writeViolations.length === 0 && (out.writeFilesMissing ?? []).length === 0;
    // #1840 review L3: a trial that wrote no file under pathPattern; its answer text against the require patterns (reported).
    if (!files.length && (w.require ?? []).length) out.writeRequireInAnswer = w.require.filter((e) => new RegExp(e.pattern, 'i').test(t.text)).map((e) => e.id);
  }
  // A case without these fields gets no field at all (so the rows of earlier configs are byte-identical).
  if (Object.keys(out).length) out.caseChecksOk = [out.expectReadsAll, out.forbidReadsOk, out.forbidSkillsOk, out.writeOk, out.commandsAll].every((x) => x !== false);
  // #1840 review H1: writesReport {pathPattern, require, forbid} is reported only (e.g. history in the change log), never in
  // caseChecksOk or a level.
  if (k.writesReport) {
    const r = writeChecks(k.writesReport, writtenFiles(t).filter((f) => new RegExp(k.writesReport.pathPattern).test(f)), fileText);
    out.writesReport = {written: r.written, requireMissing: r.writeRequireMissing, violations: r.writeViolations};
  }
  return out;
}

// #1840 review H3: per-trial facts reported, never used for a level (cases.json report: {reads: [{id, pattern}], answer:
// [{id, pattern}], writtenFiles: true}): which of those files were read, what the answer mentions, every file written.
export function reportOf(report, rel, t) {
  const out = {};
  if (report.reads) out.reads = Object.fromEntries(report.reads.map((e) => [e.id, rel.some((r) => new RegExp(e.pattern).test(r))]));
  if (report.answer) out.answer = Object.fromEntries(report.answer.map((e) => [e.id, new RegExp(e.pattern, 'i').test(t.text)]));
  if (report.writtenFiles) out.writtenFiles = writtenFiles(t);
  // #1844: per entry, whether a Bash command matched it (attempted), exited 0 (exitOk) and ran (ok: commandRan, review H1).
  if (report.commands) { const all = t.uses.filter((u) => u.name === 'Bash').map((u) => String(u.input?.command ?? '')), ok = okCommands(t); out.commands = Object.fromEntries(report.commands.map((e) => [e.id, {attempted: all.some((c) => new RegExp(e.pattern).test(c)), exitOk: ok.some((c) => new RegExp(e.pattern).test(c)), ok: commandRan(e, t)}])); }
  return out;
}

// The init event against level W (stage 1 rule): same tools (ToolSearch tolerated), same permission mode, no MCP server.
export function initProblems(init, level) {
  if (!init) return ['no init event'];
  const p = [];
  const want = level.tools.split(',').sort();
  const have = [...(init.tools ?? [])].filter((x) => x !== 'ToolSearch').sort();
  if (JSON.stringify(have) !== JSON.stringify(want)) p.push(`tools ${have.join(',')} != ${want.join(',')}`);
  if ((init.permissionMode ?? null) !== level.initPermissionMode) p.push(`permission mode ${init.permissionMode} != ${level.initPermissionMode}`);
  if ((init.mcp_servers ?? []).length) p.push('MCP servers present');
  return p;
}

export const isDesign = (k) => k.kind === 'design';

// The Reads that count: fixture A (#1817) a non-error result; a design case (stopped after its last message) also a Read
// whose result is absent (issued, stage 1). Returns project-relative paths with the 1-based message of each.
export function countedReads(k, t) {
  const out = [];
  t.messages.forEach((m, i) => {
    for (const u of m.uses) {
      if (u.name !== 'Read') continue;
      const r = t.results.get(u.id);
      const counts = r ? !r.is_error : isDesign(k);
      const rel = counts ? projectRelative(String(u.input?.file_path ?? ''), t.cwd) : null;
      if (rel) out.push({path: rel, message: i + 1, resultMissing: !r});
    }
  });
  return out;
}

// The references of a case for a condition (referencesByCondition, else references).
export function referencesFor(k, condition) {
  if (!k.referencesByCondition) return k.references ?? [];
  const r = k.referencesByCondition[condition];
  if (!Array.isArray(r)) throw new Error(`case ${k.id} names no references for condition ${condition}`);
  return r;
}
export const inputTokensOf = (u) => (u ? (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : null);
// ASC files: .agent-skill-chain/ and the Claude Code entries of the ASC Skills (#1840: a user's own Skill under
// .claude/skills/ is not an ASC file).
const ascFile = (r, skills) => /^\.agent-skill-chain\//.test(r) || skills.some((s) => r.startsWith(`.claude/skills/${s}/`));

export function scoreRun(spec, k, t, {level = null, condition = null, sizeOf = null, fileText = null, priorTexts = null, priorFiles = null, skills = ASC_SKILLS, changedFiles = null, worktrees = null, unreachedFiles = null} = {}) {
  const pat = (key, s, r = '') => new RegExp(spec[key].replace('<skill>', esc(s)).replace('<ref>', esc(r)));
  if (changedFiles) t = {...t, changedFiles};
  if (unreachedFiles) t = {...t, unreachedFiles};
  const reads = countedReads(k, t);
  // #1844: with a level that has Bash (toolLevels.<id>.sandbox), a reading Bash command counts as a read too (strict), and
  // the possible reads are counted for the forbidden ones (review M1).
  const bash = level?.sandbox ? bashTraceReads(t, projectFilesOf({priorFiles, changedFiles, worktrees})) : null;
  const bashRel = bash ? bash.reads : null;
  const rel = [...new Set([...reads.map((r) => r.path), ...(bashRel ?? [])])];
  const ascBodies = skills.filter((s) => rel.some((r) => pat('bodyPattern', s).test(r)));
  const ascEntries = skills.filter((s) => rel.some((r) => pat('entryPattern', s).test(r)));
  const ascCalls = t.skills.filter((c) => skills.some((s) => same(c, s)));
  const row = {case: k.id, kind: k.kind, fixture: k.fixture ?? 'A', expect: k.expect, skills: t.skills, ascEntries, ascBodies, readAttempts: t.readAttempts, toolUses: t.uses.length,
    messages: t.messages.length, model: t.init?.model ?? null, initTools: t.init?.tools ?? null, permissionMode: t.init?.permissionMode ?? null,
    costUsd: t.result?.total_cost_usd ?? null, turns: t.result?.num_turns ?? null, durationMs: t.result?.duration_ms ?? null,
    usage: t.result?.usage ? {input: t.result.usage.input_tokens, output: t.result.usage.output_tokens, cacheRead: t.result.usage.cache_read_input_tokens, cacheWrite: t.result.usage.cache_creation_input_tokens} : null};
  row.inputTokens = inputTokensOf(row.usage);
  if (bashRel) {
    row.bashReadPaths = bashRel; row.bashCommands = t.uses.filter((u) => u.name === 'Bash').length;
    // The possible reads beyond the strict ones that a report or forbid pattern names, and the calls with unbounded output.
    const named = [...(spec.report?.reads ?? []), ...(k.forbidReads ?? [])].map((e) => new RegExp(e.pattern));
    row.bashPossibleReadPaths = bash.possible.filter((r) => !rel.includes(r) && named.some((re) => re.test(r)));
    row.bashUnboundedReads = bash.unbounded;
  }
  const ascFiles = [...new Set(rel.filter((r) => ascFile(r, skills)))].sort();
  row.ascFilesRead = ascFiles.length;
  row.ascBytesRead = sizeOf ? ascFiles.reduce((a, r) => a + (sizeOf(r) ?? 0), 0) : null;
  if (!t.init) return {...row, failure: 'no init event'};
  if (!t.result) return {...row, failure: 'no result event'};
  if (level) {
    const ip = initProblems(t.init, level);
    if (ip.length) return {...row, failure: `condition not received: ${ip.join('; ')}`};
  }
  const sub = String(t.result.subtype ?? '');
  row.stopped = /max_budget|max_turns/.test(sub) ? sub : null;
  if (t.result.is_error && !row.stopped) return {...row, failure: `result error: ${String(t.result.result ?? sub).slice(0, 120)}`};
  if (isDesign(k) && !t.messages.length) return {...row, failure: 'no assistant message'};
  row.markersApplicable = !isDesign(k);
  // #1840 review M1: with cases.json markerText "answer+writes" the markers are matched on the answer and the text of every
  // file the trial wrote (read from its work/ copy at the end). Re-review High: without the lines of the files that
  // existed before the trial (markerBase; markerBaseExcludedLines counts the written lines left out).
  const base = fileText ? baseLinesFor(spec, writtenFiles(t), {priorTexts, priorFiles}) : null;
  const mt = markerTextOf(spec, t.text, fileText ? writtenFiles(t).map((f) => ({rel: f, text: fileText(f)})) : [], base);
  const markerText = mt.text;
  if (base) row.markerBaseExcludedLines = mt.excludedLines;
  row.markers = isDesign(k) ? true : markersOk(k, markerText);
  if (k.answerQuota) row.markerGroups = markerGroupsOf(k, markerText);
  if ((k.answerNone ?? []).length) row.markerDeductions = markerDeductionsOf(k, markerText);
  row.resultMissing = reads.some((r) => r.resultMissing);
  const touched = ascCalls.length > 0 || ascEntries.length > 0 || ascBodies.length > 0;
  const extra = caseChecks(k, rel, t, {fileText, skills, base, bash});
  Object.assign(row, extra);
  if (spec.report) row.report = reportOf(spec.report, rel, t);
  // #1840 review M3: whether the session's Skill list (init) holds the user's own Skills the case names.
  const userNames = [...new Set([...(k.userSkill ? [k.expect] : []), ...(k.forbidSkills ?? [])])].filter((s) => s && !skills.includes(s));
  if (userNames.length) row.userSkillsListed = Object.fromEntries(userNames.map((n) => [n, (t.init?.skills ?? []).some((x) => same(String(x), n))]));
  if (k.expect) {
    const e = k.expect;
    // #1840: a user's own Skill (userSkill: true) has its whole body in .claude/skills/<name>/SKILL.md, which the Skill
    // tool loads; its Skill call or a Read of that file is the body.
    // #1845: only a Skill call whose result is not an error (okSkills; a trace object without it: skills) or a successful
    // Read (rel) counts as the body.
    const ownBody = k.userSkill === true && ((t.okSkills ?? t.skills).some((s) => same(s, e)) || rel.includes(`.claude/skills/${e}/SKILL.md`));
    row.entryHop = t.skills.some((s) => same(s, e)) || ascEntries.includes(e);
    row.bodyRead = k.userSkill === true ? ownBody : ascBodies.includes(e);
    row.reach = row.entryHop || row.bodyRead;
    const refs = referencesFor(k, condition);
    row.references = refs;
    row.ascReferencesRead = [...new Set(rel.map((p) => new RegExp(spec.referencePattern.replace('<skill>', esc(e)).replace('<ref>', '(.+)')).exec(p)?.at(-1)).filter(Boolean))].sort();
    row.referenceRead = refs.length === 0 || refs.some((r) => rel.some((p) => pat('referencePattern', e, r).test(p)));
    row.applied = row.bodyRead && row.referenceRead && row.markers && extra.caseChecksOk !== false;
    row.markersWithoutReference = row.markersApplicable && row.markers && refs.length > 0 && !row.referenceRead;
    row.misselect = !row.reach && (t.skills.length > 0 || ascEntries.length > 0 || ascBodies.length > 0);
    row.unselected = !row.reach && t.skills.length === 0 && ascEntries.length === 0 && ascBodies.length === 0;
    row.secondaryRead = Object.fromEntries((k.secondary ?? []).map((s) => [s, ascBodies.includes(s)]));
    if (isDesign(k)) {
      const first = reads.find((r) => pat('bodyPattern', e).test(r.path));
      row.bodyReadMessage = first ? first.message : null;
      const writeAt = t.messages.findIndex((m) => m.uses.some((u) => u.name === 'Write' || u.name === 'Edit'));
      row.writeBeforeBody = writeAt >= 0 && (!first || writeAt + 1 < first.message);
      row.skillAsc = t.skills.some((s) => same(s, 'asc'));
      row.firstTools = (t.messages[0]?.uses ?? []).map((u) => ({name: u.name, target: u.name === 'Skill' ? String(u.input?.skill ?? '') : (projectRelative(String(u.input?.file_path ?? u.input?.path ?? ''), t.cwd) ?? (u.input?.pattern ? String(u.input.pattern) : '<outside>'))}));
    }
  } else {
    row.overapplication = touched;
    // #1840: a negative case may also forbid a user's Skill or a rule file; negativeOk = none of it touched.
    if ('caseChecksOk' in extra) row.negativeOk = !touched && extra.caseChecksOk;
    row.otherSkillCalls = t.skills.filter((c) => !ascCalls.includes(c));
  }
  return row;
}

// #1817 review L-3 / L1: only rep numbers 1..planned are scored. The k-th failed planned trial of a condition and case (in
// rep order) is replaced by rep planned+k and by nothing else; a failed replacement counts as a failure and is not
// replaced again; a failed planned trial whose replacement is absent is kept as a failure and flagged replacementMissing.
export function selectCounted(runs, planned) {
  const groups = new Map();
  for (const r of runs) { const k = `${r.condition}|${r.case}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const rs of groups.values()) {
    const plan = rs.filter((r) => r.run <= planned).sort((a, b) => a.run - b.run);
    for (const r of rs) r.counted = r.run <= planned;
    plan.filter((r) => r.failure).forEach((failed, k) => {
      const sub = rs.find((r) => r.run === planned + k + 1);
      if (!sub) { failed.replacementMissing = true; return; }
      failed.counted = false; failed.replacedBy = sub.run; sub.counted = true; sub.replaces = failed.run;
    });
  }
  return runs;
}

// Scores the trials of a runs root from their raw records. entries: [{name, text (trace.jsonl) or null, failure (a
// collect-level failure such as 'missing trace' or 'not settled') or null, sizeOf (project-relative path -> bytes in
// the trial's work/ copy) or null}]. Names are <condition>-<case>-<rep>; other names are skipped.
export function scoreTrials(spec, entries, conds = loadConditions()) {
  const runs = [];
  for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const m = /^([A-Z]+)-(.+)-(\d+)$/.exec(e.name);
    if (!m || !conds.cells[m[1]]) continue;
    const [, condition, id, n] = m;
    const k = spec.cases.find((c) => c.id === id);
    if (!k) continue;
    const base = {condition, run: Number(n), case: id, kind: k.kind, fixture: k.fixture ?? 'A', expect: k.expect};
    if (e.failure || e.text === null || e.text === undefined) { runs.push({...base, failure: e.failure ?? 'missing trace'}); continue; }
    let t;
    try { t = parseTrace(e.text); } catch (err) { runs.push({...base, failure: `unreadable trace: ${err.message}`}); continue; }
    runs.push({condition, run: Number(n), ...scoreRun(spec, k, t, {level: conds.toolLevels[conds.cells[condition].tools], condition, sizeOf: e.sizeOf ?? null, fileText: e.fileText ?? null, priorTexts: e.priorTexts ?? null, priorFiles: e.priorFiles ?? null, skills: ascSkillsOf(conds), changedFiles: e.changedFiles ?? null, worktrees: e.worktrees ?? null, unreachedFiles: e.unreachedFiles ?? null})});
  }
  return selectCounted(runs, conds.runs);
}

// #1840: per check, the trials that have it and those that passed it ({n, ok}); negatives: negativeOk.
export function caseCounts(pos, neg) {
  const c = (xs, key, ok) => { const has = xs.filter((r) => key in r); return has.length ? {n: has.length, ok: has.filter(ok).length} : null; };
  const out = {expectReadsAll: c(pos, 'expectReadsAll', (r) => r.expectReadsAll), forbidReadsOk: c([...pos, ...neg], 'forbidReadsOk', (r) => r.forbidReadsOk), forbidSkillsOk: c([...pos, ...neg], 'forbidSkillsOk', (r) => r.forbidSkillsOk),
    writeOk: c(pos, 'writeOk', (r) => r.writeOk), negativeOk: c(neg, 'negativeOk', (r) => r.negativeOk)};
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

const mean = (xs) => (xs.length ? Number((xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(1)) : null);

// One condition; `only` limits the cases to a subset (a fixture, a kind or one case) for the separate reports.
export function summarize(spec, runs, condition, {only = null} = {}) {
  const ids = only ? spec.cases.filter(only).map((k) => k.id) : spec.cases.map((k) => k.id);
  const all = runs.filter((r) => r.condition === condition && ids.includes(r.case));
  const rs = all.filter((r) => r.counted !== false);
  const ok = rs.filter((r) => !r.failure), pos = ok.filter((r) => r.expect), neg = ok.filter((r) => !r.expect);
  const n = (xs, f) => xs.filter(f).length;
  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
  const nums = (f) => ok.map(f).filter((x) => typeof x === 'number');
  const refReads = {};
  for (const r of ok) for (const x of r.ascReferencesRead ?? []) refReads[x] = (refReads[x] ?? 0) + 1;
  return {condition, runs: rs.length, notCounted: all.length - rs.length, failures: n(rs, (r) => r.failure), stopped: n(ok, (r) => r.stopped),
    positives: pos.length, entryHop: n(pos, (r) => r.entryHop), reach: n(pos, (r) => r.reach), bodyRead: n(pos, (r) => r.bodyRead), referenceRead: n(pos, (r) => r.reach && r.referenceRead),
    applied: n(pos, (r) => r.applied), misselect: n(pos, (r) => r.misselect), unselected: n(pos, (r) => r.unselected),
    markersWithoutReference: n(pos, (r) => r.markersWithoutReference === true),
    negatives: neg.length, overapplication: n(neg, (r) => r.overapplication), negMarkers: n(neg, (r) => r.markers),
    designWriteBeforeBody: n(pos, (r) => r.writeBeforeBody === true),
    // #1840 (cases.json expectReads, forbidReads, forbidSkills, writes, answerNone): counts over the cases that have them.
    ...caseCounts(pos, neg),
    replacementsMissing: n(rs, (r) => r.replacementMissing), casesWithoutValidTrial: ids.filter((id) => !ok.some((r) => r.case === id)),
    perCase: Object.fromEntries(spec.cases.filter((k) => ids.includes(k.id)).map((k) => [k.id, ok.filter((r) => r.case === k.id).sort((a, b) => a.run - b.run).map((r) => (k.expect ? (r.applied ? 'A' : r.bodyRead ? 'B' : r.entryHop ? 'E' : r.misselect ? 'M' : 'U') : (r.overapplication ? 'O' : '-'))).join('')])),
    referenceReads: Object.fromEntries(Object.entries(refReads).sort()),
    perTrial: {ascBytesRead: mean(nums((r) => r.ascBytesRead)), inputTokens: mean(nums((r) => r.inputTokens)), outputTokens: mean(nums((r) => r.usage?.output)), durationMs: mean(nums((r) => r.durationMs)), costUsd: mean(nums((r) => r.costUsd))},
    costUsd: Number(sum(all, (r) => r.costUsd).toFixed(4)), turns: sum(ok, (r) => r.turns), durationSec: Math.round(sum(ok, (r) => r.durationMs) / 1000)};
}

// The quality checks of the rule (conditions.json rule): (a) body share >= minBodyRate and against the baseline
// (bodyVsBaseline gt: higher, ge: not lower); (b) applied share not lower; (c) overapplication count at most baseline +
// negSlack. Shares, not counts, so a condition with fewer valid trials is compared fairly.
export function ruleChecks(baseline, candidate, {minBodyRate = 0.8, negSlack = 1, bodyVsBaseline = 'gt'} = {}) {
  const rate = (s, k) => (s.positives ? s[k] / s.positives : null);
  const cmp = (a, b, op) => a !== null && b !== null && (op === 'gt' ? a > b : a >= b);
  const c = {
    bodyReadLevel: {value: `${candidate.bodyRead}/${candidate.positives} >= ${minBodyRate}`, pass: rate(candidate, 'bodyRead') !== null && rate(candidate, 'bodyRead') >= minBodyRate},
    [bodyVsBaseline === 'gt' ? 'bodyReadAboveBaseline' : 'bodyReadNotLower']: {value: `${candidate.bodyRead}/${candidate.positives} vs ${baseline.bodyRead}/${baseline.positives}`, pass: cmp(rate(candidate, 'bodyRead'), rate(baseline, 'bodyRead'), bodyVsBaseline)},
    appliedNotLower: {value: `${candidate.applied}/${candidate.positives} vs ${baseline.applied}/${baseline.positives}`, pass: cmp(rate(candidate, 'applied'), rate(baseline, 'applied'), 'ge')},
  };
  if (baseline.negatives !== undefined && candidate.negatives) c.overapplication = {value: `${candidate.overapplication}/${candidate.negatives} vs ${baseline.overapplication}/${baseline.negatives} + ${negSlack}`, pass: candidate.overapplication <= baseline.overapplication + negSlack};
  return c;
}

// Per case (the scenario kinds): applied share of the candidate not lower than the baseline's, each case on its own.
export function perCaseAppliedChecks(perCase) {
  return Object.fromEntries(Object.entries(perCase).map(([id, [b, c]]) => {
    const rb = b.positives ? b.applied / b.positives : null, rc = c.positives ? c.applied / c.positives : null;
    return [id, {value: `${c.applied}/${c.positives} vs ${b.applied}/${b.positives}`, pass: rb !== null && rc !== null && rc >= rb}];
  }));
}

// Efficiency on the common kinds: each per-trial mean of the candidate not higher than the baseline's.
export function efficiencyChecks(b, c, metrics) {
  return Object.fromEntries(metrics.map((m) => [m, {value: `${c.perTrial[m]} vs ${b.perTrial[m]}`, pass: typeof c.perTrial[m] === 'number' && typeof b.perTrial[m] === 'number' && c.perTrial[m] <= b.perTrial[m]}]));
}

// The decision. Not judged (rule of #1817): a run neither complete nor stopped at the cap, a condition without a valid
// positive or negative trial, a planned case without a valid trial, a missing mandatory replacement, failures above
// maxFailureRate of a condition's counted trials. The subsets are reported, not used, unless the rule names them
// (perCaseKinds, efficiency).
export function verdictOf(baseline, candidate, {completion = null, subsets = {}, perCase = null, efficiency = null, rule = {}} = {}) {
  const maxFailureRate = rule.maxFailureRate ?? 0.1;
  const reasons = [];
  if (!completion?.basis) reasons.push(`run neither complete nor stopped at the cap (${completion ? `${completion.missingPlanned} planned and ${completion.missingReplacements.length} required replacement(s) not reserved, spent ${completion.spentUsd} + ${completion.perTrialUsd} <= ${completion.stopLineUsd}` : 'no completion record'})`);
  for (const s of [baseline, candidate]) {
    if (s.runs === 0 || s.positives === 0) reasons.push(`${s.condition}: no valid positive trial`);
    else if (s.failures / s.runs > maxFailureRate) reasons.push(`${s.condition}: failures above ${maxFailureRate * 100}%`);
    if (!s.negatives) reasons.push(`${s.condition}: no valid negative trial`);
    if ((s.casesWithoutValidTrial ?? []).length) reasons.push(`${s.condition}: no valid trial for ${s.casesWithoutValidTrial.join(',')}`);
    if (s.replacementsMissing) reasons.push(`${s.condition}: ${s.replacementsMissing} failed trial(s) without the mandatory replacement`);
  }
  const opts = {minBodyRate: rule.minBodyRate ?? 0.8, negSlack: rule.negSlack ?? 1, bodyVsBaseline: rule.bodyVsBaseline ?? 'gt'};
  const separate = Object.fromEntries(Object.entries(subsets).map(([name, [b, c]]) => [name, {[b.condition]: pick(b), [c.condition]: pick(c), checks: ruleChecks(b, c, opts)}]));
  const perCaseChecks = perCase ? perCaseAppliedChecks(perCase) : null;
  const efficiencyResult = efficiency ? {kinds: efficiency.kinds, [efficiency.b.condition]: efficiency.b.perTrial, [efficiency.c.condition]: efficiency.c.perTrial, checks: efficiencyChecks(efficiency.b, efficiency.c, efficiency.metrics)} : null;
  if (reasons.length) return {verdict: 'not-judged', reason: reasons.join('; '), completion, separate, perCase: perCaseChecks, efficiency: efficiencyResult};
  const checks = ruleChecks(baseline, candidate, opts);
  const all = [...Object.values(checks), ...Object.values(perCaseChecks ?? {}), ...Object.values(efficiencyResult?.checks ?? {})];
  return {verdict: all.every((x) => x.pass) ? 'adoption-candidate' : 'not-a-candidate', basis: completion.basis, completion, checks, perCase: perCaseChecks, efficiency: efficiencyResult, separate,
    note: 'With 4 runs per case small differences are not significant; adoption is the owner\'s decision. The separate subsets are reported, not used for the verdict.'};
}
// The #1820 stage-2 rule under its old name (bodyVsBaseline gt, no per-case or efficiency checks).
export const judge1820s2 = (baseline, candidate, {maxFailureRate = 0.1, completion = null, subsets = {}} = {}) => verdictOf(baseline, candidate, {completion, subsets, rule: {maxFailureRate, bodyVsBaseline: 'gt'}});
const pick = (s) => ({positives: s.positives, bodyRead: s.bodyRead, applied: s.applied, perCase: s.perCase, perTrial: s.perTrial, referenceReads: s.referenceReads, ...(s.negatives ? {negatives: s.negatives, overapplication: s.overapplication} : {})});

// A case filter from a subset definition of conditions.json subsets: {fixtures: [...]} and/or {kinds: [...]}.
export const subsetFilter = (def) => (k) => (!def.fixtures || def.fixtures.includes(k.fixture ?? 'A')) && (!def.kinds || def.kinds.includes(k.kind));

// #1840: the rule of a measurement that does not compare a candidate with a baseline but checks fixed levels in each
// condition (conditions.json rule.mode "levels"). rule.levels: [{id, cases: [case ids], metric, min}]; the rate of a
// level is the share of the counted valid trials of those cases that pass the metric, and it passes when there is at
// least one such trial and the rate is at least min. Metrics: positives reach (the expected Skill selected: its call,
// entry or body), bodyRead, referenceRead, expectReadsAll, markers, writeOk, applied; any case forbidReadsOk,
// forbidSkillsOk; negatives negativeOk, notOverapplied. The not-judged reasons are those of verdictOf. Each condition
// gets meets-levels when every level passes, else below-levels; the decision stays with the owner.
export const LEVEL_METRICS = {
  reach: (r) => r.expect && r.reach, bodyRead: (r) => r.expect && r.bodyRead, referenceRead: (r) => r.expect && r.reach && r.referenceRead,
  expectReadsAll: (r) => r.expectReadsAll === true, markers: (r) => r.markers === true, writeOk: (r) => r.writeOk === true, applied: (r) => r.expect && r.applied,
  forbidReadsOk: (r) => r.forbidReadsOk === true, forbidSkillsOk: (r) => r.forbidSkillsOk === true,
  // #1844: every expectCommands pattern matched by a successful Bash command (the ASC CLI start).
  commandsAll: (r) => r.commandsAll === true,
  negativeOk: (r) => !r.expect && (r.negativeOk ?? !r.overapplication), notOverapplied: (r) => !r.expect && !r.overapplication,
  // #1840 review H3: among the trials that wrote a file under the case's pathPattern, no rule violation (the trials that
  // wrote nothing are left out of the rate and counted as notEligible).
  writeCleanWhenWritten: (r) => (r.written ?? []).length > 0 && !r.writeMissingText && (r.writeViolations ?? []).length === 0,
};
// #1845: a level min given as a fraction text "a/b" (e.g. "2/3") is compared in integers (ok * b >= a * n), so 4/6 meets
// "2/3"; a number min is compared as a rate (as before). Throws on another text.
export function levelMet(ok, n, min) {
  if (typeof min === 'number') return ok / n >= min;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(min));
  if (!m || Number(m[2]) === 0) throw new Error(`level min ${JSON.stringify(min)} is neither a number nor a fraction "a/b"`);
  return ok * Number(m[2]) >= Number(m[1]) * n;
}
// The trials a metric is rated on (all by default).
export const LEVEL_ELIGIBLE = {writeCleanWhenWritten: (r) => (r.written ?? []).length > 0};
export function levelChecks(runs, condition, levels) {
  return Object.fromEntries(levels.map((l) => {
    const f = LEVEL_METRICS[l.metric];
    if (!f) throw new Error(`unknown level metric ${l.metric}`);
    const all = runs.filter((r) => r.condition === condition && r.counted !== false && !r.failure && l.cases.includes(r.case));
    const rs = all.filter(LEVEL_ELIGIBLE[l.metric] ?? (() => true));
    const ok = rs.filter(f).length;
    return [l.id, {metric: l.metric, cases: l.cases, value: `${ok}/${rs.length} >= ${l.min}`, ok, n: rs.length, pass: rs.length > 0 && levelMet(ok, rs.length, l.min),
      ...(rs.length !== all.length ? {notEligible: all.length - rs.length} : {}), ...(l.use ? {use: l.use} : {}), ...(l.label ? {label: l.label} : {})}];
  }));
}
// #1840 review H3: a level with use "report" is computed and shown but does not enter the verdict of the condition.
export function levelsVerdict(sums, runs, {completion = null, rule = {}, subsets = {}} = {}) {
  const conds = Object.keys(sums);
  const pre = verdictOf(sums[conds[0]], sums[conds[1] ?? conds[0]], {completion, subsets, rule});
  const used = (rule.levels ?? []).filter((l) => l.use !== 'report'), reported = (rule.levels ?? []).filter((l) => l.use === 'report');
  const perCondition = Object.fromEntries(conds.map((c) => {
    const checks = levelChecks(runs, c, used);
    // #1844 review L3: with rule.minProvisional the mins are provisional (the owner decides the level), and the verdict says so.
    return [c, {verdict: Object.values(checks).every((x) => x.pass) ? 'meets-levels' : 'below-levels', ...(rule.minProvisional ? {minProvisional: true, verdictBasis: 'provisional mins (conditions.json rule.minProvisional); the owner decides the level'} : {}), checks, ...(reported.length ? {reported: levelChecks(runs, c, reported)} : {})}];
  }));
  if (pre.verdict === 'not-judged') return {verdict: 'not-judged', ...(rule.minProvisional ? {minProvisional: true} : {}), reason: pre.reason, completion, perCondition, separate: pre.separate};
  return {verdict: 'levels', ...(rule.minProvisional ? {minProvisional: true} : {}), basis: completion.basis, completion, perCondition, separate: pre.separate,
    note: 'Fixed levels per condition (release and candidate are reported side by side, not as a candidate test). Few runs per case; the decisions (merge of the candidate PRs, what to fix) are the owner\'s.'};
}
