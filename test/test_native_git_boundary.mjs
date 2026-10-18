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
