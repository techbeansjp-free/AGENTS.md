// Usage: node summarize.mjs <outDir> [summary.json]
// Aggregates <case>-<cond>-<rep>.json records into per case x condition ranges (no averaging into one score), per
// condition totals, and path-free per-run rows (oracle checks, cost per invocation, CPU, tracker calls).
import fs from 'node:fs';
import path from 'node:path';

const [outDir, target] = process.argv.slice(2);
const recs = fs.readdirSync(outDir).filter((f) => /^K\d-[ABCD]-\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')));
const range = (xs) => { const v = xs.filter((x) => typeof x === 'number'); return v.length === xs.length && v.length ? [Math.min(...v), Math.max(...v)] : { missing: xs.length - v.length, values: v }; };
// A resumed `claude -p` reports the conversation's running total; summing would double count. Per run cost is the
// sum over sessions of each session's last reported total. A missing cost stays null (never 0).
const runCost = (r) => {
  const bySession = new Map();
  for (const i of r.invocations) if (i.sessionId && typeof i.costUsd === 'number') bySession.set(i.sessionId, i.costUsd);
  return bySession.size === new Set(r.invocations.map((i) => i.sessionId)).size ? [...bySession.values()].reduce((a, b) => a + b, 0) : null;
};
// run.mjs starts from '0:00.00' and keeps the last sample, so 0 means the sample was lost at exit: missing, not zero.
const cpuSeconds = (text) => { const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text ?? ''); const v = m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null; return v ? v : null; };
// Tracker calls of the run (if its directory is still present). t0 is approximated by the last file make-fixture writes.
function trackerCalls(r) {
  const dir = path.join(outDir, `${r.case}-${r.cond}-${r.rep}`, 'tracker-data');
  const file = path.join(dir, 'calls.jsonl');
  if (!fs.existsSync(file)) return null;
  const t0 = fs.statSync(path.join(dir, 'case.json')).mtimeMs;
  const calls = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((c) => ({ cmd: c.cmd, t: Date.parse(c.at) - t0 }));
  const byCmd = {};
  for (const c of calls) byCmd[c.cmd] = (byCmd[c.cmd] ?? 0) + 1;
  // For each resumed or restarted invocation: did it read the PR or checks before any merge call of that invocation?
  const rereadAfterResume = r.invocations.slice(1).map((inv) => {
    const inside = calls.filter((c) => c.t >= inv.started - 1000 && c.t <= inv.started + inv.ms + 1000);
    const firstMerge = inside.findIndex((c) => c.cmd === 'merge');
    const before = firstMerge < 0 ? inside : inside.slice(0, firstMerge);
    return before.some((c) => c.cmd === 'pr' || c.cmd === 'checks');
  });
  return { byCmd, rereadAfterResume };
}
const runs = recs.sort((a, b) => `${a.case}${a.cond}${a.rep}`.localeCompare(`${b.case}${b.cond}${b.rep}`)).map((r) => ({
  case: r.case, cond: r.cond, rep: r.rep, pass: r.pass, outcome: r.outcome, violations: r.violations, check: r.check, humanNeeded: r.humanNeeded,
  costUsd: runCost(r), wallS: r.wallMs / 1000, hostS: r.claudeMs / 1000, usage: r.usage, ciRuns: r.ciPushes,
  invocations: r.invocations.map((i) => ({ resume: i.resume, startS: i.started / 1000, s: i.ms / 1000, exit: i.exit, cumulativeCostUsd: i.costUsd, numTurns: i.numTurns, final: /^FINAL:\s*(\w+)/.exec(i.final ?? '')?.[1] ?? null, waiting: /WAITING:/.test(i.resultTail ?? ''), maxRssKb: i.maxRssKb, cpuS: cpuSeconds(i.cpu) })),
  tracker: trackerCalls(r), events: r.timeline.filter((e) => e.what !== 'invocation-end').map((e) => ({ t: e.t / 1000, what: e.what, status: e.status ?? undefined })),
}));
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
const totals = {};
for (const r of runs) {
  const t = (totals[r.cond] ??= { n: 0, pass: 0, costUsd: 0, costMissing: 0, wallS: 0, hostS: 0, invocations: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, assistantMessages: 0, cpuS: 0, cpuMissing: 0 });
  t.n++; t.pass += r.pass ? 1 : 0; if (r.costUsd === null) t.costMissing++; else t.costUsd += r.costUsd;
  t.wallS += r.wallS; t.hostS += r.hostS; t.invocations += r.invocations.length; t.invocationsWithCpu = t.invocations;
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'assistantMessages']) t[k] += r.usage[k];
  for (const i of r.invocations) if (i.cpuS === null) t.cpuMissing++; else t.cpuS += i.cpuS;
}
const costs = runs.map((r) => r.costUsd);
for (const t of Object.values(totals)) { if (t.costMissing === t.n) t.costUsd = null; if (t.cpuMissing === t.invocationsWithCpu) t.cpuS = null; }
const out = { runs: recs.length, totalCostUsd: costs.some((c) => c !== null) ? Number(costs.filter((c) => c !== null).reduce((a, b) => a + b, 0).toFixed(4)) : null, costMissingRuns: costs.filter((c) => c === null).length, totals, rows, perRun: runs };
if (target) fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ runs: out.runs, totalCostUsd: out.totalCostUsd, costMissingRuns: out.costMissingRuns, totals }, null, 1));
