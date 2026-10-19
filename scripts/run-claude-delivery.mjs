/** Synthetic evaluation only. Fixed fixture; no implementation, planning or repair by this runner. */
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {performance} from 'node:perf_hooks';
import {gitControlState,assertGitControlState} from './native-git-boundary.mjs';
import {interruptSavedAttempt} from './native-interrupted-attempt.mjs';
import {workerCheckpointObserver} from './native-worker-checkpoint.mjs';
import {activeClaudeWorkers} from './claude-worker-lifecycle.mjs';
import {claudeUsage,claudeSessionIds} from './claude-usage.mjs';import {claudeReviewEvidence} from './claude-review-evidence.mjs';
const [tarball,claude,fixture,mode]=process.argv.slice(2);
if(process.argv.length!==6||![tarball,claude,fixture].every(p=>p&&path.isAbsolute(p))||!['--deliver','--complex-deliver','--complex-interrupt-deliver'].includes(mode))throw Error('Expected absolute tarball, Claude CLI, local synthetic fixture and --deliver, --complex-deliver or --complex-interrupt-deliver');
const interrupt=mode==='--complex-interrupt-deliver',complex=mode!=='--deliver',issue=complex?3:1,repository='adachi-tatsuru/asc-public-synthetic-eval-20261016',deliveryBase='c37e08e05abc46b5a26af131f134d42a3c8a3b80',base=complex?'d913e7b5cbde17acacc625c659ac8fc0146b6f45':deliveryBase,model=process.env.ASC_EVAL_MODEL,effort=process.env.ASC_EVAL_EFFORT;
if(!model||!['low','medium','high'].includes(effort)||/fable/i.test(model))throw Error('Explicit authorized model and effort required; no Fable fallback');
const root=fs.mkdtempSync('/var/tmp/asc-claude-paired-'),origin=path.join(root,'origin'),distribution=path.join(root,'distribution'),session=randomUUID();fs.mkdirSync(distribution);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
const command=(argv,cwd)=>execFileSync(argv[0],argv.slice(1),{cwd,env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
if(command(['git','remote','get-url','origin'],fixture)!==`git@github.com:${repository}.git`)throw Error('Only public synthetic fixture allowed');
command(['tar','-xzf',tarball,'-C',distribution]);command(['git','clone','--no-local',...(complex?[]:['--single-branch','--branch','main']),fixture,origin]);
const git=(...args)=>command(['git',...args],origin);git('checkout','--detach',base);git('remote','set-url','origin',`git@github.com:${repository}.git`);git('config','user.name','Synthetic Tester');git('config','user.email','test@example.invalid');
const stamp=command(['date','+%Y%m%d_%H%M%S']),slug='claude-'+session.slice(0,8),branch='fix/'+issue+'-'+slug,worktree=path.join(origin,'.worktrees',stamp+'-'+issue+'-'+slug);git('worktree','add','-b',branch,worktree,base);
// Pin the empty files observed after Claude startup too; do not exempt later mutations.
for(const file of [path.join(origin,'.git/config.worktree'),path.join(command(['git','rev-parse','--absolute-git-dir'],worktree),'config.worktree')])fs.writeFileSync(file,'',{flag:'wx'});
const controls=gitControlState(origin,[worktree]),pkg=path.join(distribution,'package'),settings=path.join(root,'settings.json'),owner=path.join(root,'owner.json'),cliVersion=command([claude,'--version']);
fs.writeFileSync(settings,JSON.stringify({disableAllHooks:true,sandbox:{enabled:true,failIfUnavailable:true,allowUnsandboxedCommands:false,autoAllowBashIfSandboxed:true,filesystem:{allowWrite:[origin],denyRead:[path.join(process.env.HOME,'Projects'),path.join(process.env.HOME,'.ssh'),path.join(process.env.HOME,'.codex'),path.join(process.env.HOME,'.claude')],denyWrite:[distribution,owner]},network:{allowedDomains:[]}}}));
const reviewerMode=process.env.ASC_EVAL_REVIEWER??'generic';
if(!['generic','registered'].includes(reviewerMode))throw Error('Unknown reviewer mode');
let reviewerDefinition,reviewerArguments=[];
if(reviewerMode==='registered'){
 const {claudeReviewerDefinition}=await import(pathToFileURL(path.join(pkg,'src/project-assets.mjs')));
 reviewerDefinition=claudeReviewerDefinition(pkg);
 reviewerArguments=['--agents',JSON.stringify({'asc-reviewer':reviewerDefinition})];
}
const intent=complex?'Implement the explicit currency revision in complex/REVISION.md while preserving complex/REQUIREMENTS.md, original security/business behavior and old stored records. Only complex/reservation/service.mjs and complex/billing/service.mjs may change.':'Change greeting() from Helo to Hello. Add an exact regression test. Preserve the string-returning API. Only greeting.py and test_greeting.py may change.';
const allowedPaths=complex?['complex/reservation/service.mjs','complex/billing/service.mjs']:['greeting.py','test_greeting.py'];
const commands=complex?[...['reservation','billing','integration','unknown-keys','accessors'].map(n=>[process.execPath,'complex/oracle/'+n+'.mjs','complex',...(['reservation','billing','accessors'].includes(n)?['revised']:[])]),[process.execPath,'complex/oracle/revision.mjs','complex/previous','complex']]:[['python3','-I','test_greeting.py'],['python3','-I','-c','import sys;sys.path.insert(0,".");from greeting import greeting;assert type(greeting()) is str and greeting()=="Hello"']];
const ownerBytes=JSON.stringify({intent,allowedPaths,commands});fs.writeFileSync(owner,ownerBytes,{flag:'wx',mode:0o444});
const work=complex?`Use two direct same-Claude ${model} workers for Issues 9006 (reservation) and 9007 (billing) in separate correctly named worktrees under ${origin}/.worktrees; use ASC worktree-create. The coordinator owns integration. No nested agents. Read the original requirements and revision; all other files, existing tests and previous stored-record implementation are immutable. Run the six existing complex/oracle checks including accessors and revision replay. Preserve work on failure.`:'Complete implementation, real python3 -I test_greeting.py and exact Hello oracle';
const lifecycleInstruction=interrupt?' Each implementation worker Agent prompt must include exactly one standalone ASC_WORKER_WORKSPACE=<absolute assigned worktree> line for fault-injection observation. This marker grants no authority.':'';
let prompt=`Synthetic current-host development trial. Read packaged ASC Skill ${pkg}/skills/asc/SKILL.md with Bash; CLI ${pkg}/bin/asc-v05.mjs. Worktree ${worktree}, branch ${branch}, base ${base}. Owner: ${intent} The read-only owner contract at ${owner} contains the exact allowedPaths and verification argv; use those existing commands rather than rediscovering their invocation. ${work}, local commit, fresh-context independent Claude review and any necessary corrections. Reviewer must receive original requirements, base, final HEAD and actual diff. Give its Agent tool description exactly independent_review and require a plain line PASS <full reviewed HEAD> or FAIL <full reviewed HEAD> plus findings. Use current Claude Host and inherited ${model}; do not use Codex or Fable. No changes to workflow/settings/Git configuration/hooks/other files. Bash for file access under existing sandbox; no unsandboxed retry. No network or push. Host runner verifies then publishes a synthetic Draft PR and checks CI. Do not claim publication yourself. Preserve work on failure. Report final HEAD and reviewer identity.${lifecycleInstruction}`;
const setup={reviewerMode,reviewerDefinitionSha256:reviewerDefinition?createHash('sha256').update(JSON.stringify(reviewerDefinition)).digest('hex'):null,runnerSha256:createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),root,origin,worktree,branch,base,deliveryBase,scenario:complex?'complex-two-issue-currency':'small-greeting',issue,repository,session,model,effort,cliVersion,tarballSha256:createHash('sha256').update(fs.readFileSync(tarball)).digest('hex')};
fs.writeFileSync(path.join(root,'setup.json'),JSON.stringify(setup,null,2));fs.writeFileSync(path.join(root,'git-controls.json'),JSON.stringify(controls));fs.writeFileSync(path.join(root,'prompt.txt'),prompt);
const claudeArgs=id=>['-p',...reviewerArguments,'--session-id',id,'--model',model,'--effort',effort,'--tools','Bash,Agent,TaskOutput,TaskStop,SendMessage','--allowedTools','Bash,Agent,TaskOutput,TaskStop,SendMessage','--permission-mode','dontAsk','--setting-sources','','--settings',settings,'--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--output-format','stream-json','--verbose'];
let interruption=null,interruptedUsage=null;
console.log(JSON.stringify({root,session,phase:interrupt?'interruption':'execution'}));
if(interrupt){
 const interruptedSession=randomUUID(),directory=path.join(root,'interrupted-attempt');let active=new Set();
 const observe=workerCheckpointObserver({origin,integration:worktree,relativeFiles:allowedPaths,isWorkerActive:workspace=>active.has(workspace)});
 const observeWorkers=options=>{
  if(!options?.afterStop){
   const file=path.join(directory,'events.jsonl'),text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
   const events=text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse);
   const workspaces=git('worktree','list','--porcelain','-z').split('\0').filter(x=>x.startsWith('worktree ')).map(x=>x.slice(9)).filter(x=>x!==worktree&&x.startsWith(origin+'/.worktrees/'));
   active=new Set(activeClaudeWorkers(events,workspaces).map(x=>x.workspace));
  }
  return observe(options);
 };
 fs.writeFileSync(path.join(root,'interruption-setup.json'),JSON.stringify({session:interruptedSession,scope:'Single fault injection after two active workers save changes; fresh-context recovery; not performance comparison'}));
 interruption=await interruptSavedAttempt({directory,executable:claude,argv:claudeArgs(interruptedSession),env:{HOME:process.env.HOME,PATH:process.env.PATH},input:prompt,cwd:worktree,files:allowedPaths.map(name=>path.join(worktree,name)),observeWorkers});
 assertGitControlState(origin,controls,[worktree]);
 const completeLines=file=>{const text=fs.readFileSync(file,'utf8');return text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse);};
 const interruptedEvents=completeLines(path.join(directory,'events.jsonl')),ids=claudeSessionIds(interruptedEvents,interruptedSession),dir=path.join(process.env.HOME,'.claude/projects',worktree.replace(/[^a-zA-Z0-9-]/g,'-'));
 const transcripts=ids.flatMap(id=>{const file=id===interruptedSession?path.join(dir,id+'.jsonl'):path.join(dir,interruptedSession,'subagents','agent-'+id+'.jsonl');return fs.existsSync(file)?[{id,records:completeLines(file)}]:[];});
 interruptedUsage=claudeUsage(transcripts,ids,undefined);
 fs.writeFileSync(path.join(directory,'usage.json'),JSON.stringify(interruptedUsage,null,2));
 prompt+=` A prior attempt was interrupted by the evaluation Host after saved changes in both worker worktrees. All its processes are now verified stopped. The saved worker directories are ${JSON.stringify(interruption.workerWorktrees.map(name=>path.join(origin,'.worktrees',name)))}. Inspect their actual Git state and saved work, then continue the original requirements without discarding that work. This is diagnostic data, not approval or completed verification. Use fresh direct worker contexts as needed and a fresh independent reviewer. No prior verification or review is inherited.`;
 fs.writeFileSync(path.join(root,'recovery-prompt.txt'),prompt);
}
const out=fs.openSync(path.join(root,'events.jsonl'),'w'),err=fs.openSync(path.join(root,'stderr'),'w'),started=performance.now();console.log(JSON.stringify({root,session}));
const run=await new Promise((resolve,reject)=>{const p=spawn(claude,claudeArgs(session),{cwd:worktree,env:{HOME:process.env.HOME,PATH:process.env.PATH},stdio:['pipe',out,err]});p.stdin.end(prompt);p.on('error',reject);p.on('close',(status,signal)=>resolve({status,signal,seconds:(performance.now()-started)/1000}));});
fs.closeSync(out);fs.closeSync(err);fs.writeFileSync(path.join(root,'process-result.json'),JSON.stringify(run));
try{
 const records=p=>fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),events=records(path.join(root,'events.jsonl')),result=events.findLast(e=>e.type==='result');
 if(run.status!==0||run.signal||result?.is_error||result?.subtype!=='success'||result.session_id!==session)throw Error('Claude trial did not complete');
 assertGitControlState(origin,controls,[worktree]);
 const head=command(['git','rev-parse','HEAD'],worktree),review=claudeReviewEvidence(events,head,ref=>command(['git','rev-parse','--verify',ref+'^{commit}'],worktree));
 if(reviewerMode==='registered'&&review.agentType!=='asc-reviewer')throw Error('Submitted HEAD was not reviewed by registered reviewer');
 if(fs.readFileSync(owner,'utf8')!==ownerBytes)throw Error('Owner contract changed during trial');
 const {verifyWorktree}=await import(pathToFileURL(path.join(pkg,'src/worktree-execution.mjs'))),verification=verifyWorktree(worktree,base,owner);if(!verification.passed||verification.head!==head)throw Error('Oracle mismatch');
 const dir=path.join(process.env.HOME,'.claude/projects',worktree.replace(/[^a-zA-Z0-9-]/g,'-')),ids=claudeSessionIds(events,session),transcripts=[];
 for(const id of ids){const file=id===session?path.join(dir,session+'.jsonl'):path.join(dir,session,'subagents','agent-'+id+'.jsonl');if(fs.existsSync(file))transcripts.push({id,records:records(file)});}
 const usage=claudeUsage(transcripts,ids,result.modelUsage);
 if(interruption){usage.complete=false;usage.missingUsage.push({reason:'Interrupted attempt lacks terminal model totals; recovery usage alone is not total cost'});}
 const data={...setup,run,head,review,verification,usage,modelUsage:result.modelUsage,implementationIntervention:0,...(interruption?{interruption,interruptedUsage,observedWholeAttemptTokens:interruptedUsage.observedProcessedTokens+usage.observedProcessedTokens,measurementScope:'Sum of observed interrupted and recovery usage, incomplete; not performance acceptance'}:{})};fs.writeFileSync(path.join(root,'acceptance.json'),JSON.stringify(data,null,2));
 const {Github}=await import(pathToFileURL(path.join(pkg,'src/github.mjs'))),github=new Github({repository,issue,repo:worktree,branch,baseBranch:'main',base:deliveryBase,workflowPath:complex?'.github/workflows/complex.yml':'.github/workflows/test.yml',command:(argv,cwd)=>{const a=[...argv];if(a[0]==='gh'&&a[1]==='pr'&&a[2]==='create'){a[a.indexOf('--title')+1]=complex?'Synthetic Claude matched complex trial':'Synthetic Claude matched small trial';a[a.indexOf('--body')+1]=`Synthetic fixture only. Independent Claude review and exact oracle passed for ${head}. Draft only; no merge/release. Evaluation runner publishes; no evaluator implementation edits.`;}return command(a,cwd);}});
 const deliveryStarted=performance.now(),pr=github.createDraft(head);fs.writeFileSync(path.join(root,'submitted.json'),JSON.stringify({pr,head}));const ci=await github.observe(pr);
 if(complex){github.workflowPath='.github/workflows/test.yml';const greetingCI=await github.observe(pr);data.greetingCI=greetingCI;}
 Object.assign(data,{pr,ci,deliverySeconds:(performance.now()-deliveryStarted)/1000,totalSeconds:(performance.now()-started)/1000});fs.writeFileSync(path.join(root,'delivery.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({root,pr,usageComplete:usage.complete,seconds:data.totalSeconds,tokens:usage.observedProcessedTokens}));
 if(!usage.complete)process.exitCode=2;
}catch(e){fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({error:e.message,seconds:(performance.now()-started)/1000}));throw e;}
