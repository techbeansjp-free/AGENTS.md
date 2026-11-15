import {tempDir} from './helpers/temp-dir.mjs';
import {kindOfStdin} from './helpers/stdin-kind.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Controller} from '../src/controller.mjs';import {commitCandidate} from '../src/candidate.mjs';import {createWorktree} from '../src/migration.mjs';

// #1682: a large spawnSync input was seen leaving a loaded macOS child blocked on its stdin pipe.
// A hang is rare (thousands of calls), so no test reproduces it. The first test checks that each Git path returns the right
// content on every OS; the second checks the structure on POSIX: stdin is a regular file, never a pipe or socket.
// The helper itself and the Host transport are tested in test_host_execution.mjs, which Windows CI also runs (#1694).

function repository(t){
 const root=tempDir('asc-stdin-file-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'code.txt'),'before');fs.writeFileSync(path.join(repo,'other.txt'),'other');git('add','.');git('commit','-qm','base');
 const contract={intent:'Change code',criteria:['after'],allowedPaths:['code.txt'],testArgv:['/bin/true'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:''};
 return {root,repo,git,contract,c:new Controller({repo,base:git('rev-parse','HEAD'),contract,implementer:'worker'})};
}
// Record what each Git child gets as stdin, then run the real Git with the same stdin.
function withRecordingGit(root,run){
 const tools=path.join(root,'tools'),log=path.join(root,'git-stdin.jsonl'),realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),originalPath=process.env.PATH;fs.mkdirSync(tools);
 fs.writeFileSync(path.join(tools,'git'),`#!${process.execPath}\nimport fs from 'node:fs';import {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2);${kindOfStdin}\nfs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,kind})+'\\n');\nconst r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??1);\n`,{mode:0o755});
 process.env.PATH=tools+path.delimiter+originalPath;
 try{run();}finally{process.env.PATH=originalPath;}
 return fs.readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
}

test('Controller, candidate and migration Git paths that feed stdin return the right content',t=>{
 // Not skipped on Windows, where the recording test below cannot run. The host-protocol job runs this file on Windows (#1698).
 const {c,root,repo,git}=repository(t);const head=git('rev-parse','HEAD');
 const workspace=path.join(root,'worker');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'code.txt'),'after');
 const blobs=c.blobs(head);assert.equal(blobs.get('code.txt').bytes.toString(),'before');assert.equal(blobs.get('other.txt').bytes.toString(),'other');
 commitCandidate(c,workspace);assert.equal(git('show','HEAD:code.txt'),'after');
 const worktree=createWorktree(repo,{issue:1694,type:'test',slug:'stdin-file',base:head});
 assert.equal(fs.readFileSync(path.join(worktree.repo,'other.txt'),'utf8'),'other');assert.equal(fs.readFileSync(path.join(worktree.repo,'code.txt'),'utf8'),'before');
});

// POSIX only: the fake Git is a script with a shebang, which spawnSync runs without a shell only on POSIX.
// On Windows it would need a .cmd wrapper, and spawnSync cannot start a .cmd without a shell.
test('Controller, candidate and migration Git children read stdin from a regular file, never a pipe',{skip:process.platform==='win32'},t=>{
 const {c,root,repo,git}=repository(t);const head=git('rev-parse','HEAD');
 const workspace=path.join(root,'worker');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'code.txt'),'after');
 let blobs,worktree;
 const calls=withRecordingGit(root,()=>{
  blobs=c.blobs(head);commitCandidate(c,workspace);
  worktree=createWorktree(repo,{issue:1682,type:'fix',slug:'stdin-file',base:head});
 });
 assert.equal(blobs.get('code.txt').bytes.toString(),'before');assert.equal(git('show','HEAD:code.txt'),'after');
 assert.equal(fs.readFileSync(path.join(worktree.repo,'other.txt'),'utf8'),'other');
 const fed=calls.filter(({args})=>args.includes('--batch')||args.includes('--stdin'));
 // Controller cat-file --batch, candidate hash-object --stdin and migration cat-file --batch.
 assert.ok(fed.some(({args})=>args.includes('hash-object')),JSON.stringify(calls));
 assert.ok(fed.filter(({args})=>args.includes('--batch')).length>=2,JSON.stringify(calls));
 for(const call of fed)assert.equal(call.kind,'file',JSON.stringify(call));
 for(const call of calls)assert.ok(call.kind==='file'||call.kind==='char',JSON.stringify(call));
});
