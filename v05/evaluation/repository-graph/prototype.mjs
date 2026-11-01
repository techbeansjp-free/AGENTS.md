// Prototype of the revised repository graph (L1 blob facts / L2 tree resolution).
// L1 = pure function of blob bytes + extractor version. L2 = pure function of the tree.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path/posix';

const require = createRequire(import.meta.url);
export const ts = require('typescript');

export const EXTRACTOR = 'ts@1';
export const CFG_EXTRACTOR = 'cfg@2';
const MAX_BLOB = 2 * 1024 * 1024;
const CODE_RE = /\.(?:[cm]?[jt]sx?)$/;
const RESOLVE_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json'];
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const BUILTINS = new Set(require('node:module').builtinModules);

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ignored = (p) => p.includes('node_modules/');
export const isCode = (p) => CODE_RE.test(p) && !ignored(p);
const base = (p) => p.slice(p.lastIndexOf('/') + 1);
export const isTsconfig = (p) => /^(?:tsconfig|jsconfig).*\.json$/.test(base(p)) && !ignored(p);
export const isPkg = (p) => base(p) === 'package.json' && !ignored(p);
export const isConfig = (p) => isTsconfig(p) || isPkg(p);

// ---------------------------------------------------------------- git access
export function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 30, ...opts });
}
export function lsTree(repo, rev) {
  const out = git(repo, ['ls-tree', '-r', '-z', '--full-tree', rev]);
  const m = new Map();
  let i = 0;
  while (i < out.length) {
    const z = out.indexOf(0, i);
    const rec = out.toString('utf8', i, z);
    i = z + 1;
    const tab = rec.indexOf('\t');
    const [mode, type, sha] = rec.slice(0, tab).split(' ');
    if (type === 'blob') m.set(rec.slice(tab + 1), { blob: sha, mode });
  }
  return m;
}
export class CatFile {
  constructor(repo) {
    this.p = spawn('git', ['-C', repo, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.q = []; this.buf = Buffer.alloc(0);
    this.p.stdout.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
  }
  drain() {
    while (this.q.length) {
      const nl = this.buf.indexOf(10);
      if (nl < 0) return;
      const head = this.buf.toString('utf8', 0, nl).split(' ');
      if (head[1] === 'missing') { this.buf = this.buf.subarray(nl + 1); this.q.shift().reject(Error('missing ' + head[0])); continue; }
      const size = Number(head[2]);
      if (this.buf.length < nl + 1 + size + 1) return;
      const body = this.buf.subarray(nl + 1, nl + 1 + size);
      this.buf = this.buf.subarray(nl + 2 + size);
      this.q.shift().resolve(Buffer.from(body));
    }
  }
  read(sha) { return new Promise((resolve, reject) => { this.q.push({ resolve, reject }); this.p.stdin.write(sha + '\n'); }); }
  close() { this.p.stdin.end(); }
}

// ---------------------------------------------------------------- L1 extractors
function lineOf(starts, pos) { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1; } return lo + 1; }
export function extractCode(text, withDefs = true) {
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const info = ts.preProcessFile(text, true, true);
  const refs = [];
  for (const f of info.importedFiles) refs.push({ kind: /^[./]/.test(f.fileName) ? 'import_rel' : 'import_bare', target: f.fileName, line: lineOf(starts, f.pos) });
  for (const f of info.referencedFiles) refs.push({ kind: 'import_rel', target: f.fileName.startsWith('.') ? f.fileName : './' + f.fileName, line: lineOf(starts, f.pos) });
  for (const m of text.matchAll(/\b(?:import|require)\s*\(\s*(?!['"`]|\))/g)) refs.push({ kind: 'import_dynamic', target: '<dynamic>', line: lineOf(starts, m.index) });
  const defs = [];
  if (withDefs) {
    const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, false);
    for (const st of sf.statements) {
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const names = st.name ? [st.name] : st.declarationList ? st.declarationList.declarations.map((d) => d.name) : [];
      for (const n of names) if (n && ts.isIdentifier(n)) defs.push({ kind: exported ? 'export' : 'symbol', name: n.text, line: lineOf(starts, n.pos) });
    }
  }
  return { status: 'ok', refs, defs };
}
export function extractConfig(p, text) {
  let json;
  if (isTsconfig(p)) { const r = ts.parseConfigFileTextToJson(p, text); if (r.error) return { status: 'parse_error', cfg: {} }; json = r.config; }
  else { try { json = JSON.parse(text); } catch { return { status: 'parse_error', cfg: {} }; } }
  if (isTsconfig(p)) {
    const co = json?.compilerOptions ?? {};
    return { status: 'ok', cfg: { extends: json?.extends ?? null, baseUrl: co.baseUrl ?? null, paths: co.paths ?? null, customConditions: Array.isArray(co.customConditions) ? co.customConditions : null } };
  }
  return { status: 'ok', cfg: { name: typeof json?.name === 'string' ? json.name : null, exports: json?.exports ?? null, imports: json?.imports ?? null, types: json?.types ?? json?.typings ?? null, main: json?.main ?? null } };
}
// L1 cache keyed by (blob, extractor). Config extraction is keyed on blob too: the tsconfig-vs-package
// distinction comes from the file name, so the key includes the config flavour.
export class L1 {
  constructor(repo, withDefs = true) { this.cat = new CatFile(repo); this.facts = new Map(); this.withDefs = withDefs; this.scanned = 0; }
  key(p, blob) { return isCode(p) ? blob + ':' + EXTRACTOR : blob + ':' + CFG_EXTRACTOR + (isTsconfig(p) ? ':ts' : ':pkg'); }
  async ensure(entries) {
    const todo = [];
    for (const [p, e] of entries) if ((isCode(p) || isConfig(p)) && !this.facts.has(this.key(p, e.blob))) { this.facts.set(this.key(p, e.blob), null); todo.push([p, e.blob]); }
    const bodies = await Promise.all(todo.map(([, b]) => this.cat.read(b)));
    todo.forEach(([p, b], i) => {
      const buf = bodies[i];
      let f;
      if (buf.length > MAX_BLOB) f = { status: 'skipped', refs: [], defs: [], cfg: {} };
      else if (isCode(p)) f = extractCode(buf.toString('utf8'), this.withDefs);
      else f = extractConfig(p, buf.toString('utf8'));
      this.facts.set(this.key(p, b), f);
    });
    this.scanned += todo.length;
    return todo.length;
  }
  get(p, entries) { return this.facts.get(this.key(p, entries.get(p).blob)); }
  close() { this.cat.close(); }
}

// ---------------------------------------------------------------- L2 resolution (pure function of tree)
export class TreeCtx {
  constructor(entries, l1) {
    this.entries = entries; this.l1 = l1;
    this.pkgs = new Map();
    for (const [p] of entries) if (isPkg(p)) {
      const n = l1.get(p, entries)?.cfg?.name;
      if (n) { const d = path.dirname(p); this.pkgs.set(n, this.pkgs.has(n) ? null : d === '.' ? '' : d); } // null = ambiguous
    }
  }
  has(p) { return this.entries.has(p); }
  cfg(p) { return this.has(p) ? this.l1.get(p, this.entries)?.cfg ?? {} : null; }
}
const join = (...xs) => { const j = path.normalize(path.join(...xs)); return j === '.' ? '' : j.replace(/^\.\//, ''); };
const escapes = (p) => p === '..' || p.startsWith('../') || p.startsWith('/');

export function resolveFile(ctx, src) {
  const probes = new Map(); // candidate -> hit
  const probe = (c) => { const h = ctx.has(c); probes.set(c, h || probes.get(c) === true); return h; };
  const vprobe = (key, hit) => probes.set(key, hit);
  const edges = new Set(), unresolved = new Set();
  const facts = ctx.l1.get(src, ctx.entries);
  if (!facts || facts.status !== 'ok') return { edges: [], unresolved: [], probes: [] };
  // governing tsconfig: nearest ancestor tsconfig.json / jsconfig.json, then its extends chain
  let gov = null;
  for (let d = path.dirname(src); ; d = path.dirname(d)) {
    const dd = d === '.' ? '' : d;
    for (const n of ['tsconfig.json', 'jsconfig.json']) { const c = join(dd, n); if (!gov && probe(c)) gov = c; }
    if (gov || dd === '') break;
  }
  const chain = [];
  for (let c = gov, guard = 0; c && guard < 16; guard++) {
    chain.push(c);
    const ext = ctx.cfg(c)?.extends;
    const next = (Array.isArray(ext) ? ext[0] : ext);
    if (typeof next !== 'string' || !next.startsWith('.')) break;
    let cand = join(path.dirname(c), next);
    if (!cand.endsWith('.json')) cand += '.json';
    if (!probe(cand)) break;
    c = cand;
  }
  let pathsMap = null, pathsBase = null, baseUrl = null, custom = null;
  for (const c of chain) {
    const cf = ctx.cfg(c) ?? {};
    if (custom === null && cf.customConditions) custom = cf.customConditions;
    if (baseUrl === null && typeof cf.baseUrl === 'string') baseUrl = join(path.dirname(c), cf.baseUrl);
    if (pathsMap === null && cf.paths && typeof cf.paths === 'object') { pathsMap = cf.paths; pathsBase = path.dirname(c); }
  }
  if (pathsMap && baseUrl !== null) pathsBase = baseUrl; else if (pathsMap) pathsBase = pathsBase === '.' ? '' : pathsBase;

  const probeBase = (b) => {
    if (escapes(b)) return null;
    const ext = path.extname(b);
    const cands = [];
    if (ext) { for (const t of JS_TO_TS[ext] ?? []) cands.push(b.slice(0, -ext.length) + t); if (ext === '.js' || ext === '.jsx') cands.push(b.slice(0, -ext.length) + '.d.ts'); cands.push(b); }
    for (const e of RESOLVE_EXTS) cands.push(b + e);
    for (const e of RESOLVE_EXTS) cands.push(join(b, 'index' + e));
    for (const c of cands) if (probe(c)) return c;
    return null;
  };
  const active = new Set(['types', 'import', 'default', ...(custom ?? [])]);
  const pickExport = (v) => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) { for (const x of v) { const r = pickExport(x); if (r) return r; } return null; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) if (active.has(k)) { const r = pickExport(v[k]); if (r) return r; }
    return null;
  };
  const matchMap = (map, key) => { // exact key, else longest '*' pattern
    if (key in map) return pickExport(map[key]);
    let best = null;
    for (const k of Object.keys(map)) if (k.includes('*')) { const [a, b] = k.split('*'); if (key.startsWith(a) && key.endsWith(b) && (!best || a.length > best[1].length)) best = [k, a, b]; }
    if (!best) return null;
    const t = pickExport(map[best[0]]);
    return t && t.replace('*', key.slice(best[1].length, key.length - best[2].length));
  };
  // nearest package.json of the importing file (for '#' subpath imports)
  let ownPkg = null;
  for (let d = path.dirname(src); ; d = path.dirname(d)) { const dd = d === '.' ? '' : d; const c = join(dd, 'package.json'); if (probe(c)) { ownPkg = c; break; } if (dd === '') break; }
  for (const r of facts.refs) {
    if (r.kind === 'import_dynamic') { unresolved.add(`import_dynamic\t<dynamic>\tdynamic`); continue; }
    const spec = r.target.split('?')[0];
    let hit = null, reason = 'not_found';
    if (r.kind === 'import_rel') {
      hit = probeBase(spec.startsWith('/') ? spec.slice(1) : join(path.dirname(src), spec));
    } else {
      if (spec.startsWith('node:') || BUILTINS.has(spec.split('/')[0])) { unresolved.add(`import_bare\t${spec}\texternal`); continue; }
      if (spec.startsWith('#')) {
        const im = ownPkg ? ctx.cfg(ownPkg)?.imports : null;
        const t = im && typeof im === 'object' ? matchMap(im, spec) : null;
        if (t && t.startsWith('./')) hit = probeBase(join(path.dirname(ownPkg), t));
        if (hit) edges.add(hit); else unresolved.add(`${r.kind}\t${r.target}\t${t && !t.startsWith('./') ? 'external' : 'not_found'}`);
        continue;
      }
      if (pathsMap) {
        let best = null;
        for (const pat of Object.keys(pathsMap)) {
          const star = pat.indexOf('*');
          if (star < 0 ? pat === spec : (spec.startsWith(pat.slice(0, star)) && spec.endsWith(pat.slice(star + 1)) && spec.length >= pat.length - 1))
            if (!best || pat.length > best.length) best = pat;
        }
        if (best) {
          const star = best.indexOf('*');
          const m = star < 0 ? '' : spec.slice(star, spec.length - (best.length - star - 1));
          for (const t of [].concat(pathsMap[best])) { if (typeof t !== 'string') continue; hit = probeBase(join(pathsBase ?? '', t.replace('*', m))); if (hit) break; }
        }
      }
      if (!hit && baseUrl !== null) hit = probeBase(join(baseUrl, spec));
      if (!hit) {
        const seg = spec.split('/');
        const name = spec.startsWith('@') ? seg.slice(0, 2).join('/') : seg[0];
        const sub = seg.slice(spec.startsWith('@') ? 2 : 1).join('/');
        const dir = ctx.pkgs.get(name);
        vprobe('pkg:' + name, dir !== undefined && dir !== null);
        if (dir === null) reason = 'ambiguous';
        else if (dir === undefined) reason = 'external';
        else {
          const pj = ctx.cfg(join(dir, 'package.json')) ?? {};
          let target;
          const ex = pj.exports;
          if (ex && typeof ex === 'object' && !Array.isArray(ex) && Object.keys(ex).some((k) => k.startsWith('.'))) {
            target = matchMap(ex, sub ? './' + sub : '.');
          } else if (ex && !sub) target = pickExport(ex);
          else if (!sub) target = pj.types || pj.main || 'index';
          else target = sub;
          if (target) hit = probeBase(join(dir, target));
        }
      }
    }
    if (hit) edges.add(hit); else unresolved.add(`${r.kind}\t${r.target}\t${reason}`);
  }
  return { edges: [...edges].sort(), unresolved: [...unresolved].sort(), probes: [...probes].map(([c, h]) => c + '\t' + (h ? 1 : 0)).sort() };
}

// ---------------------------------------------------------------- L2 state, full and incremental
export class Graph {
  constructor() { this.results = new Map(); this.probeIndex = new Map(); }
  set(src, r) {
    this.drop(src);
    this.results.set(src, r);
    for (const pr of r.probes) { const c = pr.slice(0, pr.lastIndexOf('\t')); let s = this.probeIndex.get(c); if (!s) this.probeIndex.set(c, (s = new Set())); s.add(src); }
  }
  drop(src) {
    const old = this.results.get(src); if (!old) return;
    for (const pr of old.probes) this.probeIndex.get(pr.slice(0, pr.lastIndexOf('\t')))?.delete(src);
    this.results.delete(src);
  }
  digest() {
    const h = crypto.createHash('sha256');
    for (const src of [...this.results.keys()].sort()) { const r = this.results.get(src); h.update(src + '\n' + r.edges.join('|') + '\n' + r.unresolved.join('|') + '\n' + r.probes.join('|') + '\n'); }
    return h.digest('hex');
  }
  edgeDigest() { // edges + unresolved only (the observable graph)
    const h = crypto.createHash('sha256');
    for (const src of [...this.results.keys()].sort()) { const r = this.results.get(src); h.update(src + '\n' + r.edges.join('|') + '\n' + r.unresolved.join('|') + '\n'); }
    return h.digest('hex');
  }
  edgeCount() { let n = 0; for (const r of this.results.values()) n += r.edges.length; return n; }
  clone() { const g = new Graph(); for (const [s, r] of this.results) g.set(s, r); return g; }
}
export function buildFull(ctx) {
  const g = new Graph();
  for (const [p] of ctx.entries) if (isCode(p)) g.set(p, resolveFile(ctx, p));
  return g;
}
export function diffTrees(a, b) {
  const added = [], deleted = [], modified = [];
  for (const [p, e] of b) { const o = a.get(p); if (!o) added.push(p); else if (o.blob !== e.blob) modified.push(p); }
  for (const p of a.keys()) if (!b.has(p)) deleted.push(p);
  return { added, deleted, modified };
}
// mode: 'probe' (designed invalidation) or 'naive' (only changed source files)
export function updateIncremental(g, oldCtx, newCtx, diff, mode = 'probe') {
  const dirty = new Set();
  for (const p of [...diff.added, ...diff.modified]) if (isCode(p)) dirty.add(p);
  if (mode !== 'naive') {
    const hitBy = (c) => { for (const s of g.probeIndex.get(c) ?? []) dirty.add(s); };
    // mutants (for measuring the power of the equivalence test): each drops one invalidation rule
    if (mode !== 'noAdd') for (const p of diff.added) hitBy(p);
    if (mode !== 'noDel') for (const p of diff.deleted) hitBy(p);
    if (mode !== 'noCfg') for (const p of diff.modified) if (isConfig(p) || p.endsWith('.json')) hitBy(p);
    if (mode !== 'noPkg') for (const p of [...diff.added, ...diff.deleted, ...diff.modified]) if (isPkg(p)) {
      for (const ctx of [oldCtx, newCtx]) { const n = ctx.has(p) ? ctx.cfg(p)?.name : null; if (n) hitBy('pkg:' + n); }
    }
  }
  for (const p of diff.deleted) g.drop(p);
  for (const p of dirty) if (newCtx.has(p) && isCode(p)) g.set(p, resolveFile(newCtx, p)); else g.drop(p);
  return dirty.size;
}
export function firstParentCommits(repo, n) {
  return git(repo, ['rev-list', '--first-parent', '-n', String(n), 'HEAD']).toString().trim().split('\n').reverse();
}
