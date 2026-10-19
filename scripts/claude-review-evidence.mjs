/** Evaluation evidence only: direct independent reviewer, never coordinator self-report. */
export function claudeReviewEvidence(events,head){
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))throw Error('Invalid reviewed commit');
 const started=events.filter(e=>e.type==='system'&&e.subtype==='task_started'&&e.description==='independent_review'&&e.spawn_depth===1);
 const verdicts=started.flatMap(start=>events.filter(e=>e.type==='system'&&e.subtype==='task_notification'&&e.task_id===start.task_id).map(e=>({start,event:e})));
 const matching=verdicts.filter(({event})=>typeof event.summary==='string'&&event.summary.split('\n').some(line=>line.trim()===`PASS ${head}`));
 if(matching.length!==1||matching[0].event.status!=='completed'||verdicts.some(({event})=>event.summary?.split('\n').some(line=>line.trim()===`FAIL ${head}`)))throw Error('No unambiguous completed independent review of submitted HEAD');
 return {taskId:matching[0].start.task_id,head,verdict:'PASS'};
}
