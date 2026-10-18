/** Synthetic strategy comparison, explicit CLI invocation only. No customer repositories. */
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {performance} from 'node:perf_hooks';
import {configuration} from '../src/restricted-agent.mjs';
const setup=JSON.parse(fs.readFileSync(process.argv[2]));const variant=process.argv[3];const item=setup.cases.find(c=>c.strategy===variant);if(!item)throw Error('strategy');
const skill=fs.readFileSync(path.join(setup.root,'SKILL.md'));
if(createHash('sha256').update(skill).digest('hex')!==setup.skillSha256)throw Error('Skill snapshot changed');
const executable=fs.realpathSync(process.argv[4]);
const log=path.join(setup.root,variant+'-review');fs.mkdirSync(log);fs.writeFileSync(path.join(log,'SKILL.md'),skill);
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
const w=item.worktrees.integration.repo;
await run('independent-review',`Synthetic independent review only. Inspect ${w}/REQUIREMENTS.md, the actual Git diffs from ${item.base} to HEAD in ${w}, and service implementations and oracle tests. No file edits, no commits, no network or delegation. Determine whether full business lifecycle, auth/tenant boundaries, invalid inputs, persisted idempotency and multi-instance behavior meet contract. Execute additional read-only-source tests using temporary files only if useful. Do not merely trust existing oracle passes or implementer self-evaluation. Identify concrete untested failure scenarios with reproduction evidence; distinguish contract defects from suggestions. Return PASS or FAIL with concise findings, current HEAD and commands tested.`,[]);
