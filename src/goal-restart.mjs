import {performance} from 'node:perf_hooks';
import {reviewDiagnostics} from './review-result.mjs';
/** Restart in a new owner-selected clone. Old results select candidate bytes only. */
import fs from 'node:fs';import path from 'node:path';
import {createExecutionBudget} from './execution-budget.mjs';
import {authorityCommandRootsValidator} from './authority-command.mjs';
import {Controller,digest} from './controller.mjs';import {cloneSource} from './migration.mjs';
import {proposeGoal} from './goal-propose.mjs';
import {compileGoal} from './goal-plan.mjs';import {adoptProposal,validateDelegation} from './adaptive-run.mjs';import {runGoal} from './goal-run.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
function candidateReferences(previous,plan){
 const ids=new Set(plan.units.map(u=>u.id)),candidates={};
 for(const unit of previous.units){
  if(!ids.has(unit.id)||typeof unit.repo!=='string')continue;
  const target=unit.result?.target;
  const candidate=target?{base:target.base,head:target.head,contractDigest:target.contract}:unit.candidate;
  if(candidate){
   const nested=(Array.isArray(previous.events)?previous.events:[]).filter(e=>e?.id===unit.id&&['unit-event','single-unit-event'].includes(e.type)).map(e=>e.event);
   const local=unit.result?.events??unit.diagnostic?.events;
   const inherited=unit.result?.priorReviews??unit.diagnostic?.priorReviews;
   const priorReviews=reviewDiagnostics([...(Array.isArray(inherited)?inherited:[]),...(Array.isArray(local)?local:[]).filter(e=>e?.type==='review-assessment'),...nested.filter(e=>e?.type==='review-assessment')]);
   candidates[unit.id]={repo:unit.repo,base:candidate.base,head:candidate.head,contractDigest:candidate.contractDigest,priorReviews};
  }
 }
 return candidates;
}
// Historical decomposition is a bounded hint, never an adopted contract or receipt.
function priorPlanHint(previous){
 const goal=previous.proposal?.goal;
 if(!goal||Buffer.byteLength(JSON.stringify(goal))>65536)return null;
 try{
  const {plan}=compileGoal(goal);
  return {schema:plan.schema,intent:plan.intent,units:plan.units.map(({id,intent,criteria,dependsOn,readPaths,writePaths,contracts})=>({id,intent,criteria,dependsOn,readPaths,writePaths,contracts}))};
 }catch{return null;}
}
export function prepareGoalRestart(input){
 const request=structuredClone(input),restart=request.restart;
 demand(restart&&path.isAbsolute(restart.directory??'')&&path.isAbsolute(restart.resultFile??''),'Explicit restart destination and result file required');
 demand(restart.replan===undefined||typeof restart.replan==='boolean','Invalid restart replan selection');
 if(restart.replan)validateDelegation(request);
 // A saved result is untrusted candidate data, not a budget-renewal authority.
 // Never silently reset a bounded original allowance by copying its request.
 createExecutionBudget(request.budget);
 if(Object.keys(request.budget??{}).length){
  demand(restart.budget&&Object.keys(request.budget).every(key=>Object.hasOwn(restart.budget,key)),'Explicit restart budget required for every previously bounded dimension');
 }
 if(restart.budget!==undefined){createExecutionBudget(restart.budget);request.budget=structuredClone(restart.budget);}
 const c=new Controller({...request,implementer:'restart-observation'});c.assertContract();
 const source=c.observeTarget({allowEmpty:true});
 const fd=fs.openSync(restart.resultFile,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));let previous;
 try{const stat=fs.fstatSync(fd);demand(stat.isFile()&&stat.nlink===1&&stat.size<=16*1024*1024,'Unsafe restart result');previous=JSON.parse(fs.readFileSync(fd));}finally{fs.closeSync(fd);}
 demand(Array.isArray(previous.units)&&previous.units.length<=64,'Prior unit results required');
 // Reject invalid saved input before creating a destination that blocks retry.
 const priorIds=new Set();
 for(const unit of previous.units){
  demand(unit&&typeof unit==='object'&&typeof unit.id==='string'&&unit.id,'Invalid prior unit');
  demand(!priorIds.has(unit.id),'Duplicate prior unit');priorIds.add(unit.id);
 }
 const suppliedPlan=request.goal?compileGoal(request.goal):undefined;
 demand(request.goal||request.decomposition,'Goal or decomposition required');
 let adopted;
 if(request.decomposition&&!request.goal&&!restart.replan){
  demand(previous.proposal,'Prior proposal required');
  adopted=adoptProposal(request,previous.proposal);
 }
 const parent=fs.realpathSync(path.dirname(restart.directory)),destination=path.join(parent,path.basename(restart.directory));
 const requestFile=path.join(parent,path.basename(destination)+'.restart-request.json');
 try{fs.lstatSync(requestFile);throw Error('Restart request destination already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 const roots=[c.repo,destination,path.join(destination,'.git')];
 for(const arg of ['--absolute-git-dir','--git-common-dir']){const metadata=fs.realpathSync(c.git('rev-parse','--path-format=absolute',arg).toString().trim());roots.push(metadata);const rel=path.relative(metadata,destination);demand(rel&& (rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)),'Restart destination overlaps Git metadata');}
 const assertAuthority=authorityCommandRootsValidator(roots);
 assertAuthority(request.approvalCommand);
 for(const unit of Object.values(request.unitRequests??{}))assertAuthority(unit.approvalCommand??request.approvalCommand);
 cloneSource(c.repo,destination,c.base,source.head);
 demand(digest(c.observeTarget({allowEmpty:true}))===digest(source),'Source changed during restart preparation');
 let next={...(adopted??request),repo:destination,workspaceMode:'isolated-clone'};delete next.restart;
 if(!restart.replan){
  next.unitCandidates=candidateReferences(previous,(suppliedPlan??compileGoal(next.goal)).plan);
 }
 fs.writeFileSync(requestFile,JSON.stringify(next,null,2),{flag:'wx',mode:0o600});
 return {request:next,source,...(request.decomposition&&!request.goal&&!restart.replan?{proposal:{status:previous.proposal.status,goal:next.goal,binding:previous.proposal.binding,calls:[],wallSeconds:0,reusedFrom:restart.resultFile}}:{}),...(restart.replan?{previous,replanning:{authority:'untrusted historical diagnostic data; not approval or completion',priorPlan:priorPlanHint(previous),units:previous.units.map(u=>({id:u.id.slice(0,128),status:String(u.result?.status??u.diagnostic?.status??'unknown').slice(0,128),error:String(u.error??u.diagnostic?.error??'').slice(0,2000)}))}}:{}),authority:'candidate bytes only; every unit and whole Goal require new verification and review'};
}
export async function restartGoal(input,options={}){
 const started=performance.now(),prepared=prepareGoalRestart(input);
 const budget=options.executionBudget??createExecutionBudget(prepared.request.budget);
 let proposal=prepared.proposal;
 const save=result=>{const output={...result,...(proposal?{proposal}:{}),wallSeconds:(performance.now()-started)/1000,budget:budget.snapshot(),restart:{sourceRepo:input.repo,source:prepared.source,candidate:prepared.request.repo,authority:prepared.authority,replanned:!!prepared.replanning}};fs.writeFileSync(path.join(result.root,'result.json'),JSON.stringify(output,null,2));return output;};
 try{
  let next=prepared.request,contexts=options.priorContexts??[];
  if(prepared.replanning){
   proposal=await proposeGoal(next,{agent:options.agent,executionBudget:budget,replanning:prepared.replanning,authorityRoots:options.authorityRoots});
   if(proposal.status==='needs-owner')return save({...proposal,status:'owner-work-required',units:[],work:{work:'clarify',actor:'owner',questions:proposal.questions}});
   next=adoptProposal(next,proposal);
   next.unitCandidates=candidateReferences(prepared.previous,compileGoal(next.goal).plan);
   const plannerContexts=proposal.calls.map(call=>call.context);demand(plannerContexts.every(c=>typeof c==='string'&&c),'Proposal context missing');
   contexts=[...contexts,...plannerContexts];
  }
  return save(await runGoal(next,{...options,executionBudget:budget,priorContexts:contexts}));
 }catch(error){
  if(error.proposalDiagnostic)proposal=error.proposalDiagnostic;
  const diagnostic=error.goalDiagnostic??(error.proposalDiagnostic?{status:'blocked',root:proposal.root,units:[],error:String(error)}:null)??(proposal?.root?{status:'blocked',root:proposal.root,units:[],error:String(error)}:null);
  if(diagnostic)error.goalDiagnostic=save(diagnostic);
  throw error;
 }
}
