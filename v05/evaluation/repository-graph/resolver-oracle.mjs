// V-oracle: compare our L2 import edges with TypeScript's own module resolution on a checked-out tree.
// usage: node exp2_oracle.mjs <repo> <checkoutDir(with node_modules installed or not)> <out.json>
import { L1, TreeCtx, lsTree, buildFull, isCode, isConfig, ts, resolveFile } from './prototype.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [repo, wt, outFile] = process.argv.slice(2);
const entries = lsTree(repo, 'HEAD');
{ // the oracle reads the checkout from disk; refuse when it differs from the HEAD tree the graph is built from
  const relevant = (p) => isCode(p) || isConfig(p) || p.endsWith('.json');
  const code = [...entries.keys()].filter(relevant);
  const hashes = execFileSync('git', ['-C', wt, 'hash-object', '--no-filters', '--stdin-paths'], { input: code.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 28, cwd: wt }).trim().split('\n');
  const bad = code.filter((p, i) => hashes[i] !== entries.get(p).blob);
  // files outside HEAD could become resolution targets; installed dependencies under node_modules are expected
  const extra = fs.readdirSync(wt, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(wt, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .filter((p) => !p.split('/').includes('node_modules') && !p.startsWith('.git/') && relevant(p) && !entries.has(p));
  if (bad.length || extra.length) { console.error('checkout differs from HEAD: ' + [...bad, ...extra.map((p) => '+' + p)].slice(0, 5).join(', ')); process.exit(2); }
}
const l1 = new L1(repo, false);
await l1.ensure(entries);
const ctx = new TreeCtx(entries, l1);
const g = buildFull(ctx);
const cfgCache = new Map();
const governing = (src) => {
  for (let d = path.dirname(src); ; d = path.dirname(d)) {
    for (const n of ['tsconfig.json', 'jsconfig.json']) { const c = path.join(d, n); if (entries.has(c.replace(/^\.\//, ''))) return c.replace(/^\.\//, ''); }
    if (d === '.' || d === '') return null;
  }
};
const optionsFor = (cfg) => {
  if (cfgCache.has(cfg)) return cfgCache.get(cfg);
  let o = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext };
  if (cfg) {
    const abs = path.join(wt, cfg);
    const r = ts.readConfigFile(abs, ts.sys.readFile);
    if (!r.error) { const p = ts.parseJsonConfigFileContent(r.config, ts.sys, path.dirname(abs), undefined, abs); o = { ...p.options, allowJs: true }; }
    // our resolver models bundler-style extension probing; keep the project's own setting when given
    if (!o.moduleResolution) { o.moduleResolution = ts.ModuleResolutionKind.Bundler; o.module = ts.ModuleKind.ESNext; }
  }
  cfgCache.set(cfg, o); return o;
};
const host = { ...ts.sys, fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, realpath: ts.sys.realpath, directoryExists: ts.sys.directoryExists, getCurrentDirectory: () => wt };
const stat = { refs: 0, agree: 0, bothNone: 0, oursOnly: 0, oracleOnly: 0, differ: 0, oracleExternal: 0 };
const samples = { oursOnly: [], oracleOnly: [], differ: [] };
const byReason = {};
for (const [src] of entries) {
  if (!isCode(src)) continue;
  const f = l1.get(src, entries);
  if (f.status !== 'ok') continue;
  const opts = optionsFor(governing(src));
  // recompute our per-ref resolution: resolveFile is per file, so map spec -> edge via a one-ref run
  for (const r of f.refs) {
    if (r.kind === 'import_dynamic') continue;
    stat.refs++;
    const res = ts.resolveModuleName(r.target, path.join(wt, src), opts, host).resolvedModule;
    let oracle = null;
    if (res) { const rel = path.relative(wt, ts.sys.realpath ? ts.sys.realpath(res.resolvedFileName) : res.resolvedFileName); if (!rel.startsWith('..') && !rel.includes('node_modules/')) oracle = rel; else stat.oracleExternal++; }
    const mine = ourOne(src, r);
    if (mine && oracle) { if (mine === oracle) stat.agree++; else { stat.differ++; if (samples.differ.length < 15) samples.differ.push([src, r.target, mine, oracle]); } }
    else if (mine) { stat.oursOnly++; const code = /\.[cm]?[jt]sx?$/.test(mine); if (code) { stat.oursOnlyCode = (stat.oursOnlyCode ?? 0) + 1; if (samples.oursOnly.length < 15) samples.oursOnly.push([src, r.target, mine]); } else stat.oursOnlyAsset = (stat.oursOnlyAsset ?? 0) + 1; }
    else if (oracle) { stat.oracleOnly++; const k = unresolvedReason(src, r); byReason[k] = (byReason[k] ?? 0) + 1; if (samples.oracleOnly.length < 25) samples.oracleOnly.push([src, r.target, oracle, k]); }
    else stat.bothNone++;
  }
}
function ourOne(src, r) {
  // resolve one ref by running resolveFile on a fact view with a single ref
  const key = l1.key(src, entries.get(src).blob);
  const saved = l1.facts.get(key);
  l1.facts.set(key, { ...saved, refs: [r] });
  const out = resolveOne(src);
  l1.facts.set(key, saved);
  return out;
}
function resolveOne(src) { const x = resolveFile(ctx, src); return x.edges[0] ?? null; }
function unresolvedReason(src, r) {
  const key = l1.key(src, entries.get(src).blob); const saved = l1.facts.get(key);
  l1.facts.set(key, { ...saved, refs: [r] }); const x = resolveFile(ctx, src); l1.facts.set(key, saved);
  return x.unresolved[0]?.split('\t')[2] ?? '?';
}
const precision = (stat.agree) / (stat.agree + stat.differ + stat.oursOnly);
const precisionCode = (stat.agree) / (stat.agree + stat.differ + (stat.oursOnlyCode ?? 0));
const recall = (stat.agree) / (stat.agree + stat.differ + stat.oracleOnly);
fs.writeFileSync(outFile, JSON.stringify({ repo, edges: g.edgeCount(), stat, precision, precisionCode, recall, byReason, samples }, null, 1));
console.log(JSON.stringify({ repo, stat, precision: +precision.toFixed(4), precisionCode: +precisionCode.toFixed(4), recall: +recall.toFixed(4), byReason }));
l1.close();
