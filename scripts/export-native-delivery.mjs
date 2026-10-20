/** Export only synthetic observations, never rollout bodies or local install paths. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {claudeVerificationEvidence} from './claude-verification-evidence.mjs';
import {claudeBrowserEvidence} from './claude-browser-evidence.mjs';
const [root,output,mode]=process.argv.slice(2);if(!root||!output||process.argv.length>5||(mode!==undefined&&!['--complex','--claude'].includes(mode)))throw Error('Expected run root, output path and optional --complex or --claude');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name)));
const setup=read('setup.json'),d=read(mode==='--complex'?'complex-delivery.json':'delivery.json');
if(setup.verificationTransport!==undefined&&!['inline','saved','project'].includes(setup.verificationTransport))throw Error('Invalid verification transport');
if(setup.reviewerMode!==undefined&&!['generic','registered'].includes(setup.reviewerMode))throw Error('Invalid reviewer mode');
if(setup.reviewerMode==='registered'&&!/^[a-f0-9]{64}$/.test(setup.reviewerDefinitionSha256))throw Error('Missing reviewer definition identity');
if(setup.runnerSha256!==undefined&&!/^[a-f0-9]{64}$/.test(setup.runnerSha256))throw Error('Invalid runner identity');
if(setup.reviewerMode==='registered'&&d.review?.agentType!=='asc-reviewer')throw Error('Registered reviewer evidence mismatch');
if(setup.reviewerMode==='generic'&&d.review?.agentType==='asc-reviewer')throw Error('Generic reviewer evidence mismatch');
let ci=d.ci,intent=setup.issue?.body;
if(mode==='--claude'){
 if(d.implementationIntervention!==0||d.run?.status!==0||d.run.signal||d.session!==setup.session)throw Error('Incomplete or intervened Claude trial');
 intent=read('owner.json').intent;d.driverImplementationEdits=d.implementationIntervention;d.manualHandoffs=0;d.implementationAndReviewSeconds=d.run.seconds;d.elapsedSeconds=d.totalSeconds;
 if(d.usage?.complete!==true||d.usage.reconciledWithHostModelUsage!==true)throw Error('Incomplete Claude usage');
 if(Object.keys(d.modelUsage??{}).length!==1)throw Error('Explicit single-model Claude comparison required');
}
const claudeComplex=mode==='--claude'&&['complex-two-issue-currency','complex-two-issue-initial','complex-two-issue-system'].includes(setup.scenario);
if(mode==='--complex'||claudeComplex){
 if(!claudeComplex&&(d.phase!=='original'||d.interruptedAttempt))throw Error('Complex comparison requires uninterrupted original requirements');
 const runs=[claudeComplex?d.ci:d.complexCI,d.greetingCI];
 if(runs.some(r=>!r||r.head!==d.head))throw Error('Complex CI target mismatch');
 ci={head:d.head,draft:runs.every(r=>r.draft===true),merged:runs.some(r=>r.merged!==false),boundToPr:runs.every(r=>r.boundToPr===true),checks:Object.fromEntries(runs.flatMap((r,i)=>Object.entries(r.checks??{}).map(([name,value])=>[`${i===0?'complex':'greeting'}:${name}`,value])))};
 if(runs.some(r=>Object.keys(r.checks??{}).length===0))throw Error('Missing complex CI checks');
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(setup.base))throw Error('Invalid original base');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
 const original=execFileSync('git',['-C',setup.worktree,'show',`${setup.base}:complex/REQUIREMENTS.md`],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 intent=claudeComplex?setup.scenario==='complex-two-issue-system'?JSON.stringify([intent,original,execFileSync('git',['-C',setup.worktree,'show',`${setup.base}:complex/SYSTEM_REQUIREMENTS.md`],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']})]):setup.scenario==='complex-two-issue-initial'?JSON.stringify([intent,original]):JSON.stringify([intent,original,execFileSync('git',['-C',setup.worktree,'show',`${setup.base}:complex/REVISION.md`],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']})]):original;
}
if(typeof intent!=='string'||!intent.trim())throw Error('Missing original intent');
const packageRoot=path.join(root,'distribution/package'),identity=JSON.parse(fs.readFileSync(path.join(packageRoot,'release-identity.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=Object.entries(identity.sourceFiles).sort(([a],[b])=>a.localeCompare(b));
for(const [name,expected] of files){if(path.isAbsolute(name)||name.split('/').some(part=>part==='..'||!part))throw Error('Invalid distribution path');if(sha(fs.readFileSync(path.join(packageRoot,name)))!==expected)throw Error('Distribution identity mismatch');}
const runtimeSha256=sha(JSON.stringify(files.filter(([name])=>!name.startsWith('skills/asc/'))));
const skillBundleSha256=sha(JSON.stringify(files.filter(([name])=>name.startsWith('skills/asc/'))));
const distribution={runtimeSha256,reviewerMode:setup.reviewerMode??'generic',reviewerDefinitionSha256:setup.reviewerDefinitionSha256??null,skillBundleSha256,version:JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'))).version,skillSha256:sha(fs.readFileSync(path.join(packageRoot,'skills/asc/SKILL.md'))),identitySha256:sha(fs.readFileSync(path.join(packageRoot,'release-identity.json')))};

if(setup.repository!=='adachi-tatsuru/asc-public-synthetic-eval-20261016')throw Error('Not the authorized synthetic repository');
const gitControls=read('git-controls.json');
const pointerKey=path.relative(path.join(setup.origin,'.git'),path.join(setup.worktree,'.git'));
let inHostVerification=null;
if(mode==='--claude'&&d.inHostVerification){
 const events=fs.readFileSync(path.join(root,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 inHostVerification=claudeVerificationEvidence(events,d.verification,setup.verificationCapture);
 if(JSON.stringify(inHostVerification)!==JSON.stringify(d.inHostVerification))throw Error('In-Host verification evidence mismatch');
}
if(setup.scenario==='complex-two-issue-system'&&!setup.browserVerification)throw Error('System trial requires fixed browser verification');
let browserVerification=null;
if(setup.browserVerification){
 const expected=setup.browserVerification,value=d.browserVerification;
 if(expected.transport!=='fixed-isolated-mcp/v1'||!Number.isSafeInteger(expected.timeoutMilliseconds)||expected.timeoutMilliseconds<=0||['oracleSha256','driverSha256'].some(k=>! /^[a-f0-9]{64}$/.test(expected[k]))||!value||value.head!==d.head||value.passed!==true||value.exit!==0||value.error!==null||value.signal!==null||['oracleSha256','driverSha256'].some(k=>value[k]!==expected[k]))throw Error('Browser verification mismatch');
 const events=fs.readFileSync(path.join(root,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const observed=claudeBrowserEvidence(events,value);
 if(JSON.stringify(observed)!==JSON.stringify(value.inHostObservation))throw Error('Browser observation mismatch');
 browserVerification={...value};
}
const evaluationCoverage={browserVerification,inHostVerification,hostWorktreePointerRecorded:Object.hasOwn(gitControls,pointerKey),scope:'Presence in the pre-execution record; older runs are not upgraded by export.'};
// A manually resumed coordinator is not an uninterrupted autonomous observation.
const recovered=fs.existsSync(path.join(root,'result.json'))&&Object.hasOwn(read('result.json'),'recovery');
const manualHandoffs=recovered?Math.max(1,d.manualHandoffs??0):d.manualHandoffs;
const invocation=fs.existsSync(path.join(root,'result.json'))?read('result.json'):{};
const automaticRecovery=invocation.automaticResumes??0;
const exportedUsage=automaticRecovery?{...d.usage,missingUsage:[...(d.usage.missingUsage??[]),{reason:'Automatic recovery includes a failed turn; per-attempt usage completeness has not been established'}]}:d.usage;
const priorDriverFailure=fs.existsSync(path.join(root,'delivery-error.json'))?read('delivery-error.json'):null;
const result={scope:'Single synthetic current-host run with Host-owned automated review-record check, verification and Draft PR/CI delivery. Not a general performance or complex Goal guarantee.',evaluationCoverage,distribution,conditions:{fixtureTransfer:setup.fixtureTransfer??'unverified',runnerSha256:setup.runnerSha256??null,...(claudeComplex?{scenario:setup.scenario}:{}),recoveryPolicy:setup.recoveryPolicy??'none',mountMode:setup.mountMode??'host',cliVersion:setup.cliVersion??null,...(mode==='--claude'?{host:'claude',verificationTransport:setup.verificationTransport??'unrecorded',projectObserverSha256:setup.projectObserverSha256??null,actualModels:Object.keys(d.modelUsage)}:{}),...(setup.comparisonScope==='distribution'?{comparisonScope:'distribution'}:{runtimeSha256}),...(setup.browserVerification?{browserVerification:setup.browserVerification}:{}),intentSha256:createHash('sha256').update(intent).digest('hex'),commands:d.verification.results.map(r=>r.argv.map(arg=>path.isAbsolute(arg)?`absolute-path-sha256:${sha(arg)}`:arg))},model:setup.model,effort:setup.effort,base:setup.base,head:ci.head,review:d.review,usage:exportedUsage,implementationAndReviewSeconds:d.implementationAndReviewSeconds,deliverySeconds:d.deliverySeconds,elapsedSeconds:d.elapsedTimeIsEstimate===true?null:d.elapsedSeconds,...(d.elapsedTimeIsEstimate===true?{elapsedSecondsEstimate:d.elapsedSeconds,elapsedComparisonEligible:false,elapsedTimeIsEstimate:true}:{}),...(typeof d.timingScope==='string'?{timingScope:d.timingScope}:{}),manualHandoffs,recovered,automaticResumes:automaticRecovery,attempts:invocation.attempts??null,driverImplementationEdits:d.driverImplementationEdits,priorDriverFailure,verification:{head:d.verification.head,passed:d.verification.passed,checks:d.verification.results.map(r=>({exit:r.exit,stdoutSha256:r.stdoutSha256,stderrSha256:r.stderrSha256}))},pullRequest:`https://github.com/${setup.repository}/pull/${d.pr}`,ci,limitations:['One run; outer development/evaluation cost not included in parent and child usage.',claudeComplex?`${setup.scenario==='complex-two-issue-system'?'Two vertical Issues with HTTP/browser journeys':setup.scenario==='complex-two-issue-initial'?'Original two-Issue implementation':'Two-Issue currency revision'}; worker topology and parallel execution require separate transcript evidence. Interruption and restart are not part of this observation.`:mode==='--complex'?'Original complex requirements only; revision, repair and restart acceptance remain separate.':'Fresh-context simple change only; repair, multiple Issues and restart acceptance remain separate.','No merge or release.']};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({pr:d.pr,elapsedSeconds:result.elapsedSeconds,...(result.elapsedTimeIsEstimate?{elapsedSecondsEstimate:result.elapsedSecondsEstimate,elapsedTimeIsEstimate:true,elapsedComparisonEligible:false}:{}),tokens:d.usage.observedProcessedTokens,priorDriverFailure}));
