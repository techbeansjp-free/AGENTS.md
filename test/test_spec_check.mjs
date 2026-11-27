import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkSpecs,placementTable} from '../src/spec-check.mjs';
const cli=fileURLToPath(new URL('../bin/asc-v05.mjs',import.meta.url));
const templates=fileURLToPath(new URL('../v05/templates/specs',import.meta.url));
const WARRANTY='details/02_要件/03_品質保証範囲.md';

const table=(header,...rows)=>[`| ${header.join(' | ')} |`,`|${header.map(()=>'---').join('|')}|`,...rows.map(row=>`| ${row.join(' | ')} |`)].join('\n')+'\n';
// A user spec tree that copies the shipped guide (its placement table) and fills a few canonical documents.
function specs(t,overrides={}){
 const root=tempDir('asc-spec-check-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.copyFileSync(path.join(templates,'00_利用案内.md'),path.join(root,'00_利用案内.md'));
 const files={
  'details/02_要件/00_要件一覧.md':'# 要件一覧\n\n'+table(['ID','区分','要件','優先度'],['REQ-web-001','非機能','対応ブラウザで主要操作を完了できる','必須'],['REQ-web-002','非機能','検索の応答時間','条件付き']),
  'details/02_要件/01_受け入れ条件.md':'# 受け入れ条件\n\n'+table(['ID','要件','結果'],['AC-web-001','REQ-web-001','注文確定後に確認メールが届く']),
  'details/11_非機能/00_非機能要件一覧.md':'# 非機能要件一覧\n\n'+table(['ID','品質特性','適用','値の正本'],['REQ-web-002','性能・容量','条件付き','[性能・容量・可用性](01_性能・容量・可用性.md)'],['REQ-sec-001','セキュリティ','必須','[脅威・対策・監査](../10_セキュリティ/02_脅威・対策・監査.md)']),
  'details/10_セキュリティ/02_脅威・対策・監査.md':'# 脅威・対策・監査\n\n'+table(['ID','要件ID','合格基準'],['THR-001','REQ-sec-001','高以上の脆弱性0件']),
  'details/11_非機能/02_利用性・互換性・保守性.md':'# 利用性・互換性・保守性\n\n'+table(['観点','要件ID','対象','合格基準'],['対応環境・版','REQ-web-001','ブラウザ','Chrome 120以上']),
  'details/04_機能/01_FN-001_注文.md':'# FN-001 注文\n\n- 関連要件: REQ-web-001\n',
  'details/02_要件/03_品質保証範囲.md':'# 品質保証範囲\n\n'+table(['ID','分類','保証する値と測定条件（正本の参照）','状態'],['WAR-001','動作環境','REQ-web-001','提案'],['WAR-002','機能・業務','AC-web-001、FN-001','提案'],['WAR-003','セキュリティ','REQ-sec-001、THR-001','提案'])+'\n```text\nREQ-web-999 はコードブロックの例\n```\n',
  ...overrides
 };
 for(const [file,text] of Object.entries(files)){if(text===null)continue;fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);}
 return root;
}

test('the shipped templates pass and read the placement table with every ID kind',()=>{
 const result=checkSpecs(templates);
 assert.equal(result.passed,true,JSON.stringify(result));assert.deepEqual(result.warranty,[WARRANTY]);
 const rows=placementTable(fs.readFileSync(path.join(templates,'00_利用案内.md'),'utf8'));
 assert.deepEqual(new Set(rows.flatMap(row=>row.prefixes)),new Set(['CON','OPEN','ACT','BR','REQ','AC','WAR','FN','SCR','API','IF','JOB','DATA','COL','ENV','CMP','NODE','OPS','THR','AUD','MON']));
});

test('a spec whose warranty refers only to defined IDs passes, including numbered copies of a template, a code block, and a choice label such as the category セキュリティ, and a word that two canonical documents of the same ID kind both use (not compared, as documented)',t=>{
 const root=specs(t),before=fs.readFileSync(path.join(root,WARRANTY),'utf8');
 const result=checkSpecs(root);
 assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.writes,false);
 assert.equal(fs.readFileSync(path.join(root,WARRANTY),'utf8'),before,'the check does not rewrite specs');
});

test('an ID the warranty refers to that no canonical document defines is reported with file and line',t=>{
 const root=specs(t,{[WARRANTY]:'# 品質保証範囲\n\n'+table(['ID','分類','保証する値と測定条件（正本の参照）'],['WAR-001','動作環境','REQ-web-001'],['WAR-002','データ','REQ-web-999、DATA-001'])});
 const result=checkSpecs(root);
 assert.equal(result.passed,false);
 assert.deepEqual(result.brokenReferences.map(({file,line,id})=>({file,line,id})),[{file:WARRANTY,line:6,id:'REQ-web-999'},{file:WARRANTY,line:6,id:'DATA-001'}]);
 assert.deepEqual(result.brokenReferences[0].canonical,['details/02_要件/00_要件一覧.md','details/11_非機能/00_非機能要件一覧.md']);
});

test('an ID mentioned only outside its canonical documents does not count as defined',t=>{
 const root=specs(t,{'details/02_要件/01_受け入れ条件.md':'# 受け入れ条件\n\n'+table(['ID','結果'],['REQ-web-001','注文が確定する']),'details/15_要件追跡/00_追跡表.md':'# 追跡表\n\n'+table(['要件','受け入れ条件'],['REQ-web-001','AC-web-001'])});
 assert.deepEqual(checkSpecs(root).brokenReferences.map(item=>item.id),['AC-web-001']);
});

test('a value of the same ID written again in a non-canonical document is reported with every location',t=>{
 const root=specs(t,{[WARRANTY]:'# 品質保証範囲\n\n'+table(['ID','分類','保証する値と測定条件（正本の参照）','値'],['WAR-001','動作環境','REQ-web-001','Chrome 120以上'])});
 const result=checkSpecs(root);
 assert.equal(result.passed,false);assert.deepEqual(result.brokenReferences,[]);
 assert.deepEqual(result.duplicates,[{ids:['REQ-web-001'],value:'Chrome 120以上',locations:[{file:WARRANTY,line:5},{file:'details/11_非機能/02_利用性・互換性・保守性.md',line:5}],canonical:['details/02_要件/00_要件一覧.md','details/11_非機能/00_非機能要件一覧.md']}]);
});

test('a cell repeated in rows naming two IDs is one finding listing both IDs',t=>{
 const root=specs(t,{'details/15_要件追跡/00_追跡表.md':'# 追跡表\n\n'+table(['要件','受け入れ条件','結果'],['REQ-web-001','AC-web-001','注文確定後に確認メールが届く','注文確定後に確認メールが届く'])});
 assert.deepEqual(checkSpecs(root).duplicates.map(({ids,value,locations})=>({ids,value,files:locations.map(place=>place.file)})),[{ids:['AC-web-001','REQ-web-001'],value:'注文確定後に確認メールが届く',files:['details/02_要件/01_受け入れ条件.md','details/15_要件追跡/00_追跡表.md']}]);
});

test('the CLI is read-only, exits 0 on pass, 2 on findings and 1 on an unreadable table',t=>{
 const ok=specs(t),run=(...args)=>spawnSync(process.execPath,[cli,'spec-check',...args],{encoding:'utf8'});
 const pass=run(ok);assert.equal(pass.status,0,pass.stderr);assert.equal(JSON.parse(pass.stdout).passed,true);
 const broken=specs(t,{[WARRANTY]:'# 品質保証範囲\n\n'+table(['ID','値'],['WAR-001','REQ-web-404'])});
 const fail=run(broken);assert.equal(fail.status,2);assert.equal(JSON.parse(fail.stdout).brokenReferences[0].id,'REQ-web-404');
 const guide=path.join(ok,'other.md');fs.writeFileSync(guide,'# 案内\n');
 const bad=run(ok,'--table',guide);assert.equal(bad.status,1);assert.match(bad.stderr,/置き場の表/);
 assert.match(run('--help').stdout,/spec-check <specs-directory> \[--table <guide.md>\]/);
 assert(JSON.parse(spawnSync(process.execPath,[cli,'capabilities'],{encoding:'utf8'}).stdout).commands.includes('spec-check'));
});
