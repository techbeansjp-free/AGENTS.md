/** Synthetic evaluator only: one bounded retry of the same persisted session. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {providerFailure} from '../src/provider-failure.mjs';
import {evaluationLaunch} from './native-evaluation-launch.mjs';
export async function runNativeSession({root,c,worktree,model,effort,prompt,checkBoundary}, {launch=evaluationLaunch,wait=delay}={}) {
 const started=performance.now(),attempts=[];let session;
 for(let attempt=0;attempt<2;attempt++){
  checkBoundary();
  const common=['--ignore-user-config','--ignore-rules','--skip-git-repo-check','--json','-m',model,'-c',`model_reasoning_effort=${JSON.stringify(effort)}`,...c.options];
  const args=attempt?['exec','-C',worktree,'resume',...common,session,'-']:['exec','-C',worktree,...common,'-'];
  const command=launch(c,args,root),events=path.join(root,`attempt-${attempt}.jsonl`),errors=path.join(root,`attempt-${attempt}.stderr`);
  const out=fs.openSync(events,'wx'),err=fs.openSync(errors,'wx'),began=performance.now();
  let result;
  try{
   result=await new Promise((resolve,reject)=>{
    const child=spawn(command.binary,command.args,{env:c.env,stdio:['pipe',out,err]});
    child.on('error',reject);child.stdin.on('error',()=>{});
    child.on('close',(status,signal)=>resolve({status,signal}));
    child.stdin.end(attempt?'Continue the same authorized task from preserved work. Check current worktree and worker state before writing; do not duplicate active writers or recreate completed changes. Preserve original permissions, acceptance criteria, verification and independent review. Report remaining work honestly.':prompt);
   });
  }finally{fs.closeSync(out);fs.closeSync(err);}
  const output=fs.readFileSync(events,'utf8');
  fs.appendFileSync(path.join(root,'events.jsonl'),output.endsWith('\n')?output:output+'\n');
  fs.appendFileSync(path.join(root,'stderr'),fs.readFileSync(errors));
  const ids=new Set();for(const line of output.split('\n')){try{const e=JSON.parse(line);if(e.type==='thread.started')ids.add(e.thread_id);}catch{ /* Not a protocol record. */ }}
  const observed=[...ids][0];
  const bound=ids.size===1&&typeof observed==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(observed)&&(!session||observed===session);
  attempts.push({...result,seconds:(performance.now()-began)/1000,sessionBound:bound});
  const save=()=>{const data={...result,seconds:(performance.now()-started)/1000,attempts,automaticResumes:attempt};fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(data));return data;};
  if(!bound){result={...result,status:1,identityError:true};save();throw Error('Native session identity missing or changed; no retry or delivery');}
  save();
  session=observed;
  if(result.status===0||result.signal||attempt===1||!providerFailure(output))return save();
  checkBoundary();await wait(1000);
 }
}
