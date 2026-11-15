// Native macOS check of #1695 and #1701, run in CI with TMPDIR unset: the Controller temporary directory is then /tmp.
// Without the shared-temporary denial the real Codex sandbox changes the Controller's files (negative control); with
// it, the native diagnostic, every sandbox purpose and the Agent preflight keep them unchanged. No model is called.
import {tempDir} from '../helpers/temp-dir.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {configuration,runAgent} from '../../src/restricted-agent.mjs';
import {probeNativeSandbox} from '../../src/native-probe.mjs';
import {sharedTemporaryRoots,POSIX_SHARED_TEMPORARIES} from '../../src/codex-runtime.mjs';
import {runHostProcess} from '../../src/host-process.mjs';
if(!process.env.ASC_TEST_CODEX)throw Error('Explicit native Codex test executable required');
if(process.platform!=='darwin')throw Error('This check reproduces the macOS shared-temporary exposure');
if(process.env.TMPDIR!==undefined||fs.realpathSync(os.tmpdir())!=='/private/tmp')throw Error('Run with TMPDIR unset so the Controller temporary directory is /tmp');
const codex=fs.realpathSync(process.env.ASC_TEST_CODEX);
const evidence={codex:spawnSync(process.execPath,[codex,'--version'],{encoding:'utf8'}).stdout.trim(),tmpdir:fs.realpathSync(os.tmpdir())};

const diagnostic=await probeNativeSandbox(codex);
assert.equal(diagnostic.passed,true,JSON.stringify(diagnostic.observations));
evidence.nativeDiagnostic=diagnostic.observations.negative;

// Outside /tmp, so that only the targets below lie in the shared temporaries.
const home=tempDir('asc-temp-isolation-',fs.realpathSync(os.homedir()));
const roots=[home];
try{
 const workspace=path.join(home,'workspace');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'a.txt'),'x');
 const runtime=tempDir('asc-v05-tool-');roots.push(runtime);
 const targets=POSIX_SHARED_TEMPORARIES.map(parent=>{const dir=tempDir('asc-temp-isolation-target-',parent);roots.push(dir);const file=path.join(dir,'file');fs.writeFileSync(file,'trusted',{mode:0o600});return file;});
 const probe=`const fs=require('node:fs');const out=[];for(const f of process.argv.slice(1)){try{fs.writeFileSync(f,'changed');out.push('written');}catch(e){out.push(e.code);}}fs.writeSync(1,JSON.stringify(out));`;
 const attempt=c=>{
  const r=spawnSync(c.binary,['sandbox','-P',c.profile,...c.options,'-C',c.launchDirectory,'--',c.node,'-e',probe,...targets],{env:c.env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
  assert.equal(r.status,0,r.stderr);
  const changed=targets.map(f=>fs.readFileSync(f,'utf8')!=='trusted');for(const f of targets)fs.writeFileSync(f,'trusted');
  return {sandbox:JSON.parse(r.stdout),changed};
 };
 // Remove only the shared-temporary denial, so the control shows what this check would miss without it.
 const withoutDenial=c=>({...c,options:c.options.map(v=>sharedTemporaryRoots().reduce((t,root)=>t.replace(`${JSON.stringify(root)}="deny", `,''),v))});
 for(const purpose of ['agent','verification']){
  const c=configuration({workspace,runtime,executable:codex,writable:true,purpose});
  const control=attempt(withoutDenial(c));
  assert.deepEqual(control.changed,[true,true],`negative control did not reproduce the exposure (${purpose}): ${JSON.stringify(control)}`);
  const result=attempt(c);
  assert.deepEqual(result.changed,[false,false],`${purpose}: ${JSON.stringify(result)}`);
  evidence[purpose]={control:control.sandbox,denied:result.sandbox};
 }

 // The Agent preflight passes; the runner stops before the model call.
 const logs=path.join(home,'logs');fs.mkdirSync(logs);
 const stopBeforeModel=(binary,args,options)=>{if(args[0]==='exec')throw Object.assign(Error('stopped before model'),{stopped:true});return runHostProcess(binary,args,options);};
 await assert.rejects(runAgent({workspace,logs,executable:codex,model:'not-called',prompt:'not-called'},stopBeforeModel),e=>e.stopped===true);
 const preflight=JSON.parse(fs.readFileSync(path.join(logs,'preflight.json'),'utf8'));
 assert.deepEqual(preflight.hostUnchanged.length,3,JSON.stringify(preflight));
 evidence.preflight={targets:preflight.targets.map(t=>path.dirname(path.dirname(t))),stdout:JSON.parse(preflight.stdout)};
 console.log(JSON.stringify(evidence));
}finally{for(const root of roots)fs.rmSync(root,{recursive:true,force:true});}
