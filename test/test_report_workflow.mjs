import {test} from 'node:test';import assert from 'node:assert/strict';import {summarize,summarizeGoal,summarizeIssues} from '../v05/report_workflow.mjs';
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


test('missing invocation records are not proof of zero model usage',()=>{
 for(const calls of [undefined,null,{}]){
  const report=summarize({status:'blocked',calls});
  assert.equal(report.usageCoverage.state,'missing');
  assert.equal(report.usageCoverage.declaredCalls,null);
  assert.equal(report.allDeclaredCallProcessedTokens,null);
 }
 const empty=summarize({status:'blocked',calls:[]});
 assert.equal(empty.usageCoverage.state,'complete');
 assert.equal(empty.usageCoverage.declaredCalls,0);
 assert.equal(empty.allDeclaredCallProcessedTokens,0);
});

test('missing final Goal diagnostics cannot disappear from usage coverage',()=>{
 const call={role:'implementation',status:'completed',usage:[usage]};
 for(const finalKey of ['delivery','diagnostic']){
  const report=summarizeGoal({units:[{id:'a',result:{calls:[call]}}],[finalKey]:{status:'blocked'}});
  assert.equal(report.observed.processed,120);
  assert.equal(report.usageCoverage.state,'partial');
  assert.deepEqual(report.missingUnitDiagnostics,['whole-goal']);
  assert.equal(report.allDeclaredCallProcessedTokens,null);
 }
 const missing=summarizeGoal({status:'blocked'});
 assert.equal(missing.usageCoverage.state,'missing');
 assert.equal(missing.allDeclaredCallProcessedTokens,null);
});


test('completed Goal requires final usage while an interrupted Goal may not reach it',()=>{
 const units=[{id:'a',result:{calls:[]}}];
 const completed=summarizeGoal({status:'draft-ci-passed',units});
 assert.equal(completed.usageCoverage.state,'missing');
 assert.deepEqual(completed.missingUnitDiagnostics,['whole-goal']);
 assert.equal(completed.allDeclaredCallProcessedTokens,null);
 const interrupted=summarizeGoal({status:'blocked',units});
 assert.equal(interrupted.usageCoverage.state,'complete');
 assert.equal(interrupted.allDeclaredCallProcessedTokens,0);
});


test('Issue usage includes failed work and nested combined Goals exactly once',()=>{
 const call={role:'review',status:'completed',usage:[usage]};
 const report=summarizeIssues({wallSeconds:5,issues:[
  {id:'plain',result:{calls:[call],wallSeconds:4}},
  {id:'goal',result:{status:'draft-ci-passed',proposal:{calls:[call]},units:[{id:'one',mode:'combined-goal-contract',workflowRoot:'/run/one'}],delivery:{root:'/run/one',calls:[call]}}},
  {id:'failed',diagnostic:{status:'blocked',calls:[{...call,status:'failed'}]}}
 ]});
 assert.equal(report.adapterAttempts,4);
 assert.equal(report.observed.processed,480);
 assert.equal(report.wallSeconds,5);
 assert.equal(report.usageCoverage.state,'partial');
 assert.equal(report.allDeclaredCallProcessedTokens,null);
 assert.equal(report.allAgentTotalTokens,null);
 assert.deepEqual(report.groups.map(g=>g.id),['plain','goal/proposal','goal/whole-goal','failed']);
});

test('Issue summary retains missing nested and absent diagnostics',()=>{
 const report=summarizeIssues({issues:[{id:'goal',result:{status:'draft-ci-passed',units:[]}},{id:'missing',status:'blocked'},{id:'waiting',status:'dependency-blocked'}]});
 assert.deepEqual(report.missingIssueDiagnostics,['goal/whole-goal','missing','waiting']);
 assert.equal(report.usageCoverage.state,'missing');
 assert.equal(report.allDeclaredCallProcessedTokens,null);
 assert.equal(summarizeIssues({issues:[]}).allDeclaredCallProcessedTokens,0);
 assert.equal(summarizeIssues({}).allDeclaredCallProcessedTokens,null);
});
