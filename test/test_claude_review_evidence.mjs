import test from 'node:test';import assert from 'node:assert/strict';
import {claudeReviewEvidence} from '../scripts/claude-review-evidence.mjs';
const head='a'.repeat(40),start={type:'system',subtype:'task_started',task_id:'reviewer',description:'independent_review',spawn_depth:1},done={type:'system',subtype:'task_notification',task_id:'reviewer',status:'completed',summary:`PASS ${head}\nNo findings.`};
test('Claude review accepts direct completed exact-HEAD reviewer',()=>assert.equal(claudeReviewEvidence([start,done],head).taskId,'reviewer'));
test('Claude review rejects self-report, stale or conflicting verdict and uncompleted descendants',()=>{
 for(const events of [[done],[{...start,spawn_depth:2},done],[start,{...done,status:'failed'}],[start,{...done,summary:`PASS ${'b'.repeat(40)}`}],[start,done,{...done,summary:`FAIL ${head}`}],[start,{...done,summary:`quoted PASS ${head}`}],[start,done,done]])assert.throws(()=>claudeReviewEvidence(events,head),/unambiguous/);
});
