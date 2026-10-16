import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {inspectAssets} from '../../src/verification-assets.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(!process.env.ASC_TEST_CODEX)throw Error('Explicit native Codex test executable required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-host-deps-entry-')),workspace=path.join(root,'source'),home=path.join(root,'home'),tools=path.join(root,'tools');
try{for(const d of [workspace,home,tools,path.join(workspace,'.codex'),path.join(workspace,'.agents')])fs.mkdirSync(d,{recursive:true});
fs.writeFileSync(path.join(workspace,'.codex/config.toml'),'invalid candidate TOML = [');fs.writeFileSync(path.join(workspace,'.agents/data'),'retained');fs.writeFileSync(path.join(tools,'marker'),'runtime');
const nodeName=process.platform==='win32'?'node.exe':'node';fs.copyFileSync(process.execPath,path.join(tools,nodeName));fs.chmodSync(path.join(tools,nodeName),0o755);
const dependencies=fs.realpathSync(path.dirname(path.dirname(require.resolve('eslint/package.json')))),config=path.join(root,'host.json');fs.writeFileSync(config,JSON.stringify({executable:fs.realpathSync(process.env.ASC_TEST_CODEX),codexHome:home}));
const js=String.raw`
const assert=require('assert'),fs=require('fs'),{spawnSync}=require('child_process'),{Linter}=require('./node_modules/eslint');
assert(require('path').dirname(process.execPath).endsWith('verification-runtime'),'pinned runtime must take precedence');
assert(new Linter().verify('const x = ;',{}).length>0);
assert.equal(new Linter().verify('const x = 1;',{}).length,0);
assert.equal(fs.readFileSync('.agents/data','utf8'),'retained');
let denied=false;try{fs.writeFileSync('node_modules/eslint/package.json','changed')}catch{denied=true;}
assert(denied,'dependency must be read-only');
fs.writeFileSync('tsconfig.json',JSON.stringify({compilerOptions:{strict:true,types:[],target:'ES2022',module:'commonjs',outDir:'build'},files:['feature.ts']}));
const run=(args)=>{const out=fs.openSync('child.stdout','w'),err=fs.openSync('child.stderr','w');let result;try{result=spawnSync(process.execPath,args,{stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}return {...result,stdout:fs.readFileSync('child.stdout','utf8'),stderr:fs.readFileSync('child.stderr','utf8')};};
const compile=()=>run(['node_modules/typescript/lib/tsc.js','-p','tsconfig.json']);
fs.writeFileSync('feature.ts','export const answer: number = "wrong";');
let check=compile();assert.equal(check.status,2);assert.match(check.stdout,/TS2322/);
fs.writeFileSync('feature.ts','export const answer: number = 42;');
check=compile();assert.equal(check.status,0,check.stderr+check.stdout);
fs.writeFileSync('feature.test.cjs',"const {test}=require('node:test');const assert=require('node:assert/strict');test('compiled contract',()=>assert.equal(require('./build/feature.js').answer,42));");
const test=()=>run(['--test','--test-reporter=tap','feature.test.cjs']);
check=test();assert.equal(check.status,0,check.stderr+check.stdout);
fs.writeFileSync('build/feature.js','exports.answer=41;');
check=test();assert.equal(check.status,1);assert.match(check.stdout,/not ok/);
process.stdout.write('ESLint, TypeScript build and test positive/negative cases verified');
`;

const input={schema:'asc-host-execution/v1',id:'dependency-entry',operation:'verify',authorityRoots:[workspace],payload:{workspace,argv:[nodeName,'-e',js],timeout:60000,contract:{verificationAssets:{runtime:{source:tools,digest:inspectAssets(tools).digest},dependencies:[{source:dependencies,digest:inspectAssets(dependencies).digest,target:'node_modules'}]}}}};
const started=performance.now();const raw=execFileSync(process.execPath,['bin/asc-codex-host.mjs','--config',config],{input:JSON.stringify(input),encoding:'utf8',env:{PATH:path.dirname(process.execPath),TMPDIR:os.tmpdir(),TEMP:os.tmpdir(),TMP:os.tmpdir(),...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot}: {})},timeout:70000,maxBuffer:1024*1024});const response=JSON.parse(raw);assert.equal(response.result.exit,0,response.result.stderr+response.result.stdout);assert.equal(response.result.stdout,'ESLint, TypeScript build and test positive/negative cases verified');console.log(JSON.stringify({...response,hostWallSeconds:(performance.now()-started)/1000}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
