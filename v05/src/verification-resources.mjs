/** Optional owner-selected resource boundary; one transient service per verification. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
const self=fileURLToPath(import.meta.url);
function demand(ok,message){if(!ok)throw Error(message);}
export function verificationMemoryLimit(value=1073741824){
 demand(Number.isSafeInteger(value)&&value>=67108864&&value<=4294967296&&value%1048576===0,'Invalid verification memory limit');return value;
}
function observe(unit,memoryBytes){
 const limits={'memory.max':String(verificationMemoryLimit(memoryBytes)),'memory.swap.max':'0','pids.max':'256'};
 const relative=fs.readFileSync('/proc/self/cgroup','utf8').trim().match(/^0::(\/[^\n]+)$/)?.[1];
 demand(relative&&path.basename(relative)===unit,'Verification cgroup identity mismatch');
 const dir=path.join('/sys/fs/cgroup',relative),read=name=>fs.readFileSync(path.join(dir,name),'utf8').trim();
 const actual=Object.fromEntries(Object.keys(limits).map(name=>[name,read(name)]));
 demand(Object.entries(limits).every(([name,value])=>actual[name]===value),'Verification cgroup limits changed');
 const counters={};for(const name of ['memory.events','pids.events']){
  const pairs=read(name).split('\n').map(line=>line.split(' '));
  demand(pairs.every(p=>p.length===2&&/^\d+$/.test(p[1])&&Number.isSafeInteger(Number(p[1])))&&new Set(pairs.map(p=>p[0])).size===pairs.length,'Invalid resource counters');
  counters[name]=Object.fromEntries(pairs.map(([key,value])=>[key,Number(value)]));
 }
 demand(['max','oom','oom_kill'].every(k=>Number.isSafeInteger(counters['memory.events'][k]))&&Number.isSafeInteger(counters['pids.events'].max),'Missing resource counters');
 return {observedAt:Date.now(),cgroup:relative,limits:actual,counters,processes:read('cgroup.procs').split('\n').filter(Boolean).map(Number)};
}
function worker(requestPath){
 const request=JSON.parse(fs.readFileSync(requestPath,'utf8'));
 demand(/^asc-verify-[a-f0-9-]+\.service$/.test(request.unit)&&Array.isArray(request.argv)&&request.argv.every(v=>typeof v==='string'),'Invalid resource request');
 demand(Number.isSafeInteger(request.timeout)&&request.timeout>0&&request.timeout<=300000,'Invalid verification timeout');
 const before=observe(request.unit,request.memoryBytes);
 demand(before.processes.length===1&&before.processes[0]===process.pid,'Verification cgroup is not exclusive');
 const p=spawnSync('/usr/bin/prlimit',request.argv,{env:{PATH:'/usr/bin:/bin'},timeout:request.timeout,maxBuffer:1048576,killSignal:'SIGKILL'});
 const timedOut=p.error?.code==='ETIMEDOUT';
 demand((!p.error&&Number.isInteger(p.status))||timedOut,`Verification execution failed: ${p.error?.code??'invalid-exit-status'}`);
 // Killing the namespace leader and reaping its descendants are not atomic.
 // Wait only for teardown after timeout, within the existing 5s service grace.
 let after=observe(request.unit,request.memoryBytes);
 if(timedOut){
  const deadline=performance.now()+1000,pause=new Int32Array(new SharedArrayBuffer(4));
  while(after.processes.some(pid=>pid!==process.pid)&&performance.now()<deadline){
   Atomics.wait(pause,0,0,20);after=observe(request.unit,request.memoryBytes);
  }
 }
 demand(after.cgroup===before.cgroup&&after.processes.length===1&&after.processes[0]===process.pid,'Verification descendants remain or identity changed');
 const delta={};for(const name of Object.keys(before.counters)){
  delta[name]={};for(const [key,value] of Object.entries(before.counters[name])){
   const current=after.counters[name][key];demand(Number.isSafeInteger(current)&&current>=value,'Resource counter missing or reset');delta[name][key]=current-value;
  }
 }
 const exhausted=['max','oom','oom_kill'].some(k=>delta['memory.events'][k]>0)||delta['pids.events'].max>0;
 process.stdout.write(JSON.stringify({status:exhausted||timedOut?125:p.status,stdout:p.stdout.toString('base64'),stderr:p.stderr.toString('base64'),resourceBoundary:{unit:request.unit,before,after,delta,exhausted,processExit:p.status,executionError:timedOut?'ETIMEDOUT':null}}));
}
export function runBoundedVerification(argv,timeout=25000,memoryBytes=1073741824){
 verificationMemoryLimit(memoryBytes);
 demand(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=300000,'Invalid verification timeout');
 demand(process.platform==='linux'&&typeof process.getuid==='function','Bounded verification requires Linux systemd user services');
 const unit=`asc-verify-${randomUUID()}.service`,temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-verify-resource-')),request=path.join(temp,'request.json');
 const env={PATH:'/usr/bin:/bin',XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`};
 const ctl=args=>spawnSync('/usr/bin/systemctl',['--user',...args],{env,encoding:'utf8',timeout:5000,maxBuffer:65536});
 let result,cleanup;
 try{
  fs.writeFileSync(request,JSON.stringify({unit,argv,timeout,memoryBytes}),{flag:'wx',mode:0o600});
  const p=spawnSync('/usr/bin/systemd-run',['--user','--wait','--pipe',`--unit=${unit}`,'--working-directory=/',`--property=MemoryMax=${memoryBytes}`,'--property=MemorySwapMax=0','--property=TasksMax=256',`--property=RuntimeMaxSec=${Math.ceil(timeout/1000)+5}`,'--property=KillMode=control-group','--property=OOMPolicy=continue',process.execPath,self,'--resource-worker',request],{env,encoding:'utf8',timeout:timeout+10000,maxBuffer:3145728,killSignal:'SIGKILL'});
  if(p.error||p.status!==0){
   const failure=Error(`Bounded verification observer failed (status=${p.status}, error=${p.error?.code??'none'}). Untrusted observer stderr: ${String(p.stderr??'').slice(-2048)}`);
   failure.verificationDiagnostic={unit,status:p.status,error:p.error?.code??null,stderr:String(p.stderr??'').slice(-2048),truncated:String(p.stderr??'').length>2048,authority:'diagnostic only; no successful verification or approval'};
   throw failure;
  }
  result=JSON.parse(p.stdout);
  demand(Number.isInteger(result.status)&&result.resourceBoundary?.unit===unit&&typeof result.stdout==='string'&&typeof result.stderr==='string','Invalid bounded verification result');
 }finally{
  // Only the uniquely named invocation unit is stopped, including timeout/error paths.
  ctl(['stop',unit]);
  ctl(['reset-failed',unit]);
  const state=ctl(['show',unit,'--property=ActiveState','--property=SubState']);
  cleanup=!state.error&&state.status===0&&/^ActiveState=inactive$/m.test(state.stdout)&&/^SubState=dead$/m.test(state.stdout);
  fs.rmSync(temp,{recursive:true,force:true});
  demand(cleanup,'Bounded verification cleanup unconfirmed');
 }
 demand(!fs.existsSync(path.join('/sys/fs/cgroup',result.resourceBoundary.after.cgroup)),'Verification cgroup remains');
 return {status:result.status,stdout:Buffer.from(result.stdout,'base64'),stderr:Buffer.from(result.stderr,'base64'),resourceBoundary:{...result.resourceBoundary,cleanupConfirmed:cleanup}};
}
if(process.argv[1]===self&&process.argv[2]==='--resource-worker')worker(process.argv[3]);
