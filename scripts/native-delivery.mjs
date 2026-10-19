import {assertGitControlState} from './native-git-boundary.mjs';
/** Synthetic evaluation only. No private source, workflow edits, merge or release. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createInterface} from 'node:readline';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import {performance} from 'node:perf_hooks';
import {nativeReviewEvidence} from './native-review-evidence.mjs';
export function sessionDates(began,ended=new Date()){
 const first=new Date(began),last=new Date(ended),days=new Set();
 if(!Number.isFinite(+first)||!Number.isFinite(+last)||first>last)throw Error('Invalid observation interval');
 for(const utc of [false,true]){
  const prefix=utc?'getUTC':'get',year=d=>d[prefix+'FullYear'](),month=d=>d[prefix+'Month'](),date=d=>d[prefix+'Date']();
  const day=utc?new Date(Date.UTC(year(first),month(first),date(first))):new Date(year(first),month(first),date(first));
  const end=utc?new Date(Date.UTC(year(last),month(last),date(last))):new Date(year(last),month(last),date(last));
  for(;day<=end;utc?day.setUTCDate(day.getUTCDate()+1):day.setDate(day.getDate()+1))days.add([year(day),String(month(day)+1).padStart(2,'0'),String(date(day)).padStart(2,'0')].join('/'));
 }return [...days];
}
export async function rolloutsFor(rootId, began){
 const home=process.env.CODEX_HOME??path.join(os.homedir(),'.codex');const records=[];
 // Only dates belonging to this run; read identities, never export unrelated content.
 for(const day of sessionDates(began)){
  const dir=path.join(home,'sessions',day);if(!fs.existsSync(dir))continue;
  for(const name of fs.readdirSync(dir)){
   if(!name.endsWith('.jsonl'))continue;
   const file=path.join(dir,name),stream=fs.createReadStream(file),lines=createInterface({input:stream,crlfDelay:Infinity});let meta;
   try{for await(const line of lines){meta=JSON.parse(line).payload;break;}}finally{lines.close();stream.destroy();}
   if(meta?.id)records.push({file,meta});
  }
 }
 const selected=new Set([rootId]);let changed=true;
 while(changed){changed=false;for(const r of records)if(!selected.has(r.meta.id)&&selected.has(r.meta.source?.subagent?.thread_spawn?.parent_thread_id)){selected.add(r.meta.id);changed=true;}}
 return records.filter(r=>selected.has(r.meta.id)).map(r=>fs.readFileSync(r.file,'utf8').trim().split('\n').map(JSON.parse));
}
export async function finishNativeDelivery(root){
 const s=JSON.parse(fs.readFileSync(path.join(root,'setup.json'))),result=JSON.parse(fs.readFileSync(path.join(root,'result.json')));
 if(s.repository!=='adachi-tatsuru/asc-public-synthetic-eval-20261016'||s.issue.number!==1||result.status!==0)throw Error('Synthetic delivery scope or Agent status invalid');
 assertGitControlState(s.origin,JSON.parse(fs.readFileSync(path.join(root,'git-controls.json'))),[s.worktree]);
 const started=performance.now();
 const gitEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
 const command=(argv,cwd)=>execFileSync(argv[0],argv.slice(1),{cwd,env:argv[0]==='git'?gitEnv:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024}).trim();
 const head=command(['git','rev-parse','HEAD'],s.worktree);
 const events=fs.readFileSync(path.join(root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse),rootId=events.find(e=>e.type==='thread.started')?.thread_id;
 if(!rootId)throw Error('Missing Host session');
 const proof=nativeReviewEvidence(rootId,head,await rolloutsFor(rootId,s.startedAt));
 const {verifyWorktree}=await import(pathToFileURL(path.join(root,'distribution/package/src/worktree-execution.mjs')));
 const {Github}=await import(pathToFileURL(path.join(root,'distribution/package/src/github.mjs')));
 const owner=path.join(root,'owner.json');fs.writeFileSync(owner,JSON.stringify({intent:s.issue.body,allowedPaths:['greeting.py','test_greeting.py'],commands:[['python3','-I','test_greeting.py'],['python3','-I','-c','import sys; sys.path.insert(0, "."); from greeting import greeting; assert type(greeting()) is str and greeting() == "Hello"']]}));
 const verification=verifyWorktree(s.worktree,s.base,owner);
 if(!verification.passed||verification.head!==proof.review.head)throw Error('Verified and reviewed HEAD differ');
 const github=new Github({repository:s.repository,issue:1,repo:s.worktree,branch:s.branch,baseBranch:'main',base:s.base,workflowPath:'.github/workflows/test.yml',command:(argv,cwd)=>{
  const a=[...argv];if(a[0]==='gh'&&a[1]==='pr'&&a[2]==='create'){
   a[a.indexOf('--title')+1]='Synthetic autonomous current-host acceptance';
   a[a.indexOf('--body')+1]=`Synthetic Issue #1 only. Native Host implementation, exact regression test, independent review PASS for ${head}, Host verification and automatic Draft-only delivery. No private project data. No merge or release.`;
  }return command(a,cwd);
 }});
 const pr=github.createDraft(head);fs.writeFileSync(path.join(root,'submitted.json'),JSON.stringify({pr,head}));
 console.log(JSON.stringify({pr,head}));const ci=await github.observe(pr);
 const data={pr,ci,review:proof.review,usage:proof.usage,verification,implementationAndReviewSeconds:result.seconds,deliverySeconds:(performance.now()-started)/1000,elapsedSeconds:(Date.now()-Date.parse(s.startedAt))/1000,manualHandoffs:0,driverImplementationEdits:0,priorDriverFailure:fs.existsSync(path.join(root,'delivery-error.json'))?JSON.parse(fs.readFileSync(path.join(root,'delivery-error.json'))):null};
 fs.writeFileSync(path.join(root,'delivery.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({pr,ci:ci.checks,elapsedSeconds:data.elapsedSeconds}));
}
