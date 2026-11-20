import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {GIT_NULL_DEVICE} from './source-limits.mjs';

/**
 * Read-only "where am I" text for a Host SessionStart hook after compaction or a cleared context (#1755).
 * It lists the repository's worktrees from local Git only: no network, no writes, no session switching.
 * The Host keeps the context window; ASC only points the summarized context back at the repository state.
 */
const MAX_BRANCH=200,MAX_WORKTREES=20,MAX_INPUT=65536,MAX_TEXT=4000,GIT_TIMEOUT=5000,DEADLINE=10000;
// Standard ASC branch: <type>/<issue>-<slug> (skills/asc/references/workspace.md).
const ISSUE_BRANCH=/^(?:feature|fix|refactor|test|docs|chore)\/(\d+)-[a-z0-9-]+$/;
const HEADER='ASC: Contextが要約または新しいものに置き換わった。要約・記憶・引継ぎ文を手掛かりにし、次のrepositoryの状態とIssue・PRの記録で現在地を確かめてから続ける。食い違えばrepositoryを正とする（ASCのskills/asc/references/coordination.md「Contextの更新と引継ぎ」）。';
const FOOTER='次の手順: 要約（/clearの後なら引継ぎ文）にある次の手順を、担当IssueとPRの最新の記録・上の状態と照らしてから実行する。このhookはIssue・PRを読まない。merge等の許可と取消しは、要約を許可とみなさず、ASCのskills/asc/SKILL.md「許可されたmerge」に従って照合する。';

function cleanEnv(){
 // An inherited GIT_DIR/GIT_WORK_TREE would point every call at another repository. System and global configuration
 // are not read, as in src/host-session.mjs, so a user-wide filter or monitor is not started here.
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 return {...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:GIT_NULL_DEVICE,GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1'};
}

// Other sessions' worktrees are read here, so no Git call may write or start a program it can avoid:
// --no-optional-locks keeps git status from refreshing an index, and core.fsmonitor=false with an empty hooksPath keeps
// a repository's configuration from launching a monitor daemon or hook. A clean filter that the repository itself
// configures can still run when git status compares a changed file, as it would for the user's own git status.
export function defaultGit(cwd,args,timeout=GIT_TIMEOUT){
 const p=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false','-c',`core.hooksPath=${GIT_NULL_DEVICE}`,'-C',cwd,...args],{encoding:'utf8',timeout,maxBuffer:8*1024*1024,env:cleanEnv()});
 return {status:p.status,stdout:p.stdout??'',error:p.error};
}

/** Parse `git worktree list --porcelain`. */
export function parseWorktrees(text){
 const list=[];let current;
 for(const line of text.split('\n')){
  if(line.startsWith('worktree ')){current={path:line.slice(9)};list.push(current);}
  else if(!current)continue;
  else if(line.startsWith('HEAD '))current.head=line.slice(5);
  else if(line.startsWith('branch '))current.branch=line.slice(7).replace(/^refs\/heads\//,'');
  else if(line==='detached')current.detached=true;
  else if(line==='bare')current.bare=true;
  else if(line.startsWith('prunable'))current.prunable=true;
 }
 return list;
}

const shorten=text=>text.length<=MAX_BRANCH?text:text.slice(0,MAX_BRANCH)+'…';

export function issueFromBranch(branch){
 const m=ISSUE_BRANCH.exec(branch??'');return m?Number(m[1]):undefined;
}

/** Read the hook's JSON input (Claude Code and Codex both pass `cwd`). Invalid input falls back to the process cwd. */
export function hookDirectory(input,fallback=process.cwd()){
 if(typeof input!=='string'||!input.trim()||input.length>MAX_INPUT)return fallback;
 try{const data=JSON.parse(input);return typeof data?.cwd==='string'&&path.isAbsolute(data.cwd)?data.cwd:fallback;}catch{return fallback;}
}

/**
 * Read the hook's stdin within `timeoutMs` and `maxBytes`: a Host that keeps stdin open must not hold the hook past
 * its deadline. Whatever arrived by then is returned; the stream is released so the process can exit.
 */
export function readHookInput(stream,{timeoutMs=2000,maxBytes=MAX_INPUT}={}){
 return new Promise(resolve=>{
  const chunks=[];let size=0,done=false;
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);stream.removeAllListeners?.('data');stream.pause?.();stream.unref?.();stream.destroy?.();resolve(Buffer.concat(chunks).toString('utf8'));};
  const timer=setTimeout(finish,timeoutMs);
  stream.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){chunks.length=0;finish();return;}chunks.push(chunk);});
  stream.on('end',finish);stream.on('error',finish);
 });
}

/**
 * The whole run is bounded by `deadline` so a slow repository yields a partial answer before the Host's hook timeout.
 * The current worktree is listed first and the header and footer are always kept; other worktrees fill what is left.
 */
export function resumeContext(directory,{git=defaultGit,now=Date.now,deadline=DEADLINE}={}){
 const end=now()+deadline;
 const run=(cwd,args)=>{const left=end-now();return left<=0?{status:null,stdout:'',error:Error('deadline')}:git(cwd,args,Math.min(GIT_TIMEOUT,left));};
 const top=run(directory,['rev-parse','--show-toplevel']);
 if(top.error||top.status!==0)return compose([`作業場所: ${directory}（Git管理外、またはGitを読めない。ファイルの実体で確かめる）`]);
 const current=top.stdout.trim();
 const listed=run(directory,['worktree','list','--porcelain']);
 if(listed.error||listed.status!==0)return compose([`現在の作業場所: ${current}`,'worktree一覧を読めない。`git worktree list`で確かめる。']);
 const all=parseWorktrees(listed.stdout).filter(w=>!w.bare);
 const ordered=[...all.filter(w=>w.path===current),...all.filter(w=>w.path!==current)];
 const fixed=[`現在の作業場所: ${current}`,'worktree（他のsessionのものを含む。Issue番号はbranch名からの推定で、担当とIssueの対応はIssue・PRで確かめる）:'];
 const entries=[];
 for(const w of ordered.slice(0,MAX_WORKTREES)){
  let state;
  if(w.prunable)state='場所なし（prunable）';
  else{
   const status=run(w.path,['status','--porcelain']);
   state=status.error?.message==='deadline'?'状態は時間切れで未確認':status.error||status.status!==0?'状態を読めない':`未commit ${status.stdout.split('\n').filter(Boolean).length}件`;
  }
  const issue=issueFromBranch(w.branch);
  // The current worktree's path is already on the fixed line; its entry keeps only the state so it always fits.
  entries.push(`- ${w.path===current?'（現在の作業場所）':w.path} branch ${w.detached?'(detached)':shorten(w.branch??'不明')} HEAD ${(w.head??'不明').slice(0,12)} ${state}${issue?` Issue #${issue}`:''}`);
 }
 return compose(fixed,entries,all.length);
}

// Keep the header, the fixed lines, the current worktree's entry (listed first) and the footer; drop other worktree
// lines from the end to stay within MAX_TEXT. Only an extremely long path shortens the first fixed line.
function compose(fixed,entries=[],total=entries.length){
 const keep=entries.length&&entries[0].startsWith('- （現在の作業場所）')?1:0;
 const build=(shown,lines=fixed)=>{
  const omitted=total-shown;
  return [HEADER,...lines,...entries.slice(0,shown),...(omitted>0?[`ほか${omitted}件は省略。\`git worktree list\`で確かめる。`]:[]),FOOTER].join('\n');
 };
 for(let shown=entries.length;shown>=keep;shown--){const text=build(shown);if(text.length<=MAX_TEXT)return text;}
 const over=build(keep).length-MAX_TEXT,first=fixed[0];
 return build(keep,[first.slice(0,Math.max(0,first.length-over-1))+'…',...fixed.slice(1)]);
}
