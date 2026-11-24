// Usage: node batch.mjs <ascRepoRoot> <outRoot>
// Runs the 36 trials of EVAL_PLAN.md serially in the fixed order, then the 36 independent reviews. Stops at the cost ceiling.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [ascRoot, outRoot] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const CEILING = 80;
const order = [];
for (let rep = 1; rep <= 3; rep++) {
  for (const c of ['A', 'B', 'C', 'D', 'E']) order.push(['P1', c, rep]);
  for (const c of ['A', 'B', 'C', 'D', 'E']) order.push(['P2', c, rep]);
  for (const c of ['D', 'E']) order.push(['P3', c, rep]);
}
let spent = 0;
// A missing cost is never counted as 0: add the per-run ceiling instead so the stop condition stays conservative.
const costOf = (file, fallback) => { const v = JSON.parse(fs.readFileSync(file, 'utf8')).costUsd; if (v == null) log(`missing cost ${file.split(path.sep).slice(-2).join('/')}`); return v ?? fallback; };
const log = (s) => fs.appendFileSync(path.join(outRoot, 'batch.log'), `${new Date().toISOString()} ${s}\n`);
fs.mkdirSync(outRoot, { recursive: true });
for (const [t, c, rep] of order) {
  const dir = path.join(outRoot, `${t}-${c}-${rep}`);
  if (fs.existsSync(path.join(dir, 'record.json'))) { spent += costOf(path.join(dir, 'record.json'), 4); continue; }
  if (spent + 4 > CEILING) { log(`STOP ceiling spent=${spent}`); process.exit(3); }
  const r = spawnSync('node', [path.join(here, 'run.mjs'), outRoot, t, c, String(rep)], { encoding: 'utf8' });
  log(`trial ${t}-${c}-${rep} exit=${r.status} ${r.stdout.trim()} ${r.stderr.trim().slice(0, 300)}`);
  try { spent += costOf(path.join(dir, 'record.json'), 4); } catch { log(`no record ${t}-${c}-${rep}`); }
}
for (const [t, c, rep] of order) {
  const dir = path.join(outRoot, `${t}-${c}-${rep}`);
  if (!fs.existsSync(path.join(dir, 'record.json')) || fs.existsSync(path.join(dir, 'review.json'))) continue;
  if (spent + 1 > CEILING) { log(`STOP ceiling before review spent=${spent}`); process.exit(3); }
  const r = spawnSync('node', [path.join(here, 'review.mjs'), ascRoot, dir], { encoding: 'utf8' });
  log(`review ${t}-${c}-${rep} exit=${r.status} ${r.stdout.trim()}`);
  try { spent += costOf(path.join(dir, 'review.json'), 1); } catch { log(`no review ${t}-${c}-${rep}`); }
}
log(`END spent=${spent}`);
