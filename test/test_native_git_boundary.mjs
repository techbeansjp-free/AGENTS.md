import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {gitControlState,assertGitControlState} from '../scripts/native-git-boundary.mjs';
test('synthetic Host rejects changed config/hooks and linked controls before executing Git',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-git-control-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=path.join(root,'.git');fs.mkdirSync(path.join(git,'hooks'),{recursive:true});const config=path.join(git,'config');fs.writeFileSync(config,'[core]\n bare = false\n');
 const baseline=gitControlState(root);assert.doesNotThrow(()=>assertGitControlState(root,baseline));
 fs.writeFileSync(config,'[core]\n fsmonitor = /untrusted-command\n');assert.throws(()=>assertGitControlState(root,baseline),/changed/);
 fs.writeFileSync(config,'[core]\n bare = false\n');fs.writeFileSync(path.join(git,'hooks','post-checkout'),'untrusted');assert.throws(()=>assertGitControlState(root,baseline),/changed/);fs.unlinkSync(path.join(git,'hooks','post-checkout'));
 fs.mkdirSync(path.join(git,'worktrees','new'),{recursive:true});assert.doesNotThrow(()=>assertGitControlState(root,baseline));
 fs.writeFileSync(path.join(git,'worktrees','new','config.worktree'),'untrusted');assert.throws(()=>assertGitControlState(root,baseline),/changed/);fs.unlinkSync(path.join(git,'worktrees','new','config.worktree'));
 fs.unlinkSync(config);fs.symlinkSync(path.join(root,'missing'),config);assert.throws(()=>gitControlState(root),/Unsafe/);
});

test('Host pins the worktree pointer and administration without blocking unused worktrees',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-git-pointer-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const admin=path.join(root,'.git/worktrees/current'),worktree=path.join(root,'.worktrees/current');fs.mkdirSync(admin,{recursive:true});fs.mkdirSync(worktree,{recursive:true});
 const pointer=path.join(worktree,'.git'),common=path.join(admin,'commondir'),gitdir=path.join(admin,'gitdir');
 fs.writeFileSync(pointer,`gitdir: ${admin}\n`);fs.writeFileSync(common,'../..\n');fs.writeFileSync(gitdir,pointer+'\n');
 const original=gitControlState(root,[worktree]);assert.doesNotThrow(()=>assertGitControlState(root,original,[worktree]));
 for(const file of [pointer,common,gitdir]){const bytes=fs.readFileSync(file);fs.writeFileSync(file,'redirected');assert.throws(()=>assertGitControlState(root,original,[worktree]));fs.writeFileSync(file,bytes);}
 assert.throws(()=>assertGitControlState(root,original),/changed/);
 const other=path.join(root,'.git/worktrees/other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'commondir'),'../..');fs.writeFileSync(path.join(other,'gitdir'),'/unused/.git');assert.doesNotThrow(()=>assertGitControlState(root,original,[worktree]));
 fs.unlinkSync(pointer);fs.symlinkSync(gitdir,pointer);assert.throws(()=>assertGitControlState(root,original,[worktree]),/Unsafe/);
});

test('precreated empty worktree configuration is pinned rather than ignored',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-empty-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const admin=path.join(root,'.git/worktrees/current');fs.mkdirSync(admin,{recursive:true});
 const files=[path.join(root,'.git/config.worktree'),path.join(admin,'config.worktree')];
 for(const file of files)fs.writeFileSync(file,'',{flag:'wx'});
 const baseline=gitControlState(root);assert.doesNotThrow(()=>assertGitControlState(root,baseline));
 for(const file of files){fs.writeFileSync(file,'[core]\n fsmonitor = injected\n');assert.throws(()=>assertGitControlState(root,baseline),/changed/);fs.writeFileSync(file,'');fs.unlinkSync(file);assert.throws(()=>assertGitControlState(root,baseline),/changed/);fs.writeFileSync(file,'');}
});

test('only newly materialized empty worker configs are neutral',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-new-empty-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const admin=path.join(root,'.git/worktrees/worker');fs.mkdirSync(admin,{recursive:true});
 const original=gitControlState(root),file=path.join(admin,'config.worktree');
 fs.writeFileSync(file,'');assert.doesNotThrow(()=>assertGitControlState(root,original));
 fs.writeFileSync(file,'[core]\n fsmonitor = injected\n');assert.throws(()=>assertGitControlState(root,original),/changed/);
 fs.unlinkSync(file);const outside=path.join(root,'empty');fs.writeFileSync(outside,'');fs.symlinkSync(outside,file);assert.throws(()=>assertGitControlState(root,original),/Unsafe/);fs.unlinkSync(file);
 fs.writeFileSync(path.join(root,'.git/config.worktree'),'');assert.throws(()=>assertGitControlState(root,original),/changed/);
});
