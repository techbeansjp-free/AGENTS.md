// Shared harness: execution order, mandatory replacements, completion and the probe gate. No model call.
// From docs/evidence/1820-write-tools-read/stage2/harness/order.mjs (#1817: reps outermost, caseOrder, conditionOrder;
// probes one per probe cell, rep 1 and the one re-run rep 2, only before the first planned trial; replacements runs+1,
// runs+2, ... after every planned trial; completionStatus = complete or cap-reached without a late probe; #1820:
// probeCompareProblems recomputes every compared probe from its records). Parameterised: the run order, cases and
// conditions come from the config directory; the kinds that must not be adjacent nor last are conditions.json
// nonAdjacentKinds (default negative and design).
import fs from 'node:fs';
import path from 'node:path';
import {parseTrace, scoreRun} from './score.mjs';
import {settledFilesProblem, reservations as ledgerReservations, settlements as ledgerSettlements} from './ledger.mjs';
import {loadConditions} from './apply-condition.mjs';
import {recheckProbe, compareProbes, checkValues, FACT_KEYS} from './probe-check.mjs';

import {REPO_ROOT, loadOrder as cfgOrder, loadSpec as cfgSpec} from './config.mjs';

const repoRoot = REPO_ROOT;
export const loadOrder = () => cfgOrder();
const loadSpec = () => cfgSpec();

export const trialName = (condition, caseId, rep) => `${condition}-${caseId}-${rep}`;

// Problems of an order against the cases and conditions: each case once, negatives and design cases neither adjacent to
// their own kind nor last, the conditions in the order of conditions.json.
export function orderProblems(order, spec, conds) {
  const p = [];
  const ids = spec.cases.map((c) => c.id);
  if (JSON.stringify([...order.caseOrder].sort()) !== JSON.stringify([...ids].sort())) p.push('caseOrder is not a permutation of the cases');
  const kind = (id) => spec.cases.find((c) => c.id === id)?.kind;
  for (const k of conds.nonAdjacentKinds ?? ['negative', 'design']) {
    const is = order.caseOrder.map((id) => kind(id) === k);
    if (is.at(-1)) p.push(`caseOrder ends with a ${k} case`);
    for (let i = 1; i < is.length; i += 1) if (is[i] && is[i - 1]) p.push(`${k} cases are adjacent at ${i}`);
  }
  if (JSON.stringify(order.conditionOrder) !== JSON.stringify(Object.keys(conds.cells))) p.push('conditionOrder is not the conditions of conditions.json');
  return p;
}

// The planned trials in execution order.
export function plannedTrials(order = loadOrder(), runs = loadConditions().runs) {
  const out = [];
  for (let rep = 1; rep <= runs; rep += 1) for (const caseId of order.caseOrder) for (const condition of order.conditionOrder) out.push({condition, case: caseId, rep, name: trialName(condition, caseId, rep)});
  return out;
}

// Probes (#1817 rule 5, Medium-1): only the probe cells; only before the first planned trial is reserved; rep 1, and rep 2
// (the one re-run) only after rep 1 of that condition is reserved.
// #1844 probe 1: conditions.json priorProbes lists the probes that ran under the ledger of budget.priorSpend (a re-fixation
// with a new ledger, run-trial.mjs priorProbeProblems); they count as reserved here, so the one re-run stays the only one.
export function probeRefusal({condition, rep, reserved, order = loadOrder(), conds = loadConditions()}) {
  if (!conds.probeCells.includes(condition)) return `probe refused: ${condition} is not a probe cell (${conds.probeCells.join(', ')})`;
  const started = plannedTrials(order, conds.runs).find((t) => reserved.has(t.name));
  if (started) return `probe refused: measurement has started (${started.name} is reserved)`;
  if (!['1', '2'].includes(String(rep))) return `probe refused: rep must be 1, or 2 for the one re-run (got ${rep})`;
  const prior = conds.priorProbes ?? [];
  if (prior.includes(trialName(condition, 'probe', rep))) return `probe refused: ${trialName(condition, 'probe', rep)} ran under the prior ledger (conditions.json priorProbes)`;
  const seen = (n) => reserved.has(n) || prior.includes(n);
  if (String(rep) === '2' && !seen(trialName(condition, 'probe', 1))) return `probe refused: ${trialName(condition, 'probe', 2)} needs ${trialName(condition, 'probe', 1)} first`;
  return null;
}

// run-trial: may this trial start now, given the names already reserved in the ledger?
export function orderRefusal({condition, caseId, rep, reserved, settled = new Map(), runsRoot = null, spec = loadSpec(), order = loadOrder(), conds = loadConditions()}) {
  if (caseId === 'probe') return probeRefusal({condition, rep, reserved, order, conds});
  const planned = plannedTrials(order, conds.runs);
  const next = planned.find((t) => !reserved.has(t.name));
  const name = trialName(condition, caseId, rep);
  if (Number(rep) <= conds.runs) {
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

// The replacement trials still to run, in execution order: per case and condition, one per failed planned trial, reps
// runs+1 .. runs+failures; only ledger reservations count as started (#1817 Low-B).
export function replacementPlan({runsRoot, spec = loadSpec(), order = loadOrder(), conds = loadConditions(), reserved, settled = new Map()}) {
  const out = [];
  for (const caseId of order.caseOrder) for (const condition of order.conditionOrder) {
    const level = conds.toolLevels[conds.cells[condition].tools];
    let failed = 0;
    for (let rep = 1; rep <= conds.runs; rep += 1) {
      const name = trialName(condition, caseId, rep);
      if (!reserved.has(name)) continue;
      if (trialFailure(path.join(runsRoot, name), spec, caseId, settled.get(name) ?? null, level)) failed += 1;
    }
    for (let k = 1; k <= failed; k += 1) {
      const name = trialName(condition, caseId, conds.runs + k);
      if (!reserved.has(name)) out.push({condition, case: caseId, rep: conds.runs + k, name});
    }
  }
  return out;
}

// #1817 review M-1: judged only when complete (every planned trial and required replacement reserved) or stopped at the
// cap (stage-2 ledger total + perTrialUsd > capUsd - safetyMarginUsd) with no probe reserved after the first planned trial.
export function completionStatus({runs: scored, reserved, reservations = null, spentUsd, budget, order = loadOrder(), conds = loadConditions()}) {
  const plannedList = plannedTrials(order, conds.runs);
  const missingPlanned = plannedList.map((t) => t.name).filter((n) => !reserved.has(n));
  const failed = new Map();
  for (const r of scored) if (r.run <= conds.runs && r.failure) failed.set(`${r.condition}|${r.case}`, (failed.get(`${r.condition}|${r.case}`) ?? 0) + 1);
  const required = [...failed].flatMap(([key, k]) => { const [c, id] = key.split('|'); return Array.from({length: k}, (_, j) => trialName(c, id, conds.runs + j + 1)); });
  const missingReplacements = required.filter((n) => !reserved.has(n));
  const complete = missingPlanned.length === 0 && missingReplacements.length === 0;
  const stopLine = Number((budget.capUsd - budget.safetyMarginUsd).toFixed(4));
  const plannedNames = new Set(plannedList.map((t) => t.name));
  const firstPlannedSeq = reservations ? Math.min(...reservations.filter((e) => plannedNames.has(e.trial)).map((e) => e.seq)) : null;
  const lateProbes = reservations ? reservations.filter((e) => /-probe-\d+$/.test(e.trial) && e.seq > firstPlannedSeq).map((e) => e.trial) : null;
  const capReached = spentUsd + budget.perTrialUsd > stopLine && lateProbes !== null && lateProbes.length === 0;
  return {basis: complete ? 'complete' : capReached ? 'cap-reached' : null, complete, capReached, lateProbes,
    missingPlanned: missingPlanned.length, firstMissingPlanned: missingPlanned[0] ?? null, missingReplacements,
    spentUsd: Number(spentUsd.toFixed(4)), stopLineUsd: stopLine, perTrialUsd: budget.perTrialUsd};
}

// Stage 1 review L2 / Low-2: probe-compare.json (probe-check.mjs compare --out) against the ledger. Every probe cell is
// covered; each compared probe is the latest probe reserved for its cell, settled, with the trace/meta sha256 of the
// settlement and of the files still in the runs root, recomputed from them, and passed; the comparison passed.
export function probeCompareProblems(c, {ledgerFile, runsRoot, conds = loadConditions()}) {
  if (!c || typeof c !== 'object') return ['probe-compare.json is not an object'];
  const p = [];
  const all = [...conds.probeCells].sort();
  if ((c.dropped ?? null) !== null) p.push('the probe comparison drops a level; the shared harness has no drop');
  if (c.pass !== true) p.push('the probe comparison did not pass');
  const probes = Array.isArray(c.probes) ? c.probes : [];
  if (JSON.stringify(probes.map((x) => x.condition).sort()) !== JSON.stringify(all)) p.push(`the probe comparison covers ${probes.map((x) => x.condition).join(',') || 'nothing'}, not ${all.join(',')}`);
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return [...p, 'the ledger is needed to check the probe comparison'];
  const res = ledgerReservations(ledgerFile), settled = ledgerSettlements(ledgerFile);
  const recomputed = [];
  for (const x of probes) {
    const m = new RegExp(`^${x.condition}-probe-(\\d+)$`).exec(String(x.trial ?? ''));
    if (!m) { p.push(`${x.condition}: compared trial ${x.trial} is not a probe of the cell`); continue; }
    const reps = res.filter((e) => new RegExp(`^${x.condition}-probe-\\d+$`).test(e.trial)).map((e) => Number(e.trial.split('-').at(-1)));
    if (!reps.length || Number(m[1]) !== Math.max(...reps)) p.push(`${x.trial} is not the latest probe of ${x.condition} in the ledger`);
    const s = settled.get(x.trial);
    if (!s) p.push(`${x.trial} is not settled in the ledger`);
    else if (s.traceSha256 !== x.traceSha256 || s.metaSha256 !== x.metaSha256) p.push(`${x.trial}: the compared result is not bound to the ledger settlement (trace/meta sha256)`);
    else if (runsRoot) {
      const f = settledFilesProblem(path.join(runsRoot, x.trial), s);
      if (f) p.push(f);
      else p.push(...recheckProblems(x, runsRoot, recomputed, conds));
    }
    if (x.pass !== true) p.push(`${x.condition} probe did not pass`);
  }
  if (!runsRoot) p.push('the runs root is needed to recompute the probe results');
  else if (recomputed.length === probes.length && probes.length) {
    let again;
    try { again = compareProbes(recomputed, {conds}); } catch (e) { return [...p, `the probe comparison cannot be recomputed: ${e.message}`]; }
    if (again.pass !== true) p.push('the probe comparison recomputed from the probe records does not pass');
    if (again.pass !== c.pass || JSON.stringify(again.differ) !== JSON.stringify(c.differ ?? [])) p.push('the recorded probe comparison differs from the one recomputed from the probe records');
  }
  return p;
}

function recheckProblems(x, runsRoot, into, conds) {
  let r;
  try { r = recheckProbe(path.join(runsRoot, x.trial), x.condition, x, {repoRoot, conds}); } catch (e) { return [`${x.trial}: the probe result cannot be recomputed from the runs root (${e.message})`]; }
  const p = [];
  const got = checkValues(r.checks), had = x.checks && typeof x.checks === 'object' ? checkValues(Object.fromEntries(Object.entries(x.checks).map(([k, v]) => [k, {pass: v}]))) : {};
  const keys = [...new Set([...Object.keys(got), ...Object.keys(had)])].filter((k) => got[k] !== had[k]).sort();
  if (keys.length) p.push(`${x.trial}: the recorded checks differ from those recomputed from its trace and meta (${keys.join(', ')})`);
  if (r.pass !== x.pass) p.push(`${x.trial}: the recorded pass ${x.pass} differs from the recomputed ${r.pass}`);
  const facts = FACT_KEYS.filter((k) => JSON.stringify(x[k] ?? null) !== JSON.stringify(r[k] ?? null));
  if (facts.length) p.push(`${x.trial}: the recorded session facts differ from the recomputed ones (${facts.join(', ')})`);
  if (!p.length) into.push(r);
  return p;
}
