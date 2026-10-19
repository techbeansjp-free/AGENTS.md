import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {validateProposal,proposeGoal} from '../src/goal-propose.mjs';
const contract={intent:'Find inventory',criteria:['Search and explain empty results'],allowedPaths:['search.js','empty.js']};
function proposal(){return {status:'proposed',goal:{schema:'asc-goal/v1',intent:contract.intent,units:[{id:'search',intent:'Find stock',criteria:['Query returns matches'],readPaths:[],writePaths:['search.js'],dependsOn:[],contracts:{},approval:'fake'},{id:'empty',intent:'Explain no matches',criteria:['Empty results are explained'],readPaths:['search.js'],writePaths:['empty.js'],dependsOn:['search'],contracts:{}}]},approved:true};}
test('proposal projects only plan data and never carries approval',()=>{const p=validateProposal(proposal(),contract);assert.equal(p.approved,undefined);assert.equal(p.goal.units[0].approval,undefined);assert.deepEqual(p.batches,[['search'],['empty']]);});
test('scope expansion, changed intent, forged pins and unordered conflicts are refused',()=>{
 for(const [change,pattern] of [[p=>p.goal.units[0].writePaths.push('secret'),/scope/],[p=>p.goal.intent='Other',/intent/],[p=>p.goal.units[0].contracts.api='a'.repeat(64),/pin/],[p=>p.goal.units[1].dependsOn=[],/dependency/]]){const p=proposal();change(p);assert.throws(()=>validateProposal(p,contract),pattern);}
});
test('unresolved questions cannot masquerade as an executable plan',()=>{const p=validateProposal({status:'needs-owner',questions:['Which tenant?'],goal:proposal().goal},contract);assert.equal(p.goal,undefined);assert.throws(()=>validateProposal({status:'needs-owner',questions:[]},contract),/questions/);});
test('read-only proposal binds source and cannot mutate Git or use exhausted budget',{skip:process.platform!=='linux'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-proposal-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');fs.writeFileSync(path.join(root,'search.js'),'before');git('add','.');git('commit','-qm','base');
 const head=git('rev-parse','HEAD'),request={repo:root,base:head,contract};let calls=0;
 const agent=async options=>{calls++;assert.equal(options.writable,false);assert(!fs.existsSync(path.join(options.workspace,'.git')));return {answer:JSON.stringify(proposal()),context:'planner',seconds:0,usage:[]};};
 const result=await proposeGoal(request,{agent});t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(result.binding.head,head);assert.equal(result.calls[0].usage,null);assert.match(result.authority,/advisory/);assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'');
 await assert.rejects(proposeGoal({...request,budget:{maxAgentCalls:0}},{agent}),/budget/);assert.equal(calls,1);
 for(const invalid of [{verificationResourceProfile:'unknown'},{verificationAssets:{runtime:{source:root,digest:'a'.repeat(64),entries:1},dependencies:[]}}]){
  await assert.rejects(proposeGoal({...request,contract:{...contract,...invalid}},{agent}),/Unknown verification resource profile|Invalid asset pin/);assert.equal(calls,1,'invalid verification inputs must not start the planner');
 }
 await assert.rejects(proposeGoal(request,{agent:async options=>{fs.writeFileSync(path.join(options.workspace,'search.js'),'tampered');return {answer:JSON.stringify(proposal()),context:'bad'};}}),/modified/);
});

test('proposal source observation never executes configured clean filters',{skip:process.platform!=='linux'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-proposal-filter-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');fs.writeFileSync(path.join(root,'search.js'),'before');fs.writeFileSync(path.join(root,'.gitattributes'),'search.js filter=trap\n');git('add','.');git('commit','-qm','base');
 const marker=path.join(os.tmpdir(),path.basename(root)+'-marker');t.after(()=>fs.rmSync(marker,{force:true}));git('config','filter.trap.clean',`touch '${marker}'; cat`);fs.utimesSync(path.join(root,'search.js'),new Date(),new Date());
 const r=await proposeGoal({repo:root,base:'HEAD',contract,model:'test-double',codexExecutable:process.execPath},{agent:async()=>({answer:JSON.stringify(proposal()),context:'read-only',usage:[]})});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));assert(!fs.existsSync(marker));
});

test('a policy document digest cannot become an unsupplied shared-contract pin',()=>{
 const p=proposal();p.goal.units[0].contracts={'OWNER_RULES.md':'14c62b67c3a81d9b3d0344c9aa70a6810df70d4e5ba492546e085a69c7cdbed6'};
 assert.throws(()=>validateProposal(p,contract,{}),/Invalid contract pin/);
 p.goal.units[0].contracts={'owner-rules':'14c62b67c3a81d9b3d0344c9aa70a6810df70d4e5ba492546e085a69c7cdbed6'};
 assert.throws(()=>validateProposal(p,contract,{}),/invented contract pin/);
 p.goal.units[0].contracts={};assert.equal(validateProposal(p,contract,{}).status,'proposed');
});


test('proposal retries capacity once without repairing code or losing failure accounting',{skip:process.platform!=='linux'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-proposal-capacity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');fs.writeFileSync(path.join(root,'search.js'),'before');git('add','.');git('commit','-qm','base');
 const request={repo:root,base:git('rev-parse','HEAD'),contract},capacity=()=>Object.assign(Error('busy'),{code:'ASC_PROVIDER_CAPACITY'});
 const clean=error=>{t.after(()=>fs.rmSync(error.proposalDiagnostic.root,{recursive:true,force:true}));return true;};
 let count=0,initial;
 const result=await proposeGoal(request,{agent:async options=>{count++;assert.equal(options.writable,false);if(count===1){initial=options;throw capacity();}assert.equal(options.workspace,initial.workspace);assert.equal(options.prompt,initial.prompt);return {answer:JSON.stringify(proposal()),context:'planner',seconds:0,usage:[]};}});
 t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(count,2);assert.deepEqual(result.calls.map(c=>c.status),['failed','completed']);assert.equal(result.calls[0].code,'ASC_PROVIDER_CAPACITY');
 count=0;await assert.rejects(proposeGoal(request,{agent:async()=>{count++;throw capacity();}}),error=>{clean(error);assert.equal(error.proposalDiagnostic.calls.length,2);return error.code==='ASC_PROVIDER_CAPACITY';});assert.equal(count,2);
 count=0;await assert.rejects(proposeGoal({...request,budget:{maxAgentCalls:1}},{agent:async()=>{count++;throw capacity();}}),error=>{clean(error);return /budget/i.test(error.message);});assert.equal(count,1);
 count=0;await assert.rejects(proposeGoal(request,{agent:async options=>{count++;fs.writeFileSync(path.join(options.workspace,'search.js'),'changed');throw capacity();}}),error=>{clean(error);assert.equal(error.proposalDiagnostic.calls.length,1);return /modified/.test(error.message);});assert.equal(count,1);
 count=0;await assert.rejects(proposeGoal(request,{agent:async()=>{count++;throw Error('unclassified outage');}}),error=>{clean(error);return /unclassified/.test(error.message);});assert.equal(count,1);
 assert.equal(git('status','--porcelain'),'');
});
