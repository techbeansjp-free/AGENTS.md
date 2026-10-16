import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {projectAssets} from '../src/project-assets.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-assets-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'});
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'app.txt'),'base');git('add','.');git('commit','-qm','base');
 const work=path.join(root,'work');git('worktree','add','-qb','task',work);
 const pkg=path.join(root,'package');fs.mkdirSync(pkg);
 for(const name of ['v05/templates/specs','skills/asc'])fs.cpSync(name,path.join(pkg,name),{recursive:true});
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
 assert.match(fs.readFileSync(path.join(f.work,'.agent-skill-chain/skills/asc/SKILL.md'),'utf8'),/file:\/\//);
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
