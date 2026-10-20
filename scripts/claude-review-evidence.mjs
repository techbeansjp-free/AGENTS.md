/** Evaluation evidence only: direct independent reviewer, never coordinator self-report. */
export function claudeReviewEvidence(events,head,resolveCommit){
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))throw Error('Invalid reviewed commit');
 const started=events.filter(e=>e.type==='system'&&e.subtype==='task_started'&&e.description==='independent_review'&&e.spawn_depth===1);
 // Claude can resume the same reviewer task and repeat its start/notification events.
 // Identity is the task, not the number of notifications; reject role changes for that identity.
 const reviewers=new Map();
 for(const start of started){
  if(typeof start.task_id!=='string'||!start.task_id)throw Error('No unambiguous reviewer identity');
  const same=events.filter(e=>e.type==='system'&&e.subtype==='task_started'&&e.task_id===start.task_id);
  if(same.some(e=>e.description!==start.description||e.spawn_depth!==start.spawn_depth||e.subagent_type!==start.subagent_type))throw Error('No unambiguous reviewer identity');
  reviewers.set(start.task_id,start);
 }
 const verdicts=[...reviewers.values()].flatMap(start=>events.filter(e=>e.type==='system'&&e.subtype==='task_notification'&&e.task_id===start.task_id).map(e=>({start,event:e})));
 const refersToHead=(text,verdict)=>typeof text==='string'&&text.split('\n').some(line=>{
  const trimmed=line.trim(),plain=trimmed.startsWith('`')&&trimmed.endsWith('`')?trimmed.slice(1,-1):trimmed;
  const match=/^(PASS|FAIL) ([a-f0-9]{7,64})$/.exec(plain);if(!match||match[1]!==verdict)return false;
  if(match[2]===head)return true;
  // Never infer identity from a shared prefix: Git must resolve it uniquely.
  return typeof resolveCommit==='function'&&resolveCommit(match[2])===head;
 });
 const matching=verdicts.filter(({event})=>refersToHead(event.summary,'PASS'));
 const tasks=new Set(matching.map(({start})=>start.task_id));
 const last=tasks.size===1?verdicts.filter(({start})=>start.task_id===matching[0].start.task_id).at(-1):undefined;
 const finishedAfterLatestStart=last&&events.lastIndexOf(last.event)>events.lastIndexOf(reviewers.get(last.start.task_id));
 if(tasks.size!==1||!finishedAfterLatestStart||last?.event.status!=='completed'||!refersToHead(last.event.summary,'PASS')||verdicts.some(({event})=>refersToHead(event.summary,'FAIL')))throw Error('No unambiguous completed independent review of submitted HEAD');
 return {taskId:matching[0].start.task_id,agentType:matching[0].start.subagent_type??null,head,verdict:'PASS'};
}
