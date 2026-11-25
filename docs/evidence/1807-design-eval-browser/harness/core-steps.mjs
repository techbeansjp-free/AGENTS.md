// Counts the core steps a generation trial actually executed, from tool-call records only (#1807).
// Source of truth: the generator's stream-json transcript (tool_use + matching tool_result). The generator's notes are not used.
// Optional corroboration: the proxy log (decisions made outside the generator container).
//
// Usage:
//   node core-steps.mjs trial <stream.jsonl> [--narrow 390] [--wide 1440] [--proxy-log proxy.jsonl] [--server browser]
//   node core-steps.mjs summarize <trial-result.json>...   (each file: output of `trial` plus {case, condition, rep})
//
// Definitions (fixed before any run; EVAL_PLAN.md):
//   exemplarViewed       : >=1 successful fetch_page or view_page call (an allowlisted page was actually obtained).
//   alternativesCompared : >=2 distinct local HTML files rendered successfully by the screenshot tool.
//   narrowChecked/wideChecked : >=1 successful screenshot at the case's narrow / wide width (any file).
//   finalBothWidths      : the deliverable (out/index.html) rendered successfully at both widths.
//   coreSteps            : exemplarViewed && alternativesCompared (the Issue's 「中心の手順」).
// A call counts as successful only if its tool_result exists, is_error is not true, and the result text does not start with "error:".
import fs from 'node:fs';
import path from 'node:path';

export function parseStream(text) {
  const events = []; let parseErrors = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { parseErrors += 1; }
  }
  return {events, parseErrors};
}

const resultText = (r) => {
  const c = r?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n');
  return '';
};

export function normalisePath(p) {
  return path.posix.normalize(String(p ?? '').replace(/^\.\//, '').replace(/^\/work\//, ''));
}

export function analyseTrial(text, {narrow = 390, wide = 1440, server = 'browser', proxyLog = null} = {}) {
  const {events, parseErrors} = parseStream(text);
  const uses = new Map(); const results = new Map(); const order = [];
  for (const e of events) {
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (e.type === 'assistant' && c?.type === 'tool_use') { uses.set(c.id, c); order.push(c.id); }
      if (e.type === 'user' && c?.type === 'tool_result') results.set(c.tool_use_id, c);
    }
  }
  // Auxiliary: how many different versions of each file were rendered (a Write/Edit to the file between renders = new version).
  const version = {}; const renderedVersions = {};
  for (const id of order) {
    const u = uses.get(id); const r = results.get(id);
    const okR = Boolean(r) && r.is_error !== true && !/^\s*error:/i.test(resultText(r));
    if (['Write', 'Edit', 'MultiEdit'].includes(u.name) && okR) { const p = normalisePath(u.input?.file_path); version[p] = (version[p] ?? 0) + 1; }
    if (u.name === `mcp__${server}__screenshot` && okR) { const p = normalisePath(u.input?.path); (renderedVersions[p] ??= new Set()).add(version[p] ?? 0); }
  }
  const prefix = `mcp__${server}__`;
  const calls = [];
  for (const [id, u] of uses) {
    if (typeof u.name !== 'string' || !u.name.startsWith(prefix)) continue;
    const tool = u.name.slice(prefix.length);
    const r = results.get(id);
    const ok = Boolean(r) && r.is_error !== true && !/^\s*error:/i.test(resultText(r));
    calls.push({id, tool, input: u.input ?? {}, hasResult: Boolean(r), ok});
  }
  const by = (t) => calls.filter((c) => c.tool === t);
  const okBy = (t) => by(t).filter((c) => c.ok);
  const shots = okBy('screenshot').map((c) => ({path: normalisePath(c.input.path), width: Number(c.input.width)}));
  const renderedFiles = [...new Set(shots.map((s) => s.path))].sort();
  const viewedUrls = [...new Set([...okBy('fetch_page'), ...okBy('view_page')].map((c) => String(c.input.url)))].sort();
  const final = 'out/index.html';
  const out = {
    schema: 'asc-1807-core-steps/v1',
    parseErrors,
    events: events.length,
    toolCalls: Object.fromEntries(['fetch_page', 'view_page', 'screenshot'].map((t) => [t, {calls: by(t).length, ok: okBy(t).length, failed: by(t).filter((c) => c.hasResult && !c.ok).length, noResult: by(t).filter((c) => !c.hasResult).length}])),
    otherBrowserTools: calls.filter((c) => !['fetch_page', 'view_page', 'screenshot'].includes(c.tool)).map((c) => c.tool),
    viewedUrls,
    viewPageWidths: [...new Set(okBy('view_page').map((c) => Number(c.input.width)))].sort((a, b) => a - b),
    renderedFiles,
    screenshotWidths: [...new Set(shots.map((s) => s.width))].sort((a, b) => a - b),
    renderedVersions: Object.fromEntries(Object.entries(renderedVersions).map(([k, v]) => [k, v.size]).sort()),
    exemplarViewed: viewedUrls.length > 0,
    alternativesCompared: renderedFiles.length >= 2,
    narrowChecked: shots.some((s) => s.width === narrow),
    wideChecked: shots.some((s) => s.width === wide),
    finalBothWidths: shots.some((s) => s.path === final && s.width === narrow) && shots.some((s) => s.path === final && s.width === wide),
    widths: {narrow, wide},
  };
  out.coreSteps = out.exemplarViewed && out.alternativesCompared;
  if (proxyLog !== null) {
    const recs = parseStream(proxyLog).events.filter((r) => r.listener === 'browse' && r.decision);
    out.proxy = {allowed: recs.filter((r) => r.decision === 'allow').length, denied: recs.filter((r) => r.decision === 'deny').length,
      deniedReasons: Object.fromEntries(Object.entries(recs.filter((r) => r.decision === 'deny').reduce((a, r) => ({...a, [r.reason]: (a[r.reason] ?? 0) + 1}), {})))};
    // A successful page tool call must leave at least one allowed request in the proxy log.
    out.proxyCorroborates = !out.exemplarViewed || out.proxy.allowed > 0;
  }
  return out;
}

// Per candidate per case: judged only when trials with the core steps are a strict majority of that case's trials.
export function summarize(trials) {
  const groups = {};
  for (const t of trials) {
    const k = `${t.case}\t${t.condition}`;
    (groups[k] ??= {case: t.case, condition: t.condition, trials: 0, coreSteps: 0, exemplarViewed: 0, alternativesCompared: 0, narrowChecked: 0, wideChecked: 0, finalBothWidths: 0, missing: []});
    const g = groups[k];
    g.trials += 1;
    for (const f of ['coreSteps', 'exemplarViewed', 'alternativesCompared', 'narrowChecked', 'wideChecked', 'finalBothWidths']) if (t[f]) g[f] += 1;
    if (!t.coreSteps) g.missing.push({rep: t.rep ?? null, exemplarViewed: Boolean(t.exemplarViewed), alternativesCompared: Boolean(t.alternativesCompared)});
  }
  return Object.values(groups).map((g) => ({...g, judgeable: g.coreSteps * 2 > g.trials, status: g.coreSteps * 2 > g.trials ? '判定可能' : '未判定'}))
    .sort((a, b) => (a.case + a.condition).localeCompare(b.case + b.condition));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [mode, ...rest] = process.argv.slice(2);
  const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
  if (mode === 'trial') {
    const proxyPath = opt('--proxy-log', null);
    const r = analyseTrial(fs.readFileSync(rest[0], 'utf8'), {narrow: Number(opt('--narrow', 390)), wide: Number(opt('--wide', 1440)), server: opt('--server', 'browser'),
      proxyLog: proxyPath ? fs.readFileSync(proxyPath, 'utf8') : null});
    console.log(JSON.stringify(r, null, 1));
  } else if (mode === 'summarize') {
    console.log(JSON.stringify(summarize(rest.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))), null, 1));
  } else {
    console.error('usage: node core-steps.mjs trial <stream.jsonl> [...] | summarize <trial.json>...'); process.exit(2);
  }
}
