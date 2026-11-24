// 本実行の順序・費用上限・再実行1回を管理する（#1786）。
// 使い方: node run-all.mjs <outDir> <workRoot> <model> <budgetUsd>
// 既に記録がある件は飛ばす（中断後の再開）。無効試行は <key>.invalid<n>.json として残し、再実行は合計1回まで。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [outDir, workRoot, model, budgetArg] = process.argv.slice(2);
const budget = Number(budgetArg);
if (!outDir || !workRoot || !model || !(budget > 0)) throw new Error('usage: run-all.mjs <outDir> <workRoot> <model> <budgetUsd>');
const here = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(workRoot, { recursive: true });

let seed = 1786;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const shuffle = (xs) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const units = [];
for (const c of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) for (const k of ['A', 'B', 'C']) units.push([c, k]);
for (const c of ['P1', 'P2', 'P3']) for (const k of ['A', 'C']) units.push([c, k]);

const spent = () =>
  fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith('.json'))
    .reduce((s, f) => s + (JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')).metrics?.costUsd ?? 0), 0);
const valid = (rec) => rec.collectError === null && rec.metrics.exit === 0 && rec.metrics.isError === false && typeof rec.result === 'string' && rec.result.trim() !== '';

for (const rep of [1, 2, 3]) {
  for (const [c, k] of shuffle(units)) {
    const key = `${c}-${k}-${rep}`;
    const file = path.join(outDir, `${key}.json`);
    if (fs.existsSync(file)) continue;
    // 中断後の再開でも再実行が1回を超えないよう、残っている無効試行の数から始める
    const prior = fs.readdirSync(outDir).filter((f) => f.startsWith(`${key}.invalid`)).length;
    if (prior >= 2) {
      console.log(`MISSING ${key}（無効試行が上限に達した。欠測）`);
      continue;
    }
    for (let attempt = prior; attempt < 2; attempt++) {
      if (spent() >= budget) {
        console.log(`STOP: budget reached (${spent().toFixed(3)} USD)`);
        process.exit(3);
      }
      const r = spawnSync('node', [path.join(here, 'run.mjs'), outDir, c, k, String(rep), model, path.join(workRoot, `try${attempt}`)], { encoding: 'utf8' });
      process.stdout.write(r.stdout);
      if (r.status !== 0) {
        process.stderr.write(r.stderr);
        process.exit(4);
      }
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (valid(rec)) break;
      fs.renameSync(file, path.join(outDir, `${key}.invalid${attempt}.json`));
      console.log(`INVALID ${key} attempt ${attempt}`);
    }
  }
}
console.log(`done. spent ${spent().toFixed(3)} USD`);
