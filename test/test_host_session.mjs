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
 const body=host==='claude'?`
 const args=process.argv.slice(2);const value=k=>args[args.indexOf(k)+1];
 fs.appendFileSync(${JSON.stringify(path.join(root,'calls'))},JSON.stringify(args)+'\\n');
 process.stdin.resume();process.stdin.on('end',()=>{
 if(args.includes('--resume')){console.log('RENAME ONLY');process.exit(${mode==='rename-fail'?9:0});}
 console.log(JSON.stringify({type:'result',session_id:value('--session-id'),is_error:false,result:${JSON.stringify(mode==='empty'?'':'ORIGINAL REVIEW')}}));
 process.exit(${mode==='run-fail'?3:0});});
 `:`
 import {createInterface} from 'node:readline';
 process.on('SIGTERM',()=>{process.stderr.write('shutdown diagnostic\\n',()=>process.exit(0));});
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
 fs.writeFileSync(executable,`#!${process.execPath}\nimport fs from 'node:fs';\n${body}`,{mode:0o700});
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
