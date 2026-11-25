// Renders generated pages offline (inside the disposable container, --network none) and records observable metrics (#1807).
// Adapted from #1804 harness/render-in-container.mjs: same metrics (axe-core WCAG 2.1 A/AA, keyboard Tab stops and focus
// indicator, reduced-motion, horizontal overflow, external requests, LCP/CLS lab values, grayscale screenshot), with the
// #1807 cases' viewports. axe-core runs at both widths; the ui08 form journey and ui02 probes are dropped.
// Usage (in container): node render.mjs /targets.json /out
// targets: [{id, case, file: "/runs/.../index.html"}]
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
const axeSource = fs.readFileSync('/opt/node_modules/axe-core/axe.min.js', 'utf8');
const [targetsPath, outRoot] = process.argv.slice(2);
const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
const VIEWPORTS = {
  ui03: [['desktop', 1440, 900], ['tablet', 800, 1280]],
  ui04: [['desktop', 1440, 900], ['mobile', 390, 844]],
  ui07: [['desktop', 1440, 900], ['mobile', 390, 844]],
};
const perfInit = `window.__lcp=null;window.__cls=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true});}catch(e){}`;
const browser = await chromium.launch({chromiumSandbox: false});
const all = [];
for (const t of targets) {
  const rec = {id: t.id, case: t.case, file: t.file, exists: fs.existsSync(t.file), viewports: {}};
  if (!rec.exists) { all.push(rec); continue; }
  const out = path.join(outRoot, t.id); fs.mkdirSync(out, {recursive: true});
  const url = 'file://' + t.file + (t.query ?? '');
  for (const [vp, w, h] of VIEWPORTS[t.case]) {
    const ctx = await browser.newContext({viewport: {width: w, height: h}, reducedMotion: 'no-preference'});
    await ctx.addInitScript(perfInit);
    const page = await ctx.newPage();
    const v = {externalRequests: [], consoleErrors: [], pageErrors: []};
    page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) v.externalRequests.push(r.url().slice(0, 200)); });
    await ctx.route('**/*', (rt) => (/^(file|data|blob):/.test(rt.request().url()) ? rt.continue() : rt.abort('blockedbyclient')));
    page.on('console', (m) => { if (m.type() === 'error') v.consoleErrors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => v.pageErrors.push(String(e).slice(0, 200)));
    try {
      await page.goto(url, {waitUntil: 'load', timeout: 20000});
      await page.waitForTimeout(800);
      Object.assign(v, await page.evaluate(() => {
        const de = document.documentElement;
        const text = document.body ? document.body.innerText : '';
        const firstY = (needle) => {
          const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (tw.nextNode()) { const n = tw.currentNode; if (n.textContent.includes(needle)) { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); const s = getComputedStyle(n.parentElement); if (b.width > 0 && s.visibility !== 'hidden' && s.display !== 'none') return Math.round(b.top + window.scrollY); } }
          return null;
        };
        const cs = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e) : null; };
        const colors = {};
        for (const e of document.querySelectorAll('body *')) {
          const s = getComputedStyle(e); if (s.display === 'none') continue;
          for (const k of ['color', 'backgroundColor', 'borderTopColor']) { const c = s[k]; if (!c || c === 'rgba(0, 0, 0, 0)' || (k === 'borderTopColor' && s.borderTopWidth === '0px')) continue; colors[c] = (colors[c] ?? 0) + 1; }
        }
        const sheets = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
        return {
          scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, overflowX: de.scrollWidth > window.innerWidth + 1, docHeight: de.scrollHeight,
          text, textLen: text.length, lcp: window.__lcp, cls: window.__cls,
          fontBody: cs('body')?.fontFamily ?? null, fontH1: cs('h1')?.fontFamily ?? null, fontH2: cs('h2')?.fontFamily ?? null,
          bodyBg: cs('body')?.backgroundColor ?? null, htmlBg: cs('html')?.backgroundColor ?? null,
          topColors: Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 10),
          animations: document.getAnimations().length, hasReducedMotionQuery: /prefers-reduced-motion/.test(sheets),
          firstY: Object.fromEntries(['出荷遅延率', '温度センサー', 'LANE-B01', '汐見台三丁目', '中央通り', '在庫あり', 'LG-2040-SS-HT-0500-JISB1192'].map((k) => [k, firstY(k)])),
          landmarks: {main: document.querySelectorAll('main,[role=main]').length, h1: document.querySelectorAll('h1').length, nav: document.querySelectorAll('nav').length},
          lang: de.getAttribute('lang'),
        };
      }));
      v.textSample = v.text.slice(0, 200); fs.writeFileSync(path.join(out, `${vp}.txt`), v.text); delete v.text;
      await page.screenshot({path: path.join(out, `${vp}.png`), fullPage: true, clip: {x: 0, y: 0, width: w, height: Math.min(v.docHeight, 6000)}});
      await page.addScriptTag({content: axeSource});
      v.axe = await page.evaluate(async () => { const r = await window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}}); return r.violations.map((x) => ({id: x.id, impact: x.impact, nodes: x.nodes.length})); });
      v.axeSeriousCritical = v.axe.filter((x) => ['serious', 'critical'].includes(x.impact)).reduce((a, x) => a + x.nodes, 0);
      if (vp === 'desktop') {
        // grayscale screenshot for the color-independence check
        await page.addStyleTag({content: 'html{filter:grayscale(1) !important}'});
        await page.screenshot({path: path.join(out, `${vp}-gray.png`), fullPage: true, clip: {x: 0, y: 0, width: w, height: Math.min(v.docHeight, 4000)}});
        await page.reload({waitUntil: 'load'}); await page.waitForTimeout(300);
        // keyboard: Tab through up to 60 stops
        const stops = [];
        for (let i = 0; i < 60; i++) {
          await page.keyboard.press('Tab');
          const s = await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const c = getComputedStyle(a); const vis = (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || (c.boxShadow && c.boxShadow !== 'none'); return {tag: a.tagName, text: (a.innerText || a.value || a.getAttribute('aria-label') || '').trim().slice(0, 40), href: a.getAttribute('href'), focusVisible: !!vis}; });
          if (!s) break; if (stops.length && JSON.stringify(stops[0]) === JSON.stringify(s) && i > 0) break; stops.push(s);
        }
        v.tabStops = stops.length; v.tabStopsWithIndicator = stops.filter((s) => s.focusVisible).length;
        const findIdx = (re) => { const i = stops.findIndex((s) => re.test(s.tag + ' ' + (s.href ?? '') + ' ' + s.text)); return i < 0 ? null : i + 1; };
        v.tabsToRetry = findIdx(/再試行|再取得|retry|リトライ/i); v.tabsToSearch = findIdx(/^INPUT /);
      }
      const rctx = await browser.newContext({viewport: {width: w, height: h}, reducedMotion: 'reduce'});
      await rctx.route('**/*', (rt) => (/^(file|data|blob):/.test(rt.request().url()) ? rt.continue() : rt.abort('blockedbyclient')));
      const rp = await rctx.newPage(); await rp.goto(url, {waitUntil: 'load', timeout: 20000}); await rp.waitForTimeout(500);
      v.animationsReduced = await rp.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      await rctx.close();
    } catch (e) { v.renderError = String(e).slice(0, 300); }
    rec.viewports[vp] = v;
    await ctx.close();
  }
  all.push(rec);
  console.error(`rendered ${t.id}`);
}
fs.writeFileSync(path.join(outRoot, 'render.json'), JSON.stringify(all, null, 1));
await browser.close();

