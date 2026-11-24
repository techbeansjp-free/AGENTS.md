// Score #1780 runs and apply the fixed decision rule. Read-only; no network.
// Usage (in this directory): node score.mjs [schedule.json] [scores.json] [costs.json]
// scores.json holds the operator's per-run annotations made blind to the condition (README "採点の規則").
import fs from 'node:fs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const [scheduleFile = './schedule.json', scoresFile = './scores.json', costsFile = './costs.json'] = process.argv.slice(2);
const gold = read('./gold.json');
const schedule = read(scheduleFile);
const scores = read(scoresFile).runs;
const costs = fs.existsSync(new URL(costsFile, import.meta.url)) ? read(costsFile).runs : {};
const trueItems = gold.items.filter((i) => i.kind === 'true');

function scoreRun(runId) {
  const s = scores[runId];
  if (!s || !s.valid) return null;
  const fixtureItems = gold.items.filter((i) => i.fixture === s.fixture);
  const r = { trueTotal: 0, detected: 0, criticalMiss: 0, negatives: 0, falsePositive: 0,
    erroneous: new Set(s.erroneous.map((e) => e.fact)).size,
    overHold: new Set(s.overHold.map((e) => e.item)).size };
  for (const item of fixtureItems) {
    const v = s.items[item.id] ?? null;
    const reported = v === 'confirmed' || v === 'needs_validation';
    if (item.kind === 'true') {
      r.trueTotal++;
      if (reported && item.accept.includes(v)) r.detected++;
      else if (item.critical) r.criticalMiss++;
    } else {
      r.negatives++;
      if (reported) r.falsePositive++;
    }
  }
  return r;
}

const metrics = ['erroneous', 'overHold', 'detected', 'criticalMiss', 'falsePositive'];
const table = {};
for (const condition of ['R0', 'R1']) {
  table[condition] = {};
  for (const replicate of [1, 2, 3]) {
    const slots = schedule.slots.filter((x) => x.condition === condition && x.replicate === replicate);
    const runs = slots.map((x) => (x.scoredRunId ? scoreRun(x.scoredRunId) : null));
    if (runs.some((x) => x === null) || slots.length !== 3) { table[condition][replicate] = null; continue; }
    const sum = Object.fromEntries(['trueTotal', 'negatives', ...metrics].map((m) => [m, runs.reduce((a, x) => a + x[m], 0)]));
    const tokens = slots.map((x) => costs[x.scoredRunId]?.tokens ?? null);
    const wall = slots.map((x) => costs[x.scoredRunId]?.wallClockMs ?? null);
    const calls = slots.map((x) => costs[x.scoredRunId]?.toolCalls ?? null);
    const total = (list) => (list.some((v) => v === null) ? null : list.reduce((a, v) => a + v, 0));
    sum.tokens = total(tokens);
    sum.wallClockMs = total(wall);
    sum.toolCalls = total(calls);
    table[condition][replicate] = sum;
  }
}

const range = (condition, metric) => {
  const values = [1, 2, 3].map((r) => table[condition][r]?.[metric]).filter((v) => v !== undefined && v !== null);
  return values.length ? { min: Math.min(...values), max: Math.max(...values), n: values.length, values } : null;
};
// "Distinguishable" = the 3-run ranges (min..max) do not overlap. Missing replicates make the comparison unknown.
const lower = (a, b) => (a && b && a.n === 3 && b.n === 3 ? a.max < b.min : null);
const ranges = Object.fromEntries([...metrics, 'tokens', 'wallClockMs', 'toolCalls'].map((m) => [m, { R0: range('R0', m), R1: range('R1', m) }]));
const r0 = (m) => ranges[m].R0;
const r1 = (m) => ranges[m].R1;
const conditions = {
  erroneousReduced: lower(r1('erroneous'), r0('erroneous')),
  recallNotWorse: lower(r1('detected'), r0('detected')) === null ? null : !lower(r1('detected'), r0('detected')),
  criticalMissNotWorse: lower(r0('criticalMiss'), r1('criticalMiss')) === null ? null : !lower(r0('criticalMiss'), r1('criticalMiss')),
  overHoldNotIncreased: lower(r0('overHold'), r1('overHold')) === null ? null : !lower(r0('overHold'), r1('overHold')),
};
const adopt = Object.values(conditions).every((v) => v === true);
console.log(JSON.stringify({ perReplicate: table, ranges, conditions,
  decision: adopt ? 'adopt' : 'reject', note: 'any null (unknown) condition means reject', trueItemsPerReplicate: trueItems.length }, null, 2));
