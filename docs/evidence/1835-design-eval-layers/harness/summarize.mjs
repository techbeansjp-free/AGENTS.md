// Compact record of layer 1 runs for the repository (#1835). Screenshots and render.json stay in the scratch out-dirs.
// Usage: node summarize.mjs <out.json> <layer1 out-dir>...
import fs from 'node:fs';
import path from 'node:path';

const [outFile, ...dirs] = process.argv.slice(2);
const pages = [];
const runs = [];
for (const d of dirs) {
  const r = JSON.parse(fs.readFileSync(path.join(d, 'layer1.json'), 'utf8'));
  runs.push({dir: path.basename(d), seconds: r.seconds, image: r.image});
  for (const p of r.pages) {
    pages.push({case: p.case, trial: p.trial, baselineEqual: p.baselineEqual, variants: p.variants.map((v) => (v.excluded ? {variant: v.variant, group: v.group, excluded: v.excluded} : {
      variant: v.variant, group: v.group, pass: v.pass, checks: v.checks, newFailures: v.newFailures, pixelsEqualToOriginal: v.pixelsEqualToOriginal,
      widths: Object.fromEntries(Object.entries(v.layer1.widths).map(([s, w]) => [s, {answerAll: w.answerAll, answerMissing: w.answerMissing, overflowX: w.overflowX, axeSeriousCritical: w.axeSeriousCritical, axeColorContrastNodes: w.axeColorContrastNodes}])),
      coverage: v.layer1.coverage?.value ?? null, errors: v.layer1.errors,
    }))});
  }
}
const note = '層1の暫定の判定（harness/layer1.mjs）。合格は「使いやすい」ことを意味せず、不合格はこの限られた範囲での反証として扱う。試行の記録で、層2・層3の評価ではない。';
fs.writeFileSync(outFile, JSON.stringify({schema: 'asc-1835-layer1-trial/v1', note, runs, pages}, null, 1) + '\n');
console.log(`wrote ${outFile}: ${pages.length} pages`);
