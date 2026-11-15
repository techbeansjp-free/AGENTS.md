/** Transport lifecycle of one bundled-Host child; tool confinement belongs to the selected Host.
 * Off Windows the child leads a new process group, and every exit path kills that group (#1703). Background and nohup
 * jobs started inside the Codex sandbox stay in the group, so they stop with it. A descendant that leaves the group
 * (setsid, a Node detached child) is outside this cleanup, and an empty group does not prove that no descendant remains.
 * Windows has no process groups here: only the direct child is stopped, as before. */
import {spawn} from 'node:child_process';
import {setTimeout,clearTimeout} from 'node:timers';

const GROUP_GONE_MILLISECONDS=2000,GROUP_POLL_MILLISECONDS=20,OUTPUT_DRAIN_MILLISECONDS=1000;
// Groups still owned by this process; a signal that ends the Host first kills them, so leftovers do not outlive it.
const ownedGroups=new Set();
const relayed=['SIGINT','SIGTERM','SIGHUP'];
function killOwned(){for(const pgid of ownedGroups){try{process.kill(-pgid,'SIGKILL');}catch{ /* Already empty. */ }}ownedGroups.clear();}
function relay(signal){killOwned();for(const name of relayed)process.removeListener(name,relay);process.kill(process.pid,signal);}
function own(pgid){
 if(!ownedGroups.size){process.once('exit',killOwned);for(const name of relayed)process.on(name,relay);}
 ownedGroups.add(pgid);
}
function disown(pgid){
 ownedGroups.delete(pgid);
 if(!ownedGroups.size){process.removeListener('exit',killOwned);for(const name of relayed)process.removeListener(name,relay);}
}

export function runHostProcess(binary,args,{env,input='',timeout=null},{kill=(pid,signal)=>process.kill(pid,signal),platform=process.platform,drainMilliseconds=OUTPUT_DRAIN_MILLISECONDS}={}){
 return new Promise((resolve,reject)=>{
  const script=/\.m?js$/i.test(binary),grouped=platform!=='win32';
  const p=spawn(script?process.execPath:binary,script?[binary,...args]:args,{env,windowsHide:true,stdio:['pipe','pipe','pipe'],detached:grouped});
  // A group number must name the child's own group: never 0, 1 or a negative value, which would reach other processes.
  const pgid=grouped&&Number.isSafeInteger(p.pid)&&p.pid>1?p.pid:undefined;
  if(pgid)own(pgid);
  const out=[],err=[];let size=0,done=false,accepting=true,overLimit=false,exited=false,exitCode=null,killed=false;
  const timers=new Set(),later=(ms,fn)=>{const t=setTimeout(()=>{timers.delete(t);fn();},ms);timers.add(t);return t;};
  // Sent once, synchronously, right after the child exits or fails. Members still in the group keep its number from
  // reuse; a group that held only the child is already empty, so the kill reports ESRCH (a very small reuse window).
  const killGroup=()=>{
   if(killed)return;killed=true;
   if(!pgid){p.kill();return;}
   try{kill(-pgid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')return error;}
  };
  const groupGone=()=>new Promise(settle=>{
   if(!pgid)return settle(true);
   const deadline=Date.now()+GROUP_GONE_MILLISECONDS;
   const check=()=>{
    // EPERM is seen for a moment while the killed members are reaped (measured on macOS); it never means empty.
    try{kill(-pgid,0);}catch(error){if(error.code==='ESRCH')return settle(true);if(error.code!=='EPERM')return settle(false);}
    if(Date.now()>=deadline)return settle(false);
    later(GROUP_POLL_MILLISECONDS,check);
   };
   check();
  });
  const finish=async error=>{
   if(done)return;done=true;clearTimeout(timer);
   const killError=killGroup();
   const gone=killError?false:await groupGone();
   if(pgid)disown(pgid);
   // Output from a descendant outside the group may hold the pipes open; do not wait for it indefinitely.
   // Output written before the child exited may still be in the pipes; keep collecting it until both streams end.
   const open=[p.stdout,p.stderr].filter(stream=>!stream.readableEnded&&!stream.destroyed);
   if(open.length)await new Promise(settle=>{
    let left=open.length;
    for(const stream of open){let counted=false;const one=()=>{if(counted)return;counted=true;if(--left===0)settle();};stream.once('end',one);stream.once('close',one);}
    later(drainMilliseconds,settle);
   });
   accepting=false;
   for(const t of timers)clearTimeout(t);
   p.stdin.destroy();p.stdout.destroy();p.stderr.destroy();
   const result={stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()};
   // The limit can also be passed while draining, after a successful exit; truncated output is never a success.
   if(!error&&overLimit)error=Error('Host process output limit');
   if(!gone){
    const cleanup=Object.assign(Error('Host process group cleanup unconfirmed'),{code:'ASC_HOST_CLEANUP_UNCONFIRMED',cause:killError??error,...result});
    reject(cleanup);return;
   }
   if(error){Object.assign(error,result);reject(error);}else resolve(result);
  };
  const timer=timeout===null?undefined:setTimeout(()=>finish(Object.assign(Error('Host process deadline exceeded'),{code:'ASC_HOST_TRANSPORT_TIMEOUT'})),timeout);
  for(const [stream,chunks] of [[p.stdout,out],[p.stderr,err]])stream.on('data',b=>{if(!accepting)return;size+=b.length;if(size>8*1024*1024){accepting=false;overLimit=true;finish(Error('Host process output limit'));}else chunks.push(b);});
  p.on('error',()=>finish(Error('Host executable could not start')));p.stdin.on('error',()=>finish(Error('Host input failed')));
  const settle=()=>finish(exitCode===0?undefined:Object.assign(Error('Host process failed: '+exitCode),{code:'ASC_PROVIDER_EXIT'}));
  // The direct child's exit, not the pipes closing, starts the cleanup: a leftover may keep the pipes open.
  p.on('exit',code=>{exited=true;exitCode=code;if(grouped)settle();});
  p.on('close',code=>{if(!exited)exitCode=code;settle();});
  p.stdin.end(input);
 });
}
