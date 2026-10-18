import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeNativeUsage} from '../scripts/native-host-usage.mjs';
const count = (input, cached, output) => ({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,cached_input_tokens:cached,output_tokens:output}}}});
const record = (id, parent, ...counts) => [{type:'session_meta',payload:{id,source:parent?{subagent:{thread_spawn:{parent_thread_id:parent}}}:'exec'}},...counts];
test('sums final cumulative usage once across parent and descendants, without counting cache twice', () => {
 const r=summarizeNativeUsage('p',[record('g','c',count(10,5,2)),record('p',null,count(10,0,1),count(30,10,3)),record('c','p',count(20,15,4))]);
 assert.equal(r.observedProcessedTokens,69);assert.equal(r.measured.cachedInputTokens,30);assert.equal(r.observedThreads,3);
});
test('missing or malformed usage is not silently zero-filled', () => {
 for(const counts of [[],[count(1,2,0)],[count(-1,0,0)]]) {
  const r=summarizeNativeUsage('p',[record('p',null,count(30,10,3)),record('c','p',...counts)]);
  assert.equal(r.observedProcessedTokens,null);assert.deepEqual(r.missingUsage,['c']);
 }
});
test('rejects duplicate, unrelated and missing root identities', () => {
 assert.throws(()=>summarizeNativeUsage('p',[record('p'),record('p')]),/Duplicate/);
 assert.throws(()=>summarizeNativeUsage('p',[record('p'),record('other')]),/Unrelated/);
 assert.throws(()=>summarizeNativeUsage('p',[record('other')]),/Root/);
});

test('rejects unsafe totals even when each thread value is valid', () => {
 assert.throws(()=>summarizeNativeUsage('p',[record('p',null,count(Number.MAX_SAFE_INTEGER,0,0)),record('c','p',count(2,0,0))]),/safe integer/);
 assert.throws(()=>summarizeNativeUsage('p',[record('p',null,count(Number.MAX_SAFE_INTEGER,0,1))]),/safe integer/);
});
