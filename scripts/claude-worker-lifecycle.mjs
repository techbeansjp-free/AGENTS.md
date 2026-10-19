/** Synthetic fault-injection observation only; never execution authority. */
export function activeClaudeWorkers(events,workspaces){
 if(!Array.isArray(workspaces)||new Set(workspaces).size!==workspaces.length||workspaces.some(w=>typeof w!=='string'||!w))throw Error('Expected distinct worker workspaces');
 const requests=new Map(),tasks=new Map(),invalid=new Set(),finished=new Set();
 for(const event of events){
  if(event.type==='assistant'&&!event.parent_tool_use_id){
   for(const item of Array.isArray(event.message?.content)?event.message.content:[]){
    if(item.type!=='tool_use'||!['Agent','Task'].includes(item.name)||typeof item.id!=='string')continue;
    const input=item.input;
    if(typeof input?.prompt!=='string'||input.description==='independent_review')continue;
    const markers=input.prompt.split('\n').filter(line=>line.startsWith('ASC_WORKER_WORKSPACE='));
    const matches=markers.length===1?workspaces.filter(workspace=>markers[0]==='ASC_WORKER_WORKSPACE='+workspace):[];
    const workspace=matches.length===1?matches[0]:null;
    if(requests.has(item.id)&&requests.get(item.id)!==workspace)invalid.add(item.id);
    requests.set(item.id,workspace);
   }
  }
  if(event.type!=='system'||typeof event.task_id!=='string'||!event.task_id)continue;
  if(event.subtype==='task_started'){
   const prior=tasks.get(event.task_id);
   if(prior&&prior.tool!==event.tool_use_id)invalid.add(event.task_id);
   tasks.set(event.task_id,{taskId:event.task_id,tool:event.tool_use_id,active:!finished.has(event.task_id)&&event.spawn_depth===1&&event.description!=='independent_review'});
  }else if(event.subtype==='task_notification'||(event.subtype==='task_updated'&&event.patch?.status!==undefined&&event.patch.status!=='running')){
   finished.add(event.task_id);const prior=tasks.get(event.task_id);if(prior)prior.active=false;
  }
 }
 const workers=[...tasks.values()].filter(task=>task.active&&!invalid.has(task.taskId)&&!invalid.has(task.tool)&&requests.get(task.tool)).map(task=>({taskId:task.taskId,workspace:requests.get(task.tool)}));
 // Ambiguous ownership must not select a worker to interrupt.
 return workers.filter(worker=>workers.filter(other=>other.workspace===worker.workspace).length===1);
}
