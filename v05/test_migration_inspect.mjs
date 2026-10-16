import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectMigration} from './migration_inspect.mjs';

function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-migration-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd:root,stdio:'pipe'});
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.mkdirSync(path.join(root,'.agent-skill-chain'));
 fs.writeFileSync(path.join(root,'.agent-skill-chain/project-policy.json'),JSON.stringify({schemaVersion:'agent-skill-chain/project-policy/v0.3.1'}));
 fs.writeFileSync(path.join(root,'AGENTS.md'),'User-owned instructions\n');
 git('add','.');git('commit','-qm','fixture');
 return {root,git};
}
test('read-only inspection preserves files and never promotes legacy records',t=>{
 const {root,git}=fixture(t);const before=git('status','--porcelain').toString();
 const result=inspectMigration(root);
 assert.equal(result.readyToMigrate,false);assert.deepEqual(result.dirty,[]);
 assert.deepEqual(result.blockers,['migration-execution-not-performed']);
 assert(result.inventory.every(x=>x.disposition==='preserve-as-input-not-approval'));
 assert.equal(git('status','--porcelain').toString(),before);
 assert.equal(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),'User-owned instructions\n');
});
test('dirty and runtime projects remain blocked without modifying them',t=>{
 const {root}=fixture(t);fs.writeFileSync(path.join(root,'AGENTS.md'),'local edit');
 fs.mkdirSync(path.join(root,'.agent-skill-chain/runtime'));
 const result=inspectMigration(root);
 assert(result.blockers.includes('worktree-changes'));
 assert(result.blockers.includes('owner-must-resolve-runtime-state'));
 assert.equal(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),'local edit');
});
test('unsupported policy never becomes migration authority',t=>{
 const {root}=fixture(t);
 fs.writeFileSync(path.join(root,'.agent-skill-chain/project-policy.json'),'{"schemaVersion":"unknown"}');
 assert(inspectMigration(root).blockers.includes('unsupported-policy'));
});

test('staged-only changes cannot appear clean',t=>{
 const {root,git}=fixture(t);const file=path.join(root,'AGENTS.md');const original=fs.readFileSync(file);
 fs.writeFileSync(file,'staged-only');git('add','AGENTS.md');fs.writeFileSync(file,original);
 assert(inspectMigration(root).dirty.includes('AGENTS.md'));
});
test('FIFO cannot block inspection',{skip:process.platform==='win32'},t=>{
 const {root}=fixture(t);const file=path.join(root,'AGENTS.md');fs.unlinkSync(file);
 execFileSync('mkfifo',[file]);
 const result=JSON.parse(execFileSync(process.execPath,[path.resolve('migration_inspect.mjs'),root],{timeout:5000}).toString());
 assert(result.unsupported.includes('AGENTS.md'));
});
test('executable mode changes are reported',{skip:process.platform==='win32'},t=>{
 const {root}=fixture(t);fs.chmodSync(path.join(root,'AGENTS.md'),0o755);
 assert(inspectMigration(root).dirty.includes('AGENTS.md'));
});


test('unknown wrapper cannot borrow a supported inner policy version',t=>{
 const {root,git}=fixture(t);fs.writeFileSync(path.join(root,'.agent-skill-chain/project-policy.json'),JSON.stringify({schemaVersion:'unknown-wrapper/v1',policy:{schemaVersion:'agent-skill-chain/project-policy/v0.3.1'}}));git('add','.');git('commit','-qm','unknown wrapper');
 const r=inspectMigration(root);assert.equal(r.policyFormat,'unsupported');assert(r.blockers.includes('unsupported-policy'));
});
test('manifest and configuration inventory is preserved but never authorizes cutover',t=>{
 const {root,git}=fixture(t);
 for(const name of ['package.json','.agents/skills/asc/SKILL.md','.github/workflows/check.yml','.agent-skill-chain/project/rules/local.json']){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),'{}');}
 fs.writeFileSync(path.join(root,'.agent-skill-chain/project-policy.json'),JSON.stringify({schemaVersion:'agent-skill-chain/project-policy-manifest/v1',policy:{schemaVersion:'agent-skill-chain/project-policy/v0.3.1'},choiceFiles:[],ruleFiles:['project/rules/local.json','../outside.json'],conformanceFiles:[]}));git('add','.');git('commit','-qm','manifest');
 const before=git('status','--porcelain').toString(),r=inspectMigration(root);
 assert.equal(r.policyFormat,'manifest');assert(r.blockers.includes('manifest-policy-cutover-required'));assert(r.blockers.includes('unresolved-policy-references'));
 assert.deepEqual(r.policyReferences,['.agent-skill-chain/project/rules/local.json']);assert.deepEqual(r.invalidPolicyReferences,['ruleFiles:../outside.json']);
 for(const category of ['cli-dependencies','agent-entry','ci','project-policy'])assert(r.configurationInventory.some(x=>x.category===category&&/^[a-f0-9]{64}$/.test(x.sha256)));
 assert(r.inventory.some(x=>x.path==='.agent-skill-chain/project/rules/local.json'));assert.equal(git('status','--porcelain').toString(),before);
});

test('canonical legacy skills and hooks require explicit cutover decisions without execution',async t=>{
 const {root,git}=fixture(t);const {stageMigration}=await import('./src/migration.mjs');
 const names=['.agent-skill-chain/skills/asc-step/SKILL.md','.agent-skill-chain/hooks/asc-host-observer.mjs'];
 for(const name of names){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),name.endsWith('.mjs')?"throw Error('legacy hook must not execute');\n":'Legacy Step contract\n');}
 git('add','.');git('commit','-qm','canonical legacy execution assets');const before=git('rev-parse','HEAD').toString().trim(),inspection=inspectMigration(root);
 for(const name of names)assert(inspection.configurationInventory.some(x=>x.path===name&&x.category==='agent-entry'));
 const destination=root+'-transition';t.after(()=>fs.rmSync(destination,{recursive:true,force:true}));const plan={schema:'asc-v05-cutover/v1',sourceHead:before,files:inspection.configurationInventory.map(e=>({path:e.path,beforeSha256:e.sha256,action:'retain'}))};
 assert.throws(()=>stageMigration(root,destination,{...plan,files:plan.files.filter(e=>e.path!==names[0])}));assert(!fs.existsSync(destination));
 const staged=stageMigration(root,destination,plan);for(const name of names)assert.equal(fs.readFileSync(path.join(staged.candidate,name),'utf8'),fs.readFileSync(path.join(root,name),'utf8'));
 assert.equal(git('rev-parse','HEAD').toString().trim(),before);
});

test('unconfigured legacy install retains its inventory and requires owner policy',async t=>{
 const {root,git}=fixture(t);git('rm','.agent-skill-chain/project-policy.json');git('commit','-qm','legacy installed before project setup');
 const entry='.agents/skills/asc-step/SKILL.md';fs.mkdirSync(path.dirname(path.join(root,entry)),{recursive:true});fs.writeFileSync(path.join(root,entry),'Legacy entry, not authority\n');git('add','.');git('commit','-qm','installed entry');
 const before=git('status','--porcelain').toString(),head=git('rev-parse','HEAD').toString();
 const result=inspectMigration(root);
 assert.equal(result.policyFormat,'missing-policy');assert.equal(result.policySchema,null);
 assert(result.blockers.includes('missing-project-policy'));assert.equal(result.readyToMigrate,false);
 assert(result.configurationInventory.some(x=>x.path===entry));
 const {prepareMigration}=await import('./src/migration.mjs');const holder=fs.mkdtempSync(path.join(os.tmpdir(),'asc-missing-policy-'));t.after(()=>fs.rmSync(holder,{recursive:true,force:true}));const destination=path.join(holder,'transition');
 assert.throws(()=>prepareMigration(root,destination),/inspection blockers/);
 assert.equal(fs.existsSync(destination),false);assert.equal(git('status','--porcelain').toString(),before);assert.equal(git('rev-parse','HEAD').toString(),head);
});
