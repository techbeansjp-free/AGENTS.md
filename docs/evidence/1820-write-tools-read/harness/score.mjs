// #1820: adapted from docs/evidence/1817-skill-application/harness/score.mjs. Kept: projectRelative (incl. the redacted
// "<trial>/work" form), the path patterns, the failure rules, selectCounted (mandatory one-time replacements), scoreDir.
// Changed: stage 1 observes only the first two assistant messages (--max-turns 2), so a trial is scored per message
// (messages grouped by message.id): bodyRead2 (primary), bodyRead1, skillAsc1, entryRead1, readmeRead1, reach2, the first
// tool calls, and overapplication for the negative cases (cases.json scoring). A trial whose init event shows other tools
// or another permission mode than its cell's tools level is a failure (the condition was not received). The summary is per
// cell; mainEffects gives the analysis of analysis-plan.md (no adoption decision in stage 1). No model call.
// Usage: node score.mjs <traces-dir> [--runs-json <out.json>]   (descriptive only; the analysis is analyze.mjs)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ev, f), 'utf8'));
export const ASC_SKILLS = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
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
  const texts = messages.flatMap((m) => m.texts);
  return {init, cwd: init?.cwd ?? null, result, messages, results,
    uses: messages.flatMap((m) => m.uses),
    reads: messages.flatMap((m) => m.uses).filter((u) => u.name === 'Read' && results.has(u.id) && !results.get(u.id).is_error).map((u) => String(u.input?.file_path ?? '')),
    skills: messages.flatMap((m) => m.uses).filter((u) => u.name === 'Skill').map((u) => String(u.input?.skill ?? '')),
    text: typeof result?.result === 'string' && result.result ? result.result : texts.join('\n')};
}

export function markersOk(k, text) {
  const low = text.toLowerCase();
  return (k.answerAll ?? []).every((a) => low.includes(a.toLowerCase())) &&
    ((k.answerAny ?? []).length === 0 || k.answerAny.some((a) => new RegExp(a, 'i').test(text)));
}

// What one assistant message did, relative to the project root.
export function messageFacts(spec, m, t) {
  const pat = (key, s = '') => new RegExp(spec[key].replace('<skill>', esc(s)));
  const issued = (u) => !t.results.has(u.id) || !t.results.get(u.id).is_error; // a missing result (stopped) counts as issued
  const reads = m.uses.filter((u) => u.name === 'Read' && issued(u)).map((u) => projectRelative(String(u.input?.file_path ?? ''), t.cwd)).filter(Boolean);
  const skills = m.uses.filter((u) => u.name === 'Skill').map((u) => String(u.input?.skill ?? ''));
  const ascBodies = ASC_SKILLS.filter((s) => reads.some((r) => pat('bodyPattern', s).test(r)));
  const ascEntries = ASC_SKILLS.filter((s) => reads.some((r) => pat('entryPattern', s).test(r)));
  const target = (u) => {
    const i = u.input ?? {};
    if (u.name === 'Skill') return String(i.skill ?? '');
    const p = i.file_path ?? i.path ?? null;
    if (p) return projectRelative(String(p), t.cwd) ?? '<outside>';
    if (i.pattern) return String(i.pattern);
    if (i.command) return String(i.command).split(/\s+/)[0];
    return '';
  };
  return {bodyRead: ascBodies.includes('asc'), skillAsc: skills.some((s) => same(s, 'asc')), entryRead: ascEntries.includes('asc'),
    readmeRead: reads.some((r) => pat('readmePattern').test(r)), ascTouched: ascBodies.length > 0 || ascEntries.length > 0 || skills.some((c) => ASC_SKILLS.some((s) => same(c, s))),
    resultMissing: m.uses.some((u) => !t.results.has(u.id)), tools: m.uses.map((u) => ({name: u.name, target: target(u)}))};
}

// The init event against the cell's tools level (conditions.json toolLevels): same tools, same permission mode.
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

export function scoreRun(spec, k, t, {level = null} = {}) {
  const m1 = t.messages[0] ? messageFacts(spec, t.messages[0], t) : null;
  const m2 = t.messages[1] ? messageFacts(spec, t.messages[1], t) : null;
  const row = {case: k.id, kind: k.kind, expect: k.expect, messages: t.messages.length, model: t.init?.model ?? null,
    initTools: t.init?.tools ?? null, permissionMode: t.init?.permissionMode ?? null,
    costUsd: t.result?.total_cost_usd ?? null, turns: t.result?.num_turns ?? null, durationMs: t.result?.duration_ms ?? null,
    firstTools: m1?.tools ?? [], secondTools: m2?.tools ?? []};
  if (!t.init) return {...row, failure: 'no init event'};
  if (!t.result) return {...row, failure: 'no result event'};
  if (level) {
    const ip = initProblems(t.init, level);
    if (ip.length) return {...row, failure: `condition not received: ${ip.join('; ')}`};
  }
  const sub = String(t.result.subtype ?? '');
  row.stopped = /max_budget|max_turns/.test(sub) ? sub : null;
  if (t.result.is_error && !row.stopped) return {...row, failure: `result error: ${String(t.result.result ?? sub).slice(0, 120)}`};
  if (!m1) return {...row, failure: 'no assistant message'};
  const either = (f) => Boolean(m1?.[f] || m2?.[f]);
  Object.assign(row, {bodyRead1: m1.bodyRead, bodyRead2: either('bodyRead'), skillAsc1: m1.skillAsc, entryRead1: m1.entryRead, readmeRead1: m1.readmeRead,
    skillAsc2: either('skillAsc'), readmeRead2: either('readmeRead'), reach2: either('bodyRead') || either('skillAsc') || either('entryRead'),
    resultMissing: Boolean(m1.resultMissing || m2?.resultMissing)});
  if (!k.expect) { row.overapplication = either('ascTouched'); row.markers = markersOk(k, t.text); }
  return row;
}

export const plannedRepsOf = (k, conds) => (k.kind === 'negative' ? conds.negativeRuns : conds.runs);

// #1817 rule, per case: only reps 1..planned count; the k-th failed planned trial of a cell and case is replaced by rep
// planned+k only; a failed replacement stays a failure; a missing replacement is flagged replacementMissing.
export function selectCounted(runs, plannedOf) {
  const groups = new Map();
  for (const r of runs) { const key = `${r.condition}|${r.case}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  for (const rs of groups.values()) {
    const planned = plannedOf(rs[0].case);
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

export function scoreDir(spec, dir, conds = readJson('conditions.json')) {
  const runs = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const m = /^([A-Z]+)-(.+)-(\d+)\.jsonl(\.missing)?$/.exec(file);
    if (!m || !conds.cells[m[1]]) continue;
    const [, condition, id, n, missing] = m;
    const k = spec.cases.find((c) => c.id === id);
    if (!k) continue;
    const cell = conds.cells[condition];
    const base = {condition, run: Number(n), tools: cell.tools, prompt: k.kind === 'negative' ? null : cell.prompt, fixture: cell.fixture};
    if (missing) { runs.push({...base, case: id, kind: k.kind, expect: k.expect, failure: 'missing trace'}); continue; }
    let t;
    try { t = parseTrace(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { runs.push({...base, case: id, kind: k.kind, expect: k.expect, failure: `unreadable trace: ${e.message}`}); continue; }
    runs.push({...base, ...scoreRun(spec, k, t, {level: conds.toolLevels[cell.tools]})});
  }
  return selectCounted(runs, (caseId) => plannedRepsOf(spec.cases.find((c) => c.id === caseId), conds));
}

// Per cell, the applicable case (brief) and the negative cases separately.
export function summarizeCell(runs, cell) {
  const all = runs.filter((r) => r.condition === cell);
  const rs = all.filter((r) => r.counted !== false);
  const ok = rs.filter((r) => !r.failure), pos = ok.filter((r) => r.expect), neg = ok.filter((r) => !r.expect);
  const n = (xs, f) => xs.filter(f).length;
  return {cell, runs: rs.filter((r) => r.expect).length, failures: n(rs.filter((r) => r.expect), (r) => r.failure), valid: pos.length,
    bodyRead2: n(pos, (r) => r.bodyRead2), bodyRead1: n(pos, (r) => r.bodyRead1), skillAsc1: n(pos, (r) => r.skillAsc1), entryRead1: n(pos, (r) => r.entryRead1),
    readmeRead1: n(pos, (r) => r.readmeRead1), reach2: n(pos, (r) => r.reach2), stopped: n(pos, (r) => r.stopped),
    replacementsMissing: n(rs, (r) => r.replacementMissing),
    perRun: pos.sort((a, b) => a.run - b.run).map((r) => (r.bodyRead2 ? (r.bodyRead1 ? '1' : '2') : r.reach2 ? 'E' : '-')).join(''),
    negatives: {runs: rs.filter((r) => !r.expect).length, failures: n(rs.filter((r) => !r.expect), (r) => r.failure), valid: neg.length, overapplication: n(neg, (r) => r.overapplication)},
    costUsd: Number(all.reduce((a, r) => a + (r.costUsd ?? 0), 0).toFixed(4))};
}

// analysis-plan.md: the rate of a cell is bodyRead2/valid; the rate of a factor level is the unweighted mean of the cell
// rates with that level; a main effect is the difference of level rates (tools: W - R, X - R, X - W; prompt: G - S;
// fixture: D - A). Pooled counts per level are reported beside it. Interactions are shown as two-way tables of means only.
export function mainEffects(cellSums, conds = readJson('conditions.json')) {
  const rate = (s) => (s.valid ? s.bodyRead2 / s.valid : null);
  const cells = Object.entries(conds.cells).map(([id, c]) => ({id, ...c, s: cellSums[id]}));
  const missing = cells.filter((c) => !c.s || !c.s.valid).map((c) => c.id);
  if (missing.length) return {analysed: false, reason: `cells without a valid trial: ${missing.join(',')}`};
  const mean = (xs) => Number((xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(4));
  const level = (factor, v) => {
    const cs = cells.filter((c) => c[factor] === v);
    return {meanOfCellRates: mean(cs.map((c) => rate(c.s))), pooled: `${cs.reduce((a, c) => a + c.s.bodyRead2, 0)}/${cs.reduce((a, c) => a + c.s.valid, 0)}`, cells: cs.map((c) => c.id)};
  };
  const levels = {tools: Object.fromEntries(['R', 'W', 'X'].map((v) => [v, level('tools', v)])),
    prompt: Object.fromEntries(['S', 'G'].map((v) => [v, level('prompt', v)])), fixture: Object.fromEntries(['A', 'D'].map((v) => [v, level('fixture', v)]))};
  const d = (f, a, b) => Number((levels[f][a].meanOfCellRates - levels[f][b].meanOfCellRates).toFixed(4));
  const effects = {'tools W-R': d('tools', 'W', 'R'), 'tools X-R': d('tools', 'X', 'R'), 'tools X-W': d('tools', 'X', 'W'), 'prompt G-S': d('prompt', 'G', 'S'), 'fixture D-A': d('fixture', 'D', 'A')};
  const table = (f1, v1s, f2, v2s) => Object.fromEntries(v1s.map((a) => [a, Object.fromEntries(v2s.map((b) => [b, mean(cells.filter((c) => c[f1] === a && c[f2] === b).map((c) => rate(c.s)))]))]));
  return {analysed: true, metric: 'bodyRead2', levels, effects,
    twoWay: {'tools x prompt': table('tools', ['R', 'W', 'X'], 'prompt', ['S', 'G']), 'tools x fixture': table('tools', ['R', 'W', 'X'], 'fixture', ['A', 'D']), 'prompt x fixture': table('prompt', ['S', 'G'], 'fixture', ['A', 'D'])},
    note: 'Stage 1 is diagnostic: 4 trials per cell, no adoption decision; a difference of one or two trials per cell is within chance.'};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--runs-json');
  const out = i >= 0 ? args.splice(i, 2)[1] : null;
  const spec = readJson('cases.json');
  const runs = scoreDir(spec, path.resolve(args[0]));
  if (out) fs.writeFileSync(out, JSON.stringify(runs, null, 1));
  for (const cell of Object.keys(readJson('conditions.json').cells)) console.log(JSON.stringify(summarizeCell(runs, cell)));
}
