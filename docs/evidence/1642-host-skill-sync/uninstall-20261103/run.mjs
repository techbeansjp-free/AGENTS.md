// Actual consumer CLI operations inside verify.mjs's Linux bubblewrap namespace.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='/workspace',commands=[],cases=[];
fs.mkdirSync(root+'/user-home',{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
function run(cmd,args,cwd=root,expected=0){
 const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:16000000});
 commands.push({cmd,args,cwd,status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});
 assert.equal(r.status,expected,r.stderr||r.error?.message);return r.stdout;
}
const node=(args,cwd,expected=0)=>run('/tools/node',args,cwd,expected);
function snapshot(dir){
 const files={};function walk(p){for(const entry of fs.readdirSync(p)){
  const full=path.join(p,entry),s=fs.lstatSync(full),name=path.relative(dir,full);
  if(s.isDirectory()){files[name]={type:'directory',mode:s.mode};walk(full);}
  else files[name]={mode:s.mode,...(s.isSymbolicLink()?{link:fs.readlinkSync(full)}:s.isFile()?{sha256:hash(fs.readFileSync(full))}:{type:'special'})};
 }}walk(dir);return files;
}
function put(dir,name,value){fs.mkdirSync(path.dirname(dir+'/'+name),{recursive:true});fs.writeFileSync(dir+'/'+name,value);}
function setup(name,git=false){
 const dir=root+'/'+name;fs.mkdirSync(dir);
 if(git){const repo=root+'/'+name+'-repo';fs.mkdirSync(repo);run('git',['init','-q',repo]);run('git',['-C',repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-q','--allow-empty','-m','Owner project']);run('git',['-C',repo,'worktree','add','-q','-b','consumer',dir]);}
 const owner={'package.json':'{"name":"user-app","private":true}\n','package-lock.json':'{"name":"user-app","lockfileVersion":3,"packages":{}}\n','node_modules/user-dependency/index.js':'user dependency\n','.agent-skill-chain/package.json':'{"name":"owner-prefix","private":true}\n','.agent-skill-chain/node_modules/owner-tool/package.json':'{"name":"owner-tool","version":"1.0.0"}\n','.agent-skill-chain/node_modules/owner-tool/index.js':'private package\n','AGENTS.md':'Owner instructions\n','CLAUDE.md':'Owner Claude instructions\n','src/app.js':'user app\n','.agent-skill-chain/skills/asc/references/private.md':'owner canonical sibling\n','.agent-skill-chain/managed-runtime/src/private.mjs':'owner runtime sibling\n','.agents/skills/asc/agents/openai.yaml':'interface: owner\n','.claude/skills/asc/references/private.md':'owner Host reference\n','.claude/settings.json':'{"user":true}\n','.claude/hooks/private.sh':'private hook\n','.agents/skills/private/SKILL.md':'Private Codex Skill\n','.claude/skills/private/SKILL.md':'Private Claude Skill\n','.agent-skill-chain/project/rules.json':'{"owner":true}\n','.agent-skill-chain/private-notes.txt':'User notes\n'};
 for(const [p,v] of Object.entries(owner))put(dir,p,v);
 fs.mkdirSync(dir+'/.agent-skill-chain/owner-empty');fs.symlinkSync('private-notes.txt',dir+'/.agent-skill-chain/owner-link');
 return {dir,owner:Object.keys(owner),before:snapshot(dir)};
}
function preserved(f){const now=snapshot(f.dir);for(const [p,state] of Object.entries(f.before))assert.deepEqual(now[p],state,p);}
function bootstrap(f,archive){const prefix=run('mktemp',['-d','/tmp/asc-uninstall.XXXXXXXXXX'],f.dir).trim();node(['/tools/npm/bin/npm-cli.js','install','--prefix',prefix,'--cache',prefix+'/npm-cache','--offline','--ignore-scripts','--no-audit','--no-fund','--no-save','--package-lock=false','/input/'+archive],f.dir);return prefix;}
const external=prefix=>prefix+'/node_modules/agent-skill-chain/bin/asc-v05.mjs';
const bundled='.agent-skill-chain/bin/asc.mjs',record='.agent-skill-chain/distribution.json';
function cli(f,exe,args,expected=0){return JSON.parse(node([exe,...args],f.dir,expected));}
function install(f,prefix,flags=['--register-skill','--register-claude-skill']){const result=cli(f,external(prefix),['project-assets','.',...flags,'--apply']);assert(result.applied);preserved(f);return result;}
function mutateRecord(f,mutate){const p=f.dir+'/'+record,r=JSON.parse(fs.readFileSync(p));mutate(r);fs.writeFileSync(p,JSON.stringify(r));}
function removal(f,exe){
 const manifest=JSON.parse(fs.readFileSync(f.dir+'/'+record)),before=snapshot(f.dir);
 const preview=cli(f,exe,['uninstall','.']);assert.equal(preview.applied,false);assert.deepEqual(preview.conflicts,[]);assert.deepEqual(snapshot(f.dir),before);
 const result=cli(f,exe,['uninstall','.','--apply']);assert(result.applied);assert.deepEqual(result.conflicts,[]);
 for(const p of [...Object.keys(manifest.files),record])assert(!fs.existsSync(f.dir+'/'+p),p);
 const after=snapshot(f.dir);for(const [p,state] of Object.entries(before))if(state.type==='directory')assert.deepEqual(after[p],state,p);
 preserved(f);return {preview,result,before,after};
}
try{
 for(const mode of ['both','codex','claude','none']){
  const f=setup('lifecycle-'+mode,mode==='both'),flags=mode==='both'?['--register-skill','--register-claude-skill']:mode==='codex'?['--register-skill']:mode==='claude'?['--register-claude-skill']:[];
  const first=bootstrap(f,'fixed.tgz');install(f,first,flags);cli(f,bundled,['start','.']);
  run('rm',['-rf','--',first],f.dir);cli(f,bundled,['start','.']);
  const next=bootstrap(f,'fixed-next.tgz');const update=install(f,next,[]);assert.equal(cli(f,bundled,['capabilities']).commands.includes('uninstall'),true);
  const removed=removal(f,bundled);const empty=snapshot(f.dir),repeat=cli(f,external(next),['uninstall','.','--apply']);assert.deepEqual(snapshot(f.dir),empty);assert.equal(repeat.recordPresent,false);
  install(f,next,flags);cli(f,bundled,['start','.']);preserved(f);
  cases.push({mode,passed:true,update,...removed,repeat,ownerBefore:Object.fromEntries(f.owner.map(p=>[p,f.before[p]])),ownerAfter:Object.fromEntries(f.owner.map(p=>[p,snapshot(f.dir)[p]]))});
 }
 if(fs.existsSync('/input/prior.tgz')){const prior=setup('previous-package'),old=bootstrap(prior,'prior.tgz');install(prior,old);assert(!cli(prior,external(old),['capabilities']).commands.includes('uninstall'));const current=bootstrap(prior,'fixed.tgz');cases.push({mode:'previous-package-removed-by-new-external-cli',passed:true,...removal(prior,external(current))});}
 const legacy=setup('legacy-record'),legacyPrefix=bootstrap(legacy,'fixed.tgz');install(legacy,legacyPrefix);mutateRecord(legacy,r=>{delete r.registeredHosts;delete r.hostEntries;});cases.push({mode:'legacy-record',passed:true,...removal(legacy,external(legacyPrefix))});
 const faultCases=[
  ['special-asset-permissions',1,f=>fs.chmodSync(f.dir+'/.agent-skill-chain/00_利用案内.md',0o4751)],
  ['special-record-permissions',1,f=>fs.chmodSync(f.dir+'/'+record,0o2751)],
  ['unlink-permission-failure-rolls-back',1,f=>fs.chmodSync(f.dir+'/.agents/skills/asc',0o555)],
  ['edited-host',2,f=>fs.appendFileSync(f.dir+'/.agents/skills/asc/SKILL.md','\nOwner edit\n')],
  ['edited-runtime',2,f=>fs.appendFileSync(f.dir+'/.agent-skill-chain/managed-runtime/README.md','\nOwner edit\n')],
  ['missing-asset',2,f=>fs.unlinkSync(f.dir+'/.agent-skill-chain/managed-runtime/README.md')],
  ['unknown-owner-record',2,f=>mutateRecord(f,r=>{r.files['.agent-skill-chain/project/rules.json']=hash(fs.readFileSync(f.dir+'/.agent-skill-chain/project/rules.json'));})],
  ['unknown-canonical-record',2,f=>{const p='.agent-skill-chain/skills/asc/private.txt';put(f.dir,p,'owner private');mutateRecord(f,r=>{r.files[p]=hash(fs.readFileSync(f.dir+'/'+p));});}],
  ['unknown-runtime-record',2,f=>{const p='.agent-skill-chain/managed-runtime/private.txt';put(f.dir,p,'owner private');mutateRecord(f,r=>{r.files[p]=hash(fs.readFileSync(f.dir+'/'+p));});}],
  ['false-host-ownership',2,f=>mutateRecord(f,r=>{const p='.agents/skills/private/SKILL.md';r.files[p]=hash(fs.readFileSync(f.dir+'/'+p));r.hostEntries.push(p);})],
  ['parent-traversal',1,f=>mutateRecord(f,r=>{r.files['../outside']='a'.repeat(64);})],
  ['malformed-record',1,f=>fs.writeFileSync(f.dir+'/'+record,'{"broken":')],
  ['symlink-asset',1,f=>{const p=f.dir+'/.agents/skills/asc/SKILL.md';fs.unlinkSync(p);fs.symlinkSync('../private/SKILL.md',p);}],
  ['hardlink-asset',1,f=>{const p=f.dir+'/.agents/skills/asc/SKILL.md';fs.unlinkSync(p);fs.linkSync(f.dir+'/.agents/skills/private/SKILL.md',p);}],
  ['symlink-record',1,f=>{fs.renameSync(f.dir+'/'+record,f.dir+'/owner-record.json');fs.symlinkSync('../owner-record.json',f.dir+'/'+record);}],
  ['unicode-alias',1,f=>{const p='.agent-skill-chain/templates/specs/details/07_データ';assert.notEqual(p,p.normalize('NFD'));put(f.dir,p.normalize('NFD')+'/owner.txt','owner alias');}],
  ['untracked-retired-asset',2,f=>{const p='.agent-skill-chain/skills/unknown-old/SKILL.md';put(f.dir,p,'Old unknown content');mutateRecord(f,r=>{r.files[p]=hash(fs.readFileSync(f.dir+'/'+p));});}]
 ];
 for(const [name,expected,change] of faultCases){const f=setup(name),prefix=bootstrap(f,'fixed.tgz');install(f,prefix);change(f);const before=snapshot(f.dir);const stdout=node([external(prefix),'uninstall','.','--apply'],f.dir,expected);assert.deepEqual(snapshot(f.dir),before);cases.push({mode:name,passed:true,expectedExit:expected,stdout,before,after:snapshot(f.dir)});}
 const absent=setup('missing-record'),prefix=bootstrap(absent,'fixed.tgz');install(absent,prefix);fs.unlinkSync(absent.dir+'/'+record);const before=snapshot(absent.dir);const noRecord=cli(absent,external(prefix),['uninstall','.','--apply']);assert.equal(noRecord.recordPresent,false);assert.deepEqual(snapshot(absent.dir),before);cases.push({mode:'missing-record-keeps-orphans',passed:true,noRecord,before,after:snapshot(absent.dir)});
 fs.writeFileSync(root+'/results.json',JSON.stringify({passed:true,cases,commands},null,2));console.log(JSON.stringify({passed:true,cases:cases.length,commands:commands.length}));
}catch(error){fs.writeFileSync(root+'/results.json',JSON.stringify({passed:false,error:error.stack,cases,commands},null,2));throw error;}
