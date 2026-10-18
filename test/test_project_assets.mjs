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
 for(const name of ['v05','skills/asc','src/project-launcher.mjs','package.json'])fs.cpSync(name,path.join(pkg,name),{recursive:true});
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
 const update=projectAssets(f.work,options);assert.deepEqual(update.changes.map(c=>[c.path,c.action]),[[asset,'update']]);
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
 const result=projectAssets(f.work,options);assert.equal(result.applied,true);assert.deepEqual(result.retained,[asset]);assert(fs.existsSync(path.join(f.work,asset)));
 f.write('.agent-skill-chain/distribution.json',JSON.stringify({schema:'asc-project-assets/v1',files:{'../outside':'a'.repeat(64)}}));assert.throws(()=>projectAssets(f.work,options),/Unsafe source path/);
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
 const preview=projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true});assert.deepEqual(preview.changes.map(c=>c.path),[registration]);assert.equal(preview.applied,false);
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
