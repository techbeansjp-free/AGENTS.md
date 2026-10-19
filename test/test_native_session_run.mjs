import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runNativeSession} from '../scripts/native-session-run.mjs';
test('synthetic runner retries exact session once and retains every attempt',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-session-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let calls=0,boundaries=0;
 const session='12345678-1234-1234-1234-123456789012';
 const result=await runNativeSession({root,c:{options:['-c','permission=unchanged'],env:{}},worktree:root,model:'selected',effort:'medium',prompt:'synthetic',checkBoundary:()=>boundaries++},{wait:async()=>{},launch:(_c,args)=>{
  calls++;assert.ok(args.includes('permission=unchanged'));assert.equal(args[args.indexOf('-m')+1],'selected');
  if(calls===2){assert.ok(args.includes('resume'));assert.ok(args.includes(session));assert.ok(!args.includes('--last'));}
  const records=[{type:'thread.started',thread_id:session},calls===1?{type:'turn.failed',error:{message:'Selected model is at capacity. Please try a different model.'}}:{type:'turn.completed',usage:{input_tokens:1}}];
  return {binary:process.execPath,args:['-e',`process.stdin.resume();process.stdin.on('end',()=>{console.log(${JSON.stringify(records.map(r=>JSON.stringify(r)).join('\n'))});process.exitCode=${calls===1?1:0}})`]};
 }});
 assert.equal(result.status,0);assert.equal(result.automaticResumes,1);assert.equal(result.attempts.length,2);assert.equal(boundaries,3);
 assert.match(fs.readFileSync(path.join(root,'events.jsonl'),'utf8'),/turn.failed/);assert.ok(fs.existsSync(path.join(root,'attempt-0.jsonl')));
});

test('synthetic runner does not loop on capacity or retry other errors',async t=>{
 for(const message of ['Selected model is at capacity. Please try a different model.','authentication failed']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-session-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let calls=0;
  const result=await runNativeSession({root,c:{options:[],env:{}},worktree:root,model:'selected',effort:'medium',prompt:'synthetic',checkBoundary:()=>{}},{wait:async()=>{},launch:()=>{
   calls++;const output=[{type:'thread.started',thread_id:'12345678-1234-1234-1234-123456789012'},{type:'turn.failed',error:{message}}].map(JSON.stringify).join('\n');
   return {binary:process.execPath,args:['-e',`process.stdin.resume();process.stdin.on('end',()=>{console.log(${JSON.stringify(output)});process.exitCode=1})`]};
  }});
  assert.equal(result.status,1);assert.equal(calls,message.startsWith('Selected')?2:1);
 }
});

test('invalid session identity cannot leave a successful delivery status',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-session-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 await assert.rejects(runNativeSession({root,c:{options:[],env:{}},worktree:root,model:'selected',effort:'medium',prompt:'synthetic',checkBoundary:()=>{}},{launch:()=>({binary:process.execPath,args:['-e',`process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'turn.completed'})))`]})}),/identity/);
 const result=JSON.parse(fs.readFileSync(path.join(root,'result.json')));assert.equal(result.status,1);assert.equal(result.identityError,true);
});
