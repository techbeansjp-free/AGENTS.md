import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {worktreeFixture} from './helpers/worktree-fixture.mjs';
import {observeProjectVerification} from '../scripts/project-verification-observation.mjs';
test('project command observation does not require ASC product helpers',t=>{
 const f=worktreeFixture(t);const r=observeProjectVerification({repo:f.work,base:f.base,owner:f.owner});
 assert.equal(r.passed,true);assert.equal(r.head,f.git(f.work,'rev-parse','HEAD'));assert.equal(r.results.length,1);assert.equal(r.schema,'asc-evaluation-project-tests/v1');
 f.contract.commands=[[process.execPath,'-e','process.exit(7)'],[process.execPath,'-e',"throw Error('must not run')"]];f.save();
 const failed=observeProjectVerification({repo:f.work,base:f.base,owner:f.owner});assert.equal(failed.passed,false);assert.equal(failed.results.length,1);assert.equal(failed.results[0].exit,7);
});
test('project command observation rejects changed source and owner',t=>{
 const f=worktreeFixture(t);
 f.contract.commands=[[process.execPath,'-e',"require('fs').writeFileSync('feature.cjs','module.exports=0')"]];f.save();
 assert.throws(()=>observeProjectVerification({repo:f.work,base:f.base,owner:f.owner}),/target or owner changed/);
 f.git(f.work,'restore','feature.cjs');
 f.contract.commands=[[process.execPath,'-e',"require('fs').writeFileSync(process.argv[1],'{}')",f.owner]];f.save();
 assert.throws(()=>observeProjectVerification({repo:f.work,base:f.base,owner:f.owner}),/target or owner changed/);
 assert.equal(fs.readFileSync(path.join(f.work,'feature.cjs'),'utf8'),'module.exports=42;');
});

test('already dirty tracked source cannot change behind the same status marker',t=>{
 const f=worktreeFixture(t);fs.writeFileSync(path.join(f.work,'feature.cjs'),'module.exports=43;');
 f.contract.commands=[[process.execPath,'-e',"require('fs').writeFileSync('feature.cjs','module.exports=44;')"]];f.save();
 assert.throws(()=>observeProjectVerification({repo:f.work,base:f.base,owner:f.owner}),/target or owner changed/);
});
