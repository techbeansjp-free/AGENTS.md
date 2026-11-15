import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {Controller} from '../src/controller.mjs';
import {hostExecution} from '../src/host-execution.mjs';
import {runWorkflow} from '../src/workflow.mjs';
import {withStdinFile} from '../src/source-limits.mjs';

function fixture(t){
 const root=tempDir('asc-host-test-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');fs.writeFileSync(path.join(repo,'code.txt'),'before');git('add','.');git('commit','-qm','base');
 const script=path.join(root,'host.mjs');
 // Explicit test Host: real Node verification; model and remote calls are doubles.
 fs.writeFileSync(script,`import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const q=JSON.parse(fs.readFileSync(0,'utf8'));let result;
if(process.env.ASC_SECRET_FOR_TEST)throw Error('inherited secret');
if(q.operation==='agent'){
 const p=q.payload;if(p.writable)fs.writeFileSync(path.join(p.workspace,'code.txt'),'after');
 result={context:q.id,seconds:0,usage:[],answer:p.writable?'':JSON.stringify({verdict:'pass',findings:[]})};
}else{const p=q.payload,r=spawnSync(p.argv[0],p.argv.slice(1),{cwd:p.workspace,env:{},timeout:p.timeout});result={exit:r.status,stdout:String(r.stdout),stderr:String(r.stderr)};}
process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,result}));`);
 const contract={intent:'Change text',criteria:['after'],allowedPaths:['code.txt'],testArgv:[process.execPath,'-e',`if(require('node:fs').readFileSync('code.txt','utf8')!=='after')process.exit(1)`],riskTestArgv:[],requiredChecks:['test'],policyRevision:'v1',unresolved:[],risks:[],requiresDesign:false,design:''};
 const configuration={protocol:'asc-host-execution/v1',command:[process.execPath,script]};
 const request={repo,base:git('rev-parse','HEAD'),contract,hostExecution:configuration,commitIdentity:{name:'Fixture',email:'fixture@example.invalid'}};
 return {root,repo,git,script,configuration,request,c:new Controller({...request,implementer:'worker'})};
}
test('Host path completes actual verification and independent contexts without Linux execution backend',async t=>{
 const f=fixture(t);process.env.ASC_SECRET_FOR_TEST='not-to-be-forwarded';t.after(()=>delete process.env.ASC_SECRET_FOR_TEST);
 const result=await runWorkflow(f.request,{provider:{intent:()=>f.request.contract.intent,createDraft:()=>1,observe:()=>({head:f.git('rev-parse','HEAD'),draft:true,merged:false,boundToPr:true,checks:{test:'success'}})}});
 t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));
 assert.equal(result.status,'draft-ci-passed');assert.equal(result.calls.length,2);assert.notEqual(result.calls[0].context,result.calls[1].context);
});
test('candidate cannot supply Host executable or operand; wrong invocation cannot become evidence',async t=>{
 const f=fixture(t);
 fs.writeFileSync(path.join(f.repo,'evil.mjs'),'');
 assert.throws(()=>hostExecution(f.c,{...f.configuration,command:[process.execPath,path.join(f.repo,'evil.mjs')]}),/Candidate/);
 fs.writeFileSync(f.script,`process.stdout.write(JSON.stringify({schema:'asc-host-execution/v1',id:'stale',operation:'agent',result:{}}))`);
 await assert.rejects(hostExecution(f.c,f.configuration).agent({timeout:1000}),/binding mismatch/);
});
test('changing Host verification invalidates prior verification and review',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.repo,'code.txt'),'after');f.git('add','.');f.git('commit','-qm','change');
 const host=hostExecution(f.c,f.configuration);f.c.setHostVerification(host.verify);f.c.verify();await f.c.review(async({target})=>({context:'reviewer',target,verdict:'pass',blockers:[]}));
 f.c.ready(f.request.contract.intent);f.c.setHostVerification(host.verify);assert.throws(()=>f.c.ready(f.request.contract.intent),/verification or review missing/);
});

test('a sibling registered worktree cannot provide Host code',t=>{
 const f=fixture(t),sibling=path.join(f.root,'sibling');f.git('worktree','add','-qb','peer',sibling);
 const script=path.join(sibling,'host.mjs');fs.writeFileSync(script,'');
 assert.throws(()=>hostExecution(f.c,{...f.configuration,command:[process.execPath,script]}),/Candidate/);
});

test('Host transport preserves Japanese across split UTF-8 output chunks',async t=>{
 const f=fixture(t);fs.writeFileSync(f.script,`import fs from 'node:fs';const q=JSON.parse(fs.readFileSync(0,'utf8'));const b=Buffer.from(JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,result:{answer:'日本語'}}));const i=b.indexOf(Buffer.from('日'))+1;fs.writeSync(1,b.subarray(0,i));setTimeout(()=>fs.writeSync(1,b.subarray(i)),30);`);
 assert.equal((await hostExecution(f.c,f.configuration).agent({timeout:3000})).answer,'日本語');
});

test('asset inventory pins ordinary native paths without an OS gate',async t=>{
 const {inspectAssets}=await import('../src/verification-assets.mjs');const f=fixture(t),dir=path.join(f.root,'assets');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'data.txt'),'asset');
 const a=inspectAssets(dir);assert.equal(a.entries,1);assert.equal(a.bytes,5);fs.writeFileSync(path.join(dir,'data.txt'),'changed');assert.notEqual(inspectAssets(dir).digest,a.digest);
});

test('bundled Codex Host rejects candidate executable hidden inside owner configuration',async t=>{
 const f=fixture(t),config=path.join(f.root,'config.json'),script=path.join(f.repo,'evil.mjs');fs.writeFileSync(script,'process.exit(0)');
 fs.writeFileSync(config,JSON.stringify({executable:script,codexHome:f.root}));
 const adapter=new URL('../bin/asc-codex-host.mjs',import.meta.url);
 assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(adapter),'--config',config],{input:JSON.stringify({schema:'asc-host-execution/v1',id:'test',operation:'agent',authorityRoots:[f.repo],payload:{workspace:f.root}}),stdio:['pipe','pipe','pipe']}),e=>String(e.stderr).includes('Candidate or Git metadata'));
});


test('Host preserves resolved temporary root without forwarding arbitrary environment',async t=>{
 const f=fixture(t);fs.writeFileSync(f.script,`import fs from 'node:fs';const q=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,result:{temporary:[process.env.TMPDIR,process.env.TEMP,process.env.TMP],secret:process.env.ASC_SECRET_FOR_TEST??null}}));`);
 process.env.ASC_SECRET_FOR_TEST='private';t.after(()=>delete process.env.ASC_SECRET_FOR_TEST);
 const result=await hostExecution(f.c,f.configuration).agent({timeout:3000});
 assert.deepEqual(result.temporary,Array(3).fill(fs.realpathSync(os.tmpdir())));assert.equal(result.secret,null);
});

test('Host verification startup failure does not trigger implementation repairs',async t=>{
 const f=fixture(t);fs.appendFileSync(f.script,`
`);
 fs.writeFileSync(f.script,fs.readFileSync(f.script,'utf8').replace("}else{const p=q.payload", "}else{throw Error('sandbox capability unavailable');const p=q.payload"));
 await assert.rejects(runWorkflow(f.request,{provider:{intent:()=>f.request.contract.intent}}),error=>{
  const d=error.workflowDiagnostic;t.after(()=>fs.rmSync(d.root,{recursive:true,force:true}));
  assert.equal(d.calls.length,1);assert.equal(d.repairs,0);assert.match(d.events.find(e=>e.type==='verification-unavailable').hostStderr,/sandbox capability unavailable/);
  assert.match(error.message,/Host verification could not execute/);return true;
 });
});

test('asynchronous Host failure retains bounded stderr and preserves output cap',async t=>{
 const f=fixture(t);
 fs.writeFileSync(f.script,"import fs from 'node:fs';fs.readFileSync(0);fs.writeSync(2,'x'.repeat(9000)+'diagnostic');process.exitCode=1;");
 await assert.rejects(hostExecution(f.c,f.configuration).agent({timeout:3000}),e=>{assert.match(e.message,/Host execution failed/);assert.equal(e.hostStderr.length,8192);assert.ok(e.hostStderr.endsWith('diagnostic'));return true;});
 fs.writeFileSync(f.script,"import fs from 'node:fs';fs.readFileSync(0);fs.writeSync(2,'x'.repeat(9*1024*1024));");
 await assert.rejects(hostExecution(f.c,f.configuration).agent({timeout:3000}),/Host output limit/);
});

test('only invocation-bound Agent capacity failures retain retry classification',async t=>{
 const f=fixture(t);
 for(const mode of ['bound','stale','wrong-operation','success','unknown']){
  fs.writeFileSync(f.script,`import fs from 'node:fs';const q=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify({schema:q.schema,id:${mode==='stale'?"'stale'":'q.id'},operation:${mode==='wrong-operation'?"'verify'":'q.operation'},error:{code:${mode==='unknown'?"'UNKNOWN'":"'ASC_PROVIDER_CAPACITY'"}}}));process.exitCode=${mode==='success'?0:1};`);
  await assert.rejects(hostExecution(f.c,f.configuration).agent({timeout:3000}),e=>{
   assert.equal(e.code,mode==='bound'?'ASC_PROVIDER_CAPACITY':undefined);return true;
  });
 }
});

test('Host capacity preserves partial implementation through real verification and independent review',async t=>{
 const f=fixture(t);f.request.maxRepairs=0;
 const original=fs.readFileSync(f.script,'utf8');
 fs.writeFileSync(f.script,original.replace("const p=q.payload;if(p.writable)",`const p=q.payload;
 if(p.writable&&fs.readFileSync(path.join(p.workspace,'code.txt'),'utf8')==='before'){
  fs.writeFileSync(path.join(p.workspace,'code.txt'),'partial');
  process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,error:{code:'ASC_PROVIDER_CAPACITY'}}));process.exit(1);
 }
 if(p.writable)`));
 const result=await runWorkflow(f.request,{provider:{intent:()=>f.request.contract.intent,createDraft:()=>1,observe:()=>({head:f.git('rev-parse','HEAD'),draft:true,merged:false,boundToPr:true,checks:{test:'success'}})}});
 t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));
 assert.equal(result.status,'draft-ci-passed');assert.equal(result.repairs,0);
 assert.deepEqual(result.calls.map(c=>c.status),['failed','completed','completed']);
 assert.equal(result.calls[0].usage,null);assert.equal(result.events.filter(e=>e.type==='provider-retry').length,1);
 assert.notEqual(result.calls[1].context,result.calls[2].context);
});

// withStdinFile gives the Host transport, the approval command and local Git their stdin (#1682). It is tested here
// because Windows CI runs this file (#1694); the Git paths are in test_stdin_file.mjs.
const kindOfStdin="const s=fs.fstatSync(0),kind=s.isFile()?'file':s.isFIFO()?'fifo':s.isSocket()?'socket':s.isCharacterDevice()?'char':'other';";
/** Run with os.tmpdir() pointed at a directory of this test, so the helper's private directory can be listed directly
    on every OS (Windows reads TEMP and TMP, POSIX reads TMPDIR). */
function withTestTmpdir(t,run){
 const dir=tempDir('asc-stdin-tmpdir-'),saved=Object.fromEntries(['TMPDIR','TEMP','TMP'].map(k=>[k,process.env[k]]));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const k of Object.keys(saved))process.env[k]=dir;
 try{return run(dir);}finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
const stdinDirs=dir=>fs.readdirSync(dir).filter(name=>name.startsWith('asc-stdin-')).map(name=>path.join(dir,name));

test('withStdinFile gives the child a private regular file with the whole input and removes it afterwards',t=>{
 assert.equal(withStdinFile(undefined,stdin=>stdin),'ignore');
 const input=Buffer.alloc(2*1024*1024,7);
 withTestTmpdir(t,dir=>{
  const result=withStdinFile(input,stdin=>{
   assert.equal(typeof stdin,'number');
   const dirs=stdinDirs(dir);assert.equal(dirs.length,1);const file=path.join(dirs[0],'input');
   assert.equal(fs.statSync(file).size,input.length);
   // Windows has no POSIX permission bits; there the directory is private only through the user's temp directory.
   if(process.platform!=='win32'){assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(dirs[0]).mode&0o777,0o700);}
   return spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import {createHash} from 'node:crypto';${kindOfStdin}
const bytes=fs.readFileSync(0);process.stdout.write(JSON.stringify({kind,size:bytes.length,sha:createHash('sha256').update(bytes).digest('hex')}));`],{stdio:[stdin,'pipe','pipe'],encoding:'utf8'});
  });
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{kind:'file',size:input.length,sha:createHash('sha256').update(input).digest('hex')});
  assert.deepEqual(stdinDirs(dir),[]);
  // The file is removed when the child cannot run or the caller throws.
  assert.throws(()=>withStdinFile('x',()=>{assert.equal(stdinDirs(dir).length,1);throw Error('stop');}),/stop/);
  assert.deepEqual(stdinDirs(dir),[]);
 });
});

test('synchronous Host verification reads its request from a regular file, never a pipe',t=>{
 const {c,root,repo}=fixture(t);const script=path.join(root,'stdin-host.mjs'),log=path.join(root,'host-stdin.json');
 fs.writeFileSync(script,`import fs from 'node:fs';${kindOfStdin}
const q=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({kind,operation:q.operation}));
process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,result:{exit:0,stdout:'ok',stderr:''}}));`);
 const host=hostExecution(c,{protocol:'asc-host-execution/v1',command:[process.execPath,script]});
 const result=host.verify({argv:[process.execPath,'-e','0'],workspace:repo,timeout:20000});
 assert.equal(result.status,0);assert.equal(result.stdout.toString(),'ok');
 assert.deepEqual(JSON.parse(fs.readFileSync(log,'utf8')),{kind:'file',operation:'verify'});
});
