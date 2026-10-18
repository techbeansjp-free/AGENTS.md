/** Prepare the subsequent shared-contract revision after coordinated integration. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const setupPath=process.argv[2],setup=JSON.parse(fs.readFileSync(setupPath));
if(setup.cases.some(c=>c.strategy==='revision'))throw Error('Revision already prepared; reuse existing worktrees');
const previous=setup.cases.find(c=>c.strategy==='coordinated');
const proof=JSON.parse(fs.readFileSync(path.join(setup.root,'coordinated-logs/integration.json')));
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:previous.worktrees.integration.repo,env,encoding:'utf8'}).trim();
if(head!==proof.integrationHead||head===previous.base||proof.oracleStatus!==0)throw Error('Successful integration required');
const source=fileURLToPath(new URL('../test/fixtures/complex-issues/',import.meta.url));
const item={strategy:'revision',origin:previous.origin,base:head,worktrees:{}};
for(const [role,issue] of [['reservation',9003],['billing',9004],['integration',9005]]){
 const result=JSON.parse(execFileSync(process.execPath,[setup.cli,'worktree-create',previous.origin,String(issue),'feature','currency-'+role,previous.worktrees.integration.branch],{env,encoding:'utf8'}));
 item.worktrees[role]=result;
 fs.copyFileSync(path.join(source,'REVISION.md'),path.join(result.repo,'REVISION.md'));
 fs.copyFileSync(path.join(source,'oracle/revision.mjs'),path.join(result.repo,'oracle/revision.mjs'));
 for(const name of ['reservation','billing']){
  const oracle=fs.readFileSync(path.join(source,'oracle',name+'.mjs'),'utf8').replace("amountCents:50,status:'reserved',version:1","amountCents:50,currency:'JPY',status:'reserved',version:1");
  fs.writeFileSync(path.join(result.repo,'oracle',name+'.mjs'),oracle);
 }
}
setup.cases.push(item);fs.writeFileSync(setupPath,JSON.stringify(setup,null,2)+'\n');console.log(JSON.stringify(item,null,2));
