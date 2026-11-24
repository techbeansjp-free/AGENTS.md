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
const log = (s) => fs.appendFileSync(path.join(outRoot, 'batch.log'), `${new Date().toISOString()} ${s}\n`);
fs.mkdirSync(outRoot, { recursive: true });
for (const [t, c, rep] of order) {
  const dir = path.join(outRoot, `${t}-${c}-${rep}`);
  if (fs.existsSync(path.join(dir, 'record.json'))) { spent += JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).costUsd ?? 0; continue; }
  if (spent + 4 > CEILING) { log(`STOP ceiling spent=${spent}`); process.exit(3); }
  const r = spawnSync('node', [path.join(here, 'run.mjs'), outRoot, t, c, String(rep)], { encoding: 'utf8' });
  log(`trial ${t}-${c}-${rep} exit=${r.status} ${r.stdout.trim()} ${r.stderr.trim().slice(0, 300)}`);
  try { spent += JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')).costUsd ?? 0; } catch { log(`no record ${t}-${c}-${rep}`); }
}
for (const [t, c, rep] of order) {
  const dir = path.join(outRoot, `${t}-${c}-${rep}`);
  if (!fs.existsSync(path.join(dir, 'record.json')) || fs.existsSync(path.join(dir, 'review.json'))) continue;
  if (spent + 1 > CEILING) { log(`STOP ceiling before review spent=${spent}`); process.exit(3); }
  const r = spawnSync('node', [path.join(here, 'review.mjs'), ascRoot, dir], { encoding: 'utf8' });
  log(`review ${t}-${c}-${rep} exit=${r.status} ${r.stdout.trim()}`);
  try { spent += JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8')).costUsd ?? 0; } catch { log(`no review ${t}-${c}-${rep}`); }
}
log(`END spent=${spent}`);
