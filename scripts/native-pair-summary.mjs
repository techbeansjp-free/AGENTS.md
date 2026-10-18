/** Evaluation only: paired observations do not imply performance outside this fixture. */
import assert from 'node:assert/strict';
const median=values=>{const a=[...values].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
export function summarizeNativePairs(pairs){
 assert(Array.isArray(pairs)&&pairs.length>0,'Explicit pairs required');
 const records=pairs.flatMap(p=>[p.baseline,p.candidate]);
 const conditions=records[0]?.conditions;
 assert(conditions?.intentSha256&&conditions?.commands?.length,'Measured conditions required');
 const heads=new Set();
 for(const r of records){
  assert.deepEqual(r.conditions,conditions,'Comparison conditions differ');
  assert.equal(r.model,records[0].model,'Models differ');assert.equal(r.effort,records[0].effort,'Efforts differ');assert.equal(r.base,records[0].base,'Fixture bases differ');
  assert(!heads.has(r.head),'Repeated observation');heads.add(r.head);
 }
 const quality=r=>r.verification?.passed===true&&r.verification.head===r.head&&r.verification.checks?.length===conditions.commands.length&&r.verification.checks.every(c=>c.exit===0)&&r.review?.verdict==='PASS'&&r.review.head===r.head&&r.ci?.head===r.head&&r.ci.draft===true&&r.ci.merged===false&&r.ci.boundToPr===true&&Object.keys(r.ci.checks??{}).length>0&&Object.values(r.ci.checks).every(c=>c==='success')&&r.manualHandoffs===0&&r.driverImplementationEdits===0&&!r.priorDriverFailure;
 const complete=r=>Number.isFinite(r.elapsedSeconds)&&r.elapsedSeconds>0&&Number.isSafeInteger(r.usage?.observedProcessedTokens)&&r.usage.observedProcessedTokens>0&&Array.isArray(r.usage.missingUsage)&&r.usage.missingUsage.length===0;
 const usable=records.every(complete),qualityPassed=records.every(quality);
 const result={pairs:pairs.length,qualityPassed,measurementComplete:usable,requiredPairs:5,accepted:false,scope:'This fixed synthetic fixture and model only; no general autonomous-development guarantee.'};
 if(usable){
  for(const side of ['baseline','candidate'])result[side]={medianSeconds:median(pairs.map(p=>p[side].elapsedSeconds)),medianProcessedTokens:median(pairs.map(p=>p[side].usage.observedProcessedTokens))};
  result.accepted=pairs.length>=5&&qualityPassed&&result.candidate.medianSeconds<result.baseline.medianSeconds&&result.candidate.medianProcessedTokens<result.baseline.medianProcessedTokens;
 }
 return result;
}
