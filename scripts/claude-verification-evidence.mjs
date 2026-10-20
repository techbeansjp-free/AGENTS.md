/** Evaluation observation, not a cryptographic attestation of Host execution. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {capturedVerification} from './claude-verification-capture.mjs';
export function claudeVerificationEvidence(events,expected,capture){
 const calls=new Map();let observed;
 for(const event of events){
  if(event.parent_tool_use_id)continue;
  for(const item of event.message?.content??[]){
   if(item.type==='tool_use'&&item.name==='Bash'&&typeof item.input?.command==='string'&&(capture?item.input.command.includes(capture.command):/\bworktree-verify\b/.test(item.input.command)))calls.set(item.id,item.input.command);
   if(item.type!=='tool_result'||!calls.has(item.tool_use_id))continue;
   // A later failure invalidates an earlier success; coordinator prose is never evidence.
   observed=undefined;
   if(item.is_error||typeof item.content!=='string')continue;
   // Claude may append its own cwd-reset notification after a successful command.
   // Only the exact expected worktree suffix is accepted; arbitrary trailing output is not JSON.
   const suffix='\nShell cwd was reset to '+expected.repo;
   let content=capture?capturedVerification(item.content,capture.marker):(item.content.endsWith(suffix)?item.content.slice(0,-suffix.length):item.content);
   if(content===null)continue;
   // A caller may print the immediately preceding command's shell status.
   // Require both the exact shell idiom and zero status; do not strip arbitrary output.
   const status=calls.get(item.tool_use_id).match(/(?:\n|;)[ \t]*echo "(EXIT: |exit[= ])\$\?"[ \t]*$/);
   if(status&&content.endsWith(`\n${status[1]}0`))content=content.slice(0,-(status[1].length+2));
   // A batched Git identity observation may precede the JSON; accept only this target.
   if(content.startsWith(expected.head+'\n'))content=content.slice(expected.head.length+1);
   let value;try{
    value=JSON.parse(content);
    if(capture?.output){
     if(value.schema!=='asc-worktree-verification-summary/v1'||typeof value.output!=='string'||!value.output.startsWith(capture.output+'-')||! /^[a-f0-9-]{36}\.json$/.test(value.output.slice(capture.output.length+1))||value.passed!==true)continue;
     const bytes=fs.readFileSync(value.output);
     if(createHash('sha256').update(bytes).digest('hex')!==value.sha256)continue;
     value=JSON.parse(bytes);
    }
   }catch{continue;}
   if(value.schema!==(capture?.projectCommands?'asc-evaluation-project-tests/v1':'asc-worktree-verification/v1')||value.passed!==true||value.repo!==expected.repo||value.base!==expected.base||value.head!==expected.head||value.contractSha256!==expected.contractSha256||(!capture?.projectCommands&&value.contextSha256!==expected.contextSha256))continue;
   if(!Array.isArray(value.results)||value.results.length!==expected.results.length||value.results.some((result,index)=>result.exit!==0||result.error||result.signal||JSON.stringify(result.argv)!==JSON.stringify(expected.results[index].argv)))continue;
   observed={toolUseId:item.tool_use_id,head:value.head,contractSha256:value.contractSha256,checks:value.results.length,scope:'Observed coordinator Bash result; external oracle independently rechecked the same commit'};
  }
 }
 if(!observed)throw Error('Missing successful in-Host worktree verification for submitted HEAD and owner contract');
 return observed;
}
