// #1820: adapted from docs/evidence/1817-skill-application/harness/order.mjs (review M1, L1, Medium-1 rules kept). No model call.
// Changes: the planned trials come from run-order.json perRep (entries <cell>:<case>; negative cases only in reps
// 1..negativeRuns) instead of caseOrder x conditionOrder; the planned reps of a case are runs (brief) or negativeRuns
// (negatives), so its replacements are planned+1, planned+2, ...; probes are allowed only for the probe cells (one per
// tools level).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTrace, scoreRun} from './score.mjs';
import {settledFilesProblem} from './ledger.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ev, f), 'utf8'));
export const loadOrder = () => readJson('run-order.json');
const loadConds = () => readJson('conditions.json');
const loadSpec = () => readJson('cases.json');

export const trialName = (condition, caseId, rep) => `${condition}-${caseId}-${rep}`;
const parseEntry = (e) => { const [condition, caseId] = String(e).split(':'); return {condition, case: caseId}; };
const isNeg = (spec, caseId) => spec.cases.find((c) => c.id === caseId)?.kind === 'negative';
export const plannedRepsFor = (caseId, spec = loadSpec(), conds = loadConds()) => (isNeg(spec, caseId) ? conds.negativeRuns : conds.runs);

// Problems of an order against the cases and the cells.
export function orderProblems(order, spec, conds) {
  const p = [];
  const entries = order.perRep.map(parseEntry);
  for (const e of entries) {
    if (!conds.cells[e.condition]) p.push(`unknown cell ${e.condition}`);
    if (!spec.cases.some((c) => c.id === e.case)) p.push(`unknown case ${e.case}`);
  }
  const key = (e) => `${e.condition}:${e.case}`;
  if (new Set(entries.map(key)).size !== entries.length) p.push('an entry is repeated');
  for (const cell of Object.keys(conds.cells)) if (entries.filter((e) => e.condition === cell && e.case === 'brief').length !== 1) p.push(`cell ${cell} has not exactly one brief entry`);
  const negs = spec.cases.filter((c) => c.kind === 'negative').map((c) => c.id);
  for (const e of entries.filter((x) => negs.includes(x.case))) if (!conds.negativeCells.includes(e.condition)) p.push(`negative ${key(e)} outside the negative cells`);
  for (const cell of conds.negativeCells) for (const id of negs) if (!entries.some((e) => e.condition === cell && e.case === id)) p.push(`missing ${cell}:${id}`);
  const neg = entries.map((e) => negs.includes(e.case));
  if (neg.at(-1)) p.push('perRep ends with a negative case (negatives must be interleaved)');
  for (let i = 1; i < neg.length; i += 1) if (neg[i] && neg[i - 1]) p.push(`negative cases are adjacent at ${i}`);
  return p;
}

// The planned trials in execution order.
export function plannedTrials(order = loadOrder(), conds = loadConds(), spec = loadSpec()) {
  const out = [];
  for (let rep = 1; rep <= conds.runs; rep += 1) {
    for (const e of order.perRep.map(parseEntry)) {
      if (rep > plannedRepsFor(e.case, spec, conds)) continue;
      out.push({condition: e.condition, case: e.case, rep, name: trialName(e.condition, e.case, rep)});
    }
  }
  return out;
}

// Probes (#1817 rule 5, Medium-1): only before the first planned trial is reserved; only the probe cells; rep 1, and rep 2
// (the one re-run) only after rep 1 of that cell is reserved.
export function probeRefusal({condition, rep, reserved, order = loadOrder(), conds = loadConds(), spec = loadSpec()}) {
  if (!conds.probeCells.includes(condition)) return `probe refused: ${condition} is not a probe cell (${conds.probeCells.join(', ')})`;
  const started = plannedTrials(order, conds, spec).find((t) => reserved.has(t.name));
  if (started) return `probe refused: measurement has started (${started.name} is reserved)`;
  if (!['1', '2'].includes(String(rep))) return `probe refused: rep must be 1, or 2 for the one re-run (got ${rep})`;
  if (String(rep) === '2' && !reserved.has(trialName(condition, 'probe', 1))) return `probe refused: ${trialName(condition, 'probe', 2)} needs ${trialName(condition, 'probe', 1)} first`;
  return null;
}

// run-trial: may this trial start now, given the names already reserved in the ledger?
export function orderRefusal({condition, caseId, rep, reserved, settled = new Map(), runsRoot = null, spec = loadSpec(), order = loadOrder(), conds = loadConds()}) {
  if (caseId === 'probe') return probeRefusal({condition, rep, reserved, order, conds, spec});
  const planned = plannedTrials(order, conds, spec);
  const next = planned.find((t) => !reserved.has(t.name));
  const name = trialName(condition, caseId, rep);
  if (Number(rep) <= plannedRepsFor(caseId, spec, conds)) {
    return next && next.name === name ? null : `out of order: the next planned trial is ${next ? next.name : 'none (all planned trials are reserved)'}, not ${name}`;
  }
  if (next) return `replacement ${name} before every planned trial is reserved (next planned: ${next.name})`;
  if (!runsRoot) return `replacement ${name}: the replacement plan needs the runs root`;
  let plan;
  try { plan = replacementPlan({runsRoot, spec, order, conds, reserved, settled}); } catch (e) { return `replacement ${name} refused: ${e.message}`; }
  return plan[0]?.name === name ? null : `${name} is not the next required replacement (next: ${plan[0]?.name ?? 'none'})`;
}

// Failure of one raw trial directory, as score.mjs counts it. A settled trial whose files are missing or changed throws
// (tampered, never replaced); a reservation without a settlement is a failure (#1817 Medium-A, Low-1).
export function trialFailure(dir, spec, caseId, settlement = null, level = null) {
  if (!settlement) return 'not settled';
  const tampered = settledFilesProblem(dir, settlement);
  if (tampered) throw new Error(tampered);
  const trace = path.join(dir, 'trace.jsonl');
  if (!fs.existsSync(trace) || fs.statSync(trace).size === 0) return 'missing trace';
  if (!fs.existsSync(path.join(dir, 'meta.json'))) return 'no meta.json';
  const k = spec.cases.find((c) => c.id === caseId);
  try { return scoreRun(spec, k, parseTrace(fs.readFileSync(trace, 'utf8')), {level}).failure ?? null; } catch (e) { return `unreadable trace: ${e.message}`; }
}

// The replacement trials still to run, in execution order: for each planned cell/case, one per failed planned trial,
// with reps planned+1 .. planned+failures; only ledger reservations count as started (#1817 Low-B).
export function replacementPlan({runsRoot, spec = loadSpec(), order = loadOrder(), conds = loadConds(), reserved, settled = new Map()}) {
  const out = [];
  for (const e of order.perRep.map(parseEntry)) {
    const planned = plannedRepsFor(e.case, spec, conds);
    const level = conds.toolLevels[conds.cells[e.condition].tools];
    let failed = 0;
    for (let rep = 1; rep <= planned; rep += 1) {
      const name = trialName(e.condition, e.case, rep);
      if (!reserved.has(name)) continue;
      if (trialFailure(path.join(runsRoot, name), spec, e.case, settled.get(name) ?? null, level)) failed += 1;
    }
    for (let k = 1; k <= failed; k += 1) {
      const name = trialName(e.condition, e.case, planned + k);
      if (!reserved.has(name)) out.push({condition: e.condition, case: e.case, rep: planned + k, name});
    }
  }
  return out;
}

// #1817 review M-1: analysed only when complete (every planned trial and required replacement reserved) or stopped at the
// cap (ledger total + perTrialUsd > capUsd - safetyMarginUsd) with no probe reserved after the first planned trial.
export function completionStatus({runs: scored, reserved, reservations = null, spentUsd, budget, order = loadOrder(), conds = loadConds(), spec = loadSpec()}) {
  const plannedList = plannedTrials(order, conds, spec);
  const missingPlanned = plannedList.map((t) => t.name).filter((n) => !reserved.has(n));
  const failed = new Map();
  for (const r of scored) if (r.run <= plannedRepsFor(r.case, spec, conds) && r.failure) failed.set(`${r.condition}|${r.case}`, (failed.get(`${r.condition}|${r.case}`) ?? 0) + 1);
  const required = [...failed].flatMap(([key, k]) => { const [c, id] = key.split('|'); const p = plannedRepsFor(id, spec, conds); return Array.from({length: k}, (_, j) => trialName(c, id, p + j + 1)); });
  const missingReplacements = required.filter((n) => !reserved.has(n));
  const complete = missingPlanned.length === 0 && missingReplacements.length === 0;
  const stopLine = budget.capUsd - budget.safetyMarginUsd;
  const plannedNames = new Set(plannedList.map((t) => t.name));
  const firstPlannedSeq = reservations ? Math.min(...reservations.filter((e) => plannedNames.has(e.trial)).map((e) => e.seq)) : null;
  const lateProbes = reservations ? reservations.filter((e) => /-probe-\d+$/.test(e.trial) && e.seq > firstPlannedSeq).map((e) => e.trial) : null;
  const capReached = spentUsd + budget.perTrialUsd > stopLine && lateProbes !== null && lateProbes.length === 0;
  return {basis: complete ? 'complete' : capReached ? 'cap-reached' : null, complete, capReached, lateProbes,
    missingPlanned: missingPlanned.length, firstMissingPlanned: missingPlanned[0] ?? null, missingReplacements,
    spentUsd: Number(spentUsd.toFixed(4)), stopLineUsd: stopLine, perTrialUsd: budget.perTrialUsd};
}
