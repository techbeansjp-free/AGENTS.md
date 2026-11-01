// V3/V5/V6: SQLite store (revised DDL subset), write cost, per-tree copy-forward, DB size,
// recursive CTE vs app-side BFS, SCC distribution, blast-radius size distribution, FTS5.
import { L1, TreeCtx, lsTree, buildFull, updateIncremental, diffTrees, firstParentCommits, isCode } from './prototype.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const [repo, dbFile, outFile, kStr = '50'] = process.argv.slice(2);
const K = Number(kStr);
const now = () => performance.now();
const res = { repo };
for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) fs.rmSync(f, { force: true });
const db = new DatabaseSync(dbFile);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
CREATE TABLE blob_scan(blob TEXT NOT NULL, extractor TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(blob, extractor)) STRICT, WITHOUT ROWID;
CREATE TABLE fact_def(blob TEXT NOT NULL, extractor TEXT NOT NULL, ord INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, line INTEGER NOT NULL, PRIMARY KEY(blob, extractor, ord)) STRICT, WITHOUT ROWID;
CREATE INDEX fact_def_name ON fact_def(name, kind);
CREATE TABLE fact_ref(blob TEXT NOT NULL, extractor TEXT NOT NULL, ord INTEGER NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, line INTEGER NOT NULL, PRIMARY KEY(blob, extractor, ord)) STRICT, WITHOUT ROWID;
CREATE TABLE tree_root(tree TEXT PRIMARY KEY, parent_tree TEXT, build_mode TEXT NOT NULL, edge_digest TEXT NOT NULL) STRICT, WITHOUT ROWID;
CREATE TABLE tree_entry(tree TEXT NOT NULL, path TEXT NOT NULL, blob TEXT NOT NULL, mode TEXT NOT NULL, PRIMARY KEY(tree, path)) STRICT, WITHOUT ROWID;
CREATE TABLE edge(tree TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(tree, src, kind, dst)) STRICT, WITHOUT ROWID;
CREATE INDEX edge_rev ON edge(tree, dst, kind, src);
CREATE TABLE resolution_probe(tree TEXT NOT NULL, candidate TEXT NOT NULL, src_path TEXT NOT NULL, hit INTEGER NOT NULL, PRIMARY KEY(tree, candidate, src_path)) STRICT, WITHOUT ROWID;
CREATE TABLE unresolved(tree TEXT NOT NULL, src_path TEXT NOT NULL, ref_kind TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(tree, src_path, ref_kind, target)) STRICT, WITHOUT ROWID;
CREATE VIRTUAL TABLE def_fts USING fts5(name, kind UNINDEXED, blob UNINDEXED, tokenize='trigram');`);

const commits = firstParentCommits(repo, K + 1);
import { git } from './prototype.mjs';
function require_git(c) { return git(repo, ['rev-parse', c + '^{tree}']).toString().trim(); }

const l1 = new L1(repo, true);
let entries = lsTree(repo, commits[0]);
let t = now(); await l1.ensure(entries); res.l1ScanMs = now() - t;
let ctx = new TreeCtx(entries, l1);
t = now(); let g = buildFull(ctx); res.resolveMs = now() - t;
res.codeFiles = [...entries.keys()].filter(isCode).length; res.edges = g.edgeCount();

// ---- L1 write (all scanned blobs)
const insScan = db.prepare('INSERT OR IGNORE INTO blob_scan VALUES (?,?,?)');
const insDef = db.prepare('INSERT OR IGNORE INTO fact_def VALUES (?,?,?,?,?,?)');
const insRef = db.prepare('INSERT OR IGNORE INTO fact_ref VALUES (?,?,?,?,?,?)');
const insFts = db.prepare('INSERT INTO def_fts VALUES (?,?,?)');
const writtenBlobs = new Set();
function writeL1() {
  for (const [key, f] of l1.facts) {
    if (writtenBlobs.has(key) || !f) continue; writtenBlobs.add(key);
    const [blob, ...ex] = key.split(':'); const extractor = ex.join(':');
    insScan.run(blob, extractor, f.status);
    (f.defs ?? []).forEach((d, i) => { insDef.run(blob, extractor, i, d.kind, d.name, d.line); insFts.run(d.name, d.kind, blob); });
    (f.refs ?? []).forEach((r, i) => insRef.run(blob, extractor, i, r.kind, r.target, r.line));
  }
}
t = now(); db.exec('BEGIN'); writeL1(); db.exec('COMMIT'); res.l1WriteMs = now() - t;

// ---- L2 full write for one tree
const insRoot = db.prepare('INSERT INTO tree_root VALUES (?,?,?,?)');
const insEntry = db.prepare('INSERT INTO tree_entry VALUES (?,?,?,?)');
const insEdge = db.prepare("INSERT INTO edge VALUES (?,?,?,'imports')");
const insProbe = db.prepare('INSERT INTO resolution_probe VALUES (?,?,?,?)');
const insUnres = db.prepare('INSERT OR IGNORE INTO unresolved VALUES (?,?,?,?,?)');
function writeSrc(tree, src, r) {
  for (const d of r.edges) insEdge.run(tree, src, d);
  for (const p of r.probes) { const i = p.lastIndexOf('\t'); insProbe.run(tree, p.slice(0, i), src, Number(p.slice(i + 1))); }
  for (const u of r.unresolved) { const [k, tg, why] = u.split('\t'); insUnres.run(tree, src, k, tg, why); }
}
function writeFull(tree, entries, g) {
  insRoot.run(tree, null, 'full', g.edgeDigest());
  for (const [p, e] of entries) insEntry.run(tree, p, e.blob, e.mode);
  for (const [src, r] of g.results) writeSrc(tree, src, r);
}
let tree = require_git(commits[0]);
t = now(); db.exec('BEGIN'); writeFull(tree, entries, g); db.exec('COMMIT'); res.l2FullWriteMs = now() - t;
const size = () => { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); return fs.statSync(dbFile).size; };
res.dbBytesOneTree = size();
res.rows = Object.fromEntries(['tree_entry', 'edge', 'resolution_probe', 'unresolved', 'fact_ref', 'fact_def'].map((x) => [x, db.prepare(`SELECT count(*) n FROM ${x}`).get().n]));

// ---- copy-forward incremental writes over K commits, then GC to 3 trees
const incW = [], written = [tree];
for (let i = 1; i < commits.length; i++) {
  const next = lsTree(repo, commits[i]); await l1.ensure(next);
  const nctx = new TreeCtx(next, l1); const diff = diffTrees(entries, next);
  const before = new Map([...g.results].map(([s, r]) => [s, r]));
  updateIncremental(g, ctx, nctx, diff, 'probe');
  const changed = new Set(diff.deleted);
  for (const [s, r] of g.results) if (before.get(s) !== r) changed.add(s);
  const ntree = require_git(commits[i]);
  if (ntree === tree || db.prepare('SELECT 1 FROM tree_root WHERE tree=?').get(ntree)) { res.treeReuse = (res.treeReuse ?? 0) + 1; entries = next; ctx = nctx; tree = ntree; continue; }
  t = now(); db.exec('BEGIN');
  writeL1();
  insRoot.run(ntree, tree, 'incremental', g.edgeDigest());
  db.exec('CREATE TEMP TABLE IF NOT EXISTS chg(p TEXT PRIMARY KEY)'); db.exec('DELETE FROM chg');
  const insChg = db.prepare('INSERT OR IGNORE INTO chg VALUES (?)'); for (const s of changed) insChg.run(s);
  db.prepare('INSERT INTO tree_entry SELECT ?, path, blob, mode FROM tree_entry WHERE tree=?').run(ntree, tree);
  for (const p of diff.deleted) db.prepare('DELETE FROM tree_entry WHERE tree=? AND path=?').run(ntree, p);
  for (const p of [...diff.added, ...diff.modified]) db.prepare('INSERT OR REPLACE INTO tree_entry VALUES (?,?,?,?)').run(ntree, p, next.get(p).blob, next.get(p).mode);
  db.prepare("INSERT INTO edge SELECT ?, src, dst, kind FROM edge WHERE tree=? AND src NOT IN (SELECT p FROM chg)").run(ntree, tree);
  db.prepare('INSERT INTO resolution_probe SELECT ?, candidate, src_path, hit FROM resolution_probe WHERE tree=? AND src_path NOT IN (SELECT p FROM chg)').run(ntree, tree);
  db.prepare('INSERT INTO unresolved SELECT ?, src_path, ref_kind, target, reason FROM unresolved WHERE tree=? AND src_path NOT IN (SELECT p FROM chg)').run(ntree, tree);
  for (const s of changed) if (g.results.has(s)) writeSrc(ntree, s, g.results.get(s));
  db.exec('COMMIT'); incW.push(now() - t); written.push(ntree);
  // verify the stored tree equals the in-memory graph (store-level equivalence)
  const stored = db.prepare("SELECT count(*) n FROM edge WHERE tree=?").get(ntree).n;
  if (stored !== g.edgeCount()) res.storeMismatch = (res.storeMismatch ?? 0) + 1;
  entries = next; ctx = nctx; tree = ntree;
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
res.incWriteMs = { n: incW.length, p50: q(incW, 0.5), p95: q(incW, 0.95), max: q(incW, 1) };
res.dbBytesAfterK = size();
const keep = [...new Set(written)].slice(-3); if (!keep.includes(tree)) keep.push(tree);
db.exec('BEGIN');
for (const tbl of ['tree_entry', 'edge', 'resolution_probe', 'unresolved', 'tree_root']) db.prepare(`DELETE FROM ${tbl} WHERE tree NOT IN (${keep.map(() => '?').join(',')})`).run(...keep);
db.exec('COMMIT'); db.exec('VACUUM');
res.dbBytesGC3 = size();
res.packBytes = Number(git(repo, ['count-objects', '-v']).toString().match(/size-pack: (\d+)/)[1]) * 1024;

// ---- reachability: recursive CTE vs app BFS on the current tree (reverse = blast radius)
let tl = now(); const edges = db.prepare("SELECT src, dst FROM edge WHERE tree=?").all(tree); res.loadEdgesMs = now() - tl;
const rev = new Map(); const nodes = new Set();
for (const { src, dst } of edges) { (rev.get(dst) ?? rev.set(dst, []).get(dst)).push(src); nodes.add(src); nodes.add(dst); }
const bfs = (seed) => { const seen = new Set([seed]); const st = [seed]; while (st.length) { const x = st.pop(); for (const y of rev.get(x) ?? []) if (!seen.has(y)) { seen.add(y); st.push(y); } } return seen; };
const cte = db.prepare(`WITH RECURSIVE r(n) AS (SELECT ? UNION SELECT e.src FROM r CROSS JOIN edge e ON e.tree = ? AND e.dst = r.n AND e.kind='imports') SELECT n FROM r`);
const seeds = [...nodes].sort().filter((_, i) => i % Math.max(1, Math.floor(nodes.size / 200)) === 0).slice(0, 200);
const tc = [], tb = []; let mismatch = 0; const sizes = [];
for (const s of seeds) {
  let a = now(); const A = new Set(cte.all(s, tree).map((r) => r.n)); tc.push(now() - a);
  a = now(); const B = bfs(s); tb.push(now() - a);
  if (A.size !== B.size || [...A].some((x) => !B.has(x))) mismatch++;
  sizes.push(B.size - 1);
}
const codeN = res.codeFiles;
const naive = db.prepare(`WITH RECURSIVE r(n) AS (SELECT ? UNION SELECT e.src FROM edge e JOIN r ON e.dst = r.n WHERE e.tree = ? AND e.kind='imports') SELECT n FROM r`);
res.naivePlan = db.prepare('EXPLAIN QUERY PLAN ' + naive.sourceSQL).all('x', tree).map((r) => r.detail).join(' | ');
res.reach = { seeds: seeds.length, mismatch, cteMs: { p50: q(tc, 0.5), p95: q(tc, 0.95) }, bfsMs: { p50: q(tb, 0.5), p95: q(tb, 0.95) },
  blastFrac: { p50: q(sizes, 0.5) / codeN, p90: q(sizes, 0.9) / codeN, max: q(sizes, 1) / codeN, zero: sizes.filter((x) => x === 0).length / sizes.length } };
// ---- SCC (iterative Tarjan) on the import graph
const fwd = new Map(); for (const { src, dst } of edges) (fwd.get(src) ?? fwd.set(src, []).get(src)).push(dst);
let idx = 0; const index = new Map(), low = new Map(), on = new Set(), stack = [], comps = [];
for (const v0 of nodes) {
  if (index.has(v0)) continue;
  const work = [[v0, 0]]; index.set(v0, idx); low.set(v0, idx); idx++; stack.push(v0); on.add(v0);
  while (work.length) {
    const fr = work[work.length - 1]; const [v] = fr; const ns = fwd.get(v) ?? [];
    if (fr[1] < ns.length) { const w = ns[fr[1]++]; if (!index.has(w)) { index.set(w, idx); low.set(w, idx); idx++; stack.push(w); on.add(w); work.push([w, 0]); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w))); }
    else { work.pop(); if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u), low.get(v))); }
      if (low.get(v) === index.get(v)) { const c = []; let w; do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v); comps.push(c.length); } }
  }
}
const nontriv = comps.filter((c) => c > 1).sort((a, b) => b - a);
res.scc = { nodes: nodes.size, comps: comps.length, nontrivial: nontriv.length, top5: nontriv.slice(0, 5), largestFracOfCode: (nontriv[0] ?? 1) / codeN };
// ---- FTS5 trigram name lookup
const fq = db.prepare("SELECT count(*) n FROM def_fts WHERE name MATCH ?");
const ft = []; for (const term of ['parse', 'Schema', 'resolve', 'config', 'plugin']) { const a = now(); fq.get('"' + term + '"'); ft.push(now() - a); }
res.ftsMs = { max: Math.max(...ft), rows: db.prepare('SELECT count(*) n FROM def_fts').get().n };
fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
l1.close();
