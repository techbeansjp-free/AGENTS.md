import {performance} from 'node:perf_hooks';
/** Owner-enumerated Issues only. No discovery daemon, merge or imported completion receipts. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Controller} from './controller.mjs';
import {authorityCommandRootsValidator} from './authority-command.mjs';
import {compileGoal} from './goal-plan.mjs';import {createExecutionBudget} from './execution-budget.mjs';
import {assertWorkLocation} from './migration.mjs';import {runControllerThread} from './unit-thread.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
export function compileIssues(input){
 const plan=structuredClone(input);
 demand(plan?.schema==='asc-issues/v1'&&typeof plan.intent==='string'&&plan.intent.trim(),'Issue Goal required');
 demand(Array.isArray(plan.issues)&&plan.issues.length>0&&plan.issues.length<=64,'Issue Goal requires 1..64 Issues');
 const repositories=new Map();
 const units=plan.issues.map(issue=>{
  const r=issue.request,remote=r?.delivery?.repository;
  demand(typeof remote==='string'&&/^[\w.-]+\/[\w.-]+$/.test(remote),'Explicit Issue repository required');
  demand(Number.isSafeInteger(r.delivery.issue)&&r.delivery.issue>0,'Explicit Issue number required');
  demand(typeof r.repo==='string'&&path.isAbsolute(r.repo),'Absolute Issue worktree required');
  demand(r.budget===undefined,'Configure shared budget on the Issue Goal');
  demand(issue.priority===undefined||Number.isSafeInteger(issue.priority),'Invalid Issue priority');
  demand(Array.isArray(issue.readPaths)&&issue.readPaths.every(p=>typeof p==='string'),'Declare Issue read dependencies');
  demand(Array.isArray(r.contract?.allowedPaths)&&r.contract.allowedPaths.every(p=>typeof p==='string'),'Declare Issue write scope');
  const key=remote.toLowerCase();if(!repositories.has(key))repositories.set(key,'repo'+repositories.size);
  const prefix=repositories.get(key)+'/';
  return {id:issue.id,intent:r.contract?.intent,criteria:r.contract?.criteria,dependsOn:issue.dependsOn,
   readPaths:[...new Set([...issue.readPaths,...(r.contract?.policyRefs??[]).map(p=>p.path)])].map(p=>prefix+p),
   writePaths:(r.contract?.allowedPaths??[]).map(p=>prefix+p),contracts:{}};
 });
 // Reuse the same cycle, dependency, scope-conflict and portable-path checks as units.
 const graph=compileGoal({schema:'asc-goal/v1',intent:plan.intent,units});
 const identities=new Set(),branches=new Set();for(const i of plan.issues){const key=i.request.delivery.repository.toLowerCase()+'#'+i.request.delivery.issue;demand(!identities.has(key),'Duplicate Issue authority');identities.add(key);const branch=i.request.delivery.repository.toLowerCase()+'#'+i.request.delivery.branch;demand(typeof i.request.delivery.branch==='string'&&i.request.delivery.branch&&!branches.has(branch),'Duplicate or missing Issue delivery branch');branches.add(branch);}
 const parallelism=plan.parallelism??1;demand(Number.isSafeInteger(parallelism)&&parallelism>=1&&parallelism<=4,'Issue parallelism must be 1..4');
 return {plan,graph,parallelism};
}
export async function runIssues(input,{onEvent=()=>{},execute}={}){
 const {plan,parallelism}=compileIssues(input),budget=createExecutionBudget(plan.budget);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-issues-')),states=new Map(plan.issues.map(i=>[i.id,{id:i.id,status:'pending'}])),events=[],started=performance.now();
 const emit=(type,data={})=>{const e={type,seconds:(performance.now()-started)/1000,...data};events.push(e);onEvent(e);};
 const save=()=>{const result={status:[...states.values()].every(s=>s.status==='draft-ci-passed')?'draft-ci-passed':'incomplete',root,issues:[...states.values()],events,budget:budget.snapshot(),wallSeconds:(performance.now()-started)/1000,allAgentTotalTokens:null};fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));return result;};
 // Include even missing candidate paths; one invalid worktree must not poison siblings.
 const authorityRoots=new Set(plan.issues.map(i=>path.resolve(i.request.repo)));
 for(const i of plan.issues){
  try{authorityRoots.add(fs.realpathSync.native(i.request.repo));}catch{ /* Keep conservative authority boundaries; launch validates repository and base. */ }
  try{const c={repo:fs.realpathSync.native(i.request.repo)};
   for(const arg of ['--absolute-git-dir','--git-common-dir'])authorityRoots.add(fs.realpathSync.native(Controller.prototype.gitOutput.call(c,undefined,['rev-parse','--path-format=absolute',arg]).toString().trim()));
  }catch{ /* Keep conservative authority boundaries; launch validates repository and base. */ } // Its own launch still rejects an invalid repository/base.
 }
 const assertAuthority=authorityCommandRootsValidator([...authorityRoots]);
 const checkAuthority=issue=>{
  assertAuthority(issue.request.approvalCommand);
  assertAuthority(issue.request.hostExecution?.command);
  for(const unit of Object.values(issue.request.unitRequests??{})){assertAuthority(unit.approvalCommand??issue.request.approvalCommand);assertAuthority(unit.hostExecution?.command);}
 };
 // Check before any candidate runs, and again at dispatch after earlier Issues finish.
 for(const issue of plan.issues)try{checkAuthority(issue);}catch(error){states.set(issue.id,{id:issue.id,status:'blocked',error:String(error)});}
 const active=new Map();
 const dispatch=execute??((request,id)=>runControllerThread(new URL('./issue-worker.mjs',import.meta.url),{request,budget:budget.shared,authorityRoots:[...authorityRoots]},event=>emit('issue-event',{id,event})));
 const contains=(a,b)=>{const rel=path.relative(a,b);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
 const checkDependencyInputs=issue=>{
  const ancestors=new Set(),visit=id=>{for(const dep of plan.issues.find(i=>i.id===id).dependsOn)if(!ancestors.has(dep)){ancestors.add(dep);visit(dep);}};visit(issue.id);
  const overlap=(a,b)=>{a=a.toLowerCase();b=b.toLowerCase();return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');};
  const reads=[...issue.readPaths,...issue.request.contract.allowedPaths,...(issue.request.contract.policyRefs??[]).map(p=>p.path)];
  for(const id of ancestors){
   const prior=plan.issues.find(i=>i.id===id);if(prior.request.delivery.repository.toLowerCase()!==issue.request.delivery.repository.toLowerCase()||!prior.request.contract.allowedPaths.some(p=>reads.some(q=>overlap(p,q))))continue;
   const result=states.get(id).result,target=result?.target??result?.delivery?.target;demand(target?.head,'Dependency lacks an observed Git target');
   const upstream=new Controller({...prior.request,implementer:'dependency-observation'}),downstream=new Controller({...issue.request,implementer:'dependency-observation'});
   demand(upstream.git('rev-parse','HEAD').toString().trim()===target.head,'Dependency HEAD changed; revalidation required');
   const expected=upstream.blobs(target.head),actual=downstream.blobs(downstream.git('rev-parse','HEAD').toString().trim());
   const changed=upstream.git('diff','--no-ext-diff','--no-textconv','--name-only','-z',prior.request.base,target.head).toString().split('\0').filter(Boolean);
   for(const name of changed.filter(p=>reads.some(q=>overlap(p,q)))){const a=expected.get(name),b=actual.get(name);demand((!a&&!b)||(a&&b&&a.mode===b.mode&&a.bytes.equals(b.bytes)),'Dependency output not integrated; owner base update or Goal integration required');}
  }
 };
 const launch=issue=>{
  let observedRepo=path.resolve(issue.request.repo);
  const task=(async()=>{
   try{
    budget.check();const repo=assertWorkLocation(issue.request.repo,issue.request.workspaceMode).repo;observedRepo=repo;
    demand(![...active.values()].some(v=>contains(v.repo,repo)||contains(repo,v.repo)),'Active Issue worktrees overlap');
    checkAuthority(issue);checkDependencyInputs(issue);
    states.set(issue.id,{id:issue.id,status:'running'});emit('issue-started',{id:issue.id,repo});
    const result=await dispatch({...issue.request,repo},issue.id,budget);
    states.set(issue.id,{id:issue.id,status:result.status==='draft-ci-passed'?'draft-ci-passed':'blocked',result});
   }catch(error){states.set(issue.id,{id:issue.id,status:'blocked',error:String(error),diagnostic:error.workflowDiagnostic??null});}
   emit('issue-finished',{id:issue.id,status:states.get(issue.id).status});
  })();
  // Run-specific scheduling only; there is no cross-session reservation or failure latch.
  active.set(issue.id,{task,repo:observedRepo});task.then(()=>active.delete(issue.id),()=>active.delete(issue.id));
 };
 emit('issues-started',{root});
 while([...states.values()].some(s=>s.status==='pending')||active.size){
  for(const issue of plan.issues){if(states.get(issue.id).status!=='pending')continue;
   if(issue.dependsOn.some(id=>['blocked','dependency-blocked','budget-stopped'].includes(states.get(id).status)))states.set(issue.id,{id:issue.id,status:'dependency-blocked'});
  }
  const ready=plan.issues.filter(i=>states.get(i.id).status==='pending'&&i.dependsOn.every(id=>states.get(id).status==='draft-ci-passed')).sort((a,b)=>(b.priority??0)-(a.priority??0)||a.id.localeCompare(b.id));
  for(const issue of ready){
   if(active.size>=parallelism)break;
   let candidate=path.resolve(issue.request.repo);try{candidate=fs.realpathSync.native(candidate);}catch{ /* Keep conservative authority boundaries; launch validates repository and base. */ }
   if([...active.values()].some(v=>contains(v.repo,candidate)||contains(candidate,v.repo)))continue;
   try{budget.check();const b=budget.snapshot();demand(b.maxAgentCalls===null||b.admittedAgentCalls<b.maxAgentCalls,'Agent call budget exhausted');}
   catch(error){states.set(issue.id,{id:issue.id,status:'budget-stopped',error:String(error)});continue;}
   launch(issue);
  }
  save();if(active.size)await Promise.race([...active.values()].map(a=>a.task));
 }
 emit('issues-finished');return save();
}
