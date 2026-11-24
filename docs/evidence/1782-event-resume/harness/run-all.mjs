// Usage: node run-all.mjs <outDir> <model> [parallel=4]
// Runs the fixed 3 cases x 4 conditions x 3 reps in an interleaved order (rep, case, condition) with a small worker pool.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [outDir, model, parallel = '4'] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(outDir, { recursive: true });
const queue = [];
for (const rep of [1, 2, 3]) for (const kase of ['K1', 'K2', 'K3']) for (const cond of ['A', 'B', 'C', 'D']) queue.push([kase, cond, String(rep)]);
const pending = queue.filter(([k, c, r]) => !fs.existsSync(path.join(outDir, `${k}-${c}-${r}.json`)));
async function worker() {
  for (let job = pending.shift(); job; job = pending.shift()) {
    await new Promise((resolve) => {
      const child = spawn('node', [path.join(here, 'run.mjs'), outDir, ...job, model], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (b) => { out += b; }); child.stderr.on('data', (b) => { out += b; });
      child.on('close', (code) => { console.log(`${job.join('-')} exit=${code} ${out.trim().split('\n').at(-1)}`); resolve(); });
    });
  }
}
await Promise.all(Array.from({ length: Number(parallel) }, worker));
