/** Project-owned rules are never distribution assets. Git applies one reviewed patch. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash,safeName} from './controller.mjs';
import {projectLocation} from './project-location.mjs';
const prefix='.agent-skill-chain/',record=prefix+'distribution.json';
// Fourteen Skills use 276 assets with both Hosts; reserve 12 preimages
// for two retired two-file Skills (two copies and two Host entries each).
const maxAssets=288;
const defaultPackage=fileURLToPath(new URL('..',import.meta.url));
function demand(ok,message){if(!ok)throw Error(message);}
function inspect(root,name){
 safeName(name);let cursor=root;
 const parts=name.split('/'),resolved=[];
 for(let i=0;i<parts.length;i++){
  // Resolve every component, including exact matches: two canonically equal
  // entries are ambiguous on a Unicode-sensitive filesystem. Never pick one.
  const matches=fs.readdirSync(cursor).filter(entry=>entry.normalize('NFC')===parts[i].normalize('NFC'));
  demand(matches.length<=1,'Ambiguous Unicode asset path');
  if(!matches.length)return {path:[...resolved,...parts.slice(i)].join('/'),bytes:null};
  resolved.push(matches[0]);cursor=path.join(cursor,matches[0]);const st=fs.lstatSync(cursor);
  demand(!st.isSymbolicLink(),'Asset path traverses a symlink');
  if(i<parts.length-1)demand(st.isDirectory(),'Asset parent is not a directory');
  else demand(st.isFile()&&st.nlink===1&&st.size<=2000000,'Unsafe asset file');
 }
 const fd=fs.openSync(cursor,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd);demand(st.isFile()&&st.nlink===1&&st.size<=2000000,'Asset changed during read');return {path:resolved.join('/'),bytes:fs.readFileSync(fd)};}finally{fs.closeSync(fd);}
}
function read(root,name){return inspect(root,name).bytes;}
function skillFrontmatter(bytes,name){
 const frontmatter=/^---\n([\s\S]*?)\n---\n/.exec(bytes.toString());
 demand(frontmatter&&frontmatter[1].split('\n').includes(`name: ${name}`),'Skill frontmatter must match its directory');
 // Host-neutral Skills support identity only. Never silently discard a Host's
 // invocation/tool restrictions or interpret unsupported YAML as configuration.
 const fields=frontmatter[1].split('\n');
 demand(fields.length===2&&fields.filter(line=>line===`name: ${name}`).length===1&&fields.filter(line=>/^description: .+$/.test(line)).length===1,'Unsupported Skill frontmatter; only name and single-line description are supported');
 return frontmatter[0];
}
function validateCodexDisplayMetadata(packageRoot,name){
 const bytes=read(packageRoot,`skills/${name}/agents/openai.yaml`);
 if(bytes===null)return;
 const lines=bytes.toString().trimEnd().split('\n'),keys=new Set();
 const message='Unsupported Codex Skill metadata; only quoted interface display fields are supported';
 demand(lines.shift()==='interface:',message);
 for(const line of lines){
  if(!line.trim()||/^\s*#/.test(line))continue;
  const field=/^ {2}(display_name|short_description|default_prompt): (.+)$/.exec(line);
  demand(field&&!keys.has(field[1]),message);keys.add(field[1]);
  let value;try{value=JSON.parse(field[2]);}catch{throw Error(message);}
  demand(typeof value==='string',message);
 }
 demand(keys.size>0,message);
}
function catalog(packageRoot,hosts){
 const assets=new Map(),skillNames=[],templates='v05/templates/specs';
 const pkg=JSON.parse(read(packageRoot,'package.json'));
 demand(pkg.name==='agent-skill-chain'&&typeof pkg.version==='string','Invalid package identity');
 // Ship the runnable package, including its relative documentation/Skill assets.
 const runtime=prefix+'managed-runtime/';
 const runtimeFiles=JSON.parse(read(packageRoot,'src/runtime-files.json'));
 demand(Array.isArray(runtimeFiles),'Runtime file inventory required');
 demand(runtimeFiles.every(relative=>typeof relative==='string'&&relative===relative.normalize('NFC')),'Runtime inventory paths must use NFC');
 for(const relative of new Set(runtimeFiles)){
  safeName(relative);const bytes=read(packageRoot,relative);
  demand(bytes!==null,'Runtime inventory file missing');
  if(relative.startsWith(templates+'/')){
   demand(relative.endsWith('.md'),'Unexpected template asset');
   assets.set(prefix+'templates/specs/'+relative.slice(templates.length+1),bytes);
  }
  assets.set(runtime+relative,bytes);
  if(relative.startsWith('skills/'))assets.set(prefix+relative,bytes);
  const entry=/^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/.exec(relative);
  if(entry)skillNames.push(entry[1]);
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
 assets.set(prefix+'00_利用案内.md',Buffer.from(`# ASC v0.5 利用案内\n\n- [実行手順](v05/USAGE.md)\n- [移行手順](v05/MIGRATION_PLAN.md)\n- [実行Skill](skills/asc/SKILL.md)\n- [開発基盤・規約の構築Skill](skills/project-foundation/SKILL.md)\n- [目的別Skill一覧](skills/README.md)\n- [任意の仕様書雛形](templates/specs/00_利用案内.md)\n\nproject/と既存の固有ルールは利用者が所有し、ASC更新では変更しない。作成済み仕様書も利用者の成果物として保持する。Host用入口は明示した--register-skill（.agents）または--register-claude-skill（.claude）で配置する。ファイル配置だけで実際のHost認識を確認したことにはならない。\n`));
 const metadata=new Map();
 if(hosts.length)for(const name of skillNames){
  metadata.set(name,skillFrontmatter(assets.get(prefix+`skills/${name}/SKILL.md`),name));
  if(hosts.includes('.agents'))validateCodexDisplayMetadata(packageRoot,name);
 }
 for(const host of hosts){
 assets.set(`${host}/skills/asc/SKILL.md`,Buffer.from(`---
name: asc
description: ASCで許可された開発・再開・独立レビューを実行するとき、プロジェクトのASC入口を使う。通常作業へASC導入を強制しない。
---

[プロジェクトのASC Skill](../../../.agent-skill-chain/skills/asc/SKILL.md)を読み、指定されたGoalと権限の範囲で実行する。入口が欠落していれば導入状態を確認し、旧WorkflowやPATH上の別版へ推測で切り替えない。Skillの登録は外部操作や権限拡張の承認ではない。
`));
 for(const name of skillNames){
  if(name==='asc')continue;
  // Optional Codex display metadata stays in the canonical asset tree.
  assets.set(`${host}/skills/${name}/SKILL.md`,Buffer.from(metadata.get(name)+`\n[${name}](../../../.agent-skill-chain/skills/${name}/SKILL.md)の本文を読み、今回の要求に必要なreferencesをその本文の指示に従って読み適用する。参照先は正本のSkillディレクトリを基準に解決する。入口が欠落していれば導入状態を確認し、推測で別版へ切り替えない。Skillの登録は外部操作や権限拡張の承認ではない。\n`));
 }
 }
 demand(assets.size<=maxAssets&&[...assets.values()].every(v=>Buffer.isBuffer(v)),'Invalid distribution assets');return assets;
}
function git(repo,args,input){
 const result=spawnSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.attributesFile=/dev/null',...args],{cwd:repo,input,encoding:null,maxBuffer:16000000,timeout:20000,env:{PATH:process.env.PATH,HOME:os.tmpdir(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}});
 demand(!result.error&&result.status===0,'Asset Git operation failed; inspect worktree before retry');return result.stdout;
}
export function projectAssets(directory,{apply=false,registerSkill=false,registerClaudeSkill=false,packageRoot=defaultPackage}={}){
 const {repo}=projectLocation(directory);packageRoot=fs.realpathSync(packageRoot);
 const hosts=[...(registerSkill?['.agents']:[]),...(registerClaudeSkill?['.claude']:[])];
 const assets=catalog(packageRoot,hosts),priorBytes=read(repo,record);
 const previous=Object.create(null);
 if(priorBytes){
  const parsed=JSON.parse(priorBytes);demand(parsed.schema==='asc-project-assets/v1'&&parsed.files&&typeof parsed.files==='object'&&!Array.isArray(parsed.files),'Invalid distribution record');
  demand(Object.keys(parsed.files).length<=maxAssets,'Invalid asset inventory');
  for(const [name,value] of Object.entries(parsed.files)){
   safeName(name);const canonical=name.normalize('NFC');
   demand(!Object.hasOwn(previous,canonical),'Ambiguous Unicode asset inventory');
   demand(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Invalid asset digest');previous[canonical]=value;
  }
 }
 // Retain original preimages even when a Skill disappears or this Host was not
 // selected. Re-reading retained files here would adopt owner edits as managed.
 const changes=[],conflicts=[],before=new Map(),files={...previous};
 for(const [name,bytes] of assets){
  const currentFile=inspect(repo,name),current=currentFile.bytes,actual=current===null?null:hash(current),next=hash(bytes);before.set(name,currentFile);files[name]=next;
  if(actual===next)continue;
  if((current===null&&Object.hasOwn(previous,name))||(current!==null&&actual!==previous[name]))conflicts.push(name);
  else changes.push({path:name,action:current===null?'create':'update',beforeSha256:actual,afterSha256:next});
 }
 demand(Object.keys(files).length<=maxAssets,'Invalid asset inventory');
 const retained=Object.keys(previous).filter(name=>!assets.has(name));
 const nextRecord=Buffer.from(JSON.stringify({schema:'asc-project-assets/v1',files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0))},null,2)+'\n');
 const result={schema:'asc-project-assets-plan/v1',repo,applied:false,changes,conflicts,retained,recordChanged:!priorBytes?.equals(nextRecord)};
 if(!apply||conflicts.length)return result;
 // No candidate hooks, network, index changes, deletion, or global/session locks.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-assets-'));
 try{
  const old=path.join(temp,'old'),next=path.join(temp,'new');fs.mkdirSync(old);fs.mkdirSync(next);
  const write=(base,name,bytes)=>{if(bytes===null)return;const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
  for(const change of changes){const current=before.get(change.path);write(old,current.path,current.bytes);write(next,current.path,assets.get(change.path));}
  if(result.recordChanged){write(old,record,priorBytes);write(next,record,nextRecord);}
  const diff=spawnSync('git',['-c','core.attributesFile=/dev/null','diff','--no-index','--no-ext-diff','--no-textconv','--binary','--','old','new'],{cwd:temp,encoding:null,maxBuffer:16000000,timeout:20000,env:{PATH:process.env.PATH,HOME:temp,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  demand(!diff.error&&[0,1].includes(diff.status),'Cannot prepare asset patch');
  for(const [name,current] of [...before,[record,{path:record,bytes:priorBytes}]]){const now=inspect(repo,name);demand(current.path===now.path&&(current.bytes===null?now.bytes===null:now.bytes!==null&&current.bytes.equals(now.bytes)),'Asset changed after planning');}
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
