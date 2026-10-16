/** Trusted Issue controller; Agent and verification isolation remain unchanged. */
import {parentPort,workerData} from 'node:worker_threads';
import {runAdaptive} from './adaptive-run.mjs';
import {runWorkflow} from './workflow.mjs';import {runGoal} from './goal-run.mjs';import {restoreExecutionBudget} from './execution-budget.mjs';
try{
 const result=await (workerData.request.decomposition?runAdaptive:workerData.request.goal?runGoal:runWorkflow)(workerData.request,{authorityRoots:workerData.authorityRoots,executionBudget:restoreExecutionBudget(workerData.budget),onEvent:event=>parentPort.postMessage({type:'event',event})});
 parentPort.postMessage({type:'result',result});
}catch(error){parentPort.postMessage({type:'failure',error:String(error),diagnostic:error.goalDiagnostic??error.workflowDiagnostic??null});}
