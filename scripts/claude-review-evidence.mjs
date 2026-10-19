/** Evaluation evidence only: direct independent reviewer, never coordinator self-report. */
export function claudeReviewEvidence(events,head,resolveCommit){
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))throw Error('Invalid reviewed commit');
 const started=events.filter(e=>e.type==='system'&&e.subtype==='task_started'&&e.description==='independent_review'&&e.spawn_depth===1);
 const verdicts=started.flatMap(start=>events.filter(e=>e.type==='system'&&e.subtype==='task_notification'&&e.task_id===start.task_id).map(e=>({start,event:e})));
 const refersToHead=(text,verdict)=>typeof text==='string'&&text.split('\n').some(line=>{
  const match=/^(PASS|FAIL) ([a-f0-9]{7,64})$/.exec(line.trim());if(!match||match[1]!==verdict)return false;
  if(match[2]===head)return true;
  // Never infer identity from a shared prefix: Git must resolve it uniquely.
  return typeof resolveCommit==='function'&&resolveCommit(match[2])===head;
 });
 const matching=verdicts.filter(({event})=>refersToHead(event.summary,'PASS'));
 if(matching.length!==1||matching[0].event.status!=='completed'||verdicts.some(({event})=>refersToHead(event.summary,'FAIL')))throw Error('No unambiguous completed independent review of submitted HEAD');
 return {taskId:matching[0].start.task_id,head,verdict:'PASS'};
}
