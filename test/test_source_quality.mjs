import {tempDir} from './helpers/temp-dir.mjs';
/**
 * Run the same source-language checker that the trusted CI job runs, so `npm test` (and `npm run quality`) reports
 * non-TypeScript sources before push (Issue #1676). The rules live only in scripts/check_source_quality.ts; this file
 * calls that script and does not restate them.
 */
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const source=fileURLToPath(new URL('../',import.meta.url)),checker=path.join(source,'scripts/check_source_quality.ts');
function check(root){
 const p=spawnSync(process.execPath,['--import','tsx',checker,`--root=${root}`],{cwd:source,encoding:'utf8'});
 assert.equal(p.error,undefined);return {status:p.status,output:p.stdout+p.stderr,result:p.stdout.trim()?JSON.parse(p.stdout):undefined};
}
test('repository sources pass the source-language checker used by trusted CI',()=>{
 const {status,output,result}=check(source);
 assert.equal(status,0,output);assert.equal(result.valid,true,output);assert.ok(result.files>0,output);
});
test('source-language checker rejects a non-TypeScript source such as a Python evidence script',t=>{
 const root=tempDir('asc-source-quality-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.cpSync(path.join(source,'.agent-skill-chain'),path.join(root,'.agent-skill-chain'),{recursive:true});
 const clean=check(root);assert.equal(clean.status,0,clean.output);
 const script=path.join(root,'docs/evidence/sample/scripts/log_decisions.py');fs.mkdirSync(path.dirname(script),{recursive:true});fs.writeFileSync(script,'print("x")\n');
 const rejected=check(root);assert.equal(rejected.status,1,rejected.output);assert.equal(rejected.result.valid,false);
 assert.ok(rejected.result.errors.includes('実装言語をTypeScriptへ集約したprojectに対象外sourceがあります: docs/evidence/sample/scripts/log_decisions.py'),rejected.output);
});
