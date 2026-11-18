import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {LOCAL_GIT_TIMEOUT_MILLISECONDS,gitFailureMessage,gitFailureReason,gitPathOutput} from '../src/source-limits.mjs';
import {Controller} from '../src/controller.mjs';import {assertWorkLocation} from '../src/migration.mjs';import {commitCandidate} from '../src/candidate.mjs';import {createVerificationGit} from '../src/verification-git.mjs';

test('failure reason tells a timeout, a buffer overflow, a spawn error, a signal and an exit status apart',()=>{
 assert.equal(LOCAL_GIT_TIMEOUT_MILLISECONDS,20000);
 for(const [result,reason] of [
  [{error:Object.assign(Error('spawnSync git ETIMEDOUT'),{code:'ETIMEDOUT'}),signal:'SIGTERM',status:null},'timed out after 20000 ms'],
  [{error:Object.assign(Error('spawnSync git ENOBUFS'),{code:'ENOBUFS'}),signal:'SIGTERM',status:null},'output exceeded the buffer limit'],
  [{error:Object.assign(Error('spawnSync git ENOENT'),{code:'ENOENT'}),signal:null,status:null},'could not run: ENOENT'],
  [{error:null,signal:'SIGKILL',status:null},'terminated by SIGKILL'],
  [{error:null,signal:null,status:128},'exit status 128'],
 ])assert.equal(gitFailureReason(result),reason);
});

test('a real spawnSync timeout is reported as a timeout with the limit that was applied',()=>{
 const result=spawnSync(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeout:200});
 assert.equal(gitFailureReason(result,200),'timed out after 200 ms');
 assert.equal(gitFailureMessage('Git observation failed',result,200),'Git observation failed (timed out after 200 ms)');
});

// #1734: Git quotes repo-local config values and remote URLs in its stderr, and a message reaches the Agent that runs
// the CLI. No redaction of free text is complete, so the message names only how the child failed.
test('a failure message names only the failure kind and never carries stderr',()=>{
 const stderr=Buffer.from("fatal: bad config value 'first\nerror: SYNTHETIC_SECRET' https://u:SYNTHETIC_SECRET@example.invalid/\n");
 assert.equal(gitFailureMessage('Candidate Git operation failed',{error:null,signal:null,status:128,stderr}),'Candidate Git operation failed (exit status 128)');
 assert.equal(gitFailureMessage('Git observation failed',{error:null,signal:'SIGKILL',status:null,stderr}),'Git observation failed (terminated by SIGKILL)');
});

// The value shapes that leaked through the redaction this replaces (#1696, #1734): a URL with a password, and a
// multi-line value whose later line starts like a Git message. Real Git must still quote them, or the test proves nothing.
const leakingValues=['https://u:SYNTHETIC_SECRET@example.invalid/x',"first\nerror: SYNTHETIC_SECRET it's"];
test('real Git quotes a malformed repo-local config value, and the Controller message leaves it out',{skip:process.platform==='win32'},t=>{
 const {c,repo,git}=repository(t);
 for(const value of leakingValues){
  git('config','core.compression',value);
  // The precondition runs Git with the Controller's options and environment (src/controller.mjs gitOutput).
  const env={PATH:process.env.PATH,HOME:os.tmpdir(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0'};
  const raw=spawnSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','protocol.allow=never','rev-parse','HEAD'],{cwd:repo,env,encoding:'utf8'});
  assert.equal(raw.status,128);assert.match(raw.stderr,/SYNTHETIC_SECRET/);
  assert.throws(()=>c.git('rev-parse','HEAD'),{message:'Git observation failed (exit status 128)'});
  git('config','--unset','core.compression');
 }
});

test('a commit identity that Git rejects is named by its exit status, and an empty one is refused before Git',{skip:process.platform==='win32'},t=>{
 const {c,root}=repository(t);
 const workspace=path.join(root,'worker');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'code.txt'),'after');
 assert.throws(()=>commitCandidate(c,workspace,{name:'<>',email:'owner@example.com'}),{message:'Candidate Git operation failed (exit status 128)'});
 assert.throws(()=>commitCandidate(c,workspace,{name:'',email:'owner@example.com'}),/Invalid commit identity/);
 assert.throws(()=>commitCandidate(c,workspace,{name:'Owner',email:''}),/Invalid commit identity/);
});

function repository(t){
 const root=tempDir('asc-git-failure-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'code.txt'),'before');git('add','.');git('commit','-qm','base');
 const contract={intent:'Change code',criteria:['after'],allowedPaths:['code.txt'],testArgv:['/bin/true'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'owner',risks:[],unresolved:[],requiresDesign:false,design:''};
 return {root,repo,git,contract,c:new Controller({repo,base:git('rev-parse','HEAD'),contract,implementer:'worker'})};
}
// Fail only the named Git subcommand and pass every other call to the real Git, like test_project_assets.mjs.
let toolCount=0;
function withFailingGit(root,subcommand,body,run){
 const tools=path.join(root,`tools-${++toolCount}`),realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),originalPath=process.env.PATH;fs.mkdirSync(tools);
 fs.writeFileSync(path.join(tools,'git'),`#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2);if(args.includes(${JSON.stringify(subcommand)})){${body}}const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??1);\n`,{mode:0o755});
 process.env.PATH=tools+path.delimiter+originalPath;
 try{return run();}finally{process.env.PATH=originalPath;}
}
const exitWithSecret="process.stderr.write(\"fatal: cannot reach https://user:s3cr3t@example.invalid/\\n\");process.exit(3);";
const killSelf="process.kill(process.pid,'SIGKILL');";

test('Controller Git observation names the exit status or signal, without stderr',{skip:process.platform==='win32'},t=>{
 const {c,root}=repository(t);
 assert.throws(()=>c.git('rev-parse','--verify','missing^{commit}'),{message:'Git observation failed (exit status 128)'});
 withFailingGit(root,'ls-tree',exitWithSecret,()=>assert.throws(()=>c.git('ls-tree','HEAD'),{message:'Git observation failed (exit status 3)'}));
 withFailingGit(root,'ls-tree',killSelf,()=>assert.throws(()=>c.git('ls-tree','HEAD'),{message:'Git observation failed (terminated by SIGKILL)'}));
 // gitLarge sends stdout to a file descriptor; its failure is named the same way.
 withFailingGit(root,'diff',exitWithSecret,()=>assert.throws(()=>c.gitLarge('diff','HEAD','HEAD'),{message:'Git observation failed (exit status 3)'}));
});

test('candidate Git operation names the exit status or signal of the failed step',{skip:process.platform==='win32'},t=>{
 const {c,root,repo,git}=repository(t);const head=git('rev-parse','HEAD');
 const workspace=path.join(root,'worker');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'code.txt'),'after');
 withFailingGit(root,'commit-tree',exitWithSecret,()=>assert.throws(()=>commitCandidate(c,workspace),{message:'Candidate Git operation failed (exit status 3)'}));
 withFailingGit(root,'commit-tree',killSelf,()=>assert.throws(()=>commitCandidate(c,workspace),{message:'Candidate Git operation failed (terminated by SIGKILL)'}));
 assert.equal(git('rev-parse','HEAD'),head);assert.equal(fs.readFileSync(path.join(repo,'code.txt'),'utf8'),'before');
});

test('verification Git index names the exit status or signal of read-tree',{skip:process.platform==='win32'},t=>{
 const {c,root,git}=repository(t);const head=git('rev-parse','HEAD'),commit=c.git('cat-file','commit',head),blobs=c.blobs(head);
 for(const [index,[body,message]] of Object.entries( [[exitWithSecret,'Verification Git index failed (exit status 3)'],[killSelf,'Verification Git index failed (terminated by SIGKILL)']])){
  const view=path.join(root,`view-${index}`);fs.mkdirSync(view);
  withFailingGit(root,'read-tree',body,()=>assert.throws(()=>createVerificationGit(view,head,commit,blobs),{message}));
 }
});

test('a migration Git failure names the exit status',t=>{
 const root=tempDir('asc-migration-git-failure-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 // The first rev-parse fails the way a non-Git start did without a reason before (#1688). A .git file that names a
 // missing directory stops Git at this directory, so the result does not depend on whether os.tmpdir() is inside a
 // repository (#1702); the migration Git env is fixed, so GIT_CEILING_DIRECTORIES cannot be set instead.
 // The target sits inside a repository on purpose, as when os.tmpdir() is inside one.
 execFileSync('git',['init','-q',root]);const inner=path.join(root,'inner');fs.mkdirSync(inner);
 fs.writeFileSync(path.join(inner,'.git'),`gitdir: ${path.join(root,'missing')}\n`);
 // Not asserted on purpose (#1702): that migration passes its 120000 ms bound to the helper. Only a real timeout shows
 // it, which takes two minutes; the reason text for any bound is covered by the gitFailureReason tests above.
 assert.throws(()=>assertWorkLocation(inner),{message:'Migration Git operation failed (exit status 128)'});
});

test('local Git children take the null device from one place (#1711)',async()=>{
 const {GIT_NULL_DEVICE}=await import('../src/source-limits.mjs');
 assert.equal(GIT_NULL_DEVICE,process.platform==='win32'?'NUL':'/dev/null');
 // host-masked-paths stats the POSIX device on purpose: it identifies Linux sandbox mounts, not a Git path.
 const allowed=new Set(['source-limits.mjs','host-masked-paths.mjs']);
 const src=new URL('../src/',import.meta.url),spelled=[];
 for(const name of fs.readdirSync(src).filter(n=>n.endsWith('.mjs')&&!allowed.has(n)))
  for(const [i,line] of fs.readFileSync(new URL(name,src),'utf8').split('\n').entries())if(/\/dev\/null|['"`]NUL['"`]|=NUL\b/.test(line))spelled.push(`${name}:${i+1}`);
 assert.deepEqual(spelled,[]);
});

test('a Git path keeps trailing spaces and loses only its line ending (#1731)',()=>{
 assert.equal(gitPathOutput('/srv/meta \n'),'/srv/meta ');
 assert.equal(gitPathOutput(Buffer.from('C:/repo/.git\r\n')),'C:/repo/.git');
 assert.equal(gitPathOutput('/srv/meta'),'/srv/meta');
 assert.equal(gitPathOutput('/srv/meta\n\n'),'/srv/meta\n','only one line ending is removed');
});
