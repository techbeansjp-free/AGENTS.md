import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {worktreeFixture} from './helpers/worktree-fixture.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function setup(t){
 const f=worktreeFixture(t),write=(name,body)=>{const p=path.join(f.work,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);};
 for(const n of ['reservation','billing'])write(`complex/${n}/service.mjs`,`export const service=${JSON.stringify(n)};`);
 write('.github/workflows/complex.yml',['reservation','billing','accessors'].map(n=>`          node complex/oracle/${n}.mjs complex\n`).join(''));f.git(f.work,'add','.');f.git(f.work,'commit','-qm','fixture');
 const head=f.git(f.work,'rev-parse','HEAD'),observer=fs.readFileSync('scripts/project-verification-observation.mjs');fs.mkdirSync(path.join(f.root,'distribution'));fs.writeFileSync(path.join(f.root,'distribution/project-verification-observation.mjs'),observer);
 fs.writeFileSync(path.join(f.root,'setup.json'),JSON.stringify({root:f.root,worktree:f.work,repository:'adachi-tatsuru/asc-public-synthetic-eval-20261016',scenario:'complex-two-issue-initial',verificationTransport:'project',session:'synthetic',projectObserverSha256:hash(observer)}));
 const ci={head,draft:true,merged:false,boundToPr:true,checks:{test:'success'}};
 fs.writeFileSync(path.join(f.root,'delivery.json'),JSON.stringify({head,session:'synthetic',usage:{complete:true},verification:{passed:true,contractSha256:hash(fs.readFileSync(f.owner))},implementationIntervention:0,ci,greetingCI:ci}));
 fs.writeFileSync(path.join(f.root,'settings.json'),JSON.stringify({sandbox:{filesystem:{denyWrite:[]}}}));
 return {...f,head,run:()=>spawnSync(process.execPath,['scripts/prepare-claude-continuation.mjs',f.root],{encoding:'utf8'})};
}
test('changed owner and missing settings fail before modifying accepted work',t=>{
 const f=setup(t),original=fs.readFileSync(f.owner);fs.writeFileSync(f.owner,'{}');assert.notEqual(f.run().status,0);assert.equal(f.git(f.work,'rev-parse','HEAD'),f.head);assert.equal(f.git(f.work,'status','--porcelain'),'');assert.equal(fs.existsSync(path.join(f.root,'revision')),false);
 fs.writeFileSync(f.owner,original);fs.unlinkSync(path.join(f.root,'settings.json'));assert.notEqual(f.run().status,0);assert.equal(f.git(f.work,'status','--porcelain'),'');assert.equal(fs.existsSync(path.join(f.root,'revision')),false);
});
test('revision retains actual initial sources and original evidence',t=>{
 const f=setup(t),evidence=fs.readFileSync(path.join(f.root,'delivery.json'));const p=f.run();assert.equal(p.status,0,p.stderr);
 for(const n of ['reservation','billing'])assert.deepEqual(fs.readFileSync(path.join(f.work,`complex/${n}/service.mjs`)),fs.readFileSync(path.join(f.work,`complex/previous/${n}/service.mjs`)));
 assert.deepEqual(fs.readFileSync(path.join(f.root,'delivery.json')),evidence);assert.equal(f.git(f.work,'status','--porcelain'),'');
 const phase=JSON.parse(fs.readFileSync(path.join(f.root,'revision/setup.json')));assert.equal(phase.session,'synthetic');assert.equal(phase.originalHead,f.head);assert.notEqual(phase.base,f.head);
 assert.notEqual(f.run().status,0,'cannot silently prepare twice');
});
