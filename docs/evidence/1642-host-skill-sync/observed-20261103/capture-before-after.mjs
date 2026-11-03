import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='/workspace', results=[], commands=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
function invoke(command,args,allowed=[0]){
 const r=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8000000});
 commands.push({command,args,status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});
 assert(allowed.includes(r.status),r.stderr||r.error?.message||'Unexpected exit '+r.status);return r.stdout;
}
function extract(name){const dir=path.join(root,'packages',name);fs.mkdirSync(dir,{recursive:true});invoke('tar',['-xzf','/input/'+name+'.tgz','-C',dir]);return dir+'/package/bin/asc-v05.mjs';}
const base=extract('baseline'), nextBase=extract('baseline-next');
const hasFixed=fs.existsSync('/input/fixed.tgz');
const fixed=hasFixed?extract('fixed'):null, nextFixed=hasFixed?extract('fixed-next'):null;
function snapshot(dir){
 const entries={};function walk(current){for(const entry of fs.readdirSync(current,{withFileTypes:true})){const p=path.join(current,entry.name),key=path.relative(dir,p);if(entry.isSymbolicLink())entries[key]={link:fs.readlinkSync(p)};else if(entry.isDirectory())walk(p);else entries[key]=sha(fs.readFileSync(p));}}
 walk(dir);return entries;
}
function cli(source,dir,...flags){const plan=JSON.parse(invoke('/tools/node',[source,'project-assets',dir,...flags],[0,2]));assert.equal(commands.at(-1).status,plan.conflicts.length?2:0);return plan;}
const options={both:['--register-skill','--register-claude-skill'],codex:['--register-skill'],claude:['--register-claude-skill'],none:[]};
function seed(name,source,hosts,{git=false}={}){
 const dir=path.join(root,'consumers',name);fs.mkdirSync(dir,{recursive:true});if(git){
  const repo=path.join(root,'repositories',name);fs.mkdirSync(repo,{recursive:true});invoke('git',['init','--quiet',repo]);invoke('git',['-C',repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','--allow-empty','-m','Fixture baseline']);invoke('git',['-C',repo,'worktree','add','--quiet','-b','consumer',dir]);
 }
 fs.writeFileSync(dir+'/AGENTS.md','User-owned project instructions\n');fs.writeFileSync(dir+'/CLAUDE.md','User-owned Claude instructions\n');
 fs.mkdirSync(dir+'/.config',{recursive:true});fs.writeFileSync(dir+'/.config/owner.txt','User-owned settings\n');
 const r=cli(source,dir,...options[hosts],'--apply');assert.equal(r.applied,true);return dir;
}
function write(dir,relative,bytes){const p=path.join(dir,relative);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);}
function hosts(mode){return mode==='both'?['.agents','.claude']:mode==='codex'?['.agents']:mode==='claude'?['.claude']:[];}
function checkOwner(before,after){for(const p of ['AGENTS.md','CLAUDE.md','.config/owner.txt'])assert.equal(after[p],before[p],p);}
function scenario(name,fn){fn();results.push({name,passed:true});}
const proofs=[];
function capture(dir){const hashes=snapshot(dir),modes={};for(const name of Object.keys(hashes))modes[name]=fs.lstatSync(dir+'/'+name).mode;return {hashes,modes};}
function unchanged(name,dir,operation){const before=capture(dir);const result=operation();const after=capture(dir);assert.equal(result.applied,false);assert.deepEqual(after,before);proofs.push({name,applied:result.applied,conflicts:result.conflicts,before,after});}
const dir=seed('private-files',fixed,'both');
const privatePaths=['AGENTS.md','CLAUDE.md','package.json','src/app.js','project/rules.json','.claude/settings.json','.claude/settings.local.json','.claude/hooks/check.sh','.agents/skills/private-skill/SKILL.md','.claude/skills/private-skill/SKILL.md','.agents/skills/execution-recovery/references/private.md','.agents/skills/execution-recovery/agents/openai.yaml','.claude/skills/execution-recovery/.owner-hidden','.agent-skill-chain/project/rules.json','.agent-skill-chain/skills/private-skill/SKILL.md','.agent-skill-chain/managed-runtime/private.txt'];
for(const p of privatePaths)write(dir,p,'Private '+p+'\n');fs.chmodSync(dir+'/.claude/hooks/check.sh',0o750);fs.symlinkSync('private-skill',dir+'/.agents/skills/user-alias');fs.mkdirSync(dir+'/.agents/skills/execution-recovery/private-empty',{recursive:true});
const before=capture(dir),result=cli(nextFixed,dir,'--apply'),after=capture(dir);assert.equal(result.applied,true);
const protectedFiles=privatePaths.map(p=>{assert.equal(after.hashes[p],before.hashes[p]);assert.equal(after.modes[p],before.modes[p]);return {path:p,beforeSha256:before.hashes[p],afterSha256:after.hashes[p],beforeMode:before.modes[p],afterMode:after.modes[p]};});
assert.deepEqual(before.hashes['.agents/skills/user-alias'],after.hashes['.agents/skills/user-alias']);assert(fs.statSync(dir+'/.agents/skills/execution-recovery/private-empty').isDirectory());
proofs.push({name:'normal-update-preserves-private-files',applied:result.applied,protectedFiles,symlink:{before:before.hashes['.agents/skills/user-alias'],after:after.hashes['.agents/skills/user-alias']},emptyDirectoryPreserved:true,before,after});
fs.appendFileSync(dir+'/.agents/skills/verification-optimization/SKILL.md','\nOwner change\n');unchanged('edited-entry-blocks-entire-update',dir,()=>cli(nextFixed,dir,'--apply'));
const corrupt=seed('misattributed',fixed,'codex'),privateEntry='.agents/skills/user-private/SKILL.md';write(corrupt,privateEntry,'Unrelated private skill\n');const record=corrupt+'/.agent-skill-chain/distribution.json',manifest=JSON.parse(fs.readFileSync(record));manifest.hostEntries.push(privateEntry);manifest.files[privateEntry]=sha(fs.readFileSync(corrupt+'/'+privateEntry));fs.writeFileSync(record,JSON.stringify(manifest));unchanged('misattributed-record-preserves-private-skill',corrupt,()=>cli(nextFixed,corrupt,'--apply'));
const identical=root+'/consumers/identical';fs.mkdirSync(identical,{recursive:true});write(identical,'.agent-skill-chain/skills/verification-optimization/SKILL.md',fs.readFileSync(root+'/packages/fixed/package/skills/verification-optimization/SKILL.md'));unchanged('unowned-identical-file-not-adopted',identical,()=>cli(fixed,identical,'--apply'));
fs.writeFileSync(root+'/before-after.json',JSON.stringify({passed:true,proofs,commands},null,2));console.log(JSON.stringify({passed:true,cases:proofs.length,privateFiles:protectedFiles.length}));
