/** Evaluation only: paired observations do not imply performance outside this fixture. */
import assert from 'node:assert/strict';
const median=values=>{const a=[...values].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
export function summarizeNativePairs(pairs){
 assert(Array.isArray(pairs)&&pairs.length>0,'Explicit pairs required');
 const records=pairs.flatMap(p=>[p.baseline,p.candidate]);
 const conditions=records[0]?.conditions;
 assert(typeof conditions?.cliVersion==='string'&&conditions.cliVersion.trim(),'Recorded CLI version required');
 assert((conditions?.comparisonScope==='distribution'||conditions?.runtimeSha256)&&conditions?.intentSha256&&conditions?.commands?.length,'Measured conditions required');
 for(const side of ['baseline','candidate']){
  const skill=pairs[0][side]?.distribution?.skillBundleSha256;
  assert(skill,'Distribution Skill identity required');
  for(const pair of pairs)assert.equal(pair[side]?.distribution?.skillBundleSha256,skill,'Variant changed during comparison');
  for(const pair of pairs)for(const key of ['reviewerMode','reviewerDefinitionSha256'])assert.equal(pair[side]?.distribution?.[key],pairs[0][side]?.distribution?.[key],'Reviewer variant changed during comparison');
 }
 if(conditions.comparisonScope==='distribution')for(const side of ['baseline','candidate']){
  const runtime=pairs[0][side].distribution?.runtimeSha256;assert(/^[a-f0-9]{64}$/.test(runtime),'Distribution runtime identity required');
  for(const pair of pairs)assert.equal(pair[side].distribution.runtimeSha256,runtime,'Distribution runtime changed during comparison');
 }
 const heads=new Set();
 for(const r of records){
  assert.deepEqual(r.conditions,conditions,'Comparison conditions differ');
  assert.equal(r.model,records[0].model,'Models differ');assert.equal(r.effort,records[0].effort,'Efforts differ');assert.equal(r.base,records[0].base,'Fixture bases differ');
  assert(!heads.has(r.head),'Repeated observation');heads.add(r.head);
 }
 const quality=r=>(r.distribution?.reviewerMode==='registered'?r.review?.agentType==='asc-reviewer':r.review?.agentType!=='asc-reviewer')&&r.verification?.passed===true&&r.verification.head===r.head&&r.verification.checks?.length===conditions.commands.length&&r.verification.checks.every(c=>c.exit===0)&&r.review?.verdict==='PASS'&&r.review.head===r.head&&r.ci?.head===r.head&&r.ci.draft===true&&r.ci.merged===false&&r.ci.boundToPr===true&&Object.keys(r.ci.checks??{}).length>0&&Object.values(r.ci.checks).every(c=>c==='success')&&r.manualHandoffs===0&&r.driverImplementationEdits===0&&!r.priorDriverFailure;
 const complete=r=>r.elapsedTimeIsEstimate!==true&&r.elapsedComparisonEligible!==false&&r.usage?.complete!==false&&r.usage?.reconciledWithHostModelUsage!==false&&Number.isFinite(r.elapsedSeconds)&&r.elapsedSeconds>0&&Number.isSafeInteger(r.usage?.observedProcessedTokens)&&r.usage.observedProcessedTokens>0&&Array.isArray(r.usage.missingUsage)&&r.usage.missingUsage.length===0;
 const inHostVerificationComplete=records.every(r=>r.conditions.host!=='claude'||(r.evaluationCoverage?.inHostVerification?.head===r.head&&r.evaluationCoverage.inHostVerification.checks===conditions.commands.length));
 const fixtureIsolationComplete=records.every(r=>r.conditions.fixtureTransfer==='pinned-ancestry-only');
 const browserVerificationComplete=records.every(r=>{
  if(r.conditions.scenario!=='complex-two-issue-system')return true;
  const expected=r.conditions.browserVerification,b=r.evaluationCoverage?.browserVerification;
  return expected?.transport==='fixed-isolated-mcp/v1'&&Number.isSafeInteger(expected.timeoutMilliseconds)&&expected.timeoutMilliseconds>0&&b?.passed===true&&b.head===r.head&&b.exit===0&&b.error===null&&b.signal===null&&b.inHostObservation?.head===r.head&&typeof b.inHostObservation.toolUseId==='string'&&['oracleSha256','driverSha256'].every(k=>/^[a-f0-9]{64}$/.test(expected[k])&&b[k]===expected[k]&&b.inHostObservation[k]===expected[k]);
 });
 const usable=records.every(complete),qualityPassed=records.every(quality)&&inHostVerificationComplete&&browserVerificationComplete;
 const result={pairs:pairs.length,qualityPassed,inHostVerificationComplete,browserVerificationComplete,measurementComplete:usable,fixtureIsolationComplete,requiredPairs:5,accepted:false,scope:'This fixed synthetic fixture and model only; no general autonomous-development guarantee.'};
 if(usable){
  for(const side of ['baseline','candidate'])result[side]={maxSeconds:Math.max(...pairs.map(p=>p[side].elapsedSeconds)),maxProcessedTokens:Math.max(...pairs.map(p=>p[side].usage.observedProcessedTokens)),medianSeconds:median(pairs.map(p=>p[side].elapsedSeconds)),medianProcessedTokens:median(pairs.map(p=>p[side].usage.observedProcessedTokens))};
  result.pairedDifferences=pairs.map((p,index)=>({pair:index+1,seconds:p.candidate.elapsedSeconds-p.baseline.elapsedSeconds,processedTokens:p.candidate.usage.observedProcessedTokens-p.baseline.usage.observedProcessedTokens}));
  result.pairsImprovingBoth=result.pairedDifferences.filter(p=>p.seconds<0&&p.processedTokens<0).length;
  result.worstCaseRegression=result.candidate.maxSeconds>result.baseline.maxSeconds||result.candidate.maxProcessedTokens>result.baseline.maxProcessedTokens;
  result.requiresWorstCaseAssessment=result.worstCaseRegression;
  result.accepted=fixtureIsolationComplete&&!result.worstCaseRegression&&pairs.length>=5&&qualityPassed&&result.candidate.medianSeconds<result.baseline.medianSeconds&&result.candidate.medianProcessedTokens<result.baseline.medianProcessedTokens;
 }
 return result;
}
