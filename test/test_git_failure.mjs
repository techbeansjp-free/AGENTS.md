import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {LOCAL_GIT_TIMEOUT_MILLISECONDS,gitFailureMessage,gitFailureReason,gitStderrExcerpt} from '../src/source-limits.mjs';
import {Controller} from '../src/controller.mjs';import {commitCandidate} from '../src/candidate.mjs';import {createVerificationGit} from '../src/verification-git.mjs';

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

test('stderr excerpt is one bounded line without control characters or credential-like values',()=>{
 const secret=['fatal: unable to access \'https://user:s3cr3t-pass@example.invalid/repo.git/\'',
  'Authorization: Bearer abcdefghijklmnop','Bearer abcdefghij_REST','token ghp_'+'a'.repeat(36),'key sk-'+'b'.repeat(24),'\u001b[31mred\u001b[0m'].join('\n');
 const excerpt=gitStderrExcerpt(Buffer.from(secret));
 for(const leaked of ['s3cr3t-pass','abcdefghijklmnop','_REST','a'.repeat(36),'b'.repeat(24),'\u001b','\n'])assert.equal(excerpt.includes(leaked),false,leaked);
 assert.equal(excerpt,"fatal: unable to access 'https://***@example.invalid/repo.git/' Authorization: *** Bearer *** token *** key *** [31mred [0m");
 assert.equal(gitStderrExcerpt(null),'');assert.equal(gitStderrExcerpt(Buffer.alloc(0)),'');
 assert.equal(gitFailureMessage('Candidate Git operation failed',{error:null,signal:null,status:1,stderr:Buffer.from('  \n')}),'Candidate Git operation failed (exit status 1)');
});

test('stderr excerpt keeps the final fatal line and redacts before it cuts',()=>{
 const noisy='hint: '+'x'.repeat(10000)+' fatal: the reason';
 assert.equal(gitStderrExcerpt(Buffer.from(noisy.replace(' fatal','\nfatal'))),'…'+noisy.slice(-512));
 // A credential that starts before the cut is redacted as a whole, wherever the cut falls.
 const boundary=Buffer.from('fatal: https://user:'+'p'.repeat(600)+'@example.invalid/ '+' '.repeat(3000)+'\n');
 assert.equal(gitStderrExcerpt(boundary),'fatal: https://***@example.invalid/');
 for(const length of [100,500,1500,2028,2032,2040,5000]){
  const bearer=gitStderrExcerpt(Buffer.from('x'.repeat(5000)+' Authorization: Bearer '+'A'.repeat(length)+' fatal: end'));
  assert.equal(bearer.includes('AAAA'),false,String(length));assert.match(bearer,/Authorization: \*\*\* fatal: end$/);
  const custom=gitStderrExcerpt(Buffer.from('Authorization: Custom eyJ'+'v'.repeat(length)+' '+Array.from({length:48},()=>'ghp_'+'a'.repeat(36)).join(' ')+' fatal: end'));
  assert.equal(custom.includes('vvvv'),false,String(length));assert.match(custom,/\*\*\* fatal: end$/);
 }
 for(const prefix of ['1','...','-','x'.repeat(40)])assert.equal(gitStderrExcerpt(`fatal: ${prefix}https://u:s3cr3t@example.invalid/`).includes('s3cr3t'),false,prefix);
 // Sixteen megabytes (the largest Controller stderr) of stderr without spaces stays linear.
 const started=performance.now(),huge=gitStderrExcerpt(Buffer.from('a.'.repeat(8_000_000)));
 assert.ok(performance.now()-started<10000);assert.equal(huge,'…'+'a.'.repeat(256));
 assert.equal(gitStderrExcerpt('é'.repeat(600)),'…'+'é'.repeat(512));assert.equal(gitStderrExcerpt('😀'.repeat(600)),'…'+'😀'.repeat(512));
 // An odd cut starts the tail at a lone low surrogate, which must not be shown.
 assert.equal(gitStderrExcerpt('😀'.repeat(600)+'x'),'…'+'😀'.repeat(511)+'x');
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

test('Controller Git observation names the exit status and a redacted stderr excerpt',{skip:process.platform==='win32'},t=>{
 const {c,root}=repository(t);
 assert.throws(()=>c.git('rev-parse','--verify','missing^{commit}'),{message:/^Git observation failed \(exit status 128; stderr: fatal: .+\)$/});
 withFailingGit(root,'ls-tree',exitWithSecret,()=>assert.throws(()=>c.git('ls-tree','HEAD'),{message:'Git observation failed (exit status 3; stderr: fatal: cannot reach https://***@example.invalid/)'}));
 withFailingGit(root,'ls-tree',killSelf,()=>assert.throws(()=>c.git('ls-tree','HEAD'),{message:'Git observation failed (terminated by SIGKILL)'}));
 // gitLarge sends stdout to a file descriptor; stderr is still piped and reported.
 withFailingGit(root,'diff',exitWithSecret,()=>assert.throws(()=>c.gitLarge('diff','HEAD','HEAD'),{message:'Git observation failed (exit status 3; stderr: fatal: cannot reach https://***@example.invalid/)'}));
});

test('candidate Git operation names the exit status or signal of the failed step',{skip:process.platform==='win32'},t=>{
 const {c,root,repo,git}=repository(t);const head=git('rev-parse','HEAD');
 const workspace=path.join(root,'worker');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'code.txt'),'after');
 withFailingGit(root,'commit-tree',exitWithSecret,()=>assert.throws(()=>commitCandidate(c,workspace),{message:'Candidate Git operation failed (exit status 3; stderr: fatal: cannot reach https://***@example.invalid/)'}));
 withFailingGit(root,'commit-tree',killSelf,()=>assert.throws(()=>commitCandidate(c,workspace),{message:'Candidate Git operation failed (terminated by SIGKILL)'}));
 assert.equal(git('rev-parse','HEAD'),head);assert.equal(fs.readFileSync(path.join(repo,'code.txt'),'utf8'),'before');
});

test('verification Git index names the exit status or signal of read-tree',{skip:process.platform==='win32'},t=>{
 const {c,root,git}=repository(t);const head=git('rev-parse','HEAD'),commit=c.git('cat-file','commit',head),blobs=c.blobs(head);
 for(const [index,[body,message]] of Object.entries( [[exitWithSecret,'Verification Git index failed (exit status 3; stderr: fatal: cannot reach https://***@example.invalid/)'],[killSelf,'Verification Git index failed (terminated by SIGKILL)']])){
  const view=path.join(root,`view-${index}`);fs.mkdirSync(view);
  withFailingGit(root,'read-tree',body,()=>assert.throws(()=>createVerificationGit(view,head,commit,blobs),{message}));
 }
});
