import {tempDir} from './helpers/temp-dir.mjs';
import {performance} from 'node:perf_hooks';
import {setTimeout} from 'node:timers';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import path from 'node:path';
import {configuration,assertPreflight,runAgent} from '../src/restricted-agent.mjs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
test('preflight requires explicit completed denial and unchanged host for every sentinel',()=>{
 const denied={read:'denied',write:'denied'},privateWrite={read:'denied',write:'private-write-completed'};
 const report=targets=>({status:0,stdout:JSON.stringify({completed:true,targets})});
 const good=report([denied,privateWrite]);
 assertPreflight(good,['trusted','trusted']);
 for(const bad of [{...good,status:1},{...good,stdout:''},{...good,stdout:'{}'},
  {...good,stdout:JSON.stringify({completed:true,read:'denied',write:'denied'})},report([]),report([denied]),
  report([denied,{read:'accessible',write:'denied'}]),report([denied,{read:'denied',write:'unknown'}])]) assert.throws(()=>assertPreflight(bad,['trusted','trusted']));
 assert.throws(()=>assertPreflight(good,['trusted','changed']));
 assert.throws(()=>assertPreflight(report([]),[]));
 assert.throws(()=>assertPreflight(good,'trusted'));
});
const agentFixture=t=>{
 const root=tempDir('asc-agent-preflight-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'source'),logs=path.join(root,'logs'),binary=path.join(root,'provider','bin','codex.js');
 for(const dir of [workspace,logs,path.dirname(binary)])fs.mkdirSync(dir,{recursive:true});
 // Configuration-only fixture binary. The fake runner below never executes it as Codex.
 fs.writeFileSync(binary,'fixture');fs.writeFileSync(path.join(path.dirname(path.dirname(binary)),'package.json'),JSON.stringify({name:'@openai/codex'}));
 return {workspace,logs,executable:binary,model:'fixture-model',prompt:'fixture'};
};
const leftSentinels=()=>[os.tmpdir(),...(process.platform==='win32'?[]:['/tmp'])].flatMap(dir=>fs.readdirSync(dir).filter(n=>n.startsWith('asc-v05-sentinel-')).map(n=>path.join(dir,n)));
test('Agent preflight stops when the sandbox can change Controller temporary files',async t=>{
 const before=new Set(leftSentinels()),calls=[];
 // Unconfined stand-in for a sandbox that leaves the Controller temporary directory and /tmp writable (#1695).
 const unconfined=(binary,args)=>{calls.push(args);const at=args.indexOf('--');
  return {stdout:execFileSync(args[at+1],args.slice(at+2),{encoding:'utf8'}),stderr:''};};
 await assert.rejects(runAgent(agentFixture(t),unconfined),/Isolation not established/);
 const probe=calls[1],files=probe.slice(probe.indexOf('-e')+2),tmpdir=fs.realpathSync(os.tmpdir());
 assert(files.some(f=>path.dirname(path.dirname(f))===tmpdir),'Controller tmpdir sentinel must be probed');
 if(process.platform!=='win32')assert(files.some(f=>path.dirname(path.dirname(f))===fs.realpathSync('/tmp')),'/tmp sentinel must be probed');
 assert.deepEqual(leftSentinels().filter(d=>!before.has(d)),[],'sentinel directories must be removed');
});
test('Agent preflight passes denied sentinels on to the network check',async t=>{
 const before=new Set(leftSentinels());let call=0;
 const confined=(binary,args)=>{call++;
  if(call===1)return {stdout:'',stderr:''};
  if(call===2){const files=args.slice(args.indexOf('-e')+2);return {stdout:JSON.stringify({completed:true,targets:files.map(()=>({read:'denied',write:'denied'}))}),stderr:''};}
  throw Error('network check reached');};
 await assert.rejects(runAgent(agentFixture(t),confined),/network check reached/);
 assert.deepEqual(leftSentinels().filter(d=>!before.has(d)),[]);
});
test('profile keeps provider credentials out of tool environment and rejects aliases',t=>{
 const root=tempDir('asc-node-profile-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'source'),runtime=path.join(root,'runtime');fs.mkdirSync(workspace);fs.mkdirSync(runtime);
 // Configuration-only fixture binary. It is never executed as Codex.
 const binary=path.join(root,'provider','bin','codex.js');fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'fixture');fs.writeFileSync(path.join(path.dirname(path.dirname(binary)),'package.json'),JSON.stringify({name:'@openai/codex'}));
 const config=configuration({workspace,runtime,executable:binary,writable:false});
 assert(config.options.includes('shell_environment_policy.inherit="none"'));
 assert(config.options.includes('permissions.asc_minimal_agent.network.enabled=false'));
 const tools=config.options.find(x=>x.startsWith('shell_environment_policy.set='));
 assert(!tools.includes('OPENAI_API_KEY'));assert(!tools.includes('CODEX_HOME'));
 assert.throws(()=>configuration({workspace,runtime:workspace,executable:binary,writable:true}));
 fs.mkdirSync(path.join(workspace,'.git'));assert.throws(()=>configuration({workspace,runtime,executable:binary,writable:true}));
 fs.rmSync(path.join(workspace,'.git'),{recursive:true});
 fs.writeFileSync(path.join(workspace,'a'),'data');fs.linkSync(path.join(workspace,'a'),path.join(workspace,'b'));
 assert.throws(()=>configuration({workspace,runtime,executable:binary,writable:true}),/Aliased/);
});
test('deadline settles even when detached child retains output pipes',{skip:process.platform!=='linux'},async()=>{
 const {runBoundedProcess}=await import('../src/restricted-agent.mjs');
 const code=`const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{detached:true,stdio:'inherit'}).unref();setTimeout(()=>{},2000);`;
 const started=performance.now();
 await assert.rejects(runBoundedProcess(process.execPath,['-e',code],{env:{},input:'',timeout:100}),/deadline/);
 assert(performance.now()-started<1500,'Host wait must not await inherited pipe close');
});
test('split npm native runtime is narrowly included and cannot contain candidate state',t=>{
 const root=tempDir('asc-split-provider-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'source'),runtime=path.join(root,'runtime'),pkg=path.join(root,'node_modules','@openai','codex');
 const native=path.join(root,'node_modules','@openai',`codex-${process.platform}-${process.arch}`);
 for(const dir of [workspace,runtime,path.join(pkg,'bin'),native])fs.mkdirSync(dir,{recursive:true});
 const binary=path.join(pkg,'bin','codex.js');fs.writeFileSync(binary,'fixture');fs.writeFileSync(path.join(path.dirname(path.dirname(binary)),'package.json'),JSON.stringify({name:'@openai/codex'}));
 fs.writeFileSync(path.join(native,'package.json'),JSON.stringify({name:`@openai/codex-${process.platform}-${process.arch}`,version:'0.0.0'}));
 const config=configuration({workspace,runtime,executable:binary,writable:false});
 const permissions=config.options.find(v=>v.startsWith('permissions.asc_minimal_agent.filesystem='));
 assert(permissions.includes(JSON.stringify(fs.realpathSync(native))+'="read"'));
 assert(!permissions.includes(JSON.stringify(path.join(root,'node_modules'))+'="read"'));
 for(const shared of ['/tmp','/private/tmp'])assert.equal(permissions.includes(JSON.stringify(shared)+'="deny"'),process.platform==='darwin');
 assert.throws(()=>configuration({workspace:native,runtime,executable:binary,writable:true}),/overlaps/);
});

test('network preflight rejects missing evidence and reachable sandbox',async()=>{
 const {assertNetworkPreflight}=await import('../src/agent-network-preflight.mjs');
 const good={positive:{completed:true,network:'connected'},positiveConnections:1,
  negative:{completed:true,network:'denied'},sandboxConnections:0};
 assertNetworkPreflight(good);
 for(const bad of [{...good,positiveConnections:0},{...good,negative:null},
  {...good,negative:{completed:true,network:'timeout'}},{...good,sandboxConnections:1},
  {...good,negative:{completed:true,network:'connected'}}])assert.throws(()=>assertNetworkPreflight(bad));
});
test('real loopback test rejects unconfined command and accepts network namespace',
 {skip:process.platform!=='linux'||process.env.ASC_TEST_ISOLATION==='0'},async()=>{
 const {networkPreflight}=await import('../src/agent-network-preflight.mjs');
 const {runBoundedProcess}=await import('../src/restricted-agent.mjs');
 await assert.rejects(networkPreflight({executable:'/usr/bin/env',sandbox:[],env:{},run:runBoundedProcess}),/not established/);
 // The lifecycle service does not add a namespace; this is the tool isolation boundary.
 const result=await networkPreflight({executable:'/usr/bin/bwrap',sandbox:['--unshare-user','--unshare-net','--ro-bind','/','/','--'],env:{},run:runBoundedProcess});
 assert.equal(result.negative.network,'denied');assert.equal(result.sandboxConnections,0);
});

test('OS identity does not reject execution or claim release acceptance',async()=>{
 const {executionHost}=await import('../src/execution-host.mjs');
 assert.equal(executionHost({platform:'linux',release:'6.8.0-generic',env:{}}).executionEligible,true);
 for(const [platform,release,env,kind] of [
  ['linux','5.15.153.1-microsoft-standard-WSL2',{},'wsl2'],
  ['linux','4.4.0-Microsoft',{},'wsl-unverified'],
  ['linux','6.8.0',{WSL_INTEROP:'/run/WSL/123_interop'},'wsl-unverified'],
  ['win32','10.0',{},'windows-native'],['darwin','24.0',{},'macos']]) {
  const value=executionHost({platform,release,env});assert.equal(value.kind,kind);assert.equal(value.executionEligible,true);assert.equal(value.releaseReady,false);
 }
});

test('Controller termination stops Agent and detached descendants through the transient service cgroup',
 {skip:process.platform!=='linux'||process.env.ASC_TEST_ISOLATION==='0'},async t=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const root=tempDir('asc-lifecycle-test-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const state=pid=>{try{const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');return {live:fields[0]!=='Z',start:fields[19]};}catch{return null;}};
 for(const signal of ['SIGTERM','SIGKILL']){
  const ready=path.join(root,signal+'.ready'),driver=path.join(root,signal+'.mjs');
  const detached=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,cgroup:fs.readFileSync('/proc/self/cgroup','utf8')}));setInterval(()=>{},1000);`;
  const program=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(detached)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`;
  fs.writeFileSync(driver,`import {runBoundedProcess} from ${JSON.stringify(new URL('../src/restricted-agent.mjs',import.meta.url).href)};await runBoundedProcess(process.execPath,['-e',${JSON.stringify(program)}],{env:{},input:'',timeout:30000});`);
  const parent=spawn(process.execPath,[driver],{stdio:'ignore'});let owned=[];
  try{
   const limit=Date.now()+5000;while(!fs.existsSync(ready)&&Date.now()<limit)await new Promise(r=>setTimeout(r,10));
   assert(fs.existsSync(ready),'detached Agent descendant did not start');
   const observed=JSON.parse(fs.readFileSync(ready,'utf8'));
   const group=observed.cgroup.split('\n').find(line=>line.startsWith('0::'))?.slice(3);
   assert(group&&/^asc-agent-[a-f0-9-]+\.service$/.test(path.basename(group)),'must observe the invocation service');
   owned=fs.readFileSync(path.join('/sys/fs/cgroup',group,'cgroup.procs'),'utf8').trim().split(/\s+/).map(Number).map(pid=>({pid,...state(pid)}));
   assert(owned.some(p=>p.pid===observed.pid)&&owned.length>=3,'must observe supervisor, provider and detached descendant');
   const exited=once(parent,'exit');assert(parent.kill(signal));await exited;
   const deadline=Date.now()+3000;const survivors=()=>owned.filter(p=>{const now=state(p.pid);return now?.live&&now.start===p.start;});
   while(survivors().length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
   assert.deepEqual(survivors(),[],`owned descendants remain after ${signal}`);
  }finally{parent.kill('SIGKILL');for(const p of owned){const now=state(p.pid);if(now?.live&&now.start===p.start)try{process.kill(p.pid,'SIGKILL');}catch{ /* The child may already have exited; cleanup is best effort. */ }}}
 }
});


test('verification retains tracked control data but launches Codex outside candidate configuration',t=>{
 const root=tempDir('asc-verify-controls-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'source'),runtime=path.join(root,'runtime'),binary=path.join(root,'provider','bin','codex.js');
 for(const dir of [workspace,runtime,path.dirname(binary)])fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(binary,'fixture');fs.writeFileSync(path.join(path.dirname(path.dirname(binary)),'package.json'),JSON.stringify({name:'@openai/codex'}));
 for(const dir of ['.codex','.agents']){fs.mkdirSync(path.join(workspace,dir));fs.writeFileSync(path.join(workspace,dir,'data'),'tracked');}
 assert.throws(()=>configuration({workspace,runtime,executable:binary,writable:true}),/Control directory/);
 const config=configuration({workspace,runtime,executable:binary,writable:true,purpose:'verification'});
 assert.equal(config.launchDirectory,fs.realpathSync(runtime));assert.notEqual(config.launchDirectory,config.root);
 assert.equal(fs.readFileSync(path.join(workspace,'.codex','data'),'utf8'),'tracked');
 fs.mkdirSync(path.join(workspace,'.git'));assert.throws(()=>configuration({workspace,runtime,executable:binary,writable:true,purpose:'verification'}),/Control directory/);
});
