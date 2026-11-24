// Usage: node score.mjs <outRoot|runs.json> [--json]
// Scores run records against cases.json and applies the decision rules fixed in README.md (「評価計画」).
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const cases = JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8'));
const src = process.argv[2];
let records;
if (src.endsWith('.json')) records = JSON.parse(fs.readFileSync(src, 'utf8'));
else records = fs.readdirSync(src).filter((d) => fs.existsSync(path.join(src, d, 'record.json'))).map((d) => JSON.parse(fs.readFileSync(path.join(src, d, 'record.json'), 'utf8')));
// A rerun after a Host failure is named "<rep>r"; it replaces the failed run in scoring (both stay in the raw data).
const byKey = new Map();
for (const r of records) { const k = `${r.caseId}-${r.cond}-${String(r.rep).replace(/r$/, '')}`; if (!byKey.has(k) || String(r.rep).endsWith('r')) byKey.set(k, r); }
const scored = [...byKey.values()];

const re = (s) => new RegExp(s, 'i');
const isAscBody = (p) => /(^|\/)\.agent-skill-chain\/(managed-runtime\/)?skills\/asc\/SKILL\.md$/.test(p ?? '');
const reads = (r) => r.trace.filter((t) => t.name === 'Read').map((t) => t.target ?? '');
const skillCalls = (r) => r.trace.filter((t) => t.name === 'Skill').map((t) => String(t.target ?? '').replace(/^\//, ''));
const ascSelected = (r) => skillCalls(r).includes('asc') || reads(r).some((p) => /(^|\/)\.claude\/skills\/asc\/SKILL\.md$/.test(p));
const ascBody = (r) => reads(r).some(isAscBody);
const refIndex = (r, ref) => {
  const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(ref)?.[1];
  return r.trace.findIndex((t) => (t.name === 'Read' && String(t.target ?? '').endsWith(ref)) || (skill && t.name === 'Skill' && String(t.target ?? '').replace(/^\//, '') === skill));
};

function check(c, r, rule) {
  const s = r.structured ?? {};
  const cmds = Array.isArray(s.commands) ? s.commands.map(String) : [];
  if ('field' in rule) {
    const v = s[rule.field];
    if (v === undefined) return false;
    if ('equals' in rule) return v === rule.equals;
    if ('match' in rule) return re(rule.match).test(String(v));
    if ('notMatch' in rule) return !re(rule.notMatch).test(String(v));
    if ('subsetOf' in rule) return Array.isArray(v) && v.length > 0 && v.every((x) => rule.subsetOf.includes(String(x).toLowerCase()));
  }
  if ('anyCommand' in rule) return cmds.some((x) => re(rule.anyCommand).test(x));
  if ('noCommand' in rule) return !cmds.some((x) => re(rule.noCommand).test(x));
  if ('commandAfter' in rule) {
    const i = cmds.findIndex((x) => re(rule.commandAfter.first).test(x));
    return i >= 0 && cmds.slice(i + 1).some((x) => re(rule.commandAfter.then).test(x));
  }
  if ('noAscLoad' in rule) return !ascSelected(r) && !ascBody(r);
  throw Error('unknown rule ' + JSON.stringify(rule));
}

const rows = scored.map((r) => {
  const c = cases.cases.find((x) => x.id === r.caseId);
  const ok = r.structured != null;
  const critical = c.critical.filter((x) => !ok || !check(c, r, x)).map((x) => x.id);
  const missing = c.required.filter((x) => !ok || !check(c, r, x)).map((x) => x.id);
  const u = r.usage ?? {};
  const inputSide = r.usage ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null;
  return {
    id: r.id, caseId: r.caseId, cond: r.cond, rep: r.rep, structured: ok, subtype: r.subtype, pass: ok && !critical.length && !missing.length, critical, missing,
    ascSelected: ascSelected(r), ascBody: ascBody(r), skills: skillCalls(r),
    refs: Object.fromEntries(c.refs.map((ref) => [ref, refIndex(r, ref)])),
    toolCalls: r.toolCallCount, costUsd: r.costUsd, wallMs: r.wallMs, inputSide,
    input: u.input_tokens ?? null, output: u.output_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, cacheWrite: u.cache_creation_input_tokens ?? null,
  };
});

const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const range = (xs) => { const v = xs.filter((x) => x != null); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
const agg = {};
for (const c of cases.cases) for (const cond of ['A', 'B', 'C']) {
  const rs = rows.filter((r) => r.caseId === c.id && r.cond === cond);
  agg[`${c.id}/${cond}`] = {
    n: rs.length, pass: rs.filter((r) => r.pass).length, critical: rs.reduce((a, r) => a + r.critical.length, 0), missing: rs.reduce((a, r) => a + r.missing.length, 0),
    ascSelected: rs.filter((r) => r.ascSelected).length, ascBody: rs.filter((r) => r.ascBody).length,
    refs: Object.fromEntries(c.refs.map((ref) => [ref, rs.filter((r) => r.refs[ref] >= 0).length])),
    refFirstIndexMedian: Object.fromEntries(c.refs.map((ref) => [ref, med(rs.map((r) => (r.refs[ref] >= 0 ? r.refs[ref] : null)))])),
    costMedian: med(rs.map((r) => r.costUsd)), costRange: range(rs.map((r) => r.costUsd)),
    inputSideMedian: med(rs.map((r) => r.inputSide)), inputSideRange: range(rs.map((r) => r.inputSide)),
    outputMedian: med(rs.map((r) => r.output)), cacheReadMedian: med(rs.map((r) => r.cacheRead)), cacheWriteMedian: med(rs.map((r) => r.cacheWrite)),
    toolCallsMedian: med(rs.map((r) => r.toolCalls)), wallMedianS: med(rs.map((r) => r.wallMs)) / 1000, wallRangeS: range(rs.map((r) => r.wallMs / 1000)),
  };
}

// Decision rules (fixed before the runs; see README「評価計画」).
const ids = cases.cases.map((c) => c.id);
const loaded = ['K1', 'K2', 'K3', 'K4'];
const g = (id, cond) => agg[`${id}/${cond}`];
const Q = ids.every((id) => g(id, 'C').pass >= g(id, 'B').pass) && ids.every((id) => g(id, 'C').critical === 0)
  && ids.reduce((a, id) => a + g(id, 'C').missing, 0) <= ids.reduce((a, id) => a + g(id, 'B').missing, 0);
const R = ids.every((id) => Object.keys(g(id, 'B').refs).every((ref) => g(id, 'C').refs[ref] >= g(id, 'B').refs[ref]));
const tokenWins = loaded.filter((id) => g(id, 'C').inputSideMedian < g(id, 'B').inputSideMedian).length;
const costSum = (cond) => loaded.reduce((a, id) => a + (g(id, cond).costMedian ?? Infinity), 0);
const toolsOk = loaded.every((id) => g(id, 'C').toolCallsMedian <= g(id, 'B').toolCallsMedian + 1);
const I = tokenWins >= 3 && costSum('C') <= costSum('B') && toolsOk;
const decision = !Q || !R ? '不採用' : I ? '限定改善候補' : '現状維持';
const effectAB = { passA: ids.reduce((a, id) => a + g(id, 'A').pass, 0), passB: ids.reduce((a, id) => a + g(id, 'B').pass, 0) };
const summary = { Q, R, I, tokenWins, costSumB: costSum('B'), costSumC: costSum('C'), toolsOk, decision, effectAB, totalCostUsd: records.reduce((a, r) => a + (r.costUsd ?? 0), 0) };

if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, agg, summary }, null, 1));
else {
  for (const [k, v] of Object.entries(agg)) console.log(k, JSON.stringify(v));
  for (const r of rows.filter((x) => !x.pass)) console.log('FAIL', r.id, 'critical=', r.critical.join(','), 'missing=', r.missing.join(','));
  console.log(JSON.stringify(summary));
}
