/** Read-only metrics. Reports never become verification or approval authority. */
import fs from 'node:fs';import {pathToFileURL} from 'node:url';
export function summarize(result){
 const callsDeclared=Array.isArray(result.calls),calls=callsDeclared?result.calls:[],events=result.events??[],roles={};let validCalls=0,turns=0;
 const total={input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0};
 const names={input:'input_tokens',output:'output_tokens',cacheRead:'cached_input_tokens',cacheWrite:'cache_write_input_tokens',reasoning:'reasoning_output_tokens'};
 for(const call of calls){
  const observed={...Object.fromEntries(Object.keys(total).map(k=>[k,0]))};let complete=call.status==='completed'&&Array.isArray(call.usage)&&call.usage.length>0;
  for(const usage of call.usage??[]){
   if(!usage||!Object.values(names).every(k=>Number.isSafeInteger(usage[k])&&usage[k]>=0)||usage.cached_input_tokens+usage.cache_write_input_tokens>usage.input_tokens||usage.reasoning_output_tokens>usage.output_tokens){complete=false;continue;}
   for(const [k,v] of Object.entries(names)){total[k]+=usage[v];observed[k]+=usage[v];}turns++;
  }
  if(complete)validCalls++;
  const role=roles[call.role]??={attempts:0,completeUsageCalls:0,observedProcessedTokens:0};role.attempts++;if(complete)role.completeUsageCalls++;role.observedProcessedTokens+=observed.input+observed.output;
 }
 const stages=[];
 for(let i=0;i<events.length;i++){
  const event=events[i];if(event.type!=='work-selected')continue;
  const next=events.slice(i+1).find(e=>['work-selected','delivery-complete','blocked'].includes(e.type));
  const elapsed=next?next.seconds-event.seconds:null;
  stages.push({work:event.work,seconds:Number.isFinite(elapsed)&&elapsed>=0?elapsed:null});
 }
 const complete=callsDeclared&&validCalls===calls.length;
 return {status:result.status,wallSeconds:result.wallSeconds??null,adapterAttempts:calls.length,completedAdapterCalls:calls.filter(c=>c.status==='completed').length,
  usageCoverage:{declaredCalls:callsDeclared?calls.length:null,completeCalls:validCalls,observedTurns:turns,state:complete?'complete':validCalls?'partial':'missing',enumeration:'controller-dispatched calls only'},
  observed:{...total,processed:total.input+total.output,fresh:total.input-total.cacheRead+total.output},
  allDeclaredCallProcessedTokens:complete?total.input+total.output:null,allAgentTotalTokens:null,roles,stages,
  contextHighWaterMark:null,limitations:['Input includes cache read/write; output includes reasoning; subsets are not added twice','Declared-call coverage does not certify provider-internal or external Agent enumeration','Stage intervals include observation and waiting; they are not pure model computation','No pricing or causal performance claim']};
}
/** Aggregate invocation records, never infer unrecorded unit work as zero. */
function goalRecords(result){
 const groups=[],missing=[];
 if(result.proposal){if(Array.isArray(result.proposal.calls))groups.push({id:'proposal',record:result.proposal});else missing.push('proposal');}
 for(const unit of result.units??[]){
  const final=result.delivery??result.diagnostic;
  if(unit.mode==='combined-goal-contract'&&typeof unit.workflowRoot==='string'&&unit.workflowRoot===final?.root&&Array.isArray(final.calls))continue;
  const record=unit.result??unit.diagnostic;
  if(record&&Array.isArray(record.calls))groups.push({id:unit.id,record});else missing.push(unit.id);
 }
 const final=result.delivery??result.diagnostic;
 if(final){if(Array.isArray(final.calls))groups.push({id:'whole-goal',record:final});else missing.push('whole-goal');}
 else if(result.status==='draft-ci-passed')missing.push('whole-goal');
 if(!Array.isArray(result.units))missing.push('units');
 return {groups,missing};
}
export function summarizeGoal(result){
 const {groups,missing}=goalRecords(result);
 const report=summarize({status:result.status,wallSeconds:result.wallSeconds,calls:groups.flatMap(g=>g.record.calls)});
 report.groups=groups.map(g=>({id:g.id,...summarize(g.record)}));report.missingUnitDiagnostics=missing;
 if(missing.length){report.usageCoverage.state=report.usageCoverage.completeCalls?'partial':'missing';report.allDeclaredCallProcessedTokens=null;}
 report.limitations.push('Aggregate unit and whole-Goal calls once; parallel unit wall times are not added to Goal wall time','Missing diagnostics are not zero-call proof; older result files may require their separate diagnostic artifacts');
 return report;
}
/** Issue results contain either a workflow or a nested Goal, including failed work. */
export function summarizeIssues(result){
 const groups=[],missing=[];
 for(const issue of result.issues??[]){
  const record=issue.result??issue.diagnostic;
  if(!record){missing.push(issue.id);continue;}
  if(Array.isArray(record.units)){
   const nested=goalRecords(record);
   groups.push(...nested.groups.map(g=>({id:issue.id+'/'+g.id,record:g.record})));
   missing.push(...nested.missing.map(id=>issue.id+'/'+id));
  }else if(Array.isArray(record.calls))groups.push({id:issue.id,record});
  else missing.push(issue.id);
 }
 if(!Array.isArray(result.issues))missing.push('issues');
 const report=summarize({status:result.status,wallSeconds:result.wallSeconds,calls:groups.flatMap(g=>g.record.calls)});
 report.groups=groups.map(g=>({id:g.id,...summarize(g.record)}));report.missingIssueDiagnostics=missing;
 if(missing.length){report.usageCoverage.state=report.usageCoverage.completeCalls?'partial':'missing';report.allDeclaredCallProcessedTokens=null;}
 report.limitations.push('Issue and nested Goal calls are aggregated once; parallel elapsed times are not summed','Issues without diagnostics remain missing, including pre-dispatch stops; this report does not infer zero usage from status');
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==3)throw Error('Usage: node report_workflow.mjs result.json');const result=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(Array.isArray(result.issues)?summarizeIssues(result):Array.isArray(result.units)?summarizeGoal(result):summarize(result),null,2));}
