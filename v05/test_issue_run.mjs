import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {compileIssues,runIssues} from './src/issue-run.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-issues-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source=path.join(root,'source');fs.mkdirSync(source);
 const git=(...a)=>execFileSync('git',a,{cwd:source,encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');git('config','user.name','Dummy');git('config','user.email','dummy@example.invalid');fs.writeFileSync(path.join(source,'seed'),'base');git('add','.');git('commit','-qm','base');
 const issues=['a','b','c'].map((id,index)=>{const repo=path.join(root,id);git('worktree','add','--detach',repo,'HEAD');return {id,dependsOn:[],readPaths:[],request:{repo,base:git('rev-parse','HEAD'),contract:{intent:'Issue '+id,criteria:['done'],allowedPaths:[id+'.txt']},delivery:{repository:'dummy/project',issue:index+1,branch:'task-'+id}}};});
 return {source,git,plan:{schema:'asc-issues/v1',intent:'Authorized Issues',issues,parallelism:2}};
}
test('failed Issue blocks only its dependents; independent work continues with priority and bound',async t=>{
 const f=fixture(t);f.plan.issues[0].priority=5;f.plan.issues[2].dependsOn=['a'];let active=0,max=0;const started=[];
 const result=await runIssues(f.plan,{execute:async(_r,id)=>{started.push(id);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,30));active--;if(id==='a')throw Error('approval pending');return {status:'draft-ci-passed'};}});
 t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(result.status,'incomplete');assert.equal(max,2);assert.deepEqual(started,['a','b']);assert.deepEqual(result.issues.map(i=>i.status),['blocked','draft-ci-passed','dependency-blocked']);assert.equal(f.git('status','--porcelain'),'');
 const retry=await runIssues(f.plan,{execute:async()=>({status:'draft-ci-passed'})});t.after(()=>fs.rmSync(retry.root,{recursive:true,force:true}));assert.equal(retry.status,'draft-ci-passed');
});
test('bad worktree affects only that Issue; elapsed and call budgets do not leak between invocations',async t=>{
 const f=fixture(t);f.plan.issues[0].request.repo=f.source;f.plan.budget={maxAgentCalls:1};let calls=0;
 const r=await runIssues(f.plan,{execute:async(_r,_id,budget)=>{budget.admit();calls++;return {status:'draft-ci-passed'};}});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));assert.equal(calls,1);assert.equal(r.budget.admittedAgentCalls,1);assert.equal(r.issues[0].status,'blocked');assert(r.issues.some(i=>i.status==='draft-ci-passed'));assert(r.issues.some(i=>i.status==='budget-stopped'));
 f.plan.budget={maxElapsedSeconds:0};const stopped=await runIssues(f.plan,{execute:()=>{throw Error('must not dispatch');}});t.after(()=>fs.rmSync(stopped.root,{recursive:true,force:true}));assert(stopped.issues.every(i=>i.status==='budget-stopped'));
});
test('same worktree is serialized rather than reserving or rejecting the entire session',async t=>{
 const f=fixture(t);f.plan.issues[1].request.repo=f.plan.issues[0].request.repo;let active=0,max=0;
 const result=await runIssues({...f.plan,issues:f.plan.issues.slice(0,2)},{execute:async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return {status:'draft-ci-passed'};}});
 t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(max,1);assert.equal(result.status,'draft-ci-passed');
});
test('cycles, duplicate Issue or branch authority, and unsequenced shared files are rejected',t=>{
 const f=fixture(t);
 for(const change of [p=>p.issues[0].dependsOn=['a'],p=>p.issues[1].request.delivery.issue=1,p=>p.issues[1].request.delivery.branch='task-a',p=>p.issues[1].readPaths=['a.txt'],p=>p.issues[1].readPaths=[42],p=>p.issues[1].request.budget={maxAgentCalls:2}]){const plan=structuredClone(f.plan);change(plan);assert.throws(()=>compileIssues(plan));}
 f.plan.issues[1].readPaths=['a.txt'];f.plan.issues[1].dependsOn=['a'];assert.doesNotThrow(()=>compileIssues(f.plan));
});

test('independent Issues complete real verification and fresh reviews before separate delivery',{skip:process.platform!=='linux'||process.env.ASC_TEST_ISOLATION==='0'},async t=>{
 const {runWorkflow}=await import('./src/workflow.mjs');const f=fixture(t);f.plan.issues=f.plan.issues.slice(0,2);f.plan.budget={maxAgentCalls:4};let contexts=0,deliveries=0;
 for(const i of f.plan.issues)Object.assign(i.request,{model:'test-double',codexExecutable:process.execPath,maxRepairs:0,contract:{...i.request.contract,testArgv:['/bin/sh','-c',`test "$(cat ${i.id}.txt)" = done`],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:''}});
 const result=await runIssues(f.plan,{execute:(request,id,executionBudget)=>runWorkflow(request,{executionBudget,agent:async({workspace,writable})=>{if(writable)fs.writeFileSync(path.join(workspace,id+'.txt'),'done');return {context:'fresh-'+(++contexts),usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};},provider:{intent:()=>request.contract.intent,createDraft:()=>{deliveries++;return id;},observe:()=>({head:execFileSync('git',['rev-parse','HEAD'],{cwd:request.repo,encoding:'utf8'}).trim(),draft:true,merged:false,boundToPr:true,checks:{test:'success'}})}})});
 t.after(()=>{fs.rmSync(result.root,{recursive:true,force:true});for(const i of result.issues)if(i.result?.root)fs.rmSync(i.result.root,{recursive:true,force:true});});
 assert.equal(result.status,'draft-ci-passed');assert.equal(contexts,4);assert.equal(deliveries,2);assert.equal(result.budget.admittedAgentCalls,4);assert.equal(f.git('status','--porcelain'),'');
 for(const i of result.issues)assert.equal(i.result.calls.filter(c=>c.role==='review').length,1);
});

test('dependent Issue cannot run against stale Git inputs while unrelated Issue still completes',async t=>{
 const f=fixture(t);f.plan.issues[1].dependsOn=['a'];f.plan.issues[1].readPaths=['a.txt'];const started=[];
 const result=await runIssues(f.plan,{execute:async(request,id)=>{
  started.push(id);if(id==='a'){fs.writeFileSync(path.join(request.repo,'a.txt'),'dependency');const git=(...args)=>execFileSync('git',args,{cwd:request.repo,encoding:'utf8'}).trim();git('add','a.txt');git('-c','user.name=Dummy','-c','user.email=dummy@example.invalid','commit','-qm','dependency');return {status:'draft-ci-passed',target:{head:git('rev-parse','HEAD')}};}return {status:'draft-ci-passed'};
 }});t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));
 assert(!started.includes('b'));assert(started.includes('c'));assert.match(result.issues.find(i=>i.id==='b').error,/not integrated/);assert.equal(result.issues.find(i=>i.id==='c').status,'draft-ci-passed');
});


test('approval commands cannot originate in any sibling candidate or shared Git metadata',async t=>{
 const f=fixture(t),a=f.plan.issues[0].request.repo;
 const commands=[[process.execPath,path.join(a,'future-approval.mjs')],[process.execPath,path.join(f.source,'.git','future-approval.mjs')]];
 if(process.platform==='win32')commands.push([process.execPath,path.join(a,'future.mjs').toUpperCase()]);
 if(process.platform!=='win32'){
  const alias=path.join(path.dirname(a),'candidate-alias');fs.symlinkSync(a,alias);commands.push([process.execPath,path.join(alias,'future.mjs')]);
  const dangling=path.join(path.dirname(a),'dangling');fs.symlinkSync(path.join(a,'missing'),dangling);commands.push([process.execPath,dangling]);
 }
 for(const command of commands)for(const nested of [false,true]){
  const plan=structuredClone(f.plan);if(nested)plan.issues[1].request.unitRequests={unit:{approvalCommand:command}};else plan.issues[1].request.approvalCommand=command;
  const dispatched=[];const result=await runIssues(plan,{execute:async(_r,id)=>{dispatched.push(id);return {status:'draft-ci-passed'};}});
  t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert(!dispatched.includes('b'),JSON.stringify({command,nested,issues:result.issues}));assert(dispatched.includes('a'));assert(dispatched.includes('c'));assert.equal(result.issues[1].status,'blocked');assert.match(result.issues[1].error,/authority|alias/);
 }
});

test('owner base update resumes dependent Issue with fresh verification/review and preserves siblings',{skip:process.platform!=='linux'||process.env.ASC_TEST_ISOLATION==='0'},async t=>{
 const {runWorkflow}=await import('./src/workflow.mjs');const f=fixture(t);f.plan.budget={maxAgentCalls:8};
 f.plan.issues[1].dependsOn=['a'];f.plan.issues[1].readPaths=['a.txt'];
 const git=(repo,...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 for(const i of f.plan.issues)Object.assign(i.request,{model:'test-double',codexExecutable:process.execPath,maxRepairs:0,contract:{...i.request.contract,testArgv:['/bin/sh','-c',i.id==='b'?'test "$(cat a.txt)" = upstream && test "$(cat b.txt)" = downstream':`test "$(cat ${i.id}.txt)" = ${i.id==='a'?'upstream':'independent'}`],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:''}});
 let context=0;const executions=[],reviews=[];
 const execute=(request,id,executionBudget)=>runWorkflow(request,{executionBudget,agent:async({workspace,writable})=>{
  const identity='independent-context-'+(++context);
  if(writable){executions.push(id);if(id==='b')assert.equal(fs.readFileSync(path.join(workspace,'a.txt'),'utf8'),'upstream');fs.writeFileSync(path.join(workspace,id+'.txt'),{a:'upstream',b:'downstream',c:'independent'}[id]);}
  else{reviews.push({id,identity,metadata:JSON.parse(fs.readFileSync(path.join(workspace,'.asc-review.json'),'utf8'))});}
  return {context:identity,usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};
 },provider:{intent:()=>request.contract.intent,createDraft:()=>id,observe:()=>({head:git(request.repo,'rev-parse','HEAD'),draft:true,merged:false,boundToPr:true,checks:{test:'success'}})}});
 const cleanup=result=>{t.after(()=>{fs.rmSync(result.root,{recursive:true,force:true});for(const i of result.issues)if(i.result?.root)fs.rmSync(i.result.root,{recursive:true,force:true});});};
 const first=await runIssues(f.plan,{execute});cleanup(first);
 assert.equal(first.status,'incomplete');assert.match(first.issues[1].error,/not integrated/);assert.equal(first.issues[2].status,'draft-ci-passed');assert(!executions.includes('b'));assert(!reviews.some(r=>r.id==='b'));
 const a=f.plan.issues[0].request,c=f.plan.issues[2].request,b=f.plan.issues[1].request;
 const upstream=git(a.repo,'rev-parse','HEAD'),sibling=git(c.repo,'rev-parse','HEAD');
 // Explicit owner integration, outside Agent authority: advance only downstream's base.
 git(b.repo,'-c','core.hooksPath=/dev/null','cherry-pick',upstream);b.base=git(b.repo,'rev-parse','HEAD');
 const oldReviews=reviews.length,oldExecutions=executions.length;
 const second=await runIssues(f.plan,{execute});cleanup(second);
 assert.equal(second.status,'draft-ci-passed');assert.deepEqual(executions.slice(oldExecutions),['b']);
 assert.deepEqual(reviews.slice(oldReviews).map(r=>r.id).sort(),['a','b','c']);
 for(const r of reviews.slice(oldReviews)){assert.equal(r.metadata.target.head,git(f.plan.issues.find(i=>i.id===r.id).request.repo,'rev-parse','HEAD'));assert(r.metadata.verification.length>0);}
 assert.equal(git(a.repo,'rev-parse','HEAD'),upstream);assert.equal(git(c.repo,'rev-parse','HEAD'),sibling);assert.equal(f.git('status','--porcelain'),'');
 assert.equal(fs.readFileSync(path.join(b.repo,'a.txt'),'utf8'),'upstream');assert.equal(fs.readFileSync(path.join(b.repo,'b.txt'),'utf8'),'downstream');
});

test('dirty worktree blocks only its Issue and owner commit permits same-session recovery without sibling reimplementation',{skip:process.platform!=='linux'||process.env.ASC_TEST_ISOLATION==='0'},async t=>{
 const {runWorkflow}=await import('./src/workflow.mjs');const f=fixture(t);f.plan.budget={maxAgentCalls:8};
 const git=(repo,...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 for(const i of f.plan.issues)Object.assign(i.request,{model:'test-double',codexExecutable:process.execPath,maxRepairs:0,contract:{...i.request.contract,testArgv:['/bin/sh','-c',`test "$(cat ${i.id}.txt)" = done`],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:''}});
 const dirty=f.plan.issues[0].request;fs.writeFileSync(path.join(dirty.repo,'seed'),'owner unfinished change');
 let serial=0;const implementations=[],reviews=[];
 const execute=(request,id,executionBudget)=>runWorkflow(request,{executionBudget,agent:async({workspace,writable})=>{
  if(writable){implementations.push(id);fs.writeFileSync(path.join(workspace,id+'.txt'),'done');}else reviews.push(id);
  return {context:'dirty-recovery-'+(++serial),usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};
 },provider:{intent:()=>request.contract.intent,createDraft:()=>id,observe:()=>({head:git(request.repo,'rev-parse','HEAD'),draft:true,merged:false,boundToPr:true,checks:{test:'success'}})}});
 const cleanup=r=>t.after(()=>{fs.rmSync(r.root,{recursive:true,force:true});for(const i of r.issues){const root=i.result?.root??i.diagnostic?.root;if(root)fs.rmSync(root,{recursive:true,force:true});}});
 const first=await runIssues(f.plan,{execute});cleanup(first);
 assert.equal(first.status,'incomplete');assert.equal(first.issues[0].status,'blocked');assert.match(first.issues[0].error,/Aliased or changed source/);
 assert.deepEqual(implementations.slice().sort(),['b','c']);assert.deepEqual(reviews.slice().sort(),['b','c']);
 assert(first.issues.slice(1).every(i=>i.status==='draft-ci-passed'));
 assert.equal(fs.readFileSync(path.join(dirty.repo,'seed'),'utf8'),'owner unfinished change');
 assert.equal(git(dirty.repo,'rev-parse','HEAD'),dirty.base);assert.equal(git(dirty.repo,'status','--porcelain'),'M seed');
 const siblings=f.plan.issues.slice(1).map(i=>[i.request.repo,git(i.request.repo,'rev-parse','HEAD')]);
 // Fixture owner commits their own work and explicitly updates only this Issue's base.
 git(dirty.repo,'add','seed');git(dirty.repo,'-c','user.name=Dummy','-c','user.email=dummy@example.invalid','commit','-qm','owner completes pending edit');dirty.base=git(dirty.repo,'rev-parse','HEAD');
 const n=implementations.length,m=reviews.length;const second=await runIssues(f.plan,{execute});cleanup(second);
 assert.equal(second.status,'draft-ci-passed');assert.deepEqual(implementations.slice(n),['a']);assert.deepEqual(reviews.slice(m).sort(),['a','b','c']);
 assert.equal(fs.readFileSync(path.join(dirty.repo,'seed'),'utf8'),'owner unfinished change');
 for(const [repo,head] of siblings){assert.equal(git(repo,'rev-parse','HEAD'),head);assert.equal(git(repo,'status','--porcelain'),'');}
 assert.equal(f.git('status','--porcelain'),'');
});
