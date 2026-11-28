// #1867 layers 1-3: the pages directory that #1835's run-layer1.mjs layer1 renders, built from the raw runs of the
// generation. Only the original screen of each counted trial (no degraded variants):
//   <pages>/<case>/<condition>-r<rep>/original/index.html (+ the other files next to the page, except *.md)
//   <pages>/manifest.json (the #1835 degrade manifest format; a trial whose page is missing is listed in missing)
// The design record (DESIGN-NOTES.md) is never copied, so the screens the evaluators and the owner see carry no record.
// With runs.json (results/runs.json of collect.mjs; required on the command line, review L-3): the trials taken must be
// its counted rows, and a counted trial that failed (no valid trial in its slot) is listed in missing, not shown (H-1).
// Usage: node harness/layer-pages.mjs <runs-root> <pages-dir> --runs-json <results/runs.json> [--replace <failed>=<replacement>]...
// No model call.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {countedTrials, parseReplacements, argList, workOf, PAGE, checkCounted, failedCounted} from './trials.mjs';
import {readJson} from '../../1835-design-eval-layers/harness/eval-common.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export function buildPages({runs, out, replacements = {}, runsRows = null}) {
  if (fs.existsSync(path.join(out, 'manifest.json'))) throw new Error(`${out} already holds a manifest; use a new directory`);
  if (runsRows) checkCounted(replacements, runsRows);
  const failed = runsRows ? failedCounted(runsRows) : new Set();
  const manifest = {schema: 'asc-1835-degrade-manifest/v1', note: '#1867 layer-pages.mjs: original screens only', variants: [], probeFile: null, pages: [], missing: []};
  for (const t of countedTrials(replacements)) {
    const [dir, html] = PAGE[t.case];
    const src = path.join(workOf(runs, t), dir);
    const file = path.join(src, html);
    if (failed.has(t.name)) { manifest.missing.push({case: t.case, trial: t.slot, run: t.name, reason: 'failed trial (no valid trial in the slot)'}); continue; }
    if (!fs.existsSync(file)) { manifest.missing.push({case: t.case, trial: t.slot, run: t.name, reason: `${dir}/${html} not found`}); continue; }
    const dest = path.join(out, t.case, t.slot, 'original');
    fs.mkdirSync(dest, {recursive: true});
    const body = fs.readFileSync(file);
    fs.writeFileSync(path.join(dest, 'index.html'), body);
    const extra = fs.readdirSync(src, {withFileTypes: true}).filter((e) => e.isFile() && e.name !== html && !/\.md$/i.test(e.name)).map((e) => e.name).sort();
    for (const n of extra) fs.copyFileSync(path.join(src, n), path.join(dest, n));
    manifest.pages.push({case: t.case, trial: t.slot, run: t.name, source: `${t.name}/work/${dir}/${html}`, sourceSha256: sha(body), extraFiles: extra,
      variants: [{variant: 'original', group: 'original', sha256: sha(body)}]});
  }
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const rj = argList(a, '--runs-json')[0];
  try {
    if (!rj) throw new Error('--runs-json <results/runs.json> is required (review L-3)');
    const m = buildPages({runs: path.resolve(a[0]), out: path.resolve(a[1]), replacements: parseReplacements(argList(a, '--replace')), runsRows: readJson(path.resolve(rj))});
    console.log(JSON.stringify({pages: m.pages.length, missing: m.missing}));
  } catch (e) { console.error(e.message); process.exit(2); }
}
