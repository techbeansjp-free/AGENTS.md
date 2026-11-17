import {tempDir} from './helpers/temp-dir.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
import {recordFact,contradictFact,listFacts,FACT_KINDS} from '../src/repository-facts.mjs';
import {startWorktree} from '../src/worktree-execution.mjs';

// #1722: one clone with dedicated worktrees, as worktree-create makes them.
function clone(t){
 const root=tempDir('asc-facts-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),git=(...a)=>execFileSync('git',a,{cwd:repo,stdio:'ignore'});
 fs.mkdirSync(repo);git('init','-q');git('-c','user.name=t','-c','user.email=t@example.invalid','commit','-q','--allow-empty','-m','init');
 const work=name=>{const place=path.join(root,name);git('worktree','add','-q',place,'-b',name);return place;};
 return {root,repo,one:work('one'),two:work('two'),work};
}
const posix={skip:process.platform==='win32'};
const NPM={id:'npm-ci-first',kind:'setup',text:'New worktrees have no node_modules; run npm ci before npm run quality'};
const shown=place=>startWorktree(place).facts.shown;

test('the second work sees a fact the first work recorded, at its very first start',t=>{
 const {one,work}=clone(t);
 assert.deepEqual(shown(one),[]);
 // The first work hit the missing node_modules repeatedly, ran npm ci, succeeded, and recorded it.
 assert.equal(recordFact(one,NPM).state,'shown');
 // The second work is created afterwards; its first command is start, before it records anything.
 const two=work('second');
 assert.deepEqual(shown(two),[{id:NPM.id,kind:NPM.kind,text:NPM.text}]);
 assert.match(startWorktree(two).facts.authority,/not project rules/);assert.match(startWorktree(two).facts.authority,/fact-list/);
});

test('a contradiction hides the fact until work records it again; recording again in the same worktree adds no observation',t=>{
 const {one,two}=clone(t);recordFact(one,NPM);
 recordFact(one,NPM);assert.equal(listFacts(one).facts.length,1);
 const stored=()=>JSON.parse(fs.readFileSync(listFacts(one).store,'utf8')).facts[0];
 assert.equal(stored().observations.length,1,'repeating it in the same worktree adds no observation');
 assert.equal(contradictFact(two,{id:NPM.id,note:'npm ci is now part of quality'}).state,'contradicted');
 assert.deepEqual(shown(one),[]);assert.equal(listFacts(one).facts[0].lastContradiction,'npm ci is now part of quality');
 assert.equal(recordFact(one,NPM).state,'shown');assert.equal(shown(two).length,1);
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
 for(const text of ['use token=abcdefghijklmnop','npm test --password="dummy-sensitive-value"','run with --api-key abc123','set API_KEY: abc','clone https://user:pass@example.com/repo.git',
  'export ghp_abcdefghijklmnopqrstuvwxyz0123','write {"password":"dummy-sensitive-value"} to config','PGPASSWORD=hunter2 psql -h localhost -U app','SECRET_KEY_BASE=abc123 bin/rails test','GHTOKEN=abc npm run release','PASSPHRASE=x make','npm config set //registry.npmjs.org/:_authToken=npm_abcdef','export dbPassword=x',"set 'api_key': 'x'",'password: hunter22','Authorization: Bearer abcdefghijklmnop','header eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.x','-----BEGIN RSA PRIVATE KEY-----'])
  assert.throws(()=>recordFact(one,{id:'secret',kind:'command',text}),/credential or secret/,text);
 recordFact(one,NPM);assert.throws(()=>contradictFact(one,{id:NPM.id,note:'password=abc'}),/credential or secret/);
 for(const text of ['use the bypass: flag','compass=north is set by setup','NODE_ENV=test npm test'])assert.equal(recordFact(one,{id:'plain-'+text.length,kind:'command',text}).state,'shown',text);
 for(const text of ['API_URL=https://example.com','=value','1BAD is not a name'])assert.throws(()=>recordFact(one,{id:'env',kind:'environment-variable',text}),/environment-variable fact|credential/,text);
 assert.equal(recordFact(one,{id:'env',kind:'environment-variable',text:'DATABASE_URL must be set for npm test'}).state,'shown');
 assert.deepEqual(listFacts(one).facts.map(f=>f.id).sort(),['env',NPM.id,'plain-20','plain-29','plain-22'].sort());
});

test('ids, text shape and conflicting text are checked; the conflict names the existing fact',t=>{
 const {one}=clone(t);
 for(const id of ['','Upper','has space','../x','a'.repeat(64)])assert.throws(()=>recordFact(one,{...NPM,id}),/Fact id/,id);
 for(const text of ['','  ','two\nlines','x'.repeat(301)])assert.throws(()=>recordFact(one,{...NPM,text}),/one line/,JSON.stringify(text));
 recordFact(one,NPM);assert.throws(()=>recordFact(one,{...NPM,text:'npm install works too'}),new RegExp(`already says \\(setup\\) "${NPM.text}"`));
 assert.throws(()=>recordFact(one,{...NPM,id:'npm-ci-again'}),/already recorded as npm-ci-first/);
 for(const text of ['line\u2028break','c1\u0085control'])assert.throws(()=>recordFact(one,{...NPM,id:'x',text}),/one line/);
});

test('the store is shared in the Git common directory, never inside a worktree or committed, and a held lock names its writer',t=>{
 const {repo,one}=clone(t);recordFact(one,NPM);
 const store=listFacts(one).store;assert.equal(fs.realpathSync(store),fs.realpathSync(path.join(repo,'.git/agent-skill-chain/repository-facts.json')));
 assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:one,encoding:'utf8'}),'');
 assert(!fs.existsSync(store+'.lock'),'the lock is released');
 fs.writeFileSync(store+'.lock','{}');
 assert.throws(()=>recordFact(one,{...NPM,id:'other'}),/locked by another writer/);assert(fs.existsSync(store+'.lock'),'another writer\'s lock is not removed');
 // Fields that are not a lock's own shape are not echoed either.
 for(const lock of [{pid:1,startedAt:'password=dummy-sensitive-value',place:'/x'},{pid:1,startedAt:'2026-11-17T00:00:00.000Z',place:'/tmp/PGPASSWORD=dummy-sensitive-value'},{pid:1,startedAt:'2026-11-17T00:00:00.000Z',place:'/tmp/SECRET_KEY_BASE=dummy-sensitive-value'},{pid:1,startedAt:'2026-11-17T00:00:00.000Z',place:'/x\ninjected'},{pid:-1,startedAt:'2026-11-17T00:00:00.000Z',place:'/x'},{pid:1,startedAt:'2026-11-17T00:00:00.000Z',place:'relative'}]){
  fs.writeFileSync(store+'.lock',JSON.stringify(lock));
  assert.throws(()=>recordFact(one,{...NPM,id:'other'}),e=>/unknown writer/.test(e.message)&&!/dummy-sensitive|injected/.test(e.message),JSON.stringify(lock));
 }
 fs.writeFileSync(store+'.lock',JSON.stringify({pid:4242,startedAt:'2026-11-17T00:00:00.000Z',place:'/elsewhere'}));
 assert.throws(()=>recordFact(one,{...NPM,id:'other'}),/locked by another writer \(pid 4242, started 2026-11-17T00:00:00.000Z, worktree \/elsewhere\)/);
 // A lock that is a link to another file is not read into the message.
 const secret=path.join(repo,'..','secret.txt');fs.writeFileSync(secret,'TOP-SECRET-CONTENT');fs.rmSync(store+'.lock');fs.symlinkSync(secret,store+'.lock');
 assert.throws(()=>recordFact(one,{...NPM,id:'other'}),e=>/unknown writer/.test(e.message)&&!/TOP-SECRET/.test(e.message));
});

test('links in the store path are refused, and a temporary file is never written through',t=>{
 const {repo,one}=clone(t),directory=path.join(repo,'.git/agent-skill-chain'),outside=path.join(repo,'..','outside.json');
 fs.mkdirSync(directory);fs.writeFileSync(outside,'keep');
 fs.symlinkSync(outside,path.join(directory,'repository-facts.json'));
 assert.throws(()=>recordFact(one,NPM),/symbolic link/);assert.equal(fs.readFileSync(outside,'utf8'),'keep');
 assert.equal(startWorktree(one).facts.available,false,'start reports it and still succeeds');
 fs.unlinkSync(path.join(directory,'repository-facts.json'));
 // A pre-placed link at a temporary name is not followed: the exclusive create fails instead.
 fs.symlinkSync(outside,path.join(directory,`repository-facts.json.${process.pid}.tmp`));
 assert.throws(()=>recordFact(one,NPM),/temporary repository facts file already exists/);assert.equal(fs.readFileSync(outside,'utf8'),'keep');
 fs.rmSync(directory,{recursive:true});fs.symlinkSync(path.dirname(outside),directory);
 assert.throws(()=>recordFact(one,NPM),/symbolic link/);
});

test('a damaged store never stops start, but recording into it is refused',t=>{
 const {repo,one}=clone(t),directory=path.join(repo,'.git/agent-skill-chain');fs.mkdirSync(directory);
 for(const bytes of ['not json',JSON.stringify({schema:'other',facts:[]}),JSON.stringify({schema:'asc-repository-facts/v1',facts:[{}]}),
  JSON.stringify({schema:'asc-repository-facts/v1',facts:[{id:'x',kind:'business',text:'Refunds need approval',observations:[{place:'p',sequence:1}],contradictions:[]}]}),
  JSON.stringify({schema:'asc-repository-facts/v1',facts:[{id:'x',kind:'environment-variable',text:'PASSWORD=dummy-sensitive-value\nsecond line',observations:[{place:'p',sequence:1}],contradictions:[]}]}),
  JSON.stringify({schema:'asc-repository-facts/v1',facts:[{id:'x',kind:'setup',text:'fine',observations:[{place:'p',sequence:1}],contradictions:[{place:'p',sequence:2,note:'token=abcdefghijklmnop'}]}]}),
  'dummy-sensitive-value not json']){
  fs.writeFileSync(path.join(directory,'repository-facts.json'),bytes);
  const start=startWorktree(one);assert.equal(start.facts.available,false,bytes);
  // No part of a damaged store reaches the output: only its path and the reason.
  for(const output of [JSON.stringify(start.facts),(()=>{try{listFacts(one);return '';}catch(e){return e.message;}})()])assert(!/dummy-sensitive|abcdefghijklmnop|Refunds/.test(output),output);assert.deepEqual(start.facts.shown,[]);assert.ok(start.facts.error,bytes);assert.ok(start.head,'the rest of start still works');
  assert.throws(()=>recordFact(one,NPM),/./,bytes);
 }
});

test('a store that is not a regular file never blocks start',posix,t=>{
 const {repo,one}=clone(t),directory=path.join(repo,'.git/agent-skill-chain');fs.mkdirSync(directory);
 execFileSync('mkfifo',[path.join(directory,'repository-facts.json')]);
 const start=startWorktree(one);assert.equal(start.facts.available,false);assert.match(start.facts.error,/regular file/);
 assert.throws(()=>recordFact(one,NPM),/regular file/);
});

test('a failed write leaves no temporary file and no lock behind',t=>{
 const {repo,one}=clone(t);recordFact(one,NPM);
 const directory=path.join(repo,'.git/agent-skill-chain'),before=fs.readFileSync(path.join(directory,'repository-facts.json'),'utf8');
 // The store reads fine; only the final rename fails, after the temporary file was written.
 t.mock.method(fs,'renameSync',()=>{throw Error('rename failed');});
 assert.throws(()=>recordFact(one,{...NPM,id:'other',text:'other fact'}),/rename failed/);
 t.mock.restoreAll();
 assert.deepEqual(fs.readdirSync(directory).sort(),['repository-facts.json']);
 assert.equal(fs.readFileSync(path.join(directory,'repository-facts.json'),'utf8'),before);
});

test('directories outside Git have no store and start reports that facts are unavailable',t=>{
 const root=tempDir('asc-facts-nongit-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'app.js'),'x');
 assert.equal(startWorktree(root).facts.available,false);assert.deepEqual(listFacts(root).facts,[]);
 assert.throws(()=>recordFact(root,NPM),/Git repository/);assert.deepEqual(fs.readdirSync(root),['app.js']);
});

test('the CLI records, contradicts and lists facts, and rejects unknown options',t=>{
 const {one}=clone(t),cli=path.resolve('bin/asc-v05.mjs');
 const run=(...a)=>spawnSync(process.execPath,[cli,...a],{encoding:'utf8'});
 const r=run('fact-record',one,'--id',NPM.id,'--kind',NPM.kind,'--text',NPM.text);assert.equal(r.status,0,r.stderr);
 assert.equal(JSON.parse(run('fact-list',one).stdout).facts[0].state,'shown');
 assert.equal(JSON.parse(run('fact-contradict',one,'--id',NPM.id,'--note','changed').stdout).state,'contradicted');
 for(const bad of [['fact-record',one,'--id','x','--kind','setup','--text','a','--id','y'],['fact-record',one,'--force','x'],['fact-contradict',one,'--text','x']])assert.notEqual(run(...bad).status,0,bad.join(' '));
 assert.ok(JSON.parse(run('capabilities').stdout).commands.includes('fact-record'));
});
