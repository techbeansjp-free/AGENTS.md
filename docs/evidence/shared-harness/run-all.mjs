// Shared harness: runs the planned trials of the config's run-order.json in order, then the mandatory replacements. From
// docs/evidence/1820-write-tools-read/stage2/harness/run-all.mjs. The fixtures are one per condition and fixture id, found
// under --fixtures <root> as fixture-<condition>-<fixture> (dry-run.mjs and the config README build them there); the
// paid-run variable is ASC_EVAL_ALLOW_PAID (checked by run-trial.mjs); the config directory is passed to run-trial.mjs
// through ASC_EVAL_CONFIG.
//   planned        the planned trials in order; trials already reserved in the ledger are skipped, so a stopped run
//                  resumes at the next one.
//   replacements   after every planned trial: one replacement per failed planned trial (rep runs+1, runs+2, ...), in the
//                  same order; a failed replacement is not replaced again (order.mjs replacementPlan).
// Without --run it prints the trials it would start and starts nothing. It stops at the first trial run-trial refuses
// (exit != 0), e.g. the cap. The probes (one per condition) are run before this, by hand (README).
// Usage: node run-all.mjs planned|replacements <runs-root> --fixtures <dir> --ledger <file> [--run] --config <dir>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as ledgerOps from './ledger.mjs';
import {plannedTrials, replacementPlan, orderProblems, loadOrder} from './order.mjs';
import {loadConditions} from './apply-condition.mjs';
import {HARNESS_DIR, configDir, loadSpec} from './config.mjs';

const here = HARNESS_DIR;

export const fixtureDir = (root, condition, fixtureId) => path.join(root, `fixture-${condition}-${fixtureId}`);

export function trialsToStart(mode, {runsRoot, ledger, spec}) {
  const reserved = fs.existsSync(ledger) ? ledgerOps.reservedNames(ledger) : new Set();
  const settled = fs.existsSync(ledger) ? ledgerOps.settlements(ledger) : new Map();
  if (fs.existsSync(ledger) && ledgerOps.ledgerProblems(ledger).length) throw new Error(`the ledger was edited by hand: ${ledgerOps.ledgerProblems(ledger).join('; ')}`);
  if (mode === 'planned') return plannedTrials().filter((t) => !reserved.has(t.name));
  if (mode === 'replacements') {
    const left = plannedTrials().filter((t) => !reserved.has(t.name));
    if (left.length) throw new Error(`replacements start after every planned trial; next planned: ${left[0].name}`);
    return replacementPlan({runsRoot, spec, reserved, settled});
  }
  throw new Error('mode is planned or replacements');
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const [mode, runsRootArg] = args;
  const fixtures = opt('--fixtures'), ledger = opt('--ledger');
  if (!mode || !runsRootArg || !fixtures || !ledger) {
    console.error('usage: node run-all.mjs planned|replacements <runs-root> --fixtures <dir> --ledger <file> [--run] --config <dir>');
    process.exit(2);
  }
  const spec = loadSpec();
  const conds = loadConditions();
  const problems = orderProblems(loadOrder(), spec, conds);
  if (problems.length) { console.error(`refused: ${problems.join('; ')}`); process.exit(3); }
  const runsRoot = path.resolve(runsRootArg);
  const todo = trialsToStart(mode, {runsRoot, ledger: path.resolve(ledger), spec});
  if (!args.includes('--run')) { console.log(JSON.stringify({dryRun: true, mode, trials: todo.map((t) => t.name)})); return; }
  for (const t of todo) {
    const k = spec.cases.find((c) => c.id === t.case);
    const r = spawnSync(process.execPath, [path.join(here, 'run-trial.mjs'), runsRoot, t.condition, t.case, String(t.rep), '--fixture', fixtureDir(path.resolve(fixtures), t.condition, k.fixture ?? 'A'), '--ledger', path.resolve(ledger), '--run'], {stdio: 'inherit', env: {...process.env, ASC_EVAL_CONFIG: configDir()}});
    if (r.status !== 0) { console.error(`stopped at ${t.name} (exit ${r.status})`); process.exit(r.status ?? 1); }
  }
  console.log(JSON.stringify({done: mode, trials: todo.length}));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
