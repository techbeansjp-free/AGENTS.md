/** Export only synthetic observations, never rollout bodies or local install paths. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [root,output,mode]=process.argv.slice(2);if(!root||!output||process.argv.length>5||(mode!==undefined&&mode!=='--complex'))throw Error('Expected run root, output path and optional --complex');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name)));
const setup=read('setup.json'),d=read(mode==='--complex'?'complex-delivery.json':'delivery.json');
let ci=d.ci,intent=setup.issue?.body;
if(mode==='--complex'){
 if(d.phase!=='original'||d.interruptedAttempt)throw Error('Complex comparison requires uninterrupted original requirements');
 const runs=[d.complexCI,d.greetingCI];
 if(runs.some(r=>!r||r.head!==d.head))throw Error('Complex CI target mismatch');
 ci={head:d.head,draft:runs.every(r=>r.draft===true),merged:runs.some(r=>r.merged!==false),boundToPr:runs.every(r=>r.boundToPr===true),checks:Object.fromEntries(runs.flatMap((r,i)=>Object.entries(r.checks??{}).map(([name,value])=>[`${i===0?'complex':'greeting'}:${name}`,value])))};
 if(runs.some(r=>Object.keys(r.checks??{}).length===0))throw Error('Missing complex CI checks');
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(setup.base))throw Error('Invalid original base');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
 intent=execFileSync('git',['-C',setup.worktree,'show',`${setup.base}:complex/REQUIREMENTS.md`],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
}
if(typeof intent!=='string'||!intent.trim())throw Error('Missing original intent');
const packageRoot=path.join(root,'distribution/package'),identity=JSON.parse(fs.readFileSync(path.join(packageRoot,'release-identity.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=Object.entries(identity.sourceFiles).sort(([a],[b])=>a.localeCompare(b));
for(const [name,expected] of files){if(path.isAbsolute(name)||name.split('/').some(part=>part==='..'||!part))throw Error('Invalid distribution path');if(sha(fs.readFileSync(path.join(packageRoot,name)))!==expected)throw Error('Distribution identity mismatch');}
const runtimeSha256=sha(JSON.stringify(files.filter(([name])=>!name.startsWith('skills/asc/'))));
const skillBundleSha256=sha(JSON.stringify(files.filter(([name])=>name.startsWith('skills/asc/'))));
const distribution={skillBundleSha256,version:JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'))).version,skillSha256:sha(fs.readFileSync(path.join(packageRoot,'skills/asc/SKILL.md'))),identitySha256:sha(fs.readFileSync(path.join(packageRoot,'release-identity.json')))};

if(setup.repository!=='adachi-tatsuru/asc-public-synthetic-eval-20261016')throw Error('Not the authorized synthetic repository');
const gitControls=read('git-controls.json');
const pointerKey=path.relative(path.join(setup.origin,'.git'),path.join(setup.worktree,'.git'));
const evaluationCoverage={hostWorktreePointerRecorded:Object.hasOwn(gitControls,pointerKey),scope:'Presence in the pre-execution record; older runs are not upgraded by export.'};
const priorDriverFailure=fs.existsSync(path.join(root,'delivery-error.json'))?read('delivery-error.json'):null;
const result={scope:'Single synthetic current-host run with Host-owned automated review-record check, verification and Draft PR/CI delivery. Not a general performance or complex Goal guarantee.',evaluationCoverage,distribution,conditions:{runtimeSha256,intentSha256:createHash('sha256').update(intent).digest('hex'),commands:d.verification.results.map(r=>r.argv)},model:setup.model,effort:setup.effort,base:setup.base,head:ci.head,review:d.review,usage:d.usage,implementationAndReviewSeconds:d.implementationAndReviewSeconds,deliverySeconds:d.deliverySeconds,elapsedSeconds:d.elapsedSeconds,manualHandoffs:d.manualHandoffs,driverImplementationEdits:d.driverImplementationEdits,priorDriverFailure,verification:{head:d.verification.head,passed:d.verification.passed,checks:d.verification.results.map(r=>({exit:r.exit,stdoutSha256:r.stdoutSha256,stderrSha256:r.stderrSha256}))},pullRequest:`https://github.com/${setup.repository}/pull/${d.pr}`,ci,limitations:['One run; outer development/evaluation cost not included in parent and child usage.',mode==='--complex'?'Original complex requirements only; revision, repair and restart acceptance remain separate.':'Fresh-context simple change only; repair, multiple Issues and restart acceptance remain separate.','No merge or release.']};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({pr:d.pr,elapsedSeconds:d.elapsedSeconds,tokens:d.usage.observedProcessedTokens,priorDriverFailure}));
