// Recursive CTE vs app-side BFS on synthetic graphs (1e5 nodes, 1e6 edges), power-law-ish in-degree.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const [nStr = '100000', mStr = '1000000', file, outFile] = process.argv.slice(2);
const N = Number(nStr), M = Number(mStr);
let seed = 42; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; // mulberry32
const now = () => performance.now();
fs.rmSync(file, { force: true });
const db = new DatabaseSync(file);
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE edge(tree TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(tree, src, kind, dst)) STRICT, WITHOUT ROWID; CREATE INDEX edge_rev ON edge(tree, dst, kind, src);");
const ins = db.prepare("INSERT OR IGNORE INTO edge VALUES ('T', ?, ?, 'imports')");
const id = (i) => 'f:src/m' + i + '.ts';
const rev = new Map();
let t = now(); db.exec('BEGIN');
for (let k = 0; k < M; k++) {
  // mostly "layered" edges (src imports lower-numbered dst, skewed to hubs) + 2% back edges creating cycles
  const s = Math.floor(rnd() * N);
  const d = rnd() < 0.02 ? Math.floor(rnd() * N) : Math.floor(Math.pow(rnd(), 3) * Math.max(1, s));
  if (s === d) continue;
  ins.run(id(s), id(d));
  (rev.get(id(d)) ?? rev.set(id(d), []).get(id(d))).push(id(s));
}
db.exec('COMMIT'); const writeMs = now() - t;
const cnt = db.prepare('SELECT count(*) n FROM edge').get().n;
const cte = db.prepare("WITH RECURSIVE r(n) AS (SELECT ? UNION SELECT e.src FROM r CROSS JOIN edge e ON e.tree='T' AND e.dst = r.n AND e.kind='imports') SELECT count(*) c FROM r");
const bfs = (s0) => { const seen = new Set([s0]); const st = [s0]; while (st.length) { const x = st.pop(); for (const y of rev.get(x) ?? []) if (!seen.has(y)) { seen.add(y); st.push(y); } } return seen.size; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
const tc = [], tb = [], sz = []; let mismatch = 0;
for (let i = 0; i < 40; i++) {
  const s = id(Math.floor(Math.pow(rnd(), 2) * N)); // bias toward hubs = large blast radius
  let a = now(); const c = cte.get(s).c; tc.push(now() - a);
  a = now(); const b = bfs(s); tb.push(now() - a);
  if (c !== b) mismatch++; sz.push(b);
}
t = now(); const all = db.prepare("SELECT src, dst FROM edge WHERE tree='T'").all(); const loadMs = now() - t;
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const res = { N, edges: cnt, writeMs, dbBytes: fs.statSync(file).size, loadAllEdgesMs: loadMs, loaded: all.length, mismatch,
  reachSize: { p50: q(sz, .5), max: q(sz, 1) }, cteMs: { p50: q(tc, .5), p95: q(tc, .95), max: q(tc, 1) }, bfsMs: { p50: q(tb, .5), p95: q(tb, .95), max: q(tb, 1) } };
console.log(JSON.stringify(res));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
