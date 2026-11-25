// Fixation of the plan before any model run (review: record the pre-measurement HEAD). `write` records the commit and
// the sha256 of every file that defines conditions, gold, judgement or the run; `check` compares the current files with
// that record. run-trial.mjs refuses a paid run when they differ. No model call.
// Usage: node fixation.mjs write <out.json> | node fixation.mjs check <fixation.json>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED = ['cases.json', 'conditions.json', 'decision-criteria.md', 'release.json',
  ...['apply-condition', 'collect', 'fixation', 'guard', 'install-asc', 'ledger', 'make-fixture', 'markers', 'probe-check', 'run-trial', 'score'].map((n) => `harness/${n}.mjs`)];

export const digests = () => Object.fromEntries(FIXED.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ev, f))).digest('hex')]));

export function differences(record) {
  const now = digests();
  return FIXED.filter((f) => record.files?.[f] !== now[f]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [action, file] = process.argv.slice(2);
  if (action === 'write') {
    const git = (a) => spawnSync('git', a, {cwd: ev, encoding: 'utf8'}).stdout.trim();
    const dirty = git(['status', '--porcelain', '--', ...FIXED]);
    if (dirty) { console.error(`refused: fixed files have uncommitted changes:\n${dirty}`); process.exit(3); }
    const record = {schema: 'asc-1814-fixation/v1', fixedAtCommit: git(['rev-parse', 'HEAD']), files: digests(),
      note: 'Pre-measurement fixation. run-trial.mjs --run refuses when any listed file differs. Changing a listed file after results are seen is not allowed (decision-criteria.md).'};
    fs.writeFileSync(file, JSON.stringify(record, null, 1) + '\n');
    console.log(JSON.stringify({fixedAtCommit: record.fixedAtCommit, files: FIXED.length}));
  } else if (action === 'check') {
    const diff = differences(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(JSON.stringify({ok: diff.length === 0, differs: diff}));
    process.exit(diff.length ? 1 : 0);
  } else {
    console.error('usage: node fixation.mjs write <out.json> | check <fixation.json>');
    process.exit(2);
  }
}
