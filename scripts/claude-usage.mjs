/** Evaluation only. Explicit per-session transcripts, not filesystem-wide discovery. */
export function claudeUsage(transcripts,expectedIds,modelUsage){
 const fields={input_tokens:'inputTokens',output_tokens:'outputTokens',cache_read_input_tokens:'cacheReadInputTokens',cache_creation_input_tokens:'cacheCreationInputTokens'};
 if(!Array.isArray(transcripts)||!Array.isArray(expectedIds)||!expectedIds.length||new Set(expectedIds).size!==expectedIds.length)throw Error('Explicit unique expected session IDs required');
 const seen=new Set(),missingUsage=[],threads=[];
 for(const {id,records} of transcripts){
  if(seen.has(id)||!expectedIds.includes(id)||!Array.isArray(records))throw Error('Unexpected or duplicate Claude transcript');seen.add(id);
  const messages=new Map(),finished=new Set();
  for(const record of records){
   if(record.type!=='assistant')continue;
   const message=record.message;
   if(!message?.id){missingUsage.push({id,reason:'assistant message identity missing'});continue;}
   if(typeof message.stop_reason==='string'&&message.stop_reason)finished.add(message.id);
   const usage=message.usage;
   if(!usage||Object.keys(fields).some(k=>!Number.isSafeInteger(usage[k])||usage[k]<0)){
    missingUsage.push({id,message:message.id,reason:'usage fields missing or invalid'});continue;
   }
   const prior=messages.get(message.id)??{};
   // Streaming snapshots can repeat the same message. Count cumulative values once.
   messages.set(message.id,Object.fromEntries(Object.keys(fields).map(k=>[k,Math.max(prior[k]??0,usage[k])])));
  }
  for(const idMessage of messages.keys())if(!finished.has(idMessage))missingUsage.push({id,message:idMessage,reason:'terminal usage snapshot missing'});
  if(!messages.size)missingUsage.push({id,reason:'no measured assistant messages'});
  threads.push({id,messageCount:messages.size,usage:Object.fromEntries(Object.keys(fields).map(k=>[k,[...messages.values()].reduce((sum,u)=>sum+u[k],0)]))});
 }
 for(const id of expectedIds)if(!seen.has(id))missingUsage.push({id,reason:'transcript missing'});
 const totals=Object.fromEntries(Object.keys(fields).map(k=>[k,threads.reduce((sum,t)=>sum+t.usage[k],0)]));
 const models=Object.values(modelUsage??{});
 const reconciledWithHostModelUsage=models.length>0&&Object.entries(fields).every(([key,field])=>models.every(m=>Number.isSafeInteger(m[field])&&m[field]>=0)&&models.reduce((sum,m)=>sum+m[field],0)===totals[key]);
 if(!reconciledWithHostModelUsage)missingUsage.push({reason:'Host modelUsage absent or does not reconcile'});
 const observedProcessedTokens=Object.values(totals).reduce((a,b)=>a+b,0);
 return {totals,threads,observedProcessedTokens,missingUsage,reconciledWithHostModelUsage,complete:missingUsage.length===0};
}
