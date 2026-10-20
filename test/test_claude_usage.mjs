import test from 'node:test';import assert from 'node:assert/strict';
import {claudeUsage,claudeSessionIds} from '../scripts/claude-usage.mjs';
const entry=(id,n)=>({type:'assistant',message:{id,stop_reason:'end_turn',usage:{input_tokens:n,output_tokens:n,cache_read_input_tokens:n,cache_creation_input_tokens:n}}});
const models=n=>({synthetic:{inputTokens:n,outputTokens:n,cacheReadInputTokens:n,cacheCreationInputTokens:n}});
test('Claude parent and reviewer streaming messages reconcile without double counting',()=>{
 const result=claudeUsage([{id:'parent',records:[entry('m1',1),entry('m1',2)]},{id:'reviewer',records:[entry('m2',3)]}],['parent','reviewer'],models(5));
 assert.equal(result.complete,true);assert.equal(result.observedProcessedTokens,20);assert.equal(result.threads[0].messageCount,1);
});
test('missing descendants, missing cache fields and mismatched totals remain missing',()=>{
 const invalid=entry('m1',1);delete invalid.message.usage.cache_read_input_tokens;
 const result=claudeUsage([{id:'parent',records:[invalid]}],['parent','reviewer'],models(5));
 assert.equal(result.complete,false);assert.ok(result.missingUsage.some(x=>x.id==='reviewer'));assert.ok(result.missingUsage.some(x=>x.message==='m1'));
 assert.throws(()=>claudeUsage([{id:'wrong',records:[]}],['parent'],models(0)),/Unexpected/);
 assert.throws(()=>claudeUsage([{id:'parent',records:[]},{id:'parent',records:[]}],['parent'],models(0)),/duplicate/);
});

test('partial streamed usage cannot establish complete cost even if totals happen to match',()=>{
 const partial=entry('m1',3);partial.message.stop_reason=null;
 const result=claudeUsage([{id:'reviewer',records:[partial]}],['reviewer'],models(3));
 assert.equal(result.reconciledWithHostModelUsage,true);assert.equal(result.complete,false);
 assert.ok(result.missingUsage.some(x=>x.message==='m1'&&x.reason==='terminal usage snapshot missing'));
 const final=entry('m1',5);
 assert.equal(claudeUsage([{id:'reviewer',records:[partial,final]}],['reviewer'],models(5)).complete,true);
});


test('usage identities deduplicate resumed agents but retain unknown tasks for missing-evidence detection',()=>{
 const start={type:'system',subtype:'task_started',task_type:'local_agent',task_id:'reviewer'};
 assert.deepEqual(claudeSessionIds([start,start,{...start,task_type:'local_bash',task_id:'shell'}],'parent'),['parent','reviewer']);
 assert.deepEqual(claudeSessionIds([{...start,task_type:'unknown',task_id:'new-kind'}],'parent'),['parent','new-kind']);
 assert.throws(()=>claudeSessionIds([{...start,task_id:null}],'parent'),/identity/);
 assert.throws(()=>claudeSessionIds([],null),/identity/);
});
