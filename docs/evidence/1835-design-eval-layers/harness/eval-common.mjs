// Shared helpers of the layer-2/3 evaluation tools (#1835): config, seeded randomness, PNG metadata stripping, items.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const EVIDENCE = path.resolve(ROOT, '..');
export const loadConfig = (file = path.join(ROOT, 'config/eval.json')) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Deterministic stream of uniform numbers in [0,1) from (seed, label): sha256 in counter mode.
export function makeRng(seed, label) {
  let counter = 0; const pool = [];
  return () => {
    if (!pool.length) {
      const h = crypto.createHash('sha256').update(`${seed}\0${label}\0${counter++}`).digest();
      for (let i = 0; i < 32; i += 4) pool.push(h.readUInt32BE(i) / 2 ** 32);
    }
    return pool.shift();
  };
}
export function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Random ids that carry no meaning; unique over everything allocated from one allocator.
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
export function idAllocator(rnd, len = 4) {
  const used = new Set();
  return (prefix = '') => {
    for (let n = 0; n < 10000; n++) {
      let s = LETTERS[Math.floor(rnd() * LETTERS.length)];
      while (s.length < len) s += ALPHA[Math.floor(rnd() * ALPHA.length)];
      const id = prefix + s;
      if (!used.has(id)) { used.add(id); return id; }
    }
    throw new Error('id space exhausted');
  };
}

// PNG: keep only the chunks needed to show the pixels. tEXt/zTXt/iTXt/eXIf/tIME/iCCP etc. are dropped.
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'sBIT']);
export function pngChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  const out = []; let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    out.push({type, start: o, end: o + 12 + len});
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}
export function stripPng(buf) {
  const chunks = pngChunks(buf);
  const kept = chunks.filter((c) => PNG_KEEP.has(c.type));
  return {png: Buffer.concat([PNG_SIG, ...kept.map((c) => buf.subarray(c.start, c.end))]), removed: chunks.filter((c) => !PNG_KEEP.has(c.type)).map((c) => c.type)};
}

// Screens and items of the plan (sections 2 and 3). layer2 may be absent (no layer-2 items). Screen key: <case>/<trial>/<variant> (variant "original" for originals).
export const screenKey = (c, t, v) => `${c}/${t}/${v}`;
export const parseScreen = (k) => { const [c, t, v] = k.split('/'); return {case: c, trial: t, variant: v}; };
export function planItems(cfg) {
  const items = [];
  for (const c of Object.keys(cfg.cases)) {
    for (const [v, meta] of Object.entries(cfg.layer2?.variants ?? {})) {
      items.push({id: `L2:${c}:${v}`, layer: 2, case: c, variant: v, kind: meta.kind, strength: meta.strength, control: v === cfg.layer2.control,
        first: screenKey(c, cfg.layer2.base, 'original'), second: screenKey(c, cfg.layer2.base, v)});
    }
    // layer3.pairs (#1852): an explicit list of [trial, trial] per case; otherwise every pair of layer3.trials (#1835)
    const t = cfg.layer3.trials ?? [];
    const pairs = cfg.layer3.pairs ? (cfg.layer3.pairs[c] ?? []) : t.flatMap((a, i) => t.slice(i + 1).map((b) => [a, b]));
    for (const [a, b] of pairs) {
      items.push({id: `L3:${c}:${a}~${b}`, layer: 3, case: c, first: screenKey(c, a, 'original'), second: screenKey(c, b, 'original')});
    }
  }
  return items;
}
export const screensOf = (items) => [...new Set(items.flatMap((i) => [i.first, i.second]))];
export const shotPath = (cfg, renderRoot, key, width) => {
  const s = parseScreen(key);
  return path.join(renderRoot, cfg.renderLayout.replaceAll('{case}', s.case).replaceAll('{trial}', s.trial).replaceAll('{variant}', s.variant).replaceAll('{shot}', cfg.cases[s.case].shots[width]));
};
export const WIDTHS = ['narrow', 'wide'];

// The last JSON object in a model's final text: a ```json block if any, else the last balanced {...}.
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const b of blocks.reverse()) { try { return JSON.parse(b); } catch { /* next */ } }
  // top-level balanced objects, scanned forward with string/escape handling; the last one that parses wins
  let found = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = j; break; }
    }
    if (end < 0) continue;
    try { found = JSON.parse(text.slice(i, end + 1)); i = end; } catch { /* not JSON; try the next '{' */ }
  }
  return found;
}
