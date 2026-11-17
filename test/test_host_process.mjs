import {test} from 'node:test';import {setTimeout,clearTimeout} from 'node:timers';import assert from 'node:assert/strict';
import {runHostProcess} from '../src/host-process.mjs';
test('native Host transport handles output, failure and timeout without a shell',async()=>{
 const run=(code,timeout=3000)=>runHostProcess(process.execPath,['-e',code],{env:{},input:'',timeout});
 assert.equal((await run("process.stdout.write('日本語')")).stdout,'日本語');
 await assert.rejects(run('process.exit(3)'),/failed: 3/);
 await assert.rejects(run('setInterval(()=>{},1000)',100),error=>{assert.match(error.message,/deadline/);assert.equal(error.code,'ASC_HOST_TRANSPORT_TIMEOUT');return true;});
});
test('a child that exits without reading its input reports its exit status, and lost input still fails a success',async()=>{
 // A megabyte cannot fit in the pipe, so the write fails with EPIPE every time; before #1725 that error won the race.
 const input='x'.repeat(1024*1024),run=code=>runHostProcess(process.execPath,['-e',code],{env:{},input,timeout:10000});
 await assert.rejects(run('process.exit(3)'),error=>{assert.match(error.message,/failed: 3/);assert.equal(error.code,'ASC_PROVIDER_EXIT');assert.match(String(error.cause?.code),/EPIPE|ECONNRESET/);return true;});
 await assert.rejects(run('process.exit(0)'),error=>{assert.equal(error.message,'Host input failed');assert.match(String(error.cause?.code),/EPIPE|ECONNRESET/);return true;});
 // A child that reads all of it succeeds.
 const read=await runHostProcess(process.execPath,['-e',"let n=0;process.stdin.on('data',d=>{n+=d.length;}).on('end',()=>process.stdout.write(String(n)))"],{env:{},input,timeout:10000});
 assert.equal(read.stdout,String(input.length));
});


test('unspecified Host time budget does not create an immediate deadline',async()=>{
 const result=await runHostProcess(process.execPath,['-e','setTimeout(()=>console.log("completed"),30)'],{env:{},input:''});
 assert.equal(result.stdout.trim(),'completed');
});

// #1703: leftovers that stay in the Host child's process group stop with it; a setsid child is outside the cleanup.
import fs from 'node:fs';import path from 'node:path';import {tempDir} from './helpers/temp-dir.mjs';
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
const posix={skip:process.platform==='win32'};
// A Host stand-in runs as its own process; its stderr is kept so that a failure says why it ended (#1720).
const runStandIn=async(host,started)=>{
 const {spawn}=await import('node:child_process');
 const p=spawn(process.execPath,['--input-type=module','-e',host],{stdio:['ignore','ignore','pipe']});started?.(p);
 let stderr='';p.stderr.setEncoding('utf8').on('data',d=>{stderr+=d;});
 // A stand-in that does not end within the limit is stopped, so a regression fails with its stderr, not a CI timeout.
 // SIGTERM first lets its relay stop the groups it owns; SIGKILL follows if it still runs.
 let timedOut=false,force;const limit=setTimeout(()=>{timedOut=true;p.kill('SIGTERM');force=setTimeout(()=>p.kill('SIGKILL'),2000);},30000);
 const [code,signal]=await new Promise(r=>p.on('close',(code,signal)=>r([code,signal])));clearTimeout(limit);clearTimeout(force);
 const why=`code=${code} signal=${signal} stderr=${stderr}`;
 // Being stopped here never counts as the expected end, even when the stopping signal is the expected one.
 assert.equal(timedOut,false,`the stand-in did not end within 30 s: ${why}`);
 return {code,signal,stderr,why};
};
// The Host child starts one leftover of each kind and writes their pids before it exits.
const leftovers=(file,{escape=false}={})=>{
 const forever=`${JSON.stringify(process.execPath)} -e 'setInterval(()=>{},1000)'`;
 return `const {spawn,spawnSync}=require('node:child_process'),fs=require('node:fs');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();
const sh=cmd=>Number(spawnSync('/bin/sh',['-c',cmd+' >/dev/null 2>&1 & echo $!'],{encoding:'utf8'}).stdout.trim());
const pids={child:child.pid,background:sh(${JSON.stringify(forever)}),nohup:sh('nohup '+${JSON.stringify(forever)})};
${escape?"const away=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});away.unref();pids.setsid=away.pid;":''}
fs.writeFileSync(${JSON.stringify(file+'.tmp')},JSON.stringify(pids));fs.renameSync(${JSON.stringify(file+'.tmp')},${JSON.stringify(file)});`;
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
 let p;const ended=runStandIn(host,child=>{p=child;});
 for(let i=0;i<200&&!fs.existsSync(file);i++)await new Promise(r=>setTimeout(r,25));
 const pids=JSON.parse(fs.readFileSync(file,'utf8'));
 t.after(()=>{for(const pid of Object.values(pids))try{process.kill(pid,'SIGKILL');}catch{ /* Already stopped. */ }});
 p.kill('SIGTERM');const {signal,why}=await ended;
 assert.equal(signal,'SIGTERM',`the Host still ends by the signal it received: ${why}`);
 for(let i=0;i<40&&Object.values(pids).some(alive);i++)await new Promise(r=>setTimeout(r,25));
 for(const [kind,pid] of Object.entries(pids))assert.equal(alive(pid),false,`${kind} ${pid} must be stopped with the Host`);
});
test('output that arrives after the Host child exits is still collected while the pipes stay open',posix,async()=>{
 // A child outside the group keeps stdout and writes 200 ms after the direct child exited, then ends.
 const code="require('node:child_process').spawn(process.execPath,['-e',\"setTimeout(()=>process.stdout.write('late'),200)\"],{detached:true,stdio:['ignore','inherit','inherit']}).unref();process.stdout.write('early')";
 // A generous drain keeps the test independent of machine load.
 const result=await runHostProcess(process.execPath,['-e',code],{env:{},input:''},{drainMilliseconds:5000});
 assert.equal(result.stdout,'earlylate');
});
test('the output limit fails the call and stops the group, also when passed while draining',posix,async t=>{
 const root=tempDir('asc-host-limit-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'pids.json');
 await assert.rejects(runHostProcess(process.execPath,['-e',leftovers(file)+";process.stdout.write(Buffer.alloc(9*1024*1024,97));setInterval(()=>{},1000)"],{env:{PATH:process.env.PATH},input:''}),/output limit/);
 const pids=JSON.parse(fs.readFileSync(file,'utf8'));
 t.after(()=>{for(const pid of Object.values(pids))try{process.kill(pid,'SIGKILL');}catch{ /* Already stopped. */ }});
 for(const [kind,pid] of Object.entries(pids))assert.equal(alive(pid),false,`${kind} ${pid} must be stopped`);
 // A child outside the group writes past the limit after the direct child exited successfully.
 const late="require('node:child_process').spawn(process.execPath,['-e',\"setTimeout(()=>process.stdout.write(Buffer.alloc(9*1024*1024,98)),100)\"],{detached:true,stdio:['ignore','inherit','inherit']}).unref()";
 await assert.rejects(runHostProcess(process.execPath,['-e',late],{env:{},input:''},{drainMilliseconds:5000}),/output limit/);
});
test('a Host executable that cannot start fails at once',async()=>{
 const started=Date.now();
 await assert.rejects(runHostProcess('/nonexistent/asc-host-binary',[],{env:{},input:''}),/could not start/);
 assert.ok(Date.now()-started<1500,'no drain wait after a failed start');
});
const errno=code=>Object.assign(Error(code),{code});
test('EPERM from the group SIGKILL while a member is exiting waits for the group instead of failing',posix,async()=>{
 // macOS reports EPERM while a killed member is not yet reaped; the bounded wait, not the send, decides.
 const sent=[];let polls=0;
 const kill=(pid,signal)=>{sent.push(signal);if(pid>0)return process.kill(pid,signal);if(signal==='SIGKILL')throw errno('EPERM');if(++polls<3)throw errno('EPERM');throw errno('ESRCH');};
 const result=await runHostProcess(process.execPath,['-e',"process.stdout.write('ok')"],{env:{},input:''},{kill});
 assert.equal(result.stdout,'ok');assert.deepEqual(sent.filter(s=>s==='SIGKILL'),['SIGKILL']);
 // Another send error still fails as unconfirmed, and the child's own error stays the cause.
 const broken=(pid,signal)=>{if(pid<0&&signal==='SIGKILL')throw errno('EINVAL');return process.kill(pid,signal);};
 await assert.rejects(runHostProcess(process.execPath,['-e','process.exit(3)'],{env:{},input:''},{kill:broken}),
  e=>e.code==='ASC_HOST_CLEANUP_UNCONFIRMED'&&e.cause?.code==='ASC_PROVIDER_EXIT'&&e.signalError?.code==='EINVAL');
 // EPERM that never clears is kept too, so an unconfirmed cleanup says how the send went.
 const stuck=(pid,signal)=>{if(pid>0)return process.kill(pid,signal);throw errno('EPERM');};
 await assert.rejects(runHostProcess(process.execPath,['-e','0'],{env:{},input:''},{kill:stuck}),
  e=>e.code==='ASC_HOST_CLEANUP_UNCONFIRMED'&&e.cause?.code==='EPERM'&&e.signalError?.code==='EPERM');
});
test('a signal that arrives during the cleanup wait sends no second SIGKILL to the group',posix,async t=>{
 const root=tempDir('asc-host-resend-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const log=path.join(root,'kills.log'),module=new URL('../src/host-process.mjs',import.meta.url).href;
 // A Host stand-in records every kill; while it waits for the group to empty, it receives SIGTERM.
 const host=`import fs from 'node:fs';import {runHostProcess} from ${JSON.stringify(module)};
const real=process.kill.bind(process);let polls=0;
process.kill=(pid,signal)=>{fs.appendFileSync(${JSON.stringify(log)},JSON.stringify([pid,signal])+'\\n');
 if(pid<0&&signal===0){if(++polls===3)real(process.pid,'SIGTERM');return true;}return real(pid,signal);};
runHostProcess(process.execPath,['-e','0'],{env:{},input:''}).catch(()=>{});`;
 const {signal,why}=await runStandIn(host);
 assert.equal(signal,'SIGTERM',why);
 const kills=fs.readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.ok(kills.some(([pid,signal])=>pid<0&&signal===0),'the wait polled the group');
 assert.equal(kills.filter(([pid,signal])=>pid<0&&signal==='SIGKILL').length,1,'the group is signalled once');
});
test('a Host that keeps running after a relayed signal is left with no cleanup listeners and gets the signal once',posix,async t=>{
 const root=tempDir('asc-host-listeners-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const out=path.join(root,'counts.json'),module=new URL('../src/host-process.mjs',import.meta.url).href;
 // The stand-in has its own SIGTERM listener, so the relayed SIGTERM does not end it; then it runs a second call.
 const host=`import fs from 'node:fs';import {runHostProcess} from ${JSON.stringify(module)};
let received=0;process.on('SIGTERM',()=>{received++;});
const count=()=>['SIGINT','SIGTERM','SIGHUP','exit'].map(n=>process.listenerCount(n));const before=count();
const first=runHostProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},input:''}).catch(()=>{});
setTimeout(()=>process.kill(process.pid,'SIGTERM'),300);await first;const afterSignal=count();
// A copy re-raised by the relay would arrive here, or during the next call and stop its group (#1720).
await runHostProcess(process.execPath,['-e','0'],{env:{},input:''});
await new Promise(r=>setTimeout(r,200));
fs.writeFileSync(${JSON.stringify(out)},JSON.stringify({before,afterSignal,afterNext:count(),received}));`;
 const {code,why}=await runStandIn(host);
 assert.equal(code,0,why);
 const {before,afterSignal,afterNext,received}=JSON.parse(fs.readFileSync(out,'utf8'));
 assert.deepEqual(afterSignal,before);assert.deepEqual(afterNext,before);
 assert.equal(received,1,'the own listener of the Host gets the signal once; the relay does not raise it again');
});
test('a Host listener decides the end however it is registered, and without one the signal ends the Host',posix,async t=>{
 const root=tempDir('asc-host-once-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const module=new URL('../src/host-process.mjs',import.meta.url).href;
 // Each listener finishes its own cleanup 150 ms after the signal, then exits with 23. A once listener is removed when
 // it runs, and the last one removes itself; the relay must still see that the Host handles the signal.
 const forms={
  'once before the call':(sig,done)=>({before:`process.once(${sig},${done});`,after:''}),
  'prependOnce after the call':(sig,done)=>({before:'',after:`process.prependOnceListener(${sig},${done});`}),
  'prepended, removes itself':(sig,done)=>({before:'',after:`const own=()=>{process.removeListener(${sig},own);(${done})();};process.prependListener(${sig},own);`}),
 };
 for(const name of ['SIGINT','SIGTERM','SIGHUP']){
  const sig=JSON.stringify(name);
  for(const [form,place] of Object.entries(forms)){
   const out=path.join(root,`${name}-${Object.keys(forms).indexOf(form)}.txt`);
   const done=`()=>setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(out)},'cleaned');process.exit(23);},150)`;
   const {before,after}=place(sig,done);
   const host=`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);import {runHostProcess} from ${JSON.stringify(module)};
${before}runHostProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},input:''}).catch(()=>{});${after}
setTimeout(()=>process.kill(process.pid,${sig}),300);setInterval(()=>{},1000);`;
   const {code,why}=await runStandIn(host);
   assert.equal(code,23,`${name} ${form}: ${why}`);
   assert.equal(fs.readFileSync(out,'utf8'),'cleaned',`${name} ${form}`);
  }
  // Without a listener of its own, the Host still ends by the signal it received.
  const host=`import {runHostProcess} from ${JSON.stringify(module)};
runHostProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},input:''}).catch(()=>{});
setTimeout(()=>process.kill(process.pid,${sig}),300);setInterval(()=>{},1000);`;
  const {signal,why}=await runStandIn(host);
  assert.equal(signal,name,`${name} without a listener: ${why}`);
 }
});
test('moving the relay ahead of Host listeners ends, raises no event when it is already first, and never unwatches',posix,async t=>{
 const root=tempDir('asc-host-order-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const module=new URL('../src/host-process.mjs',import.meta.url).href;
 // The Host refills a SIGTERM listener whenever one is removed (the case that looped) and records the events it sees.
 // With two loaded copies, each copy owns a call and has its own relay; a refill prepended during the move of one copy
 // must not make the other copy move again. A refill prepended during a move stays ahead (a documented limit).
 for(const [copies,refill] of [[1,'once'],[2,'prependOnceListener']]){
  const out=path.join(root,`events-${copies}.json`);
  const imports=Array.from({length:copies},(_,i)=>`import {runHostProcess as run${i}} from ${JSON.stringify(`${module}?copy=${i}`)};`).join('');
  const calls=Array.from({length:copies},(_,i)=>`run${i}(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},input:'',timeout:1500}).catch(()=>{})`).join(',');
  const host=`import fs from 'node:fs';${imports}
const seen={removed:0,unwatched:0};
process.on('removeListener',name=>{if(name!=='SIGTERM')return;seen.removed++;if(process.listenerCount('SIGTERM')===0)seen.unwatched++;if(seen.removed<1000)process.${refill}('SIGTERM',()=>{});});
const calls=[${calls}];
process.on('SIGTERM',()=>{});const appended=seen.removed;await new Promise(r=>setTimeout(r,20));const afterAppend=seen.removed;
process.prependListener('SIGTERM',()=>{});await new Promise(r=>setTimeout(r,20));const afterPrepend=seen.removed;
const first=Boolean(process.rawListeners('SIGTERM')[0][Symbol.for('asc.host-process.relay')]);const unwatched=seen.unwatched;
fs.writeFileSync(${JSON.stringify(out)},JSON.stringify({appended,afterAppend,afterPrepend,unwatched,first}));await Promise.all(calls);`;
  const {code,why}=await runStandIn(host);
  assert.equal(code,0,`${copies} copies: ${why}`);
  const {appended,afterAppend,afterPrepend,unwatched,first}=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.equal(afterAppend,appended,`${copies} copies: a listener added behind the relays does not move them`);
  assert.equal(afterPrepend,afterAppend+copies,`${copies} copies: a listener prepended ahead moves each relay once, and the refill does not loop`);
  if(refill==='once')assert.equal(first,true,'a relay is first again');
  assert.equal(unwatched,0,`${copies} copies: the signal always keeps a listener while a relay moves`);
 }
});
