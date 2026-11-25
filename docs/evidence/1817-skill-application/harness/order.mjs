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
import {settledFilesProblem} from './ledger.mjs';

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

// Probes (decision-criteria.md rule 5, review Medium-1): only before the first planned trial is reserved; rep 1 per
// condition, and rep 2 (the one re-run of a failed or not-passing probe) only after rep 1 of that condition is reserved.
// A probe after measurement started would add cost to the ledger without measuring anything (e.g. to reach the cap).
export function probeRefusal({condition, rep, reserved, order = loadOrder(), runs = readJson('conditions.json').runs}) {
  const started = plannedTrials(order, runs).find((t) => reserved.has(t.name));
  if (started) return `probe refused: measurement has started (${started.name} is reserved)`;
  if (!['1', '2'].includes(String(rep))) return `probe refused: rep must be 1, or 2 for the one re-run (got ${rep})`;
  if (String(rep) === '2' && !reserved.has(trialName(condition, 'probe', 1))) return `probe refused: ${trialName(condition, 'probe', 2)} needs ${trialName(condition, 'probe', 1)} first`;
  return null;
}

// run-trial: may this trial start now, given the names already reserved in the ledger?
// A replacement (rep > runs) may start only after every planned trial is reserved, and only when it is the next trial of
// replacementPlan for the trials in runsRoot (review L-1); without runsRoot and spec a replacement is refused.
export function orderRefusal({condition, caseId, rep, reserved, settled = new Map(), runsRoot = null, spec = null, order = loadOrder(), runs = readJson('conditions.json').runs}) {
  if (caseId === 'probe') return probeRefusal({condition, rep, reserved, order, runs});
  const planned = plannedTrials(order, runs);
  const next = planned.find((t) => !reserved.has(t.name));
  const name = trialName(condition, caseId, rep);
  if (Number(rep) <= runs) {
    return next && next.name === name ? null : `out of order: the next planned trial is ${next ? next.name : 'none (all planned trials are reserved)'}, not ${name}`;
  }
  if (next) return `replacement ${name} before every planned trial is reserved (next planned: ${next.name})`;
  if (!runsRoot || !spec) return `replacement ${name}: the replacement plan needs the runs root and the cases`;
  let plan;
  try { plan = replacementPlan({runsRoot, spec, order, runs, reserved, settled}); } catch (e) { return `replacement ${name} refused: ${e.message}`; }
  return plan[0]?.name === name ? null : `${name} is not the next required replacement (next: ${plan[0]?.name ?? 'none'})`;
}

// Failure of one raw trial directory (runs root), as score.mjs would count it after collect.mjs. review Medium-A: a
// settled trial whose trace.jsonl or meta.json is missing or differs from its settlement is not a failure but a
// tampered record: this throws, so no replacement can be planned for it.
// review Low-1 (fifth review): a reserved trial without a settlement (stopped during the run) is a failure whatever files
// exist; replacementPlan calls this only for reserved trials.
export function trialFailure(dir, spec, caseId, settlement = null) {
  if (!settlement) return 'not settled';
  const tampered = settledFilesProblem(dir, settlement);
  if (tampered) throw new Error(tampered);
  const trace = path.join(dir, 'trace.jsonl');
  if (!fs.existsSync(trace) || fs.statSync(trace).size === 0) return 'missing trace';
  if (!fs.existsSync(path.join(dir, 'meta.json'))) return 'no meta.json';
  const k = spec.cases.find((c) => c.id === caseId);
  try { return scoreRun(spec, k, parseTrace(fs.readFileSync(trace, 'utf8'))).failure ?? null; } catch (e) { return `unreadable trace: ${e.message}`; }
}

// The replacement trials still to run, in execution order: for each condition/case, one per failed planned trial, with
// rep numbers runs+1 .. runs+failures; reps already reserved (whatever their outcome) are not planned again.
// review Low-B: only ledger reservations count (`reserved`, a Set of names); a directory without a reservation is not a
// started trial, so its replacement is planned and run-trial refuses it with "exists" (README resume, case 2).
// `settled` (Map name -> settlement) lets trialFailure detect deleted or edited files of a settled trial (Medium-A).
export function replacementPlan({runsRoot, spec, order = loadOrder(), runs = readJson('conditions.json').runs, reserved, settled = new Map()}) {
  const exists = (n) => reserved.has(n);
  const out = [];
  for (const caseId of order.caseOrder) for (const condition of order.conditionOrder) {
    let failed = 0;
    for (let rep = 1; rep <= runs; rep += 1) {
      const name = trialName(condition, caseId, rep);
      if (!exists(name)) continue; // not run yet: not a failure, run-trial's order check comes first
      if (trialFailure(path.join(runsRoot, name), spec, caseId, settled.get(name) ?? null)) failed += 1;
    }
    for (let k = 1; k <= failed; k += 1) {
      const name = trialName(condition, caseId, runs + k);
      if (!exists(name)) out.push({condition, case: caseId, rep: runs + k, name});
    }
  }
  return out;
}

// review M-1: a run may be judged only when it is complete (every planned trial and every required replacement is
// reserved in the ledger) or when it stopped because the cap was reached (ledger total + perTrialUsd > cap - margin, the
// condition under which run-trial refuses the next trial). Required replacements come from the scored runs: the k-th
// failed planned trial of a condition/case requires rep runs+k.
// review Medium-1 (defence in depth): cap-reached is not granted when any probe reservation comes after the first planned
// reservation (reservations: the ledger's reservations in order, each {trial, seq}); without them it is not granted either.
export function completionStatus({runs: scored, reserved, reservations = null, spentUsd, budget, order = loadOrder(), plannedReps = readJson('conditions.json').runs}) {
  const runs = plannedReps;
  const missingPlanned = plannedTrials(order, runs).map((t) => t.name).filter((n) => !reserved.has(n));
  const failed = new Map();
  for (const r of scored) if (r.run <= runs && r.failure) failed.set(`${r.condition}|${r.case}`, (failed.get(`${r.condition}|${r.case}`) ?? 0) + 1);
  const required = [...failed].flatMap(([key, k]) => { const [c, id] = key.split('|'); return Array.from({length: k}, (_, j) => trialName(c, id, runs + j + 1)); });
  const missingReplacements = required.filter((n) => !reserved.has(n));
  const complete = missingPlanned.length === 0 && missingReplacements.length === 0;
  const stopLine = budget.capUsd - budget.safetyMarginUsd;
  const plannedNames = new Set(plannedTrials(order, runs).map((t) => t.name));
  const firstPlannedSeq = reservations ? Math.min(...reservations.filter((e) => plannedNames.has(e.trial)).map((e) => e.seq)) : null;
  const lateProbes = reservations ? reservations.filter((e) => /-probe-\d+$/.test(e.trial) && e.seq > firstPlannedSeq).map((e) => e.trial) : null;
  const capReached = spentUsd + budget.perTrialUsd > stopLine && lateProbes !== null && lateProbes.length === 0;
  return {basis: complete ? 'complete' : capReached ? 'cap-reached' : null, complete, capReached, lateProbes,
    missingPlanned: missingPlanned.length, firstMissingPlanned: missingPlanned[0] ?? null, missingReplacements,
    spentUsd: Number(spentUsd.toFixed(4)), stopLineUsd: stopLine, perTrialUsd: budget.perTrialUsd};
}
