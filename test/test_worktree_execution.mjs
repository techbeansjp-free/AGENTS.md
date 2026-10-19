import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
import {startWorktree,verifyWorktree} from '../src/worktree-execution.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-native-worktree-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),work=path.join(root,'work');fs.mkdirSync(repo);
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
 git(repo,'init','-q');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'.gitignore'),'node_modules/\nbuild/\n');fs.writeFileSync(path.join(repo,'feature.cjs'),'module.exports=41;');git(repo,'add','.');git(repo,'commit','-qm','base');const base=git(repo,'rev-parse','HEAD');
 git(repo,'worktree','add','-qb','feature',work);fs.writeFileSync(path.join(work,'feature.cjs'),'module.exports=42;');git(work,'commit','-qam','change');
 const owner=path.join(root,'owner.json'),contract={intent:'Return 42',allowedPaths:['feature.cjs'],commands:[[process.execPath,'-e',"require('assert').equal(require('./feature.cjs'),42)"]]};
 const save=()=>fs.writeFileSync(owner,JSON.stringify(contract));save();return {root,repo,work,base,owner,contract,save,git};
}
test('standard worktree verifies actual project with large pnpm-shaped dependencies without inventory or copies',t=>{
 const f=fixture(t),store=path.join(f.work,'node_modules/.pnpm/pkg/node_modules/pkg'),frontend=path.join(f.work,'src/frontend/node_modules');fs.mkdirSync(store,{recursive:true});fs.mkdirSync(frontend,{recursive:true});
 fs.writeFileSync(path.join(store,'index.js'),'module.exports=42;');fs.symlinkSync(process.platform==='win32'?store:path.relative(frontend,store),path.join(frontend,'pkg'),process.platform==='win32'?'junction':'dir');
 const bulk=path.join(f.work,'node_modules/bulk');fs.mkdirSync(bulk);for(let i=0;i<50001;i++)fs.writeFileSync(path.join(bulk,String(i)),'');
 const fd=fs.openSync(path.join(bulk,'large'),'w');fs.ftruncateSync(fd,560000000);fs.closeSync(fd);
 f.contract.commands=[[process.execPath,'-e',"require('assert').equal(require('./src/frontend/node_modules/pkg'),require('./feature.cjs'));require('fs').mkdirSync('build');require('fs').writeFileSync('build/result','42');"]];f.save();
 const info=startWorktree(f.work);assert.equal(info.snapshot,false);assert.equal(info.providerLaunch,false);
 const r=verifyWorktree(f.work,f.base,f.owner);assert.equal(r.passed,true);assert.equal(r.head,f.git(f.work,'rev-parse','HEAD'));assert.equal(r.independentReview,'required');assert.equal(fs.readFileSync(path.join(f.work,'build/result'),'utf8'),'42');assert.equal(fs.realpathSync(path.join(frontend,'pkg')),fs.realpathSync(store));
});
test('worktree verification refuses unrelated changes and invalidates source changed by tests',t=>{
 const f=fixture(t);f.contract.allowedPaths=['other'];f.save();assert.throws(()=>verifyWorktree(f.work,f.base,f.owner),/scope/);
 f.contract.allowedPaths=['feature.cjs'];f.contract.commands=[[process.execPath,'-e',"require('fs').writeFileSync('feature.cjs','module.exports=9;')"]];f.save();assert.throws(()=>verifyWorktree(f.work,f.base,f.owner),/invalid/);
});
test('worktree failure is not success or review approval',t=>{
 const f=fixture(t);f.contract.commands=[[process.execPath,'-e','process.exit(7)']];f.save();const r=verifyWorktree(f.work,f.base,f.owner);assert.equal(r.passed,false);assert.equal(r.results[0].exit,7);assert.equal(r.deliveryAuthorized,false);
 assert.throws(()=>startWorktree(f.repo),/dedicated/);
});
test('snapshot CLI requires explicit selection before reading requests or invoking any provider',()=>{
 for(const command of ['run','review','run-adaptive','run-goal','run-issues','restart-goal','goal-propose']){
  const r=spawnSync(process.execPath,['bin/asc-v05.mjs',command,'/nonexistent-owner.json'],{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/explicit --snapshot/);
 }
});

test('owner edits during a command invalidate verification',t=>{
 const f=fixture(t);f.contract.commands=[[process.execPath,'-e',"require('fs').writeFileSync(process.argv[1],'{}')",f.owner]];f.save();assert.throws(()=>verifyWorktree(f.work,f.base,f.owner),/Owner contract changed/);
});

for(const flag of ['--assume-unchanged','--skip-worktree'])test(`hidden index flag ${flag} cannot bind different source to HEAD`,t=>{
 const f=fixture(t);f.git(f.work,'update-index',flag,'feature.cjs');fs.writeFileSync(path.join(f.work,'feature.cjs'),'module.exports=99;');
 assert.equal(f.git(f.work,'status','--porcelain'),'');assert.throws(()=>verifyWorktree(f.work,f.base,f.owner),/Hidden index/);
});

test('verification handles tracked and changed path lists larger than the default Git output buffer',t=>{
 const f=fixture(t),names=Array.from({length:12000},(_,i)=>`${String(i).padStart(5,'0')}-${'x'.repeat(80)}.txt`);
 for(const name of names)fs.writeFileSync(path.join(f.work,name),'');
 f.git(f.work,'add','.');f.git(f.work,'commit','-qm','many changed paths');
 assert(Buffer.byteLength(names.join('\0'))>1024*1024);
 f.contract.allowedPaths.push(...names);f.save();
 assert.equal(verifyWorktree(f.work,f.base,f.owner).passed,true);
 f.contract.allowedPaths.pop();f.save();
 assert.throws(()=>verifyWorktree(f.work,f.base,f.owner),/scope/);
});

test('foreign Git environment cannot redirect internal observations while commands inherit it',t=>{
 const f=fixture(t),saved={...process.env};
 f.contract.commands.push([process.execPath,'-e',"const assert=require('node:assert/strict');assert.equal(process.env.GIT_DIR,process.argv[1]);assert.equal(process.env.GIT_OBJECT_DIRECTORY,process.argv[2]);",path.join(f.repo,'.git'),path.join(f.root,'missing-objects')]);f.save();
 try{
  process.env.GIT_DIR=path.join(f.repo,'.git');process.env.GIT_WORK_TREE=f.repo;process.env.GIT_INDEX_FILE=path.join(f.root,'wrong-index');
  process.env.GIT_OBJECT_DIRECTORY=path.join(f.root,'missing-objects');
  const result=verifyWorktree(f.work,f.base,f.owner);assert.equal(result.passed,true);
  assert.notEqual(result.head,f.base);assert.equal(fs.realpathSync.native(result.repo),fs.realpathSync.native(f.work));
  assert.equal(result.results[1].exit,0);
 }finally{for(const key of Object.keys(process.env))if(!Object.hasOwn(saved,key))delete process.env[key];Object.assign(process.env,saved);}
});

test('verification preserves Host Git configuration without applying it to internal observations',t=>{
 const f=fixture(t),saved={...process.env};
 const code="const {execFileSync}=require('node:child_process');require('node:assert/strict').equal(execFileSync('git',['config','--get','asc.fixture'],{encoding:'utf8'}).trim(),'host-value');";
 f.contract.commands=[[process.execPath,'-e',code]];f.save();
 try{
  process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0='asc.fixture';process.env.GIT_CONFIG_VALUE_0='host-value';
  assert.equal(verifyWorktree(f.work,f.base,f.owner).passed,true);
 }finally{for(const key of Object.keys(process.env))if(!Object.hasOwn(saved,key))delete process.env[key];Object.assign(process.env,saved);}
});


test('verification selects permitted path rules, discovers nested rules and ignores unrelated scope',t=>{
 const f=fixture(t);
 const write=(name,body)=>{const file=path.join(f.work,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);};
 write('src/ui/view.cjs','module.exports=1;');
 write('src/ui/AGENTS.md','UI contract');
 write('rules/ui.md','UI rule');
 write('rules/api.md','API rule');
 write('.agent-skill-chain/project/context.json',JSON.stringify({schema:'asc-project-context/v1',rules:[{path:'rules/ui.md',appliesTo:['src/ui']},{path:'rules/api.md',appliesTo:['src/api']}]}));
 f.git(f.work,'add','.');f.git(f.work,'commit','-qm','scoped contracts');const base=f.git(f.work,'rev-parse','HEAD');
 write('src/ui/view.cjs','module.exports=2;');f.git(f.work,'commit','-qam','UI change');
 f.contract.allowedPaths=['src/ui/view.cjs'];f.save();
 const open=fs.openSync,reads=[],realWork=fs.realpathSync.native(f.work);
 t.mock.method(fs,'openSync',function(file,...args){if(typeof file==='string')reads.push(path.relative(realWork,fs.realpathSync.native(file)).split(path.sep).join('/'));return open.call(fs,file,...args);});
 const verified=verifyWorktree(f.work,base,f.owner);assert.equal(verified.passed,true);assert.equal(verified.contextSha256,startWorktree(f.work,f.contract.allowedPaths).context.digest);
 assert.ok(reads.includes('src/ui/AGENTS.md'));assert.ok(reads.includes('rules/ui.md'));assert.ok(!reads.includes('rules/api.md'));
 // A selected missing rule must still fail before running commands.
 fs.unlinkSync(path.join(f.work,'rules/ui.md'));
 assert.throws(()=>verifyWorktree(f.work,base,f.owner),/ENOENT/);
});

test('verification invalidates ignored project rules changed by a command',t=>{
 const f=fixture(t);
 fs.appendFileSync(path.join(f.work,'.gitignore'),'AGENTS.md\n');f.git(f.work,'commit','-qam','local owner rule may remain untracked');
 fs.writeFileSync(path.join(f.work,'AGENTS.md'),'Original local requirement');
 f.contract.allowedPaths.push('.gitignore');
 f.contract.commands=[[process.execPath,'-e',"require('fs').writeFileSync('AGENTS.md','Changed local requirement')"],[process.execPath,'-e',"require('fs').writeFileSync('AGENTS.md','Original local requirement')"]];f.save();
 assert.throws(()=>verifyWorktree(f.work,f.base,f.owner),/Project context changed/);
 assert.equal(fs.readFileSync(path.join(f.work,'AGENTS.md'),'utf8'),'Changed local requirement','must stop before the next command can restore the rule');
});

test('read-only null protection mounts do not make a clean worktree dirty; real source still does',{skip:process.platform!=='linux'},t=>{
 const f=fixture(t),masked=path.join(f.work,'.claude/settings.json');fs.mkdirSync(path.dirname(masked));fs.writeFileSync(masked,'host-only');
 const module=new URL('../src/worktree-execution.mjs',import.meta.url).href;
 const run=(bind='--ro-bind',target=masked)=>spawnSync('bwrap',['--ro-bind','/','/','--dev-bind','/dev','/dev','--bind',f.root,f.root,'--proc','/proc',bind,'/dev/null',target,'--',process.execPath,'--input-type=module','-e',`import {verifyWorktree} from ${JSON.stringify(module)}; console.log(JSON.stringify(verifyWorktree(...process.argv.slice(1))))`,f.work,f.base,f.owner],{encoding:'utf8'});
 const unapproved=run();assert.notEqual(unapproved.status,0);assert.match(unapproved.stderr,/Commit intended changes/);
 f.contract.hostMaskedPaths=['feature.cjs'];f.save();const overlap=run();assert.notEqual(overlap.status,0);assert.match(overlap.stderr,/outside change scope/);
 f.contract.hostMaskedPaths=['.claude/settings.json'];f.save();
 const ok=run();assert.equal(ok.status,0,ok.stderr);const result=JSON.parse(ok.stdout);assert.equal(result.passed,true);assert.deepEqual(result.hostMaskedPaths,['.claude/settings.json']);
 assert.equal(fs.readFileSync(masked,'utf8'),'host-only'); // underlying Host asset was never changed
 const writable=run('--bind');assert.notEqual(writable.status,0);assert.match(writable.stderr,/read-only null mounts/);
 fs.writeFileSync(path.join(f.work,'other.txt'),'uncommitted');const other=run();assert.notEqual(other.status,0);assert.match(other.stderr,/Commit intended changes/);fs.unlinkSync(path.join(f.work,'other.txt'));
 fs.writeFileSync(path.join(f.work,'feature.cjs'),'module.exports=99;');const tracked=run();assert.notEqual(tracked.status,0);assert.match(tracked.stderr,/Commit intended changes/);f.git(f.work,'checkout','--','feature.cjs');
 f.contract.commands.push([process.execPath,'-e',"require('fs').writeFileSync('new.txt','new')"]);f.save();const generated=run();assert.notEqual(generated.status,0);assert.match(generated.stderr,/Verification changed/);fs.unlinkSync(path.join(f.work,'new.txt'));
 fs.unlinkSync(masked);fs.symlinkSync('/dev/null',masked);assert.throws(()=>verifyWorktree(f.work,f.base,f.owner),/read-only null mounts/);
});
