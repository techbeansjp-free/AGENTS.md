import {test} from 'node:test';import assert from 'node:assert/strict';import {summarize,summarizeGoal} from './report_workflow.mjs';
const usage={input_tokens:100,cached_input_tokens:60,cache_write_input_tokens:10,output_tokens:20,reasoning_output_tokens:5};
test('usage subsets are counted once and missing calls never become zero totals',()=>{
 const good={role:'implementation',status:'completed',usage:[usage]};
 const r=summarize({status:'blocked',calls:[good,{role:'review',status:'failed',usage:null}]});
 assert.equal(r.observed.processed,120);assert.equal(r.observed.fresh,60);assert.equal(r.usageCoverage.state,'partial');assert.equal(r.allDeclaredCallProcessedTokens,null);assert.equal(r.allAgentTotalTokens,null);
 const complete=summarize({calls:[good]});assert.equal(complete.allDeclaredCallProcessedTokens,120);assert.equal(complete.allAgentTotalTokens,null);
});
test('malformed or absent usage and unclosed intervals remain missing',()=>{
 const r=summarize({calls:[{role:'review',usage:[{...usage,cached_input_tokens:110}]}],events:[{type:'work-selected',work:'review',seconds:1}]});
 assert.equal(r.usageCoverage.state,'missing');assert.equal(r.allDeclaredCallProcessedTokens,null);assert.equal(r.stages[0].seconds,null);
 assert.equal(summarize({calls:[{usage:[]}]}).allDeclaredCallProcessedTokens,null);
 assert.equal(summarize({calls:[{status:'failed',usage:[usage]}]}).allDeclaredCallProcessedTokens,null);
});


test('Goal report includes failed-unit and final-workflow calls without adding parallel times',()=>{
 const call={role:'review',status:'completed',usage:[usage]};
 const r=summarizeGoal({status:'blocked',wallSeconds:5,units:[{id:'a',result:{calls:[call],wallSeconds:4}},{id:'b',diagnostic:{status:'blocked',calls:[call],wallSeconds:4}}],diagnostic:{status:'blocked',calls:[{role:'review',status:'failed',usage:null}]}});
 assert.equal(r.adapterAttempts,3);assert.equal(r.observed.processed,240);assert.equal(r.wallSeconds,5);assert.equal(r.groups.length,3);assert.equal(r.usageCoverage.state,'partial');assert.equal(r.allAgentTotalTokens,null);
});
test('old Goal result missing unit diagnostics cannot claim complete usage',()=>{
 const r=summarizeGoal({units:[{id:'a',result:{calls:[{status:'completed',usage:[usage]}]}},{id:'b',error:'failed'}]});
 assert.equal(r.observed.processed,120);assert.equal(r.usageCoverage.state,'partial');assert.deepEqual(r.missingUnitDiagnostics,['b']);assert.equal(r.allDeclaredCallProcessedTokens,null);
});

test('adaptive Goal proposal usage is included once',()=>{
 const call={role:'goal-proposal',status:'completed',usage:[usage]};const r=summarizeGoal({proposal:{calls:[call]},units:[],delivery:{calls:[]}});assert.equal(r.adapterAttempts,1);assert.equal(r.observed.processed,120);assert.equal(r.groups[0].id,'proposal');
});

test('combined single unit counts final calls once and requires the referenced diagnostic',()=>{
 const usage={input_tokens:100,output_tokens:20,cached_input_tokens:40,cache_write_input_tokens:0,reasoning_output_tokens:0};
 const result={units:[{id:'one',mode:'combined-goal-contract',workflowRoot:'/run/one'}],delivery:{root:'/run/one',calls:[{role:'implementation',status:'completed',usage:[usage]},{role:'review',status:'completed',usage:[usage]}]}};
 const report=summarizeGoal(result);assert.equal(report.adapterAttempts,2);assert.equal(report.observed.processed,240);assert.deepEqual(report.missingUnitDiagnostics,[]);
 result.delivery.root='/run/other';assert.deepEqual(summarizeGoal(result).missingUnitDiagnostics,['one']);
 delete result.delivery;assert.deepEqual(summarizeGoal(result).missingUnitDiagnostics,['one']);
});
