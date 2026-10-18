import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/summarize-complex-context.mjs',import.meta.url));
test('summary binds Git reads to the fixture and distinguishes current oracle hashes and missing usage',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-summary-test-'));
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
 const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
  for(const role of ['reservation','billing']){fs.mkdirSync(path.join(root,role));fs.writeFileSync(path.join(root,role,'service.mjs'),'export const value=1;');}
  fs.mkdirSync(path.join(root,'oracle'));fs.writeFileSync(path.join(root,'oracle/check.mjs'),'original oracle');fs.writeFileSync(path.join(root,'REQUIREMENTS.md'),'original contract');
  git('add','.');git('-c','core.hooksPath=/dev/null','commit','-qm','fixture');const head=git('rev-parse','HEAD');
  const logs=path.join(root,'single-logs');fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs,'integration.json'),JSON.stringify({integrationHead:head,commits:{reservation:head,billing:head},oracleStatus:0}));
  fs.writeFileSync(path.join(logs,'worker.result.json'),JSON.stringify({role:'worker',status:0,usage:[]}));
  fs.writeFileSync(path.join(root,'oracle/check.mjs'),'later oracle');
  const setup=path.join(root,'setup.json');fs.writeFileSync(setup,JSON.stringify({root,cases:[{strategy:'single',origin:root,base:head,worktrees:{integration:{repo:root}}}]}));
  const first=path.join(root,'first.json'),second=path.join(root,'second.json');
  execFileSync(process.execPath,[script,setup,first],{env});
  execFileSync(process.execPath,[script,setup,second],{env:{...env,GIT_DIR:path.join(root,'missing.git'),GIT_WORK_TREE:os.tmpdir()}});
  assert.equal(fs.readFileSync(first,'utf8'),fs.readFileSync(second,'utf8'));
  const trial=JSON.parse(fs.readFileSync(first)).trials[0];assert.equal(trial.initialContract,'original contract');
  assert.deepEqual(trial.usageMissingCalls,['worker']);assert.equal(trial.oracleSha256,undefined);
  assert.match(trial.oracleHashScope,/not proof/);assert.equal(typeof trial.oracleHashesAtExport['check.mjs'],'string');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
