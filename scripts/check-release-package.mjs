/** Install the exact artifact offline and bind its manifest and CLI version. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {releaseVersion,digest} from './release.mjs';
const [tarball,version]=process.argv.slice(2);releaseVersion(version);
const artifact=path.resolve(tarball),before=digest(fs.readFileSync(artifact));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'asc-release-install-'));
const npm=process.env.npm_execpath||path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
try{
 execFileSync(process.execPath,[npm,'install','--prefix',directory,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact],{stdio:'pipe'});
 const root=path.join(directory,'node_modules/agent-skill-chain'),manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
 assert.equal(manifest.version,version);
 for(const command of ['agent-skill-chain','asc-v05'])assert.equal(execFileSync(process.execPath,[path.join(root,manifest.bin[command]),'--version'],{encoding:'utf8',cwd:directory}).trim(),version);
 const identity=JSON.parse(fs.readFileSync(path.join(root,'release-identity.json')));
 assert.equal(digest(fs.readFileSync(path.join(root,'package.json'))),identity.distributionManifestSha256);
 assert.equal(digest(fs.readFileSync(artifact)),before);
 console.log(JSON.stringify({version,sha256:before,installed:true}));
}finally{fs.rmSync(directory,{recursive:true,force:true});}
