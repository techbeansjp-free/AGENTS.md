// Phase 0: does a dependency/trace graph predict the files a PR had to touch *later* (after its first commit)?
// Late files are a proxy for impact discovered during the work/review. Predictors are computed at the PR base
// from the first commit's files only, and compared with non-graph baselines (same directory, historical co-change).
import { L1, TreeCtx, lsTree, buildFull, resolveFile, git, CatFile, ts } from './prototype.mjs';
import path from 'node:path/posix';
import fs from 'node:fs';

const [repo, branch, outFile, maxPrs = '400'] = process.argv.slice(2);
const sh = (a) => git(repo, a).toString().trim();
const NOISE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|Cargo\.lock|poetry\.lock|uv\.lock)$|(^|\/)(dist|build|vendor|node_modules|\.terraform)\//;
const isNoise = (p) => NOISE.test(p) || p.startsWith('docs/reviews/') || p.startsWith('.agent-skill-chain/managed-runtime/');
const chain = new Set(sh(['rev-list', '--first-parent', 'origin/' + branch]).split('\n'));
const parents = (c) => sh(['rev-list', '--parents', '-n', '1', c]).split(' ').slice(1);
const filesOf = (c) => { const p = parents(c); if (p.length !== 1) return null; return sh(['diff-tree', '--no-commit-id', '-r', '--name-only', '--no-renames', p[0], c]).split('\n').filter(Boolean); };

// ---------- lightweight extractors for non-JS languages (Phase 0 only; Phase 1 must verify each against an oracle)
const LANG = (p) => /\.(?:[cm]?[jt]sx?|astro|vue|svelte|mdx)$/.test(p) ? 'js' : p.endsWith('.py') ? 'py' : p.endsWith('.php') ? 'php' : p.endsWith('.rs') ? 'rs' : p.endsWith('.tf') ? 'tf' : null;
function liteRefs(lang, text) {
  const out = [];
  if (lang === 'py') {
    for (const m of text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+([^\n#]+)/gm)) out.push({ k: 'pyfrom', mod: m[1], names: m[2].replace(/[()\\]/g, '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) });
    for (const m of text.matchAll(/^\s*import\s+([\w., ]+)/gm)) for (const x of m[1].split(',')) out.push({ k: 'pyimp', mod: x.trim().split(/\s+/)[0] });
  } else if (lang === 'php') {
    for (const m of text.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*|get_(?:template|stylesheet)_directory\(\)\s*\.\s*|dirname\(__FILE__\)\s*\.\s*)?['"]([^'"]+\.php)['"]/g)) out.push({ k: 'phpinc', p: m[1], rootRel: /get_(?:template|stylesheet)_directory/.test(m[0]) });
    for (const m of text.matchAll(/\bget_template_part\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/g)) out.push({ k: 'phptpl', p: m[1], s: m[2] });
    for (const m of text.matchAll(/^\s*use\s+([\w\\]+)/gm)) out.push({ k: 'phpuse', ns: m[1] });
  } else if (lang === 'rs') {
    for (const m of text.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) out.push({ k: 'rsmod', name: m[1] });
    for (const m of text.matchAll(/\buse\s+(crate|super|self)((?:::\w+)+)/g)) out.push({ k: 'rsuse', root: m[1], segs: m[2].split('::').filter(Boolean) });
  } else if (lang === 'tf') {
    for (const m of text.matchAll(/\bsource\s*=\s*"(\.{1,2}\/[^"]+)"/g)) out.push({ k: 'tfmod', p: m[1] });
  }
  return out;
}
function liteResolve(entries, files, src, refs, extra) {
  const has = (p) => entries.has(p); const dir = path.dirname(src); const res = new Set();
  const j = (...x) => { const r = path.normalize(path.join(...x)); return r.startsWith('..') ? null : r.replace(/^\.\//, ''); };
  for (const r of refs) {
    if (r.k === 'pyfrom' || r.k === 'pyimp') {
      const dots = r.mod.match(/^\.*/)[0].length; const rest = r.mod.slice(dots).split('.').filter(Boolean);
      const bases = dots ? [j(dir, ...Array(dots - 1).fill('..'))] : extra.pyRoots;
      for (const b of bases) { if (b === null) continue;
        const mods = [rest, ...(r.names ?? []).map((n) => [...rest, n])];
        for (const m of mods) for (const c of [j(b, ...m) + '.py', j(b, ...m, '__init__.py')]) if (c && has(c)) res.add(c); }
    } else if (r.k === 'phpinc') { for (const c of [r.rootRel ? r.p.replace(/^\//, '') : j(dir, r.p.replace(/^\//, '')), r.p.replace(/^\//, '')]) if (c && has(c)) { res.add(c); break; } }
    else if (r.k === 'phptpl') { for (const c of [r.p + (r.s ? '-' + r.s : '') + '.php', r.p + '.php']) if (has(c)) res.add(c); }
    else if (r.k === 'phpuse') { for (const [pre, d] of extra.psr4) if (r.ns.startsWith(pre)) { const c = j(d, r.ns.slice(pre.length).replace(/\\/g, '/') + '.php'); if (c && has(c)) res.add(c); } }
    else if (r.k === 'rsmod') { const b = /(^|\/)(mod|lib|main)\.rs$/.test(src) ? dir : j(dir, path.basename(src, '.rs')); for (const c of [j(b, r.name + '.rs'), j(b, r.name, 'mod.rs')]) if (c && has(c)) res.add(c); }
    else if (r.k === 'rsuse') {
      const crateSrc = extra.rsCrate(src); if (!crateSrc) continue;
      let b = r.root === 'crate' ? crateSrc : r.root === 'super' ? path.dirname(dir) : dir;
      for (let i = r.segs.length; i > 0; i--) { const s = r.segs.slice(0, i); const c1 = j(b, ...s) + '.rs', c2 = j(b, ...s, 'mod.rs'); if (has(c1)) { res.add(c1); break; } if (has(c2)) { res.add(c2); break; } }
    } else if (r.k === 'tfmod') { const d = j(dir, r.p); if (d !== null) for (const f of files) if (path.dirname(f) === d && f.endsWith('.tf')) res.add(f); }
  }
  return [...res];
}
// ---------- ID trace: tokens shaped like ledger IDs; edges between files sharing a non-ubiquitous ID
const IDRE = /\b(?:[A-Z]{2,6}-(?:[A-Z0-9]+-)*\d{2,4})\b/g;

const l1 = new L1(repo, false); const cat = new CatFile(repo); const textCache = new Map();
const readText = async (blob) => { if (textCache.has(blob)) return textCache.get(blob); const b = await cat.read(blob); const t = b.length > 2e6 ? '' : b.toString('utf8'); textCache.set(blob, t); return t; };
const liteCache = new Map();
async function graphAt(commit) {
  const entries = lsTree(repo, commit); const files = [...entries.keys()];
  await l1.ensure(entries);
  const ctx = new TreeCtx(entries, l1);
  const js = buildFull(ctx);
  const fwd = new Map(); for (const [s, r] of js.results) fwd.set(s, new Set(r.edges));
  for (const [f, e] of entries) if (/\.(?:astro|vue|svelte|mdx)$/.test(f) && !isNoise(f)) {
    const t = await readText(e.blob);
    const script = [...t.matchAll(/^---\n([\s\S]*?)\n---/g), ...t.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n') + (f.endsWith('.mdx') ? '\n' + t.split('\n').filter((l) => /^(?:import|export)\s/.test(l)).join('\n') : '');
    const refs = ts.preProcessFile(script, true, true).importedFiles.map((x) => ({ kind: /^[./]/.test(x.fileName) ? 'import_rel' : 'import_bare', target: x.fileName, line: 0 }));
    const key = l1.key(f, e.blob); const saved = l1.facts.get(key);
    l1.facts.set(key, { status: 'ok', refs, defs: [] });
    fwd.set(f, new Set(resolveFile(ctx, f).edges));
    if (saved === undefined) l1.facts.delete(key); else l1.facts.set(key, saved);
  }
  // extra context for lite resolvers
  const pyRoots = [...new Set(['', ...files.filter((f) => /(^|\/)(pyproject\.toml|setup\.py|setup\.cfg|manage\.py)$/.test(f)).map((f) => path.dirname(f).replace(/^\.$/, '')), ...files.filter((f) => f.startsWith('src/')).length ? ['src'] : []])];
  const psr4 = [];
  for (const f of files.filter((x) => x.endsWith('composer.json') && !x.includes('vendor/'))) { try { const c = JSON.parse(await readText(entries.get(f).blob)); for (const [pre, d] of Object.entries(c.autoload?.['psr-4'] ?? {})) for (const dd of [].concat(d)) psr4.push([pre, path.normalize(path.join(path.dirname(f), dd)).replace(/^\.\/?/, '')]); } catch { /* malformed composer.json: no PSR-4 roots from it */ } }
  const cargoDirs = files.filter((f) => f.endsWith('Cargo.toml')).map((f) => path.dirname(f).replace(/^\.$/, ''));
  const rsCrate = (src) => { let best = null; for (const d of cargoDirs) if ((d === '' || src.startsWith(d + '/')) && (best === null || d.length > best.length)) best = d; return best === null ? null : path.join(best, 'src').replace(/^\.\//, ''); };
  const extra = { pyRoots, psr4, rsCrate };
  const ids = new Map(); // id -> Set(files)
  for (const f of files) {
    const lang = LANG(f); const isText = /\.(md|mdx|feature|ya?ml|txt|json|py|php|rs|tf|[cm]?[jt]sx?|astro|vue)$/.test(f);
    if (!isText || isNoise(f)) continue;
    const blob = entries.get(f).blob; const t = await readText(blob);
    if (lang && lang !== 'js') {
      const key = blob + lang; let refs = liteCache.get(key); if (!refs) liteCache.set(key, (refs = liteRefs(lang, t)));
      fwd.set(f, new Set(liteResolve(entries, files, f, refs, extra)));
    }
    for (const m of t.matchAll(IDRE)) { let s = ids.get(m[0]); if (!s) ids.set(m[0], (s = new Set())); s.add(f); }
  }
  const rev = new Map(); for (const [s, ds] of fwd) for (const d of ds) (rev.get(d) ?? rev.set(d, new Set()).get(d)).add(s);
  return { entries, files, fwd, rev, ids };
}
const reach = (adj, seeds, maxN = 1e9) => { const seen = new Set(seeds); const st = [...seeds]; while (st.length && seen.size < maxN) { const x = st.pop(); for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); st.push(y); } } for (const s of seeds) seen.delete(s); return seen; };

// co-change history (baseline): counts over the 1000 first-parent commits before each base, built incrementally
const chainList = [...chain].reverse(); // oldest -> newest
const chainIdx = new Map(chainList.map((c, i) => [c, i]));
const commitFiles = new Map();
const cfiles = (c) => { if (!commitFiles.has(c)) { const p = parents(c); commitFiles.set(c, p.length ? sh(['diff-tree', '--no-commit-id', '-r', '--name-only', '--no-renames', '-m', '--first-parent', c]).split('\n').filter(Boolean) : []); } return commitFiles.get(c); };
function coChange(baseIdx, seeds, k, exists) {
  const score = new Map();
  for (let i = Math.max(0, baseIdx - 1000); i <= baseIdx; i++) { const fs_ = cfiles(chainList[i]); if (fs_.length > 50) continue; if (!fs_.some((f) => seeds.has(f))) continue; for (const f of fs_) if (!seeds.has(f) && exists(f) && !isNoise(f)) score.set(f, (score.get(f) ?? 0) + 1); }
  return new Set([...score].sort((a, b) => b[1] - a[1]).slice(0, k).map(([f]) => f));
}

const prs = sh(['for-each-ref', '--format=%(refname)', 'refs/pull']).split('\n').filter((r) => /^refs\/pull\/\d+\/head$/.test(r))
  .map((r) => ({ ref: r, n: Number(r.split('/')[2]) })).sort((a, b) => b.n - a.n).slice(0, Number(maxPrs));
const out = fs.createWriteStream(outFile); const skip = {};
const graphCache = new Map();
for (const { ref, n } of prs) {
  const head = sh(['rev-parse', ref]);
  const walk = []; let c = head, ok = true;
  while (!chain.has(c)) { walk.push(c); const p = parents(c); if (!p.length || walk.length > 150) { ok = false; break; } c = p[0]; }
  if (!ok) { skip.noBase = (skip.noBase ?? 0) + 1; continue; }
  if (!walk.length) { skip.onChain = (skip.onChain ?? 0) + 1; continue; }
  const base = c; const commits = walk.reverse().filter((x) => parents(x).length === 1);
  if (commits.length < 2) { skip.single = (skip.single ?? 0) + 1; continue; }
  const F0 = new Set(filesOf(commits[0]).filter((f) => !isNoise(f)));
  const later = new Set(), laterReview = new Set();
  const REVIEW = /review|レビュー|指摘|是正|address|feedback|coderabbit|comment|修正依頼|nit/i;
  for (const x of commits.slice(1)) { const msg = sh(['log', '-1', '--format=%s%n%b', x]); for (const f of filesOf(x)) if (!isNoise(f) && !F0.has(f)) { later.add(f); if (REVIEW.test(msg)) laterReview.add(f); } }
  if (!F0.size) { skip.emptyF0 = (skip.emptyF0 ?? 0) + 1; continue; }
  let g = graphCache.get(base); if (!g) { g = await graphAt(base); graphCache.clear(); graphCache.set(base, g); }
  const L = new Set([...later].filter((f) => g.entries.has(f))); // late files that existed at base (new files cannot be predicted)
  const newLate = later.size - L.size;
  const seeds = new Set([...F0].filter((f) => g.entries.has(f)));
  const imp1 = new Set([...seeds].flatMap((s) => [...(g.fwd.get(s) ?? []), ...(g.rev.get(s) ?? [])]).filter((f) => !seeds.has(f)));
  const impRev = reach(g.rev, seeds, 5000);
  const idSet = new Set(); const seedIds = new Set();
  for (const s of seeds) for (const [id, fsx] of g.ids) if (fsx.has(s) && fsx.size <= 30) seedIds.add(id);
  for (const id of seedIds) for (const f of g.ids.get(id)) if (!seeds.has(f)) idSet.add(f);
  const graphU = new Set([...imp1, ...idSet]);
  const sameDir = new Set(g.files.filter((f) => !seeds.has(f) && !isNoise(f) && [...seeds].some((s) => path.dirname(s) === path.dirname(f))));
  const co = coChange(chainIdx.get(base) ?? 0, seeds, Math.max(graphU.size, 5), (f) => g.entries.has(f));
  const hit = (S) => [...L].filter((f) => S.has(f)).length;
  const LR = [...laterReview].filter((f) => g.entries.has(f)); const hitR = (S) => LR.filter((f) => S.has(f)).length;
  const graphOnly = [...L].filter((f) => graphU.has(f) && !co.has(f) && !sameDir.has(f));
  const baseU = new Set([...co, ...sameDir]);
  out.write(JSON.stringify({ n, commits: commits.length, F0: F0.size, late: later.size, lateExisting: L.size, newLate,
    pred: { imp1: [imp1.size, hit(imp1)], impRev: [impRev.size, hit(impRev)], id: [idSet.size, hit(idSet)], graph: [graphU.size, hit(graphU)], sameDir: [sameDir.size, hit(sameDir)], coChange: [co.size, hit(co)] },
    review: { late: LR.length, graph: hitR(graphU), coChange: hitR(co), sameDir: hitR(sameDir), graphOnly: LR.filter((f) => graphU.has(f) && !co.has(f) && !sameDir.has(f)).length, graphNotCo: LR.filter((f) => graphU.has(f) && !co.has(f)).length, sample: LR.slice(0, 4) },
    graphOnly: graphOnly.length, graphOnlySample: graphOnly.slice(0, 4), baseUnion: [baseU.size, hit(baseU)], lateSample: [...L].slice(0, 6) }) + '\n');
}
out.end(); console.log(JSON.stringify({ repo, prs: prs.length, skip })); l1.close(); cat.close();
