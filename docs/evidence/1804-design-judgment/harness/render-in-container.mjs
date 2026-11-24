// Renders generated pages offline (inside the disposable container, --network none) and records observable metrics.
// Usage (in container): node render-in-container.mjs /targets.json /out
// targets: [{id, case, file: "/runs/.../index.html", query?: ""}]
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire('/opt/r/');
const {chromium} = require('playwright');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const [targetsPath, outRoot] = process.argv.slice(2);
const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
const VIEWPORTS = {
  ui02: [['desktop', 1440, 900], ['mobile', 390, 844]],
  ui03: [['desktop', 1440, 900], ['tablet', 800, 1280]],
  ui08: [['desktop', 1280, 800], ['mobile', 390, 844]],
};
const perfInit = `window.__lcp=null;window.__cls=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true});}catch(e){}`;
const browser = await chromium.launch();
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
          firstY: Object.fromEntries(['4月10日', '6月27日', '干潟と海苔の百年', 'A Century', '予約', '出荷遅延率', '温度センサー', 'LANE-B01'].map((k) => [k, firstY(k)])),
          landmarks: {main: document.querySelectorAll('main,[role=main]').length, h1: document.querySelectorAll('h1').length, nav: document.querySelectorAll('nav').length},
          lang: de.getAttribute('lang'),
        };
      }));
      v.textSample = v.text.slice(0, 200); fs.writeFileSync(path.join(out, `${vp}.txt`), v.text); delete v.text;
      await page.screenshot({path: path.join(out, `${vp}.png`), fullPage: true, clip: {x: 0, y: 0, width: w, height: Math.min(v.docHeight, 4000)}});
      if (vp === 'desktop') {
        await page.addScriptTag({content: axeSource});
        const axe = await page.evaluate(async () => { const r = await window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}}); return r.violations.map((x) => ({id: x.id, impact: x.impact, nodes: x.nodes.length})); });
        v.axe = axe;
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
        const findIdx = (re) => { const i = stops.findIndex((s) => re.test((s.href ?? '') + ' ' + s.text)); return i < 0 ? null : i + 1; };
        v.tabsToReserve = findIdx(/#reserve|予約|tel:/); v.tabsToRetry = findIdx(/再試行|再取得|retry|リトライ/i);
      }
      const rctx = await browser.newContext({viewport: {width: w, height: h}, reducedMotion: 'reduce'});
      const rp = await rctx.newPage(); await rp.goto(url, {waitUntil: 'load', timeout: 20000}); await rp.waitForTimeout(500);
      v.animationsReduced = await rp.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      await rctx.close();
    } catch (e) { v.renderError = String(e).slice(0, 300); }
    rec.viewports[vp] = v;
    await ctx.close();
  }
  if (t.case === 'ui08') rec.form = await formJourney(t.file);
  all.push(rec);
  console.error(`rendered ${t.id}`);
}
fs.writeFileSync(path.join(outRoot, 'render.json'), JSON.stringify(all, null, 1));
await browser.close();

async function formJourney(file) {
  const r = {};
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}});
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  const fields = [['name', /請求先.*名称|名称/], ['dept', /部署/], ['person', /担当者/], ['email', /メール/], ['zip', /郵便/], ['address', /住所/], ['tel', /電話/]];
  const loc = (re) => page.getByLabel(re).first();
  const submit = () => page.getByRole('button', {name: /保存/}).first();
  try {
    await page.goto('file://' + file, {waitUntil: 'load'}); await page.waitForTimeout(300);
    r.labelsFound = {}; for (const [k, re] of fields) r.labelsFound[k] = (await page.getByLabel(re).count()) > 0;
    await submit().click(); await page.waitForTimeout(400);
    r.emptySubmit = await page.evaluate(() => ({invalid: document.querySelectorAll('[aria-invalid="true"]').length,
      errorsVisible: [...document.querySelectorAll('.field__error,[role=alert],.alert--danger')].filter((e) => e.offsetParent && e.innerText.trim()).length,
      describedBy: [...document.querySelectorAll('[aria-invalid="true"]')].filter((e) => { const ids = (e.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean); return ids.some((id) => { const d = document.getElementById(id); return d && d.innerText.trim(); }); }).length,
      focusOnInvalid: document.activeElement?.getAttribute('aria-invalid') === 'true' || /alert|error/.test(document.activeElement?.className || '') }));
    const fill = async (vals) => { for (const [k, re] of fields) if (vals[k] !== undefined && r.labelsFound[k]) await loc(re).fill(vals[k]); };
    await fill({name: 'サンプル商事株式会社', dept: '経理部', person: '山田 花子', email: 'bad-email', zip: '1234567', address: '港南区汐見町1-2-3', tel: '045-000-0000'});
    await submit().click(); await page.waitForTimeout(400);
    r.badEmail = await page.evaluate(() => ({invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map((e) => e.name || e.id)}));
    r.retainedAfterError = r.labelsFound.name ? (await loc(fields[0][1]).inputValue()) === 'サンプル商事株式会社' : null;
    await fill({email: 'ok@example.com'});
    await submit().click();
    r.disabledWhileSaving = await submit().isDisabled().catch(() => null);
    await page.waitForTimeout(1800);
    r.successText = await page.evaluate(() => /保存しました|保存されました|成功|更新しました/.test(document.body.innerText));
    await fill({email: 'fail@example.com'});
    await submit().click(); await page.waitForTimeout(1800);
    r.failureText = await page.evaluate(() => /失敗|できませんでした|エラー/.test(document.body.innerText));
    r.retainedAfterFailure = r.labelsFound.email ? (await loc(fields[3][1]).inputValue()) === 'fail@example.com' : null;
    await page.goto('file://' + file + '?role=viewer', {waitUntil: 'load'}); await page.waitForTimeout(300);
    r.viewer = await page.evaluate(() => { const inputs = [...document.querySelectorAll('input,textarea,select')].filter((e) => e.type !== 'hidden'); const btn = [...document.querySelectorAll('button')].find((b) => /保存/.test(b.innerText));
      return {inputs: inputs.length, locked: inputs.filter((e) => e.disabled || e.readOnly).length, saveUsable: btn ? (!btn.disabled && btn.offsetParent !== null) : false, reasonShown: /権限|閲覧のみ|編集できません|閲覧専用/.test(document.body.innerText)}; });
  } catch (e) { r.error = String(e).slice(0, 300); }
  r.pageErrors = errs;
  await ctx.close();
  return r;
}
