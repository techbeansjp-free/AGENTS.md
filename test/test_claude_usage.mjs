import test from 'node:test';import assert from 'node:assert/strict';
import {claudeUsage} from '../scripts/claude-usage.mjs';
const entry=(id,n)=>({type:'assistant',message:{id,usage:{input_tokens:n,output_tokens:n,cache_read_input_tokens:n,cache_creation_input_tokens:n}}});
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
