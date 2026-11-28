// #1867: the 24 counted trials of the plan (B and S x 4 cases x reps 1..3) as raw run directories of the shared harness
// (<runs>/<condition>-<case>-<rep>), with the mandatory replacements given explicitly (--replace <failed>=<replacement>,
// e.g. S-lp-new-2=S-lp-new-4: the replacement takes the failed trial's slot r2). No model call.
import fs from 'node:fs';
import path from 'node:path';

export const CONDITIONS = ['B', 'S'];
export const CASES = ['ui02-exhibition', 'lp-new', 'ui03-dashboard', 'ui08-existing-ds'];
export const REPS = [1, 2, 3];
// The page of a case inside a trial's work/ copy: its directory and the HTML file (ui08 writes app/billing.html).
export const PAGE = {'ui02-exhibition': ['out', 'index.html'], 'lp-new': ['out', 'index.html'], 'ui03-dashboard': ['out', 'index.html'], 'ui08-existing-ds': ['app', 'billing.html']};
export const RECORD = 'out/DESIGN-NOTES.md';

export function parseReplacements(list) {
  const out = {};
  for (const r of list) {
    const m = /^([A-Z])-(.+)-(\d+)=([A-Z])-(.+)-(\d+)$/.exec(r);
    if (!m || m[1] !== m[4] || m[2] !== m[5] || Number(m[6]) <= REPS.length || !REPS.includes(Number(m[3]))) throw new Error(`--replace ${r}: expected <C>-<case>-<1..3>=<C>-<case>-<4..>`);
    if (out[`${m[1]}-${m[2]}-${m[3]}`]) throw new Error(`--replace ${r}: the slot is replaced twice`);
    out[`${m[1]}-${m[2]}-${m[3]}`] = `${m[4]}-${m[5]}-${m[6]}`;
  }
  return out;
}

// [{condition, case, rep, slot: 'S-r1', name: the run directory used}]
export function countedTrials(replacements = {}) {
  const used = new Set(Object.values(replacements));
  if (used.size !== Object.values(replacements).length) throw new Error('one replacement is used for two slots');
  return CONDITIONS.flatMap((condition) => CASES.flatMap((c) => REPS.map((rep) => {
    const own = `${condition}-${c}-${rep}`;
    return {condition, case: c, rep, slot: `${condition}-r${rep}`, name: replacements[own] ?? own};
  })));
}

export const argList = (argv, flag) => argv.flatMap((x, i) => (x === flag ? [argv[i + 1]] : []));
export const workOf = (runs, t) => path.join(runs, t.name, 'work');
export const exists = (f) => fs.existsSync(f);

// #1867 review L-3: the trials taken (countedTrials with the given --replace) must be the shared harness's counted rows of
// results/runs.json (counted: true; a replacement's replaces = the failed rep). Throws on any difference.
export function checkCounted(replacements, runsRows) {
  const rows = runsRows.filter((r) => CONDITIONS.includes(r.condition) && CASES.includes(r.case));
  const name = (r) => `${r.condition}-${r.case}-${r.run}`;
  const want = countedTrials(replacements).map((t) => t.name).sort();
  const have = rows.filter((r) => r.counted === true).map(name).sort();
  const problems = [];
  const extra = have.filter((n) => !want.includes(n)), lack = want.filter((n) => !have.includes(n));
  if (extra.length) problems.push(`counted in runs.json but not taken: ${extra.join(', ')}`);
  if (lack.length) problems.push(`taken but not counted in runs.json: ${lack.join(', ')}`);
  for (const [slot, sub] of Object.entries(replacements)) {
    const r = rows.find((x) => name(x) === sub);
    const rep = Number(slot.split('-').pop());
    if (r && r.replaces !== rep) problems.push(`${sub} replaces ${r.replaces ?? 'nothing'} in runs.json, not ${rep}`);
  }
  if (problems.length) throw new Error(`--replace does not match results/runs.json: ${problems.join('; ')}`);
  return true;
}

// The counted trials that failed (no valid trial in their slot: a failed replacement, or a failed trial left without one).
export const failedCounted = (runsRows) => new Set(runsRows.filter((r) => r.counted === true && r.failure).map((r) => `${r.condition}-${r.case}-${r.run}`));
