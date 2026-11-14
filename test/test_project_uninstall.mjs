import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {projectAssets,uninstallProjectAssets} from '../src/project-assets.mjs';
const record='.agent-skill-chain/distribution.json',asset='.agent-skill-chain/templates/specs/01_要求定義.md';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t,selection={registerSkill:true,registerClaudeSkill:true}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'asc-uninstall-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const work=path.join(root,'project 日本語'),pkg=path.join(root,'package');fs.mkdirSync(work);fs.mkdirSync(pkg);
 for(const name of JSON.parse(fs.readFileSync('src/runtime-files.json'))){const file=path.join(pkg,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(name,file);}
 const write=(name,bytes)=>{const file=path.join(work,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
 const options={packageRoot:pkg};assert.equal(projectAssets(work,{...options,...selection,apply:true}).applied,true);
 const manifest=()=>JSON.parse(fs.readFileSync(path.join(work,record)));
 return {root,work,pkg,write,options,manifest};
}
function save(f){return new Map([...Object.keys(f.manifest().files),record].filter(name=>fs.existsSync(path.join(f.work,name))).map(name=>[name,fs.readFileSync(path.join(f.work,name))]));}
function assertSaved(f,saved){for(const [name,bytes] of saved)assert.deepEqual(fs.readFileSync(path.join(f.work,name)),bytes,name);}
function setRetiredPaths(f,names){
 const source=path.join(f.pkg,'src/project-assets.mjs'),bytes=fs.readFileSync(source,'utf8');
 assert.match(bytes,/^const retiredAssetPaths=.*;$/m);
 fs.writeFileSync(source,bytes.replace(/^const retiredAssetPaths=.*;$/m,`const retiredAssetPaths=${JSON.stringify(names)};`));
}
async function packageUninstaller(f){return (await import(pathToFileURL(path.join(f.pkg,'src/project-assets.mjs')))).uninstallProjectAssets;}
function retireRecovery(f){
 const file=path.join(f.pkg,'src/runtime-files.json'),inventory=JSON.parse(fs.readFileSync(file)),old='skills/execution-recovery/',next='skills/recovery-next/';
 const oldPaths=Object.keys(f.manifest().files).filter(name=>name.startsWith('.agent-skill-chain/')&&name.includes('/'+old));
 fs.cpSync(path.join(f.pkg,old),path.join(f.pkg,next),{recursive:true});
 const source=path.join(f.pkg,next,'SKILL.md');fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('name: execution-recovery','name: recovery-next'));
 fs.writeFileSync(file,JSON.stringify(inventory.map(name=>name.startsWith(old)?next+name.slice(old.length):name)));
 setRetiredPaths(f,oldPaths);return oldPaths;
}

test('uninstall previews then removes only unchanged managed files, preserving every directory and owner sibling',t=>{
 const f=fixture(t),owned=Object.keys(f.manifest().files),preserved=new Map([
  ['AGENTS.md','Owner rules'],['CLAUDE.md','Host instructions'],['package.json','{"private":true}'],['package-lock.json','Owner lock'],
  ['.agent-skill-chain/project-policy.json','Owner policy'],['.agent-skill-chain/project/rules.md','Owner rule'],['.agent-skill-chain/tmp/runtime.json','Owner execution record'],
  ['.agent-skill-chain/managed-runtime/owner.txt','Owner runtime sibling'],['.agent-skill-chain/node_modules/other/index.js','Unrelated package'],
  ['.agents/skills/asc/agents/openai.yaml','interface: owner'],['.claude/skills/asc/owner.md','Owner entry sibling'],['docs/specs/01_要求定義.md','Created specification']
 ]);
 for(const [name,bytes] of preserved)f.write(name,bytes);fs.mkdirSync(path.join(f.work,'.agents/skills/empty-owner'),{recursive:true});
 const saved=save(f),preview=uninstallProjectAssets(f.work,f.options);assert.equal(preview.applied,false);assert.equal(preview.recordPresent,true);assert.deepEqual(preview.conflicts,[]);assert.equal(preview.changes.length,owned.length+1);assert.equal(preview.changes.at(-1).path,record);assert(preview.changes.every(c=>c.action==='delete'&&c.afterSha256===null));assertSaved(f,saved);
 const directories=new Set([...owned,...preserved.keys()].map(name=>path.dirname(name)));
 const result=uninstallProjectAssets(f.work,{...f.options,apply:true});assert.equal(result.applied,true);
 for(const name of [...owned,record])assert.equal(fs.existsSync(path.join(f.work,name)),false,name);
 for(const [name,bytes] of preserved)assert.equal(fs.readFileSync(path.join(f.work,name),'utf8'),bytes,name);
 for(const name of directories)assert(fs.statSync(path.join(f.work,name)).isDirectory(),name);
 assert(fs.statSync(path.join(f.work,'.agents/skills/empty-owner')).isDirectory());
 const again=uninstallProjectAssets(f.work,{...f.options,apply:true});assert.equal(again.recordPresent,false);assert.equal(again.applied,false);assert.deepEqual(again.changes,[]);assert.match(again.notice,/unrecorded files/);
});

test('no record never adopts or deletes orphan files, even exact distributed bytes',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.work,record));
 const before=fs.readFileSync(path.join(f.work,asset));
 for(const apply of [false,true]){const result=uninstallProjectAssets(f.work,{...f.options,apply});assert.equal(result.recordPresent,false);assert.deepEqual(result.changes,[]);assert.deepEqual(result.conflicts,[]);assert.equal(result.applied,false);assert.deepEqual(fs.readFileSync(path.join(f.work,asset)),before);}
});

test('uninstall accepts legacy file-only records and every saved Host selection',t=>{
 for(const selection of [{},{registerSkill:true},{registerClaudeSkill:true},{registerSkill:true,registerClaudeSkill:true}]){
  const f=fixture(t,selection),manifest=f.manifest();delete manifest.registeredHosts;delete manifest.hostEntries;f.write(record,JSON.stringify(manifest));
  const names=Object.keys(manifest.files);assert.equal(uninstallProjectAssets(f.work,{...f.options,apply:true}).applied,true);
  for(const name of names)assert.equal(fs.existsSync(path.join(f.work,name)),false,name);
 }
});

test('known retained preimages uninstall after a Skill rename and an ordinary update',async t=>{
 const f=fixture(t),retired=retireRecovery(f),update=projectAssets(f.work,{...f.options,apply:true});assert.equal(update.applied,true);assert.deepEqual(update.retained,retired);
 for(const name of retired)assert(fs.existsSync(path.join(f.work,name)));
 const uninstall=await packageUninstaller(f),result=uninstall(f.work,{...f.options,apply:true});assert.equal(result.applied,true);assert.deepEqual(result.conflicts,[]);
 for(const name of retired)assert.equal(fs.existsSync(path.join(f.work,name)),false,name);
});

test('older release bytes on cataloged paths use their recorded hashes instead of the running release hashes',t=>{
 const f=fixture(t),saved=save(f);
 for(const source of ['src/controller.mjs','skills/asc/SKILL.md','v05/templates/specs/01_要求定義.md'])fs.appendFileSync(path.join(f.pkg,source),'\nNew trusted release\n');
 assertSaved(f,saved);assert.equal(uninstallProjectAssets(f.work,{...f.options,apply:true}).applied,true);
});

test('unknown retained assets block the entire uninstall until the trusted release knows their exact paths',async t=>{
 const f=fixture(t),retired=retireRecovery(f);projectAssets(f.work,{...f.options,apply:true});setRetiredPaths(f,[]);
 const saved=save(f),uninstall=await packageUninstaller(f),result=uninstall(f.work,{...f.options,apply:true});assert.equal(result.applied,false);assert.deepEqual(result.conflicts,retired);assertSaved(f,saved);
});

test('missing or edited managed files block all deletions and preserve the record',t=>{
 for(const name of [asset,'.agent-skill-chain/managed-runtime/src/project-assets.mjs','.agents/skills/asc/SKILL.md','.claude/skills/execution-recovery/SKILL.md'])for(const missing of [false,true]){
  const f=fixture(t);if(missing)fs.unlinkSync(path.join(f.work,name));else f.write(name,'Owner modification');
  const saved=save(f);for(const apply of [false,true]){const result=uninstallProjectAssets(f.work,{...f.options,apply});assert.equal(result.applied,false);assert(result.conflicts.includes(name));assertSaved(f,saved);}
 }
});

test('a record cannot attribute private files, arbitrary canonical assets, runtime assets or Host wrappers to ASC',t=>{
 for(const name of ['owner.txt','.agent-skill-chain/project/owner.md','.agent-skill-chain/skills/user-private/references/owner.md','.agent-skill-chain/managed-runtime/src/private.mjs','.agent-skill-chain/templates/specs/private.md','.agents/skills/user-private/SKILL.md']){
  const f=fixture(t),bytes=Buffer.from('Owner private data');f.write(name,bytes);const manifest=f.manifest();manifest.files[name]=sha(bytes);
  if(name.startsWith('.agents/'))manifest.hostEntries.push(name);f.write(record,JSON.stringify(manifest));const saved=save(f);
  const result=uninstallProjectAssets(f.work,{...f.options,apply:true});assert.equal(result.applied,false);assert(result.conflicts.includes(name));assertSaved(f,saved);
 }
});

test('modern ownership metadata cannot opt out of a recorded Host entry or prove arbitrary same-path bytes',t=>{
 for(const mode of ['unlisted','false-proof']){
  const f=fixture(t),name='.agents/skills/asc/SKILL.md',manifest=f.manifest();
  if(mode==='unlisted')manifest.hostEntries=manifest.hostEntries.filter(p=>p!==name);else{f.write(name,'Owner replacement');manifest.files[name]=sha('Owner replacement');}
  f.write(record,JSON.stringify(manifest));const saved=save(f),result=uninstallProjectAssets(f.work,{...f.options,apply:true});assert.equal(result.applied,false);assert(result.conflicts.includes(name));assertSaved(f,saved);
 }
});

test('malformed records and unsafe digests or paths are rejected before any unlink',t=>{
 for(const value of ['{',JSON.stringify({schema:'wrong',files:{}}),JSON.stringify({schema:'asc-project-assets/v1',files:[]}),JSON.stringify({schema:'asc-project-assets/v1',files:{'../owner':'a'.repeat(64)}}),JSON.stringify({schema:'asc-project-assets/v1',files:{[asset]:'wrong'}}),JSON.stringify({schema:'asc-project-assets/v1',files:{},registeredHosts:['.codex'],hostEntries:[]})]){
  const f=fixture(t);f.write(record,value);const before=fs.readFileSync(path.join(f.work,asset));assert.throws(()=>uninstallProjectAssets(f.work,{...f.options,apply:true}));assert.equal(fs.readFileSync(path.join(f.work,record),'utf8'),value);assert.deepEqual(fs.readFileSync(path.join(f.work,asset)),before);
 }
});

test('retired asset catalog cannot nominate owner settings, traversal paths, record or noncanonical aliases',async t=>{
 for(const name of ['owner.txt',record,'.agent-skill-chain/project-policy.json','.agent-skill-chain/managed-runtime/.agents/config.json','../owner','.agent-skill-chain/templates/specs/07_データ.md'.normalize('NFD')]){
  const f=fixture(t),saved=save(f);setRetiredPaths(f,[name]);const uninstall=await packageUninstaller(f);assert.throws(()=>uninstall(f.work,{...f.options,apply:true}),/retired asset|Retired asset|Unsafe source path/);assertSaved(f,saved);
 }
});

test('record, managed file and parent symlinks and hardlinks stop before deleting anything',t=>{
 for(const name of [record,asset,'.agents/skills/asc/SKILL.md'])for(const kind of ['symlink','hardlink','parent']){
  const f=fixture(t),outside=path.join(f.root,'outside'),target=path.join(f.work,name),bytes=fs.readFileSync(target),unchanged=path.join(f.work,'.agent-skill-chain/00_利用案内.md');
  fs.writeFileSync(outside,bytes);
  if(kind==='parent'){const parent=path.dirname(target),moved=path.join(f.root,'moved');fs.renameSync(parent,moved);fs.symlinkSync(moved,parent);}else{fs.unlinkSync(target);if(kind==='symlink')fs.symlinkSync(outside,target);else fs.linkSync(outside,target);}
  assert.throws(()=>uninstallProjectAssets(f.work,{...f.options,apply:true}),/symlink|Unsafe asset/);assert.deepEqual(fs.readFileSync(outside),bytes);assert(fs.existsSync(unchanged));
 }
});

// Normalization-insensitive file systems (APFS, HFS+) cannot hold both spellings at once.
const distinctUnicodeNames=(()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asc-unicode-probe-'));
 try{fs.writeFileSync(path.join(dir,'probe-\u00e9'),'');return !fs.existsSync(path.join(dir,'probe-e\u0301'));}finally{fs.rmSync(dir,{recursive:true,force:true});}
})();
const nfdName='.agent-skill-chain/templates/specs/details/07_データ/00_データ一覧.md',nfdAlias=path.posix.join(path.posix.dirname(nfdName),path.posix.basename(nfdName).normalize('NFD'));
test('single NFD aliases uninstall safely while duplicate equivalent record keys reject',t=>{
 const name=nfdName,alias=nfdAlias;
 for(const mode of ['single','record-duplicate']){
  const f=fixture(t),manifest=f.manifest(),target=path.join(f.work,name),decomposed=path.join(f.work,alias);
  if(mode==='record-duplicate'){manifest.files[alias]=manifest.files[name];f.write(record,JSON.stringify(manifest));}
  else{fs.renameSync(target,decomposed);manifest.files[alias]=manifest.files[name];delete manifest.files[name];f.write(record,JSON.stringify(manifest));}
  if(mode==='single'){assert.equal(uninstallProjectAssets(f.work,{...f.options,apply:true}).applied,true);assert.equal(fs.existsSync(decomposed),false);}
  else{const before=fs.readFileSync(path.join(f.work,asset));assert.throws(()=>uninstallProjectAssets(f.work,{...f.options,apply:true}),/Ambiguous Unicode/);assert.deepEqual(fs.readFileSync(path.join(f.work,asset)),before);}
 }
});

test('duplicate equivalent filenames reject',{skip:!distinctUnicodeNames&&'needs a normalization-sensitive file system'},t=>{
 const f=fixture(t),decomposed=path.join(f.work,nfdAlias);fs.copyFileSync(path.join(f.work,nfdName),decomposed);
 const before=fs.readFileSync(path.join(f.work,asset));assert.throws(()=>uninstallProjectAssets(f.work,{...f.options,apply:true}),/Ambiguous Unicode/);assert.deepEqual(fs.readFileSync(path.join(f.work,asset)),before);
});

test('special permissions on managed files or the record refuse uninstall before any deletion',t=>{
 for(const name of [asset,record])for(const mode of [0o4751,0o2751,0o1751]){
  const f=fixture(t),saved=save(f);fs.chmodSync(path.join(f.work,name),mode);
  for(const apply of [false,true]){assert.throws(()=>uninstallProjectAssets(f.work,{...f.options,apply}),/Unsafe asset permissions/);assertSaved(f,saved);assert.equal(fs.statSync(path.join(f.work,name)).mode&0o7777,mode);}
 }
});

test('permission changes after preflight stop deletion and restore already removed files',t=>{
 for(const mode of [0o4751,0o640]){
  const f=fixture(t),plan=uninstallProjectAssets(f.work,f.options),next=plan.changes[1].path,saved=save(f),original=fs.unlinkSync;let changed=false;
  try{fs.unlinkSync=function(file){const result=original.call(fs,file);if(!changed){changed=true;fs.chmodSync(path.join(f.work,next),mode);}return result;};assert.throws(()=>uninstallProjectAssets(f.work,{...f.options,apply:true}),/Asset changed after planning/);}finally{fs.unlinkSync=original;}
  assertSaved(f,saved);assert.equal(fs.statSync(path.join(f.work,next)).mode&0o7777,mode);
 }
});

test('partial unlink errors roll back removed bytes and exact modes and leave the record until last',t=>{
 for(const failAt of [2,25,'record']){
  const f=fixture(t),saved=save(f),first=uninstallProjectAssets(f.work,f.options).changes[0].path;fs.chmodSync(path.join(f.work,first),0o751);
  const original=fs.unlinkSync;let count=0;
  try{fs.unlinkSync=function(file){count++;if((failAt==='record'&&file===path.join(f.work,record))||count===failAt)throw Error('Injected unlink failure');if(file!==path.join(f.work,record))assert(fs.existsSync(path.join(f.work,record)));return original.call(fs,file);};assert.throws(()=>uninstallProjectAssets(f.work,{...f.options,apply:true}),/Injected unlink failure/);}finally{fs.unlinkSync=original;}
  assertSaved(f,saved);assert.equal(fs.statSync(path.join(f.work,first)).mode&0o777,0o751);assert.equal(uninstallProjectAssets(f.work,{...f.options,apply:true}).applied,true);
 }
});

test('rollback preserves concurrent owner edits and reports the exact incomplete path',t=>{
 const f=fixture(t),plan=uninstallProjectAssets(f.work,f.options),first=plan.changes[0].path,saved=save(f),original=fs.unlinkSync;let count=0;
 try{fs.unlinkSync=function(file){if(++count===3){f.write(first,'Owner during failed uninstall');throw Error('Injected unlink failure');}return original.call(fs,file);};assert.throws(()=>uninstallProjectAssets(f.work,{...f.options,apply:true}),error=>error.message.includes('rollback incomplete for '+first));}finally{fs.unlinkSync=original;}
 saved.delete(first);assertSaved(f,saved);assert.equal(fs.readFileSync(path.join(f.work,first),'utf8'),'Owner during failed uninstall');
});

test('linked-worktree uninstall preserves Git index, dirty application and another Issue',t=>{
 const f=fixture(t),repo=path.join(f.root,'git-repo'),work=path.join(f.root,'git-work');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');fs.writeFileSync(path.join(repo,'app.txt'),'base');git('add','.');git('commit','-qm','base');git('worktree','add','-qb','task',work);
 projectAssets(work,{...f.options,apply:true});fs.writeFileSync(path.join(work,'app.txt'),'Dirty active');fs.writeFileSync(path.join(repo,'app.txt'),'Dirty sibling');
 const index=path.join(repo,'.git/worktrees/git-work/index'),before=fs.readFileSync(index);assert.equal(uninstallProjectAssets(work,{...f.options,apply:true}).applied,true);assert.deepEqual(fs.readFileSync(index),before);assert.equal(fs.readFileSync(path.join(repo,'app.txt'),'utf8'),'Dirty sibling');assert.equal(fs.readFileSync(path.join(work,'app.txt'),'utf8'),'Dirty active');
});

test('CLI exposes uninstall help and capabilities, defaults to preview and uses conflict 2 or unsafe input 1',t=>{
 const f=fixture(t),cli=path.resolve('bin/asc-v05.mjs'),run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
 assert.match(run('uninstall','--help').stdout,/uninstall <project-directory> \[--apply\]/);assert(JSON.parse(run('capabilities').stdout).commands.includes('uninstall'));
 const preview=run('uninstall',f.work);assert.equal(preview.status,0);assert.equal(JSON.parse(preview.stdout).applied,false);assert(fs.existsSync(path.join(f.work,record)));
 f.write(asset,'Edited');assert.equal(run('uninstall',f.work,'--apply').status,2);assert.equal(run('uninstall',f.work,'--force').status,1);assert.equal(run('uninstall',f.work,'--apply','--apply').status,1);assert.equal(run('uninstall').status,1);
 f.write(record,'{');assert.equal(run('uninstall',f.work,'--apply').status,1);
});
