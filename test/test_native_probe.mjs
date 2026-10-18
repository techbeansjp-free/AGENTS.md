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

test('Mac Node runtime grants only system OpenSSL read dependency',async()=>{
 const {nodeRuntimeRoots}=await import('../src/codex-runtime.mjs');
 assert.deepEqual(nodeRuntimeRoots('darwin'),['/System/Library/OpenSSL']);
 assert.deepEqual(nodeRuntimeRoots('linux'),[]);assert.deepEqual(nodeRuntimeRoots('win32'),[]);
});

test('Codex runtime roots reject an unrelated executable parent',async t=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {codexRuntimeRoots}=await import('../src/codex-runtime.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-runtime-root-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'bin'));const binary=path.join(root,'bin','codex.js');fs.writeFileSync(binary,'');
 assert.throws(()=>codexRuntimeRoots(binary),/ENOENT/);
 const native=path.join(root,'bin','codex.exe');fs.writeFileSync(native,'native fixture');assert.deepEqual(codexRuntimeRoots(native),[fs.realpathSync(native)]);
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'other'}));assert.throws(()=>codexRuntimeRoots(binary),/Expected @openai/);
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@openai/codex'}));assert.equal(codexRuntimeRoots(binary)[0],fs.realpathSync(root));
});
