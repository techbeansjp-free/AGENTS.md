// Rendering difference between each variant and its original (#1835). Runs in the container (see browser.mjs). At both
// widths of the case, takes a full-page screenshot (height capped at 8000 px) of the original twice (to see whether the
// page renders the same way twice) and of each variant once, and compares the PNG bytes and the document height.
// Equal bytes mean the same pixels; different bytes are reported as a difference (PNG encoding is deterministic for the
// same pixels in one browser build, so a difference with equal baseline is a pixel difference).
// Usage (in container): node compare.mjs <cases.json> <pairs.json> > compare.json
//   pairs: [{key: "<case>/<trial>", case, original: "/runs/.../original/index.html", variants: {<id>: "/runs/.../index.html"}}]
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {openPage} from './browser.mjs';

const [casesPath, pairsPath] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8')).cases;
const pairs = JSON.parse(fs.readFileSync(pairsPath, 'utf8'));
const browser = await chromium.launch({chromiumSandbox: false});
async function shot(file, size, fixedNow) {
  const o = await openPage(browser, file, {...size, fixedNow});
  try {
    const h = await o.page.evaluate(() => document.documentElement.scrollHeight);
    const png = await o.page.screenshot({fullPage: true, clip: {x: 0, y: 0, width: size.width, height: Math.min(h, 8000)}});
    return {png, height: h};
  } finally { await o.ctx.close(); }
}
const out = {schema: 'asc-1835-compare/v1', pages: {}};
for (const p of pairs) {
  const spec = cases[p.case];
  const rec = {};
  for (const side of ['wide', 'narrow']) {
    const size = {width: spec[side].width, height: spec[side].height};
    try {
      const a = await shot(p.original, size, spec.fixedNow);
      const a2 = await shot(p.original, size, spec.fixedNow);
      const r = {baselineEqual: a.png.equals(a2.png), variants: {}};
      for (const [id, file] of Object.entries(p.variants)) {
        const b = await shot(file, size, spec.fixedNow);
        r.variants[id] = {pixelsEqual: a.png.equals(b.png), heightOriginal: a.height, height: b.height};
      }
      rec[side] = r;
    } catch (e) { rec[side] = {error: String(e).split('\n')[0]}; }
  }
  out.pages[p.key] = rec;
  console.error(`compared ${p.key}`);
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
