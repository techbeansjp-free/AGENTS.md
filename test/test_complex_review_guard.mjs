import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('failed or missing integration oracle never starts acceptance reviewer',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-review-guard-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
 const git=(...a)=>execFileSync('git',a,{cwd:repo,env,encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('commit','-qm','base','--allow-empty');const base=git('rev-parse','HEAD');git('commit','-qm','integration','--allow-empty');const head=git('rev-parse','HEAD');
 fs.writeFileSync(path.join(root,'SKILL.md'),'fixture');fs.mkdirSync(path.join(root,'variant-logs'));
 const setup=path.join(root,'setup.json');fs.writeFileSync(setup,JSON.stringify({root,skillSha256:createHash('sha256').update('fixture').digest('hex'),cases:[{strategy:'variant',base,worktrees:{integration:{repo}}}]}));
 for(const oracleStatus of [1,null,undefined]){
  fs.writeFileSync(path.join(root,'variant-logs/integration.json'),JSON.stringify({integrationHead:head,oracleStatus}));
  const p=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/review-complex-context.mjs',import.meta.url)),setup,'variant',process.execPath],{env,encoding:'utf8'});
  assert.notEqual(p.status,0);assert.match(p.stderr,/Integration target is missing or stale/);assert.equal(fs.existsSync(path.join(root,'variant-review')),false);
 }
});
