import {setTimeout,clearTimeout,setInterval,clearInterval} from 'node:timers';
import {performance} from 'node:perf_hooks';
/** Optional owner-selected resource boundary; one transient service per verification. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
const self=fileURLToPath(import.meta.url);
function demand(ok,message,details){if(!ok)throw Object.assign(Error(message),details);}
export function verificationMemoryLimit(value=1073741824){
 demand(Number.isSafeInteger(value)&&value>=67108864&&value<=4294967296&&value%1048576===0,'Invalid verification memory limit');return value;
}
// The observer and the verification tree are sibling cgroups inside the unit.
// Owner limits apply only to the tree, so a memory-cgroup OOM can never select
// the observer (the kernel scans only the OOMing memcg subtree).
function limitsFor(memoryBytes){return {'memory.max':String(verificationMemoryLimit(memoryBytes)),'memory.swap.max':'0','pids.max':'256'};}
function partition(unit,memoryBytes){
 // systemd starts the worker directly in <unit>/observer (DelegateSubgroup), so
 // no process is ever migrated and the unit itself holds no process when the
 // controllers are enabled for the tree.
 const observer=fs.readFileSync('/proc/self/cgroup','utf8').trim().match(/^0::(\/[^\n]+)$/)?.[1];
 demand(observer&&path.basename(observer)==='observer'&&path.basename(path.dirname(observer))===unit,'Verification cgroup identity mismatch');
 const relative=path.dirname(observer),root=path.join('/sys/fs/cgroup',relative),procs=dir=>fs.readFileSync(path.join(dir,'cgroup.procs'),'utf8').split('\n').filter(Boolean).map(Number).join();
 demand(procs(root)===''&&procs(path.join(root,'observer'))===String(process.pid),'Verification cgroup is not exclusive');
 // mkdir fails on an existing directory, so a pre-made subtree is never adopted.
 fs.mkdirSync(path.join(root,'tree'));
 fs.writeFileSync(path.join(root,'cgroup.subtree_control'),'+memory +pids');
 for(const [name,value] of Object.entries(limitsFor(memoryBytes)))fs.writeFileSync(path.join(root,'tree',name),value);
 return {unit:relative,observer,tree:path.join(relative,'tree')};
}
function observe(cgroups,memoryBytes){
 const limits=limitsFor(memoryBytes);
 demand(fs.readFileSync('/proc/self/cgroup','utf8').trim()===`0::${cgroups.observer}`,'Verification observer left its cgroup');
 const dir=path.join('/sys/fs/cgroup',cgroups.tree),read=name=>fs.readFileSync(path.join(dir,name),'utf8').trim();
 const actual=Object.fromEntries(Object.keys(limits).map(name=>[name,read(name)]));
 demand(Object.entries(limits).every(([name,value])=>actual[name]===value),'Verification cgroup limits changed');
 const counters={};for(const name of ['memory.events','pids.events']){
  const pairs=read(name).split('\n').map(line=>line.split(' '));
  demand(pairs.every(p=>p.length===2&&/^\d+$/.test(p[1])&&Number.isSafeInteger(Number(p[1])))&&new Set(pairs.map(p=>p[0])).size===pairs.length,'Invalid resource counters');
  counters[name]=Object.fromEntries(pairs.map(([key,value])=>[key,Number(value)]));
 }
 demand(['max','oom','oom_kill'].every(k=>Number.isSafeInteger(counters['memory.events'][k]))&&Number.isSafeInteger(counters['pids.events'].max),'Missing resource counters');
 const observerProcesses=fs.readFileSync(path.join('/sys/fs/cgroup',cgroups.observer,'cgroup.procs'),'utf8').split('\n').filter(Boolean).map(Number);
 return {observedAt:Date.now(),cgroup:cgroups.tree,limits:actual,counters,processes:read('cgroup.procs').split('\n').filter(Boolean).map(Number),observerProcesses};
}
function ownerIdentity(pid){try{const fields=fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').at(-1).split(' ');return fields[0]==='Z'?null:fields[19];}catch{return null;}}
async function verificationProcess(argv,timeout,owner,tree){
 demand(Number.isSafeInteger(owner?.pid)&&owner.pid>0&&typeof owner.start==='string','Invalid verification owner');
 // The service is killed as a group when its main worker exits. Checking the
 // process generation prevents PID reuse from keeping an orphan alive.
 const alive=()=>{if(ownerIdentity(owner.pid)!==owner.start)process.exit(125);};alive();
 const watch=setInterval(alive,100);
 try{return await new Promise((resolve,reject)=>{
  // The launcher waits on fd 3 until the observer has moved it into the
  // limited tree, so no verification code ever runs outside the owner limits.
  const child=spawn('/bin/sh',['-c','IFS= read -r _ <&3 || exit 125; exec 3<&-; exec /usr/bin/prlimit "$@"','asc-verify',...argv],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe','pipe']});
  const stdout=[],stderr=[];let error,settled=false,drain;
  try{
   demand(Number.isSafeInteger(child.pid),'Verification launcher did not start');
   fs.writeFileSync(path.join('/sys/fs/cgroup',tree,'cgroup.procs'),String(child.pid));
   demand(fs.readFileSync(`/proc/${child.pid}/cgroup`,'utf8').trim()===`0::${tree}`,'Verification process is outside its cgroup');
   // Report a failed start signal as a placement failure, not an observer crash.
   child.stdio[3].on('error',e=>{error??=Object.assign(Error('Verification launcher signal failed'),{code:'EPLACEMENT',cause:e});child.kill('SIGKILL');});
   child.stdio[3].end('go\n');
  }catch(e){child.kill('SIGKILL');throw Object.assign(Error(`Verification execution failed: cgroup placement (${e.code??e.message})`),{cause:e});}
  // A later timeout or stream event must not replace the original failure.
  const timer=timeout===null?undefined:setTimeout(()=>{error??=Object.assign(Error('Verification timeout'),{code:'ETIMEDOUT'});child.kill('SIGKILL');},timeout);
  for(const [stream,chunks] of [[child.stdout,stdout],[child.stderr,stderr]]){let size=0;stream.on('data',b=>{size+=b.length;if(size>1048576){error??=Object.assign(Error('Verification output limit'),{code:'ENOBUFS'});child.kill('SIGKILL');}else chunks.push(b);});}
  const finish=(status,signal)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(drain);child.stdout.destroy();child.stderr.destroy();child.stdio[3]?.destroy();resolve({status,signal:signal??null,error,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)});};
  child.once('error',e=>{clearTimeout(timer);clearTimeout(drain);reject(e);});
  child.once('exit',(status,signal)=>{drain=setTimeout(()=>{error??=Object.assign(Error('Verification output did not close'),{code:'EINCOMPLETE'});finish(status,signal);},1000);});
  child.once('close',finish);
 });}finally{clearInterval(watch);}
}
async function worker(requestPath){
 const request=JSON.parse(fs.readFileSync(requestPath,'utf8'));
 demand(/^asc-verify-[a-f0-9-]+\.service$/.test(request.unit)&&Array.isArray(request.argv)&&request.argv.every(v=>typeof v==='string'),'Invalid resource request');
 demand(request.timeout===null||(Number.isSafeInteger(request.timeout)&&request.timeout>0&&request.timeout<=2147483647),'Invalid verification timeout');
 const cgroups=partition(request.unit,request.memoryBytes);
 const before=observe(cgroups,request.memoryBytes);
 demand(before.processes.length===0&&before.observerProcesses.join()===String(process.pid),'Verification cgroup is not exclusive');
 const p=await verificationProcess(request.argv,request.timeout,request.owner,cgroups.tree);
 const timedOut=p.error?.code==='ETIMEDOUT',outputLimited=p.error?.code==='ENOBUFS',signaled=!p.error&&p.status===null&&typeof p.signal==='string';
 demand((!p.error&&Number.isInteger(p.status))||timedOut||outputLimited||signaled,`Verification execution failed: ${p.error?.code??'invalid-exit-status'}`);
 // Killing the namespace leader and reaping its descendants are not atomic.
 // Normal exit also races namespace teardown. Confirm actual emptiness within
 // the existing service grace; a surviving descendant still rejects the result.
 const busy=o=>o.processes.length>0||o.observerProcesses.join()!==String(process.pid);
 let after=observe(cgroups,request.memoryBytes);
 if(busy(after)){
  const deadline=performance.now()+1000,pause=new Int32Array(new SharedArrayBuffer(4));
  while(busy(after)&&performance.now()<deadline){
   Atomics.wait(pause,0,0,20);after=observe(cgroups,request.memoryBytes);
  }
 }
 demand(after.cgroup===before.cgroup&&!busy(after),'Verification descendants remain or identity changed');
 const delta={};for(const name of Object.keys(before.counters)){
  delta[name]={};for(const [key,value] of Object.entries(before.counters[name])){
   const current=after.counters[name][key];demand(Number.isSafeInteger(current)&&current>=value,'Resource counter missing or reset');delta[name][key]=current-value;
  }
 }
 const exhausted=['max','oom','oom_kill'].some(k=>delta['memory.events'][k]>0)||delta['pids.events'].max>0;
 // The tree's OOM killer may select the top verification process itself.
 // That is the same rejected exhaustion; any other signal stays an execution failure.
 demand(!signaled||exhausted,`Verification execution failed: signal ${p.signal}`);
 process.stdout.write(JSON.stringify({status:exhausted||timedOut||outputLimited?125:p.status,stdout:p.stdout.toString('base64'),stderr:p.stderr.toString('base64'),resourceBoundary:{unit:request.unit,unitCgroup:cgroups.unit,observerCgroup:cgroups.observer,before,after,delta,exhausted,processExit:p.status,processSignal:p.signal,executionError:p.error?.code??null}}));
}
export function runBoundedVerification(argv,timeout=null,memoryBytes=1073741824){
 verificationMemoryLimit(memoryBytes);
 demand(timeout===null||(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=2147483647),'Invalid verification timeout');
 demand(process.platform==='linux'&&typeof process.getuid==='function','Bounded verification requires Linux systemd user services');
 const unit=`asc-verify-${randomUUID()}.service`,temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-verify-resource-')),request=path.join(temp,'request.json');
 const env={PATH:'/usr/bin:/bin',XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`};
 const ctl=args=>spawnSync('/usr/bin/systemctl',['--user',...args],{env,encoding:'utf8',timeout:5000,maxBuffer:65536});
 let result,cleanup,failure;
 try{
  fs.writeFileSync(request,JSON.stringify({unit,argv,timeout,memoryBytes,owner:{pid:process.pid,start:ownerIdentity(process.pid)}}),{flag:'wx',mode:0o600});
  const p=spawnSync('/usr/bin/systemd-run',['--user','--wait','--pipe',`--unit=${unit}`,'--working-directory=/','--property=Delegate=memory pids','--property=DelegateSubgroup=observer',`--property=MemoryMax=${memoryBytes+268435456}`,'--property=MemorySwapMax=0','--property=TasksMax=512',...(timeout===null?[]:[`--property=RuntimeMaxSec=${Math.ceil(timeout/1000)+5}`]),'--property=KillMode=control-group','--property=OOMPolicy=continue',process.execPath,self,'--resource-worker',request],{env,encoding:'utf8',timeout:timeout===null?0:timeout+10000,maxBuffer:3145728,killSignal:'SIGKILL'});
  if(p.error||p.status!==0){
   failure=Error(`Bounded verification observer failed (status=${p.status}, error=${p.error?.code??'none'}). Untrusted observer stderr: ${String(p.stderr??'').slice(-2048)}`);
   const state=ctl(['show',unit,'--property=Result','--property=ExecMainCode','--property=ExecMainStatus','--property=ControlGroup']);
   const service=state.error||state.status!==0?null:Object.fromEntries(state.stdout.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
   const counters={};
   if(service?.ControlGroup?.startsWith('/')&&path.basename(service.ControlGroup)===unit){
    for(const name of ['memory.events','pids.events'])try{counters[name]=fs.readFileSync(path.join('/sys/fs/cgroup',service.ControlGroup,name),'utf8').slice(0,4096);}catch{counters[name]=null;}
   }
   failure.verificationDiagnostic={service,counters,unit,status:p.status,error:p.error?.code??null,stderr:String(p.stderr??'').slice(-2048),truncated:String(p.stderr??'').length>2048,authority:'diagnostic only; no successful verification or approval'};
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
  if(failure)failure.verificationDiagnostic.cleanupConfirmed=cleanup;
  demand(cleanup,'Bounded verification cleanup unconfirmed',failure?{cause:failure,verificationDiagnostic:failure.verificationDiagnostic}:undefined);
 }
 demand(typeof result.resourceBoundary.unitCgroup==='string'&&path.basename(result.resourceBoundary.unitCgroup)===unit&&result.resourceBoundary.after.cgroup===path.join(result.resourceBoundary.unitCgroup,'tree'),'Invalid bounded verification result');
 // The whole delegated subtree (unit, observer and tree) must be gone.
 demand(!fs.existsSync(path.join('/sys/fs/cgroup',result.resourceBoundary.unitCgroup)),'Verification cgroup remains');
 if(result.resourceBoundary.executionError==='ENOBUFS')throw Object.assign(Error('Verification output exceeded 1 MiB'),{code:'ASC_VERIFICATION_OUTPUT_LIMIT',verificationDiagnostic:{...result.resourceBoundary,cleanupConfirmed:cleanup,authority:'diagnostic only; no successful verification or approval'}});
 return {status:result.status,stdout:Buffer.from(result.stdout,'base64'),stderr:Buffer.from(result.stderr,'base64'),resourceBoundary:{...result.resourceBoundary,cleanupConfirmed:cleanup}};
}
if(process.argv[1]===self&&process.argv[2]==='--resource-worker')await worker(process.argv[3]);
