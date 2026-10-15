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
 const packageRoot=path.join(install,'node_modules/asc-v05-evaluation');
 const cli=path.join(packageRoot,'bin/asc-v05.mjs');
 const result=JSON.parse(execFileSync(process.execPath,[cli,'capabilities'],{cwd:root,encoding:'utf8'}));
 assert(result.commands.includes('review'));assert.equal(result.releaseReady,false);assert.equal(result.legacyFallback,false);
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
 const refused=spawnSync(process.execPath,[cli,'run',owner],{encoding:'utf8'});
 assert.equal(refused.status,1);assert.match(refused.stderr,/dedicated Git worktree/);
 fs.writeFileSync(owner,JSON.stringify({repo,workspaceMode:'isolated-clone'}));
 const explicit=spawnSync(process.execPath,[cli,'run',owner],{encoding:'utf8'});
 assert.equal(explicit.status,1);assert.match(explicit.stderr,/Host-pinned Codex|Execution isolation unsupported/);
 const work=path.join(root,'work');git('worktree','add','-b','task',work);
 fs.writeFileSync(owner,JSON.stringify({repo:work}));
 const linked=spawnSync(process.execPath,[cli,'run-goal',owner],{encoding:'utf8'});
 assert.equal(linked.status,1);assert.doesNotMatch(linked.stderr,/dedicated Git worktree/);
 const reviewRefused=spawnSync(process.execPath,[cli,'review',owner],{encoding:'utf8'});assert.equal(reviewRefused.status,1);assert.match(reviewRefused.stderr,/Host-pinned Codex|Execution isolation unsupported/);
 const internalOwner=path.join(work,'request.json');fs.writeFileSync(internalOwner,JSON.stringify({repo:work}));const internalReview=spawnSync(process.execPath,[cli,'review',internalOwner],{encoding:'utf8'});assert.equal(internalReview.status,1);assert.match(internalReview.stderr,/outside candidate/);

 if(process.platform==='linux'&&process.env.ASC_TEST_ISOLATION!=='0'){
  fs.unlinkSync(internalOwner);const base=execFileSync('git',['rev-parse','HEAD'],{cwd:work,encoding:'utf8'}).trim();fs.writeFileSync(path.join(work,'file'),'candidate');execFileSync('git',['add','file'],{cwd:work});execFileSync('git',['commit','-qm','candidate'],{cwd:work});
  fs.writeFileSync(owner,JSON.stringify({repo:work,base,codexExecutable:process.execPath,model:'must-not-launch',contract:{intent:'Owner candidate review',criteria:['must pass'],allowedPaths:['file'],testArgv:['/bin/false'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'fixture',risks:[],unresolved:[],requiresDesign:false,design:''}}));
  const failed=spawnSync(process.execPath,[cli,'review',owner],{encoding:'utf8'});assert.equal(failed.status,1);const diagnostic=JSON.parse(failed.stdout);assert.equal(diagnostic.status,'blocked');assert.deepEqual(diagnostic.calls,[]);assert.equal(diagnostic.controllerEvents.find(e=>e.operation==='verify').results[0].exit,1);assert.match(failed.stderr,/Verification/);
  t.after(()=>fs.rmSync(diagnostic.root,{recursive:true,force:true}));
 }


});

test('canonical candidate installs both CLI names without enabling legacy commands or publication',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-canonical-package-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const output=JSON.parse(execFileSync(process.execPath,['scripts/pack-candidate.mjs',root],{encoding:'utf8'}));
 assert.equal(output.name,'agent-skill-chain');assert.equal(output.publishAuthorized,false);
 const npm=process.env.npm_execpath||path.resolve(path.dirname(process.execPath),process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'../lib/node_modules/npm/bin/npm-cli.js');
 const consumer=path.join(root,'consumer');fs.mkdirSync(consumer);
 execFileSync(process.execPath,[npm,'install','--prefix',consumer,'--offline','--ignore-scripts','--no-audit','--no-fund',output.file],{stdio:'pipe'});
 const installed=path.join(consumer,'node_modules/agent-skill-chain'),pkg=JSON.parse(fs.readFileSync(path.join(installed,'package.json')));
 const skillRoot=path.join(installed,'skills/asc'),skill=fs.readFileSync(path.join(skillRoot,'SKILL.md'),'utf8');
 for(const match of skill.matchAll(/\]\(([^)]+)\)/g))assert(fs.existsSync(path.resolve(skillRoot,match[1])),match[1]);
 assert.equal(path.resolve(skillRoot,'../../bin/asc-v05.mjs'),path.join(installed,'bin/asc-v05.mjs'));
 assert.equal(pkg.private,true);assert.deepEqual(Object.keys(pkg.bin),['agent-skill-chain','asc-v05']);
 for(const [name,entry] of Object.entries(pkg.bin)){
  const link=path.join(consumer,'node_modules/.bin',name);assert(fs.existsSync(link+(process.platform==='win32'?'.cmd':'')));
  const capability=JSON.parse(process.platform==='win32'?execFileSync(process.execPath,[path.join(installed,entry),'capabilities'],{encoding:'utf8'}):execFileSync(link,['capabilities'],{encoding:'utf8'}));assert.equal(capability.releaseReady,false);assert.equal(capability.legacyFallback,false);
  const legacy=spawnSync(process.execPath,[path.join(installed,entry),'workflow','advance'],{encoding:'utf8'});assert.equal(legacy.status,1);assert.match(legacy.stderr,/Usage:/);
 }
 const identity=JSON.parse(fs.readFileSync(path.join(installed,'release-identity.json')));assert.equal(identity.status,'unapproved-candidate');assert.equal(identity.published,false);
 const {createHash}=createRequire(import.meta.url)('node:crypto');const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(fs.readFileSync(path.join(installed,'package.json'))),identity.distributionManifestSha256);
 assert.equal(identity.schema,'asc-candidate-identity/v2');assert.equal(identity.sourceManifestSha256,hash(fs.readFileSync('package.json')));assert.equal(Object.hasOwn(identity.sourceFiles,'package.json'),false);
 for(const [name,digest] of Object.entries(identity.sourceFiles))assert.equal(hash(fs.readFileSync(path.join(installed,name))),digest,name);
 assert.throws(()=>execFileSync(process.execPath,['scripts/pack-candidate.mjs',root],{stdio:'pipe'}),/Command failed/);
});
