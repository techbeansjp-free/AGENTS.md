import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeVerdict,probeNativeSandbox} from '../src/native-probe.mjs';
test('native diagnostics require positive controls, denied operations and unchanged host',()=>{
 const good={positive:{completed:true,read:'allowed',write:'allowed',network:'connected'},negative:{completed:true,read:'denied',write:'denied',network:'denied'},hostUnchanged:true,connections:{positive:1,negative:0}};
 assert.equal(probeVerdict(good),true);
 assert.equal(probeVerdict({...good,negative:{...good.negative,write:'private-copy'}}),true);
 assert.equal(probeVerdict({...good,negative:{...good.negative,write:'private-copy'},hostUnchanged:false}),false);
 for(const key of ['read','write','network']){
  assert.equal(probeVerdict({...good,negative:{...good.negative,[key]:'allowed'}}),false);
  assert.equal(probeVerdict({...good,positive:{...good.positive,[key]:'denied'}}),false);
 }
 for(const bad of [{...good,hostUnchanged:false},{...good,negative:undefined},{...good,connections:{positive:0,negative:0}}, {...good,negative:{...good.negative,network:'timeout'}},{...good,connections:{positive:1,negative:1}}])assert.equal(probeVerdict(bad),false);
});
test('native diagnostic accepts no shell command or inferred executable',async()=>{
 await assert.rejects(probeNativeSandbox('codex --unsafe'),/Absolute/);
});
