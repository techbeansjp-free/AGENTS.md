import {performance} from 'node:perf_hooks';
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
 // Without owner rules, the planner selects Unit checks from verificationCatalog; the Goal checks stay fixed.
 if(policy.unitChecks===undefined)return;
 demand(Array.isArray(policy.unitChecks)&&policy.unitChecks.length>0,'Owner unit verification rules required');
 for(const rule of policy.unitChecks){
  demand(Array.isArray(rule.paths)&&rule.paths.length>0&&rule.paths.every(p=>request.contract.allowedPaths.includes(p)),'Verification rule exceeds owner scope');rule.paths.forEach(safeName);
  demand(Array.isArray(rule.argvs)&&rule.argvs.length>0&&rule.argvs.every(a=>Array.isArray(a)&&a.length&&a.every(v=>typeof v==='string'&&v&&!v.includes('\0'))),'Explicit owner verification commands required');
 }
 demand(request.contract.allowedPaths.every(p=>policy.unitChecks.some(r=>r.paths.includes(p))),'Owner unit verification coverage missing');
}
const PACKAGE_MANAGERS=new Set(['npm','pnpm','yarn']),CHECK_SCRIPT=/^(?:test|lint|check|typecheck|types|verify|quality)(?:[:._-][A-Za-z0-9:._-]+)?$/;
// Name parts that suggest writing, publishing or installing; such scripts never enter the catalog.
const MUTATING_PART=new Set(['fix','autofix','update','write','deploy','publish','release','upload','push','format','fmt','clean','install','snapshot','watch','u','w']);
const checkScript=name=>CHECK_SCRIPT.test(name)&&!name.toLowerCase().split(/[:._-]/).some(part=>MUTATING_PART.has(part));
/**
 * Commands a planner may select for a Unit. Built by the Controller from the owner contract and
 * the observed base package scripts; the planner names entries and never supplies argv.
 */
export function verificationCatalog(contract,blobs){
 const entries=new Map(),add=(id,argv)=>{const key=JSON.stringify(argv);if(![...entries.values()].some(e=>JSON.stringify(e.argv)===key))entries.set(id,{id,argv:structuredClone(argv)});};
 add('contract-test',contract.testArgv);contract.riskTestArgv.forEach((argv,i)=>add('contract-risk-'+(i+1),argv));
 const manager=contract.testArgv[0];
 if(PACKAGE_MANAGERS.has(path.basename(manager))&&blobs.has('package.json')){
  let scripts;try{scripts=JSON.parse(blobs.get('package.json').bytes.toString('utf8')).scripts;}catch{scripts=undefined;}
  if(scripts&&typeof scripts==='object'&&!Array.isArray(scripts))for(const name of Object.keys(scripts).sort())if(checkScript(name)&&typeof scripts[name]==='string')add('script:'+name,[manager,'run',name]);
 }
 return [...entries.values()];
}
/** Controller catalog for a delegation without owner Unit rules, from the request's observed base. */
export function delegationCatalog(request){
 if(request.decomposition?.unitChecks!==undefined)return undefined;
 const c=new Controller({...request,implementer:'verification-catalog'});c.assertContract();
 return verificationCatalog(request.contract,c.blobs(c.observeSource()));
}
// Without a selection the Unit uses the owner baseline when given, otherwise the whole-Goal test.
const selected=(selection,id,baseline)=>Object.hasOwn(selection,id)?selection[id]:baseline?[]:['contract-test'];
function unitVerification(request,unit,catalog,selection){
 const policy=request.decomposition;
 if(!catalog){
  // Owner rules keep their existing meaning: the selected argvs are the Unit risk checks.
  const commands=[...new Map(policy.unitChecks.filter(r=>r.paths.some(p=>unit.writePaths.includes(p))).flatMap(r=>r.argvs).map(a=>[JSON.stringify(a),a])).values()];
  return {testArgv:structuredClone(policy.unitTestArgv??request.contract.testArgv),riskTestArgv:structuredClone(commands)};
 }
 const byId=new Map(catalog.map(e=>[e.id,e.argv])),commands=selected(selection,unit.id,policy.unitTestArgv).map(id=>byId.get(id));
 const testArgv=structuredClone(policy.unitTestArgv??commands[0]);
 let riskTestArgv=commands.filter(a=>JSON.stringify(a)!==JSON.stringify(testArgv));
 // A Unit with declared risks still needs a risk check; repeat the baseline rather than drop the obligation.
 if(request.contract.risks.length&&!riskTestArgv.length)riskTestArgv=[testArgv];
 return {testArgv,riskTestArgv:structuredClone(riskTestArgv)};
}
export function adoptProposal(request,proposal){
 validateDelegation(request);
 const c=new Controller({...request,implementer:'proposal-adoption'});c.assertContract();const head=c.observeSource(),blobs=c.blobs(head),pins={};
 demand(head===c.base&&proposal.binding?.head===head&&proposal.binding.contract===digest(request.contract)&&proposal.binding.contractFiles===digest(request.contractFiles??{}),'Stale proposal binding');
 for(const [name,ref] of Object.entries(request.contractFiles??{})){safeName(ref.path);demand(blobs.has(ref.path),'Missing shared contract');pins[name]=hash(blobs.get(ref.path).bytes);}
 // The catalog is rebuilt from the observed base, never taken from the proposal.
 const catalog=request.decomposition.unitChecks===undefined?verificationCatalog(request.contract,blobs):undefined;
 const checked=validateProposal(proposal,request.contract,pins,catalog);demand(checked.status==='proposed','Unresolved proposal cannot execute');
 const unitRequests=Object.fromEntries(checked.goal.units.map(u=>{
  const {testArgv,riskTestArgv}=unitVerification(request,u,catalog,checked.verification??{});
  // No Agent-supplied executable, authority, risk exemption, assets or Delivery setting.
  return [u.id,{contract:{...structuredClone(request.contract),intent:u.intent,criteria:u.criteria,allowedPaths:u.writePaths,testArgv,riskTestArgv}}];
 }));
 const adopted={...structuredClone(request),goal:checked.goal,unitRequests};
 // Record the provenance explicitly; runGoal never infers it from the request shape.
 if(catalog)adopted.unitVerificationSource='controller-catalog';else delete adopted.unitVerificationSource;
 // The Units whose checks the planner selected (#1733). Only these answer unitChecksSufficient and get the whole-Goal
 // fallback; an unselected Unit runs its default (contract-test or the owner unitTestArgv), which is not planner-written.
 if(catalog)adopted.plannerSelectedUnits=checked.goal.units.map(u=>u.id).filter(id=>Object.hasOwn(checked.verification??{},id));else delete adopted.plannerSelectedUnits;
 return adopted;
}
export const adoptionNote=catalog=>catalog?'owner-delegated scope; Unit checks selected by the planner from the Controller catalog; whole-Goal verification unchanged; not model approval':'owner-delegated scope and verification policy; not model approval';
/** Per-Unit record of the adopted Unit checks for result.json. */
export function unitVerificationReport(adopted,proposal){
 const catalog=adopted.unitVerificationSource==='controller-catalog',selection=proposal?.verification??{};
 return Object.fromEntries(adopted.goal.units.map(u=>[u.id,{source:catalog?(Object.hasOwn(selection,u.id)?'proposal':'default'):'owner',testArgv:adopted.unitRequests[u.id].contract.testArgv,riskTestArgv:adopted.unitRequests[u.id].contract.riskTestArgv}]));
}
export async function runAdaptive(input,options={}){
 const request=structuredClone(input);validateDelegation(request);
 const c=new Controller({...request,implementer:'delegation-preflight'});c.assertContract();demand(c.observeSource()===c.base,'Delegation requires starting HEAD');
 const budget=options.executionBudget??createExecutionBudget(request.budget),started=performance.now();
 let proposal;
 const verificationCatalogEntries=delegationCatalog(request);
 try{proposal=await proposeGoal(request,{agent:options.agent,executionBudget:budget,authorityRoots:options.authorityRoots,verificationCatalog:verificationCatalogEntries});}
 catch(error){if(error.proposalDiagnostic){const p=error.proposalDiagnostic;error.goalDiagnostic={status:'blocked',root:p.root,units:[],proposal:p,error:String(error),budget:budget.snapshot(),wallSeconds:(performance.now()-started)/1000,allAgentTotalTokens:null};}throw error;}
 if(proposal.status==='needs-owner')return {...proposal,status:'owner-work-required',work:{work:'clarify',actor:'owner',questions:proposal.questions},wallSeconds:(performance.now()-started)/1000};
 let unitVerificationRecord;
 const save=result=>{const output={...result,proposal,...(unitVerificationRecord?{unitVerification:unitVerificationRecord}:{}),wallSeconds:(performance.now()-started)/1000,budget:budget.snapshot(),adoption:adoptionNote(!!verificationCatalogEntries)};fs.writeFileSync(path.join(result.root,'result.json'),JSON.stringify(output,null,2));return output;};
 try{
  const adopted=adoptProposal(request,proposal);
  unitVerificationRecord=unitVerificationReport(adopted,proposal);
  const contexts=proposal.calls.filter(call=>!(call.status==='failed'&&call.code==='ASC_PROVIDER_CAPACITY'&&call.context===null)).map(call=>call.context);demand(contexts.every(c=>typeof c==='string'&&c),'Proposal context missing');
  return save(await runGoal(adopted,{...options,executionBudget:budget,priorContexts:contexts}));
 }catch(error){error.goalDiagnostic=save(error.goalDiagnostic??{status:'blocked',root:proposal.root,units:[],error:String(error)});throw error;}
}
