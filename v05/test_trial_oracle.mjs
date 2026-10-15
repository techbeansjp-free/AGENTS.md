import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {oracleArgv} from './trial_oracle.mjs';
test('fixed oracle requires completion, rejects early exit and incorrect result',{skip:process.platform!=='linux'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-oracle-regression-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'subprocess.py'),'raise RuntimeError("candidate import")');
 const code="import assert from 'node:assert/strict';import {total} from './candidate.mjs';assert.equal(total(2,3),6);";
 const cases=[['export const total=(a,b)=>a*b;',true],['process.exit(0);export const total=(a,b)=>a*b;',false],['export const total=()=>0;',false]];
 for(const [source,pass] of cases){fs.writeFileSync(path.join(root,'candidate.mjs'),source);const argv=oracleArgv(code),r=spawnSync(argv[0],argv.slice(1),{cwd:root,encoding:'utf8',timeout:10000});assert.equal(r.status===0,pass,r.stderr);}
});
