import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sessionOptions,runHostSession} from '../src/host-session.mjs';

function fixture(t,host,mode='success'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-session-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const executable=path.join(root,'host');
 const mutation=`if(fs.existsSync(${JSON.stringify(path.join(root,'mutate.json'))})){const change=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'mutate.json'))}));const {spawnSync}=await import('node:child_process');spawnSync('git',['-C',change.target,'update-ref','HEAD',change.head],{encoding:'utf8'});}`;
 const body=host==='claude'?`
 const args=process.argv.slice(2);const value=k=>args[args.indexOf(k)+1];
 fs.appendFileSync(${JSON.stringify(path.join(root,'calls'))},JSON.stringify(args)+'\\n');
 fs.appendFileSync(${JSON.stringify(path.join(root,'cwd'))},process.cwd()+'\\n');
 process.stdin.resume();process.stdin.on('end',()=>{
 if(args.includes('--resume')){console.log('RENAME ONLY');process.exit(${mode==='rename-fail'?9:0});}
 console.log(JSON.stringify({type:'result',session_id:value('--session-id'),is_error:false,result:${JSON.stringify(mode==='empty'?'':'ORIGINAL REVIEW')}}));
 process.exit(${mode==='run-fail'?3:0});});
 `:`
 import {createInterface} from 'node:readline';
 process.on('SIGTERM',()=>{process.stderr.write('shutdown diagnostic\\n',()=>process.exit(0));});
 fs.appendFileSync(${JSON.stringify(path.join(root,'cwd'))},process.cwd()+'\\n');
 let names=0;
 const send=m=>console.log(JSON.stringify(m));
 createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(path.join(root,'calls'))},line+'\\n');
 if(m.method==='initialized')return;
 if(m.method==='initialize')return send({id:m.id,result:{}});
 if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'thread-owned'}}});
 if(m.method==='thread/name/set'){
 names++;if(${JSON.stringify(mode)}==='start-name-fail'||(${JSON.stringify(mode)}==='rename-fail'&&names===2))return send({id:m.id,error:{message:'name unavailable'}});
 return send({id:m.id,result:{}});}
 if(m.method==='turn/start'){
 send({id:m.id,result:{turn:{id:'turn-owned'}}});
 send({method:'item/completed',params:{threadId:'thread-owned',item:{type:'agentMessage',text:${JSON.stringify(mode==='empty'?'':'ORIGINAL REVIEW')}}}});
 if(${JSON.stringify(mode)}==='timeout')return;
 send({method:'turn/completed',params:{threadId:'unrelated',turn:{id:'turn-other',status:'completed'}}});
 return send({method:'turn/completed',params:{threadId:'thread-owned',turn:{id:'turn-owned',status:${JSON.stringify(mode==='run-fail'?'failed':'completed')}}}});}
 });`;
 fs.writeFileSync(executable,`#!${process.execPath}\nimport fs from 'node:fs';\n${mutation}\n${body}`,{mode:0o700});
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
   assert.equal(calls[0][calls[0].indexOf('--allowedTools')+1],'Read,Glob,Grep');
   assert.equal(calls[1][calls[1].indexOf('--tools')+1],'');
   assert.equal(calls[1][calls[1].indexOf('--model')+1],options.model);
  }else{
   assert.deepEqual(calls.filter(c=>c.method==='thread/name/set').map(c=>c.params),[{threadId:'thread-owned',name:'自動: '+options.name},{threadId:'thread-owned',name:'済: 自動: '+options.name}]);
   const start=calls.find(c=>c.method==='thread/start');assert.equal(start.params.sandbox,'read-only');assert.equal(start.params.approvalPolicy,'never');
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
test('Codex unavailable naming stops before model turn',async t=>{
 const {root,options}=fixture(t,'codex','start-name-fail');const result=await runHostSession(options);
 assert.equal(result.status,'failed');assert(!fs.readFileSync(path.join(root,'calls'),'utf8').includes('turn/start'));
});
test('Codex timeout preserves partial response and fails',async t=>{
 const {options}=fixture(t,'codex','timeout');options.timeout=150;const result=await runHostSession(options);
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
