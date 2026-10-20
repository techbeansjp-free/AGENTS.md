/** Synthetic evaluator only: observe real project commands without requiring an optional product CLI. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
export function observeProjectVerification({repo,base,owner}){
 const bytes=fs.readFileSync(owner),contract=JSON.parse(bytes);
 if(!Array.isArray(contract.commands)||!contract.commands.length||contract.commands.some(a=>!Array.isArray(a)||!a.length||a.some(v=>typeof v!=='string'||!v||v.includes('\0'))))throw Error('Explicit project commands required');
 const env={...process.env};for(const key of Object.keys(env))if(/^GIT_/i.test(key))delete env[key];
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{env,stdio:['ignore','pipe','pipe'],encoding:'utf8',maxBuffer:16*1024*1024}).trim();
 const head=git('rev-parse','HEAD'),resolvedBase=git('rev-parse','--verify',base+'^{commit}');
 const before=git('status','--porcelain=v1','--untracked-files=all'),diff=git('diff','--no-ext-diff','--no-textconv','--binary','HEAD','--');
 const results=[];
 for(const argv of contract.commands){
  const p=spawnSync(argv[0],argv.slice(1),{cwd:repo,env:process.env,stdio:['ignore','pipe','pipe'],encoding:'buffer',maxBuffer:16*1024*1024});
  results.push({argv:[...argv],exit:p.status,error:p.error?.code??null,signal:p.signal??null,stdoutSha256:hash(p.stdout??Buffer.alloc(0)),stderrSha256:hash(p.stderr??Buffer.alloc(0))});
  if(git('rev-parse','HEAD')!==head||git('status','--porcelain=v1','--untracked-files=all')!==before||git('diff','--no-ext-diff','--no-textconv','--binary','HEAD','--')!==diff||!fs.readFileSync(owner).equals(bytes))throw Error('Verification target or owner changed');
  if(p.error||p.signal||p.status!==0)break;
 }
 return {schema:'asc-evaluation-project-tests/v1',repo:fs.realpathSync(repo),base:resolvedBase,head,contractSha256:hash(bytes),passed:results.length===contract.commands.length&&results.every(r=>r.exit===0&&!r.error&&!r.signal),results,scope:'Command observation only; scope, source integrity, project contracts and independent review require separate checks. Existing dirty state is not approved.'};
}
function hash(bytes){return createHash('sha256').update(bytes).digest('hex');}
