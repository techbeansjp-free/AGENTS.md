// V1/V2/V4: incremental(probe) vs incremental(naive) vs full rebuild over N first-parent commits.
import { L1, TreeCtx, lsTree, buildFull, updateIncremental, diffTrees, firstParentCommits, isCode } from './prototype.mjs';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const [repo, nStr, outFile] = process.argv.slice(2);
const N = Number(nStr);
const commits = firstParentCommits(repo, N);
const now = () => performance.now();
const l1 = new L1(repo, false);
const diffSrcs = (a, b) => {
  const out = [];
  for (const s of new Set([...a.results.keys(), ...b.results.keys()])) {
    const x = a.results.get(s), y = b.results.get(s);
    if (!x || !y || x.edges.join('|') !== y.edges.join('|') || x.unresolved.join('|') !== y.unresolved.join('|') || x.probes.join('|') !== y.probes.join('|')) out.push(s);
  }
  return out;
};
const edgeSet = (g) => { const s = new Set(); for (const [src, r] of g.results) for (const d of r.edges) s.add(src + '>' + d); return s; };

let entries = lsTree(repo, commits[0]);
let t = now(); await l1.ensure(entries); const coldL1 = now() - t;
let ctx = new TreeCtx(entries, l1);
t = now(); let full = buildFull(ctx); const coldFull = now() - t;
let probeG = full.clone(), naiveG = full.clone();
const MUT = ['noAdd', 'noDel', 'noCfg', 'noPkg']; const mutG = Object.fromEntries(MUT.map((m) => [m, full.clone()]));
const out = fs.createWriteStream(outFile);
out.write(JSON.stringify({ repo, commits: commits.length, first: commits[0], files: entries.size, code: [...entries.keys()].filter(isCode).length, coldL1Ms: coldL1, coldResolveMs: coldFull, edges: full.edgeCount() }) + '\n');
for (let i = 1; i < commits.length; i++) {
  const next = lsTree(repo, commits[i]);
  t = now(); const newBlobs = await l1.ensure(next); const l1Ms = now() - t;
  const nctx = new TreeCtx(next, l1);
  const diff = diffTrees(entries, next);
  t = now(); const dirtyP = updateIncremental(probeG, ctx, nctx, diff, 'probe'); const probeMs = now() - t;
  t = now(); updateIncremental(naiveG, ctx, nctx, diff, 'naive'); const naiveMs = now() - t;
  for (const m of MUT) { updateIncremental(mutG[m], ctx, nctx, diff, m); }
  t = now(); const nfull = buildFull(nctx); const fullMs = now() - t;
  const mut = {}; for (const m of MUT) { const bad = diffSrcs(mutG[m], nfull).length; mut[m] = bad; if (bad) mutG[m] = nfull.clone(); }
  const probeBad = diffSrcs(probeG, nfull), naiveBad = diffSrcs(naiveG, nfull);
  const a = edgeSet(full), b = edgeSet(nfull);
  let churn = 0; for (const e of a) if (!b.has(e)) churn++; for (const e of b) if (!a.has(e)) churn++;
  const row = { i, commit: commits[i], added: diff.added.length, deleted: diff.deleted.length, modified: diff.modified.length,
    newBlobs, l1Ms, dirtyP, probeMs, naiveMs, fullMs, edges: b.size, churn,
    probeEq: probeBad.length === 0, naiveEq: naiveBad.length === 0, probeBad: probeBad.slice(0, 5), naiveBadN: naiveBad.length, naiveBad: naiveBad.slice(0, 3), mut };
  out.write(JSON.stringify(row) + '\n');
  // keep each path independent: never repair probeG from full (that would hide divergence growth)
  naiveG = naiveBad.length ? nfull.clone() : naiveG; // naive is reset so each commit measures one-step error
  entries = next; ctx = nctx; full = nfull;
}
out.end(); l1.close();
