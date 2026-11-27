// node --test docs/evidence/1835-design-eval-layers/harness/
// Static tests of degrade.mjs on the #1804 pages (no browser). The rendering checks (control variants render the same
// pixels, degraded variants do not) need Docker: set ASC1835_DOCKER=1 and the pages directory ASC1835_PAGES (output of
// degrade.mjs) with ASC1835_LAYER1 (the out-dir of run-layer1.mjs layer1); otherwise those tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {degradePage, makeVariant, trialsOf, CASES, VARIANTS, colorAtRatio, contrast, parseRgb, loadProbe} from './degrade.mjs';
import {parse, walk, textOf, tokenize} from './html.mjs';

const ALL = Object.keys(CASES).flatMap((c) => trialsOf(c).map((t) => [c, t]));
const probe = loadProbe();

test('36 pages are found', () => { assert.equal(ALL.length, 36); });

test('every variant is either made or excluded with a reason (none dropped)', () => {
  for (const [c, t] of ALL) {
    const p = degradePage(c, t, probe);
    assert.deepEqual(p.records.map((r) => r.variant), ['original', ...VARIANTS.map((v) => v.id)]);
    for (const r of p.records) assert.ok(r.variant === 'original' || r.excluded || p.variants[r.variant], `${c}/${t} ${r.variant}`);
    for (const r of p.records.filter((x) => x.excluded)) assert.ok(r.excluded.length > 5);
  }
});

test('deterministic: two runs give identical bytes', () => {
  for (const [c, t] of ALL) {
    const a = degradePage(c, t, probe), b = degradePage(c, t, probe);
    for (const k of Object.keys(a.variants)) assert.equal(a.variants[k].html, b.variants[k].html, `${c}/${t} ${k}`);
  }
});

// The difference is one insertion (inline style or one CSS rule) at one place: original = prefix + suffix.
function oneInsertion(orig, out) {
  let i = 0; while (i < orig.length && orig[i] === out[i]) i++;
  let j = 0; while (j < orig.length - i && orig[orig.length - 1 - j] === out[out.length - 1 - j]) j++;
  return {changedOrig: orig.slice(i, orig.length - j), inserted: out.slice(i, out.length - j)};
}

test('only one place changes (insertion variants)', () => {
  for (const [c, t] of ALL) {
    const p = degradePage(c, t, probe);
    for (const v of VARIANTS.filter((x) => ['contrast', 'pushout', 'spacing', 'inconsistency'].includes(x.kind))) {
      const r = p.variants[v.id]; if (!r) continue;
      const d = oneInsertion(p.variants.original.html, r.html);
      // the only removed text may be the old style attribute that the edit extended
      assert.ok(d.changedOrig === '' || /^style=|^[^<>]*$/.test(d.changedOrig), `${c}/${t} ${v.id}: removed ${JSON.stringify(d.changedOrig.slice(0, 80))}`);
      assert.ok(!/<\/?(?!style\b)[a-z]/i.test(d.inserted), `${c}/${t} ${v.id}: inserted a tag ${JSON.stringify(d.inserted.slice(0, 80))}`);
      assert.equal(r.rec.edits, 1);
    }
  }
});

test('hierarchy moves one element and changes nothing else', () => {
  let n = 0;
  for (const [c, t] of ALL) {
    const p = degradePage(c, t, probe);
    for (const id of ['hierarchy-strong', 'hierarchy-weak']) {
      const r = p.variants[id]; if (!r) continue; n++;
      const orig = p.variants.original.html;
      const block = orig.slice(...findBlock(orig, r.rec.path));
      // removing the moved block from both texts gives the same text (up to the inserted newline)
      const a = orig.replace(block, '');
      const b = r.html.replace('\n' + block, '');
      assert.equal(b, a, `${c}/${t} ${id}`);
      assert.equal(r.html.split(block).length - 1, 1, `${c}/${t} ${id}: block appears once`);
    }
  }
  assert.ok(n > 0);
});
function findBlock(src, p) {
  let el = parse(src);
  for (const step of p.split('>')) { const [, i] = step.split(':'); el = el.children[Number(i)]; }
  return [el.start, el.end];
}

test('controls keep the same tags, attributes and text', () => {
  const sig = (src) => tokenize(src).filter((x) => x.type === 'start' || x.type === 'end' || x.type === 'raw' || (x.type === 'text' && src.slice(x.start, x.end).trim()))
    .map((x) => (x.type === 'start' ? `<${x.name} ${x.attrs.map((a) => `${a.name}=${a.value}`).sort().join(' ')}>` : x.type === 'end' ? `</${x.name}>` : src.slice(x.start, x.end).trim()));
  for (const [c, t] of ALL) {
    const p = degradePage(c, t, probe);
    for (const id of ['control-attr-order', 'control-whitespace']) {
      const r = p.variants[id]; if (!r) continue;
      assert.notEqual(r.html, p.variants.original.html);
      assert.deepEqual(sig(r.html), sig(p.variants.original.html), `${c}/${t} ${id}`);
      const tree = parse(r.html), t0 = parse(p.variants.original.html);
      assert.equal(textOf(r.html, tree), textOf(p.variants.original.html, t0));
    }
  }
});

test('contrast target colour', () => {
  const c = colorAtRatio(parseRgb('rgb(27, 36, 48)'), parseRgb('rgb(255, 255, 255)'), 1.6);
  assert.ok(Math.abs(c.ratio - 1.6) < 0.05);
  assert.ok(contrast(c, {r: 255, g: 255, b: 255}) < 4.5);
  assert.equal(colorAtRatio(parseRgb('rgb(200, 200, 200)'), parseRgb('rgb(255, 255, 255)'), 3.2), null);
});

test('a variant whose target is missing is excluded, not made', () => {
  const src = '<!doctype html><html><head><style>p{}</style></head><body><p>なし</p></body></html>';
  assert.throws(() => makeVariant(src, 'ui03-dashboard', VARIANTS.find((v) => v.id === 'hierarchy-strong'), null), /対象が静的なHTMLに無い/);
  assert.throws(() => makeVariant(src, 'ui03-dashboard', VARIANTS.find((v) => v.id === 'contrast-strong'), null), /probe/);
});

const L1 = process.env.ASC1835_LAYER1;
test('rendering: controls render the same pixels as the original, degraded variants do not', {skip: !(process.env.ASC1835_DOCKER && L1) && 'set ASC1835_DOCKER=1 and ASC1835_LAYER1'}, () => {
  const r = JSON.parse(fs.readFileSync(path.join(L1, 'layer1.json'), 'utf8'));
  assert.ok(r.pages.length > 0);
  for (const p of r.pages) {
    for (const v of p.variants.filter((x) => !x.excluded && x.variant !== 'original')) {
      for (const side of ['wide', 'narrow']) {
        if (v.group === 'control') assert.equal(v.pixelsEqualToOriginal[side], true, `${p.case}/${p.trial} ${v.variant} ${side}`);
        else if (p.baselineEqual[side]) assert.equal(v.pixelsEqualToOriginal[side], false, `${p.case}/${p.trial} ${v.variant} ${side} (no visible change)`);
      }
    }
  }
});
