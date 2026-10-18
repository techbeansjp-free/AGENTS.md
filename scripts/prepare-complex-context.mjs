/** Prepare synthetic-only Git worktrees; no model calls or remote operations. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const source=fileURLToPath(new URL('../test/fixtures/complex-issues/',import.meta.url));
const cli=fs.realpathSync(process.argv[2]);
const root=fs.mkdtempSync('/var/tmp/asc-complex-context-');
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
const git=(cwd,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,env,encoding:'utf8'}).trim();
const cases=[];
for(const strategy of ['single','coordinated']){
 const origin=path.join(root,strategy);fs.mkdirSync(origin);fs.cpSync(source,origin,{recursive:true});
 fs.writeFileSync(path.join(origin,'.gitignore'),'.worktrees/\n.evaluation/\n');
 git(origin,'init','-q','-b','develop');git(origin,'config','user.name','Synthetic evaluation');git(origin,'config','user.email','evaluation@example.invalid');
 git(origin,'add','.');git(origin,'commit','-qm','Synthetic complex issue starting point');
 const base=git(origin,'rev-parse','HEAD');
 const worktrees={};
 for(const [role,issue,type,slug] of [['reservation','9001','feature','reservation'],['billing','9002','feature','billing'],['integration','9000','test','integration']]){
  const result=JSON.parse(execFileSync(process.execPath,[cli,'worktree-create',origin,issue,type,slug,'develop'],{env,encoding:'utf8'}));
  worktrees[role]=result;
 }
 cases.push({strategy,origin,base,worktrees});
}
const skill=fs.readFileSync(fileURLToPath(new URL('../skills/asc/SKILL.md',import.meta.url)));
fs.writeFileSync(path.join(root,'SKILL.md'),skill);
const contract=fs.readFileSync(path.join(source,'REQUIREMENTS.md'));
const result={root,cli,skillSha256:createHash('sha256').update(skill).digest('hex'),contractSha256:createHash('sha256').update(contract).digest('hex'),cases,modelsRun:false};
fs.writeFileSync(path.join(root,'setup.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
