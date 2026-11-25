// #1815 execution order and mandatory replacements (lessons of the #1817 reviews M1/L1). No model call.
// run-order.json fixes the planned trials: reps outermost, then caseOrder, then conditionOrderByRep (odd B,S / even S,B).
// Replacement rule (decision-criteria.md「試行の扱い」), the same in the runner (run-all, run-trial) and the scorer
// (decide, make-blind): within one condition/case, the k-th planned trial (rep 1..runs, in rep order) that is a
// generation failure is replaced by rep runs+k. A replacement is run once and never replaced, whatever its outcome.
// Generation failure (generationFailure) is judged from the trial directory alone, before any rendering, so the runner
// and the scorer see the same thing. A page that later fails to render counts as failed in the scoring (worst value for
// S, best for B) but is not replaced.
import fs from 'node:fs';
import path from 'node:path';
import {loadJson} from './pairing.mjs';

export const loadOrder = () => loadJson('run-order.json');
export const trialName = (caseId, condition, rep) => `${caseId}/${condition}-r${rep}`;
export const probeName = (condition, rep) => `probe/${condition}-r${rep}`;
export const isProbeName = (name) => name.startsWith('probe/');

export function orderProblems(order, cases, conds) {
  const p = [];
  if (JSON.stringify([...order.caseOrder].sort()) !== JSON.stringify(Object.keys(cases).sort())) p.push('caseOrder is not a permutation of the cases');
  const cs = Object.keys(conds.conditions).sort().join();
  for (const k of ['odd', 'even']) if ([...(order.conditionOrderByRep?.[k] ?? [])].sort().join() !== cs) p.push(`conditionOrderByRep.${k} is not a permutation of the conditions`);
  if (!cases[order.probeCase]) p.push('probeCase is not a case');
  if ([...(order.probeConditions ?? [])].sort().join() !== cs) p.push('probeConditions must be every condition');
  return p;
}

export function plannedTrials(order = loadOrder(), runs = loadJson('conditions.json').runs) {
  const out = [];
  for (let rep = 1; rep <= runs; rep += 1) {
    for (const caseId of order.caseOrder) for (const condition of order.conditionOrderByRep[rep % 2 ? 'odd' : 'even']) out.push({case: caseId, condition, rep, name: trialName(caseId, condition, rep)});
  }
  return out;
}

// From the trial directory only: meta.json present, generation success, the session received the condition (init),
// and a deliverable out/index.html. Returns a reason or null.
export function generationFailure(dir) {
  const metaFile = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaFile)) return 'no meta.json';
  const m = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  if (m.exit !== 0) return `exit ${m.exit}`;
  if (m.resultSubtype !== 'success') return `result ${m.resultSubtype}`;
  if ((m.initProblems ?? ['no initProblems']).length) return `init: ${m.initProblems.join('; ')}`;
  if (!fs.existsSync(path.join(dir, 'fixture', 'out', 'index.html'))) return 'no out/index.html';
  return null;
}

const dirOf = (runsRoot, name) => path.join(runsRoot, ...name.split('/'));

// Required replacements per condition/case: one per failed planned trial (a planned trial not yet run is not counted).
export function replacementPlan({runsRoot, order = loadOrder(), runs = loadJson('conditions.json').runs, exists = (n) => fs.existsSync(dirOf(runsRoot, n))}) {
  const out = [];
  for (const caseId of order.caseOrder) for (const condition of order.conditionOrderByRep.odd) {
    let k = 0;
    for (let rep = 1; rep <= runs; rep += 1) {
      const name = trialName(caseId, condition, rep);
      if (exists(name) && generationFailure(dirOf(runsRoot, name))) {
        k += 1;
        out.push({case: caseId, condition, rep: runs + k, replaces: name, name: trialName(caseId, condition, runs + k)});
      }
    }
  }
  return out;
}

// run-trial: may this trial start now? `reserved` = trial names reserved in the ledger.
export function orderRefusal({caseId, condition, rep, reserved, runsRoot, order = loadOrder(), runs = loadJson('conditions.json').runs}) {
  const name = trialName(caseId, condition, rep);
  const next = plannedTrials(order, runs).find((t) => !reserved.has(t.name));
  if (Number(rep) <= runs) return next && next.name === name ? null : `out of order: the next planned trial is ${next ? next.name : 'none (all planned trials are reserved)'}, not ${name}`;
  if (next) return `replacement ${name} before every planned trial is reserved (next planned: ${next.name})`;
  const due = replacementPlan({runsRoot, order, runs, exists: (n) => reserved.has(n) || fs.existsSync(dirOf(runsRoot, n))}).filter((t) => !reserved.has(t.name));
  return due[0]?.name === name ? null : `not the next required replacement (next: ${due[0]?.name ?? 'none'})`;
}

// Scorer: the trials that count for one condition/case, and what is missing. Same rule as replacementPlan.
export function countedTrials(names, caseId, condition, {runsRoot, runs = loadJson('conditions.json').runs}) {
  const have = new Set(names);
  const counted = [], missing = [], notUsed = [];
  let k = 0;
  for (let rep = 1; rep <= runs; rep += 1) {
    const n = `${condition}-r${rep}`;
    if (!have.has(n)) { missing.push(n); continue; }
    if (generationFailure(path.join(runsRoot, caseId, n))) {
      k += 1;
      const r = `${condition}-r${runs + k}`;
      if (have.has(r)) counted.push(r); else { counted.push(n); missing.push(r); }
    } else counted.push(n);
  }
  for (const n of names) if (n.startsWith(`${condition}-r`) && !counted.includes(n)) notUsed.push(n);
  return {counted, missing, notUsed};
}
