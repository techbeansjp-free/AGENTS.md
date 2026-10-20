import test from 'node:test';import assert from 'node:assert/strict';
import {claudeToolObservations} from '../scripts/claude-tool-observations.mjs';
const record=(...content)=>({message:{content}});
const call=id=>({type:'tool_use',id,name:'Bash',input:{command:'synthetic'}});
const result=id=>({type:'tool_result',tool_use_id:id,content:'日本語'});
test('tool analysis deduplicates observations, not repeated executions; counts bytes not tokens',()=>{
 const a=record(call('a'),result('a')),b=record(call('b'),{...result('b'),is_error:true});
 const {threads:[t]}=claudeToolObservations([{id:'root',records:[a,a,b,record(call('c'))]}]);
 assert.equal(t.tools.Bash.calls,3);assert.equal(t.tools.Bash.resultBytes,18);assert.equal(t.tools.Bash.failedResults,1);assert.equal(t.tools.Bash.missingResults,1);assert.equal(t.repeatedExactCalls[0].count,3);
 assert.ok(!JSON.stringify(t).includes('synthetic'));assert.ok(!JSON.stringify(t).includes('日本語'));
});
test('unknown results are explicit and conflicting identities are rejected',()=>{
 assert.deepEqual(claudeToolObservations([{id:'root',records:[record(result('unknown'))]}]).threads[0].unmatchedResultIds,['unknown']);
 assert.throws(()=>claudeToolObservations([{id:'root',records:[record(call('a'),{...call('a'),name:'Read'})]}]),/Conflicting/);
 assert.throws(()=>claudeToolObservations([{id:'root',records:[record(result('a'),{...result('a'),content:'different'})]}]),/Conflicting/);
 assert.throws(()=>claudeToolObservations([{id:'x',records:[]},{id:'x',records:[]}]),/unique/);
});
