/** Inside the disposable Linux consumer namespace, with owner-selected tools. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const run=(command,args,cwd='/work')=>execFileSync(command,args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024});
const node=args=>run(process.execPath,args),git=(cwd,...args)=>run('git',args,cwd).trim();
const npm='/runtime/lib/node_modules/npm/bin/npm-cli.js';
const tarball=fs.readdirSync('/work').find(n=>n.endsWith('.tgz'));
node([npm,'install','--prefix','/work/bootstrap','--offline','--ignore-scripts','--no-audit','--no-fund','/work/'+tarball]);
const cli='/work/bootstrap/node_modules/agent-skill-chain/bin/asc-v05.mjs';
fs.mkdirSync('/work/origin');git('/work/origin','init','-q','-b','develop');git('/work/origin','config','user.name','Synthetic');git('/work/origin','config','user.email','synthetic@example.invalid');
fs.copyFileSync('/fixture/REQUIREMENTS.md','/work/origin/REQUIREMENTS.md');git('/work/origin','add','.');git('/work/origin','commit','-qm','owner acceptance');
git('/work/origin','worktree','add','-b','feature/user-management','/work/application');
node([cli,'project-assets','/work/application','--register-skill','--apply']);git('/work/application','add','.');git('/work/application','commit','-qm','install ASC distribution');
const base=git('/work/application','rev-parse','HEAD'),launcher='/work/application/.agent-skill-chain/bin/asc.mjs';
const start=JSON.parse(node([launcher,'start','/work/application','--path','server.mjs','--path','page.html']));assert.equal(start.providerLaunch,false);
// Parent Host authored these candidate files; this runner does not invoke a model.
for(const name of ['server.mjs','page.html'])fs.copyFileSync('/fixture/'+name,'/work/application/'+name);
git('/work/application','add','server.mjs','page.html');git('/work/application','commit','-qm','implement synthetic user-management journey');
const head=git('/work/application','rev-parse','HEAD');
fs.writeFileSync('/work/owner.json',JSON.stringify({intent:'Fulfil REQUIREMENTS.md user-management journey',allowedPaths:['server.mjs','page.html'],commands:[[process.execPath,'/fixture/browser.mjs','/work/application']]}));
const verified=JSON.parse(node([launcher,'worktree-verify','/work/application',base,'/work/owner.json']));assert.equal(verified.passed,true);assert.equal(verified.head,head);assert.equal(verified.deliveryAuthorized,false);
fs.writeFileSync('/work/consumer-verification.json',JSON.stringify({base,head,start,verified,modelExecutionInRunner:false},null,2));
