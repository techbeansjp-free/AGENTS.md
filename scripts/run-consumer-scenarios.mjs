/** Linux acceptance driver: only generated packages/data enter the sandbox. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('..',import.meta.url));
if(process.platform!=='linux')throw Error('This acceptance driver requires Linux bubblewrap; other OS results are not implied');
const root=fs.mkdtempSync('/var/tmp/asc-consumer-acceptance-');
fs.mkdirSync(path.join(root,'packages'));
const packages=[];
for(const version of ['0.5.900-alpha.0','0.5.900-alpha.1']){
 packages.push(JSON.parse(execFileSync(process.execPath,['scripts/pack-candidate.mjs',path.join(root,'packages'),`--version=${version}`],{cwd:source,encoding:'utf8'})));
}
fs.copyFileSync(path.join(source,'scripts/consumer-scenarios.mjs'),path.join(root,'consumer-scenarios.mjs'));
const runtime=path.dirname(path.dirname(fs.realpathSync(process.execPath)));
const args=['--unshare-all','--die-with-parent','--new-session'];
for(const dir of ['/usr','/bin','/lib','/lib64'])if(fs.existsSync(dir))args.push('--ro-bind',dir,dir);
args.push('--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/home','--dir','/home/consumer',
 '--ro-bind',runtime,'/runtime','--bind',root,'/work','--clearenv',
 '--setenv','HOME','/home/consumer','--setenv','PATH','/runtime/bin:/usr/bin:/bin',
 '--setenv','TMPDIR','/tmp','--setenv','LANG','C.UTF-8','--chdir','/work',
 '/runtime/bin/node','/work/consumer-scenarios.mjs');
const scenarioSha256=createHash('sha256').update(fs.readFileSync(path.join(root,'consumer-scenarios.mjs'))).digest('hex');
const sourceIdentities=packages.map(p=>JSON.parse(execFileSync('tar',['-xOf',p.file,'package/release-identity.json'],{encoding:'utf8'})));
const started=Date.now(),result=spawnSync('/usr/bin/bwrap',args,{encoding:'utf8',maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(root,'run.log'),(result.stdout??'')+(result.stderr??''));
fs.writeFileSync(path.join(root,'provenance.json'),JSON.stringify({scenarioSha256,sourceIdentities,sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),packages,seconds:(Date.now()-started)/1000,status:result.status,error:result.error?.message??null,network:'unshared',home:'empty',sourceMounted:false,credentialsProvided:false,syntheticVersions:true},null,2));
console.log(JSON.stringify({root,status:result.status,results:fs.existsSync(path.join(root,'results.json'))?JSON.parse(fs.readFileSync(path.join(root,'results.json'))):null},null,2));
process.exitCode=result.status===0&&!result.error?0:1;
