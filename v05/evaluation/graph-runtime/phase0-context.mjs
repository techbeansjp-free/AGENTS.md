// Phase 0 B (#1648): how much input context is accumulated conversation, and how much would a 5k structured state
// rebuilt at each milestone (commit / PR creation / review completion) have saved? Aggregates only: no message text.
// usage: node phase0-context.mjs <out.json> <sinceISO> <repoPath> <excludeSessionId> <logDir...>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [outFile, since, repo, exclude, ...dirs] = process.argv.slice(2);
const STATE = 5000, REREAD = 20000, T0 = Date.parse(since);
const COMMIT = /\bgit\b(?:\s+-[Cc]\s+\S+)*\s+commit\b/, PR = /\b(?:gh\s+)?pr\s+create\b/;
const REVIEW_CMD = /\breview\s+(?:round|replace|export)\b(?![^\n]*--init)|\bgh\s+pr\s+review\b/, REVIEW = /review|レビュー/i;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.jsonl(\.zst)?$/.test(e.name) ? [path.join(d, e.name)] : []);
const read = (f) => (f.endsWith('.zst') ? zlib.zstdDecompressSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8').split('\n').flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } });
const kind = (m) => { const k = COMMIT.test(m) ? 'commit' : PR.test(m) ? 'pr' : REVIEW_CMD.test(m) ? 'review' : null; return k; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

// calls: [{t, ctx, out, reset?}] in order; compactions: indices of first call after a compaction.
function measure(s) {
  const c = s.calls.filter((x) => Date.parse(x.t) >= T0);
  if (!c.length) return null;
  // protocol: "the session's first call" (may precede the window); firstInWindow is the sensitivity variant.
  const first = s.calls[0].ctx, firstW = c[0].ctx, inT = c.reduce((a, x) => a + x.ctx, 0), outT = c.reduce((a, x) => a + x.out, 0);
  const sim = (extra, first, only = ['commit', 'pr', 'review']) => { let k = null, sum = 0, resets = 0;
    c.forEach((x, i) => { if (i > 0 && x.ms?.some((m) => only.includes(m))) { k = x.ctx; resets++; }
      sum += k === null ? x.ctx : Math.min(x.ctx, Math.max(Math.min(x.ctx, first), first + STATE + extra + x.ctx - k)); });
    return { input: sum, resets }; };
  const base = sim(0, first), persist = sim(REREAD, first), win = sim(0, firstW), noReview = sim(0, first, ['commit', 'pr']), total = inT + outT;
  let drop = 0, cum = 0; const kept = [];
  c.forEach((x, i) => { if (i > 0 && x.compactedBefore) { const d = Math.max(0, c[i - 1].ctx - x.ctx); drop += d; cum += d; kept.push(x.ctx / c[i - 1].ctx); } x.nc = x.ctx + cum; });
  const noCompact = c.reduce((a, x) => a + x.nc, 0) + outT;
  const ms = { commit: 0, pr: 0, review: 0 }; for (const x of c) for (const k of x.ms ?? []) ms[k]++;
  return { id: s.id, host: s.host, role: s.role, parent: s.parent, cwd: path.basename(s.cwd), start: c[0].t, end: c.at(-1).t,
    calls: c.length, ctxFirst: first, ctxFirstInWindow: firstW, ctxMax: Math.max(...c.map((x) => x.ctx)), ctxMean: Math.round(inT / c.length), input: inT, output: outT, total,
    accumulation: c.reduce((a, x) => a + x.ctx - first, 0), compactions: c.filter((x, i) => i > 0 && x.compactedBefore).length, compactionDrop: drop, compactionKeptMedian: median(kept),
    totalWithoutCompaction: noCompact, compactionSaving: noCompact ? 1 - total / noCompact : 0, milestones: ms, resets: base.resets,
    cfTotal: base.input + outT, reduction: 1 - (base.input + outT) / total,
    reductionRereadOnce: 1 - (base.input + outT + REREAD * base.resets) / total, reductionRereadPersist: 1 - (persist.input + outT) / total,
    reductionFirstInWindow: 1 - (win.input + outT) / total, reductionCommitPrOnly: 1 - (noReview.input + outT) / total };
}

function codex(f, ev) {
  const meta = ev[0].payload, id = meta.id, calls = [], pending = new Map();
  let flag = [], compacted = false, own = false;
  for (const e of ev) {
    const p = e.payload ?? {};
    if (e.type === 'token_usage_record' && p.thread_id === id) {
      if (calls.some((x) => x.rid === p.response_id)) continue;
      calls.push({ rid: p.response_id, t: e.timestamp, ctx: p.usage.input_tokens, out: p.usage.output_tokens, reset: flag.length > 0, ms: flag, compactedBefore: compacted && own });
      flag = []; compacted = false; own = true;
    } else if (e.type === 'compacted') compacted = true;
    else if (e.type === 'response_item' && (p.type === 'custom_tool_call' || p.type === 'function_call')) {
      const k = kind(p.input ?? p.arguments ?? ''); if (k) pending.set(p.call_id, k);
    } else if (e.type === 'response_item' && /_call_output$/.test(p.type ?? '') && pending.has(p.call_id)) { flag = [...flag, pending.get(p.call_id)]; pending.delete(p.call_id); }
    else if (e.type === 'response_item' && p.type === 'agent_message' && p.recipient === '/root' && REVIEW.test(p.author ?? '') && own) flag = [...flag, 'review'];
  }
  const sub = meta.source?.subagent ?? null, parent = meta.parent_thread_id ?? sub?.thread_spawn?.parent_thread_id ?? meta.forked_from_id ?? null;
  const role = sub || parent ? 'subagent' : meta.originator === 'codex_vscode' || meta.originator === 'codex_cli_rs' ? 'coordinator' : 'launched';
  return { id, host: 'codex', role, parent, cwd: meta.cwd, calls, kindDetail: sub?.other ?? (sub ? 'thread_spawn' : meta.originator) };
}

function claude(f, ev) {
  const sub = f.includes(`${path.sep}subagents${path.sep}`), id = path.basename(f).replace(/\.jsonl$/, '');
  const byId = new Map(), order = [], pending = new Map();
  let flag = [], compacted = false;
  const cwd = ev.find((e) => e.cwd)?.cwd ?? '', entry = ev.find((e) => e.entrypoint)?.entrypoint;
  for (const e of ev) {
    if (e.type === 'system' && e.subtype === 'compact_boundary') compacted = true;
    if (e.type === 'user') {
      const content = e.message?.content;
      if (typeof content === 'string' && content.startsWith('<task-notification>') && /<status>completed/.test(content) && REVIEW.test(/<summary>([\s\S]*?)<\/summary>/.exec(content)?.[1] ?? '')) flag = [...flag, 'review'];
      for (const b of Array.isArray(content) ? content : []) if (b.type === 'tool_result' && pending.has(b.tool_use_id)) {
        const k = pending.get(b.tool_use_id), txt = JSON.stringify(b.content ?? '');
        if (k !== 'review' || !/launched|running in the background|async/i.test(txt)) flag = [...flag, k];
        pending.delete(b.tool_use_id);
      }
    }
    if (e.type !== 'assistant' || !e.message?.id) continue;
    const m = e.message, u = m.usage;
    for (const b of m.content ?? []) if (b.type === 'tool_use') {
      const k = b.name === 'Bash' ? kind(b.input?.command ?? '') : (b.name === 'Agent' || b.name === 'Task') && REVIEW.test(`${b.input?.description ?? ''} ${b.input?.subagent_type ?? ''}`) ? 'review' : null;
      if (k) pending.set(b.id, k);
    }
    if (!u) continue;
    const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const prev = byId.get(m.id);
    if (prev) { prev.ctx = Math.max(prev.ctx, ctx); prev.out = Math.max(prev.out, u.output_tokens ?? 0); continue; }
    const call = { t: e.timestamp, ctx, out: u.output_tokens ?? 0, reset: flag.length > 0, ms: flag, compactedBefore: compacted };
    byId.set(m.id, call); order.push(call); flag = []; compacted = false;
  }
  const parent = sub ? path.basename(path.dirname(path.dirname(f))) : null;
  return { id, host: 'claude', role: sub ? 'subagent' : entry === 'sdk-cli' ? 'launched' : 'coordinator', parent, cwd, calls: order, kindDetail: entry };
}

const sessions = new Map(), gaps = [];
for (const f of dirs.flatMap(walk)) {
  if (f.includes(exclude)) continue;
  const ev = read(f); if (!ev.length) continue;
  const s = ev[0].type === 'session_meta' ? codex(f, ev) : claude(f, ev);
  if (!(s.cwd === repo || s.cwd.startsWith(repo + path.sep))) continue;
  if (!s.calls.length) { if (Date.parse(ev.findLast((e) => e.timestamp)?.timestamp ?? 0) >= T0) gaps.push({ id: s.id, host: s.host, reason: 'no usage records' }); continue; }
  const prev = sessions.get(s.id);
  if (prev) { for (const x of s.calls) if (!prev.calls.some((y) => y.t === x.t && y.ctx === x.ctx)) prev.calls.push(x); prev.calls.sort((a, b) => Date.parse(a.t) - Date.parse(b.t)); }
  else sessions.set(s.id, s);
}
const rows = [...sessions.values()].map((s) => { const r = measure(s); if (r) r.kind = s.kindDetail; return r; }).filter((r) => r?.total > 0).sort((a, b) => b.total - a.total);
const all = rows.reduce((a, r) => a + r.total, 0), top = []; let acc = 0;
for (const r of rows) { if (acc > all / 2) break; top.push(r); acc += r.total; }
const share = (pred) => rows.filter(pred).reduce((a, r) => a + r.total, 0) / all;
const wavg = (rs, k) => 1 - rs.reduce((a, r) => a + r.total * (1 - r[k]), 0) / rs.reduce((a, r) => a + r.total, 0);
const summary = {
  sessions: rows.length, totalTokens: all, gaps,
  share: { coordinator: share((r) => r.role === 'coordinator'), subagent: share((r) => r.role === 'subagent'), launched: share((r) => r.role === 'launched'), codex: share((r) => r.host === 'codex'), claude: share((r) => r.host === 'claude') },
  accumulationShareOfInput: rows.reduce((a, r) => a + r.accumulation, 0) / rows.reduce((a, r) => a + r.input, 0),
  top: { n: top.length, tokens: acc, share: acc / all, medianReduction: median(top.map((r) => r.reduction)), medianRereadOnce: median(top.map((r) => r.reductionRereadOnce)), medianRereadPersist: median(top.map((r) => r.reductionRereadPersist)), medianFirstInWindow: median(top.map((r) => r.reductionFirstInWindow)), medianCommitPrOnly: median(top.map((r) => r.reductionCommitPrOnly)), weightedReduction: wavg(top, 'reduction') },
  medianTop10: median(rows.slice(0, 10).map((r) => r.reduction)), medianCoordinators: median(rows.filter((r) => r.role === 'coordinator').map((r) => r.reduction)),
  allWeighted: { reduction: wavg(rows, 'reduction'), rereadOnce: wavg(rows, 'reductionRereadOnce'), rereadPersist: wavg(rows, 'reductionRereadPersist'), firstInWindow: wavg(rows, 'reductionFirstInWindow'), commitPrOnly: wavg(rows, 'reductionCommitPrOnly') },
  topSessionsWithoutMilestones: top.filter((r) => !r.resets).length,
  compaction: { sessions: rows.filter((r) => r.compactions).length, topSessions: top.filter((r) => r.compactions).length, events: rows.reduce((a, r) => a + r.compactions, 0),
    savingVsNoCompaction: 1 - all / rows.reduce((a, r) => a + r.totalWithoutCompaction, 0) },
  threshold: 0.2,
};
summary.verdict = summary.top.medianReduction >= 0.2 ? 'value' : 'no-value';
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ params: { since, state: STATE, reread: REREAD }, summary, sessions: rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
