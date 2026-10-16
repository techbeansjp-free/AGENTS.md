import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

test('packed Node distribution runs without source checkout, Python or dependencies',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-packed-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 // Use npm's real CLI module, without a shell or lifecycle scripts.
 const npm=process.env.npm_execpath || path.resolve(path.dirname(process.execPath),
   process.platform==='win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
 const tarballs=JSON.parse(execFileSync(process.execPath,[npm,'pack','--ignore-scripts','--json','--pack-destination',root],{cwd:process.cwd(),encoding:'utf8'}));
 const install=path.join(root,'isolated');fs.mkdirSync(install);
 execFileSync(process.execPath,[npm,'install','--prefix',install,'--ignore-scripts','--no-audit','--no-fund','--offline',path.join(root,tarballs[0].filename)],{stdio:'pipe'});
 const packageRoot=path.join(install,'node_modules/agent-skill-chain');
 const cli=path.join(packageRoot,'bin/asc-v05.mjs');
 const templates=path.join(packageRoot,'v05/templates/specs');
 const guide=fs.readFileSync(path.join(templates,'00_利用案内.md'),'utf8');
 for(const match of guide.matchAll(/\]\(([^)]+)\)/g)){
  const relative=match[1];assert(!path.isAbsolute(relative)&&!relative.split('/').includes('..'));
  const installedTemplate=fs.readFileSync(path.join(templates,relative),'utf8');
  assert.equal(installedTemplate,fs.readFileSync(path.join('v05/templates/specs',relative),'utf8'));
 }

 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'99.0.0'}));
 assert.equal(execFileSync(process.execPath,[cli,'--version'],{cwd:root,encoding:'utf8'}).trim(),JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version);
 for(const args of [[],['--help'],['-h']]){
  const help=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
  assert.equal(help.status,0);assert.equal(help.stderr,'');assert.match(help.stdout,/run-adaptive/);assert.match(help.stdout,/USAGE\.md/);
 }
 const extraHelp=spawnSync(process.execPath,[cli,'--help','ignored'],{cwd:root,encoding:'utf8'});assert.equal(extraHelp.status,1);
 const extraVersion=spawnSync(process.execPath,[cli,'--version','ignored'],{cwd:root,encoding:'utf8'});assert.equal(extraVersion.status,1);
 const result=JSON.parse(execFileSync(process.execPath,[cli,'capabilities'],{cwd:root,encoding:'utf8'}));
 assert(result.commands.includes('review'));assert.equal(result.releaseReady,true);assert.equal(result.releaseTarget,'native-linux');assert.equal(result.publishAuthorized,false);assert.equal(result.legacyFallback,false);
 assert.equal(fs.existsSync(path.join(packageRoot,'harness.py')),false);
 const bad=spawnSync(process.execPath,[cli,'run'],{cwd:root,encoding:'utf8'});
 assert.equal(bad.status,1);
 const req=createRequire(path.join(packageRoot,'package.json'));
 assert.equal(Object.keys(req('./package.json').dependencies ?? {}).length,0);
 const malformed=spawnSync(process.execPath,[cli,'approval-verify'],{cwd:root,input:'{"approved":true}',encoding:'utf8'});
 assert.equal(malformed.status,1);
 const repo=path.join(root,'project');fs.mkdirSync(repo);
 const git=(...a)=>execFileSync('git',a,{cwd:repo,encoding:'utf8',stdio:'pipe'});
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'file'),'base');git('add','.');git('commit','-qm','base');
 const owner=path.join(root,'owner-request.json');
 fs.writeFileSync(owner,JSON.stringify({repo}));
 const refused=spawnSync(process.execPath,[cli,'run','--snapshot',owner],{encoding:'utf8'});
 assert.equal(refused.status,1);assert.match(refused.stderr,/dedicated Git worktree/);
 fs.writeFileSync(owner,JSON.stringify({repo,workspaceMode:'isolated-clone'}));
 const explicit=spawnSync(process.execPath,[cli,'run','--snapshot',owner],{encoding:'utf8'});
 assert.equal(explicit.status,1);assert.match(explicit.stderr,/Host-pinned Codex|Execution isolation unsupported/);
 const work=path.join(root,'work');git('worktree','add','-b','task',work);
 fs.writeFileSync(owner,JSON.stringify({repo:work}));
 const started=JSON.parse(execFileSync(process.execPath,[cli,'start',work],{encoding:'utf8'}));assert.equal(started.execution,'current-host-worktree');assert.equal(started.providerLaunch,false);assert(fs.existsSync(started.skill));
 const workBase=execFileSync('git',['rev-parse','HEAD'],{cwd:work,encoding:'utf8'}).trim();
 const nativeOwner=path.join(root,'native-owner.json');fs.writeFileSync(nativeOwner,JSON.stringify({intent:'Verify existing project',allowedPaths:['file'],commands:[[process.execPath,'-e',"require('assert').equal(require('fs').readFileSync('file','utf8'),'base')"]]}));
 const checked=JSON.parse(execFileSync(process.execPath,[cli,'worktree-verify',work,workBase,nativeOwner],{encoding:'utf8'}));assert.equal(checked.passed,true);assert.equal(checked.deliveryAuthorized,false);
 const assetWork=path.join(root,'asset-work');git('worktree','add','-b','assets',assetWork);
 const assetPreview=JSON.parse(execFileSync(process.execPath,[cli,'project-assets',assetWork],{encoding:'utf8'}));assert.equal(assetPreview.applied,false);assert(assetPreview.changes.length>50);
 const assetApply=JSON.parse(execFileSync(process.execPath,[cli,'project-assets',assetWork,'--apply'],{encoding:'utf8'}));assert.equal(assetApply.applied,true);
 assert.equal(fs.readFileSync(path.join(assetWork,'.agent-skill-chain/templates/specs/01_要求定義.md'),'utf8'),fs.readFileSync(path.join(templates,'01_要求定義.md'),'utf8'));
 const projectSkill=fs.readFileSync(path.join(assetWork,'.agent-skill-chain/skills/asc/SKILL.md'),'utf8');assert(projectSkill.includes(cli));assert.doesNotMatch(projectSkill,/\.\.\/\.\.\//);
 const registration=JSON.parse(execFileSync(process.execPath,[cli,'project-assets',assetWork,'--register-skill','--apply'],{encoding:'utf8'}));assert.equal(registration.applied,true);
 const registeredEntry=path.join(assetWork,'.agents/skills/asc/SKILL.md');const registeredText=fs.readFileSync(registeredEntry,'utf8');
 const projectReference=/\]\(([^)]+)\)/.exec(registeredText)[1];assert.equal(fs.realpathSync(path.resolve(path.dirname(registeredEntry),projectReference)),fs.realpathSync(path.join(assetWork,'.agent-skill-chain/skills/asc/SKILL.md')));
 const assetAgain=JSON.parse(execFileSync(process.execPath,[cli,'project-assets',assetWork],{encoding:'utf8'}));assert.deepEqual(assetAgain.changes,[]);assert.equal(assetAgain.recordChanged,false);assert.deepEqual(assetAgain.retained,['.agents/skills/asc/SKILL.md']);
 const linked=spawnSync(process.execPath,[cli,'run-goal','--snapshot',owner],{encoding:'utf8'});
 assert.equal(linked.status,1);assert.doesNotMatch(linked.stderr,/dedicated Git worktree/);
 const reviewRefused=spawnSync(process.execPath,[cli,'review','--snapshot',owner],{encoding:'utf8'});assert.equal(reviewRefused.status,1);assert.match(reviewRefused.stderr,/Host-pinned Codex|Execution isolation unsupported/);
 const internalOwner=path.join(work,'request.json');fs.writeFileSync(internalOwner,JSON.stringify({repo:work}));const internalReview=spawnSync(process.execPath,[cli,'review','--snapshot',internalOwner],{encoding:'utf8'});assert.equal(internalReview.status,1);assert.match(internalReview.stderr,/outside candidate/);

 if(process.platform==='linux'&&process.env.ASC_TEST_ISOLATION!=='0'){
  fs.unlinkSync(internalOwner);const base=execFileSync('git',['rev-parse','HEAD'],{cwd:work,encoding:'utf8'}).trim();fs.writeFileSync(path.join(work,'file'),'candidate');execFileSync('git',['add','file'],{cwd:work});execFileSync('git',['commit','-qm','candidate'],{cwd:work});
  fs.writeFileSync(owner,JSON.stringify({repo:work,base,codexExecutable:process.execPath,model:'must-not-launch',contract:{intent:'Owner candidate review',criteria:['must pass'],allowedPaths:['file'],testArgv:['/bin/false'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'fixture',risks:[],unresolved:[],requiresDesign:false,design:''}}));
  const failed=spawnSync(process.execPath,[cli,'review','--snapshot',owner],{encoding:'utf8'});assert.equal(failed.status,1);const diagnostic=JSON.parse(failed.stdout);assert.equal(diagnostic.status,'blocked');assert.deepEqual(diagnostic.calls,[]);assert.equal(diagnostic.controllerEvents.find(e=>e.operation==='verify').results[0].exit,1);assert.match(failed.stderr,/Verification/);
  t.after(()=>fs.rmSync(diagnostic.root,{recursive:true,force:true}));
 }


});

for(const version of [null,'0.5.0'])test(`canonical ${version??'alpha'} candidate installs both CLI names without enabling legacy commands or publication`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-canonical-package-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const packArgs=['scripts/pack-candidate.mjs',root,...(version?[`--version=${version}`]:[])];
 const output=JSON.parse(execFileSync(process.execPath,packArgs,{encoding:'utf8'}));
 assert.equal(output.name,'agent-skill-chain');assert.equal(output.publishAuthorized,false);
 const npm=process.env.npm_execpath||path.resolve(path.dirname(process.execPath),process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'../lib/node_modules/npm/bin/npm-cli.js');
 const consumer=path.join(root,'consumer');fs.mkdirSync(consumer);
 execFileSync(process.execPath,[npm,'install','--prefix',consumer,'--offline','--ignore-scripts','--no-audit','--no-fund',output.file],{stdio:'pipe'});
 const installed=path.join(consumer,'node_modules/agent-skill-chain'),pkg=JSON.parse(fs.readFileSync(path.join(installed,'package.json')));
 const skillRoot=path.join(installed,'skills/asc'),skill=fs.readFileSync(path.join(skillRoot,'SKILL.md'),'utf8');
 for(const match of skill.matchAll(/\]\(([^)]+)\)/g))assert(fs.existsSync(path.resolve(skillRoot,match[1])),match[1]);
 assert.equal(path.resolve(skillRoot,'../../bin/asc-v05.mjs'),path.join(installed,'bin/asc-v05.mjs'));
 assert.equal(pkg.version,version??JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version);assert.equal(pkg.private,true);assert.deepEqual(Object.keys(pkg.bin),['agent-skill-chain','asc-v05']);
 for(const [name,entry] of Object.entries(pkg.bin)){
  const link=path.join(consumer,'node_modules/.bin',name);assert(fs.existsSync(link+(process.platform==='win32'?'.cmd':'')));
  const capability=JSON.parse(process.platform==='win32'?execFileSync(process.execPath,[path.join(installed,entry),'capabilities'],{encoding:'utf8'}):execFileSync(link,['capabilities'],{encoding:'utf8'}));assert.equal(capability.releaseReady,true);assert.equal(capability.releaseTarget,'native-linux');assert.equal(capability.publishAuthorized,false);assert.equal(capability.legacyFallback,false);
  const reported=process.platform==='win32'?execFileSync(process.execPath,[path.join(installed,entry),'--version'],{cwd:root,encoding:'utf8'}):execFileSync(link,['--version'],{cwd:root,encoding:'utf8'});assert.equal(reported.trim(),pkg.version);
  const legacy=spawnSync(process.execPath,[path.join(installed,entry),'workflow','advance'],{encoding:'utf8'});assert.equal(legacy.status,1);assert.match(legacy.stderr,/Usage:/);
 }
 const identity=JSON.parse(fs.readFileSync(path.join(installed,'release-identity.json')));assert.equal(identity.status,'unapproved-candidate');assert.equal(identity.published,false);
 const {createHash}=createRequire(import.meta.url)('node:crypto');const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(fs.readFileSync(path.join(installed,'package.json'))),identity.distributionManifestSha256);
 assert.equal(identity.schema,'asc-candidate-identity/v2');assert.equal(identity.sourceManifestSha256,hash(fs.readFileSync('package.json')));assert.equal(Object.hasOwn(identity.sourceFiles,'package.json'),false);
 for(const [name,digest] of Object.entries(identity.sourceFiles))assert.equal(hash(fs.readFileSync(path.join(installed,name))),digest,name);
 assert.throws(()=>execFileSync(process.execPath,packArgs,{stdio:'pipe'}),/Command failed/);
});

test('canonical version override rejects invalid or out-of-line versions before packaging',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-invalid-version-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const version of ['../escape','0.4.9','0.5.01','0.6.0','0.5.0 --publish']){
  const result=spawnSync(process.execPath,['scripts/pack-candidate.mjs',root,`--version=${version}`],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/Usage:/);assert.deepEqual(fs.readdirSync(root),[]);
 }
});

test('repository root package installs only the v0.5 runtime through the canonical CLI',t=>{
 const repository=process.cwd();
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-root-package-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const npm=process.env.npm_execpath||path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
 // Normal pack/install: lifecycle scripts must not build the legacy runtime.
 const packed=JSON.parse(execFileSync(process.execPath,[npm,'pack','--json','--pack-destination',root],{cwd:repository,encoding:'utf8'}))[0];
 assert(packed.files.every(f=>f.path==='package.json'||f.path==='README.md'||f.path==='LICENSE'||['v05/','src/','bin/','skills/'].some(prefix=>f.path.startsWith(prefix))||f.path==='migration_inspect.mjs'), 'legacy assets must not be distributed');
 assert(!packed.files.some(f=>/test_|\.agent-skill-chain\/|^dist\//.test(f.path)));
 const consumer=path.join(root,'consumer');fs.mkdirSync(consumer);
 execFileSync(process.execPath,[npm,'install','--prefix',consumer,'--offline','--no-audit','--no-fund',path.join(root,packed.filename)],{stdio:'pipe'});
 const installed=path.join(consumer,'node_modules/agent-skill-chain');const pkg=JSON.parse(fs.readFileSync(path.join(installed,'package.json')));
 assert.equal(pkg.version,JSON.parse(fs.readFileSync('package.json')).version);
 assert.equal(Object.hasOwn(pkg,'agentSkillChain'),false,'legacy quality-contract metadata must not claim v0.5 compatibility');
 // Public development commands must not silently execute the retired Step runtime.
 for(const [name,command] of Object.entries(pkg.scripts)){
  if(name.endsWith(':legacy'))continue;
  assert.doesNotMatch(command,/scripts\/|cucumber|compile|workflow:|audit:/,name);
 }
 for(const name of ['workflow:check','test:unit','test:integration','test:e2e','quality:legacy'])assert.equal(Object.hasOwn(pkg.scripts,name),false,name);
 assert.equal(pkg.scripts.lint,'eslint src bin test v05');
 for(const policyFormat of ['flat','manifest']){
  const roundtrip=JSON.parse(execFileSync(process.execPath,['v05/evaluation/configuration-roundtrip.mjs',installed,policyFormat],{encoding:'utf8'}));
  t.after(()=>fs.rmSync(roundtrip.root,{recursive:true,force:true}));
  assert.equal(roundtrip.status,'passed');
 }
 const project=path.join(root,'legacy-project');fs.mkdirSync(project);
 const git=(...args)=>execFileSync('git',args,{cwd:project,stdio:'pipe'});git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');fs.writeFileSync(path.join(project,'README.md'),'Synthetic migration inspection fixture\n');fs.mkdirSync(path.join(project,'.agent-skill-chain'));fs.writeFileSync(path.join(project,'.agent-skill-chain/project-policy.json'),JSON.stringify({schemaVersion:'agent-skill-chain/project-policy/v0.3.1'}));git('add','README.md','.agent-skill-chain/project-policy.json');git('commit','-qm','baseline');
 const migration=JSON.parse(execFileSync(process.execPath,[path.join(installed,pkg.bin['agent-skill-chain']),'migration-inspect',project],{encoding:'utf8'}));assert.equal(migration.readyToMigrate,false);assert.deepEqual(migration.dirty,[]);assert.deepEqual(migration.blockers,['migration-execution-not-performed']);
 for(const name of ['agent-skill-chain','asc-v05']){
  const cli=path.join(installed,pkg.bin[name]);
  assert.equal(execFileSync(process.execPath,[cli,'--version'],{encoding:'utf8'}).trim(),pkg.version);
  const capabilities=JSON.parse(execFileSync(process.execPath,[cli,'capabilities'],{encoding:'utf8'}));assert.equal(capabilities.legacyFallback,false);
  const old=spawnSync(process.execPath,[cli,'workflow','advance'],{encoding:'utf8'});assert.equal(old.status,1);
 }
 const skill=path.join(installed,'skills/asc/SKILL.md');assert(fs.existsSync(skill));assert(fs.existsSync(path.resolve(path.dirname(skill),'../../bin/asc-v05.mjs')));
});


test('root release candidate stamps the sole manifest without modifying source or enabling publication',t=>{
 const repository=process.cwd();
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-root-release-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=fs.readFileSync('package.json'),rootSource=fs.readFileSync(path.join(repository,'package.json'));
 const output=JSON.parse(execFileSync(process.execPath,['scripts/pack-candidate.mjs',root,'--version=0.5.0'],{cwd:repository,encoding:'utf8'}));
 const npm=process.env.npm_execpath||path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
 const consumer=path.join(root,'consumer');fs.mkdirSync(consumer);
 execFileSync(process.execPath,[npm,'install','--prefix',consumer,'--offline','--no-audit','--no-fund',output.file],{stdio:'pipe'});
 const installed=path.join(consumer,'node_modules/agent-skill-chain');
 const pkg=JSON.parse(fs.readFileSync(path.join(installed,'package.json')));
 assert.equal(pkg.version,'0.5.0');assert.equal(pkg.private,true);assert.equal(output.publishAuthorized,false);
 assert.equal(pkg.scripts,undefined);
 for(const entry of Object.values(pkg.bin))assert.equal(execFileSync(process.execPath,[path.join(installed,entry),'--version'],{encoding:'utf8'}).trim(),'0.5.0');
 const identity=JSON.parse(fs.readFileSync(path.join(installed,'release-identity.json')));
 const {createHash}=createRequire(import.meta.url)('node:crypto');const hash=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(identity.published,false);assert.equal(identity.status,'unapproved-candidate');assert.deepEqual(identity.transformedManifests,{});
 for(const [name,digest] of Object.entries(identity.sourceFiles))assert.equal(hash(fs.readFileSync(path.join(installed,name))),digest);
 assert.deepEqual(fs.readFileSync('package.json'),source);
 assert.deepEqual(fs.readFileSync(path.join(repository,'package.json')),rootSource);
});
