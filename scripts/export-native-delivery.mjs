/** Export only synthetic observations, never rollout bodies or local install paths. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const [root,output]=process.argv.slice(2);if(!root||!output)throw Error('Expected run root and output path');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name)));
const setup=read('setup.json'),d=read('delivery.json');
if(setup.repository!=='adachi-tatsuru/asc-public-synthetic-eval-20261016')throw Error('Not the authorized synthetic repository');
const priorDriverFailure=fs.existsSync(path.join(root,'delivery-error.json'))?read('delivery-error.json'):null;
const result={scope:'Single synthetic current-host run with Host-owned automated review-record check, verification and Draft PR/CI delivery. Not a general performance or complex Goal guarantee.',conditions:{intentSha256:createHash('sha256').update(setup.issue.body).digest('hex'),commands:d.verification.results.map(r=>r.argv)},model:setup.model,effort:setup.effort,base:setup.base,head:d.ci.head,review:d.review,usage:d.usage,implementationAndReviewSeconds:d.implementationAndReviewSeconds,deliverySeconds:d.deliverySeconds,elapsedSeconds:d.elapsedSeconds,manualHandoffs:d.manualHandoffs,driverImplementationEdits:d.driverImplementationEdits,priorDriverFailure,verification:{head:d.verification.head,passed:d.verification.passed,checks:d.verification.results.map(r=>({exit:r.exit,stdoutSha256:r.stdoutSha256,stderrSha256:r.stderrSha256}))},pullRequest:`https://github.com/${setup.repository}/pull/${d.pr}`,ci:d.ci,limitations:['One run; outer development/evaluation cost not included in parent and child usage.','Fresh-context simple change only; repair, multiple Issues and restart acceptance remain separate.','No merge or release.']};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({pr:d.pr,elapsedSeconds:d.elapsedSeconds,tokens:d.usage.observedProcessedTokens,priorDriverFailure}));
