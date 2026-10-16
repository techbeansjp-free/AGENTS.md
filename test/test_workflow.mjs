import {performance} from 'node:perf_hooks';
import {setTimeout} from 'node:timers';
import {parseReview} from '../src/review-result.mjs';
const finding=message=>({location:'code.txt',condition:message,evidence:message,impact:'Fixture contract violated',action:message,counterevidence:'Fixture content directly violates the stated contract',severity:'P2',verification:'static-analysis',blocking:true});
/** Real Git/verification with explicit Agent/provider test doubles. */
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {runWorkflow} from '../src/workflow.mjs';import {hash} from '../src/controller.mjs';
const enabled=process.platform==='linux'&&process.env.ASC_TEST_ISOLATION!=='0';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-workflow-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(root,'code.txt'),'before');git('add','.');git('commit','-qm','base');
 const contract={intent:'Write after followed by newline',criteria:['after with newline'],allowedPaths:['code.txt'],testArgv:['/bin/sh','-c','test "$(cat code.txt)" = after'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'fixture',risks:[],unresolved:[],design:'',requiresDesign:false};
 const request={repo:root,base:git('rev-parse','HEAD'),contract,codexExecutable:process.execPath,model:'test-double',maxRepairs:1};
 let creates=0;const provider={intent:()=>contract.intent,createDraft:()=>{creates++;return 1;},observe:()=>({head:git('rev-parse','HEAD'),draft:true,merged:false,boundToPr:true,checks:{test:'success'}})};
 return {root,git,request,provider,creates:()=>creates};
}
test('minor mandatory contract finding causes repair, revalidation and fresh review',{skip:!enabled},async t=>{
 const f=fixture(t);f.request.contract.riskTestArgv=[['/bin/sh','-c','test -f code.txt']];let workers=0,reviews=0;
 const agent=async({workspace,writable,prompt})=>{
  if(writable){const input=JSON.parse(prompt);assert.deepEqual(input.verification.testArgv,f.request.contract.testArgv);assert.deepEqual(input.verification.riskTestArgv,f.request.contract.riskTestArgv);assert.match(input.verification.execution,/Controller only/);input.verification.testArgv[0]='/not-authorized';workers++;fs.writeFileSync(path.join(workspace,'code.txt'),workers===1?'after':'after\n');return {context:'worker-'+workers,seconds:0,usage:[]};}
  reviews++;const pass=fs.readFileSync(path.join(workspace,'code.txt'),'utf8')==='after\n';
  return {context:'review-'+reviews,answer:JSON.stringify({verdict:pass?'pass':'fail',findings:pass?[]:[{...finding('Required newline missing'),severity:'P3'}]}),seconds:0,usage:[]};
 };
 const result=await runWorkflow(f.request,{agent,provider:f.provider});t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));
 const assessments=result.events.filter(e=>e.type==='review-assessment');assert.equal(assessments.length,2);assert.equal(assessments[0].findings[0].condition,'Required newline missing');assert.notEqual(assessments[0].target.head,assessments[1].target.head);assert.equal(assessments[1].target.head,result.target.head);
 assert.equal(result.status,'draft-ci-passed');assert.equal(result.repairs,1);assert.equal(workers,2);assert.equal(reviews,2);assert.equal(f.creates(),1);
 assert.deepEqual(result.events.filter(x=>x.type==='work-selected').map(x=>x.work),['implementation','verify','independent-review','repair','verify','independent-review','delivery']);
});
test('repair limit prevents delivery and failed validation cannot become review',{skip:!enabled},async t=>{
 const f=fixture(t);let workers=0,reviews=0;
 const agent=async({workspace,writable})=>{if(!writable){reviews++;throw Error('review must not start');}workers++;fs.writeFileSync(path.join(workspace,'code.txt'),'wrong-'+workers);return {context:'worker-'+workers,seconds:0,usage:[]};};
 await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider}),/Verification/);assert.equal(workers,2);assert.equal(reviews,0);assert.equal(f.creates(),0);
});
test('owner uncertainty does not start Agents or delivery',{skip:!enabled},async t=>{
 const f=fixture(t);f.request.contract.unresolved=['business rule missing'];
 const r=await runWorkflow(f.request,{agent:()=>{throw Error('must not start');},provider:f.provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));
 assert.equal(r.status,'owner-work-required');assert(Number.isFinite(r.wallSeconds)&&r.wallSeconds>=0);assert.equal(r.work.work,'clarify');assert.equal(f.creates(),0);
});
test('high risk without host approval never starts implementation',{skip:!enabled},async t=>{
 const f=fixture(t);Object.assign(f.request.contract,{risks:['authorization'],requiresDesign:true,design:'Deny by default',riskTestArgv:[['/bin/true']]});
 const r=await runWorkflow(f.request,{agent:()=>{throw Error('must not start');},provider:f.provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));
 assert.equal(r.status,'owner-work-required');assert.equal(r.work.work,'design-approval');assert.equal(f.creates(),0);
});
test('changed primary request stops before review and delivery',{skip:!enabled},async t=>{
 const f=fixture(t);let changed=false;
 f.provider.intent=()=>changed?'Different owner intent':f.request.contract.intent;
 const agent=async({workspace,writable})=>{assert.equal(writable,true);fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');changed=true;return {context:'worker',seconds:0,usage:[]};};
 const r=await runWorkflow(f.request,{agent,provider:f.provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));
 assert.equal(r.status,'owner-work-required');assert.equal(r.work.work,'reconcile-intent');assert.equal(f.creates(),0);
});
test('legacy Agent controls stay unchanged in Git and absent from fresh contexts',{skip:!enabled},async t=>{
 const f=fixture(t);
 fs.mkdirSync(path.join(f.root,'.codex'));fs.mkdirSync(path.join(f.root,'.agents/skills'),{recursive:true});
 fs.writeFileSync(path.join(f.root,'.codex/config.toml'),'model = "must-not-load"\n');
 fs.writeFileSync(path.join(f.root,'.agents/skills/legacy.md'),'Legacy Step instructions');
 f.git('add','.');f.git('commit','-qm','legacy control assets');f.request.base=f.git('rev-parse','HEAD');
 let calls=0;
 const agent=async({workspace,writable})=>{
  calls++;assert.equal(fs.existsSync(path.join(workspace,'.codex')),false);assert.equal(fs.existsSync(path.join(workspace,'.agents')),false);
  if(writable){fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');return {context:'worker',usage:[],seconds:0};}
  return {context:'reviewer',usage:[],seconds:0,answer:JSON.stringify({verdict:'pass',findings:[]})};
 };
 const r=await runWorkflow(f.request,{agent,provider:f.provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));
 assert.equal(r.status,'draft-ci-passed');assert.equal(calls,2);
 assert.equal(fs.readFileSync(path.join(f.root,'.codex/config.toml'),'utf8'),'model = "must-not-load"\n');
 assert.equal(fs.readFileSync(path.join(f.root,'.agents/skills/legacy.md'),'utf8'),'Legacy Step instructions');
 f.request.contract.allowedPaths=['.codex/config.toml'];
 await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider}),/owner-managed migration/);assert.equal(calls,2);
});
test('failed adapter attempt is counted with missing usage and discoverable diagnostics',{skip:!enabled},async t=>{
 const f=fixture(t);let runRoot;
 await assert.rejects(runWorkflow(f.request,{provider:f.provider,onEvent:e=>{if(e.type==='run-started')runRoot=e.root;},agent:async()=>{throw Error('provider unavailable');}}),/provider unavailable/);
 t.after(()=>fs.rmSync(runRoot,{recursive:true,force:true}));const r=JSON.parse(fs.readFileSync(path.join(runRoot,'result.json')));
 assert.equal(r.calls.length,1);assert.equal(r.calls[0].status,'failed');assert.equal(r.calls[0].boundary,'adapter-invocation');assert.equal(r.calls[0].context,null);assert.equal(r.calls[0].usage,null);
 assert.equal(r.allAgentTotalTokens,null);assert.equal(f.creates(),0);assert.equal(r.events.at(-1).type,'blocked');
});

test('deleted allowed document repair receives bounded baseline context',{skip:!enabled},async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'design.md'),'Count 1. Preserve explanation.');f.git('add','.');f.git('commit','-qm','design baseline');f.request.base=f.git('rev-parse','HEAD');f.request.contract.allowedPaths.push('design.md');
 let workers=0,reviews=0;
 const agent=async({workspace,writable,prompt})=>{
  if(writable){workers++;const input=JSON.parse(prompt);
   if(workers===1){assert.deepEqual(input.restorationRefs,[]);fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');fs.unlinkSync(path.join(workspace,'design.md'));}
   else{assert.equal(input.restorationRefs.length,1);const ref=input.restorationRefs[0];assert.equal(ref.base,f.request.base);assert.equal(ref.path,'design.md');fs.writeFileSync(path.join(workspace,ref.path),fs.readFileSync(path.join(workspace,ref.ref),'utf8').replace('1','3'));}
   return {context:'worker-'+workers,usage:[],seconds:0};
  }
  reviews++;return {context:'review-'+reviews,usage:[],seconds:0,answer:JSON.stringify({verdict:reviews===1?'fail':'pass',findings:reviews===1?[finding('Restore missing design')]:[]})};
 };
 const r=await runWorkflow(f.request,{agent,provider:f.provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));
 assert.equal(r.repairs,1);assert.equal(fs.readFileSync(path.join(f.root,'design.md'),'utf8'),'Count 3. Preserve explanation.');assert.equal(fs.existsSync(path.join(f.root,'.asc-repair-base')),false);
});

test('repair cannot alter the host-provided restoration reference',{skip:!enabled},async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'design.md'),'Original design');f.git('add','.');f.git('commit','-qm','design');f.request.base=f.git('rev-parse','HEAD');f.request.contract.allowedPaths.push('design.md');let workers=0,runRoot;
 const agent=async({workspace,writable,prompt})=>{
  if(writable){workers++;
   if(workers===1){fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');fs.unlinkSync(path.join(workspace,'design.md'));}
   else{const ref=JSON.parse(prompt).restorationRefs[0].ref;fs.writeFileSync(path.join(workspace,ref),'Forged baseline');fs.writeFileSync(path.join(workspace,'design.md'),'Restored');}
   return {context:'worker-'+workers,usage:[],seconds:0};
  }
  return {context:'review',usage:[],seconds:0,answer:JSON.stringify({verdict:'fail',findings:[finding('Missing design')]})};
 };
 await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider,onEvent:e=>{if(e.type==='run-started')runRoot=e.root;}}),/Read-only context was modified/);
 t.after(()=>fs.rmSync(runRoot,{recursive:true,force:true}));assert.equal(f.creates(),0);
});

test('host interpreter cannot execute candidate approval source',{skip:!enabled},async t=>{
 const f=fixture(t),file=path.join(f.root,'approval.mjs'),marker=path.join(f.root,'executed');
 fs.writeFileSync(file,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'executed');console.log('{}')`);f.git('add','.');f.git('commit','-qm','candidate script');f.request.base=f.git('rev-parse','HEAD');
 f.request.approvalCommand=[process.execPath,file];Object.assign(f.request.contract,{requiresDesign:true,design:'Owner decision needed'});
 let calls=0;await assert.rejects(runWorkflow(f.request,{provider:f.provider,agent:()=>{calls++;throw Error('unexpected');}}),/cannot supply owner authority/);
 assert.equal(calls,0);assert.equal(fs.existsSync(marker),false);assert.equal(f.creates(),0);
});


test('pinned owner rules reach implementer and fresh reviewer without extra Agents',{skip:!enabled},async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'rules.md'),'Use an ending newline');f.git('add','.');f.git('commit','-qm','owner rules');f.request.base=f.git('rev-parse','HEAD');f.request.contract.policyRefs=[{path:'rules.md',sha256:hash(Buffer.from('Use an ending newline'))}];let calls=0;
 const agent=async({workspace,writable,prompt})=>{calls++;const input=writable?JSON.parse(prompt):JSON.parse(fs.readFileSync(path.join(workspace,'.asc-review.json'))).contract;assert.deepEqual(input.policyRefs,f.request.contract.policyRefs);assert.equal(fs.readFileSync(path.join(workspace,'rules.md'),'utf8'),'Use an ending newline');if(writable)fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');return {context:'fresh-'+calls,usage:[],seconds:0,answer:JSON.stringify({verdict:'pass',findings:[]})};};
 const r=await runWorkflow(f.request,{agent,provider:f.provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));assert.equal(r.status,'draft-ci-passed');assert.equal(calls,2);
});

test('Agent budget counts failed starts and cannot poison a separate Issue',{skip:!enabled},async t=>{
 const f=fixture(t);f.request.budget={maxAgentCalls:0};let calls=0;
 await assert.rejects(runWorkflow(f.request,{provider:f.provider,agent:async()=>{calls++;}}),e=>{assert.match(e.message,/budget exhausted/);assert.equal(e.workflowDiagnostic.budget.admittedAgentCalls,0);assert.equal(e.workflowDiagnostic.calls.length,0);return true;});
 assert.equal(calls,0);assert.equal(f.git('rev-parse','HEAD'),f.request.base);
 f.request.budget={maxAgentCalls:1};
 await assert.rejects(runWorkflow(f.request,{provider:f.provider,agent:async()=>{calls++;throw Error('provider failed');}}),e=>{assert.equal(e.workflowDiagnostic.budget.admittedAgentCalls,1);return true;});
 const other=fixture(t);other.request.budget={maxAgentCalls:2};let n=0;
 const result=await runWorkflow(other.request,{provider:other.provider,agent:async({workspace,writable})=>{if(writable)fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');return {context:'fresh-'+(++n),usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};}});
 assert.equal(result.status,'draft-ci-passed');assert.equal(result.budget.admittedAgentCalls,2);assert.equal(other.creates(),1);assert.equal(f.creates(),0);
});
test('budget exhaustion retains candidate without bypassing review; expired time admits no work',{skip:!enabled},async t=>{
 const f=fixture(t);f.request.budget={maxAgentCalls:1};let calls=0;
 await assert.rejects(runWorkflow(f.request,{provider:f.provider,agent:async({workspace,writable})=>{calls++;assert(writable);fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');return {context:'implementation',usage:[]};}}),e=>{assert.match(e.message,/budget exhausted/);assert.equal(e.workflowDiagnostic.calls.length,1);return true;});
 assert.equal(calls,1);assert.notEqual(f.git('rev-parse','HEAD'),f.request.base);assert.equal(f.creates(),0);
 const next=fixture(t);next.request.budget={maxElapsedSeconds:0};
 await assert.rejects(runWorkflow(next.request,{provider:next.provider,agent:()=>{throw Error('should not launch');}}),/time budget exhausted/);
 assert.equal(next.git('rev-parse','HEAD'),next.request.base);assert.equal(next.creates(),0);
});


test('implementation uncertainty returns owner questions without applying speculative output',{skip:!enabled},async t=>{
 const f=fixture(t);let calls=0;
 const result=await runWorkflow(f.request,{provider:f.provider,agent:async({workspace})=>{calls++;fs.writeFileSync(path.join(workspace,'code.txt'),'speculative');return {context:'question-context',usage:[],answer:JSON.stringify({status:'needs-owner',questions:['Which business rule applies?']})};}});
 t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(result.status,'owner-work-required');assert.equal(result.candidateApplied,false);assert.equal(result.work.work,'clarify');assert.equal(calls,1);assert.equal(f.git('rev-parse','HEAD'),f.request.base);assert.equal(f.git('status','--porcelain'),'');assert.equal(f.creates(),0);
});

test('verification repair receives bounded error data and successful output stays hashed',{skip:!enabled},async t=>{
 const f=fixture(t);f.request.contract.testArgv=['/bin/sh','-c','if test "$(cat code.txt)" = after; then echo success; else i=0; while test "$i" -lt 5000; do printf x >&2; i=$((i+1)); done; printf "wrong module format" >&2; exit 1; fi'];
 let calls=0,diagnostic;
 const agent=async({workspace,writable,prompt})=>{if(writable){calls++;const p=JSON.parse(prompt);if(calls===2)diagnostic=p.previousFailure.observations[0].results[0].diagnostic;fs.writeFileSync(path.join(workspace,'code.txt'),calls===1?'wrong':'after');}return {context:'diagnostic-'+(++sequence),seconds:0,usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};};let sequence=0;
 const r=await runWorkflow(f.request,{agent,provider:f.provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));
 assert.equal(r.status,'draft-ci-passed');assert.equal(calls,2);assert.equal(diagnostic.stderr.length,4096);assert(diagnostic.stderr.endsWith('wrong module format'));assert.match(diagnostic.authority,/untrusted/);assert.equal(diagnostic.truncated,true);
 assert.equal(r.controllerEvents.filter(e=>e.operation==='verify').at(-1).results[0].diagnostic,undefined);
});


test('review shape refuses contradictory pass and unsupported reproduction claims',()=>{
 const f=finding('Missing acceptance behavior');
 assert.throws(()=>parseReview({verdict:'pass',findings:[f]}),/contradicts/);
 assert.throws(()=>parseReview({verdict:'pass',findings:[{...f,severity:'P1',blocking:false}]}),/major/);
 assert.throws(()=>parseReview({verdict:'fail',findings:[{...f,verification:'reproduced'}]}),/verification/);
 const incomplete={...f};delete incomplete.counterevidence;assert.throws(()=>parseReview({verdict:'fail',findings:[incomplete]}),/fields/);
 assert.throws(()=>parseReview({verdict:'pass',blockers:[]}),/findings/);
 const risk=parseReview({verdict:'fail',findings:[{...f,verification:'unverified-risk'}]});
 assert.equal(risk.findings[0].verification,'unverified-risk');assert.match(risk.evidenceAuthority,/not host-reproduced/);assert.equal(risk.blockers.length,1);
});

test('owner control candidate can be reviewed without installing controls, repair or delivery',{skip:!enabled},async t=>{
 const f=fixture(t),name='.agents/skills/project/SKILL.md';fs.mkdirSync(path.dirname(path.join(f.root,name)),{recursive:true});fs.writeFileSync(path.join(f.root,name),'Owner migration: use current project contract.');f.git('add','.');f.git('commit','-qm','owner control candidate');
 f.request.contract.allowedPaths=[name];f.request.contract.testArgv=['/bin/true'];let calls=0;
 const agent=async({workspace,writable})=>{calls++;assert.equal(writable,false);assert(!fs.existsSync(path.join(workspace,'.agents')));const data=JSON.parse(fs.readFileSync(path.join(workspace,'.asc-review.json')));assert.equal(data.ownerManagedControls[name],'Owner migration: use current project contract.');return {context:'independent-config-review',seconds:0,usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};};
 const result=await runWorkflow(f.request,{agent,provider:f.provider,reviewOnly:true});t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(result.status,'reviewed-candidate');assert.equal(calls,1);assert.equal(f.creates(),0);
});
test('review-only mode never implements empty candidates or repairs failed candidates',{skip:!enabled},async t=>{
 const f=fixture(t);let calls=0;const agent=()=>{calls++;throw Error('must not dispatch');};
 await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider,reviewOnly:true}),/existing candidate/);
 fs.writeFileSync(path.join(f.root,'code.txt'),'wrong');f.git('add','.');f.git('commit','-qm','failing candidate');
 await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider,reviewOnly:true}),/Verification/);assert.equal(calls,0);assert.equal(f.creates(),0);
});
test('review-only findings stop without granting a repair worker',{skip:!enabled},async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'code.txt'),'after');f.git('add','.');f.git('commit','-qm','candidate');let calls=0;
 const agent=async({writable})=>{assert.equal(writable,false);calls++;return {context:'config-finding',seconds:0,usage:[],answer:JSON.stringify({verdict:'fail',findings:[finding('Required newline missing')]})};};
 await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider,reviewOnly:true}));assert.equal(calls,1);assert.equal(f.creates(),0);
});


test('elapsed budget bounds a running Agent process and preserves other Issue admission',{skip:!enabled},async t=>{
 const {runBoundedProcess}=await import('../src/restricted-agent.mjs');
 const f=fixture(t);f.request.budget={maxElapsedSeconds:1};let timeout;
 await assert.rejects(runWorkflow(f.request,{provider:f.provider,agent:async options=>{
  timeout=options.timeout;
  return runBoundedProcess('/bin/sh',['-c','sleep 5'],{env:{PATH:'/usr/bin:/bin'},input:'',timeout});
 }}),e=>{assert.match(e.message,/deadline exceeded/);assert.equal(e.workflowDiagnostic.calls[0].status,'failed');return true;});
 assert(timeout>0&&timeout<=1000);assert.equal(f.creates(),0);assert.equal(f.git('rev-parse','HEAD'),f.request.base);
 const {createExecutionBudget}=await import('../src/execution-budget.mjs');assert.equal(createExecutionBudget().agentTimeout(),360000);
});


test('remaining elapsed budget stops verification without dispatch or delivery and another Issue still runs',{skip:!enabled},async t=>{
 for(const bounded of [false,...(process.env.ASC_TEST_CGROUP==='1'?[true]:[])]){
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'code.txt'),'after\n');f.git('add','.');f.git('commit','-qm','candidate');const head=f.git('rev-parse','HEAD');
  f.request.contract.testArgv=['/bin/sh','-c','sleep 5'];if(bounded)f.request.contract.verificationResourceProfile='browser-cgroup-v1';
  f.request.budget={maxElapsedSeconds:1};let calls=0;const started=performance.now();
  await assert.rejects(runWorkflow(f.request,{provider:f.provider,agent:()=>{calls++;throw Error('must not dispatch');}}),/Verification|budget exhausted|observer/);
  assert(performance.now()-started<4500,'verification consumed its five second sleep');assert.equal(calls,0);assert.equal(f.creates(),0);assert.equal(f.git('rev-parse','HEAD'),head);
 }
 const next=fixture(t);let sequence=0;
 const result=await runWorkflow(next.request,{provider:next.provider,agent:async({workspace,writable})=>{if(writable)fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');return {context:'next-issue-'+(++sequence),usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};}});
 t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(result.status,'draft-ci-passed');assert.equal(sequence,2);
});


test('fresh execution after Controller kill preserves candidate boundaries and never imports old review',{skip:!enabled},async t=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 for(const phase of ['editing','committed']){
  const f=fixture(t),control=fs.mkdtempSync(path.join(os.tmpdir(),'asc-kill-control-'));t.after(()=>fs.rmSync(control,{recursive:true,force:true}));
  const marker=path.join(control,'ready'),runRoot=path.join(control,'run-root'),driver=path.join(control,'driver.mjs');
  fs.writeFileSync(driver,`import fs from 'node:fs';import path from 'node:path';import {runWorkflow} from ${JSON.stringify(new URL('../src/workflow.mjs',import.meta.url).href)};
const stop=()=>{fs.writeFileSync(${JSON.stringify(marker)},'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
await runWorkflow(${JSON.stringify(f.request)},{submit:false,provider:{intent:()=>${JSON.stringify(f.request.contract.intent)}},onEvent:e=>{if(e.type==='run-started')fs.writeFileSync(${JSON.stringify(runRoot)},e.root);if(e.type==='work-selected'&&e.work==='verify'&&${JSON.stringify(phase)}==='committed')stop();},agent:async({workspace})=>{fs.writeFileSync(path.join(workspace,'code.txt'),'after\\n');if(${JSON.stringify(phase)}==='editing')stop();return {context:'interrupted-worker',usage:[]};}});`);
  const child=spawn(process.execPath,[driver],{stdio:'ignore'});
  try{const limit=Date.now()+5000;while(!fs.existsSync(marker)&&Date.now()<limit)await new Promise(r=>setTimeout(r,10));assert(fs.existsSync(marker),'interruption boundary not reached');const exited=once(child,'exit');child.kill('SIGKILL');await exited;}finally{child.kill('SIGKILL');}
  const candidate=f.git('rev-parse','HEAD');assert.equal(f.git('status','--porcelain'),'');assert.equal(candidate===f.request.base,phase==='editing');
  const oldRoot=fs.readFileSync(runRoot,'utf8');t.after(()=>fs.rmSync(oldRoot,{recursive:true,force:true}));assert.equal(fs.existsSync(path.join(oldRoot,'result.json')),false);
  let writes=0,reviews=0;const result=await runWorkflow(f.request,{provider:f.provider,agent:async({workspace,writable})=>{if(writable){writes++;fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');}else reviews++;return {context:'fresh-'+(writable?'worker':'reviewer'),usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};}});
  t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(result.status,'draft-ci-passed');assert.equal(writes,phase==='editing'?1:0);assert.equal(reviews,1);assert.equal(result.controllerEvents.filter(e=>e.operation==='verify').length,1);
 }
});


test('approval expiry without progress stops renewal and does not poison a fresh invocation',{skip:!enabled},async t=>{
 const {generateKeyPairSync}=await import('node:crypto');const {keyFingerprint}=await import('../src/approval.mjs');
 const f=fixture(t),owner=fs.mkdtempSync(path.join(os.tmpdir(),'asc-expiring-owner-'));t.after(()=>fs.rmSync(owner,{recursive:true,force:true}));
 Object.assign(f.request.contract,{requiresDesign:true,design:'Preserve exact fixture output'});f.request.budget={maxAgentCalls:2};
 const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}),signer=path.join(owner,'sign.mjs'),keyFile=path.join(owner,'key.pem'),audit=path.join(owner,'requests'),clockFile=path.join(owner,'clock');
 fs.writeFileSync(clockFile,String(Date.now()));
 fs.writeFileSync(keyFile,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 fs.writeFileSync(signer,`import fs from 'node:fs';import {sign} from 'node:crypto';import {approvalBytes} from ${JSON.stringify(new URL('../src/approval.mjs',import.meta.url).href)};
const input=JSON.parse(fs.readFileSync(0)),now=Number(fs.readFileSync(${JSON.stringify(clockFile)},'utf8')),payload={schema:'asc-owner-approval/v1',purpose:'design',authority:'fixture-owner',binding:input.binding,issuedAt:now,expiresAt:now+60000};
fs.appendFileSync(${JSON.stringify(audit)},'signed\\n');console.log(JSON.stringify({payload,signature:sign(null,approvalBytes(payload),fs.readFileSync(${JSON.stringify(keyFile)})).toString('base64')}));`);
 f.request.approvalCommand=[process.execPath,signer];f.request.trustedKeys=[{authority:'fixture-owner',purpose:'design',publicKey,fingerprint:keyFingerprint(publicKey)}];
 const realNow=Date.now;let offset=0,selected=0,observations=0;
 Date.now=()=>realNow()+offset;
 try{
  await assert.rejects(runWorkflow(f.request,{agent:()=>{throw Error('Agent must not start');},provider:{...f.provider,intent:()=>{
   observations++;if(observations>5)throw Error('Test sentinel: unbounded approval renewal');
   if(selected)offset+=120000;fs.writeFileSync(clockFile,String(Date.now()));return f.request.contract.intent;
  }},onEvent:e=>{if(e.type==='work-selected'&&e.work==='design-approval')selected++;}}),error=>{
   if(error.workflowDiagnostic?.root)t.after(()=>fs.rmSync(error.workflowDiagnostic.root,{recursive:true,force:true}));
   assert.match(error.message,/approval expired without workflow progress/);assert.equal(error.workflowDiagnostic.calls.length,0);return true;
  });
 }finally{Date.now=realNow;}
 assert.equal(fs.readFileSync(audit,'utf8'),'signed\n');assert.equal(f.git('rev-parse','HEAD'),f.request.base);assert.equal(f.creates(),0);
 fs.writeFileSync(clockFile,String(Date.now()));
 let contexts=0;const result=await runWorkflow(f.request,{provider:f.provider,agent:async({workspace,writable})=>{if(writable)fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');return {context:'expiry-recovery-'+(++contexts),usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};}});
 t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));assert.equal(result.status,'draft-ci-passed');assert.equal(contexts,2);assert.equal(fs.readFileSync(audit,'utf8'),'signed\nsigned\n');
});

test('successive repairs retain earlier review claims without making them approval',{skip:!enabled},async t=>{
 const f=fixture(t);f.request.maxRepairs=2;let workers=0,reviews=0;
 const agent=async({workspace,writable,prompt})=>{
  const input=writable?JSON.parse(prompt):JSON.parse(fs.readFileSync(path.join(workspace,'.asc-review.json')));
  const expected=writable?workers:reviews;
  if(expected===0){assert.equal(input.priorReviewsRef,undefined);assert.equal(fs.existsSync(path.join(workspace,'.asc-prior-reviews.json')),false);}
  else{
   assert.equal(input.priorReviewsRef,'.asc-prior-reviews.json');
   const history=JSON.parse(fs.readFileSync(path.join(workspace,input.priorReviewsRef)));
   assert.match(history.authority,/not approval/);assert.equal(history.assessments.length,expected);
   assert.equal(history.assessments[0].findings[0].condition,'Preserve newline fix');
   assert(history.assessments.every(a=>a.target.head&&a.target.contract));
   if(expected===2)assert.equal(history.assessments[1].findings[0].condition,'Preserve design boundary');
  }
  if(writable){workers++;fs.writeFileSync(path.join(workspace,'code.txt'),workers===1?'after':workers===2?'after\n':'after\n\n');return {context:'history-worker-'+workers,usage:[],seconds:0};}
  reviews++;return {context:'history-reviewer-'+reviews,usage:[],seconds:0,answer:JSON.stringify({verdict:reviews<3?'fail':'pass',findings:reviews<3?[finding(reviews===1?'Preserve newline fix':'Preserve design boundary')]:[]})};
 };
 const r=await runWorkflow(f.request,{agent,provider:f.provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));
 assert.equal(r.status,'draft-ci-passed');assert.equal(r.repairs,2);assert.equal(reviews,3);assert.equal(f.creates(),1);
 assert.equal(fs.existsSync(path.join(f.root,'.asc-prior-reviews.json')),false);
 assert.equal(f.git('diff','--name-only',f.request.base),'code.txt');
});

test('repair cannot rewrite historical review context',{skip:!enabled},async t=>{
 const f=fixture(t);let workers=0;
 const agent=async({workspace,writable,prompt})=>{
  if(writable){workers++;const input=JSON.parse(prompt);fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');if(workers===2)fs.writeFileSync(path.join(workspace,input.priorReviewsRef),'forged approval');return {context:'tamper-worker-'+workers,usage:[],seconds:0};}
  return {context:'tamper-reviewer',usage:[],seconds:0,answer:JSON.stringify({verdict:'fail',findings:[finding('Requires repair')]})};
 };
 await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider}),/Read-only context was modified/);
 assert.equal(f.creates(),0);assert.equal(fs.existsSync(path.join(f.root,'.asc-prior-reviews.json')),false);
});


test('uncreated allowed path cannot capture host review diagnostics',{skip:!enabled},async t=>{
 const f=fixture(t);f.request.contract.allowedPaths.push('.asc-prior-reviews.json');let workers=0;
 const agent=async({workspace,writable})=>{
  if(writable){workers++;fs.writeFileSync(path.join(workspace,'code.txt'),'after');return {context:'collision-worker',usage:[],seconds:0};}
  return {context:'collision-reviewer',usage:[],seconds:0,answer:JSON.stringify({verdict:'fail',findings:[finding('Required newline missing')]})};
 };
 await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider}),/Reserved prior-review context path is allowed/);
 assert.equal(workers,1);assert.equal(f.creates(),0);assert.equal(fs.existsSync(path.join(f.root,'.asc-prior-reviews.json')),false);
 assert.equal(f.git('diff','--name-only',f.request.base),'code.txt');
});

test('pre-delivery review approval cannot waive actual Draft and CI checks',{skip:!enabled},async t=>{
 for(const observed of [{draft:false},{merged:true},{checks:{test:'failure'}}]){
  const f=fixture(t);let reviews=0,runRoot;
  const observe=f.provider.observe;f.provider.observe=()=>({...observe(),...observed});
  const agent=async({workspace,writable,prompt})=>{
   if(writable){fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');return {context:'implementation',seconds:0,usage:[]};}
   reviews++;assert.equal(f.creates(),0);
   assert(prompt.includes('This review precedes controlled Delivery'));
   assert(prompt.includes('Missing future PR/CI observations alone are not a candidate defect'));
   return {context:'reviewer',seconds:0,usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};
  };
  await assert.rejects(runWorkflow(f.request,{agent,provider:f.provider,onEvent:e=>{if(e.type==='run-started')runRoot=e.root;}}),/Remote PR\/CI not bound/);
  t.after(()=>fs.rmSync(runRoot,{recursive:true,force:true}));assert.equal(reviews,1);assert.equal(f.creates(),1);
  const result=JSON.parse(fs.readFileSync(path.join(runRoot,'result.json')));assert.equal(result.status,'blocked');
 }
});

test('review receives exact plain Git diff without JSON duplication',{skip:!enabled},async t=>{
 const f=fixture(t);let reviews=0;
 const agent=async({workspace,writable,prompt})=>{
  if(writable){fs.writeFileSync(path.join(workspace,'code.txt'),'after\n');return {context:'plain-diff-worker',seconds:0,usage:[]};}
  reviews++;
  const meta=JSON.parse(fs.readFileSync(path.join(workspace,'.asc-review.json')));
  assert.equal(meta.diff,undefined);assert.equal(meta.diffRef,'.asc-review.diff');
  const actual=fs.readFileSync(path.join(workspace,meta.diffRef),'utf8');
  const expected=execFileSync('git',['diff','--no-ext-diff','--no-textconv',f.request.base,meta.target.head],{cwd:f.root,encoding:'utf8'});
  assert.equal(actual,expected);assert.match(actual,/\+after/);assert.equal(meta.contract.intent,f.request.contract.intent);
  assert.match(prompt,/diffRef first/);
  return {context:'plain-diff-reviewer',seconds:0,usage:[],answer:JSON.stringify({verdict:'pass',findings:[]})};
 };
 const result=await runWorkflow(f.request,{agent,provider:f.provider});t.after(()=>fs.rmSync(result.root,{recursive:true,force:true}));
 assert.equal(result.status,'draft-ci-passed');assert.equal(reviews,1);
});
