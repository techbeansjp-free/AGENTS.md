// Opening a page the same way for probe.mjs and compare.mjs (#1835). Runs in the #1807 tool container (asc-1807-tools:1,
// --network none). Same settling as #1815 first-view.mjs (whose clock module is imported, not copied): page clock fixed at
// the case's fixedNow, time zone Asia/Tokyo, locale ja-JP, reduced motion, animation/transition off, load + fonts + 500 ms,
// every request outside the page's directory aborted.
import path from 'node:path';
import {clockScript} from '/opt/fv/clock.mjs';

export async function openPage(browser, file, {width, height, fixedNow}) {
  const dir = path.dirname(path.resolve(file));
  const ctx = await browser.newContext({viewport: {width, height}, reducedMotion: 'reduce', timezoneId: 'Asia/Tokyo', locale: 'ja-JP'});
  await ctx.addInitScript({content: clockScript(Date.parse(fixedNow))});
  const external = [];
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if ((u.protocol === 'file:' && decodeURIComponent(u.pathname).startsWith(dir)) || ['data:', 'blob:'].includes(u.protocol)) return r.continue();
    external.push(u.href.slice(0, 200)); return r.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto('file://' + path.resolve(file), {waitUntil: 'load', timeout: 20000});
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.addStyleTag({content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}'});
  await page.waitForTimeout(500);
  return {ctx, page, external, errors};
}
