import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resumeContext,parseWorktrees,issueFromBranch,hookDirectory,readHookInput} from '../src/resume-context.mjs';
const cli=fileURLToPath(new URL('../bin/asc-v05.mjs',import.meta.url));

function repository(t){
 const root=fs.realpathSync(tempDir('asc-resume-context-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const main=path.join(root,'main'),git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@example.invalid',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@example.invalid'}});
 fs.mkdirSync(main);git(main,'init','-q','-b','main');fs.writeFileSync(path.join(main,'file'),'base');git(main,'add','file');git(main,'commit','-qm','base');fs.appendFileSync(path.join(main,'.git/info/exclude'),'.worktrees/\n');
 const work=path.join(main,'.worktrees','20261121_000000-42-sample');git(main,'worktree','add','-q','-b','docs/42-sample',work);
 fs.writeFileSync(path.join(work,'pending'),'not committed');
 return {root,main,work,head:git(main,'rev-parse','HEAD').trim()};
}

test('lists every worktree with branch, HEAD, uncommitted count and the issue guessed from the standard branch name',t=>{
 const {main,work,head}=repository(t);
 const text=resumeContext(work);
 assert.match(text,/^ASC: Context/);
 assert.match(text,new RegExp(`現在の作業場所: ${work.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
 const lines=text.split('\n');
 const mainLine=lines.find(l=>l.startsWith(`- ${main} `)),workLine=lines.find(l=>l.startsWith('- （現在の作業場所）'));
 assert.equal(lines.findIndex(l=>l.startsWith('- ')),lines.indexOf(workLine),'the current worktree is listed first');
 assert.match(mainLine,new RegExp(`branch main HEAD ${head.slice(0,12)} 未commit 0件$`));
 assert.match(workLine,/^- （現在の作業場所） branch docs\/42-sample HEAD [0-9a-f]{12} 未commit 1件 Issue #42$/);
 assert.match(text,/このhookはIssue・PRを読まない/);
});

test('an inherited GIT_DIR does not redirect the listing to another repository',t=>{
 const {work}=repository(t),other=repository(t);
 const r=spawnSync(process.execPath,[cli,'resume-context',work],{encoding:'utf8',env:{...process.env,GIT_DIR:path.join(other.main,'.git')}});
 assert.equal(r.status,0,r.stderr);assert(r.stdout.includes(`docs/42-sample`));assert(!r.stdout.includes(other.main));
});

test('outside Git it says so instead of failing',t=>{
 const dir=fs.realpathSync(tempDir('asc-resume-plain-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.match(resumeContext(dir),/Git管理外/);
});

test('hook mode takes cwd from the Host input JSON and never fails the hook',t=>{
 const {work}=repository(t);
 const hook=input=>spawnSync(process.execPath,[cli,'resume-context','--hook'],{encoding:'utf8',input,cwd:path.dirname(cli)});
 for(const source of ['compact','clear','startup']){
  const r=hook(JSON.stringify({session_id:'s',hook_event_name:'SessionStart',source,cwd:work}));
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/docs\/42-sample/);
 }
 const missing=hook(JSON.stringify({cwd:path.join(work,'does-not-exist')}));
 assert.equal(missing.status,0);assert.match(missing.stdout,/^ASC: /);
 const broken=hook('not json');assert.equal(broken.status,0);assert.match(broken.stdout,/^ASC: /);
});

test('parsing helpers accept only what they can confirm',()=>{
 assert.deepEqual(parseWorktrees('worktree /a\nHEAD 1111\nbranch refs/heads/main\n\nworktree /b\nHEAD 2222\ndetached\n\nworktree /c\nbare\n\nworktree /d\nHEAD 3333\nbranch refs/heads/x\nprunable gitdir file points to non-existent location\n'),[
  {path:'/a',head:'1111',branch:'main'},{path:'/b',head:'2222',detached:true},{path:'/c',bare:true},{path:'/d',head:'3333',branch:'x',prunable:true}]);
 assert.equal(issueFromBranch('fix/1755-context-boundary'),1755);
 for(const branch of ['main','feat/12-x','docs/12','docs/x-12-y',undefined])assert.equal(issueFromBranch(branch),undefined);
 assert.equal(hookDirectory('{"cwd":"/abs"}','/fallback'),'/abs');
 for(const input of ['','[]','{"cwd":"relative"}','{"cwd":1}','x'.repeat(70000)])assert.equal(hookDirectory(input,'/fallback'),'/fallback');
});

test('the text stays short when there are many worktrees',()=>{
 const list=Array.from({length:30},(_,i)=>`worktree /w${i}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/docs/${i}-x\n`).join('\n');
 const git=(cwd,args)=>args[0]==='rev-parse'?{status:0,stdout:'/w0\n'}:args[0]==='worktree'?{status:0,stdout:list}:{status:0,stdout:''};
 const text=resumeContext('/w0',{git});
 assert.equal(text.split('\n').filter(l=>l.startsWith('- ')).length,20);assert.match(text,/ほか10件は省略/);assert(text.length<=4000);
});

test('the current worktree comes first and the guidance survives many worktrees with long paths',()=>{
 const long='/'+'x'.repeat(220);
 const paths=Array.from({length:30},(_,i)=>`${long}/w${i}`),current=paths[29];
 const list=paths.map(p=>`worktree ${p}\nHEAD ${'b'.repeat(40)}\nbranch refs/heads/docs/${p.endsWith('w29')?1755:7}-x\n`).join('\n');
 const git=(cwd,args)=>args[0]==='rev-parse'?{status:0,stdout:current+'\n'}:args[0]==='worktree'?{status:0,stdout:list}:{status:0,stdout:' M a\n'};
 const text=resumeContext(current,{git}),lines=text.split('\n');
 assert(text.length<=4000,String(text.length));
 const listed=lines.filter(l=>l.startsWith('- '));
 assert(listed.length>0&&listed.length<20);
 assert.equal(listed[0],`- （現在の作業場所） branch docs/1755-x HEAD ${'b'.repeat(12)} 未commit 1件 Issue #1755`);
 assert.match(text,new RegExp(`ほか${30-listed.length}件は省略`));
 assert.match(lines.at(-1),/^次の手順: .*「許可されたmerge」に従って照合する。$/);
 assert(lines.every(l=>!l.startsWith('- ')||l.endsWith('件')||/Issue #\d+$/.test(l)),'no line is cut in the middle');
});

test('a slow repository is cut off at the deadline instead of outliving the hook timeout',()=>{
 let clock=0;const timeouts=[];
 const list=Array.from({length:5},(_,i)=>`worktree /w${i}\nHEAD ${'c'.repeat(40)}\nbranch refs/heads/main\n`).join('\n');
 const git=(cwd,args,timeout)=>{timeouts.push(timeout);clock+=args[0]==='status'?4000:10;return args[0]==='rev-parse'?{status:0,stdout:'/w0\n'}:args[0]==='worktree'?{status:0,stdout:list}:{status:0,stdout:''};};
 const text=resumeContext('/w0',{git,now:()=>clock,deadline:10000});
 assert(clock<=10000+4000,'no call starts after the deadline');
 assert(timeouts.every(t=>t>0&&t<=5000));
 assert.match(text,/状態は時間切れで未確認/);assert.match(text,/^- （現在の作業場所） .*未commit 0件$/m);
});

test('reading another worktree does not start its fsmonitor or hooks',t=>{
 const {main,work}=repository(t);
 const marker=path.join(main,'..','fsmonitor-ran');
 const script=path.join(main,'..','monitor.sh');fs.writeFileSync(script,`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o755});
 execFileSync('git',['-C',work,'config','core.fsmonitor',script]);
 execFileSync('git',['-C',main,'config','core.fsmonitor',script]);
 assert.match(resumeContext(main),/docs\/42-sample/);
 assert.equal(fs.existsSync(marker),false);
 // The same status call without the guard starts the monitor, so the check above is not vacuous.
 spawnSync('git',['--no-optional-locks','-C',work,'status','--porcelain'],{encoding:'utf8'});
 assert.equal(fs.existsSync(marker),true);
});

test('an extremely long current path still leaves the current worktree state and the guidance',()=>{
 const current='/'+Array.from({length:10},()=>'y'.repeat(189)).join('/');
 const list=[current,'/other'].map(p=>`worktree ${p}\nHEAD ${'d'.repeat(40)}\nbranch refs/heads/fix/${p===current?9:8}-z\n`).join('\n');
 const git=(cwd,args)=>args[0]==='rev-parse'?{status:0,stdout:current+'\n'}:args[0]==='worktree'?{status:0,stdout:list}:{status:0,stdout:''};
 for(const path of [current,'/'+Array.from({length:30},()=>'y'.repeat(189)).join('/')]){
  const text=resumeContext(current,{git:path===current?git:(cwd,args)=>args[0]==='rev-parse'?{status:0,stdout:path+'\n'}:args[0]==='worktree'?{status:0,stdout:list.replaceAll(current,path)}:{status:0,stdout:''}});
  assert(text.length<=4000,String(text.length));
  assert.match(text,/^- （現在の作業場所） branch fix\/9-z HEAD d{12} 未commit 0件 Issue #9$/m);
  assert.match(text,/「許可されたmerge」に従って照合する。$/);
 }
});

test('hook input is read within its time limit even when the Host keeps stdin open',async()=>{
 const {PassThrough}=await import('node:stream');
 const open=new PassThrough();open.write('{"cwd":"/abs"}');
 const started=Date.now();assert.equal(await readHookInput(open,{timeoutMs:200}),'{"cwd":"/abs"}');assert(Date.now()-started<2000);
 const big=new PassThrough();const read=readHookInput(big,{timeoutMs:5000,maxBytes:10});big.write('x'.repeat(11));assert.equal(await read,'');
 const closed=new PassThrough();const done=readHookInput(closed,{timeoutMs:5000});closed.end('{"cwd":"/c"}');assert.equal(await done,'{"cwd":"/c"}');
});

test('the hook command answers within its deadline while stdin stays open',async t=>{
 const {work}=repository(t);
 const {spawn}=await import('node:child_process');
 const child=spawn(process.execPath,[cli,'resume-context','--hook'],{cwd:work,stdio:['pipe','pipe','pipe']});
 child.stdin.write(JSON.stringify({cwd:work,source:'compact'}));
 let out='';child.stdout.on('data',d=>out+=d);
 const started=Date.now();
 const code=await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve('killed');},12000);child.on('exit',c=>{clearTimeout(timer);resolve(c);});});
 assert.equal(code,0);assert(Date.now()-started<11000);assert.match(out,/docs\/42-sample/);
});
