import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {startWorktree,verifyWorktree} from '../src/worktree-execution.mjs';
import {projectAssets} from '../src/project-assets.mjs';
import {projectLocation} from '../src/project-location.mjs';
function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-nongit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('non-Git start is read-only and does not claim commit verification or delivery',t=>{
 const root=directory(t);fs.writeFileSync(path.join(root,'app.js'),'owner content');
 const result=startWorktree(root);assert.equal(result.gitManaged,false);assert.equal(result.head,null);assert.equal(result.execution,'current-host-directory');assert.equal(result.providerLaunch,false);assert.equal(result.verified,false);assert.equal(result.deliveryAuthorized,false);
 assert.deepEqual(fs.readdirSync(root),['app.js']);assert.throws(()=>verifyWorktree(root,'HEAD','nonexistent'),/Git/);
});
test('non-Git project assets install and update idempotently without creating repository or touching owner files',t=>{
 const root=directory(t),project=path.join(root,'project'),pkg=path.join(root,'package');fs.mkdirSync(project);fs.mkdirSync(pkg);
 for(const name of ['v05/templates/specs','skills/asc'])fs.cpSync(name,path.join(pkg,name),{recursive:true});
 fs.mkdirSync(path.join(project,'.agent-skill-chain/project'),{recursive:true});fs.writeFileSync(path.join(project,'.agent-skill-chain/project/rules.md'),'owner');
 const options={packageRoot:pkg,apply:true,registerSkill:true};assert.equal(projectAssets(project,options).applied,true);assert(!fs.existsSync(path.join(project,'.git')));
 assert.equal(projectAssets(project,options).changes.length,0);
 fs.appendFileSync(path.join(pkg,'skills/asc/SKILL.md'),'\nUpdated\n');assert.equal(projectAssets(project,options).changes.length,1);
 const asset=path.join(project,'.agent-skill-chain/skills/asc/SKILL.md');fs.appendFileSync(asset,'\nOwner edit\n');fs.appendFileSync(path.join(pkg,'skills/asc/SKILL.md'),'\nAnother update\n');assert.equal(projectAssets(project,options).applied,false);
 assert.equal(fs.readFileSync(path.join(project,'.agent-skill-chain/project/rules.md'),'utf8'),'owner');assert(!fs.existsSync(path.join(project,'.git')));
});
test('broken Git metadata, repo subdirectories, and bare metadata never bypass workspace requirements',t=>{
 const root=directory(t),repo=path.join(root,'repo');fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,'.git'),'gitdir: missing');assert.throws(()=>projectLocation(repo),/Git/);fs.unlinkSync(path.join(repo,'.git'));
 execFileSync('git',['init','-q',repo]);assert.throws(()=>projectLocation(repo),/dedicated/);const child=path.join(repo,'child');fs.mkdirSync(child);assert.throws(()=>projectLocation(child),/root required/);assert.throws(()=>projectLocation(path.join(repo,'.git')),/metadata/);
});
