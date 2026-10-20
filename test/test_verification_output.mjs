import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {worktreeFixture as fixture} from './helpers/worktree-fixture.mjs';
import {saveVerification} from '../src/verification-output.mjs';
const cli=(f,...args)=>spawnSync(process.execPath,['bin/asc-v05.mjs','worktree-verify',f.work,f.base,f.owner,...args],{encoding:'utf8'});
for(const failure of [false,true])test(`CLI saves full verification and bounded summary; failure=${failure}`,t=>{
 const f=fixture(t),output=path.join(f.root,'result.json');
 if(failure){f.contract.commands=[[process.execPath,'-e','process.exit(7)']];f.save();}
 const p=cli(f,'--output',output);assert.equal(p.status,failure?2:0,p.stderr);
 const summary=JSON.parse(p.stdout),bytes=fs.readFileSync(output),result=JSON.parse(bytes);
 assert.equal(summary.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(result.schema,'asc-worktree-verification/v1');assert.equal(summary.head,f.git(f.work,'rev-parse','HEAD'));
 assert.equal(summary.contractSha256,result.contractSha256);assert.equal(summary.contextSha256,result.contextSha256);
 assert.equal(summary.checks,1);assert.equal(summary.passed,!failure);assert.equal(result.results[0].exit,failure?7:0);
 assert.equal(summary.deliveryAuthorized,false);assert.equal(summary.independentReview,'required');assert.equal(summary.results,undefined);
 assert.equal(f.git(f.work,'status','--porcelain'),'');
 const legacy=cli(f);assert.equal(legacy.status,failure?2:0);assert.equal(JSON.parse(legacy.stdout).schema,result.schema);
});
test('invalid output cannot overwrite owner, existing files, symlinks or worktree; commands never run',t=>{
 const f=fixture(t),sentinel=path.join(f.root,'ran'),old=fs.readFileSync(f.owner);
 f.contract.commands=[[process.execPath,'-e',"require('fs').writeFileSync(process.argv[1],'ran')",sentinel]];f.save();
 const owner=fs.readFileSync(f.owner),existing=path.join(f.root,'existing');fs.writeFileSync(existing,'keep');
 const targets=[f.owner,existing,path.join(f.work,'result.json'),path.join(f.root,'missing','result.json')];
 if(process.platform!=='win32'){
  const link=path.join(f.root,'link');fs.symlinkSync(existing,link);targets.push(link);
  const dir=path.join(f.root,'alias');fs.symlinkSync(f.work,dir);targets.push(path.join(dir,'result.json'));
 }
 for(const output of targets){const p=cli(f,'--output',output);assert.equal(p.status,1);assert.equal(fs.existsSync(sentinel),false);}
 assert.deepEqual(fs.readFileSync(f.owner),owner);assert.equal(fs.readFileSync(existing,'utf8'),'keep');assert.ok(old.length);
});
test('execution exception removes only reserved output',t=>{
 const f=fixture(t),output=path.join(f.root,'result.json');
 assert.throws(()=>saveVerification(f.work,output,()=>{throw Error('test error');}),/test error/);
 assert.equal(fs.existsSync(output),false);
 assert.throws(()=>saveVerification(f.work,output,()=>{fs.renameSync(output,`${output}.reserved`);fs.writeFileSync(output,'replacement');throw Error('changed');}),/changed/);
 assert.equal(fs.readFileSync(output,'utf8'),'replacement');
});

test('verification cannot contaminate the reserved result with a same-inode write',t=>{
 const f=fixture(t),output=path.join(f.root,'result.json');
 f.contract.commands=[[process.execPath,'-e',"require('fs').writeFileSync(process.argv[1],'x'.repeat(100000))",output]];f.save();
 const p=cli(f,'--output',output);assert.equal(p.status,1);assert.match(p.stderr,/destination changed/);assert.equal(fs.existsSync(output),false);
});
