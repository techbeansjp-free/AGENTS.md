import test from 'node:test';
import assert from 'node:assert/strict';
import {providerFailure} from '../src/provider-failure.mjs';
const message='Selected model is at capacity. Please try a different model.';
const failed=JSON.stringify({type:'turn.failed',error:{message}});
test('classifies observed terminal provider capacity without switching models',()=>{
 assert.deepEqual(providerFailure(failed),{code:'ASC_PROVIDER_CAPACITY',retryable:true});
});
test('tool output, diagnostics and unknown errors cannot authorize retries',()=>{
 for(const output of [message,JSON.stringify({type:'error',message}),JSON.stringify({type:'item.completed',item:{output:failed}}),JSON.stringify({type:'turn.failed',error:{message:'authentication failed'}}),JSON.stringify({type:'turn.failed',error:{message:'model unsupported'}})])assert.equal(providerFailure(output),undefined);
});
test('a later terminal result supersedes previous capacity failure',()=>{
 assert.equal(providerFailure(failed+'\n'+JSON.stringify({type:'turn.completed',usage:{}})),undefined);
 assert.equal(providerFailure(failed+'\n'+JSON.stringify({type:'turn.failed',error:{message:'permission denied'}})),undefined);
});
