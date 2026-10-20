import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {prepareFixtureRepository} from '../scripts/native-fixture-repository.mjs';
test('fixture transfer preserves base ancestry without trial branches, tags or answer objects',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-fixture-transfer-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const fixture=path.join(root,'source'),origin=path.join(root,'trial'),env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
 const command=(argv,cwd)=>execFileSync(argv[0],argv.slice(1),{cwd,env,stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim();
 command(['git','init','--quiet',fixture]);
 const git=(...a)=>command(['git',...a],fixture),commit=message=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm',message);return git('rev-parse','HEAD');};
 fs.writeFileSync(path.join(fixture,'code.txt'),'original');const ancestor=commit('original');
 fs.writeFileSync(path.join(fixture,'requirements.txt'),'revision request');const base=commit('fixture');
 git('checkout','-qb','prior-answer');fs.writeFileSync(path.join(fixture,'code.txt'),'unrelated previous trial solution');const answer=commit('answer'),blob=git('rev-parse','HEAD:code.txt');git('tag','previous-trial');
 const template=path.join(root,'host-template');fs.mkdirSync(path.join(template,'objects/info'),{recursive:true});fs.writeFileSync(path.join(template,'objects/info/alternates'),path.join(fixture,'.git/objects')+'\n');
 const hostCommand=(argv,cwd)=>command([argv[0],'-c',`init.templateDir=${template}`,...argv.slice(1)],cwd);
 prepareFixtureRepository({fixture,origin,base,remote:'https://example.invalid/synthetic.git',command:hostCommand});
 assert.equal(command(['git','rev-parse','HEAD'],origin),base);assert.equal(command(['git','show',ancestor+':code.txt'],origin),'original');
 assert.equal(command(['git','for-each-ref'],origin),'');assert.equal(command(['git','remote','get-url','origin'],origin),'https://example.invalid/synthetic.git');
 for(const object of [answer,blob])assert.throws(()=>command(['git','cat-file','-e',object],origin));
 assert.throws(()=>prepareFixtureRepository({fixture,origin:path.join(root,'bad'),base:'prior-answer',remote:'x',command}),/Pinned fixture/);
});
