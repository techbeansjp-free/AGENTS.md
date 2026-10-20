/** Resume an accepted synthetic coordinator; never edits implementation; publishes only to the authorized synthetic Draft PR. */
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {gitControlState,assertGitControlState} from './native-git-boundary.mjs';
import {claudeSessionIds,claudeUsage} from './claude-usage.mjs';
import {claudeReviewEvidence} from './claude-review-evidence.mjs';
import {claudeVerificationEvidence} from './claude-verification-evidence.mjs';
import {verifyWorktree} from '../src/worktree-execution.mjs';
import {verifyBrowser} from './isolated-browser-tool.mjs';
import {claudeBrowserEvidence} from './claude-browser-evidence.mjs';
import {pathToFileURL} from 'node:url';
const [input,claude]=process.argv.slice(2);
if(!input||!claude||!path.isAbsolute(input)||!path.isAbsolute(claude))throw Error('Absolute trial root and Claude executable required');
const root=fs.realpathSync(input),phase=path.join(root,'revision'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const setup=read(path.join(root,'setup.json')),prior=read(path.join(root,'delivery.json')),next=read(path.join(phase,'setup.json'));
if(setup.root!==root||next.parent!==root||next.session!==setup.session||prior.session!==setup.session||prior.head!==next.originalHead||setup.repository!=='adachi-tatsuru/asc-public-synthetic-eval-20261016'||!['complex-two-issue-initial','complex-two-issue-system'].includes(setup.scenario)||setup.verificationTransport!=='project'||!prior.usage.complete)throw Error('Accepted synthetic initial session required');
const system=setup.scenario==='complex-two-issue-system',mcpConfiguration={mcpServers:{}};
let browserConfig,browserBytes,browserFile;
if(system){
 if(prior.browserVerification?.passed!==true||prior.browserVerification.head!==prior.head)throw Error('Original browser verification missing');
 browserFile=path.join(root,'distribution/browser-config.json');browserBytes=fs.readFileSync(browserFile);browserConfig=JSON.parse(browserBytes);
 mcpConfiguration.mcpServers.asc_browser={command:process.execPath,args:[path.join(root,'distribution/isolated-browser-tool.mjs'),browserFile]};
}
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
const git=(...a)=>execFileSync('git',['-C',setup.worktree,...a],{env,stdio:['ignore','pipe','pipe'],encoding:'utf8',maxBuffer:16*1024*1024}).trim();
if(git('rev-parse','HEAD')!==next.base||git('status','--porcelain'))throw Error('Prepared revision target changed');
const ownerBytes=fs.readFileSync(next.owner),hash=b=>createHash('sha256').update(b).digest('hex');
for(const [service,digest] of Object.entries(next.previousSourceHashes))if(hash(fs.readFileSync(path.join(setup.worktree,'complex/previous',service,'service.mjs')))!==digest)throw Error('Previous implementation changed');
const controls=gitControlState(setup.origin,[setup.worktree]);
const prompt=`Continue this same coordinator session on the existing synthetic project. The prior implementation and Draft PR are complete. The owner now requests complex/REVISION.md, preserving complex/REQUIREMENTS.md and compatibility with records created by the actual previous implementation in complex/previous. The integration worktree remains ${setup.worktree}; new immutable requirement baseline is ${next.base}. The owner contract ${next.owner} contains the exact scope and project verification commands. Only complex/reservation/service.mjs and complex/billing/service.mjs may change. Previous implementations, oracles, workflow, settings and Git configuration are immutable. Continue both Issues with current Host native direct workers in separate correctly named worktrees as appropriate; no grandchildren or separate Claude CLI processes. Use the same packaged ASC Skill and CLI as before. Preserve work and delegate at task boundaries as that Skill directs. Use ${setup.model} at inherited effort; no Codex or Fable. ${system?'Only local loopback test traffic; no external network, push or unsandboxed retry. After the final commit call mcp__asc_browser__verify_browser with the final HEAD; require success and preserve the original SYSTEM_REQUIREMENTS.md journeys.':'No network, push or unsandboxed retry.'} Integrate, commit, perform real verification, and obtain a fresh independent reviewer with description exactly independent_review. Supply original requirements, revision, new base, final HEAD and actual diff; require PASS <full reviewed HEAD> or FAIL <full reviewed HEAD> plus findings. Correct valid findings and re-evaluate changed evidence. Before reporting final completion run ${next.capture.command} after final commit. This protected evaluator runs the owner project commands; it performs no implementation or repair. Do not edit it. The external runner checks and publishes the accepted result; do not claim publication. Report final HEAD and reviewer identity.`;
// Exclusive create prevents replay after interruption or observation failure.
const out=fs.openSync(path.join(phase,'events.jsonl'),'wx'),err=fs.openSync(path.join(phase,'stderr'),'wx');
fs.writeFileSync(path.join(phase,'prompt.txt'),prompt,{flag:'wx'});fs.writeFileSync(path.join(phase,'git-controls.json'),JSON.stringify(controls),{flag:'wx'});
const started=performance.now(),args=['-p','--resume',setup.session,'--model',setup.model,'--effort',setup.effort,'--tools','Bash,Agent,TaskOutput,TaskStop,SendMessage','--allowedTools','Bash,Agent,TaskOutput,TaskStop,SendMessage'+(system?',mcp__asc_browser__verify_browser':''),'--permission-mode','dontAsk','--setting-sources','','--settings',path.join(phase,'settings.json'),'--strict-mcp-config','--mcp-config',JSON.stringify(mcpConfiguration),'--output-format','stream-json','--verbose'];
console.log(JSON.stringify({root,session:setup.session,phase:'revision'}));
const run=await new Promise((resolve,reject)=>{const p=spawn(claude,args,{cwd:setup.worktree,env:{HOME:process.env.HOME,PATH:process.env.PATH},stdio:['pipe',out,err]});p.stdin.end(prompt);p.on('error',reject);p.on('close',(status,signal)=>resolve({status,signal,seconds:(performance.now()-started)/1000}));});
fs.closeSync(out);fs.closeSync(err);fs.writeFileSync(path.join(phase,'process-result.json'),JSON.stringify(run));
const records=file=>fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
try{
 const events=records(path.join(phase,'events.jsonl')),oldEvents=records(path.join(root,'events.jsonl')),result=events.findLast(e=>e.type==='result');
 const ids=claudeSessionIds([...oldEvents,...events],setup.session),directory=path.join(process.env.HOME,'.claude/projects',setup.worktree.replace(/[^a-zA-Z0-9-]/g,'-'));
 const transcripts=ids.flatMap(id=>{const file=id===setup.session?path.join(directory,id+'.jsonl'):path.join(directory,setup.session,'subagents','agent-'+id+'.jsonl');return fs.existsSync(file)?[{id,records:records(file)}]:[];});
 // Preserve raw whole-session counts. Missing Host reconciliation is never zero usage.
 const usage=claudeUsage(transcripts,ids,result?.modelUsage);
 fs.writeFileSync(path.join(phase,'usage.json'),JSON.stringify({usage,modelUsage:result?.modelUsage??null,scope:'Whole resumed session, deduplicated; may require phase Host totals reconciliation'},null,2));
 if(run.status!==0||run.signal||result?.is_error||result?.subtype!=='success'||result.session_id!==setup.session)throw Error('Continuation did not complete');
 assertGitControlState(setup.origin,controls,[setup.worktree]);if(!ownerBytes.equals(fs.readFileSync(next.owner)))throw Error('Owner changed');
 const head=git('rev-parse','HEAD'),review=claudeReviewEvidence(events,head,ref=>git('rev-parse','--verify',ref+'^{commit}'));
 const verification=verifyWorktree(setup.worktree,next.base,next.owner);if(!verification.passed||verification.head!==head)throw Error('Oracle mismatch');
 const inHostVerification=claudeVerificationEvidence(events,verification,next.capture);
 let browserVerification;
 if(system){
  if(!fs.readFileSync(browserFile).equals(browserBytes))throw Error('Browser contract changed');
  const checked=verifyBrowser(browserConfig,{head});if(!checked.passed)throw Error('Revised browser oracle failed');
  browserVerification={...checked,inHostObservation:claudeBrowserEvidence(events,checked)};
 }

 const acceptance={root,session:setup.session,base:next.base,head,run,review,verification,inHostVerification,...(browserVerification?{browserVerification}:{}),usage,modelUsage:result.modelUsage,implementationIntervention:0,publication:'pending'};
 fs.writeFileSync(path.join(phase,'acceptance.json'),JSON.stringify(acceptance,null,2));
 if(usage.complete){
  const {Github}=await import(pathToFileURL(path.join(root,'distribution/package/src/github.mjs')));
  const command=(argv,cwd)=>execFileSync(argv[0],argv.slice(1),{cwd,env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
  const github=new Github({repository:setup.repository,issue:setup.issue,repo:setup.worktree,branch:setup.branch,baseBranch:'main',base:setup.deliveryBase,workflowPath:'.github/workflows/complex.yml',command});
  const deliveryStarted=performance.now();
  github.expectedHead=prior.head;github.assertPr(github.api(`repos/${setup.repository}/pulls/${prior.pr}`));
  github.assertTransportConfiguration();
  command(['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','push',`git@github.com:${setup.repository}.git`,`${head}:refs/heads/${setup.branch}`],setup.worktree);
  const pr=prior.pr;github.expectedHead=head;
  github.assertPr(github.api(`repos/${setup.repository}/pulls/${pr}`));
  fs.writeFileSync(path.join(phase,'submitted.json'),JSON.stringify({pr,head}));
  const ci=await github.observe(pr);github.workflowPath='.github/workflows/test.yml';const greetingCI=await github.observe(pr);
  fs.writeFileSync(path.join(phase,'delivery.json'),JSON.stringify({...acceptance,pr,ci,greetingCI,publication:'draft-ci-complete',deliverySeconds:(performance.now()-deliveryStarted)/1000,phaseSeconds:(performance.now()-started)/1000,timingScope:'Continuation phase including review, verification and CI; original phase remains separate'},null,2));
 }
 console.log(JSON.stringify({head,seconds:run.seconds,usageComplete:usage.complete,wholeObservedTokens:usage.observedProcessedTokens,publication:usage.complete?'draft-ci-complete':'pending'}));
}catch(e){fs.writeFileSync(path.join(phase,'failure.json'),JSON.stringify({error:e.message,seconds:(performance.now()-started)/1000}));throw e;}
