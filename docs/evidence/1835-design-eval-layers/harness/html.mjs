// Minimal static HTML scanner (#1835). No dependency. It locates elements in the source text so that a degradation can
// be applied as a text edit at known offsets. It is not a full HTML5 parser: it handles comments, doctype, raw-text
// elements (script, style, textarea, title), void elements, and the implicit closes that generated pages use
// (p, li, dt/dd, tr, td/th, option). Elements created by scripts at run time are not visible here.
export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
export const RAW = new Set(['script', 'style', 'textarea', 'title']);
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const IMPLIED = {li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], option: ['option']};
const ATTR = /([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;

// Attributes of a start tag (text between the name and '>'), each with its raw text and offset inside the tag.
export function parseAttrs(tagText) {
  const m = /^<[A-Za-z][^\s/>]*/.exec(tagText);
  const body = tagText.slice(m[0].length, tagText.endsWith('/>') ? -2 : -1);
  const out = [];
  ATTR.lastIndex = 0;
  for (let a = ATTR.exec(body); a; a = ATTR.exec(body)) {
    let v = a[2] ?? null;
    if (v && /^["']/.test(v)) v = v.slice(1, -1);
    out.push({name: a[1].toLowerCase(), value: v, raw: a[0], at: m[0].length + a.index});
  }
  return out;
}

// Tokens: {type: 'start'|'end'|'text'|'comment'|'doctype'|'raw', start, end, name?, attrs?, selfClosing?}
export function tokenize(src) {
  const toks = [];
  let i = 0;
  const pushText = (a, b) => { if (b > a) toks.push({type: 'text', start: a, end: b}); };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { pushText(i, src.length); break; }
    pushText(i, lt);
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4); const end = e < 0 ? src.length : e + 3;
      toks.push({type: 'comment', start: lt, end}); i = end; continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const e = src.indexOf('>', lt); const end = e < 0 ? src.length : e + 1;
      toks.push({type: 'doctype', start: lt, end}); i = end; continue;
    }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(src.slice(lt, lt + 64));
    if (!m) { pushText(lt, lt + 1); i = lt + 1; continue; }
    // find the end of the tag, skipping quoted attribute values
    let j = lt + m[0].length; let q = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    const end = Math.min(j + 1, src.length);
    const name = m[2].toLowerCase();
    if (m[1]) { toks.push({type: 'end', start: lt, end, name}); i = end; continue; }
    const text = src.slice(lt, end);
    const tok = {type: 'start', start: lt, end, name, attrs: parseAttrs(text), selfClosing: text.endsWith('/>')};
    toks.push(tok);
    i = end;
    if (RAW.has(name)) {
      const re = new RegExp(`</${name}\\s*>`, 'ig'); re.lastIndex = end;
      const c = re.exec(src);
      const close = c ? c.index : src.length;
      if (close > end) toks.push({type: 'raw', start: end, end: close, parent: name});
      if (c) { toks.push({type: 'end', start: c.index, end: c.index + c[0].length, name}); i = c.index + c[0].length; } else i = src.length;
    }
  }
  return toks;
}

// Element tree. Each element: {tag, start (of start tag), openEnd, closeStart, end, attrs, children, parent, texts:[{start,end}]}
// closeStart/end are the offsets of the end tag; for void or implicitly closed elements closeStart === end (no end tag).
export function parse(src) {
  const toks = tokenize(src);
  const root = {tag: '#root', start: 0, openEnd: 0, closeStart: src.length, end: src.length, attrs: [], children: [], parent: null, texts: []};
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const closeTop = (at) => { const e = stack.pop(); e.closeStart = at; e.end = at; };
  for (const t of toks) {
    if (t.type === 'text') { top().texts.push({start: t.start, end: t.end}); continue; }
    if (t.type === 'start') {
      if (P_CLOSERS.has(t.name) && top().tag === 'p') closeTop(t.start);
      const imp = IMPLIED[t.name];
      if (imp && imp.includes(top().tag)) closeTop(t.start);
      const el = {tag: t.name, start: t.start, openEnd: t.end, closeStart: t.end, end: t.end, attrs: t.attrs, children: [], parent: top(), texts: []};
      top().children.push(el);
      if (!VOID.has(t.name) && !t.selfClosing) stack.push(el);
      continue;
    }
    if (t.type === 'end') {
      const k = stack.map((e) => e.tag).lastIndexOf(t.name);
      if (k <= 0) continue; // stray end tag
      while (stack.length - 1 > k) closeTop(t.start);
      const e = stack.pop(); e.closeStart = t.start; e.end = t.end;
    }
  }
  while (stack.length > 1) closeTop(src.length);
  return root;
}

export function* walk(el) { for (const c of el.children) { yield c; yield* walk(c); } }
export const attr = (el, name) => el.attrs.find((a) => a.name === name)?.value ?? null;
export const classes = (el) => (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
const norm = (s) => String(s).normalize('NFKC').replace(/\s+/g, '');
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Static text of an element (text nodes outside script/style), normalised (NFKC, no whitespace).
export function textOf(src, el) {
  if (['script', 'style', 'template', 'noscript'].includes(el.tag)) return '';
  // document order: interleave own text nodes and children by offset
  const parts = [...el.texts.map((t) => ({at: t.start, s: decode(src.slice(t.start, t.end))})), ...el.children.map((c) => ({at: c.start, s: textOf(src, c)}))];
  return norm(parts.sort((a, b) => a.at - b.at).map((p) => p.s).join(''));
}
export const normText = norm;

// A short human-readable description of an element (for manifests).
export function describe(el) {
  const id = attr(el, 'id'); const cls = classes(el);
  return `${el.tag}${id ? `#${id}` : ''}${cls.length ? `.${cls.join('.')}` : ''}`;
}
// Path of the element from the root: tag and index among element siblings, e.g. "html>body:1>div:0".
export function pathOf(el) {
  const p = [];
  for (let e = el; e && e.parent; e = e.parent) p.unshift(`${e.tag}:${e.parent.children.indexOf(e)}`);
  return p.join('>');
}
