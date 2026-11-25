// Append-only fixation of the plan before model runs (reviews N2, M-1, L-c, L-d). results/fixation.json = {records: [...]}.
//   init     first record (refused when the file exists).
//   refix    stage-0 correction (e.g. probe-check must change after the isolation probe): appends a new "stages 0-2"
//            record, only while the ledger holds no stage-1/2 trial (only probe trials), and only with --reason and
//            --review (an independent review reference). Later checks and stage 3 compare with this newest base record.
//   stage3   appends the stage-3 record once. Compared with the newest base record: conditions.json may differ only by an
//            added conditions.I that satisfies the conditionISchema; release.json only by a filled phase3; the files in
//            STAGE3_ALLOWED (condition-I specific code) may differ only with --reason and --review per changed file;
//            every other fixed file (scoring, gold, criteria, R/P/H paths, run/ledger/fixation) must be byte-identical.
//   check    compares the current files with the last record.
// run-trial.mjs refuses a paid run when check fails, when results/fixation.json is not committed and clean, or when the
// first record's commit is not named in README.md. No model call.
// Usage: node fixation.mjs init|check <fixation.json>
//        node fixation.mjs refix <fixation.json> --ledger <ledger> --reason <text> --review <ref>
//        node fixation.mjs stage3 <fixation.json> [--change <file> --reason <text> --review <ref>]...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED = ['cases.json', 'conditions.json', 'decision-criteria.md', 'release.json',
  ...['apply-condition', 'collect', 'condition-i', 'fixation', 'guard', 'install-asc', 'ledger', 'make-fixture', 'markers', 'probe-check', 'run-trial', 'score'].map((n) => `harness/${n}.mjs`)];
// Files stage 3 may change, each with a reason and an independent review (condition-I specific only).
export const STAGE3_ALLOWED = ['harness/condition-i.mjs'];
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
  return v;
}

export const lastRecord = (fx) => fx.records.at(-1);
export const baseRecord = (fx) => fx.records.filter((r) => r.stage === 'stages 0-2').at(-1);

// Stage-0 re-fixation is allowed only before any stage-1/2 trial is in the ledger (probe trials only).
export function nonProbeTrials(ledgerFile) {
  if (!fs.existsSync(ledgerFile)) return [];
  return fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => typeof e.reservedUsd === 'number' && !/-probe-\d+$/.test(e.trial)).map((e) => e.trial);
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
    const r = record('stages 0-2');
    save({schema: 'asc-1814-fixation/v3', note: 'Append-only. run-trial.mjs --run checks the last record. See fixation.mjs for refix and stage3.', records: [r]});
    console.log(JSON.stringify({stage: r.stage, fixedAtCommit: r.fixedAtCommit, files: FIXED.length}));
  } else if (action === 'refix') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ledgerFile = opt('--ledger'), reason = opt('--reason'), review = opt('--review');
    if (!ledgerFile || !reason || !review) fail('refix needs --ledger, --reason and --review');
    if (fx.records.some((r) => r.stage === 'stage 3')) fail('stage 3 has been fixed; no refix');
    const started = nonProbeTrials(path.resolve(ledgerFile));
    if (started.length) fail(`stage-1/2 trials exist in the ledger (${started.slice(0, 3).join(', ')}…); refix is only a pre-measurement correction`);
    fx.records.push(record('stages 0-2', {refix: {reason, review, changed: differences(baseRecord(fx))}}));
    save(fx);
    console.log(JSON.stringify({stage: 'stages 0-2 (refix)', records: fx.records.length}));
  } else if (action === 'stage3') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (fx.records.some((r) => r.stage === 'stage 3')) fail('stage 3 is appended once');
    const files = all('--change'), reasons = all('--reason'), reviews = all('--review');
    if (files.length !== reasons.length || files.length !== reviews.length) fail('each --change needs one --reason and one --review');
    const changes = Object.fromEntries(files.map((f, k) => [f, {reason: reasons[k], review: reviews[k]}]));
    const v = stage3Violations(baseRecord(fx), ev, changes);
    if (v.length) fail(v.join('; '));
    fx.records.push(record('stage 3', {changes: Object.fromEntries(Object.entries(changes).filter(([f]) => differences(baseRecord(fx)).includes(f)))}));
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
