import {performance} from 'node:perf_hooks';
/** Invocation-local admission limits, shared only with trusted unit controllers. */
const now=()=>performance.timeOrigin+performance.now();
export function createExecutionBudget(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['maxAgentCalls','maxElapsedSeconds'].includes(k)))throw Error('Invalid execution budget');
 for(const [key,value] of Object.entries(input))if(!Number.isSafeInteger(value)||value<0||value>1000000)throw Error('Invalid execution budget '+key);
 return restoreExecutionBudget({counter:new SharedArrayBuffer(4),maxAgentCalls:input.maxAgentCalls??null,deadline:input.maxElapsedSeconds===undefined?null:now()+input.maxElapsedSeconds*1000});
}
export function restoreExecutionBudget(shared){
 if(!(shared?.counter instanceof SharedArrayBuffer)||shared.counter.byteLength!==4||!(shared.maxAgentCalls===null||Number.isSafeInteger(shared.maxAgentCalls)&&shared.maxAgentCalls>=0&&shared.maxAgentCalls<=1000000)||!(shared.deadline===null||Number.isFinite(shared.deadline)))throw Error('Invalid shared execution budget');
 const counter=new Int32Array(shared.counter);
 const check=()=>{if(shared.deadline!==null&&now()>=shared.deadline)throw Error('Execution time budget exhausted');};
 return {shared,check,
  verificationTimeout(maximum=25000){if(!Number.isSafeInteger(maximum)||maximum<1||maximum>300000)throw Error('Invalid verification timeout');check();return shared.deadline===null?maximum:Math.min(maximum,Math.max(1,Math.ceil(shared.deadline-now())));},
  agentTimeout(){check();return shared.deadline===null?360000:Math.min(360000,Math.max(1,Math.ceil(shared.deadline-now())));},
  admit(){check();for(;;){const used=Atomics.load(counter,0);if(shared.maxAgentCalls!==null&&used>=shared.maxAgentCalls)throw Error('Agent call budget exhausted');if(used===2147483647)throw Error('Agent counter exhausted');if(Atomics.compareExchange(counter,0,used,used+1)===used)return;}},
  snapshot(){return {admittedAgentCalls:Atomics.load(counter,0),maxAgentCalls:shared.maxAgentCalls,remainingMilliseconds:shared.deadline===null?null:Math.max(0,shared.deadline-now()),semantics:'admission and work boundaries; no hard cancellation or monetary/token cap'};}
 };
}
