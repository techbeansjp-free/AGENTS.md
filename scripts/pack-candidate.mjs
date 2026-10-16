/** Build an unpublished canonical-name candidate from npm's explicit file inventory. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const output=process.argv[2], versionOption=process.argv[3];
if(![3,4].includes(process.argv.length)||!path.isAbsolute(output??'')||(versionOption!==undefined&&!/^--version=0\.5\.(?:0|[1-9][0-9]*)$/.test(versionOption)))throw Error('Usage: node scripts/pack-candidate.mjs <absolute-existing-output-directory> [--version=0.5.N]');
const candidateVersion=versionOption?.slice('--version='.length);
const destination=fs.realpathSync(output),root=process.cwd(),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'asc-release-pack-'));
const npm=process.env.npm_execpath||path.resolve(path.dirname(process.execPath),process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'../lib/node_modules/npm/bin/npm-cli.js');
const run=(args,cwd)=>execFileSync(process.execPath,[npm,...args],{cwd,encoding:'utf8',timeout:120000,maxBuffer:8e6,stdio:['ignore','pipe','pipe']});
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
 const listing=JSON.parse(run(['pack','--dry-run','--ignore-scripts','--json'],root))[0];
 const sourceFiles={};
 for(const entry of listing.files){
  const name=entry.path;if(path.isAbsolute(name)||name.split('/').some(p=>p==='..'||p==='.'||!p))throw Error('Unsafe package path');
  const source=path.join(root,name),stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsupported package input');
  const bytes=fs.readFileSync(source);sourceFiles[name]=hash(bytes);const target=path.join(temporary,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{mode:stat.mode&0o777,flag:'wx'});
 }
 const manifestPath=path.join(temporary,'package.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));
 const sourceManifestSha256=sourceFiles['package.json'];delete sourceFiles['package.json'];
 const entry='bin/asc-v05.mjs';
 if(!Object.hasOwn(sourceFiles,entry))throw Error('Candidate CLI missing from package inventory');
 manifest.name='agent-skill-chain';manifest.private=true;manifest.bin={'agent-skill-chain':entry,'asc-v05':entry};
 // Distribution is a candidate, never evidence of release approval.
 if(!/^0\.5\.\d+-[a-z0-9.-]+$/.test(manifest.version))throw Error('Explicit v0.5 prerelease source required');
 if(candidateVersion)manifest.version=candidateVersion;
 const transformedManifests={};
 delete manifest.scripts;
 manifest.files=[...Object.keys(transformedManifests),...Object.keys(sourceFiles).filter(p=>p!=='package.json'),'release-identity.json'];
 fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(temporary,'release-identity.json'),JSON.stringify({schema:'asc-candidate-identity/v2',status:'unapproved-candidate',sourceManifestSha256,sourceFiles,transformedManifests,distributionManifestSha256:hash(fs.readFileSync(manifestPath)),published:false},null,2)+'\n');
 const filename=`agent-skill-chain-${manifest.version}.tgz`;
 if(fs.existsSync(path.join(destination,filename)))throw Error('Candidate output already exists');
 const packed=JSON.parse(run(['pack','--ignore-scripts','--json','--pack-destination',temporary],temporary))[0];
 const bytes=fs.readFileSync(path.join(temporary,packed.filename));fs.writeFileSync(path.join(destination,packed.filename),bytes,{flag:'wx'});
 console.log(JSON.stringify({file:path.join(destination,packed.filename),sha256:hash(bytes),name:manifest.name,version:manifest.version,publishAuthorized:false},null,2));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
