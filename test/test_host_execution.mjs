import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Controller} from '../src/controller.mjs';
import {hostExecution} from '../src/host-execution.mjs';
import {runWorkflow} from '../src/workflow.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-host-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
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
