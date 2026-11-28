// Shared harness: append-only fixation of the plan before model runs, from
// docs/evidence/1820-write-tools-read/stage2/harness/fixation.mjs. <config>/results/fixation.json = {records: [...]}.
// FIXED is the config's plan files (config/<file>, config.mjs CONFIG_FIXED) and the shared harness modules
// (harness/<file>); both are hashed, so a change of the shared harness after the fixation is caught like a change of the
// config. init takes a NEW ledger (created when absent, or an existing one without reservations) and records its id, and
// is refused while release.json still holds a placeholder (make-fixture.mjs releasePlaceholders); refix is only a
// pre-measurement correction of harness/probe-check.mjs after a probe; check compares with the last record.
// run-trial.mjs refuses a paid run when check fails, when results/fixation.json is not committed and clean, when the first
// record's commit is not named in the config's README.md, or when a refix record is later than the first measurement
// reservation. No model call.
// Usage: node fixation.mjs init <fixation.json> --ledger <ledger> --config <dir> | check <fixation.json> --config <dir>
//        node fixation.mjs refix <fixation.json> --ledger <ledger> --reason <text> --review <ref> --config <dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as ledgerOps from './ledger.mjs';
import {HARNESS_DIR, CONFIG_FIXED, configFixed, configDir, loadConditions} from './config.mjs';
import {releasePlaceholders} from './make-fixture.mjs';

export const HARNESS_MODULES = ['apply-condition', 'collect', 'condition-i', 'config', 'fixation', 'guard', 'install-asc', 'judge', 'ledger', 'make-fixture', 'markers', 'order', 'probe-check', 'run-all', 'run-trial', 'score'];
export const FIXED = [...CONFIG_FIXED.map((f) => `config/${f}`), ...HARNESS_MODULES.map((n) => `harness/${n}.mjs`)];
// The fixed files of one config: FIXED with the config's fixedExtra (#1867; config.mjs configFixed) as config/<path>.
export const fixedOf = (root = configDir()) => [...configFixed(root).map((f) => `config/${f}`), ...HARNESS_MODULES.map((n) => `harness/${n}.mjs`)];
// The only fixed file a pre-measurement correction may change.
export const REFIX_ALLOWED = ['harness/probe-check.mjs'];

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// A FIXED name to its file: config/<f> in the config directory, harness/<f> in the shared harness directory.
export const fixedFile = (f, root = configDir()) => (f.startsWith('config/') ? path.join(root, f.slice(7)) : path.join(HARNESS_DIR, f.slice(8)));
const read = (f, root) => fs.readFileSync(fixedFile(f, root));
export const digests = (root = configDir()) => Object.fromEntries(fixedOf(root).map((f) => [f, sha(read(f, root))]));
export function differences(record, root = configDir()) {
  const now = digests(root);
  return fixedOf(root).filter((f) => record.files?.[f] !== now[f]);
}

export function refixViolations(base, ledgerFile, root = configDir()) {
  const v = [];
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return ['the ledger file does not exist'];
  if (ledgerOps.ledgerId(ledgerFile) !== base.ledgerId) v.push('the ledger is not the one recorded at init');
  const res = ledgerOps.reservations(ledgerFile);
  if (!res.some((e) => ledgerOps.isProbe(e.trial))) v.push('the ledger has no probe reservation');
  const started = res.filter((e) => !ledgerOps.isProbe(e.trial)).map((e) => e.trial);
  if (started.length) v.push(`measurement trials exist in the ledger (${started.slice(0, 3).join(', ')})`);
  const now = digests(root);
  for (const f of fixedOf(root)) if (base.files[f] !== now[f] && !REFIX_ALLOWED.includes(f)) v.push(`${f} changed (refix may change only ${REFIX_ALLOWED.join(', ')})`);
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
  const root = configDir();
  const git = (a) => spawnSync('git', a, {cwd: root, encoding: 'utf8'}).stdout.trim();
  const conds = loadConditions();
  const stageName = `#${conds.issue} ${conds.stage ?? 'measurement'}`;
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  const record = (stage, extra = {}) => {
    const dirty = git(['status', '--porcelain', '--', ...fixedOf(root).map((f) => fixedFile(f, root))]);
    if (dirty) fail(`fixed files have uncommitted changes:\n${dirty}`);
    return {stage, fixedAtCommit: git(['rev-parse', 'HEAD']), at: new Date().toISOString(), files: digests(root), ...extra};
  };
  const save = (fx) => fs.writeFileSync(file, JSON.stringify(fx, null, 1) + '\n');
  if (action === 'init') {
    if (fs.existsSync(file)) fail(`${file} exists; records are append-only`);
    const ledgerFile = opt('--ledger');
    if (!ledgerFile) fail('init needs --ledger (outside the repository)');
    const ph = releasePlaceholders();
    if (ph.length) fail(`release.json pins no tarball for ${ph.join(', ')}; fill it in before the fixation`);
    const lf = path.resolve(ledgerFile);
    if (!fs.existsSync(lf)) ledgerOps.create(lf);
    if (!ledgerOps.ledgerId(lf)) fail('the ledger has no ledgerId line');
    if (ledgerOps.reservations(lf).length) fail('the ledger already holds reservations; init is pre-measurement only');
    const r = record(stageName, {ledgerId: ledgerOps.ledgerId(lf)});
    save({schema: `asc-${conds.issue}-fixation/v1`, note: 'Append-only. run-trial.mjs --run checks the last record. See fixation.mjs for refix.', records: [r]});
    console.log(JSON.stringify({stage: r.stage, fixedAtCommit: r.fixedAtCommit, files: fixedOf(root).length, ledgerId: r.ledgerId}));
  } else if (action === 'refix') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ledgerFile = opt('--ledger'), reason = opt('--reason'), review = opt('--review');
    if (!ledgerFile || !reason || !review) fail('refix needs --ledger, --reason and --review');
    const base = baseRecord(fx);
    const v = refixViolations(base, path.resolve(ledgerFile), root);
    if (v.length) fail(`${v.join('; ')}; refix is only a pre-measurement correction of probe-check.mjs`);
    fx.records.push(record(stageName, {ledgerId: base.ledgerId, refix: {reason, review, changed: differences(base, root)}}));
    save(fx);
    console.log(JSON.stringify({stage: `${stageName} (refix)`, records: fx.records.length}));
  } else if (action === 'check') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diff = differences(lastRecord(fx), root);
    console.log(JSON.stringify({ok: diff.length === 0, stage: lastRecord(fx).stage, records: fx.records.length, firstFixedAtCommit: fx.records[0].fixedAtCommit, fixedAtCommit: lastRecord(fx).fixedAtCommit, differs: diff}));
    process.exit(diff.length ? 1 : 0);
  } else {
    console.error('usage: node fixation.mjs init|check <fixation.json> [--ledger <l>] | refix <f> --ledger <l> --reason <t> --review <r>');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
