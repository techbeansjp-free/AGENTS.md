import {hostExecution} from './host-execution.mjs';
import {performance} from 'node:perf_hooks';
import {createExecutionBudget} from './execution-budget.mjs';
import {runUnitThread} from './unit-thread.mjs';
import {importUnitCandidate,candidateMatchesContract} from './unit-candidate.mjs';
import {authorityCommandValidator} from './authority-command.mjs';
/** Bounded owner-supplied Goal execution. No imported approval/review receipts. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {compileGoal} from './goal-plan.mjs';import {AssetController} from './verification-assets.mjs';import {hash,digest,safeName} from './controller.mjs';
import {cloneSource} from './migration.mjs';import {commitCandidate} from './candidate.mjs';import {runWorkflow} from './workflow.mjs';import {runAgent} from './restricted-agent.mjs';import {Github} from './github.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
// A single unit needs no integration copy when it has the same execution authority.
// Keep all semantic obligations and verification commands in one fresh contract.
export function singleUnitContract(request,plan){
 if(plan.units.length!==1)return null;
 const unit=plan.units[0],spec=request.unitRequests[unit.id],parent=request.contract;
 if(unit.dependsOn.length||Object.keys(spec).some(k=>k!=='contract'))return null;
 const child=spec.contract;
 // An invalidated candidate supplies neither bytes nor authority. Keep valid
 // reusable candidates on the existing import and independent integration path.
 const reference=request.unitCandidates?.[unit.id];
 if(reference&&candidateMatchesContract(reference,child))return null;
 const policy=contract=>Object.fromEntries(Object.entries(contract).filter(([key])=>!['intent','criteria','testArgv','riskTestArgv'].includes(key)));
 if(digest(policy(parent))!==digest(policy(child)))return null;
 if(Object.keys(unit.contracts).some(name=>parent.allowedPaths.includes(request.contractFiles?.[name]?.path)))return null;
 const checks=[...parent.riskTestArgv],seen=new Set([parent.testArgv,...checks].map(digest));
 for(const argv of [child.testArgv,...child.riskTestArgv])if(!seen.has(digest(argv))){seen.add(digest(argv));checks.push(argv);}
 return {...parent,criteria:[...new Set([...parent.criteria,...(child.intent===parent.intent?[]:['Work Unit intent: '+child.intent]),...child.criteria])],riskTestArgv:checks};
}
export async function runGoal(input,{agent=runAgent,provider,onEvent=()=>{},executionBudget,priorContexts=[],authorityRoots=[]}={}){
 const request=structuredClone(input),compiled=compileGoal(request.goal);
 const budget=executionBudget??createExecutionBudget(request.budget);budget.check();
 demand(compiled.plan.intent===request.contract?.intent,'Goal and owner contract intent differ');
 const parallel=request.parallelism??2;demand(Number.isSafeInteger(parallel)&&parallel>0&&parallel<=4,'Parallelism must be 1..4');
 const host=hostExecution(new AssetController({...request,implementer:'host-selection'}),request.hostExecution,authorityRoots);if(host&&agent===runAgent)agent=host.agent;
 const threadedUnits=agent===runAgent&&provider===undefined;
 demand(agent!==runAgent||provider===undefined||parallel===1,'Parallel live units require isolated default provider');
 const c=new AssetController({...request,implementer:'goal-not-yet-implemented'});c.assertContract();
 const allWrites=new Set(compiled.plan.units.flatMap(u=>u.writePaths));demand([...allWrites].every(p=>c.contract.allowedPaths.includes(p)),'Unit scope exceeds Goal authority');
 const units=new Map(compiled.plan.units.map(u=>[u.id,u]));
 demand(!request.unitCandidates||(typeof request.unitCandidates==='object'&&!Array.isArray(request.unitCandidates)&&Object.keys(request.unitCandidates).every(id=>units.has(id))),'Unknown candidate unit');
 const assertAuthority=authorityCommandValidator(c);
 assertAuthority(request.approvalCommand);
 assertAuthority(request.hostExecution?.command);
 for(const u of units.values()){
  const specification=request.unitRequests?.[u.id];demand(specification?.contract,'Owner unit contract missing');
  assertAuthority(specification.approvalCommand??request.approvalCommand);
  demand(specification.hostExecution===undefined||digest(specification.hostExecution)===digest(request.hostExecution??null),'Unit Host execution authority differs from Goal');
  demand(specification.budget===undefined,'Configure execution budget on the Goal, not individual units');
  const uc=specification.contract;
  demand(uc.intent===u.intent&&digest(uc.criteria)===digest(u.criteria)&&digest([...uc.allowedPaths].sort())===digest([...u.writePaths].sort()),'Unit contract does not match plan');
  demand(digest(uc.verificationLimits??null)===digest(c.contract.verificationLimits??null)&&uc.verificationResourceProfile===c.contract.verificationResourceProfile&&uc.verificationGit===c.contract.verificationGit&&uc.policyRevision===c.contract.policyRevision&&digest(uc.verificationAssets??null)===digest(c.contract.verificationAssets??null),'Unit verification policy differs');
  demand(c.contract.risks.every(r=>uc.risks?.includes(r)),'Unit cannot silently remove Goal risk');
  demand(digest(uc.policyRefs??[])===digest(c.contract.policyRefs??[]),'Unit cannot remove or replace owner policy references');
  if(uc.requiresDesign||uc.risks?.length){
   const effective={...request,...specification};
   const keySet=keys=>[...new Set((keys??[]).map(digest))].sort();
   demand(Array.isArray(request.approvalCommand)&&request.approvalCommand.length&&
    digest(effective.approvalCommand??null)===digest(request.approvalCommand)&&
    digest(keySet(effective.trustedKeys))===digest(keySet(request.trustedKeys)),
    'Unit design authority differs from Goal; explicit integrated owner approval required');
  }
 }
 budget.check();
 if(c.needsDesign()){
  const argv=request.approvalCommand;demand(Array.isArray(argv)&&argv.length&&argv.every(x=>typeof x==='string')&&path.isAbsolute(argv[0]),'Goal owner approval required');
  demand(!fs.realpathSync(argv[0]).startsWith(c.repo+path.sep),'Candidate cannot supply Goal authority');
  const result=spawnSync(argv[0],argv.slice(1),{input:JSON.stringify({purpose:'design',contract:c.contract,binding:c.binding()}),encoding:'utf8',timeout:60000,maxBuffer:65536});
  demand(!result.error&&result.status===0,'Goal owner approval unavailable');budget.check();c.approveDesign(JSON.parse(result.stdout));
 }
 const remote=provider??new Github({...request.delivery,repo:c.repo,base:c.base});
 const checkIntent=async()=>demand(await remote.intent()===c.contract.intent,'Primary Goal intent changed');
 const checkContracts=()=>{
  const blobs=c.blobs(c.target({allowEmpty:true}).head);
  for(const unit of units.values())for(const [name,pin] of Object.entries(unit.contracts)){
   const ref=request.contractFiles?.[name];demand(ref&&typeof ref.path==='string','Missing shared contract reference');safeName(ref.path);
   demand(blobs.has(ref.path)&&hash(blobs.get(ref.path).bytes)===pin,'Shared contract changed; replan required');
   demand(unit.readPaths.includes(ref.path)||unit.writePaths.includes(ref.path),'Shared contract absent from unit scope');
  }
 };
 // Bind provider methods to their original receiver. Check immutable shared
   // contracts whenever workflow checks Intent, including before Delivery.
   const checkedRemote=new Proxy(remote,{get(target,key){
    if(key==='intent')return async()=>{await checkIntent();checkContracts();return c.contract.intent;};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
   }});
 await checkIntent();checkContracts();
 const initial=c.target({allowEmpty:true});demand(initial.head===c.base,'Goal execution requires clean starting HEAD; no receipt-based resume');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-goal-')),results=[],events=[],contexts=new Set(priorContexts),started=performance.now();
 for(const directory of ['units','imports','integrations'])fs.mkdirSync(path.join(root,directory));
 const emit=(type,data={})=>{const event={type,seconds:(performance.now()-started)/1000,...data};events.push(event);onEvent(event);};
 const freshAgent=async options=>{const result=await agent(options);demand(typeof result.context==='string'&&!contexts.has(result.context),'Goal requires fresh Agent contexts');contexts.add(result.context);return result;};
 const save=data=>{const result={...data,budget:budget.snapshot(),root,planDigest:compiled.digest,units:results,events,wallSeconds:(performance.now()-started)/1000,allAgentTotalTokens:null};fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));return result;};
 try{
  emit('goal-started',{base:c.base,root});
  const combined=singleUnitContract(request,compiled.plan);
  if(combined){
   const unit=compiled.plan.units[0];
   new AssetController({...request,contract:request.unitRequests[unit.id].contract,implementer:'unit-contract-validation'}).assertContract();
   if(request.unitCandidates?.[unit.id])emit('unit-candidate',{id:unit.id,status:'invalidated',reason:'unit-contract-changed'});
   emit('single-unit-execution',{id:unit.id,contract:digest(combined)});
   const record={id:unit.id,repo:c.repo,mode:'combined-goal-contract'};results.push(record);
   let delivery;
   try{delivery=await runWorkflow({...request,contract:combined,priorReviews:request.unitCandidates?.[unit.id]?.priorReviews},{executionBudget:budget,hostVerification:host?.verify,authorityRoots,agent:freshAgent,provider:checkedRemote,onEvent:event=>{if(event.type==='run-started')record.workflowRoot=event.root;emit('single-unit-event',{id:unit.id,event});}});}
   catch(error){record.diagnostic=error.workflowDiagnostic;throw error;}
   finally{
    // Candidate bytes only: observe current Git, never export review/approval authority.
    // Preserve the original failure if a dirty or out-of-scope candidate cannot be observed.
    try{const target=c.target({allowEmpty:true});if(target.head!==c.base)record.candidate={base:target.base,head:target.head,contractDigest:digest(request.unitRequests[unit.id].contract)};}
    catch(error){record.candidateObservationError=String(error);}
   }
   demand(delivery.status==='draft-ci-passed','Goal delivery incomplete');
   record.target=delivery.target;
   return save({status:'draft-ci-passed',delivery});
  }

  for(const batch of compiled.batches)for(let offset=0;offset<batch.length;offset+=parallel){
   budget.check();const group=batch.slice(offset,offset+parallel);await checkIntent();checkContracts();
   const before=c.target({allowEmpty:true});emit('batch-started',{units:group,head:before.head});
   const executions=await Promise.allSettled(group.map(async id=>{
    const candidate=cloneSource(c.repo,path.join(root,'units',id),before.head),spec=request.unitRequests[id];
    const candidateReuse=request.unitCandidates?.[id]&&(spec.contract.requiresDesign||spec.contract.risks?.length)?{reference:request.unitCandidates[id],unit:units.get(id)}:undefined;
    if(request.unitCandidates?.[id]&&!candidateReuse){
     const imported=importUnitCandidate({reference:request.unitCandidates[id],unit:units.get(id),contract:spec.contract,candidate,base:before.head,workspace:path.join(root,'imports',id),commitIdentity:request.commitIdentity});
     emit('unit-candidate',{id,...imported});
    }
    const unitRequest={...request,...spec,repo:candidate,base:before.head,priorReviews:request.unitCandidates?.[id]?.priorReviews};
    // Explain an owner-compiled partial assignment; this never waives whole-Goal gates.
    const unitAssignment={planDigest:compiled.digest,goalIntent:c.contract.intent,deliveryAllowed:false,
     current:units.get(id),units:compiled.plan.units.map(u=>({id:u.id,intent:u.intent,criteria:u.criteria,dependsOn:u.dependsOn,writePaths:u.writePaths,
      status:u.id===id?'current':results.some(r=>r.id===u.id&&r.result?.status==='reviewed-candidate')?'integrated':'pending'}))};
    const result=threadedUnits
     ?await runUnitThread(unitRequest,c.contract.intent,event=>emit('unit-event',{id,event}),budget.shared,unitAssignment,candidateReuse)
     :await runWorkflow(unitRequest,{submit:false,unitAssignment,candidateReuse,executionBudget:budget,hostVerification:host?.verify,authorityRoots,agent:freshAgent,onEvent:event=>emit('unit-event',{id,event}),provider:{intent:async()=>{await checkIntent();return units.get(id).intent;}}});
    if(threadedUnits)for(const call of result.calls??[]){demand(typeof call.context==='string'&&!contexts.has(call.context),'Goal requires fresh Agent contexts');contexts.add(call.context);}
    if(result.status!=='reviewed-candidate'){const failure=Error('Unit did not satisfy its obligations: '+id);failure.workflowDiagnostic=result;throw failure;}
    return {id,repo:candidate,result};
   }));
   for(let index=0;index<executions.length;index++){
    const outcome=executions[index];
    if(outcome.status==='fulfilled'){results.push(outcome.value);continue;}
    const id=group[index],repo=path.join(root,'units',id);
    const record={id,repo,error:String(outcome.reason),diagnostic:outcome.reason?.workflowDiagnostic??null};
    // A failed verification/review is not authority, but its clean in-scope Git
    // output remains useful for a later fresh repair. Never hide the failure.
    try{
     const observer=new AssetController({...request.unitRequests[id],repo,base:before.head,implementer:'failed-unit-observation'});
     const target=observer.target({allowEmpty:true});
     if(target.head!==before.head)record.candidate={base:target.base,head:target.head,contractDigest:target.contract};
    }catch(error){record.candidateObservationError=String(error);}
    results.push(record);
   }
   demand(executions.every(r=>r.status==='fulfilled'),'Unit failed; batch not integrated');
   budget.check();await checkIntent();budget.check();demand(digest(c.target({allowEmpty:true}))===digest(before),'Integration HEAD changed during work');
   const combined=path.join(root,'integrations',String(results.length));fs.mkdirSync(combined);
   const merged=c.blobs(before.head);
   for(const outcome of executions){
    const {id,repo,result}=outcome.value,spec=request.unitRequests[id];
    // Result was produced in this invocation. Reobserve exact Git bytes; never consume a saved receipt.
    const uc=new AssetController({...spec,repo,base:before.head,implementer:'unit-observation'});
    const current=uc.git('rev-parse','HEAD').toString().trim();demand(current===result.target.head,'Unit HEAD changed after review');
    const blobs=uc.blobs(current),changed=uc.git('diff','--no-ext-diff','--no-textconv','--name-only','-z',before.head,current).toString().split('\0').filter(Boolean);
    demand(changed.length&&changed.every(name=>units.get(id).writePaths.includes(name)),'Unit integration scope mismatch');
    for(const name of changed){if(blobs.has(name))merged.set(name,blobs.get(name));else merged.delete(name);}
   }
   for(const [name,blob] of merged){const file=path.join(combined,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,blob.bytes,{flag:'wx',mode:blob.mode==='100755'?0o755:0o644});}
   const target=commitCandidate(c,combined,request.commitIdentity);emit('batch-integrated',{units:group,head:target.head});checkContracts();
  }
  budget.check();await checkIntent();emit('integration-verification');
  // New controller: unit verification/reviews do not satisfy whole-Goal gates.
  // Unit checks remain obligations after integration and every final repair.
  // Deduplicate identical argv only; the parent check is never removed.
  const checks=[...request.contract.riskTestArgv],seen=new Set([request.contract.testArgv,...checks].map(digest));
  for(const argv of compiled.plan.units.flatMap(u=>{const contract=request.unitRequests[u.id].contract;return [contract.testArgv,...contract.riskTestArgv];})){
   const key=digest(argv);if(!seen.has(key)){seen.add(key);checks.push(argv);}
  }
  // Whole-Goal repair and review must preserve child semantics, not only tests.
  const criteria=[...new Set([...request.contract.criteria,...compiled.plan.units.flatMap(u=>[...(u.intent===request.contract.intent?[]:['Work Unit intent: '+u.intent]),...u.criteria])])];
  const childContracts=compiled.plan.units.map(u=>request.unitRequests[u.id].contract);
  const risks=[...new Set([...request.contract.risks,...childContracts.flatMap(c=>c.risks)])];
  const requiresDesign=request.contract.requiresDesign||childContracts.some(c=>c.requiresDesign);
  const designs=[request.contract.design].filter(Boolean);
  for(const unit of compiled.plan.units){const child=request.unitRequests[unit.id].contract;
   if((child.requiresDesign||child.risks.length)&&child.design!==request.contract.design)
    designs.push(`Work Unit ${unit.id} (${unit.intent}):\n${child.design}`);
  }
  // A risk check identical to the parent test is still an explicit risk obligation.
  if(risks.length&&!checks.length)checks.push(request.contract.testArgv);
  const finalRequest={...request,contract:{...request.contract,criteria,risks,requiresDesign,design:designs.join('\n\n'),riskTestArgv:checks}};
  const delivery=await runWorkflow(finalRequest,{executionBudget:budget,hostVerification:host?.verify,authorityRoots,agent:freshAgent,provider:checkedRemote,onEvent:e=>emit('integration-event',{event:e})});
  demand(delivery.status==='draft-ci-passed','Goal delivery incomplete');return save({status:'draft-ci-passed',delivery});
 }catch(error){emit('blocked',{error:String(error)});error.goalDiagnostic=save({status:'blocked',error:String(error),diagnostic:error.workflowDiagnostic??null});throw error;}
}
