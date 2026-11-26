// #1820: copied from docs/evidence/1817-skill-application/harness/run-all.mjs; the fixtures are A and D (each cell runs on
// its fixture), the gate variable is ASC1820_ALLOW_PAID (checked by run-trial.mjs), and the plan is the 60 trials of
// run-order.json perRep.
// #1817 runner (review M1, L1): runs the measurement only in the order of run-order.json, one trial at a time, through
// run-trial.mjs (which keeps every gate: ASC1817_ALLOW_PAID, credential, fixation, ledger, cap, pairing, order).
//   planned        the 112 planned trials (reps outermost, caseOrder with negatives interleaved, B then S); trials already
//                  reserved in the ledger are skipped, so a stopped run resumes at the next one.
//   replacements   after every planned trial: one replacement per failed planned trial (rep runs+1, runs+2, ...), in the
//                  same order; a failed replacement is not replaced again (order.mjs replacementPlan).
// Without --run it prints the trials it would start and starts nothing. It stops at the first trial run-trial refuses
// (exit != 0), e.g. the cap. The probes (one per condition) are run before this, by hand (README).
// Usage: node run-all.mjs planned|replacements <runs-root> --fixture-A <dir> --fixture-D <dir> --ledger <file> [--run]
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as ledgerOps from './ledger.mjs';
import {plannedTrials, replacementPlan, orderProblems, loadOrder} from './order.mjs';
import {loadConditions} from './apply-condition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');

export function trialsToStart(mode, {runsRoot, ledger, spec}) {
  const reserved = fs.existsSync(ledger) ? ledgerOps.reservedNames(ledger) : new Set();
  const settled = fs.existsSync(ledger) ? ledgerOps.settlements(ledger) : new Map();
  if (fs.existsSync(ledger) && ledgerOps.ledgerProblems(ledger).length) throw new Error(`the ledger was edited by hand: ${ledgerOps.ledgerProblems(ledger).join('; ')}`);
  if (mode === 'planned') return plannedTrials().filter((t) => !reserved.has(t.name));
  if (mode === 'replacements') {
    const left = plannedTrials().filter((t) => !reserved.has(t.name));
    if (left.length) throw new Error(`replacements start after every planned trial; next planned: ${left[0].name}`);
    return replacementPlan({runsRoot, spec, reserved, settled}); // review Low-B: ledger reservations only
  }
  throw new Error('mode is planned or replacements');
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const [mode, runsRootArg] = args;
  const fixtures = {A: opt('--fixture-A'), D: opt('--fixture-D')};
  const ledger = opt('--ledger');
  if (!mode || !runsRootArg || !fixtures.A || !fixtures.D || !ledger) {
    console.error('usage: node run-all.mjs planned|replacements <runs-root> --fixture-A <dir> --fixture-D <dir> --ledger <file> [--run]');
    process.exit(2);
  }
  const spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'));
  const conds = loadConditions();
  const problems = orderProblems(loadOrder(), spec, conds);
  if (problems.length) { console.error(`refused: ${problems.join('; ')}`); process.exit(3); }
  const runsRoot = path.resolve(runsRootArg);
  const todo = trialsToStart(mode, {runsRoot, ledger: path.resolve(ledger), spec});
  if (!args.includes('--run')) { console.log(JSON.stringify({dryRun: true, mode, trials: todo.map((t) => t.name)})); return; }
  for (const t of todo) {
    const r = spawnSync(process.execPath, [path.join(here, 'run-trial.mjs'), runsRoot, t.condition, t.case, String(t.rep), '--fixture', path.resolve(fixtures[conds.cells[t.condition].fixture]), '--ledger', path.resolve(ledger), '--run'], {stdio: 'inherit'});
    if (r.status !== 0) { console.error(`stopped at ${t.name} (exit ${r.status})`); process.exit(r.status ?? 1); }
  }
  console.log(JSON.stringify({done: mode, trials: todo.length}));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
