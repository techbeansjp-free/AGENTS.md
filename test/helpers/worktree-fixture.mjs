import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
export function worktreeFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-native-worktree-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),work=path.join(root,'work');fs.mkdirSync(repo);
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
 git(repo,'init','-q');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'.gitignore'),'node_modules/\nbuild/\n');fs.writeFileSync(path.join(repo,'feature.cjs'),'module.exports=41;');git(repo,'add','.');git(repo,'commit','-qm','base');const base=git(repo,'rev-parse','HEAD');
 git(repo,'worktree','add','-qb','feature',work);fs.writeFileSync(path.join(work,'feature.cjs'),'module.exports=42;');git(work,'commit','-qam','change');
 const owner=path.join(root,'owner.json'),contract={intent:'Return 42',allowedPaths:['feature.cjs'],commands:[[process.execPath,'-e',"require('assert').equal(require('./feature.cjs'),42)"]]};
 const save=()=>fs.writeFileSync(owner,JSON.stringify(contract));save();return {root,repo,work,base,owner,contract,save,git};
}
