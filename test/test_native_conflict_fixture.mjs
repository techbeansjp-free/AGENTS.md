import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {injectNativeConflict,assertConflictFaultsRemoved,conflictFaultCodes} from '../scripts/native-conflict-fixture.mjs';
test('injects real conflicting faults only in reservation and leaves resolution to the Agent',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-conflict-test-'));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k))),git=(...a)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...a],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git('init','-b','test/9003-currency');git('config','user.name','Synthetic');git('config','user.email','test@example.invalid');
  fs.mkdirSync(path.join(root,'complex/reservation'),{recursive:true});fs.mkdirSync(path.join(root,'complex/billing'),{recursive:true});
  const service=path.join(root,'complex/reservation/service.mjs'),billing=path.join(root,'complex/billing/service.mjs');
  fs.writeFileSync(service,"export const error = 'OTHER';\n");fs.writeFileSync(billing,'unchanged\n');git('add','.');git('commit','-m','Fixture');
  assert.throws(()=>injectNativeConflict(root),/literal/);assert.equal(git('status','--porcelain'),'');
  fs.writeFileSync(service,"export const error = 'VALIDATION';\n");assert.throws(()=>injectNativeConflict(root),/clean/);git('add','.');git('commit','-m','Validation contract');
  const base=git('rev-parse','HEAD'),proof=injectNativeConflict(root);
  assert.equal(proof.base,base);assert.equal(proof.evaluatorResolution,false);assert.equal(git('rev-parse','CHERRY_PICK_HEAD'),proof.right);
  assert.equal(git('symbolic-ref','--short','HEAD'),'test/9003-currency');assert.match(fs.readFileSync(service,'utf8'),/<<<<<<< /);
  assert.equal(fs.readFileSync(billing,'utf8'),'unchanged\n');assert.equal(git('diff','--name-only','--diff-filter=U'),'complex/reservation/service.mjs');
  for(const head of [proof.left,proof.right])assert.equal(git('diff','--name-only',base,head),'complex/reservation/service.mjs');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('every injected fault must be absent even in branches untouched by fixed lifecycle oracles',()=>{
 for(const code of conflictFaultCodes)assert.throws(()=>assertConflictFaultsRemoved(`function invalidSku(){throw Error('${code}');}`),/fault remains/);
 assert.doesNotThrow(()=>assertConflictFaultsRemoved("function invalidSku(){throw Error('VALIDATION');}"));
});
