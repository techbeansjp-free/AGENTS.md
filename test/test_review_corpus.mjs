import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as calculation from '../v05/evaluation/review-corpus.mjs';
import * as authorization from '../v05/evaluation/authorization-corpus.mjs';
import * as injection from '../v05/evaluation/review-injection-corpus.mjs';
import * as persistence from '../v05/evaluation/persistence-corpus.mjs';

for(const [name,corpus,filename] of [
 ['calculation',calculation,'calc.py'],['authorization',authorization,'service.py'],
 ['authorization-impact',{...authorization,cases:authorization.impactCases},'service.py'],
 ['injection',injection,'service.py'],['persistence',persistence,'ledger.py'],
])test(`review oracle reproduces exact ${name} defects and clean controls`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-review-oracle-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const c of [{id:'baseline',candidate:corpus.baseline,defects:[]},...corpus.cases]){
  fs.writeFileSync(path.join(root,filename),c.candidate);
  const run=spawnSync('/usr/bin/python3',['-I','-B','-c',`import sys; sys.path.insert(0, ${JSON.stringify(root)})\n${corpus.oracle}`],{cwd:root,env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000,maxBuffer:1048576});
  assert.equal(run.error,undefined,c.id);assert.equal(run.signal,null,c.id);
  assert.equal(run.status,c.defects.length?1:0,`${c.id}: ${run.stderr}`);
  if(c.defects.length){
   const label=c.failureLabel??(name==='calculation'?'invalid accepted: '+(c.id==='r01'?'(9007199254740991, 2)':'(1, 0)'):c.defects[0]);
   assert.ok(run.stderr.includes('AssertionError: '+label),`${c.id}: wrong failure: ${run.stderr}`);
  }
 }
});
