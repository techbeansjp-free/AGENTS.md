import test from 'node:test';import assert from 'node:assert/strict';
import {evaluationLaunch} from '../scripts/native-evaluation-launch.mjs';
test('host mode preserves executable and exact argument array',()=>{const args=['exec','-m','selected'];assert.deepEqual(evaluationLaunch({binary:'/tool'},args,'unused','host'),{binary:'/tool',args});});
test('unknown mount mode cannot silently remove confinement',()=>{assert.throws(()=>evaluationLaunch({},[],'.','unknown'),/Unsupported/);});
test('clean namespace cannot mount an arbitrary project root',()=>{if(process.platform==='linux')assert.throws(()=>evaluationLaunch({},[],process.cwd(),'clean-linux'),/disposable/);});
