/** Synthetic strategy comparison, explicit CLI invocation only. No customer repositories. */
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {performance} from 'node:perf_hooks';
import {configuration} from '../src/restricted-agent.mjs';
const setup=JSON.parse(fs.readFileSync(process.argv[2]));const variant=process.argv[3];const item=setup.cases.find(c=>c.strategy===variant);if(!item)throw Error('strategy');
const skill=fs.readFileSync(path.join(setup.root,'SKILL.md'));
if(createHash('sha256').update(skill).digest('hex')!==setup.skillSha256)throw Error('Skill snapshot changed');
const executable=fs.realpathSync(process.argv[4]);
const log=path.join(setup.root,variant+'-logs');fs.mkdirSync(log);fs.writeFileSync(path.join(log,'SKILL.md'),skill);
async function run(role,prompt,writes){
 const runtime=fs.mkdtempSync(path.join(setup.root,'runtime-')),empty=fs.mkdtempSync(path.join(setup.root,'empty-'));
 const c=configuration({workspace:empty,runtime,executable,writable:false});
 const i=c.options.findIndex(x=>x.startsWith('permissions.')&&x.includes('.filesystem='));
 c.options[i]=c.options[i].replace(/ }$/,`, ${JSON.stringify(item.origin)}="read", ${JSON.stringify(log)}="read"${writes.map(x=>`, ${JSON.stringify(x)}="write"`).join('')} }`);
 fs.writeFileSync(path.join(log,role+'.prompt.txt'),prompt);
 const out=fs.openSync(path.join(log,role+'.jsonl'),'w'),err=fs.openSync(path.join(log,role+'.stderr'),'w');const startedAt=new Date().toISOString(),start=performance.now();
 const p=spawn(c.binary,['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--json','-m','gpt-5.6-sol','-c','model_reasoning_effort="medium"','-C',empty,...c.options,'-'],{env:c.env,stdio:['pipe',out,err]});p.stdin.end(prompt);
 const status=await new Promise(resolve=>p.on('exit',resolve));fs.closeSync(out);fs.closeSync(err);
 const events=fs.readFileSync(path.join(log,role+'.jsonl'),'utf8').split('\n').filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return {}}});
 const result={role,status,skillSha256:setup.skillSha256,startedAt,finishedAt:new Date().toISOString(),seconds:(performance.now()-start)/1000,usage:events.filter(x=>x.type==='turn.completed').map(x=>x.usage),answer:events.filter(x=>x.type==='item.completed'&&x.item?.type==='agent_message').map(x=>x.item.text)};
 fs.writeFileSync(path.join(log,role+'.result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(status!==0)throw Error(`${role} failed: ${status}`);return result;
}
const R=item.worktrees.reservation.repo,B=item.worktrees.billing.repo;
const common=`Synthetic isolated evaluation. Read ${log}/SKILL.md and ${R}/REQUIREMENTS.md. No network, installation, commits, push or publication. No ASC CLI launch required. Worktrees already exist; preserve .git. Fixed oracles may be read and executed but never edited. Only write assigned implementation directories. Use Node built-in sqlite; no dependencies. Independently written oracles are at each worktree's oracle/*.mjs and accept candidate worktree root as argv2. Implement the entire contract, not only tested examples. Independent review follows separately; do not claim it done. Report actual validation and unresolved items concisely. `;
if(variant==='revision'){
 const outcomes=await Promise.allSettled(['reservation','billing'].map(role=>{
  const w=item.worktrees[role].repo;
  return run(role+'-revision',common+`Explicit subsequent contract revision at ${w}/REVISION.md supersedes the original public resource/event shape only. Existing implementation is accepted baseline, preserve it. Implement only ${w}/${role}/service.mjs for this revision. Other service is updated in a separate worktree. Validate with the revised fixed ${w}/oracle/${role}.mjs. No need to re-plan already assigned dependencies.`,[w+'/'+role]);
 }));
 if(outcomes.some(result=>result.status==='rejected'))throw Error('Revision owner failed; all owners have exited');
}else if(variant==='single')await run('single-implementer',common+`One context implements both Issues sequentially, preserving work. Issue R in ${R}/reservation; Issue B in ${B}/billing. Execute reservation and billing oracles against their respective worktrees. Integration will occur later. Do not delegate for this baseline strategy.`,[R+'/reservation',B+'/billing']);
else{
 const plan=await run('coordinator-plan',common+`Plan the two parallel Issue assignments for reservation at ${R} and billing at ${B}. Read contract, identify shared dependency and integration risks. Return concise task instructions. Do not implement or delegate; the evaluation driver will launch distinct Issue-owner contexts using your instructions and measure all calls.`,[]);
 if(plan.status!==0)throw Error('coordinator failed');
 const outcomes=await Promise.allSettled([run('reservation-owner',common+`Implement only Issue R in ${R}/reservation. Issue B is being implemented concurrently in its separate worktree. Do not edit its files. Coordinator plan: ${plan.answer.join('\n')}`,[R+'/reservation']),run('billing-owner',common+`Implement only Issue B in ${B}/billing. Issue R is being implemented concurrently in its separate worktree. Do not edit its files. Coordinator plan: ${plan.answer.join('\n')}`,[B+'/billing'])]);
 if(outcomes.some(result=>result.status==='rejected'))throw Error('Issue owner failed; all owners have exited');
}

const verification=['reservation','billing'].map(role=>{const worktree=item.worktrees[role].repo;const p=spawnSync(process.execPath,[path.join(worktree,'oracle',role+'.mjs'),worktree],{encoding:'utf8'});fs.writeFileSync(path.join(log,role+'.oracle.log'),(p.stdout??'')+(p.stderr??''));return {role,status:p.status,error:p.error?.code??null};});
fs.writeFileSync(path.join(log,'verification.json'),JSON.stringify(verification,null,2));
if(verification.some(v=>v.status!==0))throw Error('Independent oracle failed');
