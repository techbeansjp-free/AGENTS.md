import test from 'node:test';import assert from 'node:assert/strict';
import {claudeVerificationEvidence} from '../scripts/claude-verification-evidence.mjs';
const expected={schema:'asc-worktree-verification/v1',passed:true,repo:'/synthetic/worktree',base:'a'.repeat(40),head:'b'.repeat(40),contractSha256:'c'.repeat(64),contextSha256:'d'.repeat(64),results:[{argv:['node','test.mjs'],exit:0}]};
const call={message:{content:[{type:'tool_use',name:'Bash',id:'verify',input:{command:'node /package/bin/asc-v05.mjs worktree-verify . base /owner.json'}}]}};
const result=(value=expected,extra={})=>({message:{content:[{type:'tool_result',tool_use_id:'verify',content:JSON.stringify(value),...extra}]}});
test('observes exact in-Host verification separately from external oracle',()=>assert.equal(claudeVerificationEvidence([call,result()],expected).checks,1));
test('rejects missing, failed, stale, mismatched and coordinator-only evidence',()=>{
 for(const events of [[],[result()],[call,result(expected,{is_error:true})],[call,result({...expected,head:'e'.repeat(40)})],[call,result({...expected,contractSha256:'f'.repeat(64)})],[call,result({...expected,contextSha256:'f'.repeat(64)})],[call,result({...expected,results:[{argv:['node','other.mjs'],exit:0}]})],[call,result({...expected,results:[]})],[call,result(expected,{content:'Exit code 1\nCommit intended changes before verification; preserve unrelated work separately',is_error:true})],[call,{message:{content:[{type:'text',text:JSON.stringify(expected)}]}}],[call,result(),result(expected,{is_error:true})],[{...call,parent_tool_use_id:'worker'},result()]])assert.throws(()=>claudeVerificationEvidence(events,expected),/Missing successful/);
});
test('accepts successful correction after failed in-Host verification',()=>assert.equal(claudeVerificationEvidence([call,result(expected,{is_error:true}),call,result()],expected).head,expected.head));

test('accepts exact Host cwd-reset suffix without accepting arbitrary trailing output',()=>{
 const body=JSON.stringify(expected),suffix='\nShell cwd was reset to '+expected.repo;
 assert.equal(claudeVerificationEvidence([call,result(expected,{content:body+suffix})],expected).head,expected.head);
 for(const content of [body+'\nother output',body+'\nShell cwd was reset to /other',body+suffix+'\nExit code 1',body+suffix+'\n'+body])assert.throws(()=>claudeVerificationEvidence([call,result(expected,{content})],expected),/Missing successful/);
 assert.throws(()=>claudeVerificationEvidence([call,result(expected,{content:body+suffix,is_error:true})],expected),/Missing successful/);
});

test('accepts exact target HEAD line from batched Git observation only',()=>{
 const body=JSON.stringify(expected),prefix=expected.head+'\n';
 for(const content of [prefix+body,prefix+body+'\nShell cwd was reset to '+expected.repo])assert.equal(claudeVerificationEvidence([call,result(expected,{content})],expected).head,expected.head);
 for(const content of ['e'.repeat(40)+'\n'+body,'prefix\n'+body,prefix+prefix+body,prefix+JSON.stringify({...expected,head:'e'.repeat(40)})])assert.throws(()=>claudeVerificationEvidence([call,result(expected,{content})],expected),/Missing successful/);
 assert.throws(()=>claudeVerificationEvidence([call,result(expected,{content:prefix+body,is_error:true})],expected),/Missing successful/);
});


test('accepts immediate shell status suffix only with its matching command',()=>{
 const statusCall=structuredClone(call);statusCall.message.content[0].input.command+=' 2>&1\necho "EXIT: $?"';
 const body=JSON.stringify(expected),content=body+'\nEXIT: 0';
 assert.equal(claudeVerificationEvidence([statusCall,result(expected,{content})],expected).head,expected.head);
 assert.equal(claudeVerificationEvidence([statusCall,result(expected,{content:content+'\nShell cwd was reset to '+expected.repo})],expected).head,expected.head);
 for(const events of [[call,result(expected,{content})],[statusCall,result(expected,{content:body+'\nEXIT: 1'})],[statusCall,result(expected,{content:content+'\nextra'})],[statusCall,result(expected,{content,is_error:true})],[statusCall,result({...expected,passed:false},{content:JSON.stringify({...expected,passed:false})+'\nEXIT: 0'})]])assert.throws(()=>claudeVerificationEvidence(events,expected),/Missing successful/);
});


test('accepts same-line immediate exit status but rejects mismatches and literal status',()=>{
 const body=JSON.stringify(expected),statusCall=structuredClone(call);
 statusCall.message.content[0].input.command+='; echo "exit=$?"';
 assert.equal(claudeVerificationEvidence([statusCall,result(expected,{content:body+'\nexit=0'})],expected).head,expected.head);
 for(const suffix of ['\nexit=1','\nEXIT: 0','\nexit=0\nextra'])assert.throws(()=>claudeVerificationEvidence([statusCall,result(expected,{content:body+suffix})],expected),/Missing successful/);
 for(const ending of ['; echo "exit=0"',"; echo 'exit=$?'",'; echo "exit=$?"; echo extra']){
  const other=structuredClone(call);other.message.content[0].input.command+=ending;
  assert.throws(()=>claudeVerificationEvidence([other,result(expected,{content:body+'\nexit=0'})],expected),/Missing successful/);
 }
 assert.throws(()=>claudeVerificationEvidence([statusCall,result(expected,{content:body+'\nexit=0',is_error:true})],expected),/Missing successful/);
});

test('accepts space-separated immediate status with exact matching zero only',()=>{
 const body=JSON.stringify(expected),statusCall=structuredClone(call);
 statusCall.message.content[0].input.command+='; echo "exit $?"';
 assert.equal(claudeVerificationEvidence([statusCall,result(expected,{content:body+'\nexit 0'})],expected).head,expected.head);
 for(const suffix of ['\nexit 1','\nexit=0','\nexit 0\nextra'])assert.throws(()=>claudeVerificationEvidence([statusCall,result(expected,{content:body+suffix})],expected),/Missing successful/);
 const literal=structuredClone(call);literal.message.content[0].input.command+='; echo "exit 0"';
 assert.throws(()=>claudeVerificationEvidence([literal,result(expected,{content:body+'\nexit 0'})],expected),/Missing successful/);
});

test('framed verification ignores shell chatter but not failed, duplicate or stale results',()=>{
 const capture={command:'node /synthetic/capture-verification.mjs',marker:'1'.repeat(32)};
 const frame=(value,status=0)=>`\nASC_VERIFY_${capture.marker}_BEGIN\n${JSON.stringify({status,error:null,stdout:JSON.stringify(value),stderr:''})}\nASC_VERIFY_${capture.marker}_END\n`;
 const framedCall=structuredClone(call);framedCall.message.content[0].input.command='git status --short; '+capture.command+'; echo "exit $?"';
 const content='?? .claude/\n'+expected.head+frame(expected)+'exit 0';
 assert.equal(claudeVerificationEvidence([framedCall,result(expected,{content})],expected,capture).head,expected.head);
 for(const bad of [frame(expected,1),frame({...expected,head:'e'.repeat(40)}),frame(expected)+frame(expected),content.replace(capture.marker,'2'.repeat(32))])assert.throws(()=>claudeVerificationEvidence([framedCall,result(expected,{content:bad})],expected,capture),/Missing successful/);
 assert.throws(()=>claudeVerificationEvidence([framedCall,result(expected,{content,is_error:true})],expected,capture),/Missing successful/);
 assert.throws(()=>claudeVerificationEvidence([call,result(expected,{content})],expected,capture),/Missing successful/);
 assert.throws(()=>claudeVerificationEvidence([framedCall,result(expected,{content}),result(expected,{content:frame(expected,1)})],expected,capture),/Missing successful/);
});

test('capture executes fixed verifier and preserves its failure instead of shell status',async t=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {spawnSync}=await import('node:child_process');
 const {verificationCaptureSource,capturedVerification}=await import('../scripts/claude-verification-capture.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-capture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const cli=path.join(root,'cli.mjs'),wrapper=path.join(root,'capture.mjs'),marker='3'.repeat(32);
 fs.writeFileSync(wrapper,verificationCaptureSource({cli,repo:'/synthetic/repo',base:expected.base,owner:'/synthetic/owner',marker}));
 fs.writeFileSync(cli,`import assert from 'node:assert/strict';assert.deepEqual(process.argv.slice(2),${JSON.stringify(['worktree-verify','/synthetic/repo',expected.base,'/synthetic/owner'])});console.log(${JSON.stringify(JSON.stringify(expected))});`);
 const good=spawnSync(process.execPath,[wrapper],{encoding:'utf8'});assert.equal(good.status,0);assert.deepEqual(JSON.parse(capturedVerification(good.stdout,marker)),expected);
 fs.appendFileSync(cli,'process.exitCode=7;');
 const bad=spawnSync(process.execPath,[wrapper],{encoding:'utf8'});assert.equal(bad.status,1);assert.equal(capturedVerification(bad.stdout,marker),null);
});
