#!/usr/bin/env node
/** Explicit owner-selected Codex Host. No shell or unsandboxed execution fallback. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runAgent,configuration} from '../src/restricted-agent.mjs';
import {runHostProcess} from '../src/host-process.mjs';
import {authorityCommandRootsValidator} from '../src/authority-command.mjs';
import {stageHostVerificationAssets} from '../src/host-verification-assets.mjs';
import {probeNativeSandbox} from '../src/native-probe.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--config'||!path.isAbsolute(args[1]))throw Error('Expected --config absolute owner JSON');
const config=JSON.parse(fs.readFileSync(args[1],'utf8'));
if(Object.keys(config).sort().join(',')!=='codexHome,executable'||!path.isAbsolute(config.executable)||!path.isAbsolute(config.codexHome))throw Error('Explicit executable and codexHome required');
const q=JSON.parse(fs.readFileSync(0,'utf8'));
if(q.schema!=='asc-host-execution/v1'||typeof q.id!=='string'||!['agent','verify'].includes(q.operation))throw Error('Invalid Host request');
if(!Array.isArray(q.authorityRoots)||!q.authorityRoots.length||q.authorityRoots.some(r=>typeof r!=='string'||!path.isAbsolute(r)))throw Error('Host authority roots missing');
authorityCommandRootsValidator(q.authorityRoots)([config.executable,config.codexHome,args[1]]);
const p=q.payload,workspace=fs.realpathSync(p.workspace);
const contains=(parent,child)=>{const r=path.relative(parent,child);return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
for(const file of [args[1],config.executable,config.codexHome])if(contains(workspace,fs.realpathSync(file)))throw Error('Candidate cannot own Host configuration');
if(/\.(cmd|bat)$/i.test(config.executable))throw Error('Use native executable or npm bin/codex.js');
process.env.CODEX_HOME=config.codexHome;
let result;
if(q.operation==='agent'){
 try{result=await runAgent({...p,executable:config.executable},runHostProcess);}
 catch(error){
  if(error.code!=='ASC_PROVIDER_CAPACITY')throw error;
  fs.writeSync(1,JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,error:{code:error.code}}));
  process.exitCode=1;
 }
}
else{
 if(p.contract?.verificationResourceProfile||p.contract?.verificationGit||Object.keys(p.contract?.verificationLimits??{}).some(k=>k!=='timeoutMilliseconds'))throw Error('Selected Host does not support requested asset, resource or Git contract');
 if(!Array.isArray(p.argv)||!p.argv.length||p.argv.some(v=>typeof v!=='string')||(p.timeout!==null&&(!Number.isSafeInteger(p.timeout)||p.timeout<=0||p.timeout>2147483647)))throw Error('Invalid verification request');
 const diagnostic=await probeNativeSandbox(config.executable);if(!diagnostic.passed)throw Error('Codex sandbox capability check failed');
 const runtime=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'asc-host-verify-')));
 try{
  const assets=stageHostVerificationAssets(p.contract?.verificationAssets,{workspace,runtime,authorityRoots:q.authorityRoots});
  const c=configuration({workspace,runtime,executable:config.executable,writable:true,purpose:'verification',readOnlyRoots:assets.readOnlyRoots});
  const argv=p.argv.map(value=>assets.runtimeRoot&&value.startsWith('/runtime/')?path.join(assets.runtimeRoot,value.slice(9)):value);
  const script=`const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');const argv=JSON.parse(process.argv[1]),dir=process.argv[3];const out=path.join(dir,'stdout'),err=path.join(dir,'stderr');const o=fs.openSync(out,'wx'),e=fs.openSync(err,'wx');const env={...process.env};if(process.argv[5])env.PATH=process.argv[5]+path.delimiter+(env.PATH||'');const r=spawnSync(argv[0],argv.slice(1),{cwd:process.argv[4],timeout:Number(process.argv[2]),stdio:['ignore',o,e],env});fs.closeSync(o);fs.closeSync(e);if(r.error||!Number.isInteger(r.status))throw Error('Verification could not complete: '+(r.error?.code??r.signal));if(fs.statSync(out).size+fs.statSync(err).size>4194304)throw Error('Verification output limit');fs.writeSync(1,JSON.stringify({exit:r.status,stdout:fs.readFileSync(out,'utf8'),stderr:fs.readFileSync(err,'utf8')}));`;

  const response=await runHostProcess(c.binary,['sandbox','-P',c.profile,...c.options,'-C',c.launchDirectory,'--',c.node,'-e',script,JSON.stringify(argv),String(p.timeout??0),runtime,workspace,assets.runtimeRoot??''],{env:c.env,timeout:p.timeout,input:''});
  result=JSON.parse(response.stdout);
 }finally{fs.rmSync(runtime,{recursive:true,force:true});}
}
if(result!==undefined)fs.writeSync(1,JSON.stringify({schema:q.schema,id:q.id,operation:q.operation,result}));
