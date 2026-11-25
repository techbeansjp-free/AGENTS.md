// #1817 execution order (review M1) and mandatory replacements (review L1). No model call.
// run-order.json fixes the order of the planned trials: reps outermost, then caseOrder (negative cases interleaved), then
// conditionOrder (B then S). run-trial.mjs refuses a planned trial that is not the next unreserved one in this order and a
// replacement before every planned trial is reserved; run-all.mjs runs only this order. Replacements: every failed planned
// trial of a condition/case is replaced exactly once, by the next rep numbers runs+1, runs+2, ... (one per failure, in
// order); a failed replacement is not replaced again (decision-criteria.md rule 4; score.mjs selectCounted counts the same).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTrace, scoreRun} from './score.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ev, f), 'utf8'));
export const loadOrder = () => readJson('run-order.json');

// Problems of an order against the cases and conditions (each case once, negatives not at the end, B then S).
export function orderProblems(order, spec, conds) {
  const p = [];
  const ids = spec.cases.map((c) => c.id);
  if (JSON.stringify([...order.caseOrder].sort()) !== JSON.stringify([...ids].sort())) p.push('caseOrder is not a permutation of the cases');
  const neg = order.caseOrder.map((id) => spec.cases.find((c) => c.id === id)?.kind === 'negative');
  const firstOfTrailingNegatives = neg.lastIndexOf(false) + 1;
  if (firstOfTrailingNegatives < neg.length) p.push('caseOrder ends with a negative case (negatives must be interleaved)');
  for (let i = 1; i < neg.length; i += 1) if (neg[i] && neg[i - 1]) p.push(`negative cases are adjacent at ${i}`);
  if (JSON.stringify(order.conditionOrder) !== JSON.stringify(Object.keys(conds.conditions))) p.push('conditionOrder is not the conditions of conditions.json');
  return p;
}

export const trialName = (condition, caseId, rep) => `${condition}-${caseId}-${rep}`;

// The planned trials in execution order.
export function plannedTrials(order = loadOrder(), runs = readJson('conditions.json').runs) {
  const out = [];
  for (let rep = 1; rep <= runs; rep += 1) for (const caseId of order.caseOrder) for (const condition of order.conditionOrder) out.push({condition, case: caseId, rep, name: trialName(condition, caseId, rep)});
  return out;
}

// run-trial: may this trial start now, given the names already reserved in the ledger? Probes are not ordered.
export function orderRefusal({condition, caseId, rep, reserved, order = loadOrder(), runs = readJson('conditions.json').runs}) {
  if (caseId === 'probe') return null;
  const planned = plannedTrials(order, runs);
  const next = planned.find((t) => !reserved.has(t.name));
  if (Number(rep) <= runs) {
    const name = trialName(condition, caseId, rep);
    return next && next.name === name ? null : `out of order: the next planned trial is ${next ? next.name : 'none (all planned trials are reserved)'}, not ${name}`;
  }
  return next ? `replacement ${trialName(condition, caseId, rep)} before every planned trial is reserved (next planned: ${next.name})` : null;
}

// Failure of one raw trial directory (runs root), as score.mjs would count it after collect.mjs.
export function trialFailure(dir, spec, caseId) {
  const trace = path.join(dir, 'trace.jsonl');
  if (!fs.existsSync(trace) || fs.statSync(trace).size === 0) return 'missing trace';
  if (!fs.existsSync(path.join(dir, 'meta.json'))) return 'no meta.json';
  const k = spec.cases.find((c) => c.id === caseId);
  try { return scoreRun(spec, k, parseTrace(fs.readFileSync(trace, 'utf8'))).failure ?? null; } catch (e) { return `unreadable trace: ${e.message}`; }
}

// The replacement trials still to run, in execution order: for each condition/case, one per failed planned trial, with
// rep numbers runs+1 .. runs+failures; reps already present (run, whatever their outcome) are not planned again.
// `exists(name)` tells whether a trial was started (its directory exists or it is reserved in the ledger).
export function replacementPlan({runsRoot, spec, order = loadOrder(), runs = readJson('conditions.json').runs, exists}) {
  const out = [];
  for (const caseId of order.caseOrder) for (const condition of order.conditionOrder) {
    let failed = 0;
    for (let rep = 1; rep <= runs; rep += 1) {
      const name = trialName(condition, caseId, rep);
      if (!exists(name)) continue; // not run yet: not a failure, run-trial's order check comes first
      if (trialFailure(path.join(runsRoot, name), spec, caseId)) failed += 1;
    }
    for (let k = 1; k <= failed; k += 1) {
      const name = trialName(condition, caseId, runs + k);
      if (!exists(name)) out.push({condition, case: caseId, rep: runs + k, name});
    }
  }
  return out;
}
