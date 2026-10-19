/** Read-only observation of the two explicitly scoped synthetic worker outputs. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function workerCheckpointObserver({origin,integration,relativeFiles}){
 const root=fs.realpathSync(origin),target=fs.realpathSync(integration);
 if(relativeFiles.length!==2||new Set(relativeFiles).size!==2)throw Error('Expected two distinct worker outputs');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
 const git=(...args)=>execFileSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{cwd:root,env,maxBuffer:1024*1024});
 const baseline=relativeFiles.map(name=>{
  if(path.isAbsolute(name)||name.split('/').some(p=>!p||p==='..'||p==='.')||name.includes('\\'))throw Error('Invalid worker output path');
  return hash(fs.readFileSync(path.join(target,name)));
 });
 return ()=>{
  if(relativeFiles.some((name,i)=>hash(fs.readFileSync(path.join(target,name)))!==baseline[i]))return [];
  const candidates=[[],[]];
  for(const field of git('worktree','list','--porcelain','-z').toString().split('\0')){
   if(!field.startsWith('worktree '))continue;
   const workspace=field.slice(9),relative=path.relative(path.join(root,'.worktrees'),workspace);
   if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||workspace===target)continue;
   if(!fs.existsSync(workspace))continue;
   if(fs.realpathSync(workspace)!==workspace)throw Error('Worker workspace must not traverse symlinks');
   relativeFiles.forEach((name,i)=>{
    const file=path.join(workspace,name);
    if(!fs.existsSync(file))return;
    if(fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile())throw Error('Worker output must be a regular non-symlink file');
    const after=hash(fs.readFileSync(file));
    if(after!==baseline[i])candidates[i].push({file,workspace,before:baseline[i],after});
   });
  }
  for(const first of candidates[0])for(const second of candidates[1])if(first.workspace!==second.workspace)return [first,second];
  return [];
 };
}

/** Scope-specific acceptance; legitimate later repairs need separate evidence. */
export function workerRecoveryEvidence(checkpoint,finalFiles){
 const names=['reservation/service.mjs','billing/service.mjs'];
 const valid=checkpoint?.checkpoint===true&&checkpoint.stopped===true&&checkpoint.interrupted===true&&checkpoint.signalSent===true
  &&checkpoint.checkpointScope==='two distinct worker worktrees before integration'
  &&Array.isArray(checkpoint.workerWorktrees)&&checkpoint.workerWorktrees.length===2&&new Set(checkpoint.workerWorktrees).size===2
  &&checkpoint.workerWorktrees.every(name=>typeof name==='string'&&name!==''&&path.basename(name)===name)
  &&Array.isArray(checkpoint.files)&&checkpoint.files.length===2;
 if(!valid)throw Error('Missing distinct worker-write interruption evidence');
 const files=names.map(name=>{
  const records=checkpoint.files.filter(f=>f.name===name),bytes=finalFiles.get(name);
  if(records.length!==1||!Buffer.isBuffer(bytes))throw Error('Missing saved worker output');
  const {before,after}=records[0];
  if(!/^[a-f0-9]{64}$/.test(before)||!/^[a-f0-9]{64}$/.test(after)||before===after)throw Error('Invalid saved worker hash');
  return {name,checkpointSha256:after,finalSha256:hash(bytes)};
 });
 return {requested:true,verified:files.every(f=>f.checkpointSha256===f.finalSha256),files,
  scope:'Exact two worker outputs preserved into submitted commit; not arbitrary interruption or repaired-output equivalence.'};
}
