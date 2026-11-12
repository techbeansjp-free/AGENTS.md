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
test('retired Host entries disappear while canonical preimages survive rename and reintroduction',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true,registerSkill:true,registerClaudeSkill:true};
 projectAssets(f.work,options);
 const record=path.join(f.work,'.agent-skill-chain/distribution.json'),before=JSON.parse(fs.readFileSync(record)).files;
 const oldPrefix='skills/execution-recovery/',renamedPrefix='skills/recovery-next/';
 const retained=Object.keys(before).filter(name=>name.startsWith('.agent-skill-chain/')&&name.includes('/'+oldPrefix));
 const entries=['.agents','.claude'].map(host=>`${host}/skills/execution-recovery/SKILL.md`);
 const manifestPath=path.join(f.pkg,'src/runtime-files.json'),inventory=JSON.parse(fs.readFileSync(manifestPath));
 fs.cpSync(path.join(f.pkg,oldPrefix),path.join(f.pkg,renamedPrefix),{recursive:true});
 const source=path.join(f.pkg,renamedPrefix,'SKILL.md');fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('name: execution-recovery','name: recovery-next'));
 fs.writeFileSync(manifestPath,JSON.stringify(inventory.map(name=>name.startsWith(oldPrefix)?renamedPrefix+name.slice(oldPrefix.length):name)));
 f.write('.agents/skills/execution-recovery/owner.txt','Owner sibling');
 const retirement=projectAssets(f.work,{packageRoot:f.pkg,apply:true});assert.equal(retirement.applied,true);
 const after=JSON.parse(fs.readFileSync(record));
 for(const name of retained){assert(retirement.retained.includes(name));assert.equal(after.files[name],before[name]);}
 for(const name of entries){assert(!fs.existsSync(path.join(f.work,name)));assert(!Object.hasOwn(after.files,name));assert(!after.hostEntries.includes(name));}
 assert.equal(fs.readFileSync(path.join(f.work,'.agents/skills/execution-recovery/owner.txt'),'utf8'),'Owner sibling');
 const deletion=retirement.changes.filter(c=>c.action==='delete');assert.deepEqual(deletion.map(c=>c.path).sort(),entries);assert(deletion.every(c=>c.kind==='host-entry'&&c.afterSha256===null));
 fs.writeFileSync(manifestPath,JSON.stringify(inventory));
 assert.equal(projectAssets(f.work,{packageRoot:f.pkg,apply:true}).applied,true);
 for(const name of entries)assert(fs.existsSync(path.join(f.work,name)));
 // Canonical assets retained by either version still reject owner edits later.
 f.write(retained[0],'Owner canonical edit');
 const saved=fs.readFileSync(record);const blocked=projectAssets(f.work,{packageRoot:f.pkg,apply:true});assert.equal(blocked.applied,false);assert(blocked.conflicts.includes(retained[0]));assert.deepEqual(fs.readFileSync(record),saved);
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
 const originalEntry=fs.readFileSync(path.join(f.work,registration));
 f.write(registration,'Owner entry');
 const ordinary=projectAssets(f.work,{...options,apply:true});assert.equal(ordinary.applied,false);assert.deepEqual(ordinary.conflicts,[registration]);
 assert.equal(ordinary.recordChanged,false);
 assert.deepEqual(fs.readFileSync(record),before);
 assert.deepEqual(projectAssets(f.work,registered).conflicts,[registration]);
 // Even after an ordinary update, explicit registration must not adopt the edit.
 assert.equal(fs.readFileSync(path.join(f.work,registration),'utf8'),'Owner entry');
 f.write(registration,originalEntry);
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
 const ordinary=projectAssets(f.work,{...options,apply:true});assert.deepEqual(ordinary.changes,[]);assert.equal(ordinary.recordChanged,false);assert.deepEqual(ordinary.retained,[]);
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
 assert.equal(claude.length,15);
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
 assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,registerClaudeSkill:true,apply:true}),/Unsupported Codex Skill metadata/);
 const claudeFixture=fixture(t);fs.writeFileSync(path.join(claudeFixture.pkg,'skills/project-foundation/agents/openai.yaml'),original+'\npolicy:\n  allow_implicit_invocation: false\n');
 const claude=projectAssets(claudeFixture.work,{packageRoot:claudeFixture.pkg,registerClaudeSkill:true,apply:true});assert.equal(claude.applied,true);
 assert.equal(fs.existsSync(path.join(claudeFixture.work,'.claude/skills/project-foundation/agents/openai.yaml')),false);
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
  const canonical=fs.readFileSync(path.join(f.work,'.agent-skill-chain/skills/execution-recovery/SKILL.md'));
  const ordinary=projectAssets(f.work,{packageRoot:f.pkg,apply:true});assert.equal(ordinary.applied,false);assert.deepEqual(ordinary.conflicts,[entry]);
  assert.equal(JSON.parse(fs.readFileSync(record)).files[entry],manifest.files[entry]);
  assert.equal(fs.readFileSync(path.join(f.work,entry),'utf8'),'Owner registration edit');
  assert.deepEqual(fs.readFileSync(path.join(f.work,'.agent-skill-chain/skills/execution-recovery/SKILL.md')),canonical);
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
 f.write('.agent-skill-chain/distribution.json',JSON.stringify({schema:'asc-project-assets/v1',files:Object.fromEntries(Array.from({length:295},(_,i)=>[`entry-${i}`,'a'.repeat(64)]))}));
 assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,registerClaudeSkill:true,apply:true}),/Invalid asset inventory/);
 assert.equal(fs.existsSync(path.join(f.work,asset)),false);
});

test('the inventory bound includes retained preimages as well as all fifteen registered Skills and optional assets',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,registerSkill:true,registerClaudeSkill:true};
 const active=projectAssets(f.work,options);assert.equal(active.changes.length,286);
 const record='.agent-skill-chain/distribution.json';
 const retired=count=>JSON.stringify({schema:'asc-project-assets/v1',files:Object.fromEntries(Array.from({length:count},(_,i)=>[`retired-${i}`,'a'.repeat(64)]))});
 f.write(record,retired(13));
 assert.throws(()=>projectAssets(f.work,{...options,apply:true}),/Invalid asset inventory/);
 assert.equal(fs.existsSync(path.join(f.work,asset)),false);
 f.write(record,retired(12));assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(f.work,record))).files).length,298);
});

test('explicit deliberation is distributed intact but never auto-registered',t=>{
 const f=fixture(t);
 projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,registerClaudeSkill:true,apply:true});
 const optional='.agent-skill-chain/managed-runtime/v05/optional-skills/model-deliberation/';
 assert.equal(fs.readFileSync(path.join(f.work,optional,'agents/openai.yaml'),'utf8'),fs.readFileSync(path.join(f.pkg,'v05/optional-skills/model-deliberation/agents/openai.yaml'),'utf8'));
 assert.match(fs.readFileSync(path.join(f.work,optional,'agents/openai.yaml'),'utf8'),/allow_implicit_invocation: false/);
 for(const host of ['.agents','.claude'])assert.equal(fs.existsSync(path.join(f.work,host,'skills/model-deliberation')),false);
 assert.equal(fs.existsSync(path.join(f.work,'.agents/skills/tracker-issue-writing/SKILL.md')),true);
});

function decomposeNames(directory){
 let changed=0;
 for(const name of fs.readdirSync(directory)){
  const file=path.join(directory,name);
  if(fs.lstatSync(file).isDirectory())changed+=decomposeNames(file);
  const decomposed=name.normalize('NFD');
  if(name!==decomposed){const temporary=file+'.unicode-rename';fs.renameSync(file,temporary);fs.renameSync(temporary,path.join(directory,decomposed));changed++;}
 }
 return changed;
}
const unicodeTemplate='v05/templates/specs/details/07_データ/00_データ一覧.md';
const unicodeAsset='.agent-skill-chain/templates/specs/details/07_データ/00_データ一覧.md';
test('NFD distribution sources install NFC records and update existing NFD destination names',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};
 assert(decomposeNames(path.join(f.pkg,'v05/templates/specs'))>0);
 f.write('.agent-skill-chain/project/rules.md','Owner rule');f.write('docs/specs/データ.md','Owner specification');
 assert.equal(projectAssets(f.work,options).applied,true);
 const record=path.join(f.work,'.agent-skill-chain/distribution.json');
 assert(Object.keys(JSON.parse(fs.readFileSync(record)).files).every(name=>name===name.normalize('NFC')));
 assert(decomposeNames(path.join(f.work,'.agent-skill-chain'))>0);
 const stable=fs.readFileSync(record),unchanged=projectAssets(f.work,options);assert.deepEqual(unchanged.changes,[]);assert.equal(unchanged.recordChanged,false);
 const decomposed=path.join(f.work,unicodeAsset.normalize('NFD'));
 fs.appendFileSync(path.join(f.pkg,unicodeTemplate.normalize('NFD')),'\nUpdated NFD source\n');
 assert.equal(projectAssets(f.work,options).applied,true);
 assert.match(fs.readFileSync(decomposed,'utf8'),/Updated NFD source/);
 if(process.platform==='linux')assert.equal(fs.existsSync(path.join(f.work,unicodeAsset)),false);
 fs.appendFileSync(decomposed,'\nOwner edit\n');
 const before=fs.readFileSync(record),blocked=projectAssets(f.work,options);assert.equal(blocked.applied,false);assert.deepEqual(blocked.conflicts,[unicodeAsset]);assert.deepEqual(fs.readFileSync(record),before);
 assert.notDeepEqual(before,stable);
 assert.equal(fs.readFileSync(path.join(f.work,'.agent-skill-chain/project/rules.md'),'utf8'),'Owner rule');assert.equal(fs.readFileSync(path.join(f.work,'docs/specs/データ.md'),'utf8'),'Owner specification');
});
test('NFC-equivalent source and destination aliases reject before writing even with an exact match',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};
 const source=path.join(f.pkg,unicodeTemplate),alias=source.normalize('NFD');fs.mkdirSync(path.dirname(alias),{recursive:true});fs.writeFileSync(alias,'Ambiguous source');
 if(fs.readdirSync(path.dirname(path.dirname(source))).filter(name=>name.normalize('NFC')==='07_データ').length!==2){t.skip('Filesystem does not preserve distinct canonical aliases');return;}
 assert.throws(()=>projectAssets(f.work,options),/Ambiguous Unicode asset path/);assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain')),false);
 fs.rmSync(path.dirname(alias),{recursive:true});
 const target=path.join(f.work,unicodeAsset),targetAlias=target.normalize('NFD');f.write(unicodeAsset,'Owner NFC');f.write(unicodeAsset.normalize('NFD'),'Owner NFD');
 assert.throws(()=>projectAssets(f.work,options),/Ambiguous Unicode asset path/);
 assert.equal(fs.readFileSync(target,'utf8'),'Owner NFC');assert.equal(fs.readFileSync(targetAlias,'utf8'),'Owner NFD');assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain/distribution.json')),false);
});
test('NFD path aliases retain symlink and hardlink protection',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};
 decomposeNames(path.join(f.pkg,'v05/templates/specs'));
 const alias=unicodeTemplate.normalize('NFD'),target=path.join(f.pkg,alias);fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.unlinkSync(target);
 const outside=path.join(f.root,'outside');fs.writeFileSync(outside,'Owner secret');fs.symlinkSync(outside,target);
 assert.throws(()=>projectAssets(f.work,options),/symlink/);assert.equal(fs.readFileSync(outside,'utf8'),'Owner secret');assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain')),false);
 fs.unlinkSync(target);fs.linkSync(outside,target);assert.throws(()=>projectAssets(f.work,options),/Unsafe asset/);
});
test('single NFD record keys migrate to NFC while canonical aliases in records reject before writing',t=>{
 const f=fixture(t),options={packageRoot:f.pkg,apply:true};projectAssets(f.work,options);
 const record=path.join(f.work,'.agent-skill-chain/distribution.json'),original=JSON.parse(fs.readFileSync(record));
 const decomposed=structuredClone(original);decomposed.files[unicodeAsset.normalize('NFD')]=decomposed.files[unicodeAsset];delete decomposed.files[unicodeAsset];
 fs.writeFileSync(record,JSON.stringify(decomposed));assert.equal(projectAssets(f.work,options).applied,true);
 assert.deepEqual(JSON.parse(fs.readFileSync(record)),original);
 decomposed.files[unicodeAsset]=original.files[unicodeAsset];const ambiguous=JSON.stringify(decomposed);fs.writeFileSync(record,ambiguous);
 assert.throws(()=>projectAssets(f.work,options),/Ambiguous Unicode asset inventory/);assert.equal(fs.readFileSync(record,'utf8'),ambiguous);
});
test('noncanonical runtime inventory rejects before creating project assets',t=>{
 const f=fixture(t),file=path.join(f.pkg,'src/runtime-files.json'),inventory=JSON.parse(fs.readFileSync(file));
 fs.writeFileSync(file,JSON.stringify(inventory.map(name=>name.normalize('NFD'))));
 assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,apply:true}),/Runtime inventory paths must use NFC/);
 assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain')),false);
});

function nextSkillDistribution(f){
 const manifest=path.join(f.pkg,'src/runtime-files.json'),inventory=JSON.parse(fs.readFileSync(manifest));
 const from='skills/execution-recovery/',to='skills/recovery-next/';
 fs.cpSync(path.join(f.pkg,from),path.join(f.pkg,to),{recursive:true});
 const source=path.join(f.pkg,to,'SKILL.md');fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('name: execution-recovery','name: recovery-next'));
 fs.writeFileSync(manifest,JSON.stringify(inventory.map(name=>name.startsWith(from)?to+name.slice(from.length):name)));
 for(const skill of ['asc','verification-optimization']){
  const file=path.join(f.pkg,'skills',skill,'SKILL.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('description: ','description: Revised description '));
 }
}
function savedAssets(work){
 const record=path.join(work,'.agent-skill-chain/distribution.json');
 return new Map([...Object.keys(JSON.parse(fs.readFileSync(record)).files),'.agent-skill-chain/distribution.json'].map(name=>[name,fs.readFileSync(path.join(work,name))]));
}
function assertSaved(work,saved){for(const [name,bytes] of saved)assert.deepEqual(fs.readFileSync(path.join(work,name)),bytes,name);}
function legacyRecord(f){
 const name='.agent-skill-chain/distribution.json',record=JSON.parse(fs.readFileSync(path.join(f.work,name)));
 delete record.registeredHosts;delete record.hostEntries;f.write(name,JSON.stringify(record));return record;
}

test('ordinary updates remember both, single, or no Host selection and preview entry additions, descriptions and deletes',t=>{
 for(const selection of [{registerSkill:true,registerClaudeSkill:true},{registerSkill:true},{registerClaudeSkill:true},{}]){
  const f=fixture(t),options={packageRoot:f.pkg};
  assert.equal(projectAssets(f.work,{...options,...selection,apply:true}).applied,true);
  const selected=[...(selection.registerSkill?['.agents']:[]),...(selection.registerClaudeSkill?['.claude']:[])];
  nextSkillDistribution(f);
  const saved=savedAssets(f.work),preview=projectAssets(f.work,options);assertSaved(f.work,saved);
  assert.deepEqual(preview.registeredHosts,selected);
  const entries=preview.changes.filter(c=>c.kind==='host-entry');
  assert.equal(entries.length,selected.length*4);
  for(const host of selected){
   assert.deepEqual(entries.filter(c=>c.host===host).map(c=>[c.path,c.action]).sort(),[
    [`${host}/skills/asc/SKILL.md`,'update'],[`${host}/skills/execution-recovery/SKILL.md`,'delete'],[`${host}/skills/recovery-next/SKILL.md`,'create'],[`${host}/skills/verification-optimization/SKILL.md`,'update']]);
  }
  assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
  for(const host of ['.agents','.claude']){
   assert.equal(fs.existsSync(path.join(f.work,host,'skills/recovery-next/SKILL.md')),selected.includes(host));
   assert.equal(fs.existsSync(path.join(f.work,host,'skills/execution-recovery/SKILL.md')),false);
   if(selected.includes(host))for(const skill of ['asc','verification-optimization'])assert.match(fs.readFileSync(path.join(f.work,host,'skills',skill,'SKILL.md'),'utf8'),/description: Revised description/);
  }
  const again=projectAssets(f.work,{...options,apply:true});assert.deepEqual(again.changes,[]);assert.equal(again.recordChanged,false);
 }
});

test('legacy records upgrade only proven entry ownership and retain each chosen Host through ordinary updates',t=>{
 for(const selection of [{registerSkill:true,registerClaudeSkill:true},{registerSkill:true},{registerClaudeSkill:true},{}]){
  const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,...selection,apply:true});legacyRecord(f);nextSkillDistribution(f);
  const selected=[...(selection.registerSkill?['.agents']:[]),...(selection.registerClaudeSkill?['.claude']:[])];
  const saved=savedAssets(f.work),preview=projectAssets(f.work,options);assertSaved(f.work,saved);assert.deepEqual(preview.registeredHosts,selected);
  assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
  const record=JSON.parse(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json')));assert.deepEqual(record.registeredHosts,selected);assert.equal(record.hostEntries.length,selected.length*15);
  assert(record.hostEntries.every(name=>!name.includes('/execution-recovery/')));
  assert.equal(projectAssets(f.work,options).recordChanged,false);
 }
});

test('legacy ownership proof survives edited or missing entries, and ambiguous records cannot silently opt out or opt in',t=>{
 for(const mode of ['edited','missing','ambiguous','arbitrary']){
  const f=fixture(t),options={packageRoot:f.pkg},entry='.agents/skills/execution-recovery/SKILL.md';
  projectAssets(f.work,{...options,registerSkill:true,apply:true});const original=legacyRecord(f);
  if(mode==='missing')fs.unlinkSync(path.join(f.work,entry));else f.write(entry,'Owner entry');
  if(mode==='ambiguous')for(const prefix of ['.agent-skill-chain/skills/','.agent-skill-chain/managed-runtime/skills/'])f.write(prefix+'execution-recovery/SKILL.md','Owner canonical entry');
  if(mode==='arbitrary'){
   f.write('.agent-skill-chain/distribution.json',JSON.stringify({schema:'asc-project-assets/v1',files:{[entry]:createHash('sha256').update('Owner entry').digest('hex')}}));
  }
  nextSkillDistribution(f);const record=fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json'));
  const result=projectAssets(f.work,{...options,apply:true});assert.equal(result.applied,false);assert(result.conflicts.includes(entry));assert.deepEqual(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json')),record);
  assert.equal(fs.existsSync(path.join(f.work,'.agents/skills/recovery-next/SKILL.md')),false);
  if(mode==='arbitrary')assert.deepEqual(result.registeredHosts,[]);else assert.deepEqual(result.registeredHosts,['.agents']);
  if(mode!=='missing')assert.equal(fs.readFileSync(path.join(f.work,entry),'utf8'),'Owner entry');
  assert(original.files[entry]);
 }
});

test('legacy fixed ASC wrapper is recognized even when its entry is locally deleted',t=>{
 const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,registerSkill:true,apply:true});
 const entry='.agents/skills/asc/SKILL.md',old=fs.readFileSync(path.join(f.work,entry),'utf8').replace(/^description: .+$/m,'description: ASCで許可された開発・再開・独立レビューを実行するとき、プロジェクトのASC入口を使う。通常作業へASC導入を強制しない。');
 const record=legacyRecord(f);record.files[entry]=createHash('sha256').update(old).digest('hex');f.write('.agent-skill-chain/distribution.json',JSON.stringify(record));
 fs.unlinkSync(path.join(f.work,entry));const result=projectAssets(f.work,{...options,apply:true});assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[entry]);assert.deepEqual(result.registeredHosts,['.agents']);
 f.write(entry,old);assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);
 const description=s=>s.match(/^description: .+$/m)[0],updated=fs.readFileSync(path.join(f.work,entry),'utf8');
 assert.equal(description(updated),description(fs.readFileSync(path.join(f.pkg,'skills','asc','SKILL.md'),'utf8')));assert.notEqual(description(updated),description(old));
});

test('edited or missing retired entries block additions, updates, deletions and record changes together',t=>{
 for(const mode of ['edited','missing']){
  const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,registerSkill:true,registerClaudeSkill:true,apply:true});nextSkillDistribution(f);
  const entry='.claude/skills/execution-recovery/SKILL.md';if(mode==='edited')f.write(entry,'Owner edit');else fs.unlinkSync(path.join(f.work,entry));
  const record=fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json')),other=fs.readFileSync(path.join(f.work,'.agents/skills/execution-recovery/SKILL.md'));
  const result=projectAssets(f.work,{...options,apply:true});assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[entry]);assert.deepEqual(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json')),record);assert.deepEqual(fs.readFileSync(path.join(f.work,'.agents/skills/execution-recovery/SKILL.md')),other);
  assert.equal(fs.existsSync(path.join(f.work,'.agents/skills/recovery-next/SKILL.md')),false);
 }
});

test('unowned identical current or newly added Host entries conflict without adopting them',t=>{
 for(const existing of [true,false]){
  const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,...(!existing?{registerSkill:true}:{}),apply:true});
  if(!existing)nextSkillDistribution(f);
  const plan=projectAssets(f.work,{...options,registerSkill:true}),entry=`.agents/skills/${existing?'asc':'recovery-next'}/SKILL.md`;
  const donor=path.join(f.root,'donor');f.git('worktree','add','-qb','donor',donor);projectAssets(donor,{...options,registerSkill:true,apply:true});
  f.write(entry,fs.readFileSync(path.join(donor,entry)));
  const before=fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json'));const result=projectAssets(f.work,{...options,...(existing?{registerSkill:true}:{}),apply:true});
  assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[entry]);assert.deepEqual(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json')),before);assert(plan.changes.some(c=>c.path===entry));
 }
});

test('retired entry deletion keeps symlink, hardlink and parent protections and rejects malformed ownership',t=>{
 const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,registerSkill:true,apply:true});nextSkillDistribution(f);
 const entry='.agents/skills/execution-recovery/SKILL.md',target=path.join(f.work,entry),original=fs.readFileSync(target),record=fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json'));
 const outside=path.join(f.root,'outside');fs.writeFileSync(outside,'Outside owner file');
 fs.unlinkSync(target);fs.symlinkSync(outside,target);assert.throws(()=>projectAssets(f.work,{...options,apply:true}),/symlink/);assert.deepEqual(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json')),record);
 fs.unlinkSync(target);fs.linkSync(outside,target);assert.throws(()=>projectAssets(f.work,{...options,apply:true}),/Unsafe asset/);assert.equal(fs.readFileSync(outside,'utf8'),'Outside owner file');
 fs.unlinkSync(target);fs.writeFileSync(target,original);
 const parent=path.dirname(target),moved=path.join(f.root,'moved');fs.renameSync(parent,moved);fs.symlinkSync(moved,parent);assert.throws(()=>projectAssets(f.work,{...options,apply:true}),/symlink/);fs.unlinkSync(parent);fs.renameSync(moved,parent);
 for(const invalid of ['../owner','.agents/skills/execution-recovery/owner.txt','.claude/skills/execution-recovery/SKILL.md']){
  const changed=JSON.parse(record);changed.hostEntries.push(invalid);f.write('.agent-skill-chain/distribution.json',JSON.stringify(changed));
  assert.throws(()=>projectAssets(f.work,{...options,apply:true}),/Invalid Host entry ownership/);assert.deepEqual(fs.readFileSync(target),original);
 }
});

test('failed partial or complete apply restores deleted, added, updated entries and record before retry',t=>{
 for(const mode of ['partial','complete','owner-edit']){
  const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,registerSkill:true,registerClaudeSkill:true,apply:true});nextSkillDistribution(f);
  const saved=savedAssets(f.work),tools=path.join(f.root,'tools');fs.mkdirSync(tools);
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),originalPath=process.env.PATH;
  const deleted=path.join(f.work,'.agents/skills/execution-recovery/SKILL.md'),created=path.join(f.work,'.agents/skills/recovery-next/SKILL.md');
  const donor=path.join(f.root,'rollback-donor');f.git('worktree','add','-qb','rollback-donor',donor);projectAssets(donor,{...options,registerSkill:true,apply:true});
  const postimage=fs.readFileSync(path.join(donor,'.agents/skills/recovery-next/SKILL.md'),'utf8');
  const injection=mode==='partial'?`fs.unlinkSync(${JSON.stringify(deleted)});fs.mkdirSync(${JSON.stringify(path.dirname(created))},{recursive:true});fs.writeFileSync(${JSON.stringify(created)},${JSON.stringify(postimage)});`:
   `const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);`+(mode==='owner-edit'?`fs.mkdirSync(${JSON.stringify(path.dirname(deleted))},{recursive:true});fs.writeFileSync(${JSON.stringify(deleted)},'Owner during failed apply');`:'');
  const script=`#!${process.execPath}\nimport fs from 'node:fs';import {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2);if(args.includes('apply')){${injection}process.exit(1);}const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??1);\n`;
  fs.writeFileSync(path.join(tools,'git'),script,{mode:0o755});
  try{process.env.PATH=tools+path.delimiter+originalPath;assert.throws(()=>projectAssets(f.work,{...options,apply:true}),mode==='owner-edit'?/rollback incomplete for .agents\/skills\/execution-recovery\/SKILL.md/:/Asset Git operation failed/);}finally{process.env.PATH=originalPath;}
  if(mode==='owner-edit'){
   assert.equal(fs.readFileSync(deleted,'utf8'),'Owner during failed apply');saved.delete('.agents/skills/execution-recovery/SKILL.md');
  }
  assertSaved(f.work,saved);assert.equal(fs.existsSync(created),false);
  if(mode!=='owner-edit'){assert.equal(projectAssets(f.work,{...options,apply:true}).applied,true);assert.equal(fs.existsSync(deleted),false);assert.equal(fs.existsSync(created),true);}
 }
});

test('owned Host entries edited to exactly the next release still conflict',t=>{
 const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,registerSkill:true,apply:true});
 const name='.agents/skills/verification-optimization/SKILL.md',source=path.join(f.pkg,'skills/verification-optimization/SKILL.md');
 fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('description: ','description: Next description '));
 const donor=path.join(f.root,'next-donor');f.git('worktree','add','-qb','next-donor',donor);projectAssets(donor,{...options,registerSkill:true,apply:true});
 f.write(name,fs.readFileSync(path.join(donor,name)));const saved=savedAssets(f.work);
 const result=projectAssets(f.work,{...options,apply:true});assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[name]);assertSaved(f.work,saved);
});

test('modern Host ownership claims cannot delete or overwrite unrelated plain or wrapper-like owner content',t=>{
 for(const [host,skill,bytes] of [
  ['.agents','user-private','Unrelated private owner Skill\n'],
  ['.claude','user-private','---\nname: user-private\ndescription: Owner metadata\n---\nOwner instructions, not an ASC wrapper\n'],
  ['.agents','verification-optimization','Owner replacement at a distributed Skill path\n']
 ]){
  const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,registerSkill:true,registerClaudeSkill:true,apply:true});
  const entry=`${host}/skills/${skill}/SKILL.md`,record='.agent-skill-chain/distribution.json';f.write(entry,bytes);
  const manifest=JSON.parse(fs.readFileSync(path.join(f.work,record)));if(!manifest.hostEntries.includes(entry))manifest.hostEntries.push(entry);manifest.files[entry]=createHash('sha256').update(bytes).digest('hex');f.write(record,JSON.stringify(manifest));
  nextSkillDistribution(f);const saved=savedAssets(f.work),preview=projectAssets(f.work,options);assert(preview.conflicts.includes(entry));assert(!preview.changes.some(c=>c.path===entry));assertSaved(f.work,saved);
  const result=projectAssets(f.work,{...options,apply:true});assert.equal(result.applied,false);assert(result.conflicts.includes(entry));assertSaved(f.work,saved);assert.equal(fs.existsSync(path.join(f.work,'.agents/skills/recovery-next/SKILL.md')),false);
 }
});

test('unrecorded identical canonical, runtime, template and generated assets never become managed',t=>{
 const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,apply:true});
 const names=['.agent-skill-chain/skills/verification-optimization/SKILL.md','.agent-skill-chain/managed-runtime/src/project-assets.mjs',asset,'.agent-skill-chain/bin/asc.mjs','.agent-skill-chain/runtime.json','.agent-skill-chain/v05/USAGE.md'];
 for(const [index,name] of names.entries()){
  const other=path.join(f.root,'unowned-'+index);f.git('worktree','add','-qb','unowned-'+index,other);
  const target=path.join(other,name),bytes=fs.readFileSync(path.join(f.work,name));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
  for(const apply of [false,true]){
   const result=projectAssets(other,{...options,apply});assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[name]);assert.deepEqual(fs.readFileSync(target),bytes);assert.equal(fs.existsSync(path.join(other,'.agent-skill-chain/distribution.json')),false);
  }
 }
});

test('recorded canonical and template edits equal to the next release remain whole-update conflicts',t=>{
 for(const source of ['skills/verification-optimization/SKILL.md','v05/templates/specs/01_要求定義.md']){
  const f=fixture(t),options={packageRoot:f.pkg};projectAssets(f.work,{...options,apply:true});
  const file=path.join(f.pkg,source);fs.appendFileSync(file,'\nNext release bytes already copied by owner\n');
  const target=source.startsWith('skills/')?'.agent-skill-chain/'+source:asset;f.write(target,fs.readFileSync(file));
  const saved=savedAssets(f.work),result=projectAssets(f.work,{...options,apply:true});assert.equal(result.applied,false);assert.deepEqual(result.conflicts,[target]);assertSaved(f.work,saved);
 }
});
