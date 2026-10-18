/** Synthetic strategy comparison, explicit CLI invocation only. No customer repositories. */
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {performance} from 'node:perf_hooks';
import {configuration} from '../src/restricted-agent.mjs';
import {extendFixturePermissions} from './complex-permissions.mjs';
const setup=JSON.parse(fs.readFileSync(process.argv[2]));const variant=process.argv[3];const item=setup.cases.find(c=>c.strategy===variant);if(!item)throw Error('strategy');
const skill=fs.readFileSync(path.join(setup.root,'SKILL.md'));
if(createHash('sha256').update(skill).digest('hex')!==setup.skillSha256)throw Error('Skill snapshot changed');
const executable=fs.realpathSync(process.argv[4]);
const log=path.join(setup.root,variant+'-repair-'+process.argv[5]);fs.mkdirSync(log);fs.writeFileSync(path.join(log,'SKILL.md'),skill);
async function run(role,prompt,writes){
 const runtime=fs.mkdtempSync(path.join(setup.root,'runtime-')),empty=fs.mkdtempSync(path.join(setup.root,'empty-'));
 const c=configuration({workspace:empty,runtime,executable,writable:false});
 extendFixturePermissions(c.options,[item.origin,log],writes);
 fs.writeFileSync(path.join(log,role+'.prompt.txt'),prompt);
 const out=fs.openSync(path.join(log,role+'.jsonl'),'w'),err=fs.openSync(path.join(log,role+'.stderr'),'w');const startedAt=new Date().toISOString(),start=performance.now();
 const p=spawn(c.binary,['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--json','-m','gpt-5.6-sol','-c','model_reasoning_effort="medium"','-C',empty,...c.options,'-'],{env:c.env,stdio:['pipe',out,err]});p.stdin.end(prompt);
 const status=await new Promise(resolve=>p.on('exit',resolve));fs.closeSync(out);fs.closeSync(err);
 const events=fs.readFileSync(path.join(log,role+'.jsonl'),'utf8').split('\n').filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return {}}});
 const result={role,status,skillSha256:setup.skillSha256,startedAt,finishedAt:new Date().toISOString(),seconds:(performance.now()-start)/1000,usage:events.filter(x=>x.type==='turn.completed').map(x=>x.usage),answer:events.filter(x=>x.type==='item.completed'&&x.item?.type==='agent_message').map(x=>x.item.text)};
 fs.writeFileSync(path.join(log,role+'.result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(status!==0)throw Error(`${role} failed: ${status}`);return result;
}
const role=process.argv[5];if(!['reservation','billing'].includes(role))throw Error('role');
const w=item.worktrees[role].repo;
await run(role+'-repair',process.argv[6]==='billing-upgrade'?`Repair the verified synthetic billing upgrade finding in ${w}. Read REQUIREMENTS.md and REVISION.md, actual source and prior Git version. Old billing idempotency canonical JSON lacks currency; revised issue requires JPY and includes currency, so replaying the same old key incorrectly conflicts. Preserve old valid replay, reject genuinely different input and invalid currency, preserve reservation work. Only ${w}/billing is writable. No commit/network/delegation/oracle edits. Run billing and a temporary old-to-new replay regression; report evidence.`:process.argv[6]==='resume'?`Resume interrupted synthetic reservation work in ${w}. Previous writer has exited; saved uncommitted source must be preserved. Read REQUIREMENTS.md, REVISION.md and actual Git diff. Complete the revision if needed and run the revised reservation oracle. Only ${w}/reservation is writable. Do not restart implementation or discard work; no commit/network/delegation. Report what was reused and validation.`:`Fresh-context handoff for synthetic Issue repair. Original contract at ${w}/REQUIREMENTS.md. Current implementation at ${w}/${role}/service.mjs. Independent reviewer reproduced unknown non-enumerable own property acceptance caused by Object.keys exact-key validation. Symbol own keys are similarly unknown. Verify the finding against current code; fix only if valid, preserve all other business behavior. Only ${w}/${role}/ is writable. Other Issue is completed and must be preserved. Do not change fixed oracles, commit, install, network or delegate. Run existing ${w}/oracle/${role}.mjs with ${w} and a temporary-only unknown-key regression. Report exact fix, test result and unresolved findings.`,[w+'/'+role]);
