import {tempDir} from './helpers/temp-dir.mjs';
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

test('shared sandbox filesystem denies the Mac system temporaries only on Mac',async()=>{
 const {sandboxFilesystemBase,sharedTemporaryRoots}=await import('../src/codex-runtime.mjs');
 const base=sandboxFilesystemBase({providerRoots:['/opt/codex'],node:'/opt/node/bin/node',platform:'darwin'});
 for(const shared of ['/tmp','/private/tmp','/var/tmp','/private/var/tmp'])assert.equal(base[shared],'deny',shared);assert.equal(base[':root'],'deny');
 assert.equal(base['/System/Library/OpenSSL'],'read');assert.equal(base['/opt/codex'],'read');assert.equal(base['/opt/node/bin/node'],'read');
 for(const platform of ['linux','win32']){
  assert.deepEqual(sharedTemporaryRoots(platform),[]);
  const denied=Object.entries(sandboxFilesystemBase({providerRoots:[],node:'/n',platform})).filter(([,v])=>v==='deny').map(([k])=>k);
  assert.deepEqual(denied,[':root']);
 }
});

test('the macOS minimum Codex version is the CI pin and the documented minimum',async()=>{
 const fs=await import('node:fs');
 const {MACOS_MIN_CODEX_VERSION}=await import('../src/codex-runtime.mjs');
 const workflow=fs.readFileSync(new URL('../.github/workflows/native-verification.yml',import.meta.url),'utf8');
 assert.deepEqual([...workflow.matchAll(/@openai\/codex@(\S+)/g)].map(m=>m[1]),[MACOS_MIN_CODEX_VERSION]);
 assert.ok(fs.readFileSync(new URL('../v05/USAGE.md',import.meta.url),'utf8').includes(`Codex ${MACOS_MIN_CODEX_VERSION}以降`));
});

test('Codex runtime roots reject an unrelated executable parent',async t=>{
 const fs=await import('node:fs'),path=await import('node:path');
 const {codexRuntimeRoots}=await import('../src/codex-runtime.mjs');
 const root=tempDir('asc-runtime-root-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'bin'));const binary=path.join(root,'bin','codex.js');fs.writeFileSync(binary,'');
 assert.throws(()=>codexRuntimeRoots(binary),/ENOENT/);
 const native=path.join(root,'bin','codex.exe');fs.writeFileSync(native,'native fixture');assert.deepEqual(codexRuntimeRoots(native),[fs.realpathSync(native)]);
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'other'}));assert.throws(()=>codexRuntimeRoots(binary),/Expected @openai/);
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@openai/codex'}));assert.equal(codexRuntimeRoots(binary)[0],fs.realpathSync(root));
});
