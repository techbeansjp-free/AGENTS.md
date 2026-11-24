// Usage: node summarize.mjs <outDir> [summary.json]
// Aggregates <case>-<cond>-<rep>.json records into per case x condition ranges (no averaging into one score).
import fs from 'node:fs';
import path from 'node:path';

const [outDir, target] = process.argv.slice(2);
const recs = fs.readdirSync(outDir).filter((f) => /^K\d-[ABCD]-\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')));
const range = (xs) => { const v = xs.filter((x) => typeof x === 'number'); return v.length === xs.length && v.length ? [Math.min(...v), Math.max(...v)] : { missing: xs.length - v.length, values: v }; };
// A resumed `claude -p` reports the conversation's running total; summing would double count. Per run cost is the
// sum over sessions of each session's last reported total.
const runCost = (r) => {
  const bySession = new Map();
  for (const i of r.invocations) if (i.sessionId && typeof i.costUsd === 'number') bySession.set(i.sessionId, i.costUsd);
  return bySession.size === new Set(r.invocations.map((i) => i.sessionId)).size ? [...bySession.values()].reduce((a, b) => a + b, 0) : null;
};
const groups = {};
for (const r of recs) (groups[`${r.case}-${r.cond}`] ??= []).push(r);
const rows = Object.keys(groups).sort().map((key) => {
  const g = groups[key].sort((a, b) => a.rep - b.rep);
  return {
    key, n: g.length, pass: g.filter((r) => r.pass).length, violations: g.flatMap((r) => r.violations), outcomes: g.map((r) => r.outcome), finals: g.map((r) => r.check.final),
    costUsd: range(g.map(runCost)), wallS: range(g.map((r) => r.wallMs / 1000)), hostS: range(g.map((r) => r.claudeMs / 1000)),
    invocations: g.map((r) => r.invocations.length), assistantMessages: g.map((r) => r.usage.assistantMessages),
    input: range(g.map((r) => r.usage.input)), output: range(g.map((r) => r.usage.output)), cacheRead: range(g.map((r) => r.usage.cacheRead)), cacheWrite: range(g.map((r) => r.usage.cacheWrite)),
    maxRssMb: range(g.map((r) => Math.max(...r.invocations.map((i) => i.maxRssKb)) / 1024)), humanNeeded: g.map((r) => r.humanNeeded),
    prCreateCalls: g.map((r) => r.check.prCreateCalls), mergeCalls: g.map((r) => r.check.mergeCalls), ciRuns: g.map((r) => r.ciPushes),
  };
});
const total = recs.reduce((s, r) => s + (runCost(r) ?? 0), 0);
const out = { runs: recs.length, totalCostUsd: Number(total.toFixed(4)), rows };
if (target) fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
