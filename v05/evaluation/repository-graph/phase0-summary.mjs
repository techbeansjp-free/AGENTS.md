// Aggregate Phase 0 rows: micro recall of late files, predicted-set size, precision, and paired comparison vs baselines.
import fs from 'node:fs';
const KEYS = ['imp1', 'impRev', 'id', 'graph', 'sameDir', 'coChange'];
const all = [];
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) continue;
  const rows = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const ev = rows.filter((r) => r.lateExisting > 0);
  const agg = { repo: f.replace(/.*p0_|\.jsonl/g, ''), multiCommitPRs: rows.length, withLateExisting: ev.length, lateExisting: ev.reduce((a, r) => a + r.lateExisting, 0), newLate: rows.reduce((a, r) => a + r.newLate, 0) };
  for (const k of KEYS) {
    const hits = ev.reduce((a, r) => a + r.pred[k][1], 0), size = ev.reduce((a, r) => a + r.pred[k][0], 0);
    agg[k] = { recall: +(hits / Math.max(1, agg.lateExisting)).toFixed(3), prAnyHit: +(ev.filter((r) => r.pred[k][1] > 0).length / Math.max(1, ev.length)).toFixed(3), meanSize: +(size / Math.max(1, ev.length)).toFixed(1), precision: +(hits / Math.max(1, size)).toFixed(3) };
  }
  // paired: graph vs coChange (same k by construction)
  agg.graphVsCo = { graphBetter: ev.filter((r) => r.pred.graph[1] > r.pred.coChange[1]).length, coBetter: ev.filter((r) => r.pred.coChange[1] > r.pred.graph[1]).length };
  // late files predicted by graph but not by coChange or sameDir would need per-file data; approximate with union bound
  agg.graphOnly = { lateFiles: ev.reduce((a, r) => a + (r.graphOnly ?? 0), 0), prs: ev.filter((r) => r.graphOnly > 0).length, rowsWithField: ev.filter((r) => 'graphOnly' in r).length };
  agg.baseUnion = { recall: +(ev.reduce((a, r) => a + (r.baseUnion?.[1] ?? 0), 0) / Math.max(1, agg.lateExisting)).toFixed(3) };
  const rv = rows.filter((r) => r.review?.late > 0); const RL = rv.reduce((a, r) => a + r.review.late, 0);
  agg.reviewFound = { prs: rv.length, lateFiles: RL, graphRecall: +(rv.reduce((a, r) => a + r.review.graph, 0) / Math.max(1, RL)).toFixed(3), coRecall: +(rv.reduce((a, r) => a + r.review.coChange, 0) / Math.max(1, RL)).toFixed(3), sameDirRecall: +(rv.reduce((a, r) => a + r.review.sameDir, 0) / Math.max(1, RL)).toFixed(3), graphOnly: rv.reduce((a, r) => a + r.review.graphOnly, 0), graphOnlyPrs: rv.filter((r) => r.review.graphOnly > 0).length, graphNotCoChange: rv.every((r) => 'graphNotCo' in r.review) ? rv.reduce((a, r) => a + r.review.graphNotCo, 0) : null, meanGraphSize: +(rv.reduce((a, r) => a + r.pred.graph[0], 0) / Math.max(1, rv.length)).toFixed(1) };
  all.push(agg);
}
for (const a of all) console.log(JSON.stringify(a));
