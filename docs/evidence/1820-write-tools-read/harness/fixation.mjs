// #1820: copied from docs/evidence/1817-skill-application/harness/fixation.mjs. Changes: the schema name, FIXED (the #1820
// plan files and harness), and the stage-3 action, its condition-I schema and module-shape checks are removed (#1820
// stage 1 has no stage 3; stage 2 is fixed separately). init, refix and check are unchanged.
// Append-only fixation of the plan before model runs. results/fixation.json = {records: [...]}.
//   init     first record (refused when the file exists). Takes --ledger: creates the ledger when absent (or accepts an
//            existing one with no reservation) and records its ledgerId; run-trial refuses any other ledger.
//   refix    pre-measurement correction of probe-check.mjs after an isolation probe: appends a new record only when the
//            recorded ledger holds at least one probe reservation and no planned trial, only with --reason and --review.
//            Only harness/probe-check.mjs may differ from the base record. run-trial also refuses when a refix record is
//            later than the first measurement reservation.
//   drop-level  (review L1, pre-written) appends a record {dropLevel} that leaves a tools level out of the plan
//            (apply-condition.mjs loadConditions). Only a level in conditions.json droppableLevels (X), only with --reason,
//            --review and --runs-root, only when the ledger holds no planned trial, the level's probe cell has a settled
//            probe rep 2 (the one re-run was used), no fixed file changed, and <runs-root>/probe-compare.json was written
//            by probe-check.mjs compare --drop <level> and is bound to the ledger (order.mjs probeCompareProblems: the
//            kept probes passed, the dropped probe failed). Any other change of the plan needs the owner.
//   check    compares the current files with the last record.
// run-trial.mjs refuses a paid run when check fails, when results/fixation.json is not committed and clean, or when the
// first record's commit is not named in README.md. No model call.
// Usage: node fixation.mjs init <fixation.json> --ledger <ledger> | check <fixation.json>
//        node fixation.mjs refix <fixation.json> --ledger <ledger> --reason <text> --review <ref>
//        node fixation.mjs drop-level <fixation.json> X --ledger <ledger> --runs-root <dir> --reason <text> --review <ref>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as ledgerOps from './ledger.mjs';
import {applyDrop, loadRawConditions} from './apply-condition.mjs';
import {probeCompareProblems} from './order.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED = ['analysis-plan.md', 'cases.json', 'conditions.json', 'release.json', 'run-order.json',
  ...['analyze', 'apply-condition', 'collect', 'condition-i', 'fixation', 'guard', 'install-asc', 'ledger', 'make-fixture', 'markers', 'order', 'probe-check', 'run-all', 'run-trial', 'score'].map((n) => `harness/${n}.mjs`)];
// The only fixed file a pre-measurement correction may change.
export const REFIX_ALLOWED = ['harness/probe-check.mjs'];

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (f, root = ev) => fs.readFileSync(path.join(root, f));
export const digests = (root = ev) => Object.fromEntries(FIXED.map((f) => [f, sha(read(f, root))]));
export function differences(record, root = ev) {
  const now = digests(root);
  return FIXED.filter((f) => record.files?.[f] !== now[f]);
}

export function refixViolations(base, ledgerFile, root = ev) {
  const v = [];
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return ['the ledger file does not exist'];
  if (ledgerOps.ledgerId(ledgerFile) !== base.ledgerId) v.push('the ledger is not the one recorded at init');
  const res = ledgerOps.reservations(ledgerFile);
  if (!res.some((e) => ledgerOps.isProbe(e.trial))) v.push('the ledger has no probe reservation');
  const started = res.filter((e) => !ledgerOps.isProbe(e.trial)).map((e) => e.trial);
  if (started.length) v.push(`measurement trials exist in the ledger (${started.slice(0, 3).join(', ')})`);
  const now = digests(root);
  for (const f of FIXED) if (base.files[f] !== now[f] && !REFIX_ALLOWED.includes(f)) v.push(`${f} changed (refix may change only ${REFIX_ALLOWED.join(', ')})`);
  return v;
}

export const lastRecord = (fx) => fx.records.at(-1);
export const baseRecord = (fx) => fx.records.at(-1);

// run-trial: a refix or drop record must be older than the first measurement reservation of the ledger.
export function refixAfterMeasurement(fx, ledgerFile) {
  const first = ledgerOps.reservations(ledgerFile).find((e) => !ledgerOps.isProbe(e.trial));
  return first ? fx.records.filter((r) => (r.refix || r.dropLevel) && r.at > first.at).map((r) => r.at) : [];
}

// Review L1: may the tools level be dropped now? (see drop-level above)
export function dropViolations(fx, ledgerFile, level, {runsRoot, conds = loadRawConditions(), root = ev}) {
  const v = [];
  const base = baseRecord(fx);
  if (!(conds.droppableLevels ?? []).includes(level)) return [`tools level ${level} may not be dropped (droppableLevels: ${(conds.droppableLevels ?? []).join(',') || 'none'})`];
  if (fx.records.some((r) => r.dropLevel)) v.push('a tools level is already dropped');
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return [...v, 'the ledger file does not exist'];
  if (ledgerOps.ledgerId(ledgerFile) !== fx.records[0].ledgerId) v.push('the ledger is not the one recorded at init');
  const res = ledgerOps.reservations(ledgerFile);
  const started = res.filter((e) => !ledgerOps.isProbe(e.trial)).map((e) => e.trial);
  if (started.length) v.push(`measurement trials exist in the ledger (${started.slice(0, 3).join(', ')})`);
  const diff = differences(base, root);
  if (diff.length) v.push(`fixed files changed (${diff.join(', ')}); a drop changes no file`);
  const cell = conds.probeCells.find((c) => conds.cells[c].tools === level);
  if (!ledgerOps.settlements(ledgerFile).has(`${cell}-probe-2`)) v.push(`${cell}-probe-2 is not settled (the drop needs the one re-run of the failed probe)`);
  const f = runsRoot ? path.join(runsRoot, 'probe-compare.json') : null;
  if (!f || !fs.existsSync(f)) return [...v, 'probe-compare.json (probe-check.mjs compare --drop) is missing in the runs root'];
  let c;
  try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return [...v, 'probe-compare.json is not JSON']; }
  v.push(...probeCompareProblems(c, {ledgerFile, runsRoot, conds: applyDrop(conds, level)}));
  return v;
}

function main() {
  const argv = process.argv.slice(2);
  const [action, file] = argv;
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const git = (a) => spawnSync('git', a, {cwd: ev, encoding: 'utf8'}).stdout.trim();
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  const record = (stage, extra = {}) => {
    const dirty = git(['status', '--porcelain', '--', ...FIXED]);
    if (dirty) fail(`fixed files have uncommitted changes:\n${dirty}`);
    return {stage, fixedAtCommit: git(['rev-parse', 'HEAD']), at: new Date().toISOString(), files: digests(), ...extra};
  };
  const save = (fx) => fs.writeFileSync(file, JSON.stringify(fx, null, 1) + '\n');
  if (action === 'init') {
    if (fs.existsSync(file)) fail(`${file} exists; records are append-only`);
    const ledgerFile = opt('--ledger');
    if (!ledgerFile) fail('init needs --ledger (outside the repository)');
    const lf = path.resolve(ledgerFile);
    if (!fs.existsSync(lf)) ledgerOps.create(lf);
    if (!ledgerOps.ledgerId(lf)) fail('the ledger has no ledgerId line');
    if (ledgerOps.reservations(lf).length) fail('the ledger already holds reservations; init is pre-measurement only');
    const r = record('stage 1', {ledgerId: ledgerOps.ledgerId(lf)});
    save({schema: 'asc-1820-fixation/v1', note: 'Append-only. run-trial.mjs --run checks the last record. See fixation.mjs for refix.', records: [r]});
    console.log(JSON.stringify({stage: r.stage, fixedAtCommit: r.fixedAtCommit, files: FIXED.length, ledgerId: r.ledgerId}));
  } else if (action === 'refix') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ledgerFile = opt('--ledger'), reason = opt('--reason'), review = opt('--review');
    if (!ledgerFile || !reason || !review) fail('refix needs --ledger, --reason and --review');
    const base = baseRecord(fx);
    const v = refixViolations(base, path.resolve(ledgerFile));
    if (v.length) fail(`${v.join('; ')}; refix is only a pre-measurement correction of probe-check.mjs`);
    fx.records.push(record('stage 1', {ledgerId: base.ledgerId, refix: {reason, review, changed: differences(base)}}));
    save(fx);
    console.log(JSON.stringify({stage: 'stage 1 (refix)', records: fx.records.length}));
  } else if (action === 'drop-level') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const level = argv[2];
    const ledgerFile = opt('--ledger'), reason = opt('--reason'), review = opt('--review'), runsRoot = opt('--runs-root');
    if (!level || !ledgerFile || !reason || !review || !runsRoot) fail('drop-level needs <level>, --ledger, --runs-root, --reason and --review');
    const v = dropViolations(fx, path.resolve(ledgerFile), level, {runsRoot: path.resolve(runsRoot)});
    if (v.length) fail(`${v.join('; ')}; drop-level is only the pre-written drop of conditions.json dropNote`);
    fx.records.push(record('stage 1', {ledgerId: fx.records[0].ledgerId, dropLevel: level, drop: {reason, review}}));
    save(fx);
    console.log(JSON.stringify({stage: 'stage 1 (drop)', dropLevel: level, records: fx.records.length}));
  } else if (action === 'check') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diff = differences(lastRecord(fx));
    console.log(JSON.stringify({ok: diff.length === 0, stage: lastRecord(fx).stage, records: fx.records.length, firstFixedAtCommit: fx.records[0].fixedAtCommit, fixedAtCommit: lastRecord(fx).fixedAtCommit, differs: diff}));
    process.exit(diff.length ? 1 : 0);
  } else {
    console.error('usage: node fixation.mjs init|check <fixation.json> [--ledger <l>] | refix <f> --ledger <l> --reason <t> --review <r> | drop-level <f> X --ledger <l> --runs-root <d> --reason <t> --review <r>');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
