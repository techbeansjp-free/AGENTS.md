import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sessionOptions,runHostSession,claudeReviewArguments,claudeRenameArguments,CODEX_REVIEW_PROFILE,codexReviewProfileArguments,codexReviewReadablePaths,resolveExecutable} from '../src/host-session.mjs';

function fixture(t,host,mode='success'){
 const root=tempDir('asc-session-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const executable=path.join(root,'host');
 const mutation=`async function mutate(){if(fs.existsSync(${JSON.stringify(path.join(root,'mutate.json'))})){const change=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'mutate.json'))}));const {spawnSync}=await import('node:child_process');spawnSync('git',['-C',change.target,'update-ref','HEAD',change.head],{encoding:'utf8'});}}
if(${JSON.stringify(mode)}!=='rename-mutate')await mutate();`;
 const body=host==='claude'?`
 const args=process.argv.slice(2);const value=k=>args[args.indexOf(k)+1];
 fs.appendFileSync(${JSON.stringify(path.join(root,'calls'))},JSON.stringify(args)+'\\n');
 fs.appendFileSync(${JSON.stringify(path.join(root,'cwd'))},process.cwd()+'\\n');
 process.stdin.resume();process.stdin.on('end',async()=>{
 if(args.includes('--resume')){if(${JSON.stringify(mode)}==='rename-mutate')await mutate();console.log('RENAME ONLY');process.exit(${mode==='rename-fail'?9:0});}
 console.log(JSON.stringify({type:'result',session_id:value('--session-id'),is_error:false,result:${JSON.stringify(mode==='empty'?'':'ORIGINAL REVIEW')}}));
 process.exit(${mode==='run-fail'?3:0});});
 `:`
 import {createInterface} from 'node:readline';
 process.on('SIGTERM',()=>{process.stderr.write('shutdown diagnostic\\n',()=>process.exit(0));});
 fs.appendFileSync(${JSON.stringify(path.join(root,'cwd'))},process.cwd()+'\\n');
 fs.appendFileSync(${JSON.stringify(path.join(root,'argv'))},JSON.stringify(process.argv.slice(2))+'\\n');
 let names=0;
 const send=m=>console.log(JSON.stringify(m));
 createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(path.join(root,'calls'))},line+'\\n');
 if(m.method==='initialized')return;
 if(m.method==='initialize')return send({id:m.id,result:{}});
 if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'thread-owned'},...(${JSON.stringify(mode)}==='no-profile'?{}:{activePermissionProfile:{id:${JSON.stringify(mode)}==='other-profile'?':read-only':m.params.permissions}})}});
 if(m.method==='thread/name/set'){
 names++;if(names===2&&${JSON.stringify(mode)}==='rename-mutate')await mutate();if(${JSON.stringify(mode)}==='start-name-fail'||(${JSON.stringify(mode)}==='rename-fail'&&names===2))return send({id:m.id,error:{message:'name unavailable'}});
 return send({id:m.id,result:{}});}
 if(m.method==='turn/start'){
 send({id:m.id,result:{turn:{id:'turn-owned'}}});
 send({method:'item/completed',params:{threadId:'thread-owned',item:{type:'agentMessage',text:${JSON.stringify(mode==='empty'?'':'ORIGINAL REVIEW')}}}});
 if(${JSON.stringify(mode)}==='timeout')return;
 send({method:'turn/completed',params:{threadId:'unrelated',turn:{id:'turn-other',status:'completed'}}});
 return send({method:'turn/completed',params:{threadId:'thread-owned',turn:{id:'turn-owned',status:${JSON.stringify(mode==='run-fail'?'failed':'completed')}}}});}
 });`;
 fs.writeFileSync(executable,`#!${process.execPath}\nimport fs from 'node:fs';\n${mutation}\nfs.appendFileSync(${JSON.stringify(path.join(root,'env'))},JSON.stringify({git:Object.keys(process.env).filter(k=>/^GIT_/i.test(k)),sentinel:process.env.ASC_TEST_SENTINEL})+'\\n');\n${body}`,{mode:0o700});
 const promptFile=path.join(root,'request.txt');fs.writeFileSync(promptFile,'Review the specified worktree.');
 return {root,options:{host,cwd:root,model:'test-model',name:'1644 日本語 $literal',promptFile,outputDir:path.join(root,'result'),executable,ephemeral:false,timeout:2000}};
}

for(const host of ['claude','codex']){
 test(`${host}: named session finishes and keeps original response`,async t=>{
  const {root,options}=fixture(t,host);const result=await runHostSession(options);
  assert.equal(result.status,'completed');assert.equal(result.naming,'completed');
  assert.equal(fs.readFileSync(path.join(options.outputDir,'result.txt'),'utf8'),'ORIGINAL REVIEW\n');
  const calls=fs.readFileSync(path.join(root,'calls'),'utf8').trim().split('\n').map(JSON.parse);
  if(host==='claude'){
   assert(calls[0].includes('自動: '+options.name));assert(calls[1].includes('済: 自動: '+options.name));
   assert(calls[1].includes(result.sessionId));assert(calls[0].includes('dontAsk'));assert(calls[0].includes('--strict-mcp-config'));
   assert.deepEqual(calls[0],claudeReviewArguments({model:options.model,sessionId:result.sessionId,instruction:calls[0][calls[0].indexOf('--append-system-prompt')+1],cwd:result.cwd,targetDirectory:result.targetDirectory,ephemeral:false,name:result.name}),'The Host receives exactly the read-scope-confined arguments');
   assert.equal(calls[1][calls[1].indexOf('--tools')+1],'');
   for(const call of calls)assert.deepEqual(JSON.parse(call[call.indexOf('--settings')+1]),{disableAllHooks:true});
   assert.equal(calls[1][calls[1].indexOf('--model')+1],options.model);
  }else{
   assert.deepEqual(calls.filter(c=>c.method==='thread/name/set').map(c=>c.params),[{threadId:'thread-owned',name:'自動: '+options.name},{threadId:'thread-owned',name:'済: 自動: '+options.name}]);
   const start=calls.find(c=>c.method==='thread/start');assert.equal(start.params.approvalPolicy,'never');
   assert.equal(start.params.permissions,CODEX_REVIEW_PROFILE);assert(!('sandbox' in start.params),'read-only sandbox does not limit reads and cannot be combined with a profile');
   const turn=calls.find(c=>c.method==='turn/start');assert.equal(turn.params.permissions,CODEX_REVIEW_PROFILE);assert(!('sandboxPolicy' in turn.params));
   assert.deepEqual(calls.find(c=>c.method==='initialize').params.capabilities,{experimentalApi:true});
   const argv=JSON.parse(fs.readFileSync(path.join(root,'argv'),'utf8').trim());
   assert.deepEqual(argv,['app-server',...codexReviewProfileArguments(result.targetDirectory,codexReviewReadablePaths({executable:fs.realpathSync(options.executable),gitCommonDir:null}))],'The Host receives exactly the read-scope profile');
  }
  await assert.rejects(runHostSession(options),/EEXIST/);
  assert.equal(fs.readFileSync(path.join(options.outputDir,'result.txt'),'utf8'),'ORIGINAL REVIEW\n');
 });
 test(`${host}: rename failure never replaces successful response`,async t=>{
  const {options}=fixture(t,host,'rename-fail');const result=await runHostSession(options);
  assert.equal(result.status,'completed');assert.equal(result.naming,'failed');
  assert.equal(fs.readFileSync(path.join(options.outputDir,'result.txt'),'utf8'),'ORIGINAL REVIEW\n');
 });
 test(`${host}: failed review is never marked done`,async t=>{
  const {root,options}=fixture(t,host,'run-fail');const result=await runHostSession(options);
  assert.equal(result.status,'failed');assert.notEqual(result.naming,'completed');
  assert(!fs.readFileSync(path.join(root,'calls'),'utf8').includes('済: '));
  assert(fs.readFileSync(path.join(options.outputDir,'events.jsonl'),'utf8').includes('ORIGINAL REVIEW'));
 });
 test(`${host}: ephemeral mode skips persisted naming`,async t=>{
  const {root,options}=fixture(t,host);options.ephemeral=true;const result=await runHostSession(options);
  assert.equal(result.status,'completed');assert.equal(result.naming,'not-persisted');
  const calls=fs.readFileSync(path.join(root,'calls'),'utf8');assert(!calls.includes('済: '));
  assert(host==='claude'?calls.includes('--no-session-persistence'):calls.includes('"ephemeral":true'));
 });
}
for(const mode of ['no-profile','other-profile'])test(`Codex without the review permission profile stops before model turn (${mode})`,async t=>{
 const {root,options}=fixture(t,'codex',mode);const result=await runHostSession(options);
 assert.equal(result.status,'failed');assert.match(result.error,/permission profile/);
 assert(!fs.readFileSync(path.join(root,'calls'),'utf8').includes('turn/start'));
});
test('Codex unavailable naming stops before model turn',async t=>{
 const {root,options}=fixture(t,'codex','start-name-fail');const result=await runHostSession(options);
 assert.equal(result.status,'failed');assert(!fs.readFileSync(path.join(root,'calls'),'utf8').includes('turn/start'));
});
test('Codex timeout preserves partial response and fails',async t=>{
 const {options}=fixture(t,'codex','timeout');const result=await runHostSession(options);
 assert.equal(result.status,'failed');assert.match(result.error,/timeout/);
 assert.equal(fs.readFileSync(path.join(options.outputDir,'result.txt'),'utf8'),'ORIGINAL REVIEW\n');
});
test('CLI validates input before launching and handles missing executable',async t=>{
 assert.throws(()=>sessionOptions(['codex','.']),/Missing/);
 const {options}=fixture(t,'claude');options.executable='/no-such-asc1644-binary';
 const result=await runHostSession(options);assert.equal(result.status,'failed');assert.match(result.error,/ENOENT/);
 const invalid=spawnSync(process.execPath,['bin/asc-v05.mjs','host-session','codex','.','--unknown'],{encoding:'utf8'});
 assert.equal(invalid.status,1);assert.match(invalid.stderr,/Invalid/);
 const help=spawnSync(process.execPath,['bin/asc-v05.mjs','host-session','--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/ephemeral/);
});

test('Claude rename model is explicit and does not change review model',async t=>{
 const {root,options}=fixture(t,'claude');options.renameModel='small-authorized';
 const result=await runHostSession(options);assert.equal(result.naming,'completed');
 const calls=fs.readFileSync(path.join(root,'calls'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls[0][calls[0].indexOf('--model')+1],'test-model');
 assert.equal(calls[1][calls[1].indexOf('--model')+1],'small-authorized');
});

for(const host of ['claude','codex'])test(`${host}: empty response never marks done`,async t=>{
 const {options}=fixture(t,host,'empty');const result=await runHostSession(options);
 assert.equal(result.status,'failed');assert.notEqual(result.naming,'completed');
});
test('duplicate timeout option is rejected',()=>{
 assert.throws(()=>sessionOptions(['codex','.','--timeout-ms','100','--timeout-ms','200']),/duplicate/);
});

function git(cwd,...args){
 const result=spawnSync('git',['-c','user.name=ASC Test','-c','user.email=test@example.invalid','-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
 assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
function linkedTarget(root){
 const primary=path.join(root,'primary 日本語'),target=path.join(root,'outside worktree');fs.mkdirSync(primary);
 git(primary,'init');fs.writeFileSync(path.join(primary,'marker.txt'),'PRIMARY');git(primary,'add','marker.txt');git(primary,'commit','-m','primary');
 git(primary,'worktree','add','-b','review-target',target);
 fs.writeFileSync(path.join(target,'marker.txt'),'TARGET');git(target,'commit','-am','target');
 return {primary:fs.realpathSync(primary),target:fs.realpathSync(target),head:git(target,'rev-parse','HEAD')};
}
for(const host of ['claude','codex'])test(`${host}: launch and rename at primary root but bind a different worktree HEAD`,async t=>{
 const {root,options}=fixture(t,host);const {primary,target,head}=linkedTarget(root);options.cwd=target;
 const result=await runHostSession(options);assert.equal(result.status,'completed');assert.equal(result.naming,'completed');
 assert.equal(result.cwd,primary);assert.equal(result.targetDirectory,target);assert.equal(result.targetHead,head);
 assert(fs.readFileSync(path.join(root,'cwd'),'utf8').trim().split('\n').every(cwd=>cwd===primary));
 const calls=fs.readFileSync(path.join(root,'calls'),'utf8').trim().split('\n').map(JSON.parse);
 if(host==='claude'){
  assert.equal(calls[0][calls[0].indexOf('--add-dir')+1],target);
  const instruction=calls[0][calls[0].indexOf('--append-system-prompt')+1];assert(instruction.includes(head));assert(instruction.includes(JSON.stringify(target)));
  assert(calls[1].includes(result.sessionId));
 }else{
  const start=calls.find(c=>c.method==='thread/start');assert.equal(start.params.cwd,primary);
  assert(start.params.developerInstructions.includes(head));assert(start.params.developerInstructions.includes(JSON.stringify(target)));
  assert.equal(calls.find(c=>c.method==='turn/start').params.cwd,undefined,'Do not move the persisted thread cwd to the worktree');
  const argv=JSON.parse(fs.readFileSync(path.join(root,'argv'),'utf8').trim());
  assert.deepEqual(argv.slice(1),codexReviewProfileArguments(target,codexReviewReadablePaths({executable:fs.realpathSync(options.executable),gitCommonDir:fs.realpathSync(path.join(primary,'.git'))})),'Only the target and shared Git metadata, not the primary checkout, become readable');
 }
 assert.equal(fs.readFileSync(path.join(primary,'marker.txt'),'utf8'),'PRIMARY');
});
test('root input and non-Git input preserve their launch directory',async t=>{
 const {root,options}=fixture(t,'codex');const {primary}=linkedTarget(root);options.cwd=primary;
 const result=await runHostSession(options);assert.equal(result.status,'completed');assert.equal(result.cwd,primary);assert.equal(result.targetDirectory,primary);
});
test('broken Git metadata fails before launching or creating output',async t=>{
 const {root,options}=fixture(t,'codex');fs.writeFileSync(path.join(root,'.git'),'gitdir: /no-such-asc-root\n');
 await assert.rejects(runHostSession(options),/Cannot resolve session repository/);
 assert.equal(fs.existsSync(options.outputDir),false);assert.equal(fs.existsSync(path.join(root,'calls')),false);
});
test('bare repository has no primary listing directory and fails closed',async t=>{
 const {root,options}=fixture(t,'codex');const bare=path.join(root,'bare');fs.mkdirSync(bare);git(bare,'init','--bare');options.cwd=bare;
 await assert.rejects(runHostSession(options),/Bare Git repository/);assert.equal(fs.existsSync(options.outputDir),false);
});

for(const host of ['claude','codex'])test(`${host}: a changed target HEAD preserves the response but refuses completed naming`,async t=>{
 const {root,options}=fixture(t,host);const {primary,target}=linkedTarget(root);options.cwd=target;
 fs.writeFileSync(path.join(root,'mutate.json'),JSON.stringify({target,head:git(primary,'rev-parse','HEAD')}));
 const result=await runHostSession(options);assert.equal(result.status,'failed');assert.match(result.error,/Target HEAD changed/);
 assert(!fs.readFileSync(path.join(root,'calls'),'utf8').includes('済: '));
 assert(fs.readFileSync(path.join(options.outputDir,'result.txt'),'utf8').includes('ORIGINAL REVIEW'));
});
test('inherited Git directory cannot redirect target discovery',async t=>{
 const {root,options}=fixture(t,'codex');const {primary,target}=linkedTarget(root);options.cwd=target;
 const old=process.env.GIT_DIR;process.env.GIT_DIR='/no-such-git-dir';
 try{const result=await runHostSession(options);assert.equal(result.status,'completed');assert.equal(result.cwd,primary);assert.equal(result.targetDirectory,target);}
 finally{if(old===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=old;}
});

for(const host of ['claude','codex'])test(`${host}: HEAD changed during rename cannot be recorded as successful review`,async t=>{
 const {root,options}=fixture(t,host,'rename-mutate');const {primary,target}=linkedTarget(root);options.cwd=target;
 fs.writeFileSync(path.join(root,'mutate.json'),JSON.stringify({target,head:git(primary,'rev-parse','HEAD')}));
 const result=await runHostSession(options);
 assert.equal(result.status,'failed');assert.equal(result.naming,'completed','Actual rename succeeded and is not undone');
 assert.match(result.error,/final check after naming/);
 assert.match(fs.readFileSync(path.join(options.outputDir,'result.txt'),'utf8'),/ORIGINAL REVIEW/);
});
for(const host of ['claude','codex'])test(`${host}: Host and rename drop Git overrides but retain unrelated environment`,async t=>{
 const {root,options}=fixture(t,host);const {target}=linkedTarget(root);options.cwd=target;
 const values={GIT_DIR:'/no-such-git-dir',GIT_WORK_TREE:'/no-such-tree',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.bare',GIT_CONFIG_VALUE_0:'true',ASC_TEST_SENTINEL:'keep-me'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{
  const result=await runHostSession(options);assert.equal(result.status,'completed');
  const environments=fs.readFileSync(path.join(root,'env'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(environments.length,host==='claude'?2:1);
  for(const env of environments){assert.deepEqual(env.git,[]);assert.equal(env.sentinel,'keep-me');}
 }finally{for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

// #1793: read scope must come from launch settings. Live counterexamples are recorded in docs/evidence/1793-host-session-read-scope/.
test('claude review arguments confine reads by launch settings and never grant path-unrestricted reads',()=>{
 const common={model:'m',sessionId:'00000000-0000-4000-8000-000000000000',instruction:'i',cwd:'/r',name:'自動: n'};
 for(const [targetDirectory,ephemeral] of [['/r',false],['/r/.worktrees/t',false],['/r/.worktrees/t',true]]){
  const args=claudeReviewArguments({...common,targetDirectory,ephemeral});
  assert(args.includes('--restricted'),'Ignore user/project/local settings and confine file tools to working directories');
  assert.equal(args.indexOf('--restricted'),args.lastIndexOf('--restricted'));
  assert(!args.some(a=>/^--allowed-?tools$/i.test(a)),'A bare Read/Glob/Grep allow rule has no path limit');
  assert(!args.includes('--setting-sources')&&!args.includes('--dangerously-skip-permissions'));
  assert.equal(args[args.indexOf('--permission-mode')+1],'dontAsk');
  assert.equal(args[args.indexOf('--tools')+1],'Read,Glob,Grep');
  assert(args.includes('--strict-mcp-config'));
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings')+1]),{disableAllHooks:true},'No extra allow rules or additionalDirectories through flag settings');
  const dirs=args.flatMap((a,i)=>a==='--add-dir'?[args[i+1]]:[]);
  assert.deepEqual(dirs,targetDirectory===common.cwd?[]:[targetDirectory],'Only the reviewed worktree is added to the working directories');
  assert.equal(args.includes('--no-session-persistence'),ephemeral);assert.equal(args.includes('-n'),!ephemeral);
 }
});
test('claude rename arguments expose no tools',()=>{
 const args=claudeRenameArguments({sessionId:'s',name:'自動: n',model:'m'});
 assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(args[args.indexOf('--allowedTools')+1],'');
 assert.equal(args[args.indexOf('-n')+1],'済: 自動: n');assert.equal(args[args.indexOf('--max-turns')+1],'1');
});

// #1800: Codex read scope comes from a named permissions profile. Live counterexamples are in docs/evidence/1800-review-read-scope-rest/.
test('codex review profile reads only the platform minimum, the target and the named paths',()=>{
 const args=codexReviewProfileArguments('/r/.worktrees/t',['/opt/codex/bin/codex','/r/.git']);
 assert.deepEqual(args,['-c','project_doc_max_bytes=0','-c','default_permissions="asc_review"','-c','permissions.asc_review.filesystem={":minimal"="read","/tmp"="deny","/private/tmp"="deny","/private/var/tmp"="deny","/opt/codex/bin/codex"="read","/r/.git"="read","/r/.worktrees/t"="read"}']);
 assert(!args.join(' ').includes(':root')&&!args.join(' ').includes('"write"')&&!args.join(' ').includes(':workspace_roots'),'No full-disk read, no writes, and not the primary checkout as workspace root');
 assert.equal(codexReviewProfileArguments('/a "b"\\c',[]).at(-1).endsWith('"/a \\"b\\"\\\\c"="read"}'),true,'Paths are escaped as TOML basic strings');
 assert.throws(()=>codexReviewProfileArguments('relative',[]),/absolute/);
 assert.throws(()=>codexReviewProfileArguments('/r',['relative']),/absolute/);
 const paths=codexReviewReadablePaths({executable:'/x/codex',gitCommonDir:'/r/.git'});
 assert.deepEqual(paths.slice(0,2),['/x/codex','/r/.git']);assert(paths.length<=3&&paths.every(p=>path.isAbsolute(p)));
 if(process.platform!=='darwin')assert.equal(paths.length,2,'Developer tools are added only on macOS');
 assert.deepEqual(codexReviewReadablePaths({executable:'/x/codex',gitCommonDir:null}).slice(0,1),['/x/codex']);
});
test('Host executable resolves through PATH and symlinks to the real file',t=>{
 const root=tempDir('asc-exe-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const real=path.join(root,'real');fs.mkdirSync(real);fs.writeFileSync(path.join(real,'codex'),'#!/bin/sh\n',{mode:0o700});
 const bin=path.join(root,'bin');fs.mkdirSync(bin);fs.symlinkSync(path.join(real,'codex'),path.join(bin,'codex'));
 fs.writeFileSync(path.join(root,'codex-not-executable'),'',{mode:0o600});
 assert.equal(resolveExecutable('codex',[path.join(root,'missing'),bin].join(path.delimiter)),path.join(real,'codex'));
 assert.equal(resolveExecutable(path.join(bin,'codex'),''),path.join(real,'codex'));
 assert.throws(()=>resolveExecutable('codex',path.join(root,'missing')),/not found/);
 assert.throws(()=>resolveExecutable(path.join(root,'codex-not-executable'),''),/not found/);
});
