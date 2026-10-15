/** Explicit owner delegation, composed from the existing proposal and Goal runners. */
import fs from 'node:fs';import path from 'node:path';
import {Controller,digest,hash,safeName} from './controller.mjs';
import {proposeGoal,validateProposal} from './goal-propose.mjs';
import {runGoal} from './goal-run.mjs';import {createExecutionBudget} from './execution-budget.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
export function validateDelegation(request){
 const policy=request.decomposition;
 demand(policy?.mode==='within-owner-contract','Explicit owner decomposition delegation required');
 demand(!request.goal&&!request.unitRequests&&!request.unitCandidates,'Delegation cannot override an existing unit plan');
 if(policy.unitTestArgv!==undefined)demand(Array.isArray(policy.unitTestArgv)&&policy.unitTestArgv.length>0&&policy.unitTestArgv.every(v=>typeof v==='string'&&v&&!v.includes('\0')),'Explicit owner unit baseline command required');
 demand(Array.isArray(policy.unitChecks)&&policy.unitChecks.length>0&&policy.unitChecks.length<=64,'Owner unit verification rules required');
 for(const rule of policy.unitChecks){
  demand(Array.isArray(rule.paths)&&rule.paths.length>0&&rule.paths.every(p=>request.contract.allowedPaths.includes(p)),'Verification rule exceeds owner scope');rule.paths.forEach(safeName);
  demand(Array.isArray(rule.argvs)&&rule.argvs.length>0&&rule.argvs.every(a=>Array.isArray(a)&&a.length&&a.every(v=>typeof v==='string'&&v&&!v.includes('\0'))),'Explicit owner verification commands required');
 }
 demand(request.contract.allowedPaths.every(p=>policy.unitChecks.some(r=>r.paths.includes(p))),'Owner unit verification coverage missing');
}
export function adoptProposal(request,proposal){
 validateDelegation(request);
 const c=new Controller({...request,implementer:'proposal-adoption'});c.assertContract();const head=c.observeSource(),blobs=c.blobs(head),pins={};
 demand(head===c.base&&proposal.binding?.head===head&&proposal.binding.contract===digest(request.contract)&&proposal.binding.contractFiles===digest(request.contractFiles??{}),'Stale proposal binding');
 for(const [name,ref] of Object.entries(request.contractFiles??{})){safeName(ref.path);demand(blobs.has(ref.path),'Missing shared contract');pins[name]=hash(blobs.get(ref.path).bytes);}
 const checked=validateProposal(proposal,request.contract,pins);demand(checked.status==='proposed','Unresolved proposal cannot execute');
 const unitRequests=Object.fromEntries(checked.goal.units.map(u=>{
  const selected=request.decomposition.unitChecks.filter(r=>r.paths.some(p=>u.writePaths.includes(p)));
  const commands=[...new Map(selected.flatMap(r=>r.argvs).map(a=>[JSON.stringify(a),a])).values()];
  // No Agent-supplied executable, authority, risk exemption, assets or Delivery setting.
  return [u.id,{contract:{...structuredClone(request.contract),intent:u.intent,criteria:u.criteria,allowedPaths:u.writePaths,testArgv:structuredClone(request.decomposition.unitTestArgv??request.contract.testArgv),riskTestArgv:commands}}];
 }));
 return {...structuredClone(request),goal:checked.goal,unitRequests};
}
export async function runAdaptive(input,options={}){
 const request=structuredClone(input);validateDelegation(request);
 const c=new Controller({...request,implementer:'delegation-preflight'});c.assertContract();demand(c.observeSource()===c.base,'Delegation requires starting HEAD');
 const budget=options.executionBudget??createExecutionBudget(request.budget),started=performance.now();
 let proposal;
 try{proposal=await proposeGoal(request,{agent:options.agent,executionBudget:budget});}
 catch(error){if(error.proposalDiagnostic){const p=error.proposalDiagnostic;error.goalDiagnostic={status:'blocked',root:p.root,units:[],proposal:p,error:String(error),budget:budget.snapshot(),wallSeconds:(performance.now()-started)/1000,allAgentTotalTokens:null};}throw error;}
 if(proposal.status==='needs-owner')return {...proposal,status:'owner-work-required',work:{work:'clarify',actor:'owner',questions:proposal.questions},wallSeconds:(performance.now()-started)/1000};
 const save=result=>{const output={...result,proposal,wallSeconds:(performance.now()-started)/1000,budget:budget.snapshot(),adoption:'owner-delegated scope and verification policy; not model approval'};fs.writeFileSync(path.join(result.root,'result.json'),JSON.stringify(output,null,2));return output;};
 try{
  const adopted=adoptProposal(request,proposal);
  const contexts=proposal.calls.map(call=>call.context);demand(contexts.every(c=>typeof c==='string'&&c),'Proposal context missing');
  return save(await runGoal(adopted,{...options,executionBudget:budget,priorContexts:contexts}));
 }catch(error){error.goalDiagnostic=save(error.goalDiagnostic??{status:'blocked',root:proposal.root,units:[],error:String(error)});throw error;}
}
