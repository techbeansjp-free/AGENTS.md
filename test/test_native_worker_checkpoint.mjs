import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
import {interruptSavedAttempt} from '../scripts/native-interrupted-attempt.mjs';
import {workerCheckpointObserver} from '../scripts/native-worker-checkpoint.mjs';
test('worker checkpoint requires distinct registered worktrees and rejects linked output',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-worker-checkpoint-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
 const git=(...args)=>execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','-c','core.hooksPath=/dev/null',...args],{cwd:root,env,stdio:'pipe'});
 git('init');for(const name of ['a','b'])fs.writeFileSync(path.join(root,name),'original');git('add','.');git('commit','-m','fixture');
 const integration=path.join(root,'.worktrees/integration');git('worktree','add','--detach',integration);
 const observe=workerCheckpointObserver({origin:root,integration,relativeFiles:['a','b']});
 fs.writeFileSync(path.join(integration,'a'),'integration edit');assert.deepEqual(observe(),[]);
 fs.writeFileSync(path.join(integration,'a'),'original');
 const one=path.join(root,'.worktrees/one'),two=path.join(root,'.worktrees/two');git('worktree','add','--detach',one);git('worktree','add','--detach',two);
 for(const name of ['a','b'])fs.writeFileSync(path.join(one,name),'worker edit');assert.deepEqual(observe(),[]);
 fs.writeFileSync(path.join(two,'b'),'second edit');const records=observe();assert.equal(records.length,2);assert.notEqual(records[0].workspace,records[1].workspace);assert.ok(records.every(r=>r.before!==r.after));
 const active=new Set([one]);
 const activeOnly=workerCheckpointObserver({origin:root,integration,relativeFiles:['a','b'],isWorkerActive:workspace=>active.has(workspace)});
 assert.deepEqual(activeOnly(),[],'one completed worker must not count as two interrupted workers');
 active.add(two);assert.equal(activeOnly().length,2);active.clear();assert.deepEqual(activeOnly(),[]);
 assert.equal(activeOnly({afterStop:true,workspaces:[one,two]}).length,2,'post-stop observation checks saved bytes, not ongoing execution');
 assert.throws(()=>workerCheckpointObserver({origin:root,integration,relativeFiles:['a','b'],isWorkerActive:true}),/lifecycle/);
 const third=path.join(root,'.worktrees/third');git('worktree','add','--detach',third);fs.writeFileSync(path.join(third,'a'),'third edit');
 active.add(two);active.add(third);const fixed=activeOnly();assert.deepEqual(fixed.map(r=>r.workspace),[third,two]);active.clear();
 assert.deepEqual(activeOnly({afterStop:true,workspaces:fixed.map(r=>r.workspace)}),fixed,'completed earlier worktree must not replace the pinned pair');
 assert.throws(()=>activeOnly({afterStop:true}),/fixed stopped/);fs.writeFileSync(path.join(third,'a'),'original');


 await t.test('two saved workers survive actual process interruption',async sub=>{
  const managerEnv={PATH:'/usr/bin:/bin',XDG_RUNTIME_DIR:`/run/user/${process.getuid?.()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid?.()}/bus`};
  if(process.platform!=='linux'||spawnSync('/usr/bin/systemctl',['--user','show','--property=Version'],{env:managerEnv}).status!==0){sub.skip('Linux user service required for fault injection');return;}
  for(const workspace of [one,two])for(const name of ['a','b'])fs.writeFileSync(path.join(workspace,name),'original');
  // Each child saves partial work and remains alive. Neither can finish before interruption.
  const workers=[[path.join(one,'a'),'unfinished A'],[path.join(two,'b'),'unfinished B']];
  const workerCode=`const fs=require('fs');fs.writeFileSync(process.argv[1]+'.pid',String(process.pid));fs.writeFileSync(process.argv[1],process.argv[2]);setInterval(()=>{},1000);`;
  const code=`const {spawn}=require('child_process');for(const [file,text] of ${JSON.stringify(workers)})spawn(process.execPath,['-e',${JSON.stringify(workerCode)},file,text],{stdio:'inherit'});setInterval(()=>{},1000);`;
  const checkpoint=await interruptSavedAttempt({directory:path.join(root,'interrupted'),executable:process.execPath,argv:['-e',code],env,input:'',files:['a','b'].map(n=>path.join(integration,n)),observeWorkers:observe});
  assert.equal(checkpoint.checkpoint,true);assert.equal(checkpoint.stopped,true);assert.equal(checkpoint.workerWorktrees.length,2);
  for(const [file,partial] of workers){
   assert.equal(fs.readFileSync(file,'utf8'),partial);
   const pid=Number(fs.readFileSync(file+'.pid','utf8'));
   assert.ok(Number.isSafeInteger(pid)&&pid>0);
   assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'interrupted child must have exited before recovery');
   // A fresh process reads saved work before completing it; no reset/reimplementation.
   const recovered=spawnSync(process.execPath,['-e',`const fs=require('fs');const [file,expected]=process.argv.slice(1);if(fs.readFileSync(file,'utf8')!==expected)process.exit(2);fs.appendFileSync(file,'\\ncompleted');`,file,partial],{env});
   assert.equal(recovered.status,0,recovered.stderr?.toString());
   assert.equal(fs.readFileSync(file,'utf8'),partial+'\ncompleted');
  }
  for(const name of ['a','b'])assert.equal(fs.readFileSync(path.join(integration,name),'utf8'),'original','recovery must not change integration or sibling work');
 });
 fs.writeFileSync(path.join(integration,'b'),'integrated');assert.deepEqual(observe(),[]);fs.writeFileSync(path.join(integration,'b'),'original');
 fs.unlinkSync(path.join(two,'b'));fs.symlinkSync(path.join(root,'b'),path.join(two,'b'));assert.throws(observe,/non-symlink/);
 assert.throws(()=>workerCheckpointObserver({origin:root,integration,relativeFiles:['../a','b']}),/Invalid/);
});

test('recovery requires distinct pre-integration workers and exact final saved bytes',async()=>{
 const {createHash}=await import('node:crypto');const {workerRecoveryEvidence}=await import('../scripts/native-worker-checkpoint.mjs');
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const names=['reservation/service.mjs','billing/service.mjs'];
 const checkpoint={checkpoint:true,stopped:true,interrupted:true,signalSent:true,checkpointScope:'two distinct worker worktrees before integration',workerWorktrees:['worker-a','worker-b'],files:names.map(name=>({name,before:hash('old'),after:hash(name)}))};
 const files=new Map(names.map(name=>[name,Buffer.from(name)]));
 assert.equal(workerRecoveryEvidence(checkpoint,files).verified,true);
 for(const patch of [{stopped:false},{workerWorktrees:['same','same']},{checkpointScope:'integration edit'},{files:[checkpoint.files[0],checkpoint.files[0]]}])assert.throws(()=>workerRecoveryEvidence({...checkpoint,...patch},files));
 const changed=new Map(files);changed.set(names[0],Buffer.from('replacement'));assert.equal(workerRecoveryEvidence(checkpoint,changed).verified,false);
});
