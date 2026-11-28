// Layer 3 (EVAL_PLAN.md section 8): one local HTML page on which the owner compares the 9 natural pairs blind.
// Usage: node harness/owner-page.mjs --render-root <dir> --out <dir> --seed <text> [--config <eval.json>]
// Output: <out>/owner-page.html (screenshots embedded as data: URIs with metadata chunks removed; a CSP blocks every
// network request) and <out>/owner-key.json (pair id -> item and which screen is A/B; keep it away from the owner until the
// choices are recorded). The page shows random pair ids in random order, the brief per case, and for each pair
// A / B / 同等 / 判断しない. The choices are shown as JSON to copy, and can be downloaded as a file. No condition names and no
// evaluator judgments are on the page.
import fs from 'node:fs';
import path from 'node:path';
import {EVIDENCE, loadConfig, makeRng, shuffle, idAllocator, stripPng, planItems, shotPath, WIDTHS, writeJson} from './eval-common.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function buildOwnerPage({cfg = loadConfig(), renderRoot, out, seed}) {
  if (!seed) throw new Error('--seed is required');
  const items = planItems(cfg).filter((i) => i.layer === 3);
  const rnd = makeRng(seed, 'owner-page'), newId = idAllocator(rnd), newImg = idAllocator(rnd, 8);
  const missing = [], images = {}, imgOf = {};
  for (const s of new Set(items.flatMap((i) => [i.first, i.second]))) for (const w of WIDTHS) {
    const f = shotPath(cfg, renderRoot, s, w);
    if (!fs.existsSync(f)) { missing.push(`${s} ${w}`); continue; }
    const k = newImg('i'); images[k] = 'data:image/png;base64,' + stripPng(fs.readFileSync(f)).png.toString('base64'); (imgOf[s] ??= {})[w] = k;
  }
  if (missing.length) throw new Error('missing screenshots:\n  ' + missing.join('\n  '));
  const key = {schema: 'asc-1835-owner-key/v1', seed, pairs: {}};
  const pairs = shuffle(items, rnd).map((it) => {
    const pid = newId('p'), swap = rnd() < 0.5, [A, B] = swap ? [it.second, it.first] : [it.first, it.second];
    key.pairs[pid] = {item: it.id, first: it.first, A, B};
    return {pid, case: it.case, A: imgOf[A], B: imgOf[B]};
  });
  const briefs = Object.fromEntries(Object.keys(cfg.cases).map((c) => [c, fs.readFileSync(path.join(EVIDENCE, cfg.cases[c].brief), 'utf8')]));
  // the case is shown only as the brief's own title (its first heading), never as the case id
  const caseNo = Object.fromEntries(shuffle(Object.keys(cfg.cases), rnd).map((c, i) => [c, i + 1]));
  const side = (p, s) => `<div class="side"><h3>${s}</h3>${WIDTHS.map((w) => `<figure><figcaption>${w === 'narrow' ? '狭幅' : '広幅'}</figcaption><img data-img="${p[s][w]}" alt="${s} ${w === 'narrow' ? '狭幅' : '広幅'}"></figure>`).join('')}</div>`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>画面の一対比較</title><style>
:root{--bg:#fff;--fg:#1b1b1b;--line:#ccc;--card:#f6f6f6}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--line:#444;--card:#222}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}main{max-width:1800px;margin:auto;padding:16px}
details{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 12px;margin:8px 0}pre{white-space:pre-wrap}
.pair{border:1px solid var(--line);border-radius:8px;padding:12px;margin:24px 0}.sides{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.side figure{margin:0 0 8px}.side img{width:100%;height:auto;border:1px solid var(--line)}.choice{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px;font-size:17px}
textarea{width:100%;min-height:8em;font:13px monospace}@media (max-width:700px){.sides{grid-template-columns:1fr}}
</style></head><body><main>
<h1>画面の一対比較</h1>
<p>各組で、依頼の利用者・目的に、AとBのどちらが合っているかを選んでください。差が無い・優劣を付けられないときは「同等」、判断できない・したくないときは「判断しない」を選びます。画像は全体のscreenshotで、狭幅と広幅の2枚です。組の順番・ID・A/Bの割当ては無作為です。</p>
${Object.keys(cfg.cases).sort((a, b) => caseNo[a] - caseNo[b]).map((c) => `<details><summary>依頼${caseNo[c]}の依頼文</summary><pre>${esc(briefs[c])}</pre></details>`).join('\n')}
${pairs.map((p, i) => `<section class="pair" id="${p.pid}"><h2>組 ${i + 1}（${p.pid}）・依頼${caseNo[p.case]}</h2><div class="sides">${side(p, 'A')}${side(p, 'B')}</div>
<div class="choice">${['A', 'B', '同等', '判断しない'].map((v) => `<label><input type="radio" name="${p.pid}" value="${v}"> ${v}</label>`).join('')}</div></section>`).join('\n')}
<h2>結果</h2><p>すべての組を選ぶと、下のJSONが完成します。コピーするか、保存してください。</p>
<textarea id="out" readonly></textarea><p><button id="dl" type="button">JSONを保存</button> <span id="left"></span></p>
<script>
const IMG=${JSON.stringify(images)};
for (const im of document.querySelectorAll('img[data-img]')) im.src = IMG[im.dataset.img];
const PIDS=${JSON.stringify(pairs.map((p) => p.pid))};
function result(){const a={};for(const p of PIDS){const r=document.querySelector('input[name="'+p+'"]:checked');if(r)a[p]=r.value;}
return {schema:'asc-1835-owner-answers/v1',page:${JSON.stringify(seed)},recordedAt:new Date().toISOString(),answers:a};}
function show(){const r=result();document.getElementById('out').value=JSON.stringify(r,null,1);const n=PIDS.length-Object.keys(r.answers).length;document.getElementById('left').textContent=n?('未選択 '+n+'組'):'全組を選択済み';}
document.addEventListener('change',show);show();
document.getElementById('dl').onclick=()=>{const b=new Blob([JSON.stringify(result(),null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='owner-answers.json';a.click();};
</script></main></body></html>
`;
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'owner-page.html'), html);
  writeJson(path.join(out, 'owner-key.json'), key);
  return {key, pairs: pairs.length, bytes: Buffer.byteLength(html)};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  try {
    const r = buildOwnerPage({cfg: opt('--config') ? loadConfig(path.resolve(opt('--config'))) : loadConfig(), renderRoot: path.resolve(opt('--render-root') ?? ''), out: path.resolve(opt('--out') ?? ''), seed: opt('--seed')});
    console.log(JSON.stringify({pairs: r.pairs, bytes: r.bytes}));
  } catch (e) { console.error(e.message); process.exit(2); }
}
