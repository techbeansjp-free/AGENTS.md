// V-trace on ASC itself: deterministic ID ledger (definitions) vs references, across history.
// Definition = first cell of a Markdown table row under docs/specs (except the trace table), a Markdown heading,
// or `Scenario: <ID>` in a .feature file. Reference = every other occurrence, with `X-01〜06` ranges expanded.
import { lsTree, CatFile, git, firstParentCommits } from './prototype.mjs';
import fs from 'node:fs';

const [repo, outFile] = process.argv.slice(2); // a full clone of this repository
const ID = /\b(?:REQ|AC|SCN|TERM|FR|INV|QLT|UNIT|INT|NFR|ADR)-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{2,4}[a-z]?\b/g;
const TEXT = /\.(md|feature|mjs|ts|js|json|ya?ml|txt)$/;
const cat = new CatFile(repo);
const blobCache = new Map();
async function scan(entries) {
  const defs = new Map(), refs = []; // refs: {id, path, expanded}
  const todo = [...entries].filter(([p]) => TEXT.test(p));
  const bodies = await Promise.all(todo.map(([, e]) => blobCache.get(e.blob) ?? cat.read(e.blob).then((b) => { const s = b.length > 4e6 ? '' : b.toString('utf8'); blobCache.set(e.blob, s); return s; })));
  todo.forEach(([p], i) => {
    const text = bodies[i]; if (!text) return;
    const ledger = p.startsWith('docs/specs/') && !p.includes('15_要件追跡');
    for (const line of text.split('\n')) {
      const first = line.match(/^\|\s*([A-Z]+-[A-Z0-9-]+)\s*\|/)?.[1];
      const head = line.match(/^#{1,6}\s+.*?\b([A-Z]+-[A-Z0-9-]+-\d{2,4})\b/)?.[1];
      const scen = p.endsWith('.feature') ? line.match(/^\s*Scenario(?: Outline)?:\s*([A-Z]+-[A-Z0-9-]+)/)?.[1] : null;
      const acc = ledger ? [...(line.match(/^\s*-\s*受け入れ条件[:：]\s*(.+)$/)?.[1].matchAll(ID) ?? [])].map((m) => m[0]) : [];
      const defined = new Set([ledger && first, ledger && head, scen, ...acc].filter(Boolean));
      for (const d of defined) if (!defs.has(d)) defs.set(d, p);
      // ranges like SCN-1437-01〜06 / SCN-1437-01~06
      for (const m of line.matchAll(/\b([A-Z]+-[A-Z0-9-]*?-)(\d{2,4})\s*[〜~]\s*(\d{2,4})\b/g)) {
        const [, pre, a, b] = m; const w = a.length;
        for (let k = Number(a); k <= Number(b) && k - Number(a) < 200; k++) refs.push({ id: pre + String(k).padStart(w, '0'), path: p, expanded: true });
      }
      for (const m of line.matchAll(ID)) if (!defined.has(m[0])) refs.push({ id: m[0], path: p, expanded: false });
    }
  });
  return { defs, refs };
}
const cls = (p) => p.startsWith('docs/reviews/') ? 'reviews' : p.startsWith('docs/specs/') ? 'specs' : p.startsWith('test/') ? 'test' : /^(src|dist|bin)\//.test(p) ? 'code' : p.startsWith('skills/') || p.startsWith('.agent-skill-chain/') ? 'skills' : 'other';
const commits = firstParentCommits(repo, 2000);
const v05 = git(repo, ['rev-parse', 'db49ed048']).toString().trim(); // commit that replaced the v0.4 tree
const sample = [...new Set([...commits.filter((_, i) => i % 100 === 0), git(repo, ['rev-parse', v05 + '^']).toString().trim(), v05, commits.at(-1)])];
const everDefined = new Set(); const rows = [];
for (const c of sample) {
  const { defs, refs } = await scan(lsTree(repo, c));
  for (const d of defs.keys()) everDefined.add(d);
  const by = {};
  let resolved = 0, dangling = 0, danglingExpanded = 0, resolvedViaRange = 0;
  for (const r of refs) {
    const k = cls(r.path); by[k] ??= { refs: 0, dangling: 0 }; by[k].refs++;
    if (defs.has(r.id)) { resolved++; if (r.expanded) resolvedViaRange++; } else { dangling++; by[k].dangling++; if (r.expanded) danglingExpanded++; }
  }
  rows.push({ commit: c.slice(0, 9), date: git(repo, ['show', '-s', '--format=%ad', '--date=short', c]).toString().trim(), defs: defs.size, refs: refs.length, resolved, dangling, resolvedViaRange, danglingExpanded, by, _dang: refs.filter((r) => !defs.has(r.id)).map((r) => r.id) });
}
for (const r of rows) {
  const d = r._dang; delete r._dang;
  r.danglingEverDefined = d.filter((x) => everDefined.has(x)).length; // stale: defined in some sampled tree
  r.danglingNeverDefined = d.length - r.danglingEverDefined;
  const nev = d.filter((x) => !everDefined.has(x)); r.neverIssueLocal = nev.filter((x) => /^[A-Z]+-\d{3,4}-\d+/.test(x)).length; r.neverOther = nev.length - r.neverIssueLocal;
  r.topNever = Object.entries(d.filter((x) => !everDefined.has(x)).reduce((a, x) => { const p = x.replace(/-\d+[a-z]?$/, ''); a[p] = (a[p] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
}
console.table(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'by' && k !== 'topNever'))));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ sample: rows, everDefined: everDefined.size }, null, 1));
cat.close();
