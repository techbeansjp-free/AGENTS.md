/** Commit/integrate only synthetic assigned service files, then run the fixed oracle. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const setup=JSON.parse(fs.readFileSync(process.argv[2])),strategy=process.argv[3];
const item=setup.cases.find(c=>c.strategy===strategy);if(!item)throw Error('Unknown strategy');
const file=path.join(setup.root,strategy+'-logs/integration.json');if(fs.existsSync(file))throw Error('Integration already recorded; do not overwrite evidence');
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
const git=(cwd,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,env,encoding:'utf8'}).trim();
const commits={};
for(const role of ['reservation','billing']){
 const w=item.worktrees[role].repo;git(w,'add',role+'/service.mjs');
 if(git(w,'diff','--cached','--name-only')!==role+'/service.mjs')throw Error('Unexpected staged scope');
 git(w,'commit','-qm','Implement synthetic '+role);commits[role]=git(w,'rev-parse','HEAD');
}
const w=item.worktrees.integration.repo;
for(const commit of Object.values(commits))git(w,'cherry-pick',commit);
const p=spawnSync(process.execPath,[path.join(w,'oracle/integration.mjs'),w],{env,encoding:'utf8'});
fs.writeFileSync(path.join(setup.root,strategy+'-logs/integration.oracle.log'),(p.stdout??'')+(p.stderr??''));
fs.writeFileSync(file,JSON.stringify({commits,integrationHead:git(w,'rev-parse','HEAD'),oracleStatus:p.status},null,2)+'\n');
if(p.status!==0)throw Error('Integration oracle failed');
