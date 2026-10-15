import {performance} from 'node:perf_hooks';
import {clearTimeout,setTimeout} from 'node:timers';
import {assertExecutionHost} from './execution-host.mjs';
/** Experimental Linux host adapter. No permission fallback; no Python runtime. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {codexRuntimeRoots} from './codex-runtime.mjs';
import {networkPreflight} from './agent-network-preflight.mjs';
import {StringDecoder} from 'node:string_decoder';
import {spawn,spawnSync} from 'node:child_process';
function demand(ok,message){if(!ok)throw Error(message);}
// Lifecycle only: the provider retains its existing host access. Tool isolation remains
// the separate Codex profile. PID namespace teardown also kills detached descendants.
function lifecycleArgv(executable,argv){
  demand(process.platform==='linux','Agent lifecycle requires Linux');
  return ['--die-with-parent','--unshare-pid','--bind','/','/','--proc','/proc','--dev','/dev','--',executable,...argv];
}
const contains=(parent,child)=>{const r=path.relative(parent,child);return !r || (!r.startsWith('..'+path.sep) && r!=='..' && !path.isAbsolute(r));};
export function configuration({workspace,runtime,executable,writable}) {
  const root=fs.realpathSync(workspace),temp=fs.realpathSync(runtime),binary=fs.realpathSync(executable);
  const node=fs.realpathSync(process.execPath),providerRoots=codexRuntimeRoots(binary);
  demand(!contains(root,temp) && !contains(temp,root),'Runtime and source must be disjoint');
  demand(!contains(root,binary) && !contains(root,node),'Untrusted executable');
  demand(providerRoots.every(p=>!contains(root,p)&&!contains(p,root)&&!contains(temp,p)&&!contains(p,temp)),'Provider runtime overlaps source or tool state');
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name),s=fs.lstatSync(file);
    demand(!s.isSymbolicLink() && (s.isDirectory() || s.isFile() && s.nlink===1),'Aliased or special snapshot');
    if(s.isDirectory()) walk(file);
  }};
  for(const name of ['.git','.codex','.agents']) demand(!fs.existsSync(path.join(root,name)),'Control directory in snapshot');
  walk(root);
  const profile='asc_minimal_agent';
  const filesystem={':root':'deny',':minimal':'read',...Object.fromEntries(providerRoots.map(p=>[p,'read'])),[root]:writable?'write':'read',[temp]:'write'};
  const table=object=>'{ '+Object.entries(object).map(([k,v])=>JSON.stringify(k)+'='+JSON.stringify(v)).join(', ')+' }';
  const values=[`default_permissions="${profile}"`,`permissions.${profile}.filesystem=${table(filesystem)}`,
    `permissions.${profile}.network.enabled=false`,'approval_policy="never"','shell_environment_policy.inherit="none"',
    `shell_environment_policy.set=${table({PATH:'/usr/bin:/bin',HOME:temp,TMPDIR:temp,LANG:'C.UTF-8'})}`,
    'features.multi_agent=false','features.multi_agent_v2=false','features.enable_mcp_apps=false',
    'features.shell_snapshot=false','web_search="disabled"'];
  const env={TMPDIR:temp,LANG:'C.UTF-8'};
  for(const name of ['PATH','HOME','CODEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN']) if(process.env[name])env[name]=process.env[name];
  return {root,node,binary,profile,options:values.flatMap(v=>['-c',v]),env};
}
export function assertPreflight(result,hostValue) {
  demand(result.status===0 && !result.error,'Isolation diagnostic failed');
  const data=JSON.parse(result.stdout);
  demand(data.completed===true && data.read==='denied' && ['denied','private-write-completed'].includes(data.write) && hostValue==='trusted','Isolation not established');
}
export async function runAgent({workspace,logs,executable,model,prompt,writable=true,schema,timeout=360000}) {
  assertExecutionHost();
  demand(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=360000,'Invalid Agent deadline');
  const deadline=performance.now()+timeout;
  demand(typeof model==='string' && model.length && typeof prompt==='string','Explicit model and prompt required');
  const logRoot=fs.realpathSync(logs),root=fs.realpathSync(workspace);
  demand(!contains(root,logRoot),'Logs must be outside source');
  const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'asc-v05-tool-'));
  try {
    const c=configuration({workspace,runtime,executable,writable});
    const sandbox=['sandbox','-P',c.profile,...c.options,'-C',root,'--'];
    const healthy=spawnSync('/usr/bin/bwrap',lifecycleArgv(c.binary,[...sandbox,'/bin/true']),{env:c.env,timeout:20000,maxBuffer:1048576});
    demand(!healthy.error && healthy.status===0,'Isolation positive control failed');
    const sentinel=path.join(logRoot,'controller-sentinel');fs.writeFileSync(sentinel,'trusted',{flag:'wx'});
    // Fixed POSIX diagnostic: both cat and shell first pass positive controls.
    // No candidate script, Python dependency or permission relaxation.
    const cat=spawnSync('/usr/bin/bwrap',lifecycleArgv(c.binary,[...sandbox,'/bin/cat','/dev/null']),{env:c.env,timeout:20000,maxBuffer:1048576});
    demand(!cat.error && cat.status===0,'Read diagnostic positive control failed');
    const code=`if /bin/cat "$1" >/dev/null 2>&1; then r=accessible; else r=denied; fi
if (printf changed >"$1") 2>/dev/null; then w=private-write-completed; else w=denied; fi
printf '{"completed":true,"read":"%s","write":"%s"}\\n' "$r" "$w"`;
    const probe=spawnSync('/usr/bin/bwrap',lifecycleArgv(c.binary,[...sandbox,'/bin/sh','-c',code,'asc-preflight',sentinel]),{env:c.env,timeout:20000,maxBuffer:1048576,encoding:'utf8'});
    const hostValue=fs.readFileSync(sentinel,'utf8');
    fs.writeFileSync(path.join(logRoot,'preflight.json'),JSON.stringify({status:probe.status,stdout:probe.stdout,stderr:probe.stderr,hostUnchanged:hostValue==='trusted'},null,2));
    assertPreflight(probe,hostValue);
    const network=await networkPreflight({executable:c.binary,sandbox,env:c.env,run:runBoundedProcess});
    fs.writeFileSync(path.join(logRoot,'network-preflight.json'),JSON.stringify(network,null,2));
    const answerPath=path.join(logRoot,'answer.txt');
    const argv=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--json',
      '-m',model,'-c','model_reasoning_effort="high"','-C',root,...c.options,'-o',answerPath];
    if(schema){const file=path.join(logRoot,'schema.json');fs.writeFileSync(file,JSON.stringify(schema));argv.push('--output-schema',file);}
    argv.push('-');
    const started=performance.now();let output='',errors='';
    try {
      const result=await runBoundedProcess(c.binary,argv,{env:c.env,input:prompt,timeout:remainingDeadline(deadline)});
      output=result.stdout;errors=result.stderr;
    } catch(error) {output=error.stdout??'';errors=error.stderr??'';throw error;}
    finally {
      fs.writeFileSync(path.join(logRoot,'agent.jsonl'),output);
      fs.writeFileSync(path.join(logRoot,'agent.stderr'),errors);
    }
    const records=output.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
    const contexts=records.filter(x=>x.type==='thread.started').map(x=>x.thread_id);
    demand(contexts.length===1 && typeof contexts[0]==='string' && contexts[0],'Fresh context not observed');
    demand(fs.readFileSync(sentinel,'utf8')==='trusted','Host sentinel changed during Agent run');
    const answer=fs.readFileSync(answerPath,'utf8');
    return {context:contexts[0],answer,seconds:(performance.now()-started)/1000,
      usage:records.filter(x=>x.type==='turn.completed').map(x=>x.usage??null)};
  }finally{fs.rmSync(runtime,{recursive:true,force:true});}
}

function remainingDeadline(deadline){const remaining=Math.ceil(deadline-performance.now());demand(remaining>0,'Agent deadline exceeded during preflight');return remaining;}

/** Deadline bounds the host wait even if a detached descendant holds a pipe. */
export function runBoundedProcess(executable,argv,{env,input,timeout}) {
  demand(Number.isSafeInteger(timeout) && timeout>0 && timeout<=360000,'Invalid Agent deadline');
  return new Promise((resolve,reject)=>{
    const p=spawn('/usr/bin/bwrap',lifecycleArgv(executable,argv),{env,stdio:[input===''?'ignore':'pipe','pipe','pipe'],detached:true});
    let stdout='',stderr='',outBytes=0,errBytes=0,settled=false;
    const outDecoder=new StringDecoder('utf8'),errDecoder=new StringDecoder('utf8');
    const finish=error=>{
      if(settled)return;settled=true;clearTimeout(timer);
      stdout+=outDecoder.end();stderr+=errDecoder.end();
      if(error){
        try{process.kill(-p.pid,'SIGKILL');}catch{p.kill('SIGKILL');}
        p.stdin?.destroy();p.stdout.destroy();p.stderr.destroy();
        reject(Object.assign(error,{stdout,stderr}));
      }else resolve({stdout,stderr});
    };
    const timer=setTimeout(()=>finish(Error('Agent deadline exceeded')),timeout);
    p.stdout.on('data',b=>{if(settled)return;outBytes+=b.length;
      if(outBytes>8*1024*1024){finish(Error('Agent output limit exceeded'));return;}stdout+=outDecoder.write(b);});
    p.stderr.on('data',b=>{if(settled)return;errBytes+=b.length;
      if(errBytes>1048576){finish(Error('Agent error output limit exceeded'));return;}stderr+=errDecoder.write(b);});
    p.stdin?.on('error',e=>finish(e));p.on('error',e=>finish(e));
    p.on('close',status=>finish(status===0?undefined:Error('Fresh Agent failed')));
    p.stdin?.end(input);
  });
}
