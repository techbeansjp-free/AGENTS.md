// Storage alternative: content-addressed L2 results. A file's resolution result depends only on its own blob,
// the outcomes of its probes, and the contents of hit config files; so key = hash(src, blob, probe outcomes, cfg blobs).
// Compare rows needed: per-tree copy vs (tree,src)->key mapping + distinct payloads.
import { L1, TreeCtx, lsTree, buildFull, updateIncremental, diffTrees, firstParentCommits, isConfig, sha256 } from './prototype.mjs';
const [repo, nStr] = process.argv.slice(2);
const commits = firstParentCommits(repo, Number(nStr));
const l1 = new L1(repo, false);
let entries = lsTree(repo, commits[0]); await l1.ensure(entries);
let ctx = new TreeCtx(entries, l1); const g = buildFull(ctx);
let perTreeRows = 0, mapRows = 0; const payload = new Map(); let keyMismatch = 0;
const keyOf = (src, r, ents) => sha256(src + '\0' + ents.get(src).blob + '\0' + r.probes.map((p) => { const c = p.slice(0, p.lastIndexOf('\t')); return p + (isConfig(c) && ents.has(c) ? ':' + ents.get(c).blob : ''); }).join('|'));
const account = (ents) => {
  for (const [src, r] of g.results) {
    const rows = r.edges.length + r.probes.length + r.unresolved.length;
    perTreeRows += rows; mapRows++;
    const k = keyOf(src, r, ents); const body = r.edges.join('|') + '#' + r.unresolved.join('|');
    if (payload.has(k)) { if (payload.get(k).body !== body) keyMismatch++; } else payload.set(k, { body, rows });
  }
};
account(entries);
for (const c of commits.slice(1)) {
  const next = lsTree(repo, c); await l1.ensure(next); const nctx = new TreeCtx(next, l1);
  updateIncremental(g, ctx, nctx, diffTrees(entries, next), 'probe'); entries = next; ctx = nctx; account(entries);
}
let payloadRows = 0; for (const v of payload.values()) payloadRows += v.rows;
console.log(JSON.stringify({ repo, trees: commits.length, perTreeRows, casRows: mapRows + payloadRows, mapRows, payloadRows, distinctResults: payload.size, ratio: +(perTreeRows / (mapRows + payloadRows)).toFixed(1), keyMismatch }));
l1.close();
