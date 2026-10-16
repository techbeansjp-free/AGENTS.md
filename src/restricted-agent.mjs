import {performance} from 'node:perf_hooks';
import {assertExecutionHost} from './execution-host.mjs';
/** Codex sandbox adapter; lifecycle supplied by the trusted execution backend. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {codexRuntimeRoots,nodeRuntimeRoots} from './codex-runtime.mjs';
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
  const filesystem={':root':'deny',':minimal':'read',...Object.fromEntries(nodeRuntimeRoots().map(p=>[p,'read'])),...Object.fromEntries(providerRoots.map(p=>[p,'read'])),[node]:'read',[root]:writable?'write':'read',[temp]:'write',...Object.fromEntries(readOnlyRoots.map(r=>[r,'read']))};
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
export function assertPreflight(result,hostValue) {
  demand(result.status===0 && !result.error,'Isolation diagnostic failed');
  const data=JSON.parse(result.stdout);
  demand(data.completed===true && data.read==='denied' && ['denied','private-write-completed'].includes(data.write) && hostValue==='trusted','Isolation not established');
}
export async function runAgent({workspace,logs,executable,model,prompt,writable=true,schema,timeout=null},processRunner=runBoundedProcess) {
  assertExecutionHost();
  demand(timeout===null||(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=2147483647),'Invalid Agent deadline');
  const deadline=timeout===null?Infinity:performance.now()+timeout;
  demand(typeof model==='string' && model.length && typeof prompt==='string','Explicit model and prompt required');
  const logRoot=fs.realpathSync(logs),root=fs.realpathSync(workspace);
  demand(!contains(root,logRoot),'Logs must be outside source');
  const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'asc-v05-tool-'));
  try {
    const c=configuration({workspace,runtime,executable,writable});
    const sandbox=['sandbox','-P',c.profile,...c.options,'-C',root,'--'];
    const preflightRun=(binary,args,options)=>processRunner(binary,args,{...options,timeout:Math.min(options.timeout,remainingDeadline(deadline)??Infinity)});
    await preflightRun(c.binary,[...sandbox,c.node,'-e','process.exit(0)'],{env:c.env,input:'',timeout:20000});
    const sentinel=path.join(logRoot,'controller-sentinel');fs.writeFileSync(sentinel,'trusted',{flag:'wx'});
    const code=`const fs=require('node:fs');let read='denied',write='denied';
try{fs.readFileSync(process.argv[1]);read='accessible';}catch(e){if(!['EACCES','EPERM','ENOENT'].includes(e.code))throw e;}
try{fs.writeFileSync(process.argv[1],'changed');write='private-write-completed';}catch(e){if(!['EACCES','EPERM','ENOENT'].includes(e.code))throw e;}
fs.writeSync(1,JSON.stringify({completed:true,read,write}));`;
    const probe={status:0,...await preflightRun(c.binary,[...sandbox,c.node,'-e',code,sentinel],{env:c.env,input:'',timeout:20000})};
    const hostValue=fs.readFileSync(sentinel,'utf8');
    fs.writeFileSync(path.join(logRoot,'preflight.json'),JSON.stringify({status:probe.status,stdout:probe.stdout,stderr:probe.stderr,hostUnchanged:hostValue==='trusted'},null,2));
    assertPreflight(probe,hostValue);
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

function remainingDeadline(deadline){if(deadline===Infinity)return null;const remaining=Math.ceil(deadline-performance.now());demand(remaining>0,'Agent deadline exceeded during preflight');return remaining;}

/** Transient service owns provider descendants; Codex still owns tool confinement. */
export const runBoundedProcess=runServiceProcess;
