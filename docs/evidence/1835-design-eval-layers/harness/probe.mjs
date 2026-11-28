// Computed-style probe of the original pages (#1835). Runs in the container (see browser.mjs). For each page, at the wide
// width:
//   dominant : the (text colour, effective background) pair carried by the most visible text characters. The effective
//              background composites the ancestors' background colours up to an opaque one (white if none); background
//              images are ignored. Used by degrade.mjs to set the degraded body text colour at a target contrast.
//   peers    : the first candidate selector of config/cases.json targets.peers with at least 3 visible matches, and a
//              selector that matches only its 2nd match (id-anchored :nth-child path, checked unique). Used by the
//              inconsistency variants. Elements made by scripts are included (the page has run).
// Usage (in container): node probe.mjs <cases.json> <targets.json> > probe.json
//   targets: [{key: "<case>/<trial>", case, file}]
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {openPage} from './browser.mjs';

const [casesPath, targetsPath] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8')).cases;
const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
const browser = await chromium.launch({chromiumSandbox: false});
const pages = {};
for (const t of targets) {
  const spec = cases[t.case];
  const rec = {};
  let opened;
  try {
    opened = await openPage(browser, t.file, {...spec.wide, fixedNow: spec.fixedNow});
    Object.assign(rec, await opened.page.evaluate((peerCands) => {
      const rgba = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
      const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1); };
      const effBg = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
        let acc = [255, 255, 255, 1];
        for (const l of layers.reverse()) acc = over(l, acc);
        return acc;
      };
      const fmt = (c) => `rgb(${c.slice(0, 3).map((v) => Math.round(v)).join(', ')})`;
      const tally = new Map(); let total = 0;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const pe = n.parentElement; if (!pe || ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(pe.tagName)) continue;
        const len = n.textContent.replace(/\s+/g, '').length; if (!len) continue;
        const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
        if (!(b.width > 0 && b.height > 0) || !pe.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
        const bg = effBg(pe); const fg = over(rgba(getComputedStyle(pe).color), bg);
        const k = `${fmt(fg)}|${fmt(bg)}`; tally.set(k, (tally.get(k) ?? 0) + len); total += len;
      }
      const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] ?? [null, 0];
      const dominant = top ? {color: top.split('|')[0], bg: top.split('|')[1], chars: n, share: Number((n / total).toFixed(3))} : null;
      const visible = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && e.checkVisibility({visibilityProperty: true}); };
      const pathTo = (el) => {
        const steps = [];
        for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
          if (e.id && document.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) { steps.unshift(`#${CSS.escape(e.id)}`); return steps.join(' > '); }
          steps.unshift(`${e.tagName.toLowerCase()}:nth-child(${[...e.parentElement.children].indexOf(e) + 1})`);
        }
        return 'html > ' + steps.join(' > ');
      };
      let peers = null; const tried = [];
      for (const sel of peerCands) {
        const m = [...document.querySelectorAll(sel)].filter(visible);
        tried.push({selector: sel, visible: m.length});
        if (m.length < 3) continue;
        const el = m[1]; const p = pathTo(el); const q = document.querySelectorAll(p);
        if (q.length !== 1 || q[0] !== el) continue;
        const s = getComputedStyle(el);
        peers = {selector: sel, count: m.length, path: p, radius: parseFloat(s.borderTopLeftRadius) || 0, text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 40)};
        break;
      }
      return {dominant, peers, peersTried: tried};
    }, spec.targets.peers));
    rec.external = opened.external.length; rec.pageErrors = opened.errors;
  } catch (e) { rec.error = String(e).split('\n')[0]; }
  if (opened) await opened.ctx.close();
  pages[t.key] = rec;
  console.error(`probed ${t.key}`);
}
await browser.close();
console.log(JSON.stringify({schema: 'asc-1835-page-probe/v1', pages}, null, 1));
