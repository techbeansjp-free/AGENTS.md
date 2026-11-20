import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resumeContext,parseWorktrees,issueFromBranch,hookDirectory} from '../src/resume-context.mjs';
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
 const mainLine=lines.find(l=>l.startsWith(`- ${main} `)),workLine=lines.find(l=>l.startsWith(`- ${work}`));
 assert.match(mainLine,new RegExp(`branch main HEAD ${head.slice(0,12)} 未commit 0件$`));
 assert.match(workLine,/（現在） branch docs\/42-sample HEAD [0-9a-f]{12} 未commit 1件 Issue #42$/);
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
 assert.equal(text.split('\n').filter(l=>l.startsWith('- /w')).length,20);assert.match(text,/ほか10件は省略/);assert(text.length<=4000);
});
