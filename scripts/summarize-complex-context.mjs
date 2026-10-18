/** Export synthetic results only; never copy raw Host logs or credentials. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const setup=JSON.parse(fs.readFileSync(process.argv[2])),root=setup.root;
const gitEnv={...process.env};for(const key of Object.keys(gitEnv))if(key.startsWith('GIT_'))delete gitEnv[key];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file));
const results={status:'recorded-observations',kind:'same-Skill strategy comparison; not old/new Skill A/B',skillSha256:setup.skillSha256,contractSha256:setup.contractSha256,model:'gpt-5.6-sol',effort:'medium',trials:[],limits:[
 'One trial per strategy; cache uncontrolled; no general speed/cost advantage established.',
 'Deterministic driver owns Issue worker processes; this is not a nested-agent comparison.',
 'Review calls overlapped other trial phases; phase durations are not controlled end-to-end ratios.',
 'Root orchestration and evaluation-tool review usage missing; do not claim total project cost.',
 'Input tokens include cached input; reasoning is a subset of output. Do not add either subset twice.',
 'Exact repeated content-read commands are a limited observable, not semantic duplicate reads or peak context size.',
]};
for(const item of setup.cases){
 const strategy=item.strategy,log=path.join(root,strategy+'-logs');if(!fs.existsSync(path.join(log,'integration.json')))continue;
 const integration=read(path.join(log,'integration.json'));delete integration.worktree;
 const trial={strategy,base:item.base,oracleHashesAtExport:Object.fromEntries(fs.readdirSync(path.join(item.worktrees.integration.repo,'oracle')).filter(n=>n.endsWith('.mjs')).map(n=>[n,sha(fs.readFileSync(path.join(item.worktrees.integration.repo,'oracle',n)))])),oracleHashScope:'Current worktree files at export; not proof of the oracle used by earlier calls.',integration,verification:fs.existsSync(path.join(log,'verification.json'))?read(path.join(log,'verification.json')):null,calls:[],initialSources:{},readMetrics:[]};
 for(const dir of fs.readdirSync(root).filter(d=>d===strategy+'-logs'||d===strategy+'-review'||d===strategy+'-rereview'||d.startsWith(strategy+'-repair-'))){
  for(const name of fs.readdirSync(path.join(root,dir)).filter(n=>n.endsWith('.result.json'))){
   const call=read(path.join(root,dir,name));
   const answer=call.answer?.at(-1)??'';delete call.answer;
   if(/review/.test(dir))call.reviewVerdict=/^PASS\b/.test(answer)?'PASS':/^FAIL\b/.test(answer)?'FAIL':'unclassified';
   trial.calls.push(call);
   const file=path.join(root,dir,name.replace('.result.json','.jsonl'));if(!fs.existsSync(file))continue;
   let changed=false,count=0;const before=[],after=[];
   for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){
    let event;try{event=JSON.parse(line);}catch{continue;}
    if(event.type!=='item.completed')continue;const i=event.item??{};
    if(i.type==='file_change')changed=true;
    if(i.type==='command_execution'){count++;if(/\b(cat|sed|head|tail)\b/.test(i.command??''))(changed?after:before).push(i.command);}
   }
   trial.readMetrics.push({role:dir+'/'+call.role,rawLogSha256:sha(fs.readFileSync(file)),shellCommands:count,contentReadCommandsBeforeFirstObservedFileChange:before.length,exactRepeatedReadCommandsBeforeFirstObservedFileChange:before.length-new Set(before).size,contentReadCommandsAfterFirstObservedFileChange:after.length,contextHighWaterMark:null});
  }
 }
 for(const [role,commit] of Object.entries(integration.commits)){
  const code=execFileSync('git',['show',`${commit}:${role}/service.mjs`],{cwd:item.origin,env:gitEnv,encoding:'utf8'});trial.initialSources[role]={sha256:sha(code),code};
 }
 const repair=path.join(log,'repair-integration.json');if(fs.existsSync(repair)){
  trial.repairVerification=read(repair);trial.repairedSources={};
  for(const role of ['reservation','billing']){const code=execFileSync('git',['show',`${trial.repairVerification.integrationHead}:${role}/service.mjs`],{cwd:item.origin,env:gitEnv,encoding:'utf8'});trial.repairedSources[role]={sha256:sha(code),code};}
 }
 trial.initialContract=execFileSync('git',['show',`${item.base}:REQUIREMENTS.md`],{cwd:item.origin,env:gitEnv,encoding:'utf8'});
 trial.usageMissingCalls=trial.calls.filter(c=>!c.usage?.length).map(c=>c.role);
 trial.observedProcessedTokens=trial.calls.reduce((total,c)=>total+(c.usage??[]).reduce((n,u)=>n+u.input_tokens+u.output_tokens,0),0);
 results.trials.push(trial);
}
if(fs.existsSync(path.join(root,'interruption/checkpoint.json')))results.interruption={checkpoint:read(path.join(root,'interruption/checkpoint.json')),execution:read(path.join(root,'interruption/result.json')),limitation:'Interrupted turn usage missing; observed resumed usage is not complete handoff cost.'};
fs.writeFileSync(process.argv[3],JSON.stringify(results,null,2)+'\n');
