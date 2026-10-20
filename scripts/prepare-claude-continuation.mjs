/** Synthetic requirement transition only; preserve Agent implementation bytes and original evidence. */
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {verificationCaptureSource} from './claude-verification-capture.mjs';
const root=fs.realpathSync(process.argv[2]),setup=JSON.parse(fs.readFileSync(path.join(root,'setup.json'))),delivery=JSON.parse(fs.readFileSync(path.join(root,'delivery.json')));
if(root!==setup.root||setup.repository!=='adachi-tatsuru/asc-public-synthetic-eval-20261016'||setup.scenario!=='complex-two-issue-initial'||setup.verificationTransport!=='project'||delivery.session!==setup.session||delivery.usage?.complete!==true||delivery.verification?.passed!==true||delivery.implementationIntervention!==0)throw Error('Successful original synthetic project trial required');
if([delivery.ci,delivery.greetingCI].some(c=>!c||c.head!==delivery.head||c.merged!==false||c.draft!==true||c.boundToPr!==true||!Object.keys(c.checks??{}).length||Object.values(c.checks).some(x=>x!=='success')))throw Error('Both original CI runs must pass');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k)));
const git=(...args)=>execFileSync('git',['-C',setup.worktree,...args],{env,stdio:['ignore','pipe','pipe'],encoding:'utf8',maxBuffer:16*1024*1024}).trim();
if(git('rev-parse','HEAD')!==delivery.head||git('status','--porcelain'))throw Error('Original target changed');
const ownerBytes=fs.readFileSync(path.join(root,'owner.json'));
if(createHash('sha256').update(ownerBytes).digest('hex')!==delivery.verification.contractSha256)throw Error('Original owner contract changed');
const contract=JSON.parse(ownerBytes),settings=JSON.parse(fs.readFileSync(path.join(root,'settings.json')));
const observer=path.join(root,'distribution/project-verification-observation.mjs');
if(createHash('sha256').update(fs.readFileSync(observer)).digest('hex')!==setup.projectObserverSha256)throw Error('Project observer changed');
if(!Array.isArray(settings.sandbox?.filesystem?.denyWrite))throw Error('Invalid original sandbox settings');
const sources=Object.fromEntries(['reservation','billing'].map(service=>[service,fs.readFileSync(path.join(setup.worktree,'complex',service,'service.mjs'))]));
const workflow=path.join(setup.worktree,'.github/workflows/complex.yml');let text=fs.readFileSync(workflow,'utf8');
for(const name of ['reservation','billing','accessors']){const old=`node complex/oracle/${name}.mjs complex`;if(text.split(old).length!==2)throw Error('Unexpected original workflow');text=text.replace(old,old+' revised');}
text+='          node complex/oracle/revision.mjs complex/previous complex\n';
const phase=path.join(root,'revision');fs.mkdirSync(phase);

const previous=path.join(setup.worktree,'complex/previous');if(fs.existsSync(previous))throw Error('Prior implementation already exists');
const hashes={};
for(const service of ['reservation','billing']){
 const bytes=sources[service];
 const destination=path.join(previous,service);fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'service.mjs'),bytes,{flag:'wx'});hashes[service]=createHash('sha256').update(bytes).digest('hex');
}
fs.writeFileSync(workflow,text);
git('add','--','complex/previous','.github/workflows/complex.yml');git('-c','core.hooksPath=/dev/null','commit','-qm','Synthetic next requirement: retain actual initial implementation and verify currency revision');
const base=git('rev-parse','HEAD'),owner=path.join(phase,'owner.json'),captureFile=path.join(phase,'capture-verification.mjs');
contract.intent='Apply complex/REVISION.md to the existing implementation while preserving original requirements and stored-record compatibility. Original work is complete; continue both Issues in the same coordinator session. Only the two current service.mjs implementations may change. Previous implementations and oracles are immutable.';
contract.commands=contract.commands.map(a=>['reservation','billing','accessors'].some(n=>a[1]===`complex/oracle/${n}.mjs`)?[...a,'revised']:a);
contract.commands.push([process.execPath,'complex/oracle/revision.mjs','complex/previous','complex']);fs.writeFileSync(owner,JSON.stringify(contract),{flag:'wx',mode:0o444});
const capture={command:`node ${captureFile}`,marker:randomUUID().replaceAll('-',''),projectCommands:true};
fs.writeFileSync(captureFile,verificationCaptureSource({projectObserver:pathToFileURL(path.join(root,'distribution/project-verification-observation.mjs')).href,repo:setup.worktree,base,owner,...capture}),{flag:'wx',mode:0o444});
settings.sandbox.filesystem.denyWrite.push(owner,captureFile);fs.writeFileSync(path.join(phase,'settings.json'),JSON.stringify(settings),{flag:'wx',mode:0o444});
fs.writeFileSync(path.join(phase,'setup.json'),JSON.stringify({parent:root,session:setup.session,base,originalHead:delivery.head,previousSourceHashes:hashes,owner,capture,fixturePreparation:'Copies original Agent source unchanged to previous/ and updates only fixture CI; no implementation edits',model:setup.model,effort:setup.effort},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({phase,base,session:setup.session}));
