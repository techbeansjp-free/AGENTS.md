// Builds the blinded ranking pages for the owner (#1807).
// Usage: node make-blind.mjs <runs-root> <render-root> <case-id> <blind-root> <keys-dir> <seed-label>
// Output: <blind-root>/<case>/index.html (ranking page), shots/<ID>-{wide,narrow}.png, live/<ID>/ (the generated out/ folder,
// with a Content-Security-Policy that blocks every network request), and <keys-dir>/<case>.json ({ID: "<cond>-r<rep>"}).
// Condition names, notes (DESIGN-NOTES.md) and trial numbers are not copied into the blind folder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [runsRoot, renderRoot, caseId, blindRoot, keysDir, seed] = process.argv.slice(2);
const NARROW = {'ui03-dashboard': ['tablet', 800], 'ui04-parts-search': ['mobile', 390], 'ui07-bus-mobile': ['mobile', 390]}[caseId];
const trials = fs.readdirSync(path.join(runsRoot, caseId)).filter((t) => /^[ADE]-r\d+$/.test(t)).sort();
// deterministic shuffle from the seed (recorded), ids from the same stream
const h = (s) => crypto.createHash('sha256').update(`${seed}:${s}`).digest('hex');
const order = [...trials].sort((a, b) => h(a).localeCompare(h(b)));
const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
const ids = order.map((t) => { const x = h(`id:${t}`); return [0, 2, 4, 6].map((i) => alphabet[parseInt(x.slice(i, i + 2), 16) % alphabet.length]).join(''); });
if (new Set(ids).size !== ids.length) throw new Error('id collision; change the seed');
const out = path.join(blindRoot, caseId);
if (fs.existsSync(out)) throw new Error(`exists: ${out}`);
fs.mkdirSync(path.join(out, 'shots'), {recursive: true});
const key = {}; const cards = [];
const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\' data: blob:; connect-src \'none\'; form-action \'none\'">';
order.forEach((t, i) => {
  const id = ids[i]; key[id] = t;
  const r = path.join(renderRoot, caseId, t);
  const have = {wide: fs.existsSync(path.join(r, 'desktop.png')), narrow: fs.existsSync(path.join(r, `${NARROW[0]}.png`))};
  if (have.wide) fs.copyFileSync(path.join(r, 'desktop.png'), path.join(out, 'shots', `${id}-wide.png`));
  if (have.narrow) fs.copyFileSync(path.join(r, `${NARROW[0]}.png`), path.join(out, 'shots', `${id}-narrow.png`));
  const src = path.join(runsRoot, caseId, t, 'fixture', 'out');
  let live = false;
  if (fs.existsSync(path.join(src, 'index.html'))) {
    const dst = path.join(out, 'live', id);
    fs.cpSync(src, dst, {recursive: true, filter: (p) => !/DESIGN-NOTES\.md$/i.test(p)});
    for (const f of fs.readdirSync(dst).filter((f) => f.endsWith('.html'))) {
      const p = path.join(dst, f); const html = fs.readFileSync(p, 'utf8');
      fs.writeFileSync(p, /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${CSP}`) : CSP + html);
    }
    live = true;
  }
  cards.push({id, ...have, live});
});
fs.mkdirSync(keysDir, {recursive: true});
fs.writeFileSync(path.join(keysDir, `${caseId}.json`), JSON.stringify(key, null, 1));
const title = {'ui03-dashboard': 'UI-03 出荷監視画面', 'ui04-parts-search': 'UI-04 部品の検索', 'ui07-bus-mobile': 'UI-07 バス停の発車案内'}[caseId];
const brief = path.relative(out, path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', caseId === 'ui03-dashboard' ? '../1804-design-judgment/cases/ui03-dashboard/BRIEF.md' : `cases/${caseId}/BRIEF.md`));
const card = (c) => `<article class="card" data-id="${c.id}">
  <header><h2>${c.id}</h2><label>順位 <select data-id="${c.id}"><option value="">—</option>${cards.map((_, i) => `<option>${i + 1}</option>`).join('')}</select></label>
  ${c.live ? `<a href="live/${c.id}/index.html" target="_blank" rel="noopener">実画面を開く</a>` : '<span class="na">実画面なし（生成・描画の失敗）</span>'}</header>
  <div class="shots">
    <figure><figcaption>狭幅 ${NARROW[1]}px</figcaption>${c.narrow ? `<a href="shots/${c.id}-narrow.png" target="_blank"><img loading="lazy" src="shots/${c.id}-narrow.png" alt="${c.id} 狭幅"></a>` : '<p class="na">画像なし</p>'}</figure>
    <figure class="wide"><figcaption>広幅 1440px</figcaption>${c.wide ? `<a href="shots/${c.id}-wide.png" target="_blank"><img loading="lazy" src="shots/${c.id}-wide.png" alt="${c.id} 広幅"></a>` : '<p class="na">画像なし</p>'}</figure>
  </div></article>`;
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:; connect-src 'none'">
<title>順位付け ${title}</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--card:#fafafa;--warn:#b00020}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#aaa;--line:#333;--card:#1d1d1d;--warn:#ff6b81}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}
main{max-width:1600px;margin:auto}.card{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:12px;margin:16px 0}
.card header{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.card h2{margin:0;font-family:monospace}
.shots{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,3fr);gap:12px;align-items:start}
.shots img{width:100%;max-height:900px;object-fit:cover;object-position:top;border:1px solid var(--line)}
figure{margin:0}figcaption{color:var(--muted);font-size:13px}.na{color:var(--muted)}
#out{width:100%;min-height:6em;font-family:monospace}.err{color:var(--warn)}
@media (max-width:700px){.shots{grid-template-columns:1fr}}
</style></head><body><main>
<h1>${title}：9画面の順位付け</h1>
<p>依頼文：<a href="${brief}">BRIEF.md</a>（repositoryの中のfile）。生成した条件・方法は伏せてある。各画面の画像（狭幅・広幅）を見て、必要なら「実画面を開く」で操作して、依頼の利用者・目的に合っている順に、1（最も良い）〜${cards.length}の順位を付けてください。同順位は付けられない。実画面は外部への通信を止めた状態で開く。</p>
<p>全画面に順位を付けると、下に結果のJSONが出る。それを、このfolderの<code>ranks.json</code>として保存するか、会話に貼ってください。条件との対応（key）は、順位を付けた後に開く。</p>
${cards.map(card).join('\n')}
<h2>結果</h2><p id="msg" class="err"></p><textarea id="out" readonly></textarea>
</main><script>
const KEY='asc1807-ranks-${caseId}';const sel=[...document.querySelectorAll('select[data-id]')];
try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');sel.forEach(e=>{if(s[e.dataset.id])e.value=s[e.dataset.id]})}catch(e){}
function upd(){const r={};sel.forEach(e=>{if(e.value)r[e.dataset.id]=Number(e.value)});try{localStorage.setItem(KEY,JSON.stringify(r))}catch(e){}
const v=Object.values(r);const dup=v.filter((x,i)=>v.indexOf(x)!==i);const msg=document.getElementById('msg');const out=document.getElementById('out');
if(dup.length){msg.textContent='同じ順位があります：'+[...new Set(dup)].join(', ');out.value='';return}
if(v.length<sel.length){msg.textContent='未入力：'+(sel.length-v.length)+'画面';out.value='';return}
msg.textContent='';out.value=JSON.stringify({"${caseId}":r},null,1)}
sel.forEach(e=>e.addEventListener('change',upd));upd();
</script></body></html>`);
// Optional folder for the auxiliary model scoring (#1804 run-eval.mjs layout; same IDs; notes withheld).
const evalIdx = process.argv.indexOf('--eval');
if (evalIdx > 0) {
  const ed = path.join(process.argv[evalIdx + 1], caseId);
  fs.mkdirSync(ed, {recursive: true});
  const evd = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const caseDir = caseId === 'ui03-dashboard' ? path.join(evd, '../1804-design-judgment/cases/ui03-dashboard') : path.join(evd, 'cases', caseId);
  fs.copyFileSync(path.join(caseDir, 'BRIEF.md'), path.join(ed, 'BRIEF.md'));
  fs.copyFileSync(path.join(evd, 'rubric.md'), path.join(ed, 'RUBRIC.md'));
  order.forEach((t, i) => {
    const id = ids[i]; const r = path.join(renderRoot, caseId, t);
    for (const [src, dst] of [['desktop.png', 'desktop'], [`${NARROW[0]}.png`, NARROW[0]], ['desktop-gray.png', 'gray']]) {
      if (fs.existsSync(path.join(r, src))) fs.copyFileSync(path.join(r, src), path.join(ed, `${id}-${dst}.png`));
    }
    fs.writeFileSync(path.join(ed, `${id}-notes.md`), 'この評価では、生成者のnotesを伏せた。rationale（説明可能性）は採点せず null にする。\n');
  });
}
console.log(JSON.stringify({case: caseId, screens: cards.length, live: cards.filter((c) => c.live).length, out}));
