import {test} from 'node:test';import assert from 'node:assert/strict';
import {runHostProcess} from '../src/host-process.mjs';
test('native Host transport handles output, failure and timeout without a shell',async()=>{
 const run=(code,timeout=3000)=>runHostProcess(process.execPath,['-e',code],{env:{},input:'',timeout});
 assert.equal((await run("process.stdout.write('日本語')")).stdout,'日本語');
 await assert.rejects(run('process.exit(3)'),/failed: 3/);
 await assert.rejects(run('setInterval(()=>{},1000)',100),error=>{assert.match(error.message,/deadline/);assert.equal(error.code,'ASC_HOST_TRANSPORT_TIMEOUT');return true;});
});


test('unspecified Host time budget does not create an immediate deadline',async()=>{
 const result=await runHostProcess(process.execPath,['-e','setTimeout(()=>console.log("completed"),30)'],{env:{},input:''});
 assert.equal(result.stdout.trim(),'completed');
});

// #1703: leftovers that stay in the Host child's process group stop with it; a setsid child is outside the cleanup.
import fs from 'node:fs';import path from 'node:path';import {tempDir} from './helpers/temp-dir.mjs';
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
const posix={skip:process.platform==='win32'};
// The Host child starts one leftover of each kind and writes their pids before it exits.
const leftovers=(file,{escape=false}={})=>{
 const forever=`${JSON.stringify(process.execPath)} -e 'setInterval(()=>{},1000)'`;
 return `const {spawn,spawnSync}=require('node:child_process'),fs=require('node:fs');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();
const sh=cmd=>Number(spawnSync('/bin/sh',['-c',cmd+' >/dev/null 2>&1 & echo $!'],{encoding:'utf8'}).stdout.trim());
const pids={child:child.pid,background:sh(${JSON.stringify(forever)}),nohup:sh('nohup '+${JSON.stringify(forever)})};
${escape?"const away=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});away.unref();pids.setsid=away.pid;":''}
fs.writeFileSync(${JSON.stringify(file)},JSON.stringify(pids));`;
};
test('the Host child process group stops with the child: plain, background and nohup leftovers',posix,async t=>{
 const root=tempDir('asc-host-group-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'pids.json');
 await runHostProcess(process.execPath,['-e',leftovers(file)],{env:{PATH:process.env.PATH},input:''});
 const pids=JSON.parse(fs.readFileSync(file,'utf8'));
 t.after(()=>{for(const pid of Object.values(pids))try{process.kill(pid,'SIGKILL');}catch{ /* Already stopped. */ }});
 for(const [kind,pid] of Object.entries(pids))assert.equal(alive(pid),false,`${kind} ${pid} must be stopped`);
});
test('a failing or timed-out Host child also stops its group, and keeps its own error',posix,async t=>{
 const root=tempDir('asc-host-group-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,tail,timeout,expect] of [['failed',';process.exit(3)',null,e=>/failed: 3/.test(e.message)&&e.code==='ASC_PROVIDER_EXIT'],
  ['timeout',';setInterval(()=>{},1000)',1500,e=>e.code==='ASC_HOST_TRANSPORT_TIMEOUT']]){
  const file=path.join(root,`${name}.json`);
  await assert.rejects(runHostProcess(process.execPath,['-e',leftovers(file)+tail],{env:{PATH:process.env.PATH},input:'',timeout}),expect);
  const pids=JSON.parse(fs.readFileSync(file,'utf8'));
  t.after(()=>{for(const pid of Object.values(pids))try{process.kill(pid,'SIGKILL');}catch{ /* Already stopped. */ }});
  for(const [kind,pid] of Object.entries(pids))assert.equal(alive(pid),false,`${name}: ${kind} ${pid} must be stopped`);
 }
});
test('a setsid leftover escapes the group cleanup, and holding the pipes does not stall the Host',posix,async t=>{
 const root=tempDir('asc-host-group-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'pids.json');
 // The escaping child inherits stdout, so the pipes stay open after the Host child exits.
 const code=leftovers(file,{escape:true}).replace("{detached:true,stdio:'ignore'}","{detached:true,stdio:['ignore','inherit','inherit']}");
 const started=Date.now();
 const result=await runHostProcess(process.execPath,['-e',code+";process.stdout.write('done')"],{env:{PATH:process.env.PATH},input:''});
 const pids=JSON.parse(fs.readFileSync(file,'utf8'));
 t.after(()=>{for(const pid of Object.values(pids))try{process.kill(pid,'SIGKILL');}catch{ /* Already stopped. */ }});
 assert.equal(result.stdout,'done');assert.ok(Date.now()-started<5000,'must not wait for the escaped pipes');
 assert.equal(alive(pids.setsid),true,'the documented limit: a setsid child is outside the group');
 for(const kind of ['child','background','nohup'])assert.equal(alive(pids[kind]),false,`${kind} must be stopped`);
});
test('a group that does not empty fails the Host call as cleanup unconfirmed',posix,async()=>{
 // Injected kill: the group never reports itself gone.
 const kill=(pid,signal)=>{if(pid<0&&signal===0)return true;return process.kill(pid,signal);};
 await assert.rejects(runHostProcess(process.execPath,['-e','0'],{env:{},input:''},{kill}),e=>e.code==='ASC_HOST_CLEANUP_UNCONFIRMED');
});
