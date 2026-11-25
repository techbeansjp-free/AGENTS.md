// #1817: copied from docs/evidence/1814-skill-invocation/harness/fixation.mjs. Changes: the schema name, FIXED, and the stage3
// action is refused (#1817 has no stage 3; the stage3Violations function and its tests are kept unchanged and unused).
// Append-only fixation of the plan before model runs (reviews N2, M-1, L-c, L-d). results/fixation.json = {records: [...]}.
//   init     first record (refused when the file exists). Takes --ledger: creates the ledger when absent (or accepts an
//            existing one with no reservation) and records its ledgerId; run-trial refuses any other ledger (review N-1).
//   refix    stage-0 correction (probe-check must change after the isolation probe): appends a new "stages 0-2" record,
//            only when the recorded ledger exists, holds at least one probe reservation and no stage-1/2 reservation, and
//            only with --reason and --review. Only harness/probe-check.mjs may differ from the base record; every other
//            fixed file (conditions.json incl. budget/model/runs, criteria, gold, scoring) stays byte-identical. run-trial
//            also refuses when a refix record is later than the first stage-1/2 reservation.
//   stage3   appends the stage-3 record once. Compared with the newest base record: conditions.json may differ only by an
//            added conditions.I that satisfies the conditionISchema; release.json only by a filled phase3; the files in
//            STAGE3_ALLOWED (condition-I specific code) may differ only with --reason and --review per changed file;
//            every other fixed file (scoring, gold, criteria, R/P/H paths, run/ledger/fixation) must be byte-identical.
//   check    compares the current files with the last record.
// run-trial.mjs refuses a paid run when check fails, when results/fixation.json is not committed and clean, or when the
// first record's commit is not named in README.md. No model call.
// Usage: node fixation.mjs init <fixation.json> --ledger <ledger> | check <fixation.json>
//        node fixation.mjs refix <fixation.json> --ledger <ledger> --reason <text> --review <ref>
//        node fixation.mjs stage3 <fixation.json> [--change <file> --reason <text> --review <ref>]...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as ledgerOps from './ledger.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// #1817: run-order.json, order.mjs and run-all.mjs are fixed too (review M1).
export const FIXED = ['cases.json', 'conditions.json', 'decision-criteria.md', 'release.json', 'run-order.json',
  ...['apply-condition', 'collect', 'condition-i', 'fixation', 'guard', 'install-asc', 'ledger', 'make-fixture', 'markers', 'order', 'probe-check', 'run-all', 'run-trial', 'score'].map((n) => `harness/${n}.mjs`)];
// Files stage 3 may change, each with a reason and an independent review (condition-I specific only).
export const STAGE3_ALLOWED = ['harness/condition-i.mjs'];
// The only fixed file a stage-0 correction may change (review N-1 (c)).
export const REFIX_ALLOWED = ['harness/probe-check.mjs'];

// Static shape of condition-i.mjs (review L-1): exported names, import lines, and top-level lines that are neither
// imports, exports, comments nor closing brackets (top-level side effects). Stage 3 keeps exports and imports and allows
// no top-level side effects.
export function moduleShape(text) {
  const top = text.split('\n').filter((l) => /^\S/.test(l));
  return {exports: top.flatMap((l) => /^export\s+(?:const|function|let)\s+([A-Za-z0-9_$]+)/.exec(l)?.[1] ?? []).sort(),
    imports: top.filter((l) => l.startsWith('import ')).sort(),
    sideEffects: top.filter((l) => !/^(import |export |\/\/|[}\])])/.test(l))};
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (f, root = ev) => fs.readFileSync(path.join(root, f));

export function invariantDigests(root = ev) {
  const c = JSON.parse(read('conditions.json', root)); delete c.conditions.I;
  const r = JSON.parse(read('release.json', root)); r.phase3 = null;
  return {conditionsWithoutI: sha(JSON.stringify(c)), releaseWithoutPhase3: sha(JSON.stringify(r))};
}
export const digests = (root = ev) => Object.fromEntries(FIXED.map((f) => [f, sha(read(f, root))]));
export function differences(record, root = ev) {
  const now = digests(root);
  return FIXED.filter((f) => record.files?.[f] !== now[f]);
}

// conditionISchema of conditions.json (review L-d). Kept here, not in condition-i.mjs, so stage 3 cannot relax it.
export function conditionIProblems(c) {
  if (!c) return ['conditions.I is not defined'];
  const p = [];
  const allowed = new Set(['label', 'pointer', 'hook', 'pointerDelivered', 'adopt', 'core']);
  for (const k of Object.keys(c)) if (!allowed.has(k)) p.push(`conditions.I has unexpected key ${k}`);
  if (typeof c.label !== 'string') p.push('conditions.I.label must be a string');
  if (c.pointer !== false) p.push('conditions.I.pointer must be false');
  if (!(c.hook === null || c.hook === 'product')) p.push('conditions.I.hook must be null or "product"');
  if (c.pointerDelivered !== true) p.push('conditions.I.pointerDelivered must be true');
  if (typeof c.adopt !== 'string' || !c.adopt) p.push('conditions.I.adopt must be an option id');
  return p;
}

// changes: {file: {reason, review}} for STAGE3_ALLOWED files that differ.
export function stage3Violations(base, root = ev, changes = {}) {
  const now = digests(root), inv = invariantDigests(root);
  const v = [];
  for (const f of FIXED) {
    if (['conditions.json', 'release.json'].includes(f) || base.files[f] === now[f]) continue;
    if (!STAGE3_ALLOWED.includes(f)) { v.push(`${f} changed`); continue; }
    if (!changes[f]?.reason || !changes[f]?.review) v.push(`${f} changed without --reason and --review`);
  }
  for (const f of Object.keys(changes)) if (!STAGE3_ALLOWED.includes(f)) v.push(`${f} is not changeable at stage 3`);
  if (inv.conditionsWithoutI !== base.invariants.conditionsWithoutI) v.push('conditions.json changed beyond adding conditions.I');
  if (inv.releaseWithoutPhase3 !== base.invariants.releaseWithoutPhase3) v.push('release.json changed beyond filling phase3');
  v.push(...conditionIProblems(JSON.parse(read('conditions.json', root)).conditions.I));
  if (!JSON.parse(read('release.json', root)).phase3?.assetSha256) v.push('release.json phase3 is not filled');
  if (base.conditionIShape) {
    const now = moduleShape(read('harness/condition-i.mjs', root).toString());
    if (JSON.stringify(now.exports) !== JSON.stringify(base.conditionIShape.exports)) v.push('condition-i.mjs exports changed');
    if (JSON.stringify(now.imports) !== JSON.stringify(base.conditionIShape.imports)) v.push('condition-i.mjs imports changed');
    if (now.sideEffects.length) v.push('condition-i.mjs has top-level statements');
  }
  return v;
}

// Stage-0 correction admissibility (review N-1): the recorded ledger, probe reservations only, probe-check.mjs only.
export function refixViolations(base, ledgerFile, root = ev) {
  const v = [];
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return ['the ledger file does not exist'];
  if (ledgerOps.ledgerId(ledgerFile) !== base.ledgerId) v.push('the ledger is not the one recorded at init');
  const res = ledgerOps.reservations(ledgerFile);
  if (!res.some((e) => ledgerOps.isProbe(e.trial))) v.push('the ledger has no probe reservation');
  const started = res.filter((e) => !ledgerOps.isProbe(e.trial)).map((e) => e.trial);
  if (started.length) v.push(`stage-1/2 trials exist in the ledger (${started.slice(0, 3).join(', ')})`);
  const now = digests(root);
  for (const f of FIXED) if (base.files[f] !== now[f] && !REFIX_ALLOWED.includes(f)) v.push(`${f} changed (refix may change only ${REFIX_ALLOWED.join(', ')})`);
  return v;
}

export const lastRecord = (fx) => fx.records.at(-1);
export const baseRecord = (fx) => fx.records.filter((r) => r.stage === 'stages 0-2').at(-1);

// run-trial: a refix record must be older than the first stage-1/2 reservation of the ledger.
export function refixAfterMeasurement(fx, ledgerFile) {
  const first = ledgerOps.reservations(ledgerFile).find((e) => !ledgerOps.isProbe(e.trial));
  return first ? fx.records.filter((r) => r.refix && r.at > first.at).map((r) => r.at) : [];
}

function main() {
  const argv = process.argv.slice(2);
  const [action, file] = argv;
  const all = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));
  const opt = (k) => all(k)[0] ?? null;
  const git = (a) => spawnSync('git', a, {cwd: ev, encoding: 'utf8'}).stdout.trim();
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  const record = (stage, extra = {}) => {
    const dirty = git(['status', '--porcelain', '--', ...FIXED]);
    if (dirty) fail(`fixed files have uncommitted changes:\n${dirty}`);
    return {stage, fixedAtCommit: git(['rev-parse', 'HEAD']), at: new Date().toISOString(), files: digests(), invariants: invariantDigests(), ...extra};
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
    const r = record('stages 0-2', {ledgerId: ledgerOps.ledgerId(lf), conditionIShape: moduleShape(read('harness/condition-i.mjs').toString())});
    save({schema: 'asc-1817-fixation/v1', note: 'Append-only. run-trial.mjs --run checks the last record. See fixation.mjs for refix and stage3.', records: [r]});
    console.log(JSON.stringify({stage: r.stage, fixedAtCommit: r.fixedAtCommit, files: FIXED.length}));
  } else if (action === 'refix') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ledgerFile = opt('--ledger'), reason = opt('--reason'), review = opt('--review');
    if (!ledgerFile || !reason || !review) fail('refix needs --ledger, --reason and --review');
    if (fx.records.some((r) => r.stage === 'stage 3')) fail('stage 3 has been fixed; no refix');
    const v = refixViolations(baseRecord(fx), path.resolve(ledgerFile));
    if (v.length) fail(`${v.join('; ')}; refix is only a pre-measurement correction of probe-check.mjs`);
    const base = baseRecord(fx);
    fx.records.push(record('stages 0-2', {ledgerId: base.ledgerId, conditionIShape: base.conditionIShape, refix: {reason, review, changed: differences(base)}}));
    save(fx);
    console.log(JSON.stringify({stage: 'stages 0-2 (refix)', records: fx.records.length}));
  } else if (action === 'stage3') {
    fail('#1817 has no stage 3: the conditions B and S are fixed together in the first record');
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (fx.records.some((r) => r.stage === 'stage 3')) fail('stage 3 is appended once');
    const files = all('--change'), reasons = all('--reason'), reviews = all('--review');
    if (files.length !== reasons.length || files.length !== reviews.length) fail('each --change needs one --reason and one --review');
    const changes = Object.fromEntries(files.map((f, k) => [f, {reason: reasons[k], review: reviews[k]}]));
    const v = stage3Violations(baseRecord(fx), ev, changes);
    if (v.length) fail(v.join('; '));
    fx.records.push(record('stage 3', {ledgerId: baseRecord(fx).ledgerId, changes: Object.fromEntries(Object.entries(changes).filter(([f]) => differences(baseRecord(fx)).includes(f)))}));
    save(fx);
    console.log(JSON.stringify({stage: 'stage 3', records: fx.records.length}));
  } else if (action === 'check') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diff = differences(lastRecord(fx));
    console.log(JSON.stringify({ok: diff.length === 0, stage: lastRecord(fx).stage, records: fx.records.length, firstFixedAtCommit: fx.records[0].fixedAtCommit, fixedAtCommit: lastRecord(fx).fixedAtCommit, differs: diff}));
    process.exit(diff.length ? 1 : 0);
  } else {
    console.error('usage: node fixation.mjs init|check <fixation.json> | refix <f> --ledger <l> --reason <t> --review <r> | stage3 <f> [--change <file> --reason <t> --review <r>]...');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
