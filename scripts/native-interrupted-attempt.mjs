/** Linux-only synthetic fault injection; not a product execution requirement. */
import {setInterval,clearInterval} from 'node:timers';
import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import {performance} from 'node:perf_hooks';
const supervisor=fileURLToPath(new URL('../src/agent-lifecycle-supervisor.mjs',import.meta.url));
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export async function interruptSavedAttempt({directory,executable,argv,env,input,files,observeWorkers}){
 if(process.platform!=='linux'||!files.length)throw Error('Synthetic interruption requires Linux and explicit files');
 fs.mkdirSync(directory);let before=files.map(digest),observed=[];const unit=`asc-agent-${randomUUID()}.service`;
 const managerEnv={PATH:'/usr/bin:/bin',XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`};
 const control=(...args)=>spawnSync('/usr/bin/systemctl',['--user',...args],{env:managerEnv,encoding:'utf8',timeout:5000,maxBuffer:65536});
 const probe=control('show','--property=Version');if(probe.status!==0||probe.error)throw Error('Synthetic interruption service unavailable');
 const out=fs.openSync(path.join(directory,'events.jsonl'),'w'),err=fs.openSync(path.join(directory,'stderr'),'w'),started=performance.now();
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/systemd-run',['--user','--quiet','--wait','--pipe',`--unit=${unit}`,'--service-type=oneshot','--working-directory=/','--property=KillMode=control-group','--property=ExitType=main','--property=Restart=no','--property=TimeoutStartSec=infinity','--property=TimeoutStopSec=1s',process.execPath,supervisor],{env:managerEnv,stdio:['pipe',out,err]});
  let signalSent=false,cgroup='',pollError;
  child.stdin.on('error',e=>{if(!signalSent)pollError=e;});
  child.stdin.write(JSON.stringify({executable,argv,env,input})+'\n');
  const timer=setInterval(()=>{
   if(signalSent||pollError)return;
   try{
    if(observeWorkers){
     observed=observeWorkers();if(observed.length!==2)return;
     files=observed.map(r=>r.file);before=observed.map(r=>r.before);
    }else if(files.every((f,i)=>digest(f)===before[i]))return;
    const group=control('show',unit,'--property=ControlGroup','--value');cgroup=group.stdout.trim();
    if(group.status!==0||!cgroup.startsWith('/')||path.basename(cgroup)!==unit)throw Error('Interruption cgroup identity missing');
    const killed=control('kill','--kill-whom=all','--signal=SIGINT',unit);if(killed.status!==0||killed.error)throw Error('Interruption signal failed');signalSent=true;
   }catch(e){pollError=e;control('stop',unit);}
  },100);
  child.once('error',e=>{pollError=e;});
  child.once('close',(status,signal)=>{
   clearInterval(timer);child.stdin.destroy();fs.closeSync(out);fs.closeSync(err);
   const exitState=control('show',unit,'--property=ExecMainCode','--property=ExecMainStatus');
   const interrupted=exitState.status===0&&/^ExecMainCode=2$/m.test(exitState.stdout)&&/^ExecMainStatus=2$/m.test(exitState.stdout);
   const stop=control('stop',unit);control('reset-failed',unit);
   const state=control('show',unit,'--property=ActiveState','--property=SubState');
   const stopped=!stop.error&&!state.error&&state.status===0&&/^ActiveState=inactive$/m.test(state.stdout)&&/^SubState=dead$/m.test(state.stdout)&&cgroup!==''&&!fs.existsSync(path.join('/sys/fs/cgroup',cgroup));
   let after;try{after=files.map(digest);if(observeWorkers){const saved=observeWorkers({afterStop:true,workspaces:observed.map(r=>r.workspace)});if(saved.length!==2||saved.some((r,i)=>r.file!==files[i]||r.after!==after[i]))throw Error('Worker checkpoint changed or integrated before stop');}}catch(e){pollError=e;}
   const checkpoint=!pollError&&signalSent&&interrupted&&stopped&&after?.some((h,i)=>h!==before[i])&&(!observeWorkers||after.every((h,i)=>h!==before[i]));
   const result={status,signal,signalSent,interrupted,checkpoint:Boolean(checkpoint),descendantBoundary:'Linux synthetic transient service; all processes stopped before handoff',stopped,seconds:(performance.now()-started)/1000,files:files.map((f,i)=>({name:path.basename(path.dirname(f))+'/'+path.basename(f),before:before[i],after:after?.[i]??null})),usageComplete:false,...(observeWorkers?{checkpointScope:'two distinct worker worktrees before integration',workerWorktrees:observed.map(r=>path.basename(r.workspace))}:{}),...(pollError?{error:pollError.message}:{})};
   fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));
   if(!checkpoint)reject(Object.assign(Error('No verified saved-work interruption checkpoint'),{result}));else resolve(result);
  });
 });
}

export function readInterruptionEvidence(root,required){
 const file=path.join(root,'interrupted-attempt/result.json');
 if(!required&&!fs.existsSync(file))return null;
 const checkpoint=JSON.parse(fs.readFileSync(file)),usage=JSON.parse(fs.readFileSync(path.join(root,'interrupted-attempt/usage.json')));
 if(!checkpoint.checkpoint||!checkpoint.stopped||!checkpoint.interrupted||!checkpoint.signalSent||!Number.isFinite(checkpoint.seconds)||checkpoint.seconds<0||usage.complete!==false)throw Error('Interrupted writer evidence invalid');
 return {checkpoint,usage};
}
