import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {startWorktree} from '../src/worktree-execution.mjs';
const cli=path.resolve('bin/asc-v05.mjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-brief-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('coordination preparation is opt-in, reads only packaged guidance and preserves project rule references',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'AGENTS.md'),'private project rule');fs.writeFileSync(path.join(root,'source.mjs'),'private source');
 const ordinary=startWorktree(root,['source.mjs']);assert.equal(ordinary.coordination,undefined);
 const reads=[],read=fs.readFileSync;t.mock.method(fs,'readFileSync',function(file,...args){reads.push(file);return read.call(fs,file,...args);});
 const prepared=startWorktree(root,['source.mjs'],{coordination:true});
 const {coordination,...rest}=prepared;assert.deepEqual(rest,ordinary);assert.equal(prepared.gitManaged,false);
 assert.equal(coordination.guidance.length,2);
 for(const guide of coordination.guidance){assert.equal(guide.text,read(guide.path,'utf8'));assert.equal(guide.sha256,createHash('sha256').update(guide.text).digest('hex'));}
 assert.equal(coordination.reviewerGuide,path.resolve('skills/asc/references/review.md'));
 assert(!reads.includes(path.join(root,'source.mjs')));assert(!reads.includes(coordination.reviewerGuide));
 assert(!JSON.stringify(prepared).includes('private project rule'));assert(!JSON.stringify(prepared).includes('private source'));
 assert.deepEqual(fs.readdirSync(root).sort(),['AGENTS.md','source.mjs']);
 assert.throws(()=>startWorktree(root,[],{coordination:'yes'}),/boolean/);
});
test('CLI preparation preserves path selection, has no writes, and rejects unknown or repeated options',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src/AGENTS.md'),'scoped rule');
 const run=args=>spawnSync(process.execPath,[cli,'start',root,...args],{encoding:'utf8'});
 for(const args of [['--coordination','--path','src/a.mjs'],['--path','src/a.mjs','--coordination']]){
  const r=run(args);assert.equal(r.status,0,r.stderr);const data=JSON.parse(r.stdout);assert.deepEqual(data.context.paths,['src/a.mjs']);assert(data.context.references.some(x=>x.path==='src/AGENTS.md'));assert(data.coordination);
 }
 for(const args of [['--coordination','--coordination'],['--unknown'],['--path']])assert.equal(run(args).status,1);
 assert.equal(run(['--path','--filename']).status,0);
 assert.deepEqual(fs.readdirSync(root),['src']);
});
test('preparation keeps worktree and repository boundaries and emits executable CLI argv templates',t=>{
 const root=fixture(t),repo=path.join(root,'repo'),work=path.join(root,'work');fs.mkdirSync(repo);
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
 git(repo,'init','-q');git(repo,'config','user.name','Synthetic');git(repo,'config','user.email','test@example.invalid');fs.writeFileSync(path.join(repo,'a'),'a');git(repo,'add','.');git(repo,'commit','-qm','base');git(repo,'worktree','add','-qb','task',work);
 const before=git(repo,'worktree','list','--porcelain'),head=git(work,'rev-parse','HEAD');
 assert.throws(()=>startWorktree(repo,[],{coordination:true}),/dedicated/);
 const result=startWorktree(work,[],{coordination:true});assert.equal(result.head,head);assert.equal(result.snapshot,false);assert.equal(result.providerLaunch,false);
 for(const argv of Object.values(result.coordination.commandTemplates)){
  const help=spawnSync(argv[0],[argv[1],argv[2],'--help'],{encoding:'utf8'});assert.equal(help.status,0,help.stderr);for(const placeholder of argv.slice(3))assert(help.stdout.includes(placeholder));
 }
 assert.equal(git(repo,'worktree','list','--porcelain'),before);assert.equal(git(work,'status','--porcelain'),'');
});
