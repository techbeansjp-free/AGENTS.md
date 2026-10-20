import test from 'node:test';import assert from 'node:assert/strict';
import {nativeModelConditions} from '../scripts/native-model-conditions.mjs';
test('fresh evaluation requires explicit selection and records the selected conditions',()=>{
 assert.throws(()=>nativeModelConditions({}),/ASC_EVAL_MODEL/);
 assert.deepEqual(nativeModelConditions({ASC_EVAL_MODEL:'available-model'}),{model:'available-model',effort:'medium'});
 assert.throws(()=>nativeModelConditions({ASC_EVAL_MODEL:'bad\nmodel'}));
 assert.throws(()=>nativeModelConditions({ASC_EVAL_MODEL:'model',ASC_EVAL_EFFORT:'guess'}));
});
test('continuation preserves historical conditions and rejects silent overrides',()=>{
 const previous={model:'historical-model',effort:'high'};
 assert.deepEqual(nativeModelConditions({},previous),previous);
 assert.throws(()=>nativeModelConditions({ASC_EVAL_MODEL:'new-model'},previous),/preserve/);
 assert.throws(()=>nativeModelConditions({ASC_EVAL_EFFORT:'low'},previous),/preserve/);
});
