/** Prepare blinded reviewer inputs separately from evaluator-owned answers. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import * as authorization from '../v05/evaluation/authorization-corpus.mjs';
import * as persistence from '../v05/evaluation/persistence-corpus.mjs';
import {cases as documents} from '../v05/evaluation/scenario-corpus.mjs';
const [destination,baselineSkill,candidateSkill]=process.argv.slice(2);
if(!destination||!baselineSkill||!candidateSkill||process.argv.length!==5)throw Error('Usage: prepare-review-scenarios <new-output-directory> <baseline-skill> <candidate-skill>');
const rows=[...authorization.cases.map(c=>({request:authorization.impactIntent,before:authorization.baseline,after:c.candidate,defects:c.defects})),...persistence.cases.map(c=>({request:persistence.intent,before:persistence.baseline,after:c.candidate,defects:c.defects})),...documents];
const inputs=rows.map((r,i)=>({caseId:'case-'+(i+1),request:r.request,before:r.before,after:r.after}));
// Labels and executable oracle sources must never be sent to the reviewer.
const answers=rows.map((r,i)=>({caseId:'case-'+(i+1),defects:r.defects}));
const baseline=fs.readFileSync(baselineSkill),candidate=fs.readFileSync(candidateSkill);
fs.mkdirSync(destination);
for(const [name,skill] of [['baseline',baseline],['candidate',candidate]]){
 const directory=path.join(destination,name);fs.mkdirSync(directory);
 fs.writeFileSync(path.join(directory,'SKILL.md'),skill);fs.writeFileSync(path.join(directory,'cases.json'),JSON.stringify(inputs,null,2)+'\n');
}
fs.mkdirSync(path.join(destination,'evaluator'));
fs.writeFileSync(path.join(destination,'evaluator/answers.json'),JSON.stringify(answers,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({cases:inputs.length,baselineSkillSha256:hash(baseline),candidateSkillSha256:hash(candidate),inputSha256:hash(JSON.stringify(inputs)),note:'Give each fresh reviewer only its arm directory; no answers, previous verdicts or evaluator source.'},null,2));
