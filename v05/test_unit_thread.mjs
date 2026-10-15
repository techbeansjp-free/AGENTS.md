import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {runControllerThread} from './src/unit-thread.mjs';
function worker(t,source){const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-thread-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'worker.mjs');fs.writeFileSync(file,"import {parentPort} from 'node:worker_threads';\n"+source);return pathToFileURL(file);}
test('controller result does not conceal a later failing exit',async t=>{
 const module=worker(t,"parentPort.postMessage({type:'result',result:{status:'pass'}});process.exitCode=2;");await assert.rejects(runControllerThread(module,{},()=>{}),/without result/);
});
test('controller error and missing result both reject',async t=>{
 for(const source of ["throw Error('controller crash')",''])await assert.rejects(runControllerThread(worker(t,source),{},()=>{}),/controller crash|without result/);
});
test('synchronous work in another controller cannot starve network preflight',{skip:process.platform!=='linux'||process.env.ASC_TEST_ISOLATION==='0'},async t=>{
 const netModule=new URL('./src/agent-network-preflight.mjs',import.meta.url).href,processModule=new URL('./src/restricted-agent.mjs',import.meta.url).href;
 const blocked=worker(t,"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,6000);parentPort.postMessage({type:'result',result:{status:'finished'}});");
 // Positive control uses a real host loopback connection. Negative response is
 // explicitly a test double: this test checks scheduling, not OS isolation.
 const probing=worker(t,`import {networkPreflight} from ${JSON.stringify(netModule)};import {runBoundedProcess} from ${JSON.stringify(processModule)};const start=performance.now();const evidence=await networkPreflight({executable:'negative-test-double',sandbox:[],env:{},run:(binary,args,options)=>binary==='negative-test-double'?Promise.resolve({stdout:JSON.stringify({completed:true,network:'denied'})}):runBoundedProcess(binary,args,options)});parentPort.postMessage({type:'result',result:{elapsed:performance.now()-start,evidence}});`);
 const busy=runControllerThread(blocked,{},()=>{});const probe=await runControllerThread(probing,{},()=>{});assert.equal(probe.evidence.positiveConnections,1);assert(probe.elapsed<5000);await busy;
});


test('failure diagnostics are preserved without becoming a successful result',async t=>{
 const module=worker(t,"parentPort.postMessage({type:'failure',error:'unit blocked',diagnostic:{status:'blocked',calls:[{role:'review',usage:null}]}});parentPort.postMessage({type:'result',result:{status:'pass'}});");
 await assert.rejects(runControllerThread(module,{},()=>{}),error=>{assert.match(error.message,/unit blocked/);assert.equal(error.workflowDiagnostic.calls[0].usage,null);return true;});
});

test('trusted worker threads atomically share admission budget without global session state',async t=>{
 const {createExecutionBudget}=await import('./src/execution-budget.mjs');
 const shared=createExecutionBudget({maxAgentCalls:7});
 const module=worker(t,`import {workerData} from 'node:worker_threads';import {restoreExecutionBudget} from ${JSON.stringify(new URL('./src/execution-budget.mjs',import.meta.url).href)};const b=restoreExecutionBudget(workerData);let admitted=0;for(let i=0;i<10;i++){try{b.admit();admitted++;}catch{}}parentPort.postMessage({type:'result',result:{admitted}});`);
 const results=await Promise.all(Array.from({length:4},()=>runControllerThread(module,shared.shared,()=>{})));
 assert.equal(results.reduce((n,r)=>n+r.admitted,0),7);assert.equal(shared.snapshot().admittedAgentCalls,7);
 const independent=createExecutionBudget({maxAgentCalls:1});independent.admit();assert.equal(independent.snapshot().admittedAgentCalls,1);
 for(const bad of [null,[],{unknown:1},{maxAgentCalls:-1},{maxAgentCalls:1.1},{maxElapsedSeconds:Infinity}])assert.throws(()=>createExecutionBudget(bad),/Invalid/);
 assert.throws(()=>createExecutionBudget({maxElapsedSeconds:0}).admit(),/time budget/);
});
