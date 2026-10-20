import test from 'node:test';import assert from 'node:assert/strict';import {claudeBrowserEvidence} from '../scripts/claude-browser-evidence.mjs';
const expected={head:'a'.repeat(40),oracleSha256:'b'.repeat(64),driverSha256:'c'.repeat(64)};
const pair=(value={},input={head:expected.head},id='browser')=>[
 {message:{content:[{type:'tool_use',name:'mcp__asc_browser__verify_browser',id,input}]}},
 {message:{content:[{type:'tool_result',tool_use_id:id,content:[{type:'text',text:JSON.stringify({schema:'asc-evaluation-browser/v1',passed:true,exit:0,error:null,signal:null,...expected,...value})}]}]}}
];
test('browser evidence binds actual tool call, final head and fixed assets',()=>{
 assert.equal(claudeBrowserEvidence(pair(),expected).toolUseId,'browser');
 for(const value of [{head:'d'.repeat(40)},{oracleSha256:'wrong'},{driverSha256:'wrong'},{passed:false},{exit:1},{error:'ETIMEDOUT'},{signal:'SIGKILL'}])assert.throws(()=>claudeBrowserEvidence(pair(value),expected),/Missing successful/);
 assert.throws(()=>claudeBrowserEvidence(pair({}, {head:'wrong'}),expected),/Missing successful/);
 assert.throws(()=>claudeBrowserEvidence(pair().map(e=>({...e,parent_tool_use_id:'child'})),expected),/Missing successful/);
 assert.throws(()=>claudeBrowserEvidence([pair()[1]],expected),/Missing successful/);
});
test('later failure invalidates earlier browser success, later valid success recovers',()=>{
 const success=pair(),failed=pair({passed:false,exit:1},{head:expected.head},'failed');
 assert.throws(()=>claudeBrowserEvidence([...success,...failed],expected),/Missing successful/);
 assert.equal(claudeBrowserEvidence([...success,...failed,...pair({},undefined,'fixed')],expected).toolUseId,'fixed');
});
