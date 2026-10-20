/** Evaluation only. Tool bytes are observations, not token counts or proof of waste. */
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>typeof value==='string'?value:JSON.stringify(value??null);
export function claudeToolObservations(transcripts){
 const ids=new Set(),threads=[];
 for(const {id,records} of transcripts){
  if(typeof id!=='string'||!id||ids.has(id)||!Array.isArray(records))throw Error('Explicit unique transcripts required');
  ids.add(id);const calls=new Map(),results=new Map();
  for(const record of records)for(const item of record.message?.content??[]){
   if(item.type==='tool_use'){
    if(typeof item.id!=='string'||typeof item.name!=='string')throw Error('Missing tool identity');
    const call={name:item.name,input:encode(item.input)};
    if(calls.has(item.id)&&JSON.stringify(calls.get(item.id))!==JSON.stringify(call))throw Error('Conflicting tool identity');
    calls.set(item.id,call);
   }
   if(item.type==='tool_result'){
    if(typeof item.tool_use_id!=='string')throw Error('Missing result identity');
    const result={bytes:Buffer.byteLength(encode(item.content)),sha256:hash(encode(item.content)),failed:item.is_error===true};
    if(results.has(item.tool_use_id)&&JSON.stringify(results.get(item.tool_use_id))!==JSON.stringify(result))throw Error('Conflicting tool result');
    results.set(item.tool_use_id,result);
   }
  }
  const tools={},signatures=new Map();
  for(const [toolId,call] of calls){
   const result=results.get(toolId),entry=tools[call.name]??={calls:0,inputBytes:0,resultBytes:0,failedResults:0,missingResults:0};
   entry.calls++;entry.inputBytes+=Buffer.byteLength(call.input);entry.resultBytes+=result?.bytes??0;entry.failedResults+=Number(result?.failed??false);entry.missingResults+=Number(!result);
   const signature=hash(call.name+'\0'+call.input);signatures.set(signature,(signatures.get(signature)??0)+1);
  }
  threads.push({id,tools,unmatchedResultIds:[...results.keys()].filter(k=>!calls.has(k)),repeatedExactCalls:[...signatures].filter(([,count])=>count>1).map(([sha256,count])=>({sha256,count})),largestResults:[...results].sort((a,b)=>b[1].bytes-a[1].bytes).slice(0,5).map(([toolId,result])=>({toolId,name:calls.get(toolId)?.name??null,...result}))});
 }
 return {scope:'Serialized tool input/result UTF-8 bytes by explicit transcript. Not tokens, billing, semantic duplication or causal performance evidence. Repeated observations of one tool ID count once; repeated executions retain distinct IDs.',threads};
}
