/** Evaluation-only acceptance of Host-owned synthetic rollouts, never model-supplied files. */
import {summarizeNativeUsage} from './native-host-usage.mjs';
export function nativeReviewEvidence(rootId, head, rollouts) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(head)) throw Error('Invalid candidate HEAD');
  const usage=summarizeNativeUsage(rootId,rollouts);
  if(usage.missingUsage.length)throw Error('Incomplete usage');
  const spawnCalls=rollouts.flat().filter(e=>e.type==='response_item'&&['function_call','custom_tool_call'].includes(e.payload?.type)&&/(?:^|__)spawn_agent$/.test(e.payload.name??''));
  if(spawnCalls.length!==rollouts.length-1)throw Error('Descendant inventory does not match spawn calls');
  const reviewers=[];
  for(const events of rollouts){
    const meta=events.find(e=>e.type==='session_meta').payload;
    const lifecycle=events.filter(e=>e.type==='event_msg'&&['task_started','task_complete','turn_aborted'].includes(e.payload?.type));
    const last=lifecycle.at(-1)?.payload;
    if(last?.type!=='task_complete')throw Error('Agent has not completed');
    const started=lifecycle.findLast(e=>e.payload.type==='task_started')?.payload;
    if(!started?.turn_id||last.turn_id!==started.turn_id)throw Error('Completion does not match current turn');
    if(meta.id===rootId)continue;
    const parent=meta.source?.subagent?.thread_spawn;
    if(parent?.parent_thread_id!==rootId||!parent.agent_path?.endsWith('/independent_review')||meta.forked_from_id)continue;
    const final=events.filter(e=>e.type==='response_item'&&e.payload?.type==='message'&&e.payload.role==='assistant').at(-1)?.payload;
    const text=final?.content?.filter(c=>c.type==='output_text').map(c=>c.text).join('\n')??'';
    // Exact first line is deliberately required; quoted PASS or earlier approval does not count.
    if(text.split('\n')[0].trim()!==`PASS ${head}`)throw Error('Independent review did not approve candidate');
    reviewers.push({id:meta.id,head,verdict:'PASS'});
  }
  if(reviewers.length!==1)throw Error('Expected one completed independent reviewer');
  return {review:reviewers[0],usage};
}
