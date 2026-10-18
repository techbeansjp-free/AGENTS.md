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

test('foreign Git environment cannot redirect worktree verification',t=>{
 const f=fixture(t),saved={...process.env};
 f.contract.commands.push(['git','rev-parse','--show-toplevel']);f.save();
 try{
  process.env.GIT_DIR=path.join(f.repo,'.git');process.env.GIT_WORK_TREE=f.repo;process.env.GIT_INDEX_FILE=path.join(f.root,'wrong-index');
  process.env.GIT_OBJECT_DIRECTORY=path.join(f.root,'missing-objects');
  const result=verifyWorktree(f.work,f.base,f.owner);assert.equal(result.passed,true);
  assert.notEqual(result.head,f.base);assert.equal(result.repo,fs.realpathSync(f.work));
  assert.equal(result.results[1].exit,0);
 }finally{for(const key of Object.keys(process.env))if(!Object.hasOwn(saved,key))delete process.env[key];Object.assign(process.env,saved);}
});
