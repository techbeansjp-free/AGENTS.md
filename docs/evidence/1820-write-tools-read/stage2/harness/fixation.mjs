// #1820 stage 2: copied from ../../harness/fixation.mjs (stage 1). Changes: the schema and stage names, FIXED (the stage-2
// plan files and harness), and the drop-level action is removed (stage 2 has one tools level). init, refix and check are
// unchanged: init takes a NEW ledger (created when absent, or an existing one without reservations) and records its id;
// refix is only a pre-measurement correction of harness/probe-check.mjs after a probe; check compares with the last record.
// Append-only fixation of the plan before model runs. results/fixation.json = {records: [...]}.
// run-trial.mjs refuses a paid run when check fails, when results/fixation.json is not committed and clean, when the first
// record's commit is not named in README.md, or when a refix record is later than the first measurement reservation.
// No model call.
// Usage: node fixation.mjs init <fixation.json> --ledger <ledger> | check <fixation.json>
//        node fixation.mjs refix <fixation.json> --ledger <ledger> --reason <text> --review <ref>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as ledgerOps from './ledger.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED = ['decision-criteria.md', 'cases.json', 'conditions.json', 'release.json', 'run-order.json',
  ...['apply-condition', 'collect', 'condition-i', 'fixation', 'guard', 'install-asc', 'judge', 'ledger', 'make-fixture', 'markers', 'order', 'probe-check', 'run-all', 'run-trial', 'score'].map((n) => `harness/${n}.mjs`)];
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

// run-trial: a refix record must be older than the first measurement reservation of the ledger.
export function refixAfterMeasurement(fx, ledgerFile) {
  const first = ledgerOps.reservations(ledgerFile).find((e) => !ledgerOps.isProbe(e.trial));
  return first ? fx.records.filter((r) => r.refix && r.at > first.at).map((r) => r.at) : [];
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
    const r = record('stage 2', {ledgerId: ledgerOps.ledgerId(lf)});
    save({schema: 'asc-1820s2-fixation/v1', note: 'Append-only. run-trial.mjs --run checks the last record. See fixation.mjs for refix.', records: [r]});
    console.log(JSON.stringify({stage: r.stage, fixedAtCommit: r.fixedAtCommit, files: FIXED.length, ledgerId: r.ledgerId}));
  } else if (action === 'refix') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ledgerFile = opt('--ledger'), reason = opt('--reason'), review = opt('--review');
    if (!ledgerFile || !reason || !review) fail('refix needs --ledger, --reason and --review');
    const base = baseRecord(fx);
    const v = refixViolations(base, path.resolve(ledgerFile));
    if (v.length) fail(`${v.join('; ')}; refix is only a pre-measurement correction of probe-check.mjs`);
    fx.records.push(record('stage 2', {ledgerId: base.ledgerId, refix: {reason, review, changed: differences(base)}}));
    save(fx);
    console.log(JSON.stringify({stage: 'stage 2 (refix)', records: fx.records.length}));
  } else if (action === 'check') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diff = differences(lastRecord(fx));
    console.log(JSON.stringify({ok: diff.length === 0, stage: lastRecord(fx).stage, records: fx.records.length, firstFixedAtCommit: fx.records[0].fixedAtCommit, fixedAtCommit: lastRecord(fx).fixedAtCommit, differs: diff}));
    process.exit(diff.length ? 1 : 0);
  } else {
    console.error('usage: node fixation.mjs init|check <fixation.json> [--ledger <l>] | refix <f> --ledger <l> --reason <t> --review <r>');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
