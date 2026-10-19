import test from 'node:test';import assert from 'node:assert/strict';
import {activeClaudeWorkers} from '../scripts/claude-worker-lifecycle.mjs';
const roots=['/synthetic/worktrees/one','/synthetic/worktrees/two'];
const request=(id,workspace)=>({type:'assistant',message:{content:[{type:'tool_use',id,name:'Agent',input:{description:'implement',prompt:`ASC_WORKER_WORKSPACE=${workspace}`}}]}});
const start=(id,tool)=>({type:'system',subtype:'task_started',task_id:id,tool_use_id:tool,spawn_depth:1,description:'implement'});
const initial=()=>[request('a',roots[0]),request('b',roots[1]),start('first','a'),start('second','b')];
test('two direct workers are observed only while neither has reported completion',()=>{
 const events=initial();assert.equal(activeClaudeWorkers(events,roots).length,2);
 events.push({type:'system',subtype:'task_updated',task_id:'first',patch:{status:'completed'}});
 assert.deepEqual(activeClaudeWorkers(events,roots),[{taskId:'second',workspace:roots[1]}]);
 events.push({type:'system',subtype:'task_notification',task_id:'second',status:'failed'});assert.deepEqual(activeClaudeWorkers(events,roots),[]);
});
test('missing, nested, reviewer and ambiguous task ownership cannot establish a checkpoint',()=>{
 for(const extra of [{spawn_depth:2},{description:'independent_review'}])assert.deepEqual(activeClaudeWorkers([request('a',roots[0]),{...start('first','a'),...extra}],roots),[]);
 assert.deepEqual(activeClaudeWorkers([start('first','missing')],roots),[]);
 const mention=request('a',roots[0]);mention.message.content[0].input.prompt='Do not work in '+roots[0];assert.deepEqual(activeClaudeWorkers([mention,start('first','a')],roots),[]);
 assert.deepEqual(activeClaudeWorkers([request('a',roots.join(' and ')),start('first','a')],roots),[]);
 assert.deepEqual(activeClaudeWorkers([request('a',roots[0]),request('b',roots[0]),start('first','a'),start('second','b')],roots),[]);
 assert.deepEqual(activeClaudeWorkers([{...request('a',roots[0]),parent_tool_use_id:'parent'},start('first','a')],roots),[]);
});
test('duplicate stream entries are stable but changed identity is rejected',()=>{
 const events=initial();assert.deepEqual(activeClaudeWorkers([...events,...events],roots),activeClaudeWorkers(events,roots));
 assert.deepEqual(activeClaudeWorkers([request('a',roots[0]),request('a',roots[1]),start('first','a')],roots),[]);
 assert.deepEqual(activeClaudeWorkers([request('a',roots[0]),request('b',roots[1]),start('first','a'),start('first','b')],roots),[]);
});

test('terminal task identities cannot be revived by duplicated starts',()=>{
 for(const terminal of [{type:'system',subtype:'task_notification',task_id:'first',status:'completed'},{type:'system',subtype:'task_updated',task_id:'first',patch:{status:'failed'}}]){
  assert.deepEqual(activeClaudeWorkers([request('a',roots[0]),start('first','a'),terminal,start('first','a')],roots),[]);
  assert.deepEqual(activeClaudeWorkers([request('a',roots[0]),terminal,start('first','a')],roots),[]);
 }
});
