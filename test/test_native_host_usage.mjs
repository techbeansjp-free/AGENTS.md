import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeNativeUsage,ownNativeEvents} from '../scripts/native-host-usage.mjs';
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

const withWrites=(writes)=>{const e=count(30,10,3);e.payload.info.total_token_usage.cache_write_input_tokens=writes;return e;};
test('cache writes retain observed zero, missing fields and final cumulative values without inflating processed tokens',()=>{
 const complete=summarizeNativeUsage('p',[record('p',null,withWrites(2),withWrites(7)),record('c','p',withWrites(0))]);
 assert.equal(complete.cacheWriteInput.totalTokens,7);assert.deepEqual(complete.cacheWriteInput.missingThreads,[]);assert.equal(complete.observedProcessedTokens,66);
 for(const counts of [[count(30,10,3)],[withWrites(-1)],[withWrites(1.5)],[]]){
  const partial=summarizeNativeUsage('p',[record('p',null,withWrites(7)),record('c','p',...counts)]);
  assert.equal(partial.cacheWriteInput.totalTokens,null);assert.equal(partial.cacheWriteInput.observedTokens,7);assert.deepEqual(partial.cacheWriteInput.missingThreads,['c']);
 }
 assert.throws(()=>summarizeNativeUsage('p',[record('p',null,withWrites(Number.MAX_SAFE_INTEGER)),record('c','p',withWrites(1))]),/safe integer/);
});

function forked(){
 const own=count(20,10,2),usage=own.payload.info.total_token_usage;
 return [
  {type:'session_meta',payload:{id:'c',forked_from_id:'p',history_mode:'paginated',subagent_history_start_ordinal:3,source:{subagent:{thread_spawn:{parent_thread_id:'p'}}}}},
  ...record('p',null,count(1000,500,50)),
  {type:'event_msg',payload:{type:'thread_settings_applied',thread_id:'c'}},
  {type:'token_usage_record',payload:{thread_id:'c',thread_token_usage:usage}},own
 ];
}
test('paginated inherited history does not duplicate ancestor usage',()=>{
 const r=summarizeNativeUsage('p',[record('p',null,count(30,10,3)),forked()]);
 assert.equal(r.observedProcessedTokens,55);assert.equal(ownNativeEvents(forked())[0].payload.forked_from_id,'p');
});
test('ambiguous fork boundaries and foreign or mismatched usage remain rejected',()=>{
 for(const mutate of [r=>r[0].payload.source.subagent.thread_spawn.parent_thread_id='other',r=>r.splice(1,1),r=>r[0].payload.subagent_history_start_ordinal=2,r=>r[1].payload.id='other',r=>r[3].payload.thread_id='p',r=>r[4].payload.thread_id='p',r=>r[4].payload.thread_token_usage={input_tokens:999},r=>r.splice(4,1),r=>r.push({type:'session_meta',payload:{id:'x'}})]){
  const r=structuredClone(forked());mutate(r);assert.throws(()=>ownNativeEvents(r));
 }
});

test('paginated storage mode alone does not imply inherited context',()=>{
 const r=record('p',null,count(30,10,3));r[0].payload.history_mode='paginated';
 assert.equal(summarizeNativeUsage('p',[r]).observedProcessedTokens,33);
});
