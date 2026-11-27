// Deterministic degraded versions of one generated page (#1835, layer 2 material). No randomness: each variant is a
// static text edit of the page's HTML at one location chosen by config/cases.json (and, for the two variants that
// depend on computed styles, config/page-probe.json written by probe.mjs). Variants that cannot be made are recorded
// with the reason, never dropped.
//
// Usage: node degrade.mjs <out-dir> [--case <case-id>] [--trial <A-r1>]
//   -> <out-dir>/<case>/<trial>/<variant>/index.html (+ the page's other files), <out-dir>/manifest.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parse, walk, attr, classes, textOf, normText, describe, pathOf, tokenize} from './html.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const EVIDENCE = path.resolve(ROOT, '..');
export const E1804 = path.join(EVIDENCE, '1804-design-judgment');
export const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/cases.json'), 'utf8')).cases;
const PROBE_FILE = path.join(ROOT, 'config/page-probe.json');
export const loadProbe = () => (fs.existsSync(PROBE_FILE) ? JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8')).pages : {});
export const BLOCK_TAGS = new Set(['section', 'article', 'aside', 'div', 'dl', 'table', 'form', 'fieldset', 'ul', 'ol', 'header', 'footer', 'nav', 'figure', 'p']);
const NOT_TARGET = new Set(['#root', 'html', 'head', 'body', 'main']);
const SKIP_SIBLING = new Set(['script', 'style', 'template', 'noscript', 'link', 'meta']);

// Variant definitions. group: l1 = expected to be caught by layer 1; pass = expected to pass layer 1 but is worse for
// the request; control = no visible change.
export const VARIANTS = [
  {id: 'contrast-strong', group: 'l1', kind: 'contrast', strength: 'strong', ratio: 1.6},
  {id: 'contrast-weak', group: 'l1', kind: 'contrast', strength: 'weak', ratio: 3.2},
  {id: 'pushout', group: 'l1', kind: 'pushout', strength: 'single'},
  {id: 'hierarchy-strong', group: 'pass', kind: 'hierarchy', strength: 'strong'},
  {id: 'hierarchy-weak', group: 'pass', kind: 'hierarchy', strength: 'weak'},
  {id: 'spacing-strong', group: 'pass', kind: 'spacing', strength: 'strong', px: 128},
  {id: 'spacing-weak', group: 'pass', kind: 'spacing', strength: 'weak', px: 48},
  {id: 'inconsistency-strong', group: 'pass', kind: 'inconsistency', strength: 'strong', ring: 3, tint: true},
  {id: 'inconsistency-weak', group: 'pass', kind: 'inconsistency', strength: 'weak', ring: 1, tint: false},
  {id: 'control-attr-order', group: 'control', kind: 'attrOrder', strength: 'none'},
  {id: 'control-whitespace', group: 'control', kind: 'whitespace', strength: 'none'},
];

class Excluded extends Error {}
const exclude = (msg) => { throw new Excluded(msg); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const elements = (el) => el.children.filter((c) => !SKIP_SIBLING.has(c.tag));

// ---- target finding -------------------------------------------------------------------------------------------
export function findTarget(src, tree, spec) {
  const f = spec.find;
  const all = [...walk(tree)].filter((e) => !['script', 'style', 'template', 'noscript'].includes(e.tag));
  let hit = null; let anchor = null;
  if (f.idPattern) {
    const re = new RegExp(f.idPattern);
    hit = all.find((e) => re.test(attr(e, 'id') ?? '')); anchor = `id ~ /${f.idPattern}/`;
  } else if (f.text) {
    for (const t of f.text) {
      const n = normText(t);
      // the deepest element (in document order) whose static text contains the anchor
      const cands = all.filter((e) => (!f.tags || f.tags.includes(e.tag)) && textOf(src, e).includes(n));
      const deepest = cands.filter((e) => !cands.some((d) => d !== e && isAncestor(e, d)));
      if (deepest.length) { hit = deepest[0]; anchor = `text "${t}"${f.tags ? ` in ${f.tags.join('|')}` : ''}`; break; }
    }
  } else if (f.tags) {
    hit = all.find((e) => f.tags.includes(e.tag)); anchor = `first ${f.tags.join('|')}`;
  }
  if (!hit) exclude(`対象が静的なHTMLに無い（${JSON.stringify(f)}。scriptで生成される要素は静的に特定しない）`);
  let el = hit;
  if (spec.block) {
    // mustContain: alternatives tried in order; the block must contain every text of the first alternative that gives
    // a block other than html/body/main.
    const alts = spec.mustContain ?? [[]];
    let found = null;
    for (const alt of alts) {
      const must = alt.map(normText);
      const ok = (e) => BLOCK_TAGS.has(e.tag) && e.parent && elements(e.parent).length >= 2 && must.every((m) => textOf(src, e).includes(m));
      let e = hit;
      while (e && !NOT_TARGET.has(e.tag) && !ok(e)) e = e.parent;
      if (e && !NOT_TARGET.has(e.tag)) { found = e; if (alt.length) anchor += ` / まとまりは ${alt.join('・')} を含む`; break; }
    }
    if (!found) exclude(`まとまりの要素が見つからない（起点 ${describe(hit)}、mustContain ${JSON.stringify(alts)}）`);
    el = found;
  }
  if (NOT_TARGET.has(el.tag)) exclude(`まとまりが${el.tag}になり、1か所の変更にならない（起点 ${describe(hit)}）`);
  return {el, anchor, from: describe(hit)};
}
const isAncestor = (a, d) => { for (let e = d.parent; e; e = e.parent) if (e === a) return true; return false; };

// ---- edits ----------------------------------------------------------------------------------------------------
function applyEdits(src, edits) {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.at - a.at || (b.order ?? 0) - (a.order ?? 0))) out = out.slice(0, e.at) + e.insert + out.slice(e.at + (e.remove ?? 0));
  return out;
}
// Add declarations to the element's inline style (start tag edit only).
function inlineStyleEdit(src, el, decl) {
  const tag = src.slice(el.start, el.openEnd);
  const st = el.attrs.find((a) => a.name === 'style');
  if (st) {
    const v = (st.value ?? '').trim();
    const nv = `${v}${v && !v.endsWith(';') ? ';' : ''}${decl}`;
    const q = nv.includes('"') ? "'" : '"';
    return {at: el.start + st.at, remove: st.raw.length, insert: `style=${q}${nv}${q}`};
  }
  const end = tag.endsWith('/>') ? tag.length - 2 : tag.length - 1;
  return {at: el.start + end, remove: 0, insert: ` style="${decl}"`};
}
// Append a rule at the end of the page's last <style> element (or a new one before </head>).
function cssEdit(src, tree, rule) {
  const styles = [...walk(tree)].filter((e) => e.tag === 'style' && e.closeStart > e.openEnd);
  if (styles.length) { const s = styles[styles.length - 1]; return {at: s.closeStart, remove: 0, insert: `\n${rule}\n`}; }
  const head = [...walk(tree)].find((e) => e.tag === 'head');
  if (!head || head.closeStart === head.end) exclude('styleもheadの終了tagも無く、規則を足せない');
  return {at: head.closeStart, remove: 0, insert: `<style>\n${rule}\n</style>\n`};
}

// ---- colour ---------------------------------------------------------------------------------------------------
export const parseRgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s ?? ''); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return {r: p[0], g: p[1], b: p[2], a: p[3] ?? 1}; };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// The colour on the line from fg to bg whose contrast against bg is the target ratio (bisection, sRGB blend, rounded).
export function colorAtRatio(fg, bg, target) {
  if (contrast(fg, bg) <= target) return null;
  let lo = 0, hi = 1;
  const at = (t) => ({r: Math.round(fg.r + (bg.r - fg.r) * t), g: Math.round(fg.g + (bg.g - fg.g) * t), b: Math.round(fg.b + (bg.b - fg.b) * t)});
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (contrast(at(m), bg) > target) lo = m; else hi = m; }
  const c = at(lo);
  return {...c, ratio: Number(contrast(c, bg).toFixed(3))};
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

// ---- variants -------------------------------------------------------------------------------------------------
const TEXT_TAGS = 'p,li,dd,dt,td,th,caption,label,figcaption,blockquote,address';

export function makeVariant(src, caseId, v, probe) {
  const conf = CASES[caseId];
  const tree = parse(src);
  const rec = {variant: v.id, group: v.group, kind: v.kind, strength: v.strength};
  let edits;
  if (v.kind === 'contrast') {
    const d = probe?.dominant;
    if (!d) exclude('probe（描画後の本文の色と背景）が無い。probe.mjsを先に実行する');
    const fg = parseRgb(d.color), bg = parseRgb(d.bg);
    const c = colorAtRatio(fg, bg, v.ratio);
    if (!c) exclude(`本文の元のコントラスト（${contrast(fg, bg).toFixed(2)}）が目標${v.ratio}以下`);
    const rule = `body,body :is(${TEXT_TAGS}){color:${hex(c)}!important}`;
    edits = [cssEdit(src, tree, rule)];
    Object.assign(rec, {target: `body と ${TEXT_TAGS}`, change: rule, from: {color: d.color, bg: d.bg, ratio: Number(contrast(fg, bg).toFixed(3))}, to: {color: hex(c), ratio: c.ratio}});
  } else if (v.kind === 'pushout' || v.kind === 'spacing') {
    const spec = conf.targets[v.kind];
    const t = findTarget(src, tree, spec);
    const decl = v.kind === 'pushout'
      ? `margin-${spec.edge === 'after' ? 'bottom' : 'top'}:120vh!important`
      : `margin-bottom:${v.px}px!important`;
    edits = [inlineStyleEdit(src, t.el, decl)];
    Object.assign(rec, {target: describe(t.el), path: pathOf(t.el), anchor: t.anchor, anchorElement: t.from, change: `inline style ${decl}`, why: spec.why});
  } else if (v.kind === 'hierarchy') {
    const spec = conf.targets.hierarchy;
    const t = findTarget(src, tree, spec);
    const el = t.el;
    const sibs = elements(el.parent);
    let dest; let where;
    if (v.strength === 'weak') {
      const next = sibs[sibs.indexOf(el) + 1];
      if (!next) exclude(`${describe(el)}の後ろに兄弟の要素が無く、1つ下へ移せない`);
      const into = spec.strongDestination && next.tag === spec.strongDestination ? elements(next)[0] : null;
      if (into) { dest = into.end; where = `${describe(next)} の最初の子 ${describe(into)} の後ろ（1つ下）`; } else { dest = next.end; where = `次の兄弟 ${describe(next)} の後ろ`; }
    } else {
      let container = el.parent;
      if (spec.strongAfterSameClass) {
        const cls = classes(el)[0];
        const same = sibs.filter((k) => k.tag === el.tag && classes(k)[0] === cls);
        const lastSame = same[same.length - 1];
        if (lastSame === el) exclude(`${describe(el)}は既に同じ部品の最下段にある`);
        dest = lastSame.end; where = `同じ部品（${describe(lastSame)}）の最下段の後ろ`;
      } else if (spec.strongDestination) {
        const c = [...walk(tree)].find((e) => e.tag === spec.strongDestination);
        if (c) container = c;
      }
      if (!dest) {
        if (container === el || isAncestor(el, container)) exclude('移す先が対象の内側にある');
        const kids = elements(container).filter((k) => k.tag !== 'footer');
        const last = kids[kids.length - 1];
        if (!last || last === el) exclude(`${describe(el)}は既に${describe(container)}の最下段にあり、移せない`);
        if (last.end <= el.start) exclude(`移す先（${describe(last)}の後ろ）が対象より前にある`);
        dest = last.end; where = `${describe(container)} の最下段（${describe(last)} の後ろ。script・footerより前）`;
      }
    }
    const block = src.slice(el.start, el.end);
    edits = [{at: el.start, remove: el.end - el.start, insert: ''}, {at: dest, remove: 0, insert: `\n${block}`, order: 1}];
    Object.assign(rec, {target: describe(el), path: pathOf(el), anchor: t.anchor, anchorElement: t.from, change: `要素を移動：${where}`, why: spec.why, movedBytes: block.length});
  } else if (v.kind === 'inconsistency') {
    const p = probe?.peers;
    if (!p) exclude(`probeで同じ役割の部品が3つ以上見つからなかった（候補 ${CASES[caseId].targets.peers.join(', ')}）`);
    const radius = p.radius > 0 ? '0px' : '12px';
    const decl = [`border-radius:${radius}!important`, `box-shadow:inset 0 0 0 ${v.ring}px currentColor!important`];
    if (v.tint) decl.push('background-color:color-mix(in srgb,currentColor 12%,transparent)!important');
    const rule = `${p.path}{${decl.join(';')}}`;
    edits = [cssEdit(src, tree, rule)];
    Object.assign(rec, {target: `${p.selector} の2番目（${p.path}）`, peers: p.count, change: rule});
  } else if (v.kind === 'attrOrder') {
    edits = [];
    for (const t of tokenize(src)) {
      if (t.type !== 'start' || t.attrs.length < 2) continue;
      if (new Set(t.attrs.map((a) => a.name)).size !== t.attrs.length) continue;
      const rev = [...t.attrs].reverse().map((a) => a.raw).join(' ');
      edits.push({at: t.start, remove: t.end - t.start, insert: `<${src.slice(t.start + 1, t.start + 1 + t.name.length)} ${rev}${t.selfClosing ? ' /' : ''}>`});
    }
    if (!edits.length) exclude('属性が2つ以上のtagが無い');
    Object.assign(rec, {target: '属性が2つ以上ある全ての開始tag（同名の属性があるものを除く）', change: '属性の並びを逆にする', tags: edits.length});
  } else if (v.kind === 'whitespace') {
    edits = [];
    const pre = new Set(['pre', 'textarea']);
    const walkText = (el, inPre) => {
      const ip = inPre || pre.has(el.tag) || ['script', 'style'].includes(el.tag);
      if (!ip) for (const t of el.texts) { const s = src.slice(t.start, t.end); if (/^\s+$/.test(s) && s.includes('\n') && s !== '\n') edits.push({at: t.start, remove: s.length, insert: '\n'}); }
      for (const c of el.children) walkText(c, ip);
    };
    walkText(tree, false);
    if (!edits.length) exclude('正規化できる空白が無い');
    Object.assign(rec, {target: '要素の間の改行を含む空白だけのtext（pre・textarea・script・styleの中を除く）', change: '1つの改行にする', nodes: edits.length});
  }
  const html = applyEdits(src, edits);
  if (html === src) exclude('変更が生じなかった');
  rec.edits = edits.length;
  return {html, rec};
}

// Files of one page: the HTML and the files it needs next to it (ui08: the design system and the page's CSS).
export function pageFiles(caseId, trial) {
  const conf = CASES[caseId];
  const dir = path.join(E1804, 'results/outputs', caseId, trial);
  const html = fs.readFileSync(path.join(dir, conf.html), 'utf8');
  const extra = {};
  for (const [name, rel] of Object.entries(conf.extraFiles)) {
    const p = path.join(E1804, rel.replace('{case}', caseId).replace('{trial}', trial));
    if (fs.existsSync(p)) extra[name] = fs.readFileSync(p);
  }
  return {html, extra, source: path.relative(EVIDENCE, path.join(dir, conf.html))};
}
export const trialsOf = (caseId) => fs.readdirSync(path.join(E1804, 'results/outputs', caseId)).filter((t) => /^[A-Z]-r\d+$/.test(t)).sort();

export function degradePage(caseId, trial, probeAll = loadProbe()) {
  const {html, extra, source} = pageFiles(caseId, trial);
  const probe = probeAll[`${caseId}/${trial}`];
  const out = {original: {html, rec: {variant: 'original', group: 'original'}}};
  const recs = [{variant: 'original', group: 'original', sha256: sha(html)}];
  for (const v of VARIANTS) {
    try {
      const r = makeVariant(html, caseId, v, probe);
      out[v.id] = r; recs.push({...r.rec, sha256: sha(r.html)});
    } catch (e) {
      if (!(e instanceof Excluded)) throw e;
      recs.push({variant: v.id, group: v.group, kind: v.kind, strength: v.strength, excluded: e.message});
    }
  }
  return {caseId, trial, source, sourceSha256: sha(html), extra, variants: out, records: recs};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const outDir = path.resolve(args[0]);
  const opt = (k) => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
  const probeAll = loadProbe();
  const manifest = {schema: 'asc-1835-degrade-manifest/v1', variants: VARIANTS, probeFile: fs.existsSync(PROBE_FILE) ? 'config/page-probe.json' : null, pages: []};
  for (const caseId of Object.keys(CASES).filter((c) => !opt('--case') || c === opt('--case'))) {
    for (const trial of trialsOf(caseId).filter((t) => !opt('--trial') || t === opt('--trial'))) {
      const p = degradePage(caseId, trial, probeAll);
      for (const [vid, r] of Object.entries(p.variants)) {
        const d = path.join(outDir, caseId, trial, vid);
        fs.mkdirSync(d, {recursive: true});
        fs.writeFileSync(path.join(d, 'index.html'), r.html);
        for (const [name, buf] of Object.entries(p.extra)) fs.writeFileSync(path.join(d, name), buf);
      }
      manifest.pages.push({case: caseId, trial, source: p.source, sourceSha256: p.sourceSha256, variants: p.records});
    }
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const n = manifest.pages.flatMap((p) => p.variants);
  console.log(`pages ${manifest.pages.length}, variants made ${n.filter((r) => !r.excluded).length}, excluded ${n.filter((r) => r.excluded).length}`);
}
