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
try{
 scenario('network namespace is separate and host listener unreachable',()=>{
  assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.ASC_TEST_HOST_NET);
  invoke('/tools/node',['-e',`const s=require('net').connect({host:'127.0.0.1',port:Number(process.env.ASC_TEST_HOST_PORT)});s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(2),2000);`]);
 });
 scenario('baseline reproduces stale added/changed/retired entries',()=>{
  const dir=seed('baseline',base,'both');const before=snapshot(dir);const r=cli(nextBase,dir,'--apply');assert.equal(r.applied,true);
  for(const host of hosts('both')){assert(!fs.existsSync(dir+'/'+host+'/skills/recovery-next/SKILL.md'));assert(fs.existsSync(dir+'/'+host+'/skills/execution-recovery/SKILL.md'));assert.equal(snapshot(dir)[host+'/skills/verification-optimization/SKILL.md'],before[host+'/skills/verification-optimization/SKILL.md']);}
 });
 if(hasFixed){
  const reference=seed('fresh-next-reference',nextFixed,'both');
  for(const [source,label] of [[base,'legacy'],[fixed,'new-record']])for(const mode of ['both','codex','claude','none'])scenario(label+' '+mode+' ordinary upgrade and repeat',()=>{
   const dir=seed(label+'-'+mode,source,mode,{git:mode==='both'}),before=snapshot(dir);
   const preview=cli(nextFixed,dir);assert.equal(preview.applied,false);assert.deepEqual(snapshot(dir),before,'preview wrote files');assert.deepEqual(preview.conflicts,[]);
   for(const host of hosts(mode))for(const [skill,action] of [['recovery-next','create'],['verification-optimization','update'],['execution-recovery','delete']]){
    const p=host+'/skills/'+skill+'/SKILL.md',change=preview.changes.find(c=>c.path===p);assert(change,p);assert.equal(change.action,action,p);assert.equal(change.kind,'host-entry',p);
   }
   const applied=cli(nextFixed,dir,'--apply');assert.equal(applied.applied,true);assert.deepEqual(applied.conflicts,[]);
   const after=snapshot(dir);checkOwner(before,after);
   for(const host of ['.agents','.claude']){
    if(!hosts(mode).includes(host)){assert(!fs.existsSync(dir+'/'+host+'/skills'));continue;}
    assert(!fs.existsSync(dir+'/'+host+'/skills/execution-recovery/SKILL.md'));
    const files=fs.readdirSync(dir+'/'+host+'/skills').filter(n=>fs.existsSync(dir+'/'+host+'/skills/'+n+'/SKILL.md')).sort();
    const catalog=JSON.parse(fs.readFileSync(dir+'/.agent-skill-chain/managed-runtime/src/runtime-files.json')).filter(p=>/^skills\/[^/]+\/SKILL.md$/.test(p)).map(p=>p.split('/')[1]).sort();assert.deepEqual(files,catalog);
    for(const skill of catalog)assert.deepEqual(fs.readFileSync(dir+'/'+host+'/skills/'+skill+'/SKILL.md'),fs.readFileSync(reference+'/'+host+'/skills/'+skill+'/SKILL.md'),'fresh/updated entry mismatch: '+host+'/'+skill);
    assert(fs.readFileSync(dir+'/'+host+'/skills/verification-optimization/SKILL.md','utf8').includes('Fixture release updated verification guidance.'));
   }
   const repeated=cli(nextFixed,dir,'--apply');assert.equal(repeated.applied,true);assert.deepEqual(repeated.changes,[]);assert.equal(repeated.recordChanged,false);assert.deepEqual(snapshot(dir),after);
  });
  for(const [source,label] of [[base,'legacy'],[fixed,'new-record']])for(const skill of ['verification-optimization','execution-recovery'])scenario(label+' edited '+skill+' blocks all updates',()=>{
   const dir=seed(label+'-edit-'+skill,source,'both'),p='.claude/skills/'+skill+'/SKILL.md';fs.appendFileSync(dir+'/'+p,'\nUser-owned edit\n');const before=snapshot(dir);
   const preview=cli(nextFixed,dir);assert(preview.conflicts.includes(p));assert.deepEqual(snapshot(dir),before);
   const r=cli(nextFixed,dir,'--apply');assert.equal(r.applied,false);assert(r.conflicts.includes(p));assert.deepEqual(snapshot(dir),before);
  });
  for(const same of [false,true])scenario('unowned added name '+(same?'identical':'different')+' blocks all updates',()=>{
   const dir=seed('unowned-'+same,fixed,'both'),p='.agents/skills/recovery-next/SKILL.md';
   const bytes=same?fs.readFileSync(root+'/consumers/new-record-both/'+p):Buffer.from('User-owned unrelated skill\n');write(dir,p,bytes);const before=snapshot(dir);
   const r=cli(nextFixed,dir,'--apply');assert.equal(r.applied,false);assert(r.conflicts.includes(p));assert.deepEqual(snapshot(dir),before);
  });
  scenario('unselected Host and unrelated skills remain untouched',()=>{
   const dir=seed('unselected',fixed,'codex');write(dir,'.claude/skills/recovery-next/SKILL.md','Owner Claude entry\n');write(dir,'.agents/skills/user-only/SKILL.md','Owner extra entry\n');write(dir,'.agents/skills/execution-recovery/owner-notes.txt','Owner note\n');const before=snapshot(dir);
   const r=cli(nextFixed,dir,'--apply');assert.equal(r.applied,true);const after=snapshot(dir);for(const p of ['.claude/skills/recovery-next/SKILL.md','.agents/skills/user-only/SKILL.md','.agents/skills/execution-recovery/owner-notes.txt'])assert.equal(after[p],before[p]);
  });
  for(const kind of ['symlink','hardlink'])scenario(kind+' retired entry rejected without touching owner canary',()=>{
   const dir=seed('unsafe-'+kind,fixed,'both'),p=dir+'/.agents/skills/execution-recovery/SKILL.md',canary=root+'/owner-canary-'+kind;fs.writeFileSync(canary,'Owner data must survive\n');fs.unlinkSync(p);
   if(kind==='symlink')fs.symlinkSync(canary,p);else fs.linkSync(canary,p);
   const before=snapshot(dir),bytes=fs.readFileSync(canary);const r=spawnSync('/tools/node',[nextFixed,'project-assets',dir,'--apply'],{cwd:root,encoding:'utf8',timeout:120000});commands.push({command:'/tools/node',args:[nextFixed,'project-assets',dir,'--apply'],status:r.status,stdout:r.stdout,stderr:r.stderr});
   assert(r.status!==0||JSON.parse(r.stdout).applied===false);assert.deepEqual(snapshot(dir),before);assert.deepEqual(fs.readFileSync(canary),bytes);
  });
  for(const legacy of [false,true])scenario((legacy?'legacy':'modern')+' misattributed ownership cannot delete private Skill',()=>{
   const dir=seed('misattributed-'+legacy,legacy?base:fixed,'codex'),entry='.agents/skills/user-private/SKILL.md',bytes='Private skill unrelated to ASC\n';write(dir,entry,bytes);
   const file=dir+'/.agent-skill-chain/distribution.json',manifest=JSON.parse(fs.readFileSync(file));if(!legacy)manifest.hostEntries.push(entry);manifest.files[entry]=sha(bytes);fs.writeFileSync(file,JSON.stringify(manifest));
   const before=snapshot(dir),r=cli(nextFixed,dir,'--apply');assert.equal(r.applied,false);assert(r.conflicts.includes(entry));assert.deepEqual(snapshot(dir),before);
  });
  for(const [entry,source] of [['.agent-skill-chain/skills/verification-optimization/SKILL.md','skills/verification-optimization/SKILL.md'],['.agent-skill-chain/managed-runtime/src/project-assets.mjs','src/project-assets.mjs']])scenario('unrecorded identical nonHost file not adopted: '+source,()=>{
   const dir=root+'/consumers/unowned-body-'+(source.startsWith('src/')?'runtime':'skill');fs.mkdirSync(dir,{recursive:true});write(dir,entry,fs.readFileSync(root+'/packages/fixed/package/'+source));const before=snapshot(dir);
   const r=cli(fixed,dir,'--apply');assert.equal(r.applied,false);assert(r.conflicts.includes(entry));assert.deepEqual(snapshot(dir),before);
  });
  scenario('owner-edited canonical file equal to next version still blocks all updates',()=>{
   const dir=seed('edited-canonical-next',fixed,'both'),entry='.agent-skill-chain/skills/verification-optimization/SKILL.md';write(dir,entry,fs.readFileSync(root+'/packages/fixed-next/package/skills/verification-optimization/SKILL.md'));const before=snapshot(dir);
   const r=cli(nextFixed,dir,'--apply');assert.equal(r.applied,false);assert(r.conflicts.includes(entry));assert.deepEqual(snapshot(dir),before);
  });
  scenario('lost ownership record does not adopt existing distribution files',()=>{
   const dir=seed('lost-record',fixed,'both');fs.unlinkSync(dir+'/.agent-skill-chain/distribution.json');const before=snapshot(dir),r=cli(fixed,dir,'--apply');assert.equal(r.applied,false);assert(r.conflicts.length>0);assert.deepEqual(snapshot(dir),before);
  });
  scenario('private files recorded outside catalog are retained without updating or deleting',()=>{
   const dir=seed('foreign-record-paths',fixed,'both'),paths=['AGENTS.md','src/private-data.txt','.claude/settings.json','.claude/hooks/user-hook.sh'];for(const p of paths)write(dir,p,'Private '+p+'\n');
   const file=dir+'/.agent-skill-chain/distribution.json',manifest=JSON.parse(fs.readFileSync(file));for(const p of paths)manifest.files[p]=sha(fs.readFileSync(dir+'/'+p));fs.writeFileSync(file,JSON.stringify(manifest));const before=snapshot(dir);
   const r=cli(nextFixed,dir,'--apply');assert.equal(r.applied,true);const after=snapshot(dir);for(const p of paths){assert.equal(after[p],before[p]);assert(r.retained.includes(p));}
  });
  for(const bad of ['AGENTS.md','.claude/skills/user-private/SKILL.md','../outside.txt'])scenario('invalid Host ownership path rejected: '+bad,()=>{
   const dir=seed('invalid-record-'+results.length,fixed,'codex');if(!bad.startsWith('../'))write(dir,bad,'Private value\n');const file=dir+'/.agent-skill-chain/distribution.json',manifest=JSON.parse(fs.readFileSync(file));manifest.files[bad]=sha('Private value\n');manifest.hostEntries.push(bad);fs.writeFileSync(file,JSON.stringify(manifest));const before=snapshot(dir);
   const r=spawnSync('/tools/node',[nextFixed,'project-assets',dir,'--apply'],{cwd:root,encoding:'utf8',timeout:120000});commands.push({command:'/tools/node',args:[nextFixed,'project-assets',dir,'--apply'],status:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,1);assert.deepEqual(snapshot(dir),before);
  });
  scenario('ordinary update preserves private settings, nested files, modes, links and empty directories',()=>{
   const dir=seed('private-state',fixed,'both');const paths=['AGENTS.md','CLAUDE.md','package.json','src/app.js','project/rules.json','.claude/settings.json','.claude/settings.local.json','.claude/hooks/check.sh','.agents/skills/private-skill/SKILL.md','.claude/skills/private-skill/SKILL.md','.agents/skills/execution-recovery/references/private.md','.agents/skills/execution-recovery/agents/openai.yaml','.claude/skills/execution-recovery/.owner-hidden','.agent-skill-chain/project/rules.json','.agent-skill-chain/skills/private-skill/SKILL.md','.agent-skill-chain/managed-runtime/private.txt'];
   for(const p of paths)write(dir,p,'Private '+p+'\n');fs.chmodSync(dir+'/.claude/hooks/check.sh',0o750);fs.symlinkSync('private-skill',dir+'/.agents/skills/user-alias');fs.mkdirSync(dir+'/.agents/skills/execution-recovery/private-empty',{recursive:true});
   const before=snapshot(dir),modes=Object.fromEntries(paths.map(p=>[p,fs.statSync(dir+'/'+p).mode]));const r=cli(nextFixed,dir,'--apply');assert.equal(r.applied,true);const after=snapshot(dir);for(const p of paths){assert.equal(after[p],before[p]);assert.equal(fs.statSync(dir+'/'+p).mode,modes[p]);}assert.deepEqual(after['.agents/skills/user-alias'],before['.agents/skills/user-alias']);assert(fs.statSync(dir+'/.agents/skills/execution-recovery/private-empty').isDirectory());
  });
 }
 assert(!fs.existsSync('/home/tatsuru'),'host home exposed');
 fs.writeFileSync('/usr/asc-isolation-probe','test');throw Error('System filesystem unexpectedly writable');
}catch(e){
 if(e.code==='EROFS'&&e.path==='/usr/asc-isolation-probe')results.push({name:'system mounts reject write',passed:true});
 else {fs.writeFileSync('/workspace/results.json',JSON.stringify({passed:false,results,error:e.stack,commands},null,2));throw e;}
}
fs.writeFileSync('/workspace/results.json',JSON.stringify({passed:true,hasFixed,node:process.version,homeVisible:fs.existsSync('/home/tatsuru'),networkNamespace:fs.readlinkSync('/proc/self/ns/net'),results,commands},null,2));
console.log(JSON.stringify({passed:true,hasFixed,cases:results.length}));
