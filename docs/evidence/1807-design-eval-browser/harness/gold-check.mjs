// Deterministic gold check for one generated page (#1807). Runs in the browser container (--network none).
// Usage: node gold-check.mjs <gold.json> <case-id> <index.html>   -> JSON on stdout
// Checks: required-text coverage at the wide width (same normalisation as #1804 score.mjs), horizontal overflow at the
// narrow width, UI-07 first-viewport items and minimum tap target, UI-04 search interactions, and external requests (aborted).
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';

const [goldPath, caseId, htmlPath] = process.argv.slice(2);
const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
const key = caseId.split('-')[0];
const g = gold[key];
const widths = gold.widths[caseId];
if (!g || !widths) throw new Error(`no gold for ${caseId}`);
const norm = (s) => String(s).normalize('NFKC').replace(/\s+/g, '').replace(/[〜～]/g, '~');
const has = (text, alts) => alts.some((a) => text.includes(norm(a)));
const file = 'file://' + path.resolve(htmlPath);
const dir = path.dirname(path.resolve(htmlPath));

const browser = await chromium.launch({chromiumSandbox: false});
const external = [];
async function open(width, height) {
  const ctx = await browser.newContext({viewport: {width, height}});
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if ((u.protocol === 'file:' && decodeURIComponent(u.pathname).startsWith(dir)) || ['data:', 'blob:'].includes(u.protocol)) return r.continue();
    external.push(u.href.slice(0, 200)); return r.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  await page.goto(file, {waitUntil: 'load', timeout: 20000});
  await page.waitForTimeout(300);
  return page;
}
const out = {schema: 'asc-1807-gold-check/v1', case: caseId};
try {
  const wide = await open(widths.wide, 900);
  const text = norm(await wide.evaluate(() => document.body.innerText));
  out.missing = g.required.filter((alts) => !has(text, alts)).map((a) => a[0]);
  out.coverage = Number(((g.required.length - out.missing.length) / g.required.length).toFixed(3));
  if (g.interactions) {
    out.interactions = [];
    for (const it of g.interactions) {
      const box = wide.locator(g.searchInput).first();
      const found = await box.count();
      if (!found) { out.interactions.push({query: it.query, ok: false, reason: 'search input not found'}); continue; }
      await box.fill(''); await box.fill(it.query); await box.press('Enter').catch(() => {});
      await wide.waitForTimeout(300);
      const after = norm(await wide.evaluate(() => document.body.innerText));
      const textOk = it.expectText.every((alts) => has(after, alts));
      const absentOk = it.expectAbsent.every((s) => !after.includes(norm(s)));
      out.interactions.push({query: it.query, ok: textOk && absentOk, textOk, absentOk});
      await box.fill(''); await box.press('Enter').catch(() => {});
    }
  }
  const narrow = await open(widths.narrow, widths.narrow === 390 ? 844 : 1280);
  const m = await narrow.evaluate(() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth}));
  out.narrowOverflow = m.sw > m.iw;
  if (g.firstViewportMobile) {
    const first = norm(await narrow.evaluate(() => {
      const parts = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const r = document.createRange(); r.selectNodeContents(n);
        const b = r.getBoundingClientRect();
        if (b.height > 0 && b.top < window.innerHeight && b.bottom > 0 && getComputedStyle(n.parentElement).visibility !== 'hidden') parts.push(n.textContent);
      }
      return parts.join('');
    }));
    out.firstViewportMissing = g.firstViewportMobile.filter((alts) => !has(first, alts)).map((a) => a[0]);
  }
  if (g.minTapTargetPx) {
    out.minTapTargetPx = await narrow.evaluate(() => {
      const els = [...document.querySelectorAll('a[href], button, input, select, [role=button]')].filter((e) => e.offsetParent !== null);
      if (!els.length) return null;
      return Math.min(...els.map((e) => { const b = e.getBoundingClientRect(); return Math.round(Math.min(b.width, b.height)); }));
    });
  }
} catch (e) {
  out.error = e.message.split('\n')[0];
}
out.externalRequests = external.length;
await browser.close();
console.log(JSON.stringify(out));
