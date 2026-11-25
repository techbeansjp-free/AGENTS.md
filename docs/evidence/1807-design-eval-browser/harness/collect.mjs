// Copies the per-trial records that go into the repository, with local paths removed (#1807).
// Usage: node collect.mjs <runs-root> <render-root> <out-dir>
// Kept: meta.json (finalText and absolute paths removed), core-steps.json, the browse-proxy decisions (proxy.jsonl),
// the tool log (tools.jsonl), gold.json and a render summary without page text. Not kept: transcripts, fixtures, screenshots.
import fs from 'node:fs';
import path from 'node:path';

const [runsRoot, renderRoot, outDir] = process.argv.slice(2);
const runsAbs = path.resolve(runsRoot);
const scrub = (s) => String(s).split(runsAbs).join('<RUNS>').replace(/\/(Users|home)\/[^\s"'/]+/g, '/<HOME>').replace(/\/private\/tmp\/[^\s"']*/g, '<TMP>');
const scrubJson = (o) => JSON.parse(scrub(JSON.stringify(o)));
const summary = [];
for (const c of fs.readdirSync(runsRoot).filter((x) => fs.statSync(path.join(runsRoot, x)).isDirectory()).sort()) {
  for (const t of fs.readdirSync(path.join(runsRoot, c)).sort()) {
    const src = path.join(runsRoot, c, t); const dst = path.join(outDir, 'trials', c, t);
    if (!fs.existsSync(path.join(src, 'meta.json'))) continue;
    fs.mkdirSync(dst, {recursive: true});
    const meta = JSON.parse(fs.readFileSync(path.join(src, 'meta.json'), 'utf8'));
    delete meta.finalText; delete meta.initSkills;
    fs.writeFileSync(path.join(dst, 'meta.json'), JSON.stringify(scrubJson(meta), null, 1));
    for (const f of ['core-steps.json']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    const proxy = fs.existsSync(path.join(src, 'proxy.jsonl')) ? fs.readFileSync(path.join(src, 'proxy.jsonl'), 'utf8') : '';
    fs.writeFileSync(path.join(dst, 'proxy.jsonl'), scrub(proxy));
    const tl = path.join(src, 'log', 'tools.jsonl');
    fs.writeFileSync(path.join(dst, 'tools.jsonl'), fs.existsSync(tl) ? scrub(fs.readFileSync(tl, 'utf8')) : '');
    const g = path.join(renderRoot, c, t, 'gold.json');
    if (fs.existsSync(g)) fs.copyFileSync(g, path.join(dst, 'gold.json'));
    const rj = path.join(renderRoot, c, 'render.json');
    if (fs.existsSync(rj)) {
      const r = JSON.parse(fs.readFileSync(rj, 'utf8')).find((x) => x.id === t);
      if (r) {
        for (const v of Object.values(r.viewports ?? {})) { delete v.textSample; }
        delete r.file;
        fs.writeFileSync(path.join(dst, 'render.json'), JSON.stringify(scrubJson(r), null, 1));
      }
    }
    summary.push({case: c, trial: t, cost: meta.costUsd, exit: meta.exit, subtype: meta.resultSubtype, coreSteps: meta.coreSteps, toolCounts: meta.toolCounts,
      skillCalls: meta.skillCalls, skillFileReads: meta.skillFileReads});
  }
}
fs.writeFileSync(path.join(outDir, 'trials.json'), JSON.stringify(scrubJson(summary), null, 1));
console.log(JSON.stringify({trials: summary.length, costUsd: summary.reduce((a, s) => a + (s.cost ?? 0), 0)}));
