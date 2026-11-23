// Score runs.json against gold.json / gold-scale.json. Read-only; no network.
// Usage (in this directory): node score.mjs
import fs from 'node:fs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const golds = { small: read('./gold.json'), scale: read('./gold-scale.json') };
const { runs } = read('./runs.json');
const full = { c: 'confirmed', nv: 'needs_validation', r: 'rejected' };

function score(gold, verdicts) {
  const s = { trueTotal: 0, detected: 0, criticalMiss: 0, nvTotal: 0, nvCorrect: 0, overPromotion: 0, negatives: 0, falsePositive: 0 };
  for (const item of gold.items) {
    const v = verdicts[item.id] ?? null;
    const reported = v === 'c' || v === 'nv';
    if (item.kind === 'true') {
      s.trueTotal++;
      if (reported && item.accept.includes(full[v])) s.detected++;
      else if (item.critical) s.criticalMiss++;
    } else if (item.kind === 'needs_validation') {
      s.nvTotal++;
      if (v === 'nv') s.nvCorrect++;
      if (v === 'c') s.overPromotion++;
    } else {
      s.negatives++;
      if (reported) s.falsePositive++;
    }
  }
  return s;
}

function finalVerdicts(run) {
  if (!run.verifiers) return null;
  const v = { ...run.v };
  for (const [id, verdict] of Object.entries(run.v)) {
    if (verdict !== 'c' && verdict !== 'nv') continue;
    const check = run.verifiers.find((entry) => entry.gold === id);
    if (check) v[id] = check.decision;
  }
  return v;
}

const rows = [];
for (const run of runs) {
  const gold = golds[run.case];
  const vTokens = (run.verifiers ?? []).reduce((sum, entry) => sum + entry.tokens, 0);
  const vMaxMs = (run.verifiers ?? []).reduce((max, entry) => Math.max(max, entry.ms), 0);
  rows.push({ case: run.case, cond: run.cond === 'B' ? 'B-hunter' : run.cond, run: run.run, ...score(gold, run.v), tokens: run.tokens, ms: run.ms, agents: 1 });
  const fv = finalVerdicts(run);
  if (fv) rows.push({ case: run.case, cond: 'B-final', run: run.run, ...score(gold, fv), tokens: run.tokens + vTokens, ms: run.ms + vMaxMs, agents: 1 + run.verifiers.length });
}

console.log('case\tcond\trun\tdetected\tcritMiss\tnvOK\toverProm\tFP\ttokens\tms\tagents');
for (const r of rows) {
  console.log([r.case, r.cond, r.run, `${r.detected}/${r.trueTotal}`, r.criticalMiss, `${r.nvCorrect}/${r.nvTotal}`, r.overPromotion, `${r.falsePositive}/${r.negatives}`, r.tokens, r.ms, r.agents].join('\t'));
}
console.log('\nmean per run (case, cond): tokens, ms');
const groups = new Map();
for (const r of rows) {
  const key = `${r.case}\t${r.cond}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
for (const [key, list] of groups) {
  const mean = (field) => Math.round(list.reduce((sum, r) => sum + r[field], 0) / list.length);
  console.log(`${key}\tn=${list.length}\ttokens=${mean('tokens')}\tms=${mean('ms')}\tdetected=${list.reduce((s, r) => s + r.detected, 0)}/${list.reduce((s, r) => s + r.trueTotal, 0)}`);
}
