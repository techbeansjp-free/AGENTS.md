/** Project-owned rules are never distribution assets. Git applies one reviewed patch. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash,safeName} from './controller.mjs';
import {projectLocation} from './project-location.mjs';
const prefix='.agent-skill-chain/',record=prefix+'distribution.json';
const defaultPackage=fileURLToPath(new URL('..',import.meta.url));
function demand(ok,message){if(!ok)throw Error(message);}
function read(root,name){
 safeName(name);let cursor=root;
 const parts=name.split('/');
 for(let i=0;i<parts.length;i++){
  cursor=path.join(cursor,parts[i]);let st;
  try{st=fs.lstatSync(cursor);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  demand(!st.isSymbolicLink(),'Asset path traverses a symlink');
  if(i<parts.length-1)demand(st.isDirectory(),'Asset parent is not a directory');
  else demand(st.isFile()&&st.nlink===1&&st.size<=2000000,'Unsafe asset file');
 }
 const fd=fs.openSync(cursor,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd);demand(st.isFile()&&st.nlink===1&&st.size<=2000000,'Asset changed during read');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
function catalog(packageRoot,registerSkill,registerClaudeReviewer){
 const assets=new Map(),templates='v05/templates/specs';
 const visit=relative=>{
  const directory=path.join(packageRoot,relative);demand(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink(),'Unsafe template directory');
  for(const name of fs.readdirSync(directory).sort()){
   const source=relative+'/'+name,st=fs.lstatSync(path.join(packageRoot,source));
   if(st.isDirectory())visit(source);
   else {demand(name.endsWith('.md'),'Unexpected template asset');assets.set(prefix+'templates/specs/'+source.slice(templates.length+1),read(packageRoot,source));}
  }
 };
 visit(templates);
 const pkg=JSON.parse(read(packageRoot,'package.json'));
 demand(pkg.name==='agent-skill-chain'&&typeof pkg.version==='string','Invalid package identity');
 // Ship the runnable package, including its relative documentation/Skill assets.
 const runtime=prefix+'managed-runtime/';
 const runtimeFiles=JSON.parse(read(packageRoot,'src/runtime-files.json'));
 demand(Array.isArray(runtimeFiles),'Runtime file inventory required');
 for(const relative of new Set(runtimeFiles)){
  safeName(relative);const bytes=read(packageRoot,relative);
  demand(bytes!==null,'Runtime inventory file missing');assets.set(runtime+relative,bytes);
  if(relative.startsWith('skills/asc/references/'))assets.set(prefix+relative,bytes);
 }
  assets.set(prefix+'runtime.json',Buffer.from(JSON.stringify({schema:'asc-runtime/v1',version:pkg.version},null,2)+'\n'));
 assets.set(prefix+'bin/asc.mjs',read(packageRoot,'src/project-launcher.mjs'));
 for(const name of ['USAGE.md','MIGRATION_PLAN.md','GOAL_EXECUTION.md','OWNER_APPROVAL.md','RELEASE_READINESS.json']){
  const bytes=read(packageRoot,'v05/'+name);
  assets.set(prefix+'v05/'+name,name==='USAGE.md'?Buffer.from(bytes.toString().replaceAll('](templates/specs/','](../templates/specs/')):bytes);
 }
 const skill=read(packageRoot,'skills/asc/SKILL.md').toString()
  .replaceAll('../../bin/asc-v05.mjs','../../bin/asc.mjs')
  .replace('このSkillは配布パッケージ内の場所で使用する。','このSkillはプロジェクトで共有できる。入口はruntime.jsonの版と一致するローカルパッケージを使用する。標準は同梱の.agent-skill-chain/managed-runtime/で、ASC_CLIや別インストールは不要。明示的に別版の実行先を選ぶ場合だけ環境変数ASC_CLIを使う。共有ファイルに絶対パスを書かない。');
 assets.set(prefix+'skills/asc/SKILL.md',Buffer.from(skill));
 assets.set(prefix+'00_利用案内.md',Buffer.from(`# ASC v0.5 利用案内\n\n- [実行手順](v05/USAGE.md)\n- [移行手順](v05/MIGRATION_PLAN.md)\n- [実行Skill](skills/asc/SKILL.md)\n- [任意の仕様書雛形](templates/specs/00_利用案内.md)\n\nproject/と既存の固有ルールは利用者が所有し、ASC更新では変更しない。作成済み仕様書も利用者の成果物として保持する。Host用入口は明示した--register-skillで配置する。ファイル配置だけで実際のHost認識を確認したことにはならない。\n`));
 if(registerSkill)assets.set('.agents/skills/asc/SKILL.md',Buffer.from(`---
name: asc
description: ASCで許可された開発・再開・独立レビューを実行するとき、プロジェクトのASC入口を使う。通常作業へASC導入を強制しない。
---

[プロジェクトのASC Skill](../../../.agent-skill-chain/skills/asc/SKILL.md)を読み、指定されたGoalと権限の範囲で実行する。入口が欠落していれば導入状態を確認し、旧WorkflowやPATH上の別版へ推測で切り替えない。Skillの登録は外部操作や権限拡張の承認ではない。
`));
 if(registerClaudeReviewer)assets.set('.claude/agents/asc-reviewer.md',Buffer.from(`---
name: asc-reviewer
description: ASCの元要求と対象差分を独立レビューする。実装や進行管理は担当しない。
model: inherit
disallowedTools: Write, Edit, Agent
---

指定された対象を独立にレビューする。実装者の自己評価を承認根拠にしない。元要求・対象・必要な検証情報が欠ける場合は不足を報告し、推測で承認しない。対象のソース・設定・Git状態を変更せず、Hostの権限を維持する。Bashの利用は検証を可能にするためであり、OSによる書込み隔離を保証する設定ではない。

${read(packageRoot,'skills/asc/references/review.md').toString()}`));
 demand(assets.size<=256&&[...assets.values()].every(v=>Buffer.isBuffer(v)),'Invalid distribution assets');return assets;
}
function git(repo,args,input){
 const result=spawnSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.attributesFile=/dev/null',...args],{cwd:repo,input,encoding:null,maxBuffer:16000000,timeout:20000,env:{PATH:process.env.PATH,HOME:os.tmpdir(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}});
 demand(!result.error&&result.status===0,'Asset Git operation failed; inspect worktree before retry');return result.stdout;
}
export function projectAssets(directory,{apply=false,registerSkill=false,registerClaudeReviewer=false,packageRoot=defaultPackage}={}){
 const {repo}=projectLocation(directory);packageRoot=fs.realpathSync(packageRoot);
 const assets=catalog(packageRoot,registerSkill,registerClaudeReviewer),priorBytes=read(repo,record);
 let previous={};
 if(priorBytes){
  const parsed=JSON.parse(priorBytes);demand(parsed.schema==='asc-project-assets/v1'&&parsed.files&&typeof parsed.files==='object'&&!Array.isArray(parsed.files),'Invalid distribution record');
  previous=parsed.files;demand(Object.keys(previous).length<=256,'Invalid asset inventory');
  for(const [name,value] of Object.entries(previous)){safeName(name);demand(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Invalid asset digest');}
 }
 const changes=[],conflicts=[],before=new Map(),files={};
 // A normal package update preserves the explicitly installed Host entry and its
 // preimage, without gaining permission to rewrite it.
 for(const [registration,selected] of [['.agents/skills/asc/SKILL.md',registerSkill],['.claude/agents/asc-reviewer.md',registerClaudeReviewer]]){
  if(!selected&&Object.hasOwn(previous,registration))files[registration]=previous[registration];
 }
 for(const [name,bytes] of assets){
  const current=read(repo,name),actual=current===null?null:hash(current),next=hash(bytes);before.set(name,current);files[name]=next;
  if(actual===next)continue;
  if((current===null&&Object.hasOwn(previous,name))||(current!==null&&actual!==previous[name]))conflicts.push(name);
  else changes.push({path:name,action:current===null?'create':'update',beforeSha256:actual,afterSha256:next});
 }
 const retained=Object.keys(previous).filter(name=>!assets.has(name));
 const nextRecord=Buffer.from(JSON.stringify({schema:'asc-project-assets/v1',files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0))},null,2)+'\n');
 const result={schema:'asc-project-assets-plan/v1',repo,applied:false,changes,conflicts,retained,recordChanged:!priorBytes?.equals(nextRecord)};
 if(!apply||conflicts.length)return result;
 // No candidate hooks, network, index changes, deletion, or global/session locks.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-assets-'));
 try{
  const old=path.join(temp,'old'),next=path.join(temp,'new');fs.mkdirSync(old);fs.mkdirSync(next);
  const write=(base,name,bytes)=>{if(bytes===null)return;const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
  for(const change of changes){write(old,change.path,before.get(change.path));write(next,change.path,assets.get(change.path));}
  if(result.recordChanged){write(old,record,priorBytes);write(next,record,nextRecord);}
  const diff=spawnSync('git',['-c','core.attributesFile=/dev/null','diff','--no-index','--no-ext-diff','--no-textconv','--binary','--','old','new'],{cwd:temp,encoding:null,maxBuffer:16000000,timeout:20000,env:{PATH:process.env.PATH,HOME:temp,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  demand(!diff.error&&[0,1].includes(diff.status),'Cannot prepare asset patch');
  for(const [name,current] of [...before,[record,priorBytes]]){const now=read(repo,name);demand(current===null?now===null:now!==null&&current.equals(now),'Asset changed after planning');}
  if(diff.stdout.length){
   // git apply in the consumer repository would run its configured clean/smudge
   // filters. Use disposable metadata and override attributes instead.
   const metadata=path.join(temp,'metadata');git(temp,['init','--bare','--template=',metadata]);
   fs.mkdirSync(path.join(metadata,'info'),{recursive:true});
   fs.writeFileSync(path.join(metadata,'info/attributes'),'* -filter -text -ident -working-tree-encoding\n');
   git(repo,[`--git-dir=${metadata}`,`--work-tree=${repo}`,'apply','--binary','--whitespace=nowarn','-p2','-'],diff.stdout);
  }
  for(const [name,bytes] of assets)demand(read(repo,name)?.equals(bytes),'Applied asset verification failed');
  demand(read(repo,record)?.equals(nextRecord),'Applied distribution record verification failed');
  return {...result,applied:true};
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
