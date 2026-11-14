/** Project-owned rules are never distribution assets. Git applies one reviewed patch. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash,safeName} from './controller.mjs';
import {projectLocation} from './project-location.mjs';
const prefix='.agent-skill-chain/',record=prefix+'distribution.json';
const hostNames=['.agents','.claude'];
const hostEntry=/^(\.agents|\.claude)\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/;
// Sixteen registered Skills plus two optional assets use 292 assets; reserve 12 preimages
// for retained canonical/runtime assets. Retired owned Host entries are removed.
const maxAssets=304;
const defaultPackage=fileURLToPath(new URL('..',import.meta.url));
// Exact retired distribution paths, maintained by trusted package releases.
const retiredAssetPaths=[];
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
 try{const st=fs.fstatSync(fd);demand(st.isFile()&&st.nlink===1&&st.size<=2000000,'Asset changed during read');return {path:resolved.join('/'),bytes:fs.readFileSync(fd),mode:st.mode&0o777,specialMode:st.mode&0o7000,dev:st.dev,ino:st.ino};}finally{fs.closeSync(fd);}
}
function read(root,name){return inspect(root,name).bytes;}
function sameBytes(a,b){return a===null?b===null:b!==null&&a.equals(b);}
function restorePreimages(repo,transaction){
 const failed=[];
 for(const [name,original,expected] of [...transaction].reverse())try{
  const current=inspect(repo,name);
  if(current.path===original.path&&sameBytes(original.bytes,current.bytes))continue;
  demand(current.path===original.path&&sameBytes(expected,current.bytes),'Asset changed during rollback');
  const target=path.join(repo,original.path);
  if(original.bytes===null)fs.unlinkSync(target);
  else{
   fs.mkdirSync(path.dirname(target),{recursive:true});
   const flags=fs.constants.O_RDWR|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK|(current.bytes===null?fs.constants.O_CREAT|fs.constants.O_EXCL:0);
   const fd=fs.openSync(target,flags,original.mode);
   try{
    const st=fs.fstatSync(fd);demand(st.isFile()&&st.nlink===1,'Unsafe rollback file');
    if(current.bytes!==null){
     demand(st.dev===current.dev&&st.ino===current.ino&&st.size===current.bytes.length,'Asset changed during rollback');
     const bytes=Buffer.alloc(st.size);demand(fs.readSync(fd,bytes,0,bytes.length,0)===bytes.length&&bytes.equals(current.bytes),'Asset changed during rollback');
    }
    fs.ftruncateSync(fd,0);fs.writeFileSync(fd,original.bytes);fs.fchmodSync(fd,original.mode);
   }finally{fs.closeSync(fd);}
  }
 }catch{failed.push(name);}
 return failed;
}
function skillFrontmatter(bytes,name){
 const frontmatter=/^---\n([\s\S]*?)\n---\n/.exec(bytes.toString());
 demand(frontmatter&&frontmatter[1].split('\n').includes(`name: ${name}`),'Skill frontmatter must match its directory');
 // Host-neutral Skills support identity only. Never silently discard a Host's
 // invocation/tool restrictions or interpret unsupported YAML as configuration.
 const fields=frontmatter[1].split('\n');
 demand(fields.length===2&&fields.filter(line=>line===`name: ${name}`).length===1&&fields.filter(line=>/^description: .+$/.test(line)).length===1,'Unsupported Skill frontmatter; only name and single-line description are supported');
 return frontmatter[0];
}
function entryBytes(name,frontmatter='---\nname: asc\ndescription: ASCで許可された開発・再開・独立レビューを実行するとき、プロジェクトのASC入口を使う。通常作業へASC導入を強制しない。\n---\n'){
 // The default preserves the known v1 ASC wrapper preimage for migration only.
 return Buffer.from(frontmatter+(name==='asc'?`
[プロジェクトのASC Skill](../../../.agent-skill-chain/skills/asc/SKILL.md)を読み、指定されたGoalと権限の範囲で実行する。入口が欠落していれば導入状態を確認し、旧WorkflowやPATH上の別版へ推測で切り替えない。Skillの登録は外部操作や権限拡張の承認ではない。
`:`\n[${name}](../../../.agent-skill-chain/skills/${name}/SKILL.md)の本文を読み、今回の要求に必要なreferencesをその本文の指示に従って読み適用する。参照先は正本のSkillディレクトリを基準に解決する。入口が欠落していれば導入状態を確認し、推測で別版へ切り替えない。Skillの登録は外部操作や権限拡張の承認ではない。\n`));
}
function provenEntry(repo,name,previous){
 const skill=hostEntry.exec(name)[2];
 if(skill==='asc'&&hash(entryBytes(skill))===previous[name])return true;
 for(const source of [prefix+`skills/${skill}/SKILL.md`,prefix+`managed-runtime/skills/${skill}/SKILL.md`,name]){
  if(!Object.hasOwn(previous,source))continue;
  const bytes=read(repo,source);if(bytes===null||hash(bytes)!==previous[source])continue;
  // A path/hash claim alone cannot make unrelated owner content an ASC entry.
  // Prove a known generated wrapper preimage, independently of its current edit.
  try{if(hash(entryBytes(skill,skillFrontmatter(bytes,skill)))===previous[name])return true;}catch{ /* not a known generated preimage */ }
 }
 return false;
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
 assets.set(prefix+'00_利用案内.md',Buffer.from(`# ASC v0.5 利用案内\n\n- [実行手順](v05/USAGE.md)\n- [移行手順](v05/MIGRATION_PLAN.md)\n- [実行Skill](skills/asc/SKILL.md)\n- [開発基盤・規約の構築Skill](skills/project-foundation/SKILL.md)\n- [目的別Skill一覧](skills/README.md)\n- [任意の仕様書雛形](templates/specs/00_利用案内.md)\n\nproject/と既存の固有ルールは利用者が所有し、ASC更新では変更しない。作成済み仕様書も利用者の成果物として保持する。Host用入口は初回に--register-skill（.agents）または--register-claude-skill（.claude）で選ぶ。登録したHostの入口は以後の通常更新で追加・更新し、配布からなくなった未編集の管理入口だけを削除する。ファイル配置だけで実際のHost認識を確認したことにはならない。\n`));
 const metadata=new Map();
 if(hosts.length)for(const name of skillNames){
  metadata.set(name,skillFrontmatter(assets.get(prefix+`skills/${name}/SKILL.md`),name));
  if(hosts.includes('.agents'))validateCodexDisplayMetadata(packageRoot,name);
 }
 for(const host of hosts)for(const name of skillNames)assets.set(`${host}/skills/${name}/SKILL.md`,entryBytes(name,metadata.get(name)));
 demand(assets.size<=maxAssets&&[...assets.values()].every(v=>Buffer.isBuffer(v)),'Invalid distribution assets');return assets;
}
const gitTimeoutMilliseconds=20000;
// Name why a Git child failed, so that a timeout under load can be told apart from an error reported by Git.
function gitFailureReason(result){if(result.error?.code==='ETIMEDOUT')return `timed out after ${gitTimeoutMilliseconds} ms`;if(result.error)return `could not run: ${result.error.code??result.error.message}`;if(result.signal)return `terminated by ${result.signal}`;return `exit status ${result.status}`;}
function git(repo,args,input){
 const result=spawnSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.attributesFile=/dev/null',...args],{cwd:repo,input,encoding:null,maxBuffer:16000000,timeout:gitTimeoutMilliseconds,env:{PATH:process.env.PATH,HOME:os.tmpdir(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}});
 if(result.error||result.status!==0)throw Error(`Asset Git operation failed (${gitFailureReason(result)}); inspect worktree before retry`);return result.stdout;
}
function distributionState(repo){
 const priorRecord=inspect(repo,record),priorBytes=priorRecord.bytes,previous=Object.create(null),selected=new Set(),owned=new Set(),ownershipConflicts=[];
 let parsed;
 if(priorBytes){
  parsed=JSON.parse(priorBytes);demand(parsed.schema==='asc-project-assets/v1'&&parsed.files&&typeof parsed.files==='object'&&!Array.isArray(parsed.files),'Invalid distribution record');
  demand(Object.keys(parsed.files).length<=maxAssets,'Invalid asset inventory');
  for(const [name,value] of Object.entries(parsed.files)){
   safeName(name);const canonical=name.normalize('NFC');
   demand(!Object.hasOwn(previous,canonical),'Ambiguous Unicode asset inventory');
   demand(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Invalid asset digest');previous[canonical]=value;
  }
 }
 // Records persist selection and ownership claims, but neither a modern claim
 // nor a legacy path/hash alone proves a generated wrapper preimage.
 if(parsed&&('registeredHosts' in parsed||'hostEntries' in parsed)){
  demand(Array.isArray(parsed.registeredHosts)&&parsed.registeredHosts.every(host=>hostNames.includes(host))&&new Set(parsed.registeredHosts).size===parsed.registeredHosts.length,'Invalid registered Hosts');
  demand(Array.isArray(parsed.hostEntries)&&parsed.hostEntries.length<=maxAssets&&new Set(parsed.hostEntries).size===parsed.hostEntries.length,'Invalid Host entry inventory');
  for(const host of parsed.registeredHosts)selected.add(host);
  for(const name of parsed.hostEntries){
   demand(typeof name==='string'&&hostEntry.test(name)&&selected.has(hostEntry.exec(name)[1])&&Object.hasOwn(previous,name),'Invalid Host entry ownership');
   if(provenEntry(repo,name,previous))owned.add(name);else ownershipConflicts.push(name);
  }
 }else for(const name of Object.keys(previous)){
  const entry=hostEntry.exec(name);if(!entry)continue;
  const host=entry[1];
  if(provenEntry(repo,name,previous)){selected.add(host);owned.add(name);}else ownershipConflicts.push(name);
 }
 return {priorRecord,priorBytes,previous,selected,owned,ownershipConflicts};
}
export function projectAssets(directory,{apply=false,registerSkill=false,registerClaudeSkill=false,packageRoot=defaultPackage}={}){
 const {repo}=projectLocation(directory);packageRoot=fs.realpathSync(packageRoot);
 const {priorRecord,priorBytes,previous,selected,owned,ownershipConflicts}=distributionState(repo);
 if(registerSkill)selected.add('.agents');if(registerClaudeSkill)selected.add('.claude');
 const hosts=hostNames.filter(host=>selected.has(host)),assets=catalog(packageRoot,hosts);
 // Retained canonical/runtime assets keep their original preimages. Only
 // explicitly owned Host entries can be retired, never directories or siblings.
 const changes=[],conflicts=[...ownershipConflicts],before=new Map(),files={...previous},nextOwned=new Set();
 const change=(name,action,actual,next)=>({path:name,kind:hostEntry.test(name)?'host-entry':'asset',...(hostEntry.test(name)?{host:hostEntry.exec(name)[1]}:{}),action,beforeSha256:actual,afterSha256:next});
 for(const [name,bytes] of assets){
  const currentFile=inspect(repo,name),current=currentFile.bytes,actual=current===null?null:hash(current),next=hash(bytes);before.set(name,currentFile);files[name]=next;
  const entry=hostEntry.test(name);
  if(entry)nextOwned.add(name);
  if((entry&&current!==null&&!owned.has(name))||
    (current===null?Object.hasOwn(previous,name):actual!==previous[name])){
   if(!conflicts.includes(name))conflicts.push(name);continue;
  }
  if(actual===next)continue;
  changes.push(change(name,current===null?'create':'update',actual,next));
 }
 for(const name of owned){
  if(assets.has(name))continue;
  const currentFile=inspect(repo,name),actual=currentFile.bytes===null?null:hash(currentFile.bytes);before.set(name,currentFile);
  if(actual!==previous[name]){conflicts.push(name);continue;}
  changes.push(change(name,'delete',actual,null));delete files[name];
 }
 demand(Object.keys(files).length<=maxAssets,'Invalid asset inventory');
 const retained=Object.keys(previous).filter(name=>!assets.has(name)&&Object.hasOwn(files,name));
 const nextRecord=Buffer.from(JSON.stringify({schema:'asc-project-assets/v1',registeredHosts:hosts,hostEntries:[...nextOwned].sort(),files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0))},null,2)+'\n');
 const result={schema:'asc-project-assets-plan/v1',repo,applied:false,registeredHosts:hosts,changes,conflicts,retained,recordChanged:!priorBytes?.equals(nextRecord)};
 if(!apply||conflicts.length)return result;
 // No candidate hooks, network, index changes, or global/session locks.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-assets-'));
 const transaction=changes.map(change=>[change.path,before.get(change.path),assets.get(change.path)??null]);
 if(result.recordChanged)transaction.push([record,priorRecord,nextRecord]);
 let applying=false;
 try{
  const old=path.join(temp,'old'),next=path.join(temp,'new');fs.mkdirSync(old);fs.mkdirSync(next);
  const write=(base,name,bytes)=>{if(bytes===null)return;const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
  for(const change of changes){const current=before.get(change.path);write(old,current.path,current.bytes);write(next,current.path,assets.get(change.path)??null);}
  if(result.recordChanged){write(old,record,priorBytes);write(next,record,nextRecord);}
  const diff=spawnSync('git',['-c','core.attributesFile=/dev/null','diff','--no-index','--no-ext-diff','--no-textconv','--binary','--','old','new'],{cwd:temp,encoding:null,maxBuffer:16000000,timeout:gitTimeoutMilliseconds,env:{PATH:process.env.PATH,HOME:temp,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  if(diff.error||![0,1].includes(diff.status))throw Error(`Cannot prepare asset patch (${gitFailureReason(diff)})`);
  for(const [name,current] of [...before,[record,{path:record,bytes:priorBytes}]]){const now=inspect(repo,name);demand(current.path===now.path&&(current.bytes===null?now.bytes===null:now.bytes!==null&&current.bytes.equals(now.bytes)),'Asset changed after planning');}
  if(diff.stdout.length){
   // git apply in the consumer repository would run its configured clean/smudge
   // filters. Use disposable metadata and override attributes instead.
   const metadata=path.join(temp,'metadata');git(temp,['init','--bare','--template=',metadata]);
   fs.mkdirSync(path.join(metadata,'info'),{recursive:true});
   fs.writeFileSync(path.join(metadata,'info/attributes'),'* -filter -text -ident -working-tree-encoding\n');
   applying=true;
   git(repo,[`--git-dir=${metadata}`,`--work-tree=${repo}`,'apply','--binary','--whitespace=nowarn','-p2','-'],diff.stdout);
  }
  for(const [name,bytes] of assets)demand(read(repo,name)?.equals(bytes),'Applied asset verification failed');
  for(const change of changes)if(change.action==='delete')demand(read(repo,change.path)===null,'Retired Host entry verification failed');
  demand(read(repo,record)?.equals(nextRecord),'Applied distribution record verification failed');
  return {...result,applied:true};
 }catch(error){
  if(applying){const failed=restorePreimages(repo,transaction);if(failed.length)throw Error(`Asset update failed; rollback incomplete for ${failed.join(', ')}; restore the saved distribution before retry`,{cause:error});}
  throw error;
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}

function uninstallCatalog(packageRoot){
 const known=new Set(catalog(packageRoot,hostNames).keys());
 // Trust the executing package catalog, including when it is bundled locally.
 // A record cannot nominate another inventory as authority. Releases retain
 // exact retired paths here so updates do not strand their old distribution.
 const retired=retiredAssetPaths;
 demand(Array.isArray(retired)&&retired.length<=maxAssets&&new Set(retired).size===retired.length,'Invalid retired asset catalog');
 for(const name of retired){
  safeName(name);demand(name===name.normalize('NFC'),'Retired asset catalog paths must use NFC');
  const relative=name.startsWith(prefix+'managed-runtime/')?name.slice((prefix+'managed-runtime/').length):null;
  const runtime=relative!==null&&(/^(?:src|bin)\/[a-z0-9-]+\.(?:mjs|json)$/.test(relative)||/^(?:package\.json|README\.md|migration_inspect\.mjs)$/.test(relative)||/^v05\/(?:[A-Z0-9_]+\.(?:md|json)|templates\/specs\/.+\.md|optional-skills\/[a-z0-9-]+\/(?:SKILL\.md|agents\/openai\.yaml))$/.test(relative)||/^skills\/(?:README\.md|[a-z0-9-]+\/(?:SKILL\.md|agents\/openai\.yaml|references\/.+\.md))$/.test(relative));
  const canonical=/^\.agent-skill-chain\/(?:skills\/(?:README\.md|[a-z0-9-]+\/(?:SKILL\.md|agents\/openai\.yaml|references\/.+\.md))|templates\/specs\/.+\.md|v05\/[A-Z0-9_]+\.(?:md|json)|bin\/asc\.mjs|runtime\.json|00_利用案内\.md)$/.test(name);
  demand(runtime||canonical||hostEntry.test(name),'Invalid retired asset path');known.add(name);
 }
 return known;
}

/** Remove only recorded, unchanged files inside the trusted distribution catalog. */
export function uninstallProjectAssets(directory,{apply=false,packageRoot=defaultPackage}={}){
 const {repo}=projectLocation(directory);
 const {priorRecord,priorBytes,previous,selected,owned,ownershipConflicts}=distributionState(repo);
 const result={schema:'asc-project-uninstall-plan/v1',repo,applied:false,recordPresent:priorBytes!==null,registeredHosts:hostNames.filter(host=>selected.has(host)),changes:[],conflicts:[...ownershipConflicts]};
 if(priorBytes===null)return {...result,notice:'No distribution record; unrecorded files were not inspected or removed.'};
 // ASC does not distribute special permissions. Refuse them before removal,
 // rather than recreate privileged files during a partial-failure rollback.
 demand(priorRecord.specialMode===0,'Unsafe asset permissions');
 const known=uninstallCatalog(fs.realpathSync(packageRoot)),before=new Map();
 for(const name of Object.keys(previous).sort()){
  if(!known.has(name)||(hostEntry.test(name)&&!owned.has(name))){if(!result.conflicts.includes(name))result.conflicts.push(name);continue;}
  const original=inspect(repo,name),actual=original.bytes===null?null:hash(original.bytes);
  if(original.bytes!==null)demand(original.specialMode===0,'Unsafe asset permissions');before.set(name,original);
  if(actual!==previous[name]){if(!result.conflicts.includes(name))result.conflicts.push(name);continue;}
  result.changes.push({path:name,kind:hostEntry.test(name)?'host-entry':'asset',...(hostEntry.test(name)?{host:hostEntry.exec(name)[1]}:{}),action:'delete',beforeSha256:actual,afterSha256:null});
 }
 result.changes.push({path:record,kind:'distribution-record',action:'delete',beforeSha256:hash(priorBytes),afterSha256:null});before.set(record,priorRecord);
 if(!apply||result.conflicts.length)return result;
 const unchanged=(name,original)=>{
  const current=inspect(repo,name);
  demand(current.path===original.path&&current.dev===original.dev&&current.ino===original.ino&&current.mode===original.mode&&current.specialMode===original.specialMode&&sameBytes(current.bytes,original.bytes),'Asset changed after planning');
 };
 // Validate the complete plan before deleting anything, then recheck each file
 // immediately before unlink. Never recursively remove project or Host folders.
 for(const [name,original] of before)unchanged(name,original);
 const transaction=[];
 try{
  for(const [name,original] of before){
   unchanged(name,original);transaction.push([name,original,null]);fs.unlinkSync(path.join(repo,original.path));
  }
  for(const [name] of before)demand(read(repo,name)===null,'Uninstalled asset verification failed');
  return {...result,applied:true};
 }catch(error){
  const failed=restorePreimages(repo,transaction);
  if(failed.length)throw Error(`Asset uninstall failed; rollback incomplete for ${failed.join(', ')}; restore the saved distribution before retry`,{cause:error});
  throw error;
 }
}
