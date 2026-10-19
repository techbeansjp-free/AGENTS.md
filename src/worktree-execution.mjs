/** Current Host execution in the real worktree; no snapshot or provider launch. */
import {projectContext} from './project-context.mjs';
import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {projectLocation} from './project-location.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));
// These non-interactive commands have no stdin payload. Avoid an unnecessary
// stdin socket/pipe, which restricted Hosts can reject even after child success.
const gitMaxBuffer=16*1024*1024;
const git=(repo,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:repo,stdio:['ignore','pipe','pipe'],env:gitEnvironment(),encoding:'utf8',maxBuffer:gitMaxBuffer}).trim();
export function startWorktree(directory,paths=[],{coordination=false}={}){
 if(typeof coordination!=='boolean')throw Error('Expected boolean coordination option');
 const result=describeProject(projectLocation(directory),paths);
 if(coordination){
  const cli=fileURLToPath(new URL('../bin/asc-v05.mjs',import.meta.url));
  result.coordination={
   guidance:['workspace','coordination'].map(name=>{
    const file=fileURLToPath(new URL(`../skills/asc/references/${name}.md`,import.meta.url)),bytes=fs.readFileSync(file);
    return {path:file,sha256:hash(bytes),text:bytes.toString('utf8')};
   }),
   reviewerGuide:fileURLToPath(new URL('../skills/asc/references/review.md',import.meta.url)),
   commandTemplates:{
    createWorktree:[process.execPath,cli,'worktree-create','<root>','<issue>','<type>','<slug>','<base>'],
    verifyWorktree:[process.execPath,cli,'worktree-verify','<worktree>','<base>','<owner-contract.json>']
   },
   authority:'Preparation only. Resolve owner intent, scope, dependencies and project rules before delegation. Command templates are not authorization. No source/test bodies, Agent launch, worktree creation or verification performed.'
  };
 }
 return result;
}
function describeProject({repo,gitManaged},paths){
 const context=projectContext(repo,paths);
 if(!gitManaged)return {schema:'asc-project-start/v1',repo,head:null,gitManaged:false,context,execution:'current-host-directory',snapshot:false,providerLaunch:false,
  skill:fileURLToPath(new URL('../skills/asc/SKILL.md',import.meta.url)),
  obligations:['owner intent and permitted scope','project build and tests in this directory','independent context review of actual changes','complete without Git when no Git delivery is requested; Git setup only for explicitly requested commit-bound verification or PR delivery'],verified:false,deliveryAuthorized:false};
 return {schema:'asc-worktree/v1',repo,head:git(repo,'rev-parse','HEAD'),context,execution:'current-host-worktree',snapshot:false,providerLaunch:false,
  skill:fileURLToPath(new URL('../skills/asc/SKILL.md',import.meta.url)),
  obligations:['owner intent and permitted scope','project build and tests in this worktree','independent context review of actual diff','verified commit matches submitted PR and CI'],verified:false};
}
export function verifyWorktree(directory,base,ownerFile){
 const location=projectLocation(directory);
 if(location.gitManaged===false)throw Error('Git setup and dedicated worktree required for commit-bound verification');
 const repo=location.repo,owner=fs.realpathSync(ownerFile),rel=path.relative(repo,owner);
 if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('Owner contract must be outside worktree');
 const bytes=fs.readFileSync(owner),contract=JSON.parse(bytes);
 if(typeof contract.intent!=='string'||!contract.intent.trim()||!Array.isArray(contract.allowedPaths)||!contract.allowedPaths.length||contract.allowedPaths.some(p=>typeof p!=='string'||!p||path.isAbsolute(p)||p.split('/').some(s=>!s||s==='.'||s==='..'))||!Array.isArray(contract.commands)||!contract.commands.length||contract.commands.some(a=>!Array.isArray(a)||!a.length||!a[0]||a.some(v=>typeof v!=='string'||v.includes('\0'))))throw Error('Expected intent, exact allowedPaths and command argv arrays');
 // Every accepted changed path must be in allowedPaths below; select its nested and scoped rules too.
 const start=describeProject(location,contract.allowedPaths);
 const baseHead=git(repo,'rev-parse','--verify','--end-of-options',base+'^{commit}');git(repo,'merge-base','--is-ancestor',baseHead,start.head);
 const state=()=>{
  const entries=execFileSync('git',['ls-files','-v','-z'],{cwd:repo,stdio:['ignore','pipe','pipe'],env:gitEnvironment(),maxBuffer:gitMaxBuffer}).toString().split('\0').filter(Boolean);
  if(entries.some(e=>e[0]==='S'||e[0]===e[0].toLowerCase()))throw Error('Hidden index flags prevent verification of tracked source');
  return git(repo,'status','--porcelain=v1','--untracked-files=all');
 };
 if(state())throw Error('Commit intended changes before verification; preserve unrelated work separately');
 const names=execFileSync('git',['diff','--name-only','--no-renames','-z',baseHead,start.head],{cwd:repo,stdio:['ignore','pipe','pipe'],env:gitEnvironment(),maxBuffer:gitMaxBuffer}).toString().split('\0').filter(Boolean);
 if(names.some(p=>!contract.allowedPaths.includes(p)))throw Error('Changes exceed owner scope');
 // Owner-selected commands run in the current Host environment, unlike internal Git observations.
 const verificationEnvironment={...process.env},results=[];
 for(const argv of contract.commands){
  const began=performance.now(),p=spawnSync(argv[0],argv.slice(1),{cwd:repo,stdio:['ignore','pipe','pipe'],env:verificationEnvironment,encoding:'utf8',shell:false,maxBuffer:Infinity});
  results.push({argv,exit:p.status,seconds:(performance.now()-began)/1000,stdoutSha256:hash(p.stdout??''),stderrSha256:hash(p.stderr??''),...(p.error||p.status!==0?{error:p.error?.message??'Command failed',stdout:(p.stdout??'').slice(-4096),stderr:(p.stderr??'').slice(-4096)}:{})});
  if(git(repo,'rev-parse','HEAD')!==start.head||state())throw Error('Verification changed tracked source, HEAD or untracked outputs; result is invalid');
  if(hash(fs.readFileSync(owner))!==hash(bytes))throw Error('Owner contract changed during verification; result is invalid');
  // Git status cannot observe ignored/local rules; bind each command boundary too.
  if(projectContext(repo,contract.allowedPaths).digest!==start.context.digest)throw Error('Project context changed during verification; result is invalid');
  if(p.error||p.status!==0)break;
 }
 return {schema:'asc-worktree-verification/v1',execution:'current-host-worktree',repo,base:baseHead,head:start.head,contractSha256:hash(bytes),contextSha256:start.context.digest,intent:contract.intent,results,passed:results.length===contract.commands.length&&results.every(r=>r.exit===0&&!r.error),independentReview:'required',deliveryAuthorized:false};
}
