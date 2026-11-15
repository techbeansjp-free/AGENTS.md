import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {withStdinFile} from '../src/source-limits.mjs';
import {Controller} from '../src/controller.mjs';import {commitCandidate} from '../src/candidate.mjs';import {createWorktree} from '../src/migration.mjs';
import {hostExecution} from '../src/host-execution.mjs';

// #1682: a large spawnSync input was seen leaving a loaded macOS child blocked on its stdin pipe.
// A hang is rare (thousands of calls), so these tests check the structure: stdin is a regular file, never a pipe or socket.
const kindOfStdin="const s=fs.fstatSync(0),kind=s.isFile()?'file':s.isFIFO()?'fifo':s.isSocket()?'socket':s.isCharacterDevice()?'char':'other';";

/** The private file behind a stdin descriptor, found by inode among this helper's temp directories. */
function fileBehind(fd){
 const {ino,dev}=fs.fstatSync(fd);
 for(const name of fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith('asc-stdin-'))){
  const file=path.join(os.tmpdir(),name,'input');
  try{const s=fs.statSync(file);if(s.ino===ino&&s.dev===dev)return file;}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 throw Error('stdin file not found');
}

test('withStdinFile gives the child a private regular file with the whole input and removes it afterwards',{skip:process.platform==='win32'},()=>{
 assert.equal(withStdinFile(undefined,stdin=>stdin),'ignore');
 const input=Buffer.alloc(2*1024*1024,7);let file;
 const result=withStdinFile(input,stdin=>{
  assert.equal(typeof stdin,'number');file=fileBehind(stdin);
  assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);
  return spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import {createHash} from 'node:crypto';${kindOfStdin}
const bytes=fs.readFileSync(0);process.stdout.write(JSON.stringify({kind,size:bytes.length,sha:createHash('sha256').update(bytes).digest('hex')}));`],{stdio:[stdin,'pipe','pipe'],encoding:'utf8'});
 });
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),{kind:'file',size:input.length,sha:createHash('sha256').update(input).digest('hex')});
 assert.equal(fs.existsSync(path.dirname(file)),false);
 // The file is removed when the child cannot run or the caller throws.
 assert.throws(()=>withStdinFile('x',stdin=>{file=fileBehind(stdin);throw Error('stop');}),/stop/);
 assert.equal(fs.existsSync(path.dirname(file)),false);
});

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

test('synchronous Host verification reads its request from a regular file, never a pipe',{skip:process.platform==='win32'},t=>{
 const {c,root,repo}=repository(t);const script=path.join(root,'host.mjs'),log=path.join(root,'host-stdin.json');
 fs.writeFileSync(script,`import fs from 'node:fs';${kindOfStdin}
const q=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({kind,operation:q.operation}));
process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,result:{exit:0,stdout:'ok',stderr:''}}));`);
 const host=hostExecution(c,{protocol:'asc-host-execution/v1',command:[process.execPath,script]});
 const result=host.verify({argv:['/bin/true'],workspace:repo,timeout:20000});
 assert.equal(result.status,0);assert.equal(result.stdout.toString(),'ok');
 assert.deepEqual(JSON.parse(fs.readFileSync(log,'utf8')),{kind:'file',operation:'verify'});
});
