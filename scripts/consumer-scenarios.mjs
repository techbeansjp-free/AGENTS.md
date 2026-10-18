/** Run only inside a disposable, network-isolated consumer filesystem. */
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.cwd(),results=[];
assert.equal(root,'/work');
const run=(cmd,args,cwd=root)=>{const p=spawnSync(cmd,args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(p.status,0,p.stderr||p.stdout);return p.stdout;};
const node=(args,cwd)=>run(process.execPath,args,cwd);
const npm='/runtime/lib/node_modules/npm/bin/npm-cli.js';
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
const git=(dir,...args)=>run('git',args,dir).trim();
const launcher=p=>path.join(p,'.agent-skill-chain/bin/asc.mjs');
const cli=p=>path.join(p,'.agent-skill-chain/node_modules/agent-skill-chain/bin/asc-v05.mjs');
const invoke=(entry,...args)=>JSON.parse(node([entry,...args]));
const install=(dir,version)=>node([npm,'install','--prefix',path.join(dir,'.agent-skill-chain'),'--offline','--ignore-scripts','--no-audit','--no-fund','--no-save','--package-lock=false',`/work/packages/agent-skill-chain-${version}.tgz`]);
const [versionA,versionB]=JSON.parse(fs.readFileSync('/work/input-versions.json'));
const check=(id,fn)=>{const start=performance.now();try{fn();results.push({id,status:'passed',seconds:(performance.now()-start)/1000});}catch(e){results.push({id,status:'failed',error:String(e)});}fs.writeFileSync('results.json',JSON.stringify({results,aiCalls:0,modelQualityEvaluated:false},null,2));console.log(JSON.stringify(results.at(-1)));};
const tree=dir=>{const entries=[];const visit=(at,relative='')=>{for(const name of fs.readdirSync(at).sort()){const file=path.join(at,name),key=relative+name,st=fs.lstatSync(file);entries.push([key,st.mode,st.isSymbolicLink()?fs.readlinkSync(file):st.isDirectory()?'directory':createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);if(st.isDirectory())visit(file,key+'/');}};visit(dir);return entries;};
const project='/work/日本語 project';
check('C01 offline install preserves existing project manifests',()=>{
 fs.mkdirSync(project);write(path.join(project,'package.json'),'{"name":"consumer","private":true}\n');write(path.join(project,'pnpm-lock.yaml'),'lockfileVersion: 9\n');
 install(project,versionA);
 assert.equal(fs.readFileSync(path.join(project,'package.json'),'utf8'),'{"name":"consumer","private":true}\n');
 assert.equal(fs.readFileSync(path.join(project,'pnpm-lock.yaml'),'utf8'),'lockfileVersion: 9\n');
});
check('C02 preview is read-only and non-Git deployment never initializes Git',()=>{
 const before=tree(project),preview=invoke(cli(project),'project-assets',project);assert.deepEqual(tree(project),before);assert.equal(preview.applied,false);assert(!fs.existsSync(launcher(project)));
 assert.equal(invoke(cli(project),'project-assets',project,'--register-skill','--apply').applied,true);
 assert(!fs.existsSync(path.join(project,'.git')));
 const start=invoke(launcher(project),'start',project);assert.equal(start.gitManaged,false);assert.equal(start.providerLaunch,false);assert.equal(start.verified,false);
});
check('C03 shared assets bind every file hash and contain no installer path',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(project,'.agent-skill-chain/distribution.json')));
 for(const [name,digest] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(project,name))).digest('hex'),digest,name);
 assert(!fs.readFileSync(path.join(project,'.agent-skill-chain/skills/asc/SKILL.md'),'utf8').includes(project));
});
check('C04 remove bootstrap dependencies; bundled runtime remains usable',()=>{
 node([npm,'uninstall','--prefix',path.join(project,'.agent-skill-chain'),'--offline','--ignore-scripts','--no-audit','--no-fund','--no-save','--package-lock=false','agent-skill-chain']);
 assert(!fs.existsSync(path.join(project,'.agent-skill-chain/node_modules/agent-skill-chain')));
 assert.equal(node([launcher(project),'--version']).trim(),versionA);
});
check('C05 scoped and nested project rules are selected without exposing contents',()=>{
 write(path.join(project,'AGENTS.md'),'project-owned rule');write(path.join(project,'src/ui/AGENTS.md'),'nested-owned rule');write(path.join(project,'rules/ui.md'),'private-rule-body');
 write(path.join(project,'.agent-skill-chain/project/context.json'),JSON.stringify({schema:'asc-project-context/v1',rules:[{path:'rules/ui.md',appliesTo:['src/ui']}]}));
 const start=invoke(launcher(project),'start',project,'--path','src/ui/view.ts');
 assert.deepEqual(start.context.references.map(r=>r.path),['AGENTS.md','src/ui/AGENTS.md','rules/ui.md']);assert(!JSON.stringify(start).includes('private-rule-body'));
});
const repo='/work/repository',a='/work/work-a',b='/work/work-b';let base;
check('C06 clone and two worktrees run bundled version without external installation',()=>{
 fs.cpSync(project,repo,{recursive:true});git(repo,'init','-q','-b','develop');git(repo,'config','user.name','Synthetic');git(repo,'config','user.email','synthetic@example.invalid');
 write(path.join(repo,'.gitignore'),'.agent-skill-chain/node_modules/\nnode_modules/\ndist/\n');git(repo,'add','.');git(repo,'commit','-qm','synthetic base');base=git(repo,'rev-parse','HEAD');
 git(repo,'worktree','add','-b','feature/a',a);git(repo,'worktree','add','-b','feature/b',b);
 for(const p of [a,b]){assert.equal(node([launcher(p),'--version']).trim(),versionA);assert.equal(invoke(launcher(p),'start',p).execution,'current-host-worktree');}
 git('/work','clone','--quiet',repo,'/work/clone');assert.equal(node(['/work/clone/.agent-skill-chain/bin/asc.mjs','--version']).trim(),versionA);
});
check('C07 update one worktree without changing sibling or owner settings',()=>{
 install(a,versionB);assert.equal(invoke(cli(a),'project-assets',a,'--apply').applied,true);
 assert.equal(node([launcher(a),'--version']).trim(),versionB);assert.equal(node([launcher(b),'--version']).trim(),versionA);
 assert.equal(fs.readFileSync(path.join(a,'rules/ui.md'),'utf8'),'private-rule-body');
 assert.equal(fs.readFileSync(path.join(a,'AGENTS.md'),'utf8'),'project-owned rule');
});
check('C08 downgrade and repeated deployment are idempotent',()=>{
 install(a,versionA);assert.equal(invoke(cli(a),'project-assets',a,'--apply').applied,true);
 const again=invoke(cli(a),'project-assets',a);assert.deepEqual(again.changes,[]);assert.equal(again.recordChanged,false);
 assert.equal(node([launcher(a),'--version']).trim(),versionA);
});
check('C09 local asset conflict blocks whole update and retry succeeds after resolution',()=>{
 const usage=path.join(a,'.agent-skill-chain/v05/USAGE.md'),original=fs.readFileSync(usage);fs.appendFileSync(usage,'\nowner-edit\n');
 install(a,versionB);const before=fs.readFileSync(path.join(a,'.agent-skill-chain/runtime.json'));
 const rejected=spawnSync(process.execPath,[cli(a),'project-assets',a,'--apply'],{encoding:'utf8'});assert.equal(rejected.status,2);const conflict=JSON.parse(rejected.stdout);assert.equal(conflict.applied,false);assert(conflict.conflicts.includes('.agent-skill-chain/v05/USAGE.md'));
 assert.deepEqual(fs.readFileSync(path.join(a,'.agent-skill-chain/runtime.json')),before);assert(fs.readFileSync(usage,'utf8').includes('owner-edit'));
 fs.writeFileSync(usage,original);assert.equal(invoke(cli(a),'project-assets',a,'--apply').applied,true);
});
check('C10 non-Git umbrella selects sibling repositories independently',()=>{
 const p='/work/umbrella';fs.mkdirSync(p);fs.cpSync(path.join(project,'.agent-skill-chain'),path.join(p,'.agent-skill-chain'),{recursive:true});fs.cpSync(path.join(project,'rules'),path.join(p,'rules'),{recursive:true});
 for(const name of ['one','two'])git(p,'clone','--quiet',repo,path.join(p,name));
 assert.equal(invoke(launcher(p),'start',p).gitManaged,false);
 const w=path.join(p,'one-work');git(path.join(p,'one'),'worktree','add','-b','task',w);
 assert.equal(invoke(launcher(p),'start',w).repo,w);
});
check('C11 build/test uses existing workspace dependency links and retains ignored output',()=>{
 write(path.join(b,'node_modules/.pnpm/example/node_modules/example/index.js'),'module.exports=42;');
 fs.symlinkSync('.pnpm/example/node_modules/example',path.join(b,'node_modules/example'));
 write(path.join(b,'check.cjs'),"const fs=require('fs');require('assert').equal(require('example'),42);fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/result','ok');");
 git(b,'add','check.cjs');git(b,'commit','-qm','add dependency consumer');
 write('/work/owner.json',JSON.stringify({intent:'build with existing dependency',allowedPaths:['check.cjs'],commands:[[process.execPath,'check.cjs']]}));
 const verified=invoke(launcher(b),'worktree-verify',b,base,'/work/owner.json');assert.equal(verified.passed,true);assert.equal(verified.deliveryAuthorized,false);assert.equal(fs.readFileSync(path.join(b,'dist/result'),'utf8'),'ok');
});
check('C12 failed verification can be retried without poisoning sibling worktree',()=>{
 write('/work/fail.json',JSON.stringify({intent:'failure probe',allowedPaths:['check.cjs'],commands:[[process.execPath,'-e','process.exit(1)']]}));
 const failed=spawnSync(process.execPath,[launcher(b),'worktree-verify',b,base,'/work/fail.json'],{encoding:'utf8'});assert.equal(failed.status,2);const rejected=JSON.parse(failed.stdout);assert.equal(rejected.passed,false);assert.equal(rejected.results[0].exit,1);assert.equal(rejected.deliveryAuthorized,false);
 assert.equal(invoke(launcher(b),'worktree-verify',b,base,'/work/owner.json').passed,true);assert.equal(invoke(launcher(a),'start',a).providerLaunch,false);
});
check('C13 scope violation refuses verification before running owner command',()=>{
 write('/work/scope.json',JSON.stringify({intent:'scope probe',allowedPaths:['unrelated'],commands:[[process.execPath,'-e',"require('fs').writeFileSync('/work/should-not-run','bad')"]]}));
 const p=spawnSync(process.execPath,[launcher(b),'worktree-verify',b,base,'/work/scope.json'],{encoding:'utf8'});
 assert.notEqual(p.status,0);assert.match(p.stderr,/scope/);assert(!fs.existsSync('/work/should-not-run'));
});
check('C14 test modifying tracked source cannot produce valid verification',()=>{
 write('/work/mutate.json',JSON.stringify({intent:'mutation probe',allowedPaths:['check.cjs'],commands:[[process.execPath,'-e',"require('fs').appendFileSync('check.cjs','\\n// unexpected mutation')"]]}));
 const before=fs.readFileSync(path.join(b,'check.cjs'));
 const p=spawnSync(process.execPath,[launcher(b),'worktree-verify',b,base,'/work/mutate.json'],{encoding:'utf8'});
 assert.notEqual(p.status,0);assert.match(p.stderr,/changed|mutat/i);
 fs.writeFileSync(path.join(b,'check.cjs'),before);assert.equal(invoke(launcher(b),'worktree-verify',b,base,'/work/owner.json').passed,true);
});
check('C15 missing selected project rule stops rather than silently omitting it',()=>{
 const rule=path.join(b,'rules/ui.md'),original=fs.readFileSync(rule);fs.unlinkSync(rule);
 const p=spawnSync(process.execPath,[launcher(b),'start',b,'--path','src/ui/view.ts'],{encoding:'utf8'});assert.notEqual(p.status,0);assert.match(p.stderr,/ENOENT/);
 fs.writeFileSync(rule,original);assert.equal(invoke(launcher(a),'start',a).providerLaunch,false);
});
check('C16 main checkout refusal does not block a subsequent valid worktree',()=>{
 const p=spawnSync(process.execPath,[launcher(repo),'start',repo],{encoding:'utf8'});assert.notEqual(p.status,0);assert.match(p.stderr,/worktree/);
 assert.equal(invoke(launcher(b),'start',b).execution,'current-host-worktree');
});
check('C18 interrupted asset write preserves owner files and recovers from recorded baseline',()=>{
 const target='/work/recovery';git(repo,'worktree','add','-b','recovery',target);
 const manifest=JSON.parse(fs.readFileSync(path.join(target,'.agent-skill-chain/distribution.json')));
 const managed=[...Object.keys(manifest.files),'.agent-skill-chain/distribution.json'];
 const old=new Map(managed.map(name=>[name,fs.readFileSync(path.join(target,name))]));
 write(path.join(target,'AGENTS.md'),'owner edit during upgrade');
 install(target,versionB);
 write('/work/fault-bin/git',`#!/runtime/bin/node
const fs=require('fs'),{spawnSync}=require('child_process'),args=process.argv.slice(2);
const apply=args.includes('apply');if(apply)fs.writeFileSync('/work/fault-triggered','file-size fault');
const result=spawnSync(apply?'/usr/bin/prlimit':'/usr/bin/git',apply?['--fsize=128','--','/usr/bin/git',...args]:args,{stdio:'inherit'});
process.exit(result.status??125);
`);fs.chmodSync('/work/fault-bin/git',0o755);
 const rejected=spawnSync(process.execPath,[cli(target),'project-assets',target,'--apply'],{encoding:'utf8',env:{...process.env,PATH:'/work/fault-bin:'+process.env.PATH}});
 assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Asset Git operation failed/);assert(fs.existsSync('/work/fault-triggered'));
 assert.equal(fs.readFileSync(path.join(target,'AGENTS.md'),'utf8'),'owner edit during upgrade');
 const partial=managed.filter(name=>!fs.existsSync(path.join(target,name))||!fs.readFileSync(path.join(target,name)).equals(old.get(name)));
 assert(partial.length>0,'fault must interrupt actual managed writes');
 // Recovery uses the trusted pre-update inventory, never the damaged manifest.
 git(target,'restore','--source='+base,'--worktree','--',...managed);
 assert.equal(fs.readFileSync(path.join(target,'AGENTS.md'),'utf8'),'owner edit during upgrade');
 assert.equal(invoke(cli(target),'project-assets',target,'--apply').applied,true);
 assert.equal(node([launcher(target),'--version']).trim(),versionB);
 assert.equal(node([launcher(b),'--version']).trim(),versionA);
});
if(fs.existsSync('/work/tooling/pnpm-10.0.0.tgz'))check('C19 real pnpm workspace builds TypeScript packages and tests without copying dependencies',()=>{
 const target='/work/pnpm-work';git(repo,'worktree','add','-b','pnpm-build',target);
 fs.mkdirSync('/work/pnpm');run('tar',['-xf','/work/tooling/pnpm-10.0.0.tgz','-C','/work/pnpm']);
 const pnpm='/work/pnpm/package/bin/pnpm.cjs';
 write(path.join(target,'package.json'),JSON.stringify({name:'synthetic-workspace',private:true,packageManager:'pnpm@10.0.0',devDependencies:{typescript:'file:/work/tooling/typescript-5.9.3.tgz'}}));
 write(path.join(target,'pnpm-workspace.yaml'),"packages:\n  - 'packages/*'\n");
 write(path.join(target,'packages/shared/package.json'),JSON.stringify({name:'@fixture/shared',version:'1.0.0',main:'dist/index.js',types:'dist/index.d.ts',scripts:{build:'tsc index.ts --outDir dist --module commonjs --target es2020 --declaration'}}));
 write(path.join(target,'packages/shared/index.ts'),'export const greeting = (name: string): string => `Hello ${name}`;');
 write(path.join(target,'packages/app/package.json'),JSON.stringify({name:'@fixture/app',private:true,dependencies:{'@fixture/shared':'workspace:*'},scripts:{build:'tsc index.ts --outDir dist --module commonjs --target es2020'}}));
 write(path.join(target,'packages/app/index.ts'),"import {greeting} from '@fixture/shared'; console.log(greeting('consumer'));");
 node([pnpm,'install','--offline','--ignore-scripts'],target);
 assert(fs.lstatSync(path.join(target,'packages/app/node_modules/@fixture/shared')).isSymbolicLink());
 git(target,'add','package.json','pnpm-workspace.yaml','pnpm-lock.yaml','packages');git(target,'commit','-qm','synthetic TypeScript workspace');
 const changed=git(target,'diff','--name-only',base,'HEAD').split('\n');
 const commands=[[process.execPath,pnpm,'--filter','@fixture/shared','run','build'],[process.execPath,pnpm,'--filter','@fixture/app','run','build'],[process.execPath,'-e',"require('assert').equal(require('child_process').execFileSync(process.execPath,['packages/app/dist/index.js'],{encoding:'utf8'}),'Hello consumer\\n')"]];
 write('/work/pnpm-owner.json',JSON.stringify({intent:'build and test linked workspace packages',allowedPaths:changed,commands}));
 const result=invoke(launcher(target),'worktree-verify',target,base,'/work/pnpm-owner.json');assert.equal(result.passed,true);assert.equal(result.results.length,3);assert(result.results.every(r=>r.exit===0));
 assert.equal(result.deliveryAuthorized,false);assert(fs.existsSync(path.join(target,'packages/app/dist/index.js')));
});
else{results.push({id:'C19 real pnpm workspace',status:'not-run',reason:'Optional fixed tooling tarballs not supplied'});fs.writeFileSync('results.json',JSON.stringify({results,aiCalls:0,modelQualityEvaluated:false},null,2));}
// Current-Host coordination: ordinary Git integrates code; ASC observes/verifies.
// Scripted owner decisions below are not an automatic AI planning benchmark.
const coordinated='/work/coordinated',producer='/work/producer',consumer='/work/consumer',independent='/work/independent';let coordinationBase,producerHead,independentHead,accepted;
const owner='/work/coordination-owner.json',independentOwner='/work/independent-owner.json';
const verifyConsumer=()=>invoke(launcher(consumer),'worktree-verify',consumer,coordinationBase,owner);
const rejectedConsumer=()=>{const r=spawnSync(process.execPath,[launcher(consumer),'worktree-verify',consumer,coordinationBase,owner],{encoding:'utf8'});assert.equal(r.status,2,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.passed,false);assert.equal(v.results[0].exit,1);return v;};
check('C20 dependent work fails until integrated while independent work remains usable',()=>{
 fs.cpSync(project,coordinated,{recursive:true});install(coordinated,versionB);invoke(cli(coordinated),'project-assets',coordinated,'--apply');
 write(path.join(coordinated,'.gitignore'),'.agent-skill-chain/node_modules/\n');write(path.join(coordinated,'api.cjs'),"module.exports={greeting:'Hello'};\n");write(path.join(coordinated,'REQUIREMENTS.md'),'Initial greeting contract.\n');
 git(coordinated,'init','-q','-b','develop');git(coordinated,'config','user.name','Synthetic');git(coordinated,'config','user.email','synthetic@example.invalid');git(coordinated,'add','.');git(coordinated,'commit','-qm','coordination base');coordinationBase=git(coordinated,'rev-parse','HEAD');
 for(const [branch,dir] of [['producer',producer],['consumer',consumer],['independent',independent]])git(coordinated,'worktree','add','-b',branch,dir);
 write(path.join(producer,'api.cjs'),"module.exports={label:'Hello'};\n");write(path.join(producer,'REQUIREMENTS.md'),'Response uses label; consumer displays Hello.\n');git(producer,'add','api.cjs','REQUIREMENTS.md');git(producer,'commit','-qm','owner-selected API contract');producerHead=git(producer,'rev-parse','HEAD');
 write(path.join(consumer,'consumer.cjs'),"require('assert').equal(require('./api.cjs').label,'Hello');\n");git(consumer,'add','consumer.cjs');git(consumer,'commit','-qm','dependent consumer');
 write(owner,JSON.stringify({intent:'Display label from approved API contract',allowedPaths:['api.cjs','REQUIREMENTS.md','consumer.cjs'],commands:[[process.execPath,'consumer.cjs']]}));
 const failed=rejectedConsumer();assert.match(failed.results[0].stderr,/AssertionError/);
 write(path.join(independent,'independent.cjs'),"require('assert').equal(2+2,4);\n");git(independent,'add','independent.cjs');git(independent,'commit','-qm','unrelated issue');independentHead=git(independent,'rev-parse','HEAD');
 write(independentOwner,JSON.stringify({intent:'Independent calculation',allowedPaths:['independent.cjs'],commands:[[process.execPath,'independent.cjs']]}));assert.equal(invoke(launcher(independent),'worktree-verify',independent,coordinationBase,independentOwner).passed,true);
 git(consumer,'cherry-pick',producerHead);accepted=verifyConsumer();assert.equal(accepted.passed,true);assert.notEqual(failed.head,accepted.head);assert.equal(git(producer,'rev-parse','HEAD'),producerHead);assert.equal(git(independent,'rev-parse','HEAD'),independentHead);
 write('/work/coordination-evidence.json',JSON.stringify({initialFailure:failed,integrated:accepted,independentHead},null,2));
});
check('C21 changed requirements invalidate prior head and only affected consumer is repaired',()=>{
 const before=accepted;write(path.join(consumer,'REQUIREMENTS.md'),'Revised owner requirement: label is Hello!\n');write(path.join(consumer,'api.cjs'),"module.exports={label:'Hello!'};\n");git(consumer,'add','api.cjs','REQUIREMENTS.md');git(consumer,'commit','-qm','owner revises contract');
 const contract=JSON.parse(fs.readFileSync(owner));contract.intent='Display revised label Hello!';write(owner,JSON.stringify(contract));const failed=rejectedConsumer();assert.notEqual(failed.head,before.head);assert.notEqual(failed.contractSha256,before.contractSha256);
 write(path.join(consumer,'consumer.cjs'),"require('assert').equal(require('./api.cjs').label,'Hello!');\n");git(consumer,'add','consumer.cjs');git(consumer,'commit','-qm','repair affected consumer');
 // A new CLI process reconstructs target/contract from disk; no old result is input.
 assert.equal(invoke(launcher(consumer),'start',consumer,'--path','consumer.cjs').head,git(consumer,'rev-parse','HEAD'));accepted=verifyConsumer();assert.equal(accepted.passed,true);assert.equal(git(independent,'rev-parse','HEAD'),independentHead);assert.equal(git(producer,'rev-parse','HEAD'),producerHead);
 const evidence=JSON.parse(fs.readFileSync('/work/coordination-evidence.json'));Object.assign(evidence,{changedRequirementFailure:failed,repaired:accepted});write('/work/coordination-evidence.json',JSON.stringify(evidence,null,2));
});
check('C22 integration conflict preserves accepted work and does not globally block other issues',()=>{
 const competing='/work/competing';git(coordinated,'worktree','add','-b','competing',competing,coordinationBase);write(path.join(competing,'api.cjs'),"module.exports={label:'Alternative'};\n");git(competing,'add','api.cjs');git(competing,'commit','-qm','competing contract');
 const oldHead=git(consumer,'rev-parse','HEAD'),oldBytes=fs.readFileSync(path.join(consumer,'api.cjs'));
 const conflict=spawnSync('git',['cherry-pick',git(competing,'rev-parse','HEAD')],{cwd:consumer,encoding:'utf8'});assert.equal(conflict.status,1);assert(git(consumer,'ls-files','--unmerged'));
 const refusal=spawnSync(process.execPath,[launcher(consumer),'worktree-verify',consumer,coordinationBase,owner],{encoding:'utf8'});assert.notEqual(refusal.status,0);assert.match(refusal.stderr,/Commit intended changes/);
 assert.equal(invoke(launcher(independent),'worktree-verify',independent,coordinationBase,independentOwner).passed,true);
 git(consumer,'cherry-pick','--abort');assert.equal(git(consumer,'rev-parse','HEAD'),oldHead);assert.deepEqual(fs.readFileSync(path.join(consumer,'api.cjs')),oldBytes);const resumed=verifyConsumer();assert.equal(resumed.passed,true);assert.equal(resumed.head,accepted.head);
 const evidence=JSON.parse(fs.readFileSync('/work/coordination-evidence.json'));Object.assign(evidence,{conflictDetected:true,conflictingVerificationRefused:true,afterAbort:resumed});write('/work/coordination-evidence.json',JSON.stringify(evidence,null,2));
});
check('C17 manifest-scoped manual removal preserves all user-owned files',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(project,'.agent-skill-chain/distribution.json')));
 const edited='.agent-skill-chain/v05/USAGE.md';fs.appendFileSync(path.join(project,edited),'\nuser-owned amendment\n');const retained=[];
 for(const [name,digest] of Object.entries(manifest.files)){const file=path.join(project,name);if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==digest){retained.push(name);continue;}fs.unlinkSync(file);}
 assert.deepEqual(retained,[edited]);assert(fs.readFileSync(path.join(project,edited),'utf8').includes('user-owned amendment'));fs.unlinkSync(path.join(project,'.agent-skill-chain/distribution.json'));
 assert.equal(fs.readFileSync(path.join(project,'rules/ui.md'),'utf8'),'private-rule-body');assert(fs.existsSync(path.join(project,'.agent-skill-chain/project/context.json')));assert(!fs.existsSync(launcher(project)));
});
if(results.some(r=>r.status==='failed'))process.exitCode=1;
