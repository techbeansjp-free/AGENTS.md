import {setImmediate} from 'node:timers';
import {test} from 'node:test';
import {createVerificationGit} from './src/verification-git.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {Controller,safeName,hash} from './src/controller.mjs';
import {approvalBytes,keyFingerprint} from './src/approval.mjs';

function fixture(t,extra={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-node-controller-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(root,'code.txt'),'before');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 const contract={intent:'Change before to after',criteria:['Exact after'],allowedPaths:['code.txt'],
  testArgv:['/bin/sh','-c','test "$(cat code.txt)" = after'],riskTestArgv:[],requiredChecks:['check'],
  policyRevision:'owner-v1',unresolved:[],risks:[],design:'',requiresDesign:false,...extra};
 const c=new Controller({repo:root,base,contract,implementer:'implementation'});
 const change=(value='after')=>{fs.writeFileSync(path.join(root,'code.txt'),value);git('add','code.txt');git('commit','-qm','candidate');};
 return {root,git,base,contract,c,change};
}
const review=async({target})=>({context:'fresh-reviewer',target,verdict:'pass',blockers:[]});
const linux=process.platform==='linux' && process.env.ASC_TEST_ISOLATION!=='0';
test('proof selection starts implementation, not a Step; unknown facts stop',t=>{
 const {c,change}=fixture(t);
 assert.equal(c.nextWork(c.contract.intent).work,'implementation');
 assert.equal(c.nextWork('changed primary intent').work,'reconcile-intent');
 change();assert.equal(c.nextWork(c.contract.intent).work,'verify');
 assert.throws(()=>c.ready(c.contract.intent));
 assert.throws(()=>{c.contract.intent='silently changed';},TypeError);
});
test('actual isolated verification, independent review, Draft and idempotent reobservation',{skip:!linux},async t=>{
 const {c,change}=fixture(t);change();c.verify();
 assert.equal(c.nextWork(c.contract.intent).work,'independent-review');
 await c.review(review);assert.equal(c.nextWork(c.contract.intent).work,'delivery');
 let creates=0,observes=0;
 const provider={intent:()=>c.contract.intent,createDraft:()=>{creates++;return 1;},observe:()=>{
  observes++;return {head:c.target().head,draft:true,merged:false,boundToPr:true,checks:{check:'success'}};
 }};
 await c.delivery(provider);await c.delivery(provider);assert.equal(creates,1);assert.equal(observes,2);
 provider.observe=()=>({head:c.target().head,draft:false,merged:false,boundToPr:true,checks:{check:'success'}});
 await assert.rejects(c.delivery(provider));
});
test('failure, changed HEAD, self review and review mutation invalidate receipts',{skip:!linux},async t=>{
 const {c,root,change}=fixture(t);change();c.verify();
 await assert.rejects(c.review(async({target})=>({context:'implementation',target,verdict:'pass',blockers:[]})));
 await c.review(review);
 await assert.rejects(c.review(async({target})=>{fs.writeFileSync(path.join(root,'code.txt'),'tampered');return review({target});}));
 assert.throws(()=>c.ready(c.contract.intent));
 change('wrong');assert.throws(()=>c.verify());
 await assert.rejects(c.review(review));
});
test('filesystem observations do not execute clean filters or trust assume-unchanged',t=>{
 const {c,git,root,change}=fixture(t);change();
 const marker=path.join(root,'executed');
 git('config','filter.evil.clean',`touch ${marker}`);
 fs.writeFileSync(path.join(root,'.gitattributes'),'code.txt filter=evil\n');
 assert.throws(()=>c.target());assert.equal(fs.existsSync(marker),false);
 fs.unlinkSync(path.join(root,'.gitattributes'));
 git('update-index','--assume-unchanged','code.txt');fs.writeFileSync(path.join(root,'code.txt'),'other');
 assert.throws(()=>c.target(),/Dirty/);assert.equal(fs.existsSync(marker),false);
});
test('symlink, hardlink, missing source and portable alias paths fail closed',t=>{
 for(const name of ['../x','.git/config','a\\b','file:stream','NUL','x.']) assert.throws(()=>safeName(name));
 const {c,root,change}=fixture(t);change();
 const code=path.join(root,'code.txt');fs.unlinkSync(code);assert.throws(()=>c.target());
 fs.writeFileSync(path.join(root,'other'),'after');fs.linkSync(path.join(root,'other'),code);
 assert.throws(()=>c.target());
});
test('risk approval requires a pinned signer and cannot survive a new Controller',t=>{
 const f=fixture(t,{risks:['authorization'],design:'Explicit design',riskTestArgv:[['/bin/true']]});
 const k=generateKeyPairSync('ed25519'),publicKey=k.publicKey.export({type:'spki',format:'pem'});
 const trustedKeys=[{authority:'owner',purpose:'design',publicKey,fingerprint:keyFingerprint(publicKey)}];
 const c=new Controller({repo:f.root,base:f.base,contract:f.contract,implementer:'worker',trustedKeys});
 assert.equal(c.nextWork(c.contract.intent).work,'design-approval');
 const payload={schema:'asc-owner-approval/v1',purpose:'design',authority:'owner',binding:c.binding(),issuedAt:Date.now()-1000,expiresAt:Date.now()+60000};
 const envelope={payload,signature:sign(null,approvalBytes(payload),k.privateKey).toString('base64')};
 c.approveDesign(envelope);assert.equal(c.nextWork(c.contract.intent).work,'implementation');
 const other=new Controller({repo:f.root,base:f.base,contract:f.contract,implementer:'worker',trustedKeys});
 assert.throws(()=>other.approveDesign(envelope),/Stale/);
 assert.throws(()=>c.approveDesign({...envelope,signature:Buffer.alloc(64).toString('base64')}));
 assert.equal(c.nextWork(c.contract.intent).work,'design-approval');
});
test('uncertainty and missing risk checks select owner work',t=>{
 for(const [extra,expected] of [[{unresolved:['business rule']},'clarify'],[{risks:['unknown']},'resolve-risk'],
  [{risks:['authorization']},'configure-risk-verification'],[{risks:['authorization'],riskTestArgv:[['/bin/true']]},'design']]){
   const {c}=fixture(t,extra);assert.equal(c.nextWork(c.contract.intent).work,expected);
 }
});
test('verification cannot reach host sentinel or Git metadata',{skip:!linux},t=>{
 const {c,change}=fixture(t);change();
 const sentinel=path.join(os.tmpdir(),`asc-host-${process.pid}-${Date.now()}`);fs.writeFileSync(sentinel,'trusted');t.after(()=>fs.rmSync(sentinel,{force:true}));
 const target=c.target();
 assert.equal(c.sandbox(target,['/bin/sh','-c',`test ! -e '${sentinel}' && test ! -e /work/.git`]).exit,0);
 assert.equal(fs.readFileSync(sentinel,'utf8'),'trusted');
});
test('old async success cannot overwrite a newer failed review or verification',{skip:!linux},async t=>{
 const {c,change}=fixture(t);change();c.verify();
 let finish;
 const pending=c.review(({target})=>new Promise(resolve=>{finish=()=>resolve({context:'old-review',target,verdict:'pass',blockers:[]});}));
 await assert.rejects(c.review(async({target})=>({context:'new-review',target,verdict:'fail',blockers:['defect']})));
 finish();await assert.rejects(pending,/Superseded/);assert.throws(()=>c.ready(c.contract.intent));
 let finishSecond;
 const second=c.review(({target})=>new Promise(resolve=>{finishSecond=()=>resolve({context:'old-review',target,verdict:'pass',blockers:[]});}));
 c.verify();finishSecond();await assert.rejects(second,/Superseded/);
 assert.throws(()=>c.ready(c.contract.intent));await c.review(review);c.ready(c.contract.intent);
});
test('concurrent Delivery does not duplicate creation; failure permits a safe retry',{skip:!linux},async t=>{
 const {c,change}=fixture(t);change();c.verify();await c.review(review);
 let finish,creates=0;
 const p={intent:()=>c.contract.intent,createDraft:()=>{creates++;return new Promise(resolve=>{finish=()=>resolve(1);});},
  observe:()=>({head:c.target().head,draft:true,merged:false,boundToPr:true,checks:{check:'success'}})};
 const first=c.delivery(p);
 // Let intent observation complete and createDraft begin.
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(c.delivery(p),/already in progress/);
 finish();await first;assert.equal(creates,1);await c.delivery(p);assert.equal(creates,1);
});


test('owner policy bytes are pinned and cannot be weakened by candidate changes',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'rules.md'),'Preserve tenant isolation');f.git('add','.');f.git('commit','-qm','owner policy');
 const contract={...f.contract,policyRefs:[{path:'rules.md',sha256:hash(Buffer.from('Preserve tenant isolation'))}]};
 const c=new Controller({repo:f.root,base:f.git('rev-parse','HEAD'),contract,implementer:'test'});assert.equal(c.target({allowEmpty:true}).empty,true);
 fs.writeFileSync(path.join(f.root,'rules.md'),'No tenant isolation');f.git('add','.');f.git('commit','-qm','changed policy');
 assert.throws(()=>c.target({allowEmpty:true}),/Owner policy changed/);
 const writable=new Controller({repo:f.root,base:f.base,contract:{...contract,allowedPaths:['code.txt','rules.md']},implementer:'test'});assert.throws(()=>writable.assertContract(),/outside Agent write scope/);
});

test('actual committed diff outside owner scope is rejected, even with a clean worktree',t=>{
 const f=fixture(t);f.change();
 fs.writeFileSync(path.join(f.root,'unrelated.txt'),'unauthorized');f.git('add','unrelated.txt');f.git('commit','-qm','out of scope');
 assert.equal(f.git('status','--porcelain'),'');
 assert.throws(()=>f.c.target(),/unauthorized change/);
 assert.throws(()=>{f.c.contract.allowedPaths.push('unrelated.txt');},TypeError);
 const approved=new Controller({repo:f.root,base:f.base,contract:{...f.contract,allowedPaths:['code.txt','unrelated.txt']},implementer:'owner-supplied-candidate'});
 assert.equal(approved.target().empty,false);assert.throws(()=>approved.ready(approved.contract.intent),/verification or review missing/);
});

test('same HEAD with changed acceptance or verification configuration cannot reuse review',{skip:!linux},async t=>{
 const f=fixture(t);f.change();f.c.verify();await f.c.review(review);const prior=f.c.ready(f.contract.intent);
 for(const update of [{criteria:['New acceptance condition']},{testArgv:['/bin/sh','-c','test "$(cat code.txt)" = after && test ! -e unexpected']},{policyRevision:'owner-v2'}]){
  const next=new Controller({repo:f.root,base:f.base,contract:{...f.contract,...update},implementer:'owner-supplied-candidate'});
  const current=next.target();assert.equal(current.head,prior.head);assert.notEqual(current.contract,prior.contract);
  assert.throws(()=>next.ready(next.contract.intent),/verification or review missing/);
  next.verify();await assert.rejects(next.review(async()=>({context:'fresh-reviewer',target:prior,verdict:'pass',blockers:[]})),/stale/);
  await next.review(review);next.ready(next.contract.intent);
 }
});

test('sibling worktrees and successive Issues do not share rejection or review state',{skip:!linux},async t=>{
 const {assertWorkLocation}=await import('./src/migration.mjs');
 const f=fixture(t),a=path.join(f.root,'..',path.basename(f.root)+'-a'),b=a+'-b';
 t.after(()=>{fs.rmSync(a,{recursive:true,force:true});fs.rmSync(b,{recursive:true,force:true});});
 f.git('worktree','add','--detach',a,f.base);f.git('worktree','add','--detach',b,f.base);
 const make=(repo,intent)=>new Controller({repo,base:f.base,contract:{...f.contract,intent},implementer:'same-host-implementation'});
 const ca=make(a,'Issue A'),cb=make(b,'Issue B');
 for(const c of [ca,cb]){
  assert.equal(assertWorkLocation(c.repo).mode,'worktree');
  fs.writeFileSync(path.join(c.repo,'code.txt'),'after');c.git('add','code.txt');
  c.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm',c.contract.intent);c.verify();
 }
 let finish;
 const pending=ca.review(({target})=>new Promise(resolve=>{finish=()=>resolve({context:'fresh-reviewer-a',target,verdict:'pass',blockers:[]});}));
 await assert.rejects(cb.review(async({target})=>({context:cb.implementer,target,verdict:'pass',blockers:[]})));
 assert.throws(()=>cb.ready('Issue B'));
 finish();await pending;ca.ready('Issue A');
 await assert.rejects(cb.review(async()=>({context:'fresh-reviewer-b',target:ca.target(),verdict:'pass',blockers:[]})),/stale/);
 await cb.review(review);cb.ready('Issue B');ca.ready('Issue A');
 // A dirty sibling must not globally poison a healthy worktree or entry check.
 fs.writeFileSync(path.join(a,'code.txt'),'uncommitted');assert.throws(()=>ca.ready('Issue A'));
 assert.equal(assertWorkLocation(b).mode,'worktree');cb.ready('Issue B');
 fs.writeFileSync(path.join(a,'code.txt'),'after');ca.ready('Issue A');
 const next=make(b,'Next Issue in same host session');
 assert.equal(next.nextWork(next.contract.intent).work,'verify');
 await assert.rejects(next.review(review),/Verify current/);
 next.verify();await assert.rejects(next.review(async()=>({context:'fresh-reviewer',target:cb.target(),verdict:'pass',blockers:[]})),/stale/);
 await next.review(review);next.ready(next.contract.intent);cb.ready('Issue B');
 assert.equal(f.git('rev-parse','HEAD'),f.base);assert.equal(f.git('status','--porcelain'),'');
});

test('batched source observation preserves binary, empty and duplicate blobs and mode',t=>{
 const f=fixture(t),binary=Buffer.from([0,10,13,255,128,65]);
 fs.writeFileSync(path.join(f.root,'binary.bin'),binary);fs.writeFileSync(path.join(f.root,'duplicate.bin'),binary);fs.writeFileSync(path.join(f.root,'empty.txt'),'');fs.writeFileSync(path.join(f.root,'sp ace.txt'),'value');
 f.git('add','.');f.git('update-index','--chmod=+x','binary.bin');f.git('commit','-qm','source forms');
 const blobs=f.c.blobs(f.git('rev-parse','HEAD'));
 assert.deepEqual(blobs.get('binary.bin').bytes,binary);assert.deepEqual(blobs.get('duplicate.bin').bytes,binary);assert.equal(blobs.get('binary.bin').mode,'100755');assert.equal(blobs.get('empty.txt').bytes.length,0);assert.equal(blobs.get('sp ace.txt').bytes.toString(),'value');
 const actual=f.c.gitInput.bind(f.c);f.c.gitInput=(input,...args)=>{const result=actual(input,...args);return args[0]==='cat-file'?result.subarray(0,result.length-1):result;};
 assert.throws(()=>f.c.blobs(f.git('rev-parse','HEAD')),/Truncated blob/);
});
test('source byte bound rejects inventory before batch contents are requested',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'large.bin'),Buffer.alloc(12000001));f.git('add','.');f.git('commit','-qm','oversize');
 const original=f.c.gitInput.bind(f.c);let contentCalls=0;f.c.gitInput=(input,...args)=>{if(args[0]==='cat-file')contentCalls++;return original(input,...args);};
 assert.throws(()=>f.c.blobs(f.git('rev-parse','HEAD')),/Source byte limit/);assert.equal(contentCalls,0);
});


test('source inventory remains bounded before requesting any contents',t=>{
 const f=fixture(t);let reads=0;const oid='0'.repeat(40);
 f.c.gitInput=(_input,...args)=>{if(args[0]==='ls-tree')return Buffer.from(Array.from({length:10001},(_,i)=>`100644 blob ${oid}       0\tf-${i}\0`).join(''));reads++;throw Error('Unexpected content read');};
 assert.throws(()=>f.c.blobs(f.base),/Inventory limit/);assert.equal(reads,0);
});

test('oversized candidate is rejected before any Git publication',async t=>{
 const {commitCandidate}=await import('./src/candidate.mjs');
 const names=Array.from({length:6},(_,i)=>`large-${i}.txt`);
 const {c,git,root,base}=fixture(t,{allowedPaths:names});
 const space=fs.mkdtempSync(path.join(os.tmpdir(),'asc-output-cap-'));t.after(()=>fs.rmSync(space,{recursive:true,force:true}));
 for(const name of names)fs.writeFileSync(path.join(space,name),Buffer.alloc(11_000_000,97));
 assert.throws(()=>commitCandidate(c,space),/Candidate source limit/);
 assert.equal(git('rev-parse','HEAD'),base);assert.equal(git('status','--porcelain'),'');
 assert.equal(fs.readFileSync(path.join(root,'code.txt'),'utf8'),'before');
});

test('base Controller enforces explicit cgroup memory instead of silently ignoring it',{skip:!linux||process.env.ASC_TEST_CGROUP!=='1'},t=>{
 const {c,change}=fixture(t,{verificationResourceProfile:'browser-cgroup-v1',verificationLimits:{memoryBytes:134217728}});change();c.verify();
 assert.equal(c.events.at(-1).results[0].resourceBoundary.before.limits['memory.max'],'134217728');
});

// Real existing test suites use Git inventory; source authority must stay outside.
test('opt-in shallow verification Git preserves exact HEAD without history or authority',{skip:!linux},t=>{
 const f=fixture(t,{verificationGit:'shallow-head',testArgv:['/bin/sh','-ec',
  'test "$(git ls-files)" = code.txt; test "$(git rev-parse HEAD)" = "$(cat .git/shallow)"; test "$(git rev-list --count HEAD)" = 1; test -z "$(git remote)"; test ! -e .git/hooks; ! git config user.email; ! git update-ref refs/heads/escape HEAD; ! git cat-file -e HEAD^; test "$(git show HEAD:code.txt)" = after']});
 f.change();f.git('remote','add','origin','https://secret.invalid/private');
 f.git('config','credential.helper','!touch /tmp/never-run');
 const before=f.git('rev-parse','HEAD');f.c.verify();assert.equal(f.git('rev-parse','HEAD'),before);
 assert.equal(f.git('remote','get-url','origin'),'https://secret.invalid/private');
 const ordinary=new Controller({repo:f.root,base:f.base,contract:{...f.contract,verificationGit:undefined,testArgv:['/bin/sh','-ec','test ! -e .git']},implementer:'worker'});ordinary.verify();
 const invalid=new Controller({repo:f.root,base:f.base,contract:{...f.contract,verificationGit:'full'},implementer:'worker'});assert.throws(()=>invalid.assertContract(),/Git mode/);
});

test('verification Git reconstructs nested binary executable trees in both object formats',t=>{
 for(const format of ['sha1','sha256']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-git-view-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),view=path.join(root,'view');fs.mkdirSync(source);fs.mkdirSync(view);
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:source,encoding:'utf8',stdio:'pipe'}).trim();
  git('init','-q','--object-format='+format);git('config','user.name','Fixture');git('config','user.email','test@example.invalid');
  fs.mkdirSync(path.join(source,'nested'));fs.mkdirSync(path.join(source,'nested','deep'));
  fs.writeFileSync(path.join(source,'nested','deep','binary'),Buffer.from([0,255,128,1]));
  fs.writeFileSync(path.join(source,'nested.txt'),'sort before directory slash');
  fs.writeFileSync(path.join(source,'nested','run'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  git('add','.');git('commit','-qm','tree');const head=git('rev-parse','HEAD');
  const c=new Controller({repo:source,base:head,contract:{},implementer:'test'});
  const commit=c.git('cat-file','commit',head),blobs=c.blobs(head);
  createVerificationGit(view,head,commit,blobs);
  const observed=execFileSync('/usr/bin/git',['ls-files','--stage','-z'],{cwd:view});
  assert.deepEqual(observed,c.git('ls-files','--stage','-z'));
  assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:view,encoding:'utf8'}).trim(),head);
  const bad=path.join(root,'bad');fs.mkdirSync(bad);
  const changed=new Map(blobs);changed.set('nested.txt',{...blobs.get('nested.txt'),bytes:Buffer.from('tampered')});
  assert.throws(()=>createVerificationGit(bad,head,commit,changed),/identity mismatch/);
 }
});

// Git/verification are real; remote edits and PR/CI are explicit provider doubles.
test('primary intent edits across Delivery never become success or duplicate submission',{skip:!linux},async t=>{
 for(const phase of ['before-submit','during-create','during-observe']){
  await t.test(phase,async t=>{
   const {c,change}=fixture(t);change();c.verify();await c.review(review);
   const head=c.target().head;let intent=c.contract.intent,creates=0,observes=0;
   if(phase==='before-submit')intent='Owner changed the acceptance request';
   const provider={intent:()=>intent,createDraft:()=>{creates++;if(phase==='during-create')intent='Owner changed the acceptance request';return 17;},
    observe:()=>{observes++;if(phase==='during-observe')intent='Owner changed the acceptance request';return {head,draft:true,merged:false,boundToPr:true,checks:{check:'success'}};}};
   await assert.rejects(c.delivery(provider),/Primary intent changed/);
   assert.equal(c.target().head,head);assert.equal(c.events.filter(e=>e.operation==='delivery').length,0);
   assert.equal(creates,phase==='before-submit'?0:1);assert.equal(observes,phase==='during-observe'?1:0);
   // An unchanged invalid request remains stopped, without issuing another external mutation.
   await assert.rejects(c.delivery(provider),/Primary intent changed/);assert.equal(creates,phase==='before-submit'?0:1);
   // Simulate an explicit owner restoration, not an Agent rewriting its contract.
   intent=c.contract.intent;provider.createDraft=()=>{creates++;return 17;};const observationsBeforeRestore=observes;
   provider.observe=pr=>{assert.equal(pr,17);observes++;return {head,draft:true,merged:false,boundToPr:true,checks:{check:'success'}};};
   await c.delivery(provider);assert.equal(creates,1);assert.equal(observes,observationsBeforeRestore+1);assert.equal(c.events.filter(e=>e.operation==='delivery').length,1);
  });
 }
});


test('ignored host build products stay outside snapshots without blocking clean source', {skip:!linux},t=>{
 const {c,root,git,change}=fixture(t);
 fs.writeFileSync(path.join(root,'.gitignore'),'__pycache__/\nlocal-output.txt\n');git('add','.gitignore');git('commit','-qm','ignore generated artifacts');
 // The policy change is outside this task; start the task from that new baseline.
 const contract=c.contract;const controller=new Controller({repo:root,base:git('rev-parse','HEAD'),contract,implementer:'implementation'});
 change();fs.mkdirSync(path.join(root,'__pycache__'));fs.writeFileSync(path.join(root,'__pycache__','cache'),'host-only');fs.writeFileSync(path.join(root,'local-output.txt'),'preserve');
 const target=controller.target();
 assert.equal(controller.sandbox(target,['/bin/sh','-c','test ! -e /work/__pycache__ && test ! -e /work/local-output.txt && test "$(cat code.txt)" = after']).exit,0);
 assert.equal(fs.readFileSync(path.join(root,'local-output.txt'),'utf8'),'preserve');
 assert.equal(fs.readFileSync(path.join(root,'__pycache__','cache'),'utf8'),'host-only');
 const collision=new Controller({repo:root,base:controller.base,contract:{...contract,allowedPaths:['code.txt','__pycache__/cache']},implementer:'implementation'});
 assert.throws(()=>collision.target(),/overlaps allowed write scope/);
 fs.writeFileSync(path.join(root,'untracked.txt'),'human work');assert.throws(()=>controller.target(),/Untracked or special/);
});
