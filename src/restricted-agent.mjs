import {performance} from 'node:perf_hooks';
import {providerFailure} from './provider-failure.mjs';
import {assertExecutionHost} from './execution-host.mjs';
/** Codex sandbox adapter; lifecycle supplied by the trusted execution backend. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {codexRuntimeRoots,sandboxFilesystemBase,sharedTemporaryRoots,POSIX_SHARED_TEMPORARIES} from './codex-runtime.mjs';
import {networkPreflight} from './agent-network-preflight.mjs';
import {runServiceProcess} from './agent-lifecycle.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
const contains=(parent,child)=>{const r=path.relative(parent,child);return !r || (!r.startsWith('..'+path.sep) && r!=='..' && !path.isAbsolute(r));};
export function configuration({workspace,runtime,executable,writable,purpose='agent',readOnlyRoots=[]}) {
  demand(['agent','verification'].includes(purpose),'Invalid sandbox purpose');
  const root=fs.realpathSync(workspace),temp=fs.realpathSync(runtime),binary=fs.realpathSync(executable);
  const node=fs.realpathSync(process.execPath),providerRoots=codexRuntimeRoots(binary);
  demand(!contains(root,temp) && !contains(temp,root),'Runtime and source must be disjoint');
  demand(!contains(root,binary) && !contains(root,node),'Untrusted executable');
  demand(providerRoots.every(p=>!contains(root,p)&&!contains(p,root)&&!contains(temp,p)&&!contains(p,temp)),'Provider runtime overlaps source or tool state');
  demand(Array.isArray(readOnlyRoots)&&(purpose==='verification'||readOnlyRoots.length===0),'Invalid read-only assets');
  for(const dir of readOnlyRoots)demand(path.isAbsolute(dir)&&fs.realpathSync(dir)===dir&&(contains(root,dir)||contains(temp,dir))&&dir!==root&&dir!==temp,'Invalid asset root');
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name),s=fs.lstatSync(file);
    if(s.isSymbolicLink()&&readOnlyRoots.some(r=>contains(r,file)&&contains(r,fs.realpathSync(file))))continue;
    demand(!s.isSymbolicLink() && (s.isDirectory() || s.isFile() && s.nlink===1),'Aliased or special snapshot');
    if(s.isDirectory()) walk(file);
  }};
  for(const name of (purpose==='verification'?['.git']:['.git','.codex','.agents'])) demand(!fs.existsSync(path.join(root,name)),'Control directory in snapshot');
  walk(root);
  const profile='asc_minimal_agent';
  const filesystem={...sandboxFilesystemBase({providerRoots,node}),[root]:writable?'write':'read',[temp]:'write',...Object.fromEntries(readOnlyRoots.map(r=>[r,'read']))};
  const table=object=>'{ '+Object.entries(object).map(([k,v])=>JSON.stringify(k)+'='+JSON.stringify(v)).join(', ')+' }';
  const toolEnv={PATH:[path.dirname(node),...(process.platform==='win32'?[path.join(process.env.SystemRoot??'C:\\Windows','System32')]:['/usr/bin','/bin'])].join(path.delimiter),HOME:temp,USERPROFILE:temp,TMPDIR:temp,TEMP:temp,TMP:temp,LANG:'C.UTF-8'};
  if(process.platform==='win32')for(const key of ['SystemRoot','WINDIR'])if(process.env[key])toolEnv[key]=process.env[key];
  const values=[`default_permissions="${profile}"`,`permissions.${profile}.filesystem=${table(filesystem)}`,
    `permissions.${profile}.network.enabled=false`,'approval_policy="never"','shell_environment_policy.inherit="none"',
    `shell_environment_policy.set=${table(toolEnv)}`,
    'features.multi_agent=false','features.multi_agent_v2=false','features.enable_mcp_apps=false',
    'features.shell_snapshot=false','web_search="disabled"'];
  const env={...toolEnv};
  for(const name of ['PATH','HOME','CODEX_HOME','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN']) if(process.env[name])env[name]=process.env[name];
  return {root,launchDirectory:purpose==='verification'?temp:root,node,binary,profile,options:values.flatMap(v=>['-c',v]),env};
}
/** Every sentinel must be unreadable, and any completed write must have stayed private to the sandbox. `targets` names
 * the sentinel paths in the same order; it only makes the failure say where the sandbox reached. */
export function assertPreflight(result,hostValues,targets=[]) {
  demand(result.status===0 && !result.error,'Isolation diagnostic failed');
  const data=JSON.parse(result.stdout);
  demand(data.completed===true && Array.isArray(data.targets) && Array.isArray(hostValues) && hostValues.length>0 && data.targets.length===hostValues.length,'Isolation not established');
  const reached=data.targets.flatMap((t,i)=>t?.read==='denied' && ['denied','private-write-completed'].includes(t.write) && hostValues[i]==='trusted'?[]:[targets[i]??`target ${i}`]);
  if(!reached.length)return;
  const shared=sharedTemporaryRoots();
  const hint=reached.some(p=>shared.some(root=>p.startsWith(root+'/')))?'; on macOS, Codex before 0.156.0 ignores the shared-temporary denial: check the Codex version, and report it if it is already 0.156.0 or later':'';
  throw Error(`Isolation not established (sandbox reached ${reached.join(', ')}${hint})`);
}
/** Directories that receive a sentinel, canonical and without duplicates: the Controller temporary directory (stdin files,
 * candidate index, Git output) and, outside Windows, the shared /tmp and /var/tmp, where those files live when TMPDIR is
 * absent or points there (#1695). Only an equal path is a duplicate: a TMPDIR below /tmp does not prove /tmp itself
 * is denied (#1701). A missing shared directory is skipped. */
export function sentinelBases({tmpdir=os.tmpdir(),platform=process.platform,realpath=fs.realpathSync}={}) {
  const bases=[realpath(tmpdir)];
  if(platform!=='win32')for(const shared of POSIX_SHARED_TEMPORARIES){
    let canonical;try{canonical=realpath(shared);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!bases.includes(canonical))bases.push(canonical);
  }
  return bases;
}
/** Controller-owned locations an Agent must not reach: logs and every sentinelBases() directory. A sentinel that
 * cannot be placed or a location that cannot be resolved also stops the run, naming the location. */
export function createSentinels(logRoot,locate=sentinelBases) {
  const files=[path.join(logRoot,'controller-sentinel')],dirs=[];
  const unplaced=(where,error)=>Error(`Isolation not established (cannot place a sentinel in ${where}: ${error.code??error.message})`,{cause:error});
  try{
    fs.writeFileSync(files[0],'trusted',{flag:'wx'});
    let bases;try{bases=locate();}catch(error){throw unplaced(error.path??'the temporary directories',error);}
    for(const base of bases){
      try{
        const dir=fs.mkdtempSync(path.join(base,'asc-v05-sentinel-'));dirs.push(dir);
        const file=path.join(dir,'controller-sentinel');fs.writeFileSync(file,'trusted',{flag:'wx',mode:0o600});files.push(file);
      }catch(error){throw unplaced(base,error);}
    }
  }catch(error){removeSentinels(dirs);throw error;}
  return {files,dirs};
}
function removeSentinels(dirs){for(const dir of dirs)fs.rmSync(dir,{recursive:true,force:true});}
export async function runAgent({workspace,logs,executable,model,prompt,writable=true,schema,timeout=null},processRunner=runBoundedProcess) {
  assertExecutionHost();
  demand(timeout===null||(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=2147483647),'Invalid Agent deadline');
  const deadline=timeout===null?Infinity:performance.now()+timeout;
  demand(typeof model==='string' && model.length && typeof prompt==='string','Explicit model and prompt required');
  const logRoot=fs.realpathSync(logs),root=fs.realpathSync(workspace);
  demand(!contains(root,logRoot),'Logs must be outside source');
  const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'asc-v05-tool-'));let sentinels={dirs:[]};
  try {
    const c=configuration({workspace,runtime,executable,writable});
    const sandbox=['sandbox','-P',c.profile,...c.options,'-C',root,'--'];
    const preflightRun=(binary,args,options)=>processRunner(binary,args,{...options,timeout:Math.min(options.timeout,remainingDeadline(deadline)??Infinity)});
    await preflightRun(c.binary,[...sandbox,c.node,'-e','process.exit(0)'],{env:c.env,input:'',timeout:20000});
    sentinels=createSentinels(logRoot);
    const code=`const fs=require('node:fs');const targets=[];
for(const file of process.argv.slice(1)){let read='denied',write='denied';
try{fs.readFileSync(file);read='accessible';}catch(e){if(!['EACCES','EPERM','ENOENT'].includes(e.code))throw e;}
try{fs.writeFileSync(file,'changed');write='private-write-completed';}catch(e){if(!['EACCES','EPERM','ENOENT'].includes(e.code))throw e;}
targets.push({read,write});}
fs.writeSync(1,JSON.stringify({completed:true,targets}));`;
    const probe={status:0,...await preflightRun(c.binary,[...sandbox,c.node,'-e',code,...sentinels.files],{env:c.env,input:'',timeout:20000})};
    const hostValues=sentinels.files.map(file=>fs.readFileSync(file,'utf8'));
    fs.writeFileSync(path.join(logRoot,'preflight.json'),JSON.stringify({status:probe.status,stdout:probe.stdout,stderr:probe.stderr,targets:sentinels.files,hostUnchanged:hostValues.map(v=>v==='trusted')},null,2));
    assertPreflight(probe,hostValues,sentinels.files);
    const network=await networkPreflight({executable:c.binary,sandbox,env:c.env,run:preflightRun});
    fs.writeFileSync(path.join(logRoot,'network-preflight.json'),JSON.stringify(network,null,2));
    const answerPath=path.join(logRoot,'answer.txt');
    const argv=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--json',
      '-m',model,'-c','model_reasoning_effort="high"','-C',root,...c.options,'-o',answerPath];
    if(schema){const file=path.join(logRoot,'schema.json');fs.writeFileSync(file,JSON.stringify(schema));argv.push('--output-schema',file);}
    argv.push('-');
    const started=performance.now();let output='',errors='';
    try {
      const result=await processRunner(c.binary,argv,{env:c.env,input:prompt,timeout:remainingDeadline(deadline)});
      output=result.stdout;errors=result.stderr;
    } catch(error) {
      output=error.stdout??'';errors=error.stderr??'';
      // Preserve lifecycle/timeout authority; classify only otherwise untyped failures.
      const failure=providerFailure(output);
      if(failure&&(error.code==='ASC_PROVIDER_EXIT'||(!error.code&&error.message.startsWith('Fresh Agent failed (exit='))))Object.assign(error,failure);
      throw error;
    }
    finally {
      fs.writeFileSync(path.join(logRoot,'agent.jsonl'),output);
      fs.writeFileSync(path.join(logRoot,'agent.stderr'),errors);
    }
    const records=output.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
    const contexts=records.filter(x=>x.type==='thread.started').map(x=>x.thread_id);
    demand(contexts.length===1 && typeof contexts[0]==='string' && contexts[0],'Fresh context not observed');
    demand(sentinels.files.every(file=>fs.readFileSync(file,'utf8')==='trusted'),'Host sentinel changed during Agent run');
    const answer=fs.readFileSync(answerPath,'utf8');
    return {context:contexts[0],answer,seconds:(performance.now()-started)/1000,
      usage:records.filter(x=>x.type==='turn.completed').map(x=>x.usage??null)};
  }finally{removeSentinels(sentinels.dirs);fs.rmSync(runtime,{recursive:true,force:true});}
}

function remainingDeadline(deadline){if(deadline===Infinity)return null;const remaining=Math.ceil(deadline-performance.now());demand(remaining>0,'Agent deadline exceeded during preflight');return remaining;}

/** Transient service owns provider descendants; Codex still owns tool confinement. */
export const runBoundedProcess=runServiceProcess;
