// Builds synthetic trials (no model call) to dry-run render/score/blind: correct, empty, missing, external, failed, defective.
// Usage: node make-dryrun.mjs <runs-root>
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const cases = path.resolve(here, '..', 'cases');
const root = process.argv[2];
const gold = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'gold.json'), 'utf8'));
const meta = (c, cond, rep, extra = {}) => ({schema: 'asc-1804-gen/v1', case: c, condition: cond, rep, exit: 0, isError: false, resultSubtype: 'success', costUsd: 0, numTurns: 0, wallMs: 0, usage: {}, toolCounts: {}, skillCalls: [], skillFileReads: [], ...extra});
function trial(c, name, m, files) {
  const d = path.join(root, c, name); const fx = path.join(d, 'fixture');
  fs.mkdirSync(fx, {recursive: true}); fs.cpSync(path.join(cases, c), fx, {recursive: true});
  for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(fx, f)), {recursive: true}); fs.writeFileSync(path.join(fx, f), s); }
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(m));
}
const all02 = gold.ui02.required.map((a) => a[0]).join('</li><li>');
const page02 = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><style>body{font-family:"Noto Serif CJK JP",serif;margin:0;padding:16px;color:#111;background:#fff}a:focus-visible{outline:3px solid #000}</style></head><body><main><h1>干潟と海苔の百年</h1><p>2027年4月10日〜6月27日</p><a href="#reserve">予約する</a><p lang="en">This exhibition traces a century of nori farming on the tidal flats of the city. Boats, tools and diaries tell how the work ended.</p><ul><li>${all02}</li></ul></main></body></html>`;
trial('ui02-exhibition', 'A-r1', meta('ui02-exhibition', 'A', 1), {'out/index.html': page02, 'out/DESIGN-NOTES.md': '# notes\n明朝体を見出しに使った。\n'});
trial('ui02-exhibition', 'A-r2', meta('ui02-exhibition', 'A', 2), {'out/index.html': ''});
trial('ui02-exhibition', 'A-r3', meta('ui02-exhibition', 'A', 3), {});
trial('ui02-exhibition', 'B-r1', meta('ui02-exhibition', 'B', 1), {'out/index.html': page02.replace('<style>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP"><style>')});
trial('ui02-exhibition', 'B-r2', meta('ui02-exhibition', 'B', 2, {exit: 1, isError: true, resultSubtype: 'error_max_budget_usd'}), {});
trial('ui02-exhibition', 'B-r3', meta('ui02-exhibition', 'B', 3), {'out/index.html': '<html><body><div style="width:2000px">干潟と海苔の百年 <b>未閉じ'});
const fields = [['name', '請求先の名称', 'required'], ['dept', '部署名', ''], ['person', '担当者名', 'required'], ['email', 'メールアドレス', 'required'], ['zip', '郵便番号', 'required'], ['address', '住所', 'required'], ['tel', '電話番号', '']];
const good08 = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>請求先の編集</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="components.css"></head><body>
<header class="app-header"><p class="app-header__title">会員管理</p><nav class="app-nav" aria-label="主要"><a href="members.html">会員一覧</a><a href="billing.html" aria-current="page">請求先</a></nav></header>
<main class="page"><h1 class="page__title">請求先の編集</h1><div id="status" role="status"></div><p id="viewer" hidden class="alert alert--danger">閲覧権限のため編集できません。</p><form class="card" id="f" novalidate>
${fields.map(([k, l]) => `<div class="field"><label class="field__label" for="${k}">${l}</label><input class="field__input" id="${k}" name="${k}" aria-describedby="${k}-err"><p class="field__error" id="${k}-err"></p></div>`).join('')}
<button class="btn btn--primary" type="submit">保存</button></form></main>
<script>const req={name:1,person:1,email:1,zip:1,address:1};const f=document.getElementById('f');const b=f.querySelector('button');
if(new URLSearchParams(location.search).get('role')==='viewer'){document.getElementById('viewer').hidden=false;f.querySelectorAll('input').forEach(i=>i.disabled=true);b.disabled=true;}
f.addEventListener('submit',e=>{e.preventDefault();let first=null;for(const i of f.querySelectorAll('input')){let m='';if(req[i.name]&&!i.value.trim())m='入力してください';else if(i.name==='email'&&i.value&&!/^[^@\\s]+@[^@\\s]+$/.test(i.value))m='メールアドレスの形式で入力してください';else if(i.name==='zip'&&i.value&&!/^\\d{3}-?\\d{4}$/.test(i.value))m='7桁の数字で入力してください';
document.getElementById(i.name+'-err').textContent=m;if(m){i.setAttribute('aria-invalid','true');first=first||i;}else i.removeAttribute('aria-invalid');}
if(first){first.focus();return;}b.disabled=true;const s=document.getElementById('status');s.textContent='保存中…';setTimeout(()=>{b.disabled=false;if(f.email.value==='fail@example.com'){s.className='alert alert--danger';s.textContent='保存に失敗しました。もう一度お試しください。';}else{s.className='alert alert--success';s.textContent='保存しました。';}},1000);});</script></body></html>`;
trial('ui08-existing-ds', 'A-r1', meta('ui08-existing-ds', 'A', 1), {'app/billing.html': good08, 'out/DESIGN-NOTES.md': '既存の部品を使った。\n'});
trial('ui08-existing-ds', 'B-r1', meta('ui08-existing-ds', 'B', 1), {'app/billing.html': '<!doctype html><html><head><style>body{font-family:Georgia;color:#333;background:rgb(250,240,230)}</style></head><body><h1>請求先</h1><form><input placeholder="名称"><button>保存</button></form></body></html>', 'app/tokens.css': ':root{--color-primary:red}'});
trial('ui10-cli', 'A-r1', meta('ui10-cli', 'A', 1), {'src/summarize.mjs': '// fixed\n' + fs.readFileSync(path.join(cases, 'ui10-cli/src/summarize.mjs'), 'utf8')});
trial('ui10-cli', 'D-r1', meta('ui10-cli', 'D', 1, {skillCalls: ['anything-frontend-art-direction']}), {'out/index.html': '<p>x</p>'});
console.log('dry-run trials written to', root);
