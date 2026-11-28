// 仕様書の出力を数える（開発時の検証資料。配布しない）。node count.mjs <file.md>
import fs from 'node:fs';
const body=fs.readFileSync(process.argv[2],'utf8').replace(/```[\s\S]*?```/g,'');
const histPat=/変更前|今回の変更|今回から|追加した|延ばした|変えた|変更した|以前は|これまで|打合せ|決定者|前は|前から|従来/;
const lines=body.split('\n');
const prose=lines.filter(l=>!l.trimStart().startsWith('|')).join('\n');
const all=body.split(/[。\n]/).map(s=>s.trim()).filter(s=>s.length>3&&!s.startsWith('|---')&&!s.startsWith('#'));
const sents=prose.split(/[。\n]/).map(s=>s.trim().replace(/^[-*0-9. ]+/,'')).filter(s=>s.length>3&&!s.startsWith('#'));
const hist=all.filter(s=>histPat.test(s));
console.log(JSON.stringify({chars:body.length,proseSentences:sents.length,proseAverage:+(sents.reduce((a,s)=>a+s.length,0)/sents.length).toFixed(1),historyCandidates:hist.length}));
for(const h of hist)console.log('  H:',h.slice(0,80));
