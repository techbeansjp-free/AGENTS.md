/** Evaluation-only acceptance of Host-owned synthetic rollouts, never model-supplied files. */
import {summarizeNativeUsage,ownNativeEvents} from './native-host-usage.mjs';
export function nativeReviewEvidence(rootId, head, rollouts) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(head)) throw Error('Invalid candidate HEAD');
  const usage=summarizeNativeUsage(rootId,rollouts);
  rollouts=rollouts.map(ownNativeEvents);
  if(usage.missingUsage.length)throw Error('Incomplete usage');
  const identities=rollouts.map(es=>es[0].payload);
  let successfulOrUnresolvedSpawns=0;
  for(const events of rollouts){
    const own=events[0].payload,ownPath=own.id===rootId?'/root':own.source?.subagent?.thread_spawn?.agent_path;
    for(const e of events.filter(e=>e.type==='response_item'&&['function_call','custom_tool_call'].includes(e.payload?.type)&&/(?:^|__)spawn_agent$/.test(e.payload.name??''))){
      const call=e.payload;let args;try{args=JSON.parse(call.arguments);}catch{args=null;}
      const requested=ownPath&&/^[a-z0-9_]+$/.test(args?.task_name??'')?ownPath+'/'+args.task_name:null;
      const outputs=events.filter(e=>e.type==='response_item'&&e.payload?.type==='function_call_output'&&e.payload.call_id===call.call_id);
      const duplicate=requested&&outputs.length===1&&outputs[0].payload.output===`agent path \`${requested}\` already exists`
        &&identities.some(m=>m.source?.subagent?.thread_spawn?.agent_path===requested&&m.source.subagent.thread_spawn.parent_thread_id===own.id);
      if(!duplicate)successfulOrUnresolvedSpawns++;
    }
  }
  if(successfulOrUnresolvedSpawns!==rollouts.length-1)throw Error('Descendant inventory does not match spawn calls');
  const reviewers=[];let rejectedCurrent=false;
  for(const events of rollouts){
    const meta=events.find(e=>e.type==='session_meta').payload;
    const lifecycle=events.filter(e=>e.type==='event_msg'&&['task_started','task_complete','turn_aborted'].includes(e.payload?.type));
    const last=lifecycle.at(-1)?.payload;
    if(last?.type!=='task_complete')throw Error('Agent has not completed');
    const started=lifecycle.findLast(e=>e.payload.type==='task_started')?.payload;
    if(!started?.turn_id||last.turn_id!==started.turn_id)throw Error('Completion does not match current turn');
    if(meta.id===rootId)continue;
    const parent=meta.source?.subagent?.thread_spawn;
    if(parent?.parent_thread_id!==rootId||!/^\/root\/independent_review(?:_[1-9][0-9]*)?$/.test(parent.agent_path??'')||meta.forked_from_id)continue;
    const currentTurn=events.slice(events.findLastIndex(e=>e.type==='event_msg'&&e.payload?.type==='task_started')+1,events.findLastIndex(e=>e.type==='event_msg'&&e.payload?.type==='task_complete'));
    const final=currentTurn.filter(e=>e.type==='response_item'&&e.payload?.type==='message'&&e.payload.role==='assistant').at(-1)?.payload;
    const text=final?.content?.filter(c=>c.type==='output_text').map(c=>c.text).join('\n')??'';
    // Exact first line is deliberately required; quoted PASS or earlier approval does not count.
    const first=text.split('\n')[0].trim();
    if(first===`FAIL ${head}`)rejectedCurrent=true;
    if(first===`PASS ${head}`)reviewers.push({id:meta.id,head,verdict:'PASS'});
  }
  if(rejectedCurrent||reviewers.length===0)throw Error('Independent reviewer did not approve current candidate');
  return {review:reviewers[0],usage};
}
