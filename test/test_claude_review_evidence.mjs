import test from 'node:test';import assert from 'node:assert/strict';
import {claudeReviewEvidence} from '../scripts/claude-review-evidence.mjs';
const head='a'.repeat(40),start={type:'system',subtype:'task_started',task_id:'reviewer',description:'independent_review',spawn_depth:1},done={type:'system',subtype:'task_notification',task_id:'reviewer',status:'completed',summary:`PASS ${head}\nNo findings.`};
test('Claude review accepts direct completed exact-HEAD reviewer',()=>assert.equal(claudeReviewEvidence([start,done],head).taskId,'reviewer'));
test('Claude review rejects self-report, stale or conflicting verdict and uncompleted descendants',()=>{
 for(const events of [[done],[{...start,spawn_depth:2},done],[start,{...done,status:'failed'}],[start,{...done,summary:`PASS ${'b'.repeat(40)}`}],[start,done,{...done,summary:`FAIL ${head}`}],[start,{...done,summary:`quoted PASS ${head}`}],[start,done,done]])assert.throws(()=>claudeReviewEvidence(events,head),/unambiguous/);
});

test('abbreviated verdict requires unique Git resolution, not prefix matching',()=>{
 const short={...done,summary:'PASS '+head.slice(0,7)};
 assert.throws(()=>claudeReviewEvidence([start,short],head),/unambiguous/);
 assert.equal(claudeReviewEvidence([start,short],head,ref=>{assert.equal(ref,head.slice(0,7));return head;}).head,head);
 assert.throws(()=>claudeReviewEvidence([start,short],head,()=>{throw Error('ambiguous object');}),/ambiguous/);
 assert.throws(()=>claudeReviewEvidence([start,short],head,()=> 'b'.repeat(40)),/unambiguous/);
 assert.throws(()=>claudeReviewEvidence([start,done,{...done,summary:'FAIL '+head.slice(0,7)}],head,()=>head),/unambiguous/);
});

test('inline-code verdict preserves exact identity and contradictory FAIL rejection',()=>{
 const wrapped={...done,summary:'`PASS '+head+'`'};
 assert.equal(claudeReviewEvidence([start,wrapped],head).head,head);
 for(const summary of ['`PASS '+head,'PASS '+head+'`','prefix `PASS '+head+'`','`PASS '+head+'` suffix','`PASS '+ 'b'.repeat(40)+'`'])assert.throws(()=>claudeReviewEvidence([start,{...done,summary}],head),/unambiguous/);
 assert.throws(()=>claudeReviewEvidence([start,wrapped,{...done,summary:'`FAIL '+head+'`'}],head),/unambiguous/);
});
