import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {inspectAssets} from '../src/verification-assets.mjs';import {stageHostVerificationAssets} from '../src/host-verification-assets.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-host-assets-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspace'),runtime=path.join(root,'runtime'),dependencies=path.join(root,'dependencies'),tools=path.join(root,'tools'),authority=path.join(root,'repo');
 for(const dir of [workspace,runtime,dependencies,tools,authority])fs.mkdirSync(dir);
 fs.mkdirSync(path.join(dependencies,'fixture'));fs.writeFileSync(path.join(dependencies,'fixture','index.js'),'module.exports=42');fs.writeFileSync(path.join(tools,'marker'),'runtime');
 const assets={runtime:{source:tools,digest:inspectAssets(tools).digest},dependencies:[{source:dependencies,digest:inspectAssets(dependencies).digest,target:'frontend/node_modules'}]};
 return {root,workspace,runtime,dependencies,tools,assets,options:{workspace,runtime,authorityRoots:[authority]}};
}
test('Host stages pinned dependencies and actual Node resolves them without installation',t=>{
 const f=fixture(t),result=stageHostVerificationAssets(f.assets,f.options);
 assert.equal(result.readOnlyRoots.length,2);assert.equal(fs.readFileSync(path.join(result.runtimeRoot,'marker'),'utf8'),'runtime');
 const output=execFileSync(process.execPath,['-e',"process.stdout.write(String(require('./node_modules/fixture')))"],{cwd:path.join(f.workspace,'frontend'),encoding:'utf8'});assert.equal(output,'42');
 fs.writeFileSync(path.join(f.workspace,'frontend/node_modules/fixture/index.js'),'copy changed');assert.equal(fs.readFileSync(path.join(f.dependencies,'fixture/index.js'),'utf8'),'module.exports=42');
});
test('Host rejects altered pins, tracked shadows, authority overlap and escaping links',t=>{
 for(const mode of ['pin','shadow','authority','control','link']){
  const f=fixture(t);
  if(mode==='pin')fs.writeFileSync(path.join(f.dependencies,'changed'),'changed');
  if(mode==='shadow')fs.mkdirSync(path.join(f.workspace,'frontend/node_modules'),{recursive:true});
  if(mode==='authority')f.options.authorityRoots.push(f.dependencies);
  if(mode==='control')f.assets.dependencies[0].target='.codex';
  if(mode==='link'){fs.symlinkSync('../tools/marker',path.join(f.dependencies,'escape'));}
  assert.throws(()=>stageHostVerificationAssets(f.assets,f.options));
 }
});
test('Host preserves internal dependency links without exposing original asset tree',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.dependencies,'.bin'));fs.symlinkSync('../fixture/index.js',path.join(f.dependencies,'.bin','fixture'));
 f.assets.dependencies[0].digest=inspectAssets(f.dependencies).digest;stageHostVerificationAssets(f.assets,f.options);
 assert.equal(fs.readFileSync(path.join(f.workspace,'frontend/node_modules/.bin/fixture'),'utf8'),'module.exports=42');
 assert.ok(fs.realpathSync(path.join(f.workspace,'frontend/node_modules/.bin/fixture')).startsWith(f.workspace+path.sep));
});

test('Host canonicalizes temporary-directory aliases before declaring asset roots',t=>{
 const f=fixture(t),alias=path.join(f.root,'alias');fs.symlinkSync(f.root,alias,'junction');
 const result=stageHostVerificationAssets(f.assets,{...f.options,workspace:path.join(alias,'workspace'),runtime:path.join(alias,'runtime')});
 for(const dir of result.readOnlyRoots)assert.equal(dir,fs.realpathSync(dir));
 assert.equal(result.runtimeRoot,path.join(fs.realpathSync(f.runtime),'verification-runtime'));
});
