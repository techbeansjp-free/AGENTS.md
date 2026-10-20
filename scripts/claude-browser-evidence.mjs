/** Observation of the fixed evaluation tool, independently rechecked by the Host. */
export function claudeBrowserEvidence(events,expected){
 const calls=new Map();let observed;
 for(const event of events){
  if(event.parent_tool_use_id)continue;
  for(const item of event.message?.content??[]){
   if(item.type==='tool_use'&&item.name==='mcp__asc_browser__verify_browser')calls.set(item.id,item.input);
   if(item.type!=='tool_result'||!calls.has(item.tool_use_id))continue;
   observed=undefined;
   if(item.is_error||calls.get(item.tool_use_id)?.head!==expected.head||!Array.isArray(item.content)||item.content.length!==1||item.content[0].type!=='text')continue;
   let value;try{value=JSON.parse(item.content[0].text);}catch{continue;}
   if(value.schema!=='asc-evaluation-browser/v1'||value.passed!==true||value.exit!==0||value.error!==null||value.signal!==null)continue;
   if(['head','oracleSha256','driverSha256'].some(key=>value[key]!==expected[key]))continue;
   observed={toolUseId:item.tool_use_id,head:value.head,oracleSha256:value.oracleSha256,driverSha256:value.driverSha256};
  }
 }
 if(!observed)throw Error('Missing successful fixed browser tool result for submitted HEAD');
 return observed;
}
