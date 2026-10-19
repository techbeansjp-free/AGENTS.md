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
