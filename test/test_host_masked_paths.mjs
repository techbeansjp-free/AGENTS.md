import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const implementation=process.env.ASC_TEST_DISTRIBUTION?pathToFileURL(path.join(process.env.ASC_TEST_DISTRIBUTION,'src/worktree-execution.mjs')):new URL('../src/worktree-execution.mjs',import.meta.url);
const {verifyWorktree}=await import(implementation.href);
import {worktreeFixture as fixture} from './helpers/worktree-fixture.mjs';

test('read-only null protection mounts do not make a clean worktree dirty; real source still does',{skip:process.platform!=='linux'},t=>{
 const f=fixture(t),masked=path.join(f.work,'.claude/settings.json');fs.mkdirSync(path.dirname(masked));fs.writeFileSync(masked,'host-only');
 const module=implementation.href;
 const run=(bind='--ro-bind',target=masked)=>spawnSync('bwrap',['--ro-bind','/','/','--dev-bind','/dev','/dev','--bind',f.root,f.root,'--proc','/proc',bind,'/dev/null',target,'--',process.execPath,'--input-type=module','-e',`import {verifyWorktree} from ${JSON.stringify(module)}; console.log(JSON.stringify(verifyWorktree(...process.argv.slice(1))))`,f.work,f.base,f.owner],{encoding:'utf8'});
 const unapproved=run();assert.notEqual(unapproved.status,0);assert.match(unapproved.stderr,/Commit intended changes/);
 f.contract.hostMaskedPaths=['.claude/settings.json'];f.save();
 const ok=run();assert.equal(ok.status,0,ok.stderr);const result=JSON.parse(ok.stdout);assert.equal(result.passed,true);assert.deepEqual(result.hostMaskedPaths,['.claude/settings.json']);
 assert.equal(fs.readFileSync(masked,'utf8'),'host-only'); // underlying Host asset was never changed
 f.contract.hostMaskedPaths=['feature.cjs'];f.save();const overlap=run();assert.notEqual(overlap.status,0);assert.match(overlap.stderr,/outside change scope/);
 f.contract.hostMaskedPaths=['.claude/settings.json'];f.save();
 const writable=run('--bind');assert.notEqual(writable.status,0);assert.match(writable.stderr,/read-only null mounts/);
 fs.writeFileSync(path.join(f.work,'other.txt'),'uncommitted');const other=run();assert.notEqual(other.status,0);assert.match(other.stderr,/Commit intended changes/);fs.unlinkSync(path.join(f.work,'other.txt'));
 fs.writeFileSync(path.join(f.work,'feature.cjs'),'module.exports=99;');const tracked=run();assert.notEqual(tracked.status,0);assert.match(tracked.stderr,/Commit intended changes/);f.git(f.work,'checkout','--','feature.cjs');
 f.contract.commands.push([process.execPath,'-e',"require('fs').writeFileSync('new.txt','new')"]);f.save();const generated=run();assert.notEqual(generated.status,0);assert.match(generated.stderr,/Verification changed/);fs.unlinkSync(path.join(f.work,'new.txt'));
 fs.unlinkSync(masked);fs.symlinkSync('/dev/null',masked);assert.throws(()=>verifyWorktree(f.work,f.base,f.owner),/read-only null mounts/);
});
