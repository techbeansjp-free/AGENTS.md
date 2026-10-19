import test from 'node:test';import assert from 'node:assert/strict';
import {nativeReviewEvidence} from '../scripts/native-review-evidence.mjs';
const head='a'.repeat(40);
const record=(id,parent,text)=>[
 {type:'session_meta',payload:{id,source:parent?{subagent:{thread_spawn:{parent_thread_id:parent,agent_path:'/root/independent_review'}}}:'exec'}},
 {type:'event_msg',payload:{type:'task_started',turn_id:'turn'}},
 {type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:10,cached_input_tokens:2,output_tokens:1}}}},
 {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text}]}},
 {type:'event_msg',payload:{type:'task_complete',turn_id:'turn'}},
];
const fixture=()=>{const p=record('p',null,'ready');p.splice(2,0,{type:'response_item',payload:{type:'function_call',name:'spawn_agent'}});return [p,record('r','p',`PASS ${head}\nNo findings.`)];};
test('binds completed separate reviewer to exact candidate and accounts both contexts',()=>{const r=nativeReviewEvidence('p',head,fixture());assert.equal(r.review.id,'r');assert.equal(r.usage.observedProcessedTokens,22);});
test('parent self-approval, stale, quoted, or rejected review cannot authorize delivery',()=>{
 assert.throws(()=>nativeReviewEvidence('p',head,[record('p',null,`PASS ${head}`)]),/reviewer/);
 for(const text of [`PASS ${'b'.repeat(40)}`,`Earlier review: PASS ${head}`,`FAIL ${head}`]){const f=fixture();f[1][3].payload.content[0].text=text;assert.throws(()=>nativeReviewEvidence('p',head,f),/did not approve/);}
});
test('unfinished, resumed, wrong-turn and forked review fail closed',()=>{
 for(const change of [r=>r.pop(),r=>r.push({type:'event_msg',payload:{type:'task_started',turn_id:'next'}}),r=>r.at(-1).payload.turn_id='wrong',r=>r[0].payload.forked_from_id='p']){
  const f=fixture();change(f[1]);assert.throws(()=>nativeReviewEvidence('p',head,f));
 }
});

test('unobserved child cannot disappear from delivery accounting',()=>{const f=fixture();f[0].splice(2,0,{type:'response_item',payload:{type:'function_call',name:'spawn_agent'}});assert.throws(()=>nativeReviewEvidence('p',head,f),/inventory/);});

test('rollout discovery covers local and UTC dates around midnight',async()=>{const {sessionDates}=await import('../scripts/native-delivery.mjs');const old=process.env.TZ;try{process.env.TZ='Asia/Tokyo';assert.deepEqual(new Set(sessionDates('2026-10-18T22:33:12Z','2026-10-18T22:35:00Z')),new Set(['2026/10/18','2026/10/19']));assert.throws(()=>sessionDates('invalid'),/Invalid/);}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}});

test('a repaired commit can supersede old findings, but a current conflicting verdict cannot',()=>{
 const f=fixture(),old=record('r-old','p',`FAIL ${'b'.repeat(40)}`);f.push(old);f[0].splice(2,0,{type:'response_item',payload:{type:'function_call',name:'spawn_agent'}});
 assert.equal(nativeReviewEvidence('p',head,f).review.head,head);
 old[3].payload.content[0].text=`FAIL ${head}`;assert.throws(()=>nativeReviewEvidence('p',head,f),/did not approve/);
});

test('counts a paginated helper once but never accepts its inherited-context review',()=>{
 const f=fixture();f[0].splice(2,0,{type:'response_item',payload:{type:'function_call',name:'spawn_agent'}});
 const helper=record('h','p',`PASS ${head}`),meta={...helper[0].payload,forked_from_id:'p',history_mode:'paginated',subagent_history_start_ordinal:1+f[0].length};
 const fork=[{type:'session_meta',payload:meta},...structuredClone(f[0]),{type:'event_msg',payload:{type:'thread_settings_applied',thread_id:'h'}},...helper.slice(1),{type:'token_usage_record',payload:{thread_id:'h',thread_token_usage:helper[2].payload.info.total_token_usage}}];
 f.push(fork);const result=nativeReviewEvidence('p',head,f);assert.equal(result.usage.observedProcessedTokens,33);assert.equal(result.review.id,'r');
 f.splice(1,1);f[0].splice(2,1);assert.throws(()=>nativeReviewEvidence('p',head,f),/did not approve/);
});


test('known duplicate-name refusal is not a new descendant, unknown or unbound refusal is not ignored',()=>{
 const f=fixture();
 f[0].splice(2,0,{type:'response_item',payload:{type:'function_call',name:'spawn_agent',call_id:'duplicate',arguments:JSON.stringify({task_name:'independent_review'})}},{type:'response_item',payload:{type:'function_call_output',call_id:'duplicate',output:'agent path `/root/independent_review` already exists'}});
 assert.equal(nativeReviewEvidence('p',head,f).review.id,'r');
 f[0][3].payload.output='agent path `/root/unknown` already exists';
 assert.throws(()=>nativeReviewEvidence('p',head,f),/inventory/);
 f[0][3].payload.output='agent path `/root/independent_review` already exists';f[0][3].payload.call_id='other';
 assert.throws(()=>nativeReviewEvidence('p',head,f),/inventory/);
});


test('fresh numbered re-review retains identity, exact HEAD and conflict checks',()=>{
 const f=fixture();f[1][0].payload.source.subagent.thread_spawn.agent_path='/root/independent_review_2';
 assert.equal(nativeReviewEvidence('p',head,f).review.id,'r');
 for(const name of ['/root/worker_independent_review','/root/worker/independent_review_2','/root/independent_review_2_other']){
  f[1][0].payload.source.subagent.thread_spawn.agent_path=name;assert.throws(()=>nativeReviewEvidence('p',head,f),/did not approve/);
 }
 f[1][0].payload.source.subagent.thread_spawn.agent_path='/root/independent_review_2';
 const rejected=record('old','p',`FAIL ${head}`);f.push(rejected);f[0].splice(2,0,{type:'response_item',payload:{type:'function_call',name:'spawn_agent'}});
 assert.throws(()=>nativeReviewEvidence('p',head,f),/did not approve/);
});

test('a completed re-review needs its own verdict, not a previous turn PASS',()=>{
 const f=fixture();
 f[1].push({type:'event_msg',payload:{type:'task_started',turn_id:'next'}},
  {type:'event_msg',payload:{type:'task_complete',turn_id:'next'}});
 assert.throws(()=>nativeReviewEvidence('p',head,f),/did not approve/);
});

test('re-review accepts a verdict inside the new turn but not after completion',()=>{
 const f=fixture(),message={type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:`PASS ${head}`}]}};
 f[1].push({type:'event_msg',payload:{type:'task_started',turn_id:'next'}},
  {type:'event_msg',payload:{type:'task_complete',turn_id:'next'}},structuredClone(message));
 assert.throws(()=>nativeReviewEvidence('p',head,f),/did not approve/);
 f[1].pop();f[1].splice(-1,0,message);
 assert.equal(nativeReviewEvidence('p',head,f).review.id,'r');
});
