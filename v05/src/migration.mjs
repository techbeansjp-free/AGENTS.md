/** Non-destructive evaluation transition. Legacy source and approvals stay untouched. */
import {SOURCE_FILE_BYTES} from './source-limits.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {inspectMigration} from '../migration_inspect.mjs';import {Controller,safeName,hash} from './controller.mjs';
const manifestName='transition.json',manifestByteLimit=16*1024*1024;
function demand(ok,message){if(!ok)throw Error(message);}
const contains=(a,b)=>{const r=path.relative(a,b);return !r || (!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
function git(root,...args){
 const nul=process.platform==='win32'?'NUL':'/dev/null';
 const p=spawnSync('git',['-c','core.fsmonitor=false','-c',`core.hooksPath=${nul}`,'-c','uploadpack.packObjectsHook=',
 '-c','core.alternateRefsCommand=','-c','protocol.allow=never','-c','protocol.file.allow=always',...args],
 {cwd:root,env:{PATH:process.env.PATH,HOME:os.tmpdir(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:nul,GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'},timeout:120000,maxBuffer:16*1024*1024});
 demand(!p.error&&p.status===0,'Migration Git operation failed');return p.stdout;
}
function writeManifest(root,data){
 const content=JSON.stringify(data,null,2)+'\n';
 demand(Buffer.byteLength(content)<manifestByteLimit,'Transition metadata size limit');
 const file=path.join(root,`.transition-${process.pid}-${Date.now()}.tmp`);
 fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
 fs.renameSync(file,path.join(root,manifestName));
}
function readManifest(root){
 const file=path.join(root,manifestName),s=fs.lstatSync(file);
 demand(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<manifestByteLimit,'Unsafe transition metadata');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
 let data;try{const st=fs.fstatSync(fd);demand(st.isFile()&&st.nlink===1&&st.size<manifestByteLimit,'Changed metadata');data=JSON.parse(fs.readFileSync(fd));}finally{fs.closeSync(fd);}
 demand(data.schema==='asc-v05-transition/v1'&&typeof data.source==='string'&&/^[a-f0-9]{40}$/.test(data.sourceHead)&&
  ['preparing','prepared','rolled-back'].includes(data.state),'Invalid transition metadata');
 return data;
}
export function prepareMigration(source,destination){
 const origin=fs.realpathSync(source),parent=fs.realpathSync(path.dirname(path.resolve(destination)));
 const root=path.join(parent,path.basename(destination));
 demand(!contains(origin,root)&&!contains(root,origin),'Transition must be outside legacy project');
 if(fs.existsSync(root)){
  demand(fs.lstatSync(root).isDirectory()&&!fs.lstatSync(root).isSymbolicLink(),'Unsafe transition directory');
  const previous=readManifest(root);
  demand(previous.source===origin&&previous.state==='prepared','Incomplete or incompatible transition; retained for inspection');
  // Retry never resets the candidate or consumes old approvals.
  const current=inspectMigration(origin);
  demand(current.head===previous.sourceHead&&current.blockers.every(b=>b==='migration-execution-not-performed'),'Legacy source changed after preparation');
  const candidate=path.join(root,'project'),metadata=path.join(candidate,'.git');
  demand(fs.lstatSync(candidate).isDirectory()&&!fs.lstatSync(candidate).isSymbolicLink()&&fs.lstatSync(metadata).isDirectory()&&!fs.lstatSync(metadata).isSymbolicLink(),'Prepared clone replaced');
  demand(!fs.existsSync(path.join(metadata,'objects/info/alternates')),'Prepared clone shares object storage');
  git(candidate,'merge-base','--is-ancestor',previous.sourceHead,'HEAD');
  return {...previous,candidate,idempotent:true};
 }
 const inspection=inspectMigration(origin);
 demand(inspection.blockers.every(b=>b==='migration-execution-not-performed'),'Resolve migration inspection blockers first');
 fs.mkdirSync(root,{mode:0o700});
 const initial={schema:'asc-v05-transition/v1',state:'preparing',source:origin,sourceHead:inspection.head,
  inventory:inspection.inventory,legacyEvidenceImported:false,releaseReady:false,selection:'legacy'};
 writeManifest(root,initial);
 const candidate=path.join(root,'project');
 git(parent,'clone','--no-local','--no-hardlinks','--no-checkout','--single-branch','--',origin,candidate);
 demand(git(candidate,'rev-parse','HEAD').toString().trim()===inspection.head,'Clone does not match inspected HEAD');
 git(candidate,'remote','remove','origin');
 const entries=git(candidate,'ls-tree','-rz','--full-tree',inspection.head).toString().split('\0').filter(Boolean);
 let total=0;const names=new Set();
 for(const entry of entries){
  const tab=entry.indexOf('\t'),[mode,kind,oid]=entry.slice(0,tab).split(' '),name=entry.slice(tab+1);safeName(name);
  demand(kind==='blob'&&['100644','100755'].includes(mode)&&!names.has(name.toLowerCase()),'Unsupported migration source');names.add(name.toLowerCase());
  const size=Number(git(candidate,'cat-file','-s',oid).toString());total+=size;
  demand(Number.isSafeInteger(size)&&size>=0&&size<=SOURCE_FILE_BYTES&&total<=200000000,'Migration size limit');
  const data=git(candidate,'cat-file','blob',oid);demand(data.length===size,'Changed migration blob');
  const file=path.join(candidate,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data,{flag:'wx',mode:mode==='100755'?0o755:0o644});
 }
 git(candidate,'read-tree',inspection.head);
 const after=inspectMigration(origin);
 demand(after.head===inspection.head&&after.blockers.every(b=>b==='migration-execution-not-performed'),'Legacy source changed during migration');
 const cloned=inspectMigration(candidate);demand(cloned.head===inspection.head&&cloned.blockers.every(b=>b==='migration-execution-not-performed'),'Exported project did not match legacy source');
 const final={...initial,state:'prepared',selection:'v05-evaluation',inventoryDigest:hash(JSON.stringify(inspection.inventory))};writeManifest(root,final);
 return {...final,candidate,idempotent:false};
}
export function rollbackMigration(destination){
 const root=fs.realpathSync(destination),state=readManifest(root);
 demand(state.state==='prepared'||state.state==='rolled-back','Cannot roll back incomplete transition automatically');
 demand(fs.realpathSync(state.source)===state.source,'Legacy location changed');
 const currentHead=git(state.source,'rev-parse','HEAD').toString().trim();
 const final={...state,state:'rolled-back',selection:'legacy'};writeManifest(root,final);
 return {...final,currentLegacyHead:currentHead,candidatePreserved:path.join(root,'project'),
  needsLegacyReverification:true,authorityRestored:false};
}

/** Fresh non-shared source clone; no legacy migration state or approvals imported. */
export function cloneSource(source,destination,head,sourceHead=head){
 const origin=fs.realpathSync(source),parent=fs.realpathSync(path.dirname(destination));
 demand(path.isAbsolute(destination)&&!fs.existsSync(destination)&&!contains(origin,destination)&&!contains(destination,origin),'Unsafe clone destination');
 git(parent,'clone','--no-local','--no-hardlinks','--no-checkout','--single-branch','--',origin,destination);
 demand(git(destination,'rev-parse','HEAD').toString().trim()===sourceHead,'Source changed during clone');
 if(head!==sourceHead){git(destination,'merge-base','--is-ancestor',head,sourceHead);git(destination,'update-ref','HEAD',head,sourceHead);}
 git(destination,'remote','remove','origin');
 const observer=new Controller({repo:destination,base:head,contract:{},implementer:'host-clone'});
 for(const [name,blob] of observer.blobs(head)){
  const file=path.join(destination,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,blob.bytes,{flag:'wx',mode:blob.mode==='100755'?0o755:0o644});
 }
 git(destination,'read-tree',head);return destination;
}

/** Owner-authored configuration cutover, staged only in a new independent clone.
 * No configuration is executed, no legacy approval is imported, and no source
 * repository or global CLI/Skill installation is changed.
 */
export function stageMigration(source,destination,plan){
 const origin=fs.realpathSync(source),inspection=inspectMigration(origin);
 demand(inspection.blockers.every(b=>['manifest-policy-cutover-required','migration-execution-not-performed'].includes(b)), 'Resolve migration inspection blockers first');
 demand(plan?.schema==='asc-v05-cutover/v1'&&plan.sourceHead===inspection.head&&Array.isArray(plan.files)&&plan.files.length<=256,'Invalid cutover plan or stale source HEAD');
 const inventory=new Map(inspection.configurationInventory.map(e=>[e.path,e]));
 const seen=new Set(),replacements=[];
 for(const item of plan.files){
  demand(item&&typeof item.path==='string','Invalid cutover file');safeName(item.path);
  const key=item.path.toLowerCase();demand(!seen.has(key),'Duplicate cutover file');seen.add(key);
  const prior=inventory.get(item.path);
  demand(prior&&item.beforeSha256===prior.sha256,'Unknown configuration or stale preimage');
  demand(item.action==='retain'||item.action==='replace','Explicit retain or replace required');
  if(item.action==='replace'){
   demand(typeof item.content==='string'&&Buffer.byteLength(item.content)<=5000000,'Invalid replacement contents');
   replacements.push(item);
  } else demand(item.content===undefined,'Retained file cannot include replacement contents');
 }
 demand(plan.files.length===inventory.size,'Every configuration entry requires an owner decision');
 const parent=fs.realpathSync(path.dirname(path.resolve(destination))),root=path.join(parent,path.basename(destination));
 demand(!contains(origin,root)&&!contains(root,origin)&&!fs.existsSync(root),'Cutover requires a new location outside source');
 fs.mkdirSync(root,{mode:0o700});
 const initial={schema:'asc-v05-transition/v1',state:'preparing',source:origin,sourceHead:inspection.head,
  selection:'legacy',legacyEvidenceImported:false,releaseReady:false,cutoverPlanDigest:hash(JSON.stringify(plan))};
 writeManifest(root,initial);
 const candidate=cloneSource(origin,path.join(root,'project'),inspection.head);
 for(const item of replacements){
  const file=path.join(candidate,item.path),st=fs.lstatSync(file);
  demand(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&hash(fs.readFileSync(file))===item.beforeSha256,'Cutover preimage changed');
  fs.writeFileSync(file,item.content);
 }
 const after=inspectMigration(origin);
 demand(after.head===inspection.head&&after.blockers.every(b=>['manifest-policy-cutover-required','migration-execution-not-performed'].includes(b)),'Legacy source changed during cutover');
 const final={...initial,state:'prepared',selection:'v05-configuration-candidate',
  configurationDecisions:plan.files.map(item=>({path:item.path,action:item.action,beforeSha256:item.beforeSha256,
   afterSha256:item.action==='replace'?hash(item.content):item.beforeSha256})),
  needsIndependentReview:true,needsFreshVerification:true};
 writeManifest(root,final);return {...final,candidate};
}

/** Git identifies the work location; no reservation or claim of exclusivity. */
export function assertWorkLocation(directory,mode='worktree'){
 demand(['worktree','isolated-clone'].includes(mode),'Unknown workspace mode');
 const root=fs.realpathSync.native(directory);
 demand(fs.realpathSync.native(git(root,'rev-parse','--show-toplevel').toString().trim())===root,'Repository root required');
 const metadata=fs.realpathSync.native(git(root,'rev-parse','--absolute-git-dir').toString().trim());
 const common=fs.realpathSync.native(git(root,'rev-parse','--path-format=absolute','--git-common-dir').toString().trim());
 if(mode==='worktree')demand(metadata!==common,'Use a dedicated Git worktree, or explicitly select isolated-clone');
 else demand(metadata===common&&metadata===fs.realpathSync.native(path.join(root,'.git'))&&fs.lstatSync(metadata).isDirectory(),'Independent clone required');
 return {repo:root,mode};
}

/** Create, never repurpose, an owner-requested linked worktree. No checkout filters. */
export function createWorktree(source,{issue,slug,type='feature',base='HEAD'}={}){
 demand(Number.isSafeInteger(issue)&&issue>0,'Positive Issue number required');
 demand(typeof slug==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)&&slug.length<=80,'Portable worktree slug required');
 demand(['feature','fix','refactor','test','docs','chore'].includes(type),'Unsupported standard branch type');
 demand(typeof base==='string'&&base&&!base.startsWith('-'),'Explicit base revision required');
 const origin=fs.realpathSync.native(source);
 demand(fs.realpathSync.native(git(origin,'rev-parse','--show-toplevel').toString().trim())===origin,'Repository root required');
 const head=git(origin,'rev-parse','--verify',`${base}^{commit}`).toString().trim(),branch=`${type}/${issue}-${slug}`;
 git(origin,'check-ref-format','--branch',branch);
 const refs=git(origin,'for-each-ref','--format=%(refname)',`refs/heads/${branch}`).toString().trim();demand(!refs,'Work branch already exists; choose a distinct slug');
 const observer=new Controller({repo:origin,base:head,contract:{},implementer:'host-worktree'}),blobs=observer.blobs(head);
 const now=new Date(),pad=x=>String(x).padStart(2,'0');
 const timestamp=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
 const parent=path.join(origin,'.worktrees');
 try{const st=fs.lstatSync(parent);demand(st.isDirectory()&&!st.isSymbolicLink(),'Worktree parent must be a real directory');}catch(error){if(error.code!=='ENOENT')throw error;fs.mkdirSync(parent);}
 demand(fs.realpathSync.native(parent)===parent,'Worktree parent alias forbidden');
 const destination=path.join(parent,`${timestamp}-${issue}-${slug}`);
 try{fs.lstatSync(destination);throw Error('Worktree destination already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 git(origin,'worktree','add','--no-checkout','-b',branch,'--',destination,head);
 // An interrupted creation is retained for inspection, never silently deleted/reset.
 for(const [name,blob] of blobs){const file=path.join(destination,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,blob.bytes,{flag:'wx',mode:blob.mode==='100755'?0o755:0o644});}
 git(destination,'read-tree',head);
 return {...assertWorkLocation(destination),branch,base:head,issue,slug};
}
