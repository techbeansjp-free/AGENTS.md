// Deterministic initial-view indicators for one generated page (#1815). Runs in the #1807 tool container (--network none).
// Usage: node first-view.mjs <cases.json> <case-id> <index.html> <gold.json of #1807>   -> JSON on stdout
// For each width of cases.json (narrow, wide; viewport width x height, no scroll, page loaded + 300 ms, every non-local
// request aborted as in #1807 gold-check.mjs):
//   answerFound / answerMissing : firstView items whose text appears in the text of the nodes visible in the initial view
//                                 (node rectangle intersects the viewport horizontally and vertically, height > 0, the
//                                 parent element passes checkVisibility (display, visibility, opacity) and is not in the
//                                 body of a closed <details>; texts concatenated in document order, NFKC, no whitespace).
//   selectorsInView             : each firstView selector has a rendered element whose rectangle intersects the viewport.
//   answerAll                   : every item found and every selector in view.
//   screensToAnswer             : per item, the smallest k (1..8) such that the item appears in the text of the visible
//                                 nodes whose top is above k viewport heights (page scrolled from the top); null if never.
//   hiddenRequired              : #1807 gold `required` items that are in the page's text nodes (script/style/template/
//                                 noscript excluded) but not in the rendered text (document.body.innerText) at load, i.e.
//                                 reachable only through an operation (expand, tab, hover, another view).
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';

const [casesPath, caseId, htmlPath, goldPath] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(casesPath, 'utf8')).cases[caseId];
const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'))[spec.goldKey];
const norm = (s) => String(s).normalize('NFKC').replace(/\s+/g, '').replace(/[〜～]/g, '~');
const has = (text, alts) => alts.some((a) => text.includes(norm(a)));
const file = 'file://' + path.resolve(htmlPath);
const dir = path.dirname(path.resolve(htmlPath));
const browser = await chromium.launch({chromiumSandbox: false});
const out = {schema: 'asc-1815-first-view/v1', case: caseId, widths: {}};
let external = 0;
try {
  for (const side of ['narrow', 'wide']) {
    const {width, height} = spec[side];
    const fv = spec.firstView[side];
    const ctx = await browser.newContext({viewport: {width, height}});
    await ctx.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if ((u.protocol === 'file:' && decodeURIComponent(u.pathname).startsWith(dir)) || ['data:', 'blob:'].includes(u.protocol)) return r.continue();
      external += 1; return r.abort('blockedbyclient');
    });
    const page = await ctx.newPage();
    await page.goto(file, {waitUntil: 'load', timeout: 20000});
    await page.waitForTimeout(300);
    const m = await page.evaluate((selectors) => {
      const nodes = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const pe = n.parentElement;
        if (!pe || ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(pe.tagName)) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        const b = r.getBoundingClientRect();
        const shown = pe.checkVisibility ? pe.checkVisibility({visibilityProperty: true, opacityProperty: true}) : getComputedStyle(pe).visibility !== 'hidden';
        const det = pe.closest('details:not([open])');
        const inClosedDetails = Boolean(det) && pe.closest('summary')?.parentElement !== det;
        const visible = b.height > 0 && b.width > 0 && shown && !inClosedDetails && b.right > 0 && b.left < window.innerWidth;
        nodes.push({t: n.textContent, top: b.top + window.scrollY, bottom: b.bottom + window.scrollY, visible});
      }
      const inView = (sel) => [...document.querySelectorAll(sel)].some((e) => {
        const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
        return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && b.top < window.innerHeight && b.bottom > 0 && b.left < window.innerWidth && b.right > 0;
      });
      return {nodes, innerText: document.body.innerText, H: window.innerHeight, selectors: Object.fromEntries(selectors.map((s) => [s, inView(s)]))};
    }, fv.selectors);
    const textUpTo = (limit) => norm(m.nodes.filter((n) => n.visible && n.top < limit && n.bottom > 0).map((n) => n.t).join(''));
    const first = textUpTo(m.H);
    const label = (alts) => alts[0];
    const found = fv.items.filter((alts) => has(first, alts)).map(label);
    const missing = fv.items.filter((alts) => !has(first, alts)).map(label);
    const screens = {};
    for (const alts of fv.items) {
      let k = null;
      for (let i = 1; i <= 8 && k === null; i++) if (has(textUpTo(i * m.H), alts)) k = i;
      screens[label(alts)] = k;
    }
    const rendered = norm(m.innerText);
    const all = norm(m.nodes.map((n) => n.t).join(''));
    const hiddenRequired = gold.required.filter((alts) => has(all, alts) && !has(rendered, alts)).map(label);
    out.widths[side] = {width, height, answerFound: found, answerMissing: missing, selectorsInView: m.selectors,
      answerAll: missing.length === 0 && Object.values(m.selectors).every(Boolean), screensToAnswer: screens, hiddenRequired};
    await ctx.close();
  }
} catch (e) {
  out.error = e.message.split('\n')[0];
}
out.externalRequests = external;
await browser.close();
console.log(JSON.stringify(out));
