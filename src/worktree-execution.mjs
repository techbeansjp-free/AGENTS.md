/** Current Host execution in the real worktree; no snapshot or provider launch. */
import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {assertWorkLocation} from './migration.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(repo,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:repo,encoding:'utf8'}).trim();
export function startWorktree(directory){
 const {repo}=assertWorkLocation(directory);
 return {schema:'asc-worktree/v1',repo,head:git(repo,'rev-parse','HEAD'),execution:'current-host-worktree',snapshot:false,providerLaunch:false,
  skill:fileURLToPath(new URL('../skills/asc/SKILL.md',import.meta.url)),
  obligations:['owner intent and permitted scope','project build and tests in this worktree','independent context review of actual diff','verified commit matches submitted PR and CI'],verified:false};
}
export function verifyWorktree(directory,base,ownerFile){
 const start=startWorktree(directory),repo=start.repo,owner=fs.realpathSync(ownerFile),rel=path.relative(repo,owner);
 if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('Owner contract must be outside worktree');
 const bytes=fs.readFileSync(owner),contract=JSON.parse(bytes);
 if(typeof contract.intent!=='string'||!contract.intent.trim()||!Array.isArray(contract.allowedPaths)||!contract.allowedPaths.length||contract.allowedPaths.some(p=>typeof p!=='string'||!p||path.isAbsolute(p)||p.split('/').some(s=>!s||s==='.'||s==='..'))||!Array.isArray(contract.commands)||!contract.commands.length||contract.commands.some(a=>!Array.isArray(a)||!a.length||!a[0]||a.some(v=>typeof v!=='string'||v.includes('\0'))))throw Error('Expected intent, exact allowedPaths and command argv arrays');
 const baseHead=git(repo,'rev-parse','--verify','--end-of-options',base+'^{commit}');git(repo,'merge-base','--is-ancestor',baseHead,start.head);
 const state=()=>{
  const entries=execFileSync('git',['ls-files','-v','-z'],{cwd:repo}).toString().split('\0').filter(Boolean);
  if(entries.some(e=>e[0]==='S'||e[0]===e[0].toLowerCase()))throw Error('Hidden index flags prevent verification of tracked source');
  return git(repo,'status','--porcelain=v1','--untracked-files=all');
 };
 if(state())throw Error('Commit intended changes before verification; preserve unrelated work separately');
 const names=execFileSync('git',['diff','--name-only','--no-renames','-z',baseHead,start.head],{cwd:repo}).toString().split('\0').filter(Boolean);
 if(names.some(p=>!contract.allowedPaths.includes(p)))throw Error('Changes exceed owner scope');
 const results=[];
 for(const argv of contract.commands){
  const began=performance.now(),p=spawnSync(argv[0],argv.slice(1),{cwd:repo,env:process.env,encoding:'utf8',shell:false,maxBuffer:Infinity});
  results.push({argv,exit:p.status,seconds:(performance.now()-began)/1000,stdoutSha256:hash(p.stdout??''),stderrSha256:hash(p.stderr??''),...(p.error||p.status!==0?{error:p.error?.message??'Command failed',stdout:(p.stdout??'').slice(-4096),stderr:(p.stderr??'').slice(-4096)}:{})});
  if(git(repo,'rev-parse','HEAD')!==start.head||state())throw Error('Verification changed tracked source, HEAD or untracked outputs; result is invalid');
  if(hash(fs.readFileSync(owner))!==hash(bytes))throw Error('Owner contract changed during verification; result is invalid');
  if(p.error||p.status!==0)break;
 }
 return {schema:'asc-worktree-verification/v1',execution:'current-host-worktree',repo,base:baseHead,head:start.head,contractSha256:hash(bytes),intent:contract.intent,results,passed:results.length===contract.commands.length&&results.every(r=>r.exit===0&&!r.error),independentReview:'required',deliveryAuthorized:false};
}
