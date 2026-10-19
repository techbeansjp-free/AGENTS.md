/** Evaluation observation, not a cryptographic attestation of Host execution. */
export function claudeVerificationEvidence(events,expected){
 const calls=new Map();let observed;
 for(const event of events){
  if(event.parent_tool_use_id)continue;
  for(const item of event.message?.content??[]){
   if(item.type==='tool_use'&&item.name==='Bash'&&typeof item.input?.command==='string'&&/\bworktree-verify\b/.test(item.input.command))calls.set(item.id,item.input.command);
   if(item.type!=='tool_result'||!calls.has(item.tool_use_id))continue;
   // A later failure invalidates an earlier success; coordinator prose is never evidence.
   observed=undefined;
   if(item.is_error||typeof item.content!=='string')continue;
   let value;try{value=JSON.parse(item.content);}catch{continue;}
   if(value.schema!=='asc-worktree-verification/v1'||value.passed!==true||value.repo!==expected.repo||value.base!==expected.base||value.head!==expected.head||value.contractSha256!==expected.contractSha256||value.contextSha256!==expected.contextSha256)continue;
   if(!Array.isArray(value.results)||value.results.length!==expected.results.length||value.results.some((result,index)=>result.exit!==0||result.error||JSON.stringify(result.argv)!==JSON.stringify(expected.results[index].argv)))continue;
   observed={toolUseId:item.tool_use_id,head:value.head,contractSha256:value.contractSha256,checks:value.results.length,scope:'Observed coordinator Bash result; external oracle independently rechecked the same commit'};
  }
 }
 if(!observed)throw Error('Missing successful in-Host worktree verification for submitted HEAD and owner contract');
 return observed;
}
