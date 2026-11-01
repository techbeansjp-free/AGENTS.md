// Targeted commit sequence: each step exercises one invalidation rule. The probe mode must match a
// full rebuild at every step, and every mutant must be caught at least once (otherwise the rule is untested).
import { L1, TreeCtx, lsTree, buildFull, updateIncremental, diffTrees } from './prototype.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const outFile = process.argv[2];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-graph-synthetic-'));
const sh = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
sh('init', '-q'); sh('config', 'user.email', 'x@x'); sh('config', 'user.name', 'x');
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
const rm = (p) => fs.rmSync(path.join(dir, p));
const commit = (m) => { sh('add', '-A'); sh('commit', '-q', '--allow-empty', '-m', m); return sh('rev-parse', 'HEAD').trim(); };

const steps = [];
w('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: { '@x/*': ['src/x/*'] }, customConditions: ['source'] } }));
w('tsconfig.json', JSON.stringify({ extends: './tsconfig.base.json' }));
w('src/a.ts', "import './b';\nimport 'p';\nimport '@x/y';\nimport 'p/feat';\n");
w('src/b.ts', 'export const b = 1;\n');
w('src/x/y.ts', 'export const y = 1;\n');
w('src/x/z.ts', 'export const z = 1;\n');
w('packages/p/package.json', JSON.stringify({ name: 'p', exports: { '.': { source: './src/index.ts', default: './dist/index.js' }, './feat': './src/feat.ts' } }));
w('packages/p/src/index.ts', 'export {};\n'); w('packages/p/src/feat.ts', 'export {};\n'); w('packages/p/src/feat2.ts', 'export {};\n');
w('sub/c.ts', "import '../src/b';\nimport './d.js';\n"); w('sub/d.js', 'export {};\n');
steps.push(['base', commit('base')]);
rm('src/b.ts'); steps.push(['delete import target only', commit('del')]);
w('src/b/index.ts', 'export {};\n'); steps.push(['add index file for unresolved import', commit('add')]);
w('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: { '@x/*': ['src/x/*', 'src/alt/*'] }, customConditions: ['source'] } }));
w('src/alt/y.ts', 'export {};\n'); rm('src/x/y.ts'); steps.push(['paths fallback after delete', commit('paths')]);
w('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: { '@x/*': ['src/x/*'] } } })); steps.push(['modify extended config (drop customConditions)', commit('cfg')]);
w('packages/p/package.json', JSON.stringify({ name: 'q', exports: { '.': './src/index.ts' } })); steps.push(['rename package p->q', commit('rename-pkg')]);
w('packages/p2/package.json', JSON.stringify({ name: 'p', exports: { '.': './src/main.ts', './feat': './src/feat2.ts' } })); w('packages/p2/src/main.ts', 'export {};\n'); w('packages/p2/src/feat2.ts', 'export {};\n'); steps.push(['add another package named p', commit('add-pkg')]);
w('packages/p2/package.json', JSON.stringify({ name: 'p', exports: { '.': './src/main.ts', './feat': './src/main.ts' } })); steps.push(['modify exports only', commit('exports')]);
w('packages/p3/package.json', JSON.stringify({ name: 'p' })); steps.push(['duplicate package name -> ambiguous', commit('dup')]);
w('sub/tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@x/*': ['../src/alt/*'] } } })); w('sub/e.ts', "import '@x/y';\n"); steps.push(['add nearer tsconfig', commit('near-cfg')]);
w('sub/d.ts', 'export {};\n'); steps.push(['add .ts that outranks imported .js', commit('ts-over-js')]);
fs.renameSync(path.join(dir, 'src/x/z.ts'), path.join(dir, 'src/x/y.ts')); steps.push(['rename into a probed path', commit('mv')]);
rm('sub/tsconfig.json'); steps.push(['delete nearer tsconfig', commit('del-cfg')]);

const l1 = new L1(dir, false);
const MODES = ['probe', 'naive', 'noAdd', 'noDel', 'noCfg', 'noPkg'];
let entries = lsTree(dir, steps[0][1]); await l1.ensure(entries);
let ctx = new TreeCtx(entries, l1);
const gs = Object.fromEntries(MODES.map((m) => [m, buildFull(ctx)]));
const killed = Object.fromEntries(MODES.map((m) => [m, []]));
const rows = [];
for (const [name, c] of steps.slice(1)) {
  const next = lsTree(dir, c); await l1.ensure(next);
  const nctx = new TreeCtx(next, l1); const diff = diffTrees(entries, next);
  const full = buildFull(nctx);
  const row = { step: name, edgesChanged: false };
  for (const m of MODES) {
    updateIncremental(gs[m], ctx, nctx, diff, m);
    const ok = gs[m].digest() === full.digest();
    row[m] = ok ? 'eq' : 'DIFF';
    if (!ok) { killed[m].push(name); gs[m] = full.clone(); }
  }
  rows.push(row); entries = next; ctx = nctx;
}
console.table(rows);
const verdict = { probeAlwaysEq: killed.probe.length === 0, survivors: MODES.filter((m) => m !== 'probe' && killed[m].length === 0), killed };
console.log(JSON.stringify(verdict, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ rows, verdict }, null, 1));
l1.close();
fs.rmSync(dir, { recursive: true, force: true });
if (!verdict.probeAlwaysEq || verdict.survivors.length) process.exitCode = 1;
