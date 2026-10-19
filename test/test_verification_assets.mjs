import {setTimeout} from 'node:timers';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {inspectAssets,AssetController} from '../src/verification-assets.mjs';import {hash} from '../src/controller.mjs';
const enabled=process.platform==='linux'&&process.env.ASC_TEST_ISOLATION!=='0';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-assets-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),runtime=path.join(root,'runtime'),deps=path.join(root,'deps');for(const dir of [repo,runtime,deps])fs.mkdirSync(dir);
 fs.copyFileSync(fs.realpathSync(process.execPath),path.join(runtime,'node'));fs.chmodSync(path.join(runtime,'node'),0o755);fs.writeFileSync(path.join(deps,'value.json'),'42');
 const git=(...a)=>execFileSync('git',a,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'code.txt'),'before');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');fs.writeFileSync(path.join(repo,'code.txt'),'after');git('add','.');git('commit','-qm','candidate');
 const pin=source=>({source,digest:inspectAssets(source).digest});
 const verificationAssets={runtime:pin(runtime),dependencies:[{...pin(deps),target:'node_modules'}]};
 const contract={intent:'after',criteria:['after'],allowedPaths:['code.txt'],testArgv:['/runtime/node','-e','const fs=require("fs");if(fs.readFileSync("node_modules/value.json","utf8")!=="42")process.exit(2);try{fs.writeFileSync("node_modules/value.json","bad");process.exit(3)}catch(e){if(e.code!=="EROFS")throw e}process.stdout.write("42")'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:'',verificationAssets};
 return {root,repo,runtime,deps,contract,base};
}
test('pinned runtimes and dependencies execute read-only in actual isolation',{skip:!enabled},t=>{
 const f=fixture(t),c=new AssetController({...f,implementer:'worker'});c.verify();
 assert.equal(c.events.at(-1).results[0].stdoutSha256,hash('42'));assert.equal(fs.readFileSync(path.join(f.deps,'value.json'),'utf8'),'42');
 fs.writeFileSync(path.join(f.deps,'value.json'),'43');assert.throws(()=>c.verify(),/digest changed/);
});
test('private asset snapshot remains pinned if original dependencies change',{skip:!enabled},t=>{
 const f=fixture(t),c=new AssetController({...f,implementer:'worker'}),profile=c.sandboxProfile();t.after(()=>profile.cleanup());
 fs.writeFileSync(path.join(f.deps,'value.json'),'changed');const i=profile.bindings.indexOf('/work/node_modules');
 assert.equal(fs.readFileSync(path.join(profile.bindings[i-1],'value.json'),'utf8'),'42');
});
test('asset aliases, source shadowing and Git authority mounts are refused',{skip:!enabled},t=>{
 const f=fixture(t);fs.symlinkSync('../outside',path.join(f.deps,'link'));fs.writeFileSync(path.join(f.root,'outside'),'outside');assert.throws(()=>inspectAssets(f.deps),/escapes/);fs.unlinkSync(path.join(f.deps,'link'));
 fs.linkSync(path.join(f.deps,'value.json'),path.join(f.deps,'alias'));assert.throws(()=>inspectAssets(f.deps),/Unsafe snapshot file/);fs.unlinkSync(path.join(f.deps,'alias'));
 for(const target of ['code.txt','.git','.agents','../escape']){
  const contract=structuredClone(f.contract);contract.verificationAssets.dependencies[0].target=target;
  assert.throws(()=>new AssetController({...f,contract,implementer:'worker'}));
 }
 const contract=structuredClone(f.contract);contract.verificationAssets.runtime.source=path.join(f.repo,'.git');
 assert.throws(()=>new AssetController({...f,contract,implementer:'worker'}),/Git authority/);
});
test('owner resource profile rejects unknown configuration',t=>{
 const f=fixture(t);assert.throws(()=>new AssetController({...f,contract:{...f.contract,verificationResourceProfile:'unlimited'},implementer:'worker'}),/Unknown verification resource profile/);
});
test('dedicated resource verification rejects caught OOM and subsequent healthy invocation succeeds',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},t=>{
 const f=fixture(t),contract={...f.contract,verificationResourceProfile:'browser-cgroup-v1'};
 const good=new AssetController({...f,contract,implementer:'worker'});good.verify();
 const first=good.events.at(-1).results[0];assert.equal(first.exit,0);assert.equal(first.resourceBoundary.cleanupConfirmed,true);
 const code='import os,signal\np=os.fork()\nif p==0:\n a=[bytearray(16*1024*1024) for _ in range(80)]\n os._exit(23)\n_,s=os.waitpid(p,0)\nassert os.WIFSIGNALED(s) and os.WTERMSIG(s)==signal.SIGKILL\n';
 const bad=new AssetController({...f,contract:{...contract,testArgv:['/usr/bin/python3','-c',code]},implementer:'worker'});
 assert.throws(()=>bad.verify(),/Verification failed/);
 const rejected=bad.events.at(-1).results[0];assert.equal(rejected.exit,125);assert.equal(rejected.resourceBoundary.processExit,0);assert.equal(rejected.resourceBoundary.exhausted,true);
 good.verify();const last=good.events.at(-1).results[0];assert.equal(last.exit,0);assert.notEqual(first.resourceBoundary.unit,last.resourceBoundary.unit);assert.notEqual(rejected.resourceBoundary.unit,last.resourceBoundary.unit);
});
test('bounded output overflow is typed after cleanup and does not block next verification',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},t=>{
 const f=fixture(t),contract={...f.contract,verificationResourceProfile:'browser-cgroup-v1'};
 for(const fd of [1,2]){
 const broken=new AssetController({...f,contract:{...contract,testArgv:['/usr/bin/python3','-c',`import os; os.write(${fd},b"x"*2097152)`]},implementer:'worker'});
 assert.throws(()=>broken.verify(),error=>{
  assert.equal(error.code,'ASC_VERIFICATION_OUTPUT_LIMIT');
  assert.equal(error.verificationDiagnostic.executionError,'ENOBUFS');
  assert.equal(error.verificationDiagnostic.cleanupConfirmed,true);
  assert.equal(fs.existsSync(path.join('/sys/fs/cgroup',error.verificationDiagnostic.after.cgroup)),false);
  assert.equal(error.verificationDiagnostic.authority,'diagnostic only; no successful verification or approval');
  return true;
 });
 const good=new AssetController({...f,contract,implementer:'worker'});good.verify();
 assert.equal(good.events.at(-1).results[0].resourceBoundary.cleanupConfirmed,true);
 }
});
test('bounded output failure survives a later timeout while descendants hold pipes',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},async()=>{
 const {runBoundedVerification}=await import('../src/verification-resources.mjs');
 // The child keeps inherited pipes open beyond the timeout after the parent
 // exceeds the output limit. The first failure must not become repairable.
 const code='import os,time\np=os.fork()\nif p==0:\n time.sleep(0.8)\n os._exit(0)\nos.write(1,b"x"*2097152)\n';
 assert.throws(()=>runBoundedVerification(['--','/usr/bin/python3','-c',code],400),error=>{
  assert.equal(error.code,'ASC_VERIFICATION_OUTPUT_LIMIT');
  assert.equal(error.verificationDiagnostic.executionError,'ENOBUFS');
  assert.equal(error.verificationDiagnostic.cleanupConfirmed,true);
  assert.equal(fs.existsSync(path.join('/sys/fs/cgroup',error.verificationDiagnostic.after.cgroup)),false);
  return true;
 });
});
test('bounded protocol preserves both streams at the exact output limit',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},async()=>{
 const {runBoundedVerification}=await import('../src/verification-resources.mjs');
 const result=runBoundedVerification(['--','/usr/bin/python3','-c','import os; os.write(1,b"x"*1048576); os.write(2,b"y"*1048576)']);
 assert.equal(result.status,0);
 assert.deepEqual(result.stdout,Buffer.alloc(1048576,'x'));
 assert.deepEqual(result.stderr,Buffer.alloc(1048576,'y'));
 assert.equal(result.resourceBoundary.cleanupConfirmed,true);
});
test('only explicit file bounds reject large generated files',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},t=>{
 const f=fixture(t),argv=size=>['/usr/bin/python3','-c',`import os; f=os.open('/tmp/bound-probe',os.O_CREAT|os.O_WRONLY,0o600); os.ftruncate(f,${size}); os.close(f)`];
 const defaultController=new AssetController({...f,contract:{...f.contract,testArgv:argv(2097152)},implementer:'worker'});defaultController.verify();
 const browser=new AssetController({...f,contract:{...f.contract,verificationResourceProfile:'browser-cgroup-v1',testArgv:argv(2097152)},implementer:'worker'});browser.verify();
 const over=new AssetController({...f,contract:{...f.contract,verificationResourceProfile:'browser-cgroup-v1',verificationLimits:{fileBytes:8388608},testArgv:argv(8388609)},implementer:'worker'});assert.throws(()=>over.verify(),/Verification failed/);
});

test('timed-out verification does not cancel a concurrent sibling or latch later work',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},async t=>{
 const {Worker}=await import('node:worker_threads');
 const slow=fixture(t),healthy=fixture(t);
 const workerSource=`const {parentPort,workerData}=require('node:worker_threads');
 (async()=>{const {AssetController}=await import(workerData.module);const started=Date.now();let error=null;
 const c=new AssetController({...workerData.input,implementer:'worker'});
 try{c.verify();}catch(e){error=String(e);}
 parentPort.postMessage({started,finished:Date.now(),error,events:c.events});})().catch(e=>{throw e});`;
 const launch=input=>new Promise((resolve,reject)=>{
  const worker=new Worker(workerSource,{eval:true,workerData:{module:new URL('../src/verification-assets.mjs',import.meta.url).href,input}});
  let result;worker.on('message',m=>{result=m;});worker.once('error',reject);worker.once('exit',code=>code===0&&result?resolve(result):reject(Error('verification worker failed '+code)));
 });
 const badContract={...slow.contract,verificationLimits:{timeoutMilliseconds:25000},verificationResourceProfile:'browser-cgroup-v1',testArgv:['/usr/bin/python3','-c','import subprocess,time; child=subprocess.Popen(["/usr/bin/python3","-c","import time; time.sleep(60)"]); assert child.poll() is None; print("child-started",flush=True); time.sleep(60)']};
 const goodContract={...healthy.contract,verificationResourceProfile:'browser-cgroup-v1',testArgv:['/usr/bin/python3','-c','import time; time.sleep(10); print("healthy")']};
 const badRun=launch({...slow,contract:badContract});
 await new Promise(resolve=>setTimeout(resolve,20000));
 const [bad,good]=await Promise.all([badRun,launch({...healthy,contract:goodContract})]);
 assert.match(bad.error,/Verification failed/);
 const timedOut=bad.events.at(-1).results[0];assert.equal(timedOut.resourceBoundary.executionError,'ETIMEDOUT');
 assert.equal(timedOut.stdoutSha256,hash('child-started\n'));assert.equal(timedOut.resourceBoundary.cleanupConfirmed,true);
 assert(bad.finished-bad.started>=25000&&bad.finished-bad.started<40000);
 assert(bad.finished<good.finished,'healthy verification must survive sibling timeout cleanup');
 assert.equal(good.error,null);assert(good.started<bad.finished&&bad.started<good.finished,'verification intervals must overlap');
 const healthyBoundary=good.events.at(-1).results[0].resourceBoundary;
 assert(healthyBoundary.before.observedAt<timedOut.resourceBoundary.after.observedAt,'healthy cgroup must already exist at timeout');
 assert(healthyBoundary.after.observedAt>bad.finished,'healthy workload must survive timeout cleanup');
 assert.equal(good.events.at(-1).results[0].stdoutSha256,hash('healthy\n'));
 assert.equal(good.events.at(-1).results[0].resourceBoundary.cleanupConfirmed,true);
 // A separate invocation in the same process remains usable after the timeout.
 const retry=new AssetController({...slow,contract:{...slow.contract,verificationResourceProfile:'browser-cgroup-v1'},implementer:'worker'});retry.verify();
 assert.equal(retry.events.at(-1).results[0].exit,0);assert.equal(retry.events.at(-1).results[0].resourceBoundary.cleanupConfirmed,true);
});

test('verification timeout reaches the running isolated command in both resource profiles',{skip:!enabled},async t=>{
 const {createExecutionBudget}=await import('../src/execution-budget.mjs');
 for(const bounded of [false,...(process.env.ASC_TEST_CGROUP==='1'?[true]:[])]){
  const f=fixture(t);f.contract.testArgv=['/bin/sh','-c','printf started; for n in 1 2 3 4 5 6 7 8; do sleep 5 & done; wait'];if(bounded)f.contract.verificationResourceProfile='browser-cgroup-v1';
  let observed,timeout;
  class ObservedController extends AssetController{executeVerification(args,remaining){timeout=remaining;observed=super.executeVerification(args,remaining);return observed;}}
  const c=new ObservedController({...f,implementer:'worker'}),budget=createExecutionBudget({maxElapsedSeconds:1});
  let failure;assert.throws(()=>c.verify({timeout:()=>budget.verificationTimeout()}),error=>{failure=error;return /Verification/.test(error.message);});
  assert(observed,failure?.message);
  assert(timeout>0&&timeout<=1000);assert.equal(observed.stdout.toString(),'started');
  if(bounded){assert.equal(observed.resourceBoundary.executionError,'ETIMEDOUT');assert.equal(observed.resourceBoundary.cleanupConfirmed,true);}else assert.equal(observed.error.code,'ETIMEDOUT');
 }
});

test('file output is unlimited unless owner supplies a budget; explicit overflow refuses',{skip:!enabled},t=>{
 const f=fixture(t);const command=bytes=>['/runtime/node','-e',`require('node:fs').writeFileSync('generated.bin',Buffer.alloc(${bytes}));`];
 const make=limits=>new AssetController({...f,contract:{...f.contract,testArgv:command(9_112_572),...(limits?{verificationLimits:limits}:{})},implementer:'worker'});
 make().verify();
 const raised=make({fileBytes:12_000_000});raised.verify();assert.equal(raised.events.at(-1).results[0].exit,0);
 assert.throws(()=>new AssetController({...f,contract:{...f.contract,testArgv:command(12_000_001),verificationLimits:{fileBytes:12_000_000}},implementer:'worker'}).verify(),/Verification/);
 for(const verificationLimits of [{fileBytes:0},{fileBytes:Number.MAX_SAFE_INTEGER+1},{cpuSeconds:-1},{timeoutMilliseconds:2147483648},{timeoutMilliseconds:1.2},{unknown:1},null,[]]){
  const c=new AssetController({...f,contract:{...f.contract,verificationLimits},implementer:'worker'});assert.throws(()=>c.target(),/Invalid verification limit/);
 }
 assert.notEqual(make().binding().contract,raised.binding().contract);
});
test('explicit long verification budget survives the cgroup default deadline',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},t=>{
 const f=fixture(t),c=new AssetController({...f,contract:{...f.contract,verificationResourceProfile:'browser-cgroup-v1',verificationLimits:{timeoutMilliseconds:40000},testArgv:['/runtime/node','-e','setTimeout(()=>console.log("done"),31000)']},implementer:'worker'});
 c.verify();const result=c.events.at(-1).results[0];assert.equal(result.exit,0);assert(result.seconds>=31);assert.equal(result.resourceBoundary.cleanupConfirmed,true);
});
test('owner timeout never overrides remaining invocation budget',async()=>{
 const {createExecutionBudget}=await import('../src/execution-budget.mjs');
 assert.equal(createExecutionBudget().verificationTimeout(120000),120000);
 const b=createExecutionBudget({maxElapsedSeconds:1});assert(b.verificationTimeout(120000)<=1000);
 assert.equal(createExecutionBudget().verificationTimeout(),null);
 assert.equal(createExecutionBudget().verificationTimeout(1200000),1200000);
 assert.equal(createExecutionBudget({agentTimeoutMilliseconds:1200000}).agentTimeout(),1200000);
 assert(b.verificationTimeout(1200000)<=1000);
 assert.throws(()=>b.verificationTimeout(2147483648),/Invalid verification timeout/);
});

test('owner memory budget is observed by kernel and OOM cannot become success',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},t=>{
 const f=fixture(t),make=bytes=>new AssetController({...f,contract:{...f.contract,verificationResourceProfile:'browser-cgroup-v1',verificationLimits:{memoryBytes:134217728},testArgv:['/runtime/node','-e',`const b=Buffer.alloc(${bytes},1);console.log(b.length);`]},implementer:'worker'});
 const good=make(16*1024*1024);good.verify();const success=good.events.at(-1).results[0];assert.equal(success.resourceBoundary.before.limits['memory.max'],'134217728');assert.equal(success.resourceBoundary.cleanupConfirmed,true);
 const bad=make(256*1024*1024);assert.throws(()=>bad.verify(),/Verification/);const result=bad.events.at(-1).results[0];assert.equal(result.exit,125);assert(result.resourceBoundary.delta['memory.events'].oom_kill>0);assert.equal(result.resourceBoundary.cleanupConfirmed,true);
 for(const memoryBytes of [0,67108863,134217729,4294967297,Infinity])assert.throws(()=>new AssetController({...f,contract:{...f.contract,verificationResourceProfile:'browser-cgroup-v1',verificationLimits:{memoryBytes}},implementer:'worker'}).target(),/Invalid verification/);
 assert.throws(()=>new AssetController({...f,contract:{...f.contract,verificationLimits:{memoryBytes:134217728}},implementer:'worker'}).target(),/requires cgroup/);
});


test('normal exit waits for finite teardown but rejects a surviving descendant',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},async()=>{
 const {runBoundedVerification}=await import('../src/verification-resources.mjs');
 const invoke=seconds=>runBoundedVerification(['--','/bin/sh','-c',`sleep ${seconds} >/dev/null 2>&1 & exit 0`],5000);
 const delayed=runBoundedVerification(['--','/bin/sh','-c','(sleep 0.2; echo important) & exit 0'],null);assert.equal(delayed.stdout.toString(),'important\n');assert.equal(delayed.status,0);
 const good=invoke('0.15');assert.equal(good.status,0);assert.equal(good.resourceBoundary.after.processes.length,1);assert.equal(good.resourceBoundary.cleanupConfirmed,true);
 assert.throws(()=>invoke('30'),/Verification descendants remain/);
 const retry=invoke('0.05');assert.equal(retry.status,0);assert.notEqual(retry.resourceBoundary.unit,good.resourceBoundary.unit);
});


test('unlimited verification stops when its Controller is killed',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},async t=>{
 const {spawn}=await import('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-owner-lifetime-')),marker=path.join(root,'child.json');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const script=`import {runBoundedVerification} from ${JSON.stringify(new URL('../src/verification-resources.mjs',import.meta.url).href)};runBoundedVerification(['--',process.execPath,'-e',${JSON.stringify("const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,cgroup:fs.readFileSync('/proc/self/cgroup','utf8')}));setInterval(()=>{},1000)")},${JSON.stringify(marker)}],null);`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:'ignore'});t.after(()=>child.kill('SIGKILL'));
 const pause=()=>new Promise(r=>setTimeout(r,50));
 for(let i=0;i<200&&!fs.existsSync(marker);i++)await pause();
 assert(fs.existsSync(marker),'verification did not start');const observed=JSON.parse(fs.readFileSync(marker,'utf8'));
 const unit=path.basename(observed.cgroup.trim().split('::')[1]);
 t.after(()=>{try{execFileSync('systemctl',['--user','stop',unit],{stdio:'ignore'});}catch{/* Already stopped. */}});
 child.kill('SIGKILL');
 const dir=path.join('/sys/fs/cgroup',observed.cgroup.trim().split('::')[1]);
 for(let i=0;i<200&&fs.existsSync(dir);i++)await pause();
 assert.equal(fs.existsSync(dir),false,'orphan verification cgroup remains');
});

test('killed resource observer retains failure diagnostics and confirms cleanup',{skip:!enabled||process.env.ASC_TEST_CGROUP!=='1'},async()=>{
 const {runBoundedVerification}=await import('../src/verification-resources.mjs');
 let diagnostic;
 assert.throws(()=>runBoundedVerification(['--',process.execPath,'-e','process.kill(process.ppid,"SIGKILL");setInterval(()=>{},1000)'],5000),error=>{
  assert.match(error.message,/Bounded verification observer failed/);
  diagnostic=error.verificationDiagnostic;
  assert.equal(diagnostic.service.Result,'signal');
  assert.equal(diagnostic.service.ExecMainStatus,'9');
  assert.equal(diagnostic.cleanupConfirmed,true);
  assert.equal(diagnostic.authority,'diagnostic only; no successful verification or approval');
  return true;
 });
 if(diagnostic.service.ControlGroup)assert.equal(fs.existsSync(path.join('/sys/fs/cgroup',diagnostic.service.ControlGroup)),false);
 const healthy=runBoundedVerification(['--',process.execPath,'-e','console.log("healthy")'],5000);
 assert.equal(healthy.status,0);assert.equal(healthy.resourceBoundary.cleanupConfirmed,true);
 assert.notEqual(healthy.resourceBoundary.unit,diagnostic.unit);
});
