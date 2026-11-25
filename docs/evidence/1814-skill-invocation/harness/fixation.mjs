// Append-only fixation of the plan before model runs (review: pre-measurement HEAD; N2: stage 3 without free re-fixation).
// results/fixation.json = {records: [...]}. `init` writes the first record (refused when the file exists). `stage3`
// appends a second record only when, compared with the first record, (a) conditions.json differs only by an added
// conditions.I, (b) release.json differs only by a filled phase3, and (c) every other fixed file is byte-identical.
// `check` compares the current files with the last record. run-trial.mjs refuses a paid run when they differ and copies
// the fixation file's sha256 and the record's commit into every trial's meta.json. No model call.
// Usage: node fixation.mjs init|stage3|check <fixation.json>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED = ['cases.json', 'conditions.json', 'decision-criteria.md', 'release.json',
  ...['apply-condition', 'collect', 'fixation', 'guard', 'install-asc', 'ledger', 'make-fixture', 'markers', 'probe-check', 'run-trial', 'score'].map((n) => `harness/${n}.mjs`)];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (f, root = ev) => fs.readFileSync(path.join(root, f));

// Digests of the parts that stage 3 must not change: conditions.json without conditions.I, release.json without phase3.
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

// Stage-3 admissibility against the first record; returns the list of violations.
export function stage3Violations(first, root = ev) {
  const now = digests(root), inv = invariantDigests(root);
  const v = FIXED.filter((f) => !['conditions.json', 'release.json'].includes(f) && first.files[f] !== now[f]).map((f) => `${f} changed`);
  if (inv.conditionsWithoutI !== first.invariants.conditionsWithoutI) v.push('conditions.json changed beyond adding conditions.I');
  if (inv.releaseWithoutPhase3 !== first.invariants.releaseWithoutPhase3) v.push('release.json changed beyond filling phase3');
  if (!JSON.parse(read('conditions.json', root)).conditions.I) v.push('conditions.I is not defined');
  if (!JSON.parse(read('release.json', root)).phase3?.assetSha256) v.push('release.json phase3 is not filled');
  return v;
}

export const lastRecord = (fixation) => fixation.records.at(-1);

function main() {
  const [action, file] = process.argv.slice(2);
  const git = (a) => spawnSync('git', a, {cwd: ev, encoding: 'utf8'}).stdout.trim();
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  const record = (stage) => {
    const dirty = git(['status', '--porcelain', '--', ...FIXED]);
    if (dirty) fail(`fixed files have uncommitted changes:\n${dirty}`);
    return {stage, fixedAtCommit: git(['rev-parse', 'HEAD']), at: new Date().toISOString(), files: digests(), invariants: invariantDigests()};
  };
  if (action === 'init') {
    if (fs.existsSync(file)) fail(`${file} exists; records are append-only`);
    const r = record('stages 0-2');
    fs.writeFileSync(file, JSON.stringify({schema: 'asc-1814-fixation/v2', note: 'Append-only. run-trial.mjs --run checks the last record. Stage 3 may only add conditions.I and fill release.json phase3 (fixation.mjs stage3).', records: [r]}, null, 1) + '\n');
    console.log(JSON.stringify({stage: r.stage, fixedAtCommit: r.fixedAtCommit, files: FIXED.length}));
  } else if (action === 'stage3') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (fx.records.length !== 1) fail('stage 3 is appended once, after exactly one initial record');
    const v = stage3Violations(fx.records[0]);
    if (v.length) fail(v.join('; '));
    fx.records.push(record('stage 3'));
    fs.writeFileSync(file, JSON.stringify(fx, null, 1) + '\n');
    console.log(JSON.stringify({stage: 'stage 3', records: fx.records.length}));
  } else if (action === 'check') {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diff = differences(lastRecord(fx));
    console.log(JSON.stringify({ok: diff.length === 0, stage: lastRecord(fx).stage, fixedAtCommit: lastRecord(fx).fixedAtCommit, differs: diff}));
    process.exit(diff.length ? 1 : 0);
  } else {
    console.error('usage: node fixation.mjs init|stage3|check <fixation.json>');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
