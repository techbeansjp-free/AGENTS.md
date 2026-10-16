import {restoreExecutionBudget} from './execution-budget.mjs';
/** Trusted per-unit controller event loop. Candidate code is still OS-sandboxed. */
import {parentPort,workerData} from 'node:worker_threads';
import {runWorkflow} from './workflow.mjs';import {Github} from './github.mjs';
try{
 const {request,primaryIntent}=workerData;
 const remote=new Github({...request.delivery,repo:request.repo,base:request.base});
 const result=await runWorkflow(request,{submit:false,candidateReuse:workerData.candidateReuse,unitAssignment:workerData.unitAssignment,executionBudget:workerData.budget?restoreExecutionBudget(workerData.budget):undefined,onEvent:event=>parentPort.postMessage({type:'event',event}),provider:{intent:async()=>{
  if(await remote.intent()!==primaryIntent)throw Error('Primary Goal intent changed');
  return request.contract.intent;
 }}});
 parentPort.postMessage({type:'result',result});
}catch(error){parentPort.postMessage({type:'failure',error:String(error),diagnostic:error.workflowDiagnostic??null});}
