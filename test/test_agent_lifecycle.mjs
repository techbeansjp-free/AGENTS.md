import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {setTimeout} from 'node:timers/promises';
import {runServiceProcess} from '../src/agent-lifecycle.mjs';
const linux=process.platform==='linux';
test('service lifecycle preserves prompt, output and network namespace preflight',{skip:!linux},async()=>{
 const result=await runServiceProcess('/bin/cat',[],{env:{},input:'private prompt\n',timeout:5000});assert.equal(result.stdout,'private prompt\n');
 const {networkPreflight}=await import('../src/agent-network-preflight.mjs');
 await assert.rejects(networkPreflight({executable:'/usr/bin/env',sandbox:[],env:{},run:runServiceProcess}),/not established/);
 const evidence=await networkPreflight({executable:'/usr/bin/bwrap',sandbox:['--unshare-all','--ro-bind','/','/','--'],env:{},run:runServiceProcess});
 assert.equal(evidence.negative.network,'denied');assert.equal(evidence.sandboxConnections,0);
});
test('service lifecycle rejects timeout, excess output and unavailable executable',{skip:!linux},async()=>{
 await assert.rejects(runServiceProcess('/bin/sleep',['30'],{env:{},input:'',timeout:300}),/deadline/);
 await assert.rejects(runServiceProcess(process.execPath,['-e','process.stdout.write("x".repeat(9*1024*1024))'],{env:{},input:'',timeout:5000}),/output limit/);
 await assert.rejects(runServiceProcess('/nonexistent-asc-provider',[],{env:{},input:'',timeout:5000}),/failed|cleanup/);
});
test('Controller SIGTERM and SIGKILL stop detached service descendants',{skip:!linux},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-service-lifetime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const state=pid=>{try{const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),parts=raw.slice(raw.lastIndexOf(')')+2).split(' ');return {live:parts[0]!=='Z',start:parts[19]};}catch{return null;}};
 for(const signal of ['SIGTERM','SIGKILL']){
  const ready=path.join(root,signal+'.json'),driver=path.join(root,signal+'.mjs');
  const grandchild=`require('fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,parent:process.ppid}));setInterval(()=>{},1000);`;
  const provider=`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`;
  fs.writeFileSync(driver,`import {runServiceProcess} from ${JSON.stringify(new URL('../src/agent-lifecycle.mjs',import.meta.url).href)};await runServiceProcess(process.execPath,['-e',${JSON.stringify(provider)}],{env:{},input:'',timeout:30000});`);
  const controller=spawn(process.execPath,[driver],{stdio:'ignore'});
  try{
   const deadline=Date.now()+5000;while(!fs.existsSync(ready)&&Date.now()<deadline)await setTimeout(10);
   assert(fs.existsSync(ready),'service grandchild must actually start');
   const ids=Object.values(JSON.parse(fs.readFileSync(ready))),owned=ids.map(pid=>({pid,...state(pid)}));assert(owned.every(p=>p.live));
   const exit=once(controller,'exit');controller.kill(signal);await exit;
   const end=Date.now()+4000,survivors=()=>owned.filter(p=>{const current=state(p.pid);return current?.live&&current.start===p.start;});
   while(survivors().length&&Date.now()<end)await setTimeout(20);
   assert.deepEqual(survivors(),[],'detached provider descendants survived Controller death');
  }finally{controller.kill('SIGKILL');}
 }
});

test('lifecycle failure diagnostics are fixed labels and preserve provider exit status',{skip:!linux},async()=>{
 const secret='private-request-diagnostic-sentinel';
 await assert.rejects(runServiceProcess('/nonexistent-asc-provider',[secret],{env:{PRIVATE:secret},input:secret,timeout:5000}),error=>{
  assert.match(error.message,/ASC_LIFECYCLE:provider-spawn/);assert(!error.message.includes(secret));assert(!error.stderr.includes(secret));return true;
 });
 await assert.rejects(runServiceProcess('/bin/sh',['-c','exit 42'],{env:{},input:'',timeout:5000}),error=>{
  assert.match(error.message,/ASC_LIFECYCLE:provider-exit code=42 signal=none/);return true;
 });
});
test('concurrent short-lived providers retain successful output and status',{skip:!linux},async()=>{
 for(let round=0;round<3;round++)await Promise.all(Array.from({length:4},async()=>{
  const result=await runServiceProcess('/bin/sh',['-c','printf complete'],{env:{},input:'',timeout:5000});
  assert.equal(result.stdout,'complete');
 }));
});
