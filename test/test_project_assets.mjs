import {additionalSkills,registrations,skillFiles,assertAdditionalSkills,assertAdditionalEntries} from './helpers/distributed-skills.mjs';
import {foundationHashes,assertFoundation,assertFoundationEntry} from './helpers/foundation-skill.mjs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {projectAssets} from '../src/project-assets.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-assets-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'});
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'app.txt'),'base');git('add','.');git('commit','-qm','base');
 const work=path.join(root,'work');git('worktree','add','-qb','task',work);
 const pkg=path.join(root,'package');fs.mkdirSync(pkg);
 for(const name of ['v05','skills','src','bin','migration_inspect.mjs','README.md','package.json'])fs.cpSync(name,path.join(pkg,name),{recursive:true});
 const write=(name,value)=>{const file=path.join(work,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 return {root,repo,work,pkg,write,git};
}
const asset='.agent-skill-chain/templates/specs/01_要求定義.md';
test('project asset install/update preserves owner files, dirty siblings and index without agents',t=>{
 const f=fixture(t),options={packageRoot:f.pkg};
 f.write('.agent-skill-chain/project/rules.md','Owner rule');f.write('docs/specs/API.md','Owner specification');f.write('.agent-skill-chain/templates/custom.md','Custom template');f.write('app.txt','Uncommitted app');
 fs.writeFileSync(path.join(f.repo,'app.txt'),'Dirty sibling');
 const beforeIndex=fs.readFileSync(path.join(f.repo,'.git/worktrees/work/index'));
 const preview=projectAssets(f.work,options);assert(preview.changes.length>50);assert.equal(preview.applied,false);assert.equal(fs.existsSync(path.join(f.work,asset)),false);
 assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
 assert.equal(projectAssets(f.work,options).changes.length,0);
 assert.equal(projectAssets(f.work,options).recordChanged,false);
 const shipped=path.join(f.pkg,'v05/templates/specs/01_要求定義.md');fs.appendFileSync(shipped,'\nUpdated template\n');
 const update=projectAssets(f.work,options);assert.deepEqual(update.changes.map(c=>[c.path,c.action]),[[asset,'update'],['.agent-skill-chain/managed-runtime/v05/templates/specs/01_要求定義.md','update']]);
 assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);assert.equal(fs.readFileSync(path.join(f.work,asset),'utf8'),fs.readFileSync(shipped,'utf8'));
 for(const [name,value] of [['.agent-skill-chain/project/rules.md','Owner rule'],['docs/specs/API.md','Owner specification'],['.agent-skill-chain/templates/custom.md','Custom template'],['app.txt','Uncommitted app']])assert.equal(fs.readFileSync(path.join(f.work,name),'utf8'),value);
 assert.equal(fs.readFileSync(path.join(f.repo,'app.txt'),'utf8'),'Dirty sibling');assert.deepEqual(fs.readFileSync(path.join(f.repo,'.git/worktrees/work/index')),beforeIndex);
 assert(!fs.readFileSync(path.join(f.work,'.agent-skill-chain/skills/asc/SKILL.md'),'utf8').includes(f.pkg));
});
test('one edited or pre-existing asset blocks the entire update without overwriting it',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};f.write(asset,'Existing owner text');
 let result=projectAssets(f.work,options);assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[asset]);assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain/distribution.json')),false);
 fs.unlinkSync(path.join(f.work,asset));projectAssets(f.work,options);
 const record=fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json'));
 f.write(asset,'Edited after installation');fs.appendFileSync(path.join(f.pkg,'v05/templates/specs/02_要件定義.md'),'\nNew version\n');
 const untouched=fs.readFileSync(path.join(f.work,'.agent-skill-chain/templates/specs/02_要件定義.md'));
 result=projectAssets(f.work,options);assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[asset]);assert.equal(fs.readFileSync(path.join(f.work,asset),'utf8'),'Edited after installation');assert.deepEqual(fs.readFileSync(path.join(f.work,'.agent-skill-chain/templates/specs/02_要件定義.md')),untouched);assert.deepEqual(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json')),record);
});
test('removed distribution assets are retained, and malformed records cannot target owner paths',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};projectAssets(f.work,options);
 fs.unlinkSync(path.join(f.pkg,'v05/templates/specs/01_要求定義.md'));
 const manifestPath=path.join(f.pkg,'src/runtime-files.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));fs.writeFileSync(manifestPath,JSON.stringify(manifest.filter(p=>p!=='v05/templates/specs/01_要求定義.md')));
 const result=projectAssets(f.work,options);assert.equal(result.applied,true);assert.deepEqual(result.retained,['.agent-skill-chain/managed-runtime/v05/templates/specs/01_要求定義.md',asset]);assert(fs.existsSync(path.join(f.work,asset)));
 f.write('.agent-skill-chain/distribution.json',JSON.stringify({schema:'asc-project-assets/v1',files:{'../outside':'a'.repeat(64)}}));assert.throws(()=>projectAssets(f.work,options),/Unsafe source path/);
});
test('removed and renamed Skills keep original preimages through rollback and reintroduction',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true,registerSkill:true,registerClaudeSkill:true};
 projectAssets(f.work,options);
 const record=path.join(f.work,'.agent-skill-chain/distribution.json'),before=JSON.parse(fs.readFileSync(record)).files;
 const oldPrefix='skills/execution-recovery/',renamedPrefix='skills/recovery-next/';
 const retained=Object.keys(before).filter(name=>name.includes('/'+oldPrefix)||name.endsWith('/skills/execution-recovery/SKILL.md'));
 const original=new Map(retained.map(name=>[name,fs.readFileSync(path.join(f.work,name))]));
 const manifestPath=path.join(f.pkg,'src/runtime-files.json'),inventory=JSON.parse(fs.readFileSync(manifestPath));
 const source=path.join(f.pkg,oldPrefix+'SKILL.md'),sourceBytes=fs.readFileSync(source,'utf8');
 fs.cpSync(path.join(f.pkg,oldPrefix),path.join(f.pkg,renamedPrefix),{recursive:true});
 fs.writeFileSync(path.join(f.pkg,renamedPrefix,'SKILL.md'),sourceBytes.replace('name: execution-recovery','name: recovery-next'));
 const renamed=inventory.map(name=>name.startsWith(oldPrefix)?renamedPrefix+name.slice(oldPrefix.length):name);
 for(const edited of [null,...retained]){
  if(edited)f.write(edited,'Synthetic owner edit before retirement');
  fs.writeFileSync(manifestPath,JSON.stringify(renamed));
  const retirement=projectAssets(f.work,options);assert.equal(retirement.applied,true);
  const after=JSON.parse(fs.readFileSync(record)).files;
  for(const name of retained){assert(retirement.retained.includes(name));assert.equal(after[name],before[name]);}
  // Returning to the old inventory also changes the old distribution's contents.
  // Only owner changes should conflict; retired files have not become unmanaged.
  fs.writeFileSync(manifestPath,JSON.stringify(inventory));
  fs.writeFileSync(source,sourceBytes.replace('description: ','description: Synthetic updated '));
  const plan=projectAssets(f.work,{...options,apply:false});
  assert.deepEqual(plan.conflicts,edited?[edited]:[]);
  if(edited){
   const saved=fs.readFileSync(record);assert.equal(projectAssets(f.work,options).applied,false);assert.deepEqual(fs.readFileSync(record),saved);
   f.write(edited,original.get(edited));
  }
  assert.equal(projectAssets(f.work,options).applied,true);
  // Restore the baseline for each independent owner-edit counterexample.
  fs.writeFileSync(source,sourceBytes);assert.equal(projectAssets(f.work,options).applied,true);
 }
 const removedInventory=inventory.filter(name=>!name.startsWith(oldPrefix));
 fs.writeFileSync(manifestPath,JSON.stringify(removedInventory));
 assert.equal(projectAssets(f.work,{packageRoot:f.pkg,apply:true}).applied,true);
 for(const name of retained)assert.equal(JSON.parse(fs.readFileSync(record)).files[name],before[name]);
 fs.writeFileSync(manifestPath,JSON.stringify(inventory));
 fs.writeFileSync(source,sourceBytes.replace('description: ','description: Synthetic reintroduced '));
 assert.equal(projectAssets(f.work,options).applied,true);
});
test('asset paths cannot traverse symlinks or overwrite hardlinked host files',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};
 const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.work,'.agent-skill-chain'));assert.throws(()=>projectAssets(f.work,options),/symlink/);assert.deepEqual(fs.readdirSync(outside),[]);
 fs.unlinkSync(path.join(f.work,'.agent-skill-chain'));f.write(asset,'test');const link=path.join(outside,'secret');fs.linkSync(path.join(f.work,asset),link);assert.throws(()=>projectAssets(f.work,options),/Unsafe asset/);assert.equal(fs.readFileSync(link,'utf8'),'test');
});

test('locally deleted managed assets are conflicts rather than silently recreated',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};projectAssets(f.work,options);
 fs.unlinkSync(path.join(f.work,asset));const result=projectAssets(f.work,options);
 assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[asset]);assert.equal(fs.existsSync(path.join(f.work,asset)),false);
});

test('project asset installation does not execute repository clean filters',t=>{
 const f=fixture(t);const marker=path.join(f.root,'filter-ran');
 f.git('config','filter.asset-probe.clean',`touch '${marker}'; cat`);
 f.git('config','filter.asset-probe.smudge',`touch '${marker}'; cat`);
 f.write('.gitattributes','*.md filter=asset-probe\n');
 assert.equal(projectAssets(f.work,{packageRoot:f.pkg,apply:true}).applied,true);
 assert.equal(fs.existsSync(marker),false);
});

// Synchronize starts over IPC: no session reservation or shared lock is needed.
async function simultaneous(t,worktrees,pkg){
 const jobs=worktrees.map(repo=>{
  const script=`import {projectAssets} from ${JSON.stringify(new URL('../src/project-assets.mjs',import.meta.url).href)};process.once('message',()=>{try{console.log(JSON.stringify(projectAssets(process.argv[1],{packageRoot:process.argv[2],apply:true})));process.disconnect();}catch(e){console.error(e.message);process.exitCode=1;process.disconnect();}});process.send('ready');`;
  const child=spawn(process.execPath,['--input-type=module','-e',script,repo,pkg],{stdio:['ignore','pipe','pipe','ipc']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const ready=new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{try{assert.equal(code,0,stderr);resolve(JSON.parse(stdout));}catch(e){reject(e);}});});
  return {child,ready,done};
 });
 await Promise.all(jobs.map(j=>j.ready));for(const job of jobs)job.child.send('start');
 return Promise.all(jobs.map(j=>j.done));
}
test('concurrent worktrees update independently and one conflict does not block another',{timeout:15000},async t=>{
 const f=fixture(t),other=path.join(f.root,'other');f.git('worktree','add','-qb','other-task',other);
 f.write('.agent-skill-chain/project/rules.md','First owner');
 fs.mkdirSync(path.join(other,'.agent-skill-chain/project'),{recursive:true});fs.writeFileSync(path.join(other,'.agent-skill-chain/project/rules.md'),'Second owner');
 const indexPaths=['work','other'].map(name=>path.join(f.repo,'.git/worktrees',name,'index'));
 const indexes=indexPaths.map(p=>fs.readFileSync(p));
 assert((await simultaneous(t,[f.work,other],f.pkg)).every(r=>r.applied));
 fs.appendFileSync(path.join(f.pkg,'v05/templates/specs/01_要求定義.md'),'\nNext distribution\n');
 f.write(asset,'First owner custom edit');
 const [first,second]=await simultaneous(t,[f.work,other],f.pkg);
 assert.equal(first.applied,false);assert.deepEqual(first.conflicts,[asset]);assert.equal(second.applied,true);
 assert.equal(fs.readFileSync(path.join(f.work,asset),'utf8'),'First owner custom edit');
 assert.match(fs.readFileSync(path.join(other,asset),'utf8'),/Next distribution/);
 for(const [work,value] of [[f.work,'First owner'],[other,'Second owner']])assert.equal(fs.readFileSync(path.join(work,'.agent-skill-chain/project/rules.md'),'utf8'),value);
 indexPaths.forEach((p,i)=>assert.deepEqual(fs.readFileSync(p),indexes[i]));
 assert.equal(projectAssets(other,{packageRoot:f.pkg}).recordChanged,false);
});
test('moving the package prefix leaves shared assets byte-identical',t=>{
 const f=fixture(t);projectAssets(f.work,{packageRoot:f.pkg,apply:true});
 f.write('docs/specs/API.md','Authored specification');
 const moved=path.join(f.root,'別の prefix');fs.cpSync(f.pkg,moved,{recursive:true});
 const result=projectAssets(f.work,{packageRoot:moved,apply:true});assert.equal(result.applied,true);
 assert.deepEqual(result.changes,[]);assert.equal(result.recordChanged,false);
 const skill=fs.readFileSync(path.join(f.work,'.agent-skill-chain/skills/asc/SKILL.md'),'utf8');
 assert(!skill.includes(moved));assert(!skill.includes(f.pkg));
 assert.equal(fs.readFileSync(path.join(f.work,'docs/specs/API.md'),'utf8'),'Authored specification');
});

test('explicit Skill registration preserves existing entries and remains linked across package updates',t=>{
 const f=fixture(t),registration='.agents/skills/asc/SKILL.md';
 f.write('.agents/skills/custom/SKILL.md','Custom skill');f.write('.codex/config.toml','Owner configuration');
 projectAssets(f.work,{packageRoot:f.pkg,apply:true});assert.equal(fs.existsSync(path.join(f.work,registration)),false);
 const preview=projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true});assert.deepEqual(preview.changes.map(c=>c.path).sort(),registrations);assert.equal(preview.applied,false);
 assert.equal(projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,apply:true}).applied,true);
 assert.equal(projectAssets(f.work,{packageRoot:f.pkg}).recordChanged,false);
 const entry=fs.readFileSync(path.join(f.work,registration),'utf8');const ref=/\]\(([^)]+)\)/.exec(entry)[1];
 assert.equal(path.resolve(path.dirname(path.join(f.work,registration)),ref),path.join(f.work,'.agent-skill-chain/skills/asc/SKILL.md'));
 fs.appendFileSync(path.join(f.pkg,'skills/asc/SKILL.md'),'\nUpdated packaged guidance\n');projectAssets(f.work,{packageRoot:f.pkg,apply:true});
 assert.equal(fs.readFileSync(path.join(f.work,registration),'utf8'),entry);
 assert.match(fs.readFileSync(path.resolve(path.dirname(path.join(f.work,registration)),ref),'utf8'),/Updated packaged guidance/);
 assert.equal(fs.readFileSync(path.join(f.work,'.agents/skills/custom/SKILL.md'),'utf8'),'Custom skill');assert.equal(fs.readFileSync(path.join(f.work,'.codex/config.toml'),'utf8'),'Owner configuration');
 f.write(registration,'Owner customized registration');const conflict=projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,apply:true});assert.equal(conflict.applied,false);assert.deepEqual(conflict.conflicts,[registration]);
});

test('review Skill update reaches registered and project entries without altering another Issue',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true,registerSkill:true};
 projectAssets(f.work,options);
 const other=path.join(f.root,'review-other');f.git('worktree','add','-qb','review-other',other);projectAssets(other,options);
 const otherBefore=fs.readFileSync(path.join(other,'.agent-skill-chain/skills/asc/SKILL.md'));
 fs.appendFileSync(path.join(f.pkg,'skills/asc/SKILL.md'),'\nReview contract revision fixture\n');
 const changed=projectAssets(f.work,options);assert.equal(changed.applied,true);
 const registered=path.join(f.work,'.agents/skills/asc/SKILL.md');
 const relative=fs.readFileSync(registered,'utf8').match(/\]\(([^)]+)\)/)[1];
 const resolved=path.resolve(path.dirname(registered),relative);
 assert.equal(resolved,path.join(f.work,'.agent-skill-chain/skills/asc/SKILL.md'));
 assert(fs.readFileSync(resolved,'utf8').endsWith('Review contract revision fixture\n'));
 assert.deepEqual(fs.readFileSync(path.join(other,'.agent-skill-chain/skills/asc/SKILL.md')),otherBefore);
 assert.equal(projectAssets(f.work,options).changes.length,0);
});

 test('legacy absolute references migrate without adopting owner edits',t=>{
 const f=fixture(t),name='.agent-skill-chain/skills/asc/SKILL.md',record='.agent-skill-chain/distribution.json';
 const old='CLI: /old-user/tools/bin/asc-v05.mjs\n';f.write(name,old);
 f.write(record,JSON.stringify({schema:'asc-project-assets/v1',files:{[name]:createHash('sha256').update(old).digest('hex')}}));
 f.write('.agent-skill-chain/project/rules.md','owner');
 assert.equal(projectAssets(f.work,{packageRoot:f.pkg,apply:true}).applied,true);
 assert(!fs.readFileSync(path.join(f.work,name),'utf8').includes('/old-user/'));
 assert.equal(fs.readFileSync(path.join(f.work,'.agent-skill-chain/project/rules.md'),'utf8'),'owner');
 f.write(name,old+'owner edit');f.write(record,JSON.stringify({schema:'asc-project-assets/v1',files:{[name]:createHash('sha256').update(old).digest('hex')}}));
 assert.equal(projectAssets(f.work,{packageRoot:f.pkg,apply:true}).applied,false);
 assert.equal(fs.readFileSync(path.join(f.work,name),'utf8'),old+'owner edit');
 });

test('runtime inventory excludes unrelated local files and templates and preserves modified runtime on update',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};fs.writeFileSync(path.join(f.pkg,'src/private-token.txt'),'synthetic secret');
 fs.writeFileSync(path.join(f.pkg,'v05/templates/specs/local-notes.md'),'Synthetic unlisted template note');
 const preview=projectAssets(f.work,{...options,apply:false});assert(!preview.changes.some(change=>change.path.endsWith('/local-notes.md')));
 projectAssets(f.work,options);assert(!fs.existsSync(path.join(f.work,'.agent-skill-chain/managed-runtime/src/private-token.txt')));
 for(const name of ['.agent-skill-chain/templates/specs/local-notes.md','.agent-skill-chain/managed-runtime/v05/templates/specs/local-notes.md'])assert.equal(fs.existsSync(path.join(f.work,name)),false);
 const entry='.agent-skill-chain/managed-runtime/src/project-context.mjs';f.write(entry,'owner modified runtime');fs.appendFileSync(path.join(f.pkg,'src/project-context.mjs'),'\n// new version\n');
 const result=projectAssets(f.work,options);assert.equal(result.applied,false);assert(result.conflicts.includes(entry));assert.equal(fs.readFileSync(path.join(f.work,entry),'utf8'),'owner modified runtime');
});

test('legacy removal of runtime inventory fails closed and saved distribution restores future updates',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};f.write('.agent-skill-chain/project/rules.md','owner');projectAssets(f.work,options);
 const record='.agent-skill-chain/distribution.json',saved=fs.readFileSync(path.join(f.work,record));const inventory=JSON.parse(saved);
 const backup=new Map(Object.keys(inventory.files).map(p=>[p,fs.readFileSync(path.join(f.work,p))]));
 for(const p of Object.keys(inventory.files))if(p.startsWith('.agent-skill-chain/managed-runtime/'))delete inventory.files[p];
 f.write(record,JSON.stringify(inventory));
 const pkg=JSON.parse(fs.readFileSync(path.join(f.pkg,'package.json')));pkg.version='0.5.99';fs.writeFileSync(path.join(f.pkg,'package.json'),JSON.stringify(pkg));
 const rejected=projectAssets(f.work,options);assert.equal(rejected.applied,false);assert(rejected.conflicts.includes('.agent-skill-chain/managed-runtime/package.json'));
 // Restore only known distribution assets from the pre-downgrade backup.
 for(const [p,bytes] of backup)f.write(p,bytes);f.write(record,saved);
 assert.equal(projectAssets(f.work,options).applied,true);assert.equal(fs.readFileSync(path.join(f.work,'.agent-skill-chain/project/rules.md'),'utf8'),'owner');
});

test('both distributed usage documents resolve templates and match recorded content hashes',t=>{
 const f=fixture(t);assert.equal(projectAssets(f.work,{packageRoot:f.pkg,apply:true}).applied,true);
 const manifest=JSON.parse(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json')));
 for(const name of ['.agent-skill-chain/v05/USAGE.md','.agent-skill-chain/managed-runtime/v05/USAGE.md']){
  const file=path.join(f.work,name),bytes=fs.readFileSync(file),links=[...bytes.toString().matchAll(/\]\(([^)]*templates\/specs\/[^)]+)\)/g)];
  assert(links.length>0);
  for(const [,link] of links)assert(fs.existsSync(path.resolve(path.dirname(file),link)),link);
  assert.equal(manifest.files[name],createHash('sha256').update(bytes).digest('hex'));
  const migration=fs.readFileSync(path.join(path.dirname(file),'MIGRATION_PLAN.md'),'utf8');
  assert(bytes.toString().includes('MIGRATION_PLAN.md#migration-recovery'));
  assert(migration.includes('<a id="migration-recovery"></a>'));
 }
});

test('foundation canonical assets install, register and update without losing owner protection',t=>{
 const f=fixture(t),options={packageRoot:f.pkg},prefix='.agent-skill-chain/skills/project-foundation/';
 assertFoundation(path.join(f.pkg,'skills/project-foundation'));
 const preview=projectAssets(f.work,options);
 assert.deepEqual(preview.changes.filter(c=>c.path.startsWith(prefix)).map(c=>c.path).sort(),Object.keys(foundationHashes).map(name=>prefix+name).sort());
 assert.equal(fs.existsSync(path.join(f.work,prefix)),false);
 assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
 assertFoundation(path.join(f.work,prefix));
 const registration='.agents/skills/project-foundation/SKILL.md';
 assert.equal(fs.existsSync(path.join(f.work,registration)),false);
 const registered={...options,registerSkill:true,apply:true};
 assert.equal(projectAssets(f.work,registered).applied,true);assertFoundationEntry(f.work);
 const again=projectAssets(f.work,registered);assert.deepEqual(again.changes,[]);assert.equal(again.recordChanged,false);
 const record=path.join(f.work,'.agent-skill-chain/distribution.json'),before=fs.readFileSync(record);
 f.write(registration,'Owner entry');
 assert.equal(projectAssets(f.work,{...options,apply:true}).recordChanged,false);
 assert.deepEqual(fs.readFileSync(record),before);
 assert.deepEqual(projectAssets(f.work,registered).conflicts,[registration]);
 // Even after an ordinary update, explicit registration must not adopt the edit.
 assert.equal(fs.readFileSync(path.join(f.work,registration),'utf8'),'Owner entry');
 const source='skills/project-foundation/references/contracts-and-ui.md';
 fs.appendFileSync(path.join(f.pkg,source),'\nSynthetic distribution update\n');
 const updated=projectAssets(f.work,options);assert(updated.changes.some(c=>c.path===prefix+'references/contracts-and-ui.md'&&c.action==='update'));
 assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
 assert.deepEqual(fs.readFileSync(path.join(f.work,prefix+'references/contracts-and-ui.md')),fs.readFileSync(path.join(f.pkg,source)));
 for(const name of Object.keys(foundationHashes)){
  const target=prefix+name,original=fs.readFileSync(path.join(f.work,target)),saved=fs.readFileSync(record);
  f.write(target,'Owner customized asset');
  assert.deepEqual(projectAssets(f.work,options).conflicts,[target]);
  const blocked=projectAssets(f.work,{...options,apply:true});assert.equal(blocked.applied,false);assert.deepEqual(blocked.conflicts,[target]);
  assert.equal(fs.readFileSync(path.join(f.work,target),'utf8'),'Owner customized asset');assert.deepEqual(fs.readFileSync(record),saved);
  f.write(target,original);
 }
});

test('purpose Skills distribute only inventoried assets and opt-in entries with owner protection',t=>{
 const f=fixture(t),options={packageRoot:f.pkg},prefix='.agent-skill-chain/skills/';
 fs.writeFileSync(path.join(f.pkg,'skills/execution-recovery/private-notes.txt'),'Synthetic unlisted local note');
 const expected=additionalSkills.flatMap(name=>skillFiles(path.join('skills',name)).map(file=>prefix+name+'/'+file));
 const preview=projectAssets(f.work,options);
 for(const file of expected)assert(preview.changes.some(change=>change.path===file&&change.action==='create'),file);
 assert(!preview.changes.some(change=>change.path.endsWith('/private-notes.txt')));
 assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
 assertAdditionalSkills(path.join(f.work,prefix),path.resolve('skills'));
 for(const entry of registrations)assert.equal(fs.existsSync(path.join(f.work,entry)),false);
 const registered={...options,apply:true,registerSkill:true};
 assert.deepEqual(projectAssets(f.work,{...registered,apply:false}).changes.map(change=>change.path).sort(),registrations);
 assert.equal(projectAssets(f.work,registered).applied,true);assertAdditionalEntries(f.work);
 const again=projectAssets(f.work,registered);assert.deepEqual(again.changes,[]);assert.equal(again.recordChanged,false);
 const ordinary=projectAssets(f.work,{...options,apply:true});assert.deepEqual(ordinary.changes,[]);assert.equal(ordinary.recordChanged,false);assert.deepEqual(ordinary.retained,registrations);
 const record=path.join(f.work,'.agent-skill-chain/distribution.json');
 for(const name of additionalSkills){
  const file=prefix+name+'/SKILL.md',source=path.join(f.pkg,'skills',name,'SKILL.md');
  fs.appendFileSync(source,'\nSynthetic revised instructions\n');
  assert(projectAssets(f.work,options).changes.some(change=>change.path===file&&change.action==='update'));
  assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
  assert.deepEqual(fs.readFileSync(path.join(f.work,file)),fs.readFileSync(source));
 }
 for(const file of [...expected,...additionalSkills.map(name=>`.agents/skills/${name}/SKILL.md`)]){
  const target=path.join(f.work,file),original=fs.readFileSync(target),before=fs.readFileSync(record);
  f.write(file,'Synthetic owner edit');
  const isEntry=file.startsWith('.agents/');
  if(isEntry){assert.equal(projectAssets(f.work,{...options,apply:true}).recordChanged,false);assert.deepEqual(fs.readFileSync(record),before);}
  const plan=projectAssets(f.work,{...registered,apply:false});assert.deepEqual(plan.conflicts,[file]);
  assert.equal(projectAssets(f.work,registered).applied,false);
  assert.equal(fs.readFileSync(target,'utf8'),'Synthetic owner edit');assert.deepEqual(fs.readFileSync(record),before);
  f.write(file,original);
 }
});

test('generic Skill registration rejects mismatched canonical identity before writing',t=>{
 const f=fixture(t),file=path.join(f.pkg,'skills/execution-recovery/SKILL.md');
 fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('name: execution-recovery','name: unrelated'));
 assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,apply:true}),/frontmatter must match/);
 assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain')),false);
});

test('Claude opt-in registers all distributed canonical Skills without copying Host-specific metadata',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,registerClaudeSkill:true};
 const claude=registrations.map(name=>name.replace('.agents/','.claude/'));
 projectAssets(f.work,{packageRoot:f.pkg,apply:true});
 const preview=projectAssets(f.work,options);
 assert.deepEqual(preview.changes.map(c=>c.path).sort(),claude);assert.equal(preview.applied,false);
 assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
 assert.equal(claude.length,14);
 for(const relative of claude){
  const file=path.join(f.work,relative),entry=fs.readFileSync(file,'utf8');
  const name=relative.split('/')[2];
  const links=[...entry.matchAll(/\]\(([^)]+)\)/g)];assert.equal(links.length,1);
  const canonical=path.resolve(path.dirname(file),links[0][1]);
  assert.equal(canonical,path.join(f.work,'.agent-skill-chain/skills',name,'SKILL.md'));
  assert(fs.existsSync(canonical));assert.match(entry,/を読み/);
  if(name!=='asc')assert.match(entry,/必要なreferences/);
  assert.deepEqual(entry.match(/^---\n([\s\S]*?)\n---/)[1].split('\n').map(line=>line.split(':')[0]),['name','description']);
  assert.equal(fs.existsSync(path.join(path.dirname(file),'agents/openai.yaml')),false);
  assert.equal(fs.existsSync(path.join(f.work,relative.replace('.claude/','.agents/'))),false);
 }
 const again=projectAssets(f.work,options);assert.deepEqual(again.changes,[]);assert.equal(again.recordChanged,false);
});

test('registration refuses unsupported frontmatter instead of dropping invocation restrictions',t=>{
 const f=fixture(t),source=path.join(f.pkg,'skills/execution-recovery/SKILL.md'),original=fs.readFileSync(source,'utf8');
 for(const setting of ['custom-host-option: synthetic','disable-model-invocation: true','allowed-tools: Read','context: fork','description: duplicate']){
  fs.writeFileSync(source,original.replace('\n---\n',`\n${setting}\n---\n`));
  for(const host of [{registerSkill:true},{registerClaudeSkill:true},{registerSkill:true,registerClaudeSkill:true}]){
   assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,apply:true,...host}),/Unsupported Skill frontmatter/);
   assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain')),false);
  }
 }
 // The special ASC wrapper cannot bypass the same policy boundary.
 fs.writeFileSync(source,original);
 const asc=path.join(f.pkg,'skills/asc/SKILL.md');fs.writeFileSync(asc,fs.readFileSync(asc,'utf8').replace('\n---\n','\ndisable-model-invocation: true\n---\n'));
 assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,registerClaudeSkill:true,apply:true}),/Unsupported Skill frontmatter/);
 assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain')),false);
});

test('Codex registration accepts display metadata and rejects unsupported policy or dependencies before writes',t=>{
 const f=fixture(t),source=path.join(f.pkg,'skills/project-foundation/agents/openai.yaml'),original=fs.readFileSync(source,'utf8');
 for(const setting of ['policy:\n  allow_implicit_invocation: false\n','dependencies:\n  tools: []\n','unknown: synthetic\n','  unknown_display: "synthetic"\n']){
  fs.writeFileSync(source,original+'\n'+setting);
  assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,apply:true}),/Unsupported Codex Skill metadata/);
  assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain')),false);
 }
 fs.writeFileSync(source,original);
 assert.equal(projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,apply:true}).applied,true);
 // A Codex-only policy is not reinterpreted as Claude configuration.
 fs.writeFileSync(source,original+'\npolicy:\n  allow_implicit_invocation: false\n');
 const claude=projectAssets(f.work,{packageRoot:f.pkg,registerClaudeSkill:true,apply:true});assert.equal(claude.applied,true);
 assert.equal(fs.existsSync(path.join(f.work,'.claude/skills/project-foundation/agents/openai.yaml')),false);
});

test('both Host registrations preserve preimages through ordinary updates and block all writes on edits',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true,registerSkill:true,registerClaudeSkill:true};
 assert.equal(projectAssets(f.work,options).applied,true);
 const record=path.join(f.work,'.agent-skill-chain/distribution.json');
 const manifest=JSON.parse(fs.readFileSync(record));
 const entries=registrations.flatMap(name=>[name,name.replace('.agents/','.claude/')]);
 assert.deepEqual(entries.filter(name=>manifest.files[name]),entries);
 for(const entry of entries){
  const original=fs.readFileSync(path.join(f.work,entry));
  f.write(entry,'Owner registration edit');
  const source=path.join(f.pkg,'skills/execution-recovery/SKILL.md');
  fs.appendFileSync(source,'\nSynthetic updated canonical guidance\n');
  const ordinary=projectAssets(f.work,{packageRoot:f.pkg,apply:true});assert.equal(ordinary.applied,true);
  assert.equal(JSON.parse(fs.readFileSync(record)).files[entry],manifest.files[entry]);
  assert.equal(fs.readFileSync(path.join(f.work,entry),'utf8'),'Owner registration edit');
  assert.deepEqual(fs.readFileSync(path.join(f.work,'.agent-skill-chain/skills/execution-recovery/SKILL.md')),fs.readFileSync(source));
  const beforeRecord=fs.readFileSync(record),beforeAsset=fs.readFileSync(path.join(f.work,asset));
  fs.appendFileSync(path.join(f.pkg,'v05/templates/specs/01_要求定義.md'),'\nPending update\n');
  const blocked=projectAssets(f.work,options);assert.equal(blocked.applied,false);assert.deepEqual(blocked.conflicts,[entry]);
  assert.deepEqual(fs.readFileSync(record),beforeRecord);assert.deepEqual(fs.readFileSync(path.join(f.work,asset)),beforeAsset);
  f.write(entry,original);assert.equal(projectAssets(f.work,options).applied,true);
 }
 const again=projectAssets(f.work,options);assert.deepEqual(again.changes,[]);assert.equal(again.recordChanged,false);
});

test('CLI accepts independent or combined Host registration and rejects duplicates',t=>{
 const f=fixture(t),cli=path.join(f.pkg,'bin/asc-v05.mjs');
 for(const flags of [['--register-claude-skill'],['--register-skill'],['--register-skill','--register-claude-skill']]){
  const plan=JSON.parse(execFileSync(process.execPath,[cli,'project-assets',f.work,...flags,'--apply'],{encoding:'utf8'}));assert.equal(plan.applied,true);
 }
 assert.throws(()=>execFileSync(process.execPath,[cli,'project-assets',f.work,'--register-claude-skill','--register-claude-skill'],{stdio:'pipe'}));
});

test('distribution inventory remains bounded after adding a second Host',t=>{
 const f=fixture(t);
 f.write('.agent-skill-chain/distribution.json',JSON.stringify({schema:'asc-project-assets/v1',files:Object.fromEntries(Array.from({length:289},(_,i)=>[`entry-${i}`,'a'.repeat(64)]))}));
 assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,registerClaudeSkill:true,apply:true}),/Invalid asset inventory/);
 assert.equal(fs.existsSync(path.join(f.work,asset)),false);
});

test('the inventory bound includes retained preimages as well as all fourteen Skills',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,registerSkill:true,registerClaudeSkill:true};
 const active=projectAssets(f.work,options);assert.equal(active.changes.length,276);
 const record='.agent-skill-chain/distribution.json';
 const retired=count=>JSON.stringify({schema:'asc-project-assets/v1',files:Object.fromEntries(Array.from({length:count},(_,i)=>[`retired-${i}`,'a'.repeat(64)]))});
 f.write(record,retired(13));
 assert.throws(()=>projectAssets(f.work,{...options,apply:true}),/Invalid asset inventory/);
 assert.equal(fs.existsSync(path.join(f.work,asset)),false);
 f.write(record,retired(12));assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(f.work,record))).files).length,288);
});
