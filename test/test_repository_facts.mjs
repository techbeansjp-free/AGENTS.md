import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
import {recordFact,contradictFact,listFacts,startFacts,FACT_KINDS} from '../src/repository-facts.mjs';
import {startWorktree} from '../src/worktree-execution.mjs';

// #1722: one clone with two dedicated worktrees, as worktree-create makes them.
function clone(t){
 const root=tempDir('asc-facts-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),git=(...a)=>execFileSync('git',a,{cwd:repo,stdio:'ignore'});
 fs.mkdirSync(repo);git('init','-q');git('-c','user.name=t','-c','user.email=t@example.invalid','commit','-q','--allow-empty','-m','init');
 const one=path.join(root,'one'),two=path.join(root,'two');git('worktree','add','-q',one,'-b','one');git('worktree','add','-q',two,'-b','two');
 return {root,repo,one,two};
}
const NPM={id:'npm-ci-first',kind:'setup',text:'New worktrees have no node_modules; run npm ci before npm run quality'};

test('a fact is shown at start only after work in two worktrees confirmed it, and the same worktree counts once',t=>{
 const {one,two}=clone(t);
 assert.equal(recordFact(one,NPM).state,'candidate');assert.equal(recordFact(one,NPM).places,1,'a second record in the same worktree is not a second confirmation');
 assert.deepEqual(startWorktree(one).facts.confirmed,[]);assert.equal(startWorktree(one).facts.candidates,1);
 assert.equal(recordFact(two,NPM).state,'confirmed');
 // Both worktrees share the store, so the second start of the work sees the first one's fact.
 for(const place of [one,two])assert.deepEqual(startWorktree(place).facts.confirmed,[{id:NPM.id,kind:NPM.kind,text:NPM.text}]);
 assert.match(startWorktree(one).facts.authority,/not project rules/);
});

test('a contradiction hides the fact until two worktrees confirm it again',t=>{
 const {one,two}=clone(t);recordFact(one,NPM);recordFact(two,NPM);
 assert.equal(contradictFact(two,{id:NPM.id,note:'npm ci is now part of quality'}).state,'contradicted');
 assert.deepEqual(startFacts(one).confirmed,[]);
 assert.equal(recordFact(one,NPM).state,'candidate','observations before the contradiction no longer count');
 assert.equal(recordFact(two,NPM).state,'confirmed');
 assert.throws(()=>contradictFact(one,{id:'unknown-fact'}),/No repository fact/);
});

test('only environment and procedure kinds are accepted; specification and business decisions stay with the owner',t=>{
 const {one}=clone(t);
 assert.deepEqual(FACT_KINDS,['command','setup','artifact-location','environment-variable']);
 for(const kind of ['spec','specification','business','rule','quality','policy',undefined])assert.throws(()=>recordFact(one,{...NPM,kind}),/kind must be one of .*owner/,String(kind));
 assert.deepEqual(listFacts(one).facts,[]);
});

test('credential-like values and environment variable values are refused, not stored masked',t=>{
 const {one}=clone(t);
 for(const text of ['use token=abcdefghijklmnop','clone https://user:pass@example.com/repo.git','export ghp_abcdefghijklmnopqrstuvwxyz0123','password: hunter22','Authorization: Bearer abcdefghijklmnop'])
  assert.throws(()=>recordFact(one,{id:'secret',kind:'command',text}),/credential or secret/,text);
 for(const text of ['API_URL=https://example.com','=value','1BAD is not a name'])assert.throws(()=>recordFact(one,{id:'env',kind:'environment-variable',text}),/environment-variable fact|credential/,text);
 assert.equal(recordFact(one,{id:'env',kind:'environment-variable',text:'DATABASE_URL must be set for npm test'}).state,'candidate');
 assert.deepEqual(listFacts(one).facts.map(f=>f.id),['env']);
});

test('ids, text shape and conflicting text are checked; a changed fact needs a contradiction and a new id',t=>{
 const {one}=clone(t);
 for(const id of ['','Upper','has space','../x','a'.repeat(64)])assert.throws(()=>recordFact(one,{...NPM,id}),/Fact id/,id);
 for(const text of ['','  ','two\nlines','x'.repeat(301)])assert.throws(()=>recordFact(one,{...NPM,text}),/one line/,JSON.stringify(text));
 recordFact(one,NPM);assert.throws(()=>recordFact(one,{...NPM,text:'npm install works too'}),/already says something else/);
});

test('the store is shared in the Git common directory, never inside a worktree or committed',t=>{
 const {repo,one}=clone(t);recordFact(one,NPM);
 const store=listFacts(one).store;assert.equal(fs.realpathSync(store),fs.realpathSync(path.join(repo,'.git/agent-skill-chain/repository-facts.json')));
 assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:one,encoding:'utf8'}),'');
 assert(!fs.existsSync(store+'.lock'),'the lock is released');
 const stored=JSON.parse(fs.readFileSync(store,'utf8'));assert.equal(stored.schema,'asc-repository-facts/v1');
 // Another writer's lock is reported, not removed.
 fs.writeFileSync(store+'.lock','');
 assert.throws(()=>recordFact(one,{...NPM,id:'other'}),/locked by another writer/);assert(fs.existsSync(store+'.lock'));
});

test('directories outside Git have no store and start reports that facts are unavailable',t=>{
 const root=tempDir('asc-facts-nongit-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'app.js'),'x');
 assert.equal(startWorktree(root).facts.available,false);assert.deepEqual(listFacts(root).facts,[]);
 assert.throws(()=>recordFact(root,NPM),/Git repository/);assert.deepEqual(fs.readdirSync(root),['app.js']);
});

test('the CLI records, contradicts and lists facts, and rejects unknown options',t=>{
 const {one,two}=clone(t),cli=path.resolve('bin/asc-v05.mjs');
 const run=(...a)=>spawnSync(process.execPath,[cli,...a],{encoding:'utf8'});
 for(const place of [one,two]){const r=run('fact-record',place,'--id',NPM.id,'--kind',NPM.kind,'--text',NPM.text);assert.equal(r.status,0,r.stderr);}
 assert.equal(JSON.parse(run('fact-list',one).stdout).facts[0].state,'confirmed');
 assert.equal(JSON.parse(run('fact-contradict',one,'--id',NPM.id,'--note','changed').stdout).state,'contradicted');
 for(const bad of [['fact-record',one,'--id','x','--kind','setup','--text','a','--id','y'],['fact-record',one,'--force','x'],['fact-contradict',one,'--text','x']])assert.notEqual(run(...bad).status,0,bad.join(' '));
 assert.ok(JSON.parse(run('capabilities').stdout).commands.includes('fact-record'));
});
