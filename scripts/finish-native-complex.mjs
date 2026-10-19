import {workerRecoveryEvidence} from './native-worker-checkpoint.mjs';
import {nativePhaseUsage} from './native-host-usage.mjs';
import {assertConflictFaultsRemoved} from './native-conflict-fixture.mjs';
import {readInterruptionEvidence} from './native-interrupted-attempt.mjs';
import {assertGitControlState} from './native-git-boundary.mjs';
/** Finish a synthetic complex candidate only; no implementation or repair in this driver. */
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import {performance} from 'node:perf_hooks';
import {rolloutsFor} from './native-delivery.mjs';import {nativeReviewEvidence} from './native-review-evidence.mjs';
const [root,mode]=process.argv.slice(2);if(!root||!['--verify','--deliver'].includes(mode))throw Error('Expected run root and explicit --verify or --deliver');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name))),s=read('setup.json'),result=read('result.json');
if(s.repository!=='adachi-tatsuru/asc-public-synthetic-eval-20261016'||result.status!==0)throw Error('Invalid synthetic run');
assertGitControlState(s.origin,JSON.parse(fs.readFileSync(path.join(root,'git-controls.json'))),[s.worktree]);
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
const command=(argv,cwd)=>execFileSync(argv[0],argv.slice(1),{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024}).trim();
const head=command(['git','rev-parse','HEAD'],s.worktree),events=fs.readFileSync(path.join(root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse),rootId=events.find(e=>e.type==='thread.started')?.thread_id;
if(s.continuedRoot&&rootId!==s.continuedRoot)throw Error('Coordinator session changed');
const rollouts=await rolloutsFor(rootId,s.observationStartedAt??s.startedAt);
const proof=nativeReviewEvidence(rootId,head,rollouts);
const {verifyWorktree}=await import(pathToFileURL(path.join(root,'distribution/package/src/worktree-execution.mjs')));
const {Github}=await import(pathToFileURL(path.join(root,'distribution/package/src/github.mjs')));
const owner=path.join(root,'owner.json');fs.writeFileSync(owner,JSON.stringify({intent:s.phase==='revision'?'Apply explicit currency revision preserving original security and stored replay records':'Complete both synthetic reservation and billing requirements; no revision phase yet',allowedPaths:['complex/reservation/service.mjs','complex/billing/service.mjs'],commands:[...['reservation','billing','integration','unknown-keys',...(s.accessorOracle?['accessors']:[])].map(name=>[process.execPath,`complex/oracle/${name}.mjs`,'complex',...(s.phase==='revision'&&['reservation','billing','accessors'].includes(name)?['revised']:[])]),...(s.phase==='revision'?[[process.execPath,'complex/oracle/revision.mjs','complex/previous','complex']]:[])]}));
const verification=verifyWorktree(s.worktree,s.base,owner);if(!verification.passed||verification.head!==proof.review.head)throw Error('Complex oracle or reviewed HEAD mismatch');
const data={mode,phase:s.phase??'original',head,base:s.base,remoteBase:s.remoteBase,review:proof.review,usage:proof.usage,verification,implementationAndReviewSeconds:result.seconds,driverImplementationEdits:0,manualHandoffs:0};
if(fs.existsSync(path.join(root,'delivery-error.json')))data.priorDriverFailure=read('delivery-error.json');
if(s.continuedRoot)data.continuation={rootId,previousHead:s.previousHead,phaseUsage:nativePhaseUsage(rootId,read('before-rollouts.json'),rollouts),scope:'Same coordinator session resumed for explicit shared-contract revision in a new worktree; usage is whole-session cumulative, phaseUsage is additional work only, and all timing fields describe this revision phase only. Do not compare phase time against cumulative tokens.'};
if(s.conflictInjected){
 const injection=read('conflict-injection.json');
 if(injection.base!==s.base||injection.gitConflictObserved!==true||injection.evaluatorResolution!==false)throw Error('Missing conflict injection evidence');
 if(command(['git','diff','--name-only','--diff-filter=U'],s.worktree))throw Error('Unresolved conflict');
 assertConflictFaultsRemoved(command(['git','show',head+':complex/reservation/service.mjs'],s.worktree));
 data.conflictRecovery={injection,injectedFaultsRemoved:true,verifiedAtHead:head,scope:'Injected validation-code conflict plus explicit revision; not arbitrary conflict recovery.'};
}
if(s.parallelInterruptionRequested)data.parallelInterruptionCoverage={requested:true,verified:false,requiredEvidence:'Observe distinct worker worktrees, preserved commits and integration before interruption; a successful resumed delivery alone does not prove this scenario.'};
const interruption=readInterruptionEvidence(root,s.interruptionRequired===true);
if(interruption){
 const interrupted=interruption.checkpoint;
 if(s.workerWriteInterruptionRequired){
  const files=new Map(['reservation/service.mjs','billing/service.mjs'].map(name=>[name,execFileSync('git',['show',`${head}:complex/${name}`],{cwd:s.worktree,env,maxBuffer:16*1024*1024})]));
  data.parallelInterruptionCoverage=workerRecoveryEvidence(interrupted,files);
  if(!data.parallelInterruptionCoverage.verified)throw Error('Saved worker outputs differ from submitted commit');
 }
 Object.assign(data,{interruptedAttempt:interrupted,interruptedUsage:interruption.usage,usageScope:'Resumed parent and descendants only; interrupted attempt usage remains missing',totalProcessedTokens:null,resumedImplementationAndReviewSeconds:result.seconds,implementationAndReviewSeconds:result.seconds+interrupted.seconds});
}
fs.writeFileSync(path.join(root,'complex-verification.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({head,passed:true,tokens:proof.usage.observedProcessedTokens}));
if(mode==='--deliver'){
 const started=performance.now(),github=new Github({repository:s.repository,issue:3,repo:s.worktree,branch:s.branch,baseBranch:'main',base:s.remoteBase,workflowPath:'.github/workflows/complex.yml',command:(argv,cwd)=>{
  const a=[...argv];if(a[0]==='gh'&&a[1]==='pr'&&a[2]==='create'){
   a[a.indexOf('--title')+1]=s.phase==='revision'?'Synthetic shared-contract revision and legacy replay acceptance':'Synthetic native multi-Issue reservation and billing acceptance';
   a[a.indexOf('--body')+1]=`Synthetic-only fixture: concurrent Issue ownership, real SQLite, integration, independent review PASS for ${head}, fixed oracles. Initial fixture and CI supplied by evaluator; service implementation and integration performed by native Host Agent. No private data. Draft only; no merge/release.`;
  }return command(a,cwd);
 }});
 const pr=github.createDraft(head);fs.writeFileSync(path.join(root,'submitted.json'),JSON.stringify({pr,head}));console.log(JSON.stringify({pr,head}));
 const complexCI=await github.observe(pr);github.workflowPath='.github/workflows/test.yml';const greetingCI=await github.observe(pr);
 Object.assign(data,{pr,complexCI,greetingCI,deliverySeconds:(performance.now()-started)/1000,elapsedSeconds:(Date.now()-Date.parse(s.startedAt))/1000});
 fs.writeFileSync(path.join(root,'complex-delivery.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({pr,complexCI:complexCI.checks,greetingCI:greetingCI.checks}));
}
