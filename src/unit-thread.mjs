/** Isolate synchronous Git/verification from other units' preflight event loops. */
import {Worker} from 'node:worker_threads';
export function runControllerThread(module,workerData,onEvent){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(module,{workerData});
  let result,failure;
  worker.on('message',message=>{
   if(message.type==='event')onEvent(message.event);
   else if(message.type==='result')result=message.result;
   else if(message.type==='failure'){failure=Error(message.error);if(message.diagnostic)failure.workflowDiagnostic=message.diagnostic;}
  });
  worker.once('error',error=>{failure=error;});
  // Wait for actual controller exit, not just a result message.
  worker.once('exit',code=>failure?reject(failure):code!==0||!result?reject(Error('Unit controller exited without result')):resolve(result));
 });
}

export const runUnitThread=(request,primaryIntent,onEvent,budget,unitAssignment,candidateReuse)=>runControllerThread(new URL('./goal-worker.mjs',import.meta.url),{request,primaryIntent,budget,unitAssignment,candidateReuse},onEvent);
