// #1815 runner: runs the measurement only in the order of run-order.json, one trial at a time, through run-trial.mjs
// (which keeps every gate: ASC1815_ALLOW_PAID, credential, fixation, ledger, cap, images, pairing, probes, order).
//   planned       the planned trials (reps outermost, caseOrder, B/S alternating by rep); trials already reserved in
//                 the ledger are skipped, so a stopped run resumes at the next one.
//   replacements  after every planned trial: the required replacements (order.mjs replacementPlan: the k-th generation
//                 failure of a condition/case is replaced by rep runs+k; a replacement is never replaced).
// The probes (one per condition) are run before this, by hand, after the owner's confirmation (README).
// Without --run it prints the trials it would start and starts nothing. It stops at the first trial run-trial refuses
// or that exits non-zero (e.g. the cap).
// Usage: node run-all.mjs planned|replacements <runs-root> --tarball-B <tgz> --tarball-S <tgz> --ledger <file> [--run]
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {plannedTrials, replacementPlan, orderProblems, loadOrder} from './order.mjs';
import {loadJson} from './pairing.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function trialsToStart(mode, {runsRoot, ledger}) {
  const reserved = fs.existsSync(ledger) ? ledgerOps.reservedNames(ledger) : new Set();
  const left = plannedTrials().filter((t) => !reserved.has(t.name));
  if (mode === 'planned') return left;
  if (mode === 'replacements') {
    if (left.length) throw new Error(`replacements start after every planned trial; next planned: ${left[0].name}`);
    return replacementPlan({runsRoot}).filter((t) => !reserved.has(t.name));
  }
  throw new Error('mode is planned or replacements');
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const [mode, runsRootArg] = args;
  const tarballs = {B: opt('--tarball-B'), S: opt('--tarball-S')};
  const ledger = opt('--ledger');
  if (!mode || !runsRootArg || !tarballs.B || !tarballs.S || !ledger) {
    console.error('usage: node run-all.mjs planned|replacements <runs-root> --tarball-B <tgz> --tarball-S <tgz> --ledger <file> [--run]');
    process.exit(2);
  }
  const problems = orderProblems(loadOrder(), loadJson('cases.json').cases, loadJson('conditions.json'));
  if (problems.length) { console.error(`refused: ${problems.join('; ')}`); process.exit(3); }
  const runsRoot = path.resolve(runsRootArg);
  let todo;
  try { todo = trialsToStart(mode, {runsRoot, ledger: path.resolve(ledger)}); } catch (e) { console.error(`refused: ${e.message}`); process.exit(3); }
  if (!args.includes('--run')) { console.log(JSON.stringify({dryRun: true, mode, trials: todo.map((t) => t.name)})); return; }
  for (const t of todo) {
    const r = spawnSync(process.execPath, [path.join(here, 'run-trial.mjs'), runsRoot, t.case, t.condition, String(t.rep), '--tarball', path.resolve(tarballs[t.condition]), '--ledger', path.resolve(ledger), '--run'], {stdio: 'inherit'});
    if (r.status !== 0) { console.error(`stopped at ${t.name} (exit ${r.status})`); process.exit(r.status ?? 1); }
  }
  console.log(JSON.stringify({done: mode, trials: todo.length}));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
