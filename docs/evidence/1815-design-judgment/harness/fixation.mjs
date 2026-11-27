// Append-only fixation of the #1815 plan before any model run (approach of #1814 harness/fixation.mjs).
// results/fixation.json = {records: [...]}; each record has the commit (HEAD), the time, the ledger id and the sha256 of
// every fixed file: this directory's definitions, criteria and harness, and the #1807/#1814 files the harness imports or
// mounts (cases, gold, prompt, MCP server, proxy, allowlist, render/gold check, install, guard, ledger).
//   init   first record (refused when the file exists). Takes --ledger: creates the ledger when absent (or accepts an
//          existing one without reservations) and records its ledgerId; run-trial and budget refuse any other ledger.
//   refix  a correction before measurement, only with --reason and --review. Every fixed file may change while the recorded ledger
//          holds no reservation; only harness/probe.mjs after the isolation probes; nothing after a planned trial.
//   check  compares the current files with the last record.
// run-trial.mjs --run and budget.mjs refuse when check fails, when results/fixation.json is not committed and clean,
// when a record's commit is not in HEAD's history, or when README.md does not name the first record's commit.
// Usage: node fixation.mjs init <fixation.json> --ledger <ledger> | check <fixation.json>
//        node fixation.mjs refix <fixation.json> --ledger <ledger> --reason <text> --review <ref>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as ledgerOps from '../../1814-skill-invocation/harness/ledger.mjs';
import {RESULTS} from './results-dir.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWN = ['cases.json', 'conditions.json', 'release.json', 'run-order.json', 'decision-criteria.md', 'harness/rank-prompt.txt',
  ...['budget', 'clock', 'collect', 'decide', 'first-view', 'fixation', 'make-blind', 'make-sample', 'order', 'pairing', 'probe', 'rank-guard', 'reads', 'results-dir', 'run-all', 'run-indicators', 'run-trial'].map((n) => `harness/${n}.mjs`)];
const E1807 = ['harness/core-steps.mjs', 'harness/gold-check.mjs', 'harness/render.mjs', 'harness/run-render.mjs', 'gold.json',
  'env/gen-prompt.txt', 'env/mcp-server.mjs', 'env/proxy.mjs', 'env/allowlist.json', 'env/allowlist-catalog.json', 'env/Dockerfile',
  'cases/FONTS.md', 'cases/ui04-parts-search/BRIEF.md', 'cases/ui04-parts-search/data.json', 'cases/ui07-bus-mobile/BRIEF.md', 'cases/ui07-bus-mobile/data.json'].map((f) => `../1807-design-eval-browser/${f}`);
const E1804 = ['cases/ui03-dashboard/BRIEF.md', 'cases/ui03-dashboard/data.json'].map((f) => `../1804-design-judgment/${f}`);
const E1814 = ['guard', 'ledger', 'install-asc', 'condition-i', 'make-fixture', 'collect', 'apply-condition', 'probe-check', 'score'].map((n) => `../1814-skill-invocation/harness/${n}.mjs`);
export const FIXED = [...OWN, ...E1807, ...E1804, ...E1814];

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const digests = (root = ev) => Object.fromEntries(FIXED.map((f) => [f, sha(fs.readFileSync(path.join(root, f)))]));
export const differences = (record, root = ev) => { const now = digests(root); return FIXED.filter((f) => record.files?.[f] !== now[f]); };
export const lastRecord = (fx) => fx.records.at(-1);

// Same checks as #1814 run-trial.mjs fixationFileProblems.
export function fixationFileProblems(fx, root = ev) {
  const g = (a) => spawnSync('git', a, {cwd: root, encoding: 'utf8'});
  const p = [];
  const st = g(['status', '--porcelain', '--', `${RESULTS}/fixation.json`]);
  if (st.status !== 0 || st.stdout.trim()) p.push(`${RESULTS}/fixation.json is not committed or has local changes`);
  for (const r of fx.records) if (g(['merge-base', '--is-ancestor', r.fixedAtCommit, 'HEAD']).status !== 0) p.push(`fixation record commit ${r.fixedAtCommit} is not in HEAD's history`);
  const readme = fs.existsSync(path.join(root, 'README.md')) ? fs.readFileSync(path.join(root, 'README.md'), 'utf8') : '';
  if (!readme.includes(fx.records[0].fixedAtCommit)) p.push('README.md does not name the first fixation commit');
  return p;
}

// Everything a paid step needs before it may start (run-trial --run, budget reserve).
export function paidStepProblems(ledgerFile, root = ev) {
  const file = path.join(root, RESULTS, 'fixation.json');
  if (!fs.existsSync(file)) return [`${RESULTS}/fixation.json is missing (fix the plan before running)`];
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  const p = [];
  const diff = differences(lastRecord(fx), root);
  if (diff.length) p.push(`fixed files differ from ${RESULTS}/fixation.json: ${diff.join(', ')}`);
  p.push(...fixationFileProblems(fx, root));
  if (!ledgerFile || !fs.existsSync(ledgerFile)) p.push('the ledger file does not exist (create it with fixation.mjs init --ledger)');
  else if (ledgerOps.ledgerId(ledgerFile) !== fx.records[0].ledgerId) p.push(`the ledger is not the one recorded in ${RESULTS}/fixation.json`);
  return p;
}

// Before any reservation every fixed file may change. After the isolation probes (only probe reservations in the
// ledger), only harness/probe.mjs may change (as #1814 allowed only probe-check.mjs). After a planned trial, nothing.
export const PROBE_REFIX_ALLOWED = ['harness/probe.mjs'];
export function refixViolations(fx, ledgerFile, root = ev) {
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return ['the ledger file does not exist'];
  const v = [];
  if (ledgerOps.ledgerId(ledgerFile) !== fx.records[0].ledgerId) v.push('the ledger is not the one recorded at init');
  const res = ledgerOps.reservations(ledgerFile);
  const other = res.filter((e) => !String(e.trial).startsWith('probe/'));
  if (other.length) v.push(`the ledger holds measurement reservations (${other.slice(0, 3).map((e) => e.trial).join(', ')}); refix is a pre-measurement correction only`);
  else if (res.length) for (const f of differences(lastRecord(fx), root)) if (!PROBE_REFIX_ALLOWED.includes(f)) v.push(`${f} changed after the probes (only ${PROBE_REFIX_ALLOWED.join(', ')} may)`);
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
    fs.mkdirSync(path.dirname(lf), {recursive: true});
    if (!fs.existsSync(lf)) ledgerOps.create(lf);
    if (!ledgerOps.ledgerId(lf)) fail('the ledger has no ledgerId line');
    if (ledgerOps.reservations(lf).length) fail('the ledger already holds reservations; init is pre-measurement only');
    const r = record('plan', {ledgerId: ledgerOps.ledgerId(lf)});
    save({schema: 'asc-1815-fixation/v1', note: 'Append-only. run-trial.mjs --run and budget.mjs check the last record. See harness/fixation.mjs.', records: [r]});
    console.log(JSON.stringify({stage: r.stage, fixedAtCommit: r.fixedAtCommit, files: FIXED.length}));
  } else if (action === 'refix') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ledgerFile = opt('--ledger'), reason = opt('--reason'), review = opt('--review');
    if (!ledgerFile || !reason || !review) fail('refix needs --ledger, --reason and --review');
    const v = refixViolations(fx, path.resolve(ledgerFile));
    if (v.length) fail(v.join('; '));
    fx.records.push(record('plan (refix)', {ledgerId: fx.records[0].ledgerId, refix: {reason, review, changed: differences(lastRecord(fx))}}));
    save(fx);
    console.log(JSON.stringify({stage: 'plan (refix)', records: fx.records.length}));
  } else if (action === 'check') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diff = differences(lastRecord(fx));
    console.log(JSON.stringify({ok: diff.length === 0, records: fx.records.length, firstFixedAtCommit: fx.records[0].fixedAtCommit, fixedAtCommit: lastRecord(fx).fixedAtCommit, differs: diff}));
    process.exit(diff.length ? 1 : 0);
  } else {
    console.error('usage: node fixation.mjs init|check <fixation.json> [--ledger <l>] | refix <f> --ledger <l> --reason <t> --review <r>');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
