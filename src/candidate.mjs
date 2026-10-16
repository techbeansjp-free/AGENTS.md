/** Materialize bounded Agent output in an exclusively Controller-owned worktree. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {readSnapshotFile} from './snapshot.mjs';
function demand(ok,message){if(!ok)throw Error(message);}
export function commitCandidate(controller,workspace,{name='ASC evaluation',email='controller@example.invalid'}={}) {
 demand(!/[\r\n\0]/.test(name+email)&&name&&email,'Invalid commit identity');
 const before=controller.target({allowEmpty:true}),original=controller.blobs(before.head);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asc-candidate-index-'));
 const git=(args,input,index=true)=>{
  const env={PATH:process.env.PATH,HOME:os.tmpdir(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',
   GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0',...(index?{GIT_INDEX_FILE:path.join(temp,'index')}:{})};
  const p=spawnSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','protocol.allow=never',
   '-c','commit.gpgsign=false','-c',`user.name=${name}`,'-c',`user.email=${email}`,...args],
   {cwd:controller.repo,env,input,timeout:20000,maxBuffer:16*1024*1024});
  demand(!p.error&&p.status===0,'Candidate Git operation failed');return p.stdout.toString().trim();
 };
 try{
  const updates=new Map(),allowed=new Set(controller.contract.allowedPaths);
  for(const name of allowed){
   let bytes;
   try{bytes=readSnapshotFile(workspace,name);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(bytes===undefined){
    if(original.has(name)){updates.set(name,null);}continue;
   }
   const mode=original.get(name)?.mode??'100644';
   if(original.get(name)?.bytes.equals(bytes))continue;
   updates.set(name,{bytes,mode});
  }
  demand(updates.size>0,'Agent produced no change');
  git(['read-tree',before.head]);
  for(const [name,value] of updates){
   if(value===null)git(['update-index','--force-remove','--',name]);
   else {const oid=git(['hash-object','-w','--stdin'],value.bytes);git(['update-index','--add','--cacheinfo',value.mode,oid,name]);}
  }
  // Reobserve before publication; filters and hooks are never called.
  demand(JSON.stringify(controller.target({allowEmpty:true}))===JSON.stringify(before),'Source changed during candidate export');
  const tree=git(['write-tree']),commit=git(['commit-tree',tree,'-p',before.head,'-m','Implement owner-requested candidate']);
  git(['update-ref','HEAD',commit,before.head]);
  // Never run checkout/smudge filters. This dedicated worktree has no concurrent
  // human writer; interruption leaves a detectable dirty candidate, not approval.
  for(const [name,value] of updates){
   const file=path.join(controller.repo,name);
   if(value===null)fs.unlinkSync(file);
   else {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value.bytes,{mode:value.mode==='100755'?0o755:0o644});}
  }
  git(['read-tree',commit],undefined,false);
  const after=controller.target();demand(after.head===commit,'Candidate did not materialize');return after;
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
