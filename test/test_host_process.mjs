import {test} from 'node:test';import {setTimeout} from 'node:timers';import assert from 'node:assert/strict';
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
test('output written right before the Host child exits is returned whole',async()=>{
 // 6 MiB, written just before exit, so part of it is still in the pipe when the child has exited.
 const code="const b=Buffer.alloc(6*1024*1024,97);process.stdout.write(b,()=>process.stderr.write('tail',()=>process.exit(0)))";
 for(let i=0;i<3;i++){
  const result=await runHostProcess(process.execPath,['-e',code],{env:{},input:''});
  assert.equal(result.stdout.length,6*1024*1024);assert.equal(result.stderr,'tail');
 }
});
test('a cleanup that cannot be confirmed keeps the original error as its cause',posix,async()=>{
 const kill=(pid,signal)=>{if(pid<0&&signal===0)return true;return process.kill(pid,signal);};
 await assert.rejects(runHostProcess(process.execPath,['-e','process.exit(3)'],{env:{},input:''},{kill}),
  e=>e.code==='ASC_HOST_CLEANUP_UNCONFIRMED'&&e.cause?.code==='ASC_PROVIDER_EXIT'&&/failed: 3/.test(e.cause.message));
});
test('on Windows the Host child keeps the old lifecycle: no process group, only the direct child is stopped',async()=>{
 const sent=[];const kill=(pid,signal)=>{sent.push([pid,signal]);return process.kill(pid,signal);};
 const result=await runHostProcess(process.execPath,['-e',"process.stdout.write('ok')"],{env:{},input:''},{kill,platform:'win32'});
 assert.equal(result.stdout,'ok');assert.deepEqual(sent,[],'no group signal is sent');
 await assert.rejects(runHostProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},input:'',timeout:200},{kill,platform:'win32'}),e=>e.code==='ASC_HOST_TRANSPORT_TIMEOUT');
 assert.deepEqual(sent,[]);
});
test('a signal that ends the Host stops its owned groups, and finished calls leave no listeners',posix,async t=>{
 const root=tempDir('asc-host-relay-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const before=['SIGINT','SIGTERM','SIGHUP','exit'].map(n=>process.listenerCount(n));
 await Promise.all([runHostProcess(process.execPath,['-e','0'],{env:{},input:''}),runHostProcess(process.execPath,['-e','0'],{env:{},input:''})]);
 assert.deepEqual(['SIGINT','SIGTERM','SIGHUP','exit'].map(n=>process.listenerCount(n)),before,'listeners are removed after the calls');
 // A Host stand-in runs a long child that starts a leftover, then receives SIGTERM as the Controller sends on a deadline.
 const file=path.join(root,'pids.json'),module=new URL('../src/host-process.mjs',import.meta.url).href;
 const host=`import {runHostProcess} from ${JSON.stringify(module)};
runHostProcess(process.execPath,['-e',${JSON.stringify(leftovers(file)+';setInterval(()=>{},1000)')}],{env:{PATH:process.env.PATH},input:''}).catch(()=>{});`;
 const {spawn}=await import('node:child_process');
 const p=spawn(process.execPath,['--input-type=module','-e',host],{stdio:'ignore'});
 for(let i=0;i<200&&!fs.existsSync(file);i++)await new Promise(r=>setTimeout(r,25));
 const pids=JSON.parse(fs.readFileSync(file,'utf8'));
 t.after(()=>{for(const pid of Object.values(pids))try{process.kill(pid,'SIGKILL');}catch{ /* Already stopped. */ }});
 const ended=new Promise(r=>p.on('exit',(code,signal)=>r(signal)));p.kill('SIGTERM');
 assert.equal(await ended,'SIGTERM','the Host still ends by the signal it received');
 for(let i=0;i<40&&Object.values(pids).some(alive);i++)await new Promise(r=>setTimeout(r,25));
 for(const [kind,pid] of Object.entries(pids))assert.equal(alive(pid),false,`${kind} ${pid} must be stopped with the Host`);
});
test('output that arrives after the Host child exits is still collected while the pipes stay open',posix,async()=>{
 // A child outside the group keeps stdout and writes 200 ms after the direct child exited, then ends.
 const code="require('node:child_process').spawn(process.execPath,['-e',\"setTimeout(()=>process.stdout.write('late'),200)\"],{detached:true,stdio:['ignore','inherit','inherit']}).unref();process.stdout.write('early')";
 const result=await runHostProcess(process.execPath,['-e',code],{env:{},input:''});
 assert.equal(result.stdout,'earlylate');
});
