// #1817 sanity check without any model call: scores the committed public #1814 traces
// (docs/evidence/1814-skill-invocation/results/traces, paths redacted to <trial>/work) with this harness's score.mjs,
// once with the #1814 cases.json and once with the #1817 cases.json (relaxed answer markers). The first must reproduce
// the published #1814 numbers (stage1-R-score.json, stage2-judge.json, stage3-judge.json); the second shows what the
// relaxed markers change on the same traces. H was the #1814 fixture-hook condition (hook log next to the trace).
// Usage: node rescore-1814.mjs [--out <json>]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreDir, summarize} from './score.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ev14 = path.resolve(ev, '../1814-skill-invocation');
const HOOKED = {R: false, P: false, H: 'usage', I: false};
const CONDS = Object.keys(HOOKED);

export function rescore() {
  const out = {traces: 'docs/evidence/1814-skill-invocation/results/traces', planned: 2, scorings: {}};
  for (const [label, file] of [['cases1814', path.join(ev14, 'cases.json')], ['cases1817', path.join(ev, 'cases.json')]]) {
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const runs = scoreDir(spec, path.join(ev14, 'results/traces'), CONDS, HOOKED, 2);
    out.scorings[label] = Object.fromEntries(CONDS.map((c) => {
      const s = summarize(spec, runs, c);
      return [c, {runs: s.runs, failures: s.failures, positives: s.positives, bodyRead: s.bodyRead, applied: s.applied, negatives: s.negatives, overapplication: s.overapplication, perCase: s.perCase}];
    }));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = rescore();
  const i = process.argv.indexOf('--out');
  if (i >= 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(r, null, 1) + '\n');
  for (const [k, v] of Object.entries(r.scorings)) for (const [c, s] of Object.entries(v)) console.log(k, c, `bodyRead ${s.bodyRead}/${s.positives}`, `applied ${s.applied}/${s.positives}`, `over ${s.overapplication}/${s.negatives}`);
}
