import test from 'node:test';import assert from 'node:assert/strict';
import {validateDelegation} from '../src/adaptive-run.mjs';
test('more than 64 owner verification rules retain full scope and coverage checks',()=>{
 const paths=Array.from({length:65},(_,i)=>'part-'+i+'.js');
 const r={contract:{allowedPaths:paths},decomposition:{mode:'within-owner-contract',unitChecks:paths.map(p=>({paths:[p],argvs:[['node','check.mjs',p]]}))}};
 assert.doesNotThrow(()=>validateDelegation(r));
 r.decomposition.unitChecks.pop();assert.throws(()=>validateDelegation(r),/coverage/);
 r.decomposition.unitChecks.push({paths:['outside.js'],argvs:[['node','check.mjs']]});assert.throws(()=>validateDelegation(r),/scope/);
});
