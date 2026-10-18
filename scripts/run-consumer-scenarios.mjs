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
const published=process.argv[2];
if(published){
 if(!path.isAbsolute(published))throw Error('Published tarball path must be absolute');
 const pkg=JSON.parse(execFileSync('tar',['-xOf',published,'package/package.json'],{encoding:'utf8'}));
 if(pkg.name!=='agent-skill-chain'||!/^0\.5\.\d+$/.test(pkg.version))throw Error('Expected published ASC v0.5 package');
 const file=path.join(root,'packages',`agent-skill-chain-${pkg.version}.tgz`);fs.copyFileSync(published,file);
 packages.push({file,version:pkg.version,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),input:'supplied-artifact'});
}
for(const version of published?['0.5.900-alpha.1']:['0.5.900-alpha.0','0.5.900-alpha.1']){
 packages.push(JSON.parse(execFileSync(process.execPath,['scripts/pack-candidate.mjs',path.join(root,'packages'),`--version=${version}`],{cwd:source,encoding:'utf8'})));
}
fs.writeFileSync(path.join(root,'input-versions.json'),JSON.stringify(packages.map(p=>p.version)));
fs.copyFileSync(path.join(source,'scripts/consumer-scenarios.mjs'),path.join(root,'consumer-scenarios.mjs'));
const tooling=[];if(process.argv[3]){
 fs.mkdirSync(path.join(root,'tooling'));
 const pins=JSON.parse(fs.readFileSync(new URL('./consumer-tooling.json',import.meta.url)));
 for(const [name,pin] of Object.entries(pins)){
  const input=path.join(process.argv[3],name),bytes=fs.readFileSync(input),sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256!==pin.sha256)throw Error('Tooling digest mismatch: '+name);
  const manifest=JSON.parse(execFileSync('tar',['-xOf',input,'package/package.json'],{encoding:'utf8'}));
  if(manifest.name!==pin.name||manifest.version!==pin.version)throw Error('Tooling package identity mismatch: '+name);
  fs.writeFileSync(path.join(root,'tooling',name),bytes);tooling.push({file:name,...pin});
 }
}
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
fs.writeFileSync(path.join(root,'provenance.json'),JSON.stringify({scenarioSha256,sourceIdentities,tooling,sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),packages,seconds:(Date.now()-started)/1000,status:result.status,error:result.error?.message??null,network:'unshared',home:'empty',sourceMounted:false,credentialsProvided:false,syntheticVersions:!published,publishedInput:published??null},null,2));
console.log(JSON.stringify({root,status:result.status,results:fs.existsSync(path.join(root,'results.json'))?JSON.parse(fs.readFileSync(path.join(root,'results.json'))):null},null,2));
process.exitCode=result.status===0&&!result.error?0:1;
