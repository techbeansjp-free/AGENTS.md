import test from 'node:test';import assert from 'node:assert/strict';
import {interruptionCheckpoint} from '../scripts/interruption-evidence.mjs';
test('checkpoint requires saved changes and confirmed interrupted termination',()=>{
 const valid={signalSent:true,status:null,signal:'SIGINT',changed:true};assert.equal(interruptionCheckpoint(valid),true);
 assert.equal(interruptionCheckpoint({...valid,status:130,signal:null}),true);
 for(const patch of [{signalSent:false},{changed:false},{status:0,signal:null},{status:1,signal:null},{signal:'SIGTERM'}])assert.equal(interruptionCheckpoint({...valid,...patch}),false);
});
