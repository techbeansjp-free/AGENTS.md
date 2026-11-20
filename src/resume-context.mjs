import {spawnSync} from 'node:child_process';
import path from 'node:path';

/**
 * Read-only "where am I" text for a Host SessionStart hook after compaction or a cleared context (#1755).
 * It lists the repository's worktrees from local Git only: no network, no writes, no session switching.
 * The Host keeps the context window; ASC only points the summarized context back at the repository state.
 */
const MAX_WORKTREES=20,MAX_INPUT=65536,MAX_TEXT=4000,GIT_TIMEOUT=5000;
// Standard ASC branch: <type>/<issue>-<slug> (skills/asc/references/workspace.md).
const ISSUE_BRANCH=/^(?:feature|fix|refactor|test|docs|chore)\/(\d+)-[a-z0-9-]+$/;

function cleanEnv(){
 // An inherited GIT_DIR/GIT_WORK_TREE would point every call at another repository.
 return Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
}

// --no-optional-locks: git status must not refresh another session's index or take its lock.
export function defaultGit(cwd,args){
 const p=spawnSync('git',['--no-optional-locks','-C',cwd,...args],{encoding:'utf8',timeout:GIT_TIMEOUT,maxBuffer:8*1024*1024,env:cleanEnv()});
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

export function issueFromBranch(branch){
 const m=ISSUE_BRANCH.exec(branch??'');return m?Number(m[1]):undefined;
}

/** Read the hook's JSON input (Claude Code and Codex both pass `cwd`). Invalid input falls back to the process cwd. */
export function hookDirectory(input,fallback=process.cwd()){
 if(typeof input!=='string'||!input.trim()||input.length>MAX_INPUT)return fallback;
 try{const data=JSON.parse(input);return typeof data?.cwd==='string'&&path.isAbsolute(data.cwd)?data.cwd:fallback;}catch{return fallback;}
}

export function resumeContext(directory,{git=defaultGit}={}){
 const lines=['ASC: Contextが要約または新しいものに置き換わった。要約・記憶・引継ぎ文を手掛かりにし、次のrepositoryの状態とIssue・PRの記録で現在地を確かめてから続ける。食い違えばrepositoryを正とする（ASCのskills/asc/references/coordination.md「Contextの更新と引継ぎ」）。'];
 const top=git(directory,['rev-parse','--show-toplevel']);
 if(top.error||top.status!==0){
  lines.push(`作業場所: ${directory}（Git管理外、またはGitを読めない。ファイルの実体で確かめる）`);
  return finish(lines);
 }
 const current=top.stdout.trim();
 const listed=git(directory,['worktree','list','--porcelain']);
 if(listed.error||listed.status!==0){
  lines.push(`現在の作業場所: ${current}`,'worktree一覧を読めない。`git worktree list`で確かめる。');
  return finish(lines);
 }
 const worktrees=parseWorktrees(listed.stdout).filter(w=>!w.bare);
 lines.push(`現在の作業場所: ${current}`,'worktree（Issue番号はbranch名からの推定。Issueとbranchの対応はIssue・PRで確かめる）:');
 for(const w of worktrees.slice(0,MAX_WORKTREES)){
  const issue=issueFromBranch(w.branch);
  let state;
  if(w.prunable)state='場所なし（prunable）';
  else{
   const status=git(w.path,['status','--porcelain']);
   state=status.error||status.status!==0?'状態を読めない':`未commit ${status.stdout.split('\n').filter(Boolean).length}件`;
  }
  const mark=w.path===current?'（現在）':'';
  lines.push(`- ${w.path}${mark} branch ${w.detached?'(detached)':w.branch??'不明'} HEAD ${(w.head??'不明').slice(0,12)} ${state}${issue?` Issue #${issue}`:''}`);
 }
 if(worktrees.length>MAX_WORKTREES)lines.push(`ほか${worktrees.length-MAX_WORKTREES}件は省略。\`git worktree list\`で確かめる。`);
 lines.push('次の手順: 要約にある次の手順を、担当IssueとPRの最新の記録・上の状態と照らしてから実行する。このhookはIssue・PRを読まない。merge等の許可と取消しは、要約を許可とみなさず、ASCのskills/asc/SKILL.md「許可されたmerge」に従って照合する。');
 return finish(lines);
}

function finish(lines){
 const text=lines.join('\n');
 return text.length<=MAX_TEXT?text:text.slice(0,MAX_TEXT-20)+'\n（以下省略）';
}
