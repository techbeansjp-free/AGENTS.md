import {Controller} from './src/controller.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {prepareMigration,rollbackMigration,createWorktree} from './src/migration.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-transition-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'legacy');fs.mkdirSync(path.join(source,'.agent-skill-chain'),{recursive:true});
 const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(source,'.agent-skill-chain/project-policy.json'),JSON.stringify({schemaVersion:'agent-skill-chain/project-policy/v0.3.1'}));
 fs.writeFileSync(path.join(source,'AGENTS.md'),'Owner instructions');git('add','.');git('commit','-qm','legacy');
 return {root,source,git,destination:path.join(root,'transition')};
}
test('independent transition preserves Git history, owner files and candidate edits on rollback',t=>{
 const {source,git,destination}=fixture(t);const before=git('rev-parse','HEAD');
 const result=prepareMigration(source,destination);assert.equal(result.state,'prepared');assert.equal(result.legacyEvidenceImported,false);
 assert.equal(git('status','--porcelain'),'');assert.equal(git('rev-parse','HEAD'),before);
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:result.candidate,encoding:'utf8'}).trim(),before);
 assert.equal(execFileSync('git',['remote'],{cwd:result.candidate,encoding:'utf8'}).trim(),'');
 fs.writeFileSync(path.join(result.candidate,'AGENTS.md'),'Preserve v05 user edits');
 assert.equal(prepareMigration(source,destination).idempotent,true);
 const back=rollbackMigration(destination);assert.equal(back.selection,'legacy');assert.equal(back.authorityRestored,false);
 assert.equal(fs.readFileSync(path.join(result.candidate,'AGENTS.md'),'utf8'),'Preserve v05 user edits');
 assert.equal(fs.readFileSync(path.join(source,'AGENTS.md'),'utf8'),'Owner instructions');
 assert.equal(rollbackMigration(destination).selection,'legacy');
});
test('dirty source and unfinished transitions stop without overwriting files',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.source,'AGENTS.md'),'local edit');
 assert.throws(()=>prepareMigration(f.source,f.destination));assert.equal(fs.existsSync(f.destination),false);
 fs.mkdirSync(f.destination);fs.writeFileSync(path.join(f.destination,'transition.json'),JSON.stringify({schema:'asc-v05-transition/v1',state:'preparing',source:f.source,sourceHead:f.git('rev-parse','HEAD')}));
 fs.writeFileSync(path.join(f.destination,'keep'),'partial data');assert.throws(()=>prepareMigration(f.source,f.destination));
 assert.throws(()=>rollbackMigration(f.destination));assert.equal(fs.readFileSync(path.join(f.destination,'keep'),'utf8'),'partial data');
});
test('upload-pack hook cannot execute during migration clone',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),marker=path.join(f.root,'hook-ran');f.git('config','uploadpack.packObjectsHook',`touch '${marker}'; git pack-objects`);
 prepareMigration(f.source,f.destination);assert.equal(fs.existsSync(marker),false);
});
test('prepared legacy clone runs new workflow and rollback keeps both histories',{skip:process.platform!=='linux'||process.env.ASC_TEST_ISOLATION==='0'},async t=>{
 const {runWorkflow}=await import('./src/workflow.mjs');const f=fixture(t);
 fs.writeFileSync(path.join(f.source,'code.txt'),'before');fs.mkdirSync(path.join(f.source,'.agents/skills'),{recursive:true});
 fs.writeFileSync(path.join(f.source,'.agents/skills/old.md'),'Old workflow');f.git('add','.');f.git('commit','-qm','legacy fixture');
 const base=f.git('rev-parse','HEAD'),prepared=prepareMigration(f.source,f.destination);
 const contract={intent:'Write after',criteria:['exact after'],allowedPaths:['code.txt'],testArgv:['/bin/sh','-c','test "$(cat code.txt)" = after'],riskTestArgv:[],requiredChecks:['test'],policyRevision:'new-host-policy',risks:[],unresolved:[],requiresDesign:false,design:''};
 const provider={intent:()=>contract.intent,createDraft:()=>1,observe:()=>({head:execFileSync('git',['rev-parse','HEAD'],{cwd:prepared.candidate,encoding:'utf8'}).trim(),draft:true,merged:false,boundToPr:true,checks:{test:'success'}})};
 const agent=async({workspace,writable})=>{assert.equal(fs.existsSync(path.join(workspace,'.agents')),false);if(writable)fs.writeFileSync(path.join(workspace,'code.txt'),'after');return {context:writable?'worker':'reviewer',usage:[],seconds:0,answer:JSON.stringify({verdict:'pass',findings:[]})};};
 const r=await runWorkflow({repo:prepared.candidate,base,contract,codexExecutable:process.execPath,model:'test-double'},{agent,provider});t.after(()=>fs.rmSync(r.root,{recursive:true,force:true}));
 assert.equal(r.status,'draft-ci-passed');assert.equal(f.git('rev-parse','HEAD'),base);assert.equal(fs.readFileSync(path.join(f.source,'code.txt'),'utf8'),'before');
 const back=rollbackMigration(f.destination);assert.equal(back.authorityRestored,false);assert.equal(back.selection,'legacy');
 assert.equal(fs.readFileSync(path.join(prepared.candidate,'code.txt'),'utf8'),'after');assert.equal(fs.readFileSync(path.join(prepared.candidate,'.agents/skills/old.md'),'utf8'),'Old workflow');
});


test('prepare retry detects source edits even when source HEAD is unchanged',t=>{
 const f=fixture(t),prepared=prepareMigration(f.source,f.destination),before=f.git('rev-parse','HEAD');
 fs.writeFileSync(path.join(prepared.candidate,'AGENTS.md'),'candidate edits to preserve');
 fs.writeFileSync(path.join(f.source,'AGENTS.md'),'new legacy user edit');
 assert.equal(f.git('rev-parse','HEAD'),before);
 assert.throws(()=>prepareMigration(f.source,f.destination),/Legacy source changed/);
 assert.equal(fs.readFileSync(path.join(f.source,'AGENTS.md'),'utf8'),'new legacy user edit');
 assert.equal(fs.readFileSync(path.join(prepared.candidate,'AGENTS.md'),'utf8'),'candidate edits to preserve');
});

test('owner configuration cutover stages exact decisions and rollback preserves both projects',async t=>{
 const {stageMigration}=await import('./src/migration.mjs');const {inspectMigration}=await import('./migration_inspect.mjs');
 const f=fixture(t),before=f.git('rev-parse','HEAD');
 const plan={schema:'asc-v05-cutover/v1',sourceHead:before,files:inspectMigration(f.source).configurationInventory.map(e=>({path:e.path,beforeSha256:e.sha256,action:e.path==='AGENTS.md'?'replace':'retain',...(e.path==='AGENTS.md'?{content:'Use Goal and owner contract; no legacy approval import'}:{})}))};
 const r=stageMigration(f.source,f.destination,plan);
 assert.equal(r.selection,'v05-configuration-candidate');assert.equal(r.needsIndependentReview,true);
 assert.equal(f.git('status','--porcelain'),'');assert.equal(f.git('rev-parse','HEAD'),before);
 assert.equal(fs.readFileSync(path.join(f.source,'AGENTS.md'),'utf8'),'Owner instructions');
 assert.equal(fs.readFileSync(path.join(r.candidate,'AGENTS.md'),'utf8'),plan.files.find(e=>e.path==='AGENTS.md').content);
 fs.writeFileSync(path.join(r.candidate,'new-user-work'),'preserve');
 assert.throws(()=>stageMigration(f.source,f.destination,plan),/new location/);
 assert.equal(rollbackMigration(f.destination).selection,'legacy');
 assert.equal(fs.readFileSync(path.join(r.candidate,'new-user-work'),'utf8'),'preserve');
});

test('cutover rejects stale, omitted, duplicate or source-file decisions before creating destination',async t=>{
 const {stageMigration}=await import('./src/migration.mjs');const {inspectMigration}=await import('./migration_inspect.mjs');const f=fixture(t);
 const plan={schema:'asc-v05-cutover/v1',sourceHead:f.git('rev-parse','HEAD'),files:inspectMigration(f.source).configurationInventory.map(e=>({path:e.path,beforeSha256:e.sha256,action:'retain'}))};
 const cases=[{...plan,sourceHead:'0'.repeat(40)},{...plan,files:plan.files.slice(1)},
 {...plan,files:[...plan.files,plan.files[0]]}, {...plan,files:plan.files.map((e,i)=>i?e:{...e,beforeSha256:'0'.repeat(64)})},
 {...plan,files:[...plan.files,{path:'src/app.js',beforeSha256:'0'.repeat(64),action:'replace',content:'evil'}]}];
 for(const bad of cases){assert.throws(()=>stageMigration(f.source,f.destination,bad));assert.equal(fs.existsSync(f.destination),false);}
});


test('manifest cutover needs explicit decisions and never executes replacement settings',async t=>{
 const {stageMigration}=await import('./src/migration.mjs');const {inspectMigration}=await import('./migration_inspect.mjs');const f=fixture(t);
 const policy=path.join(f.source,'.agent-skill-chain/project-policy.json');
 fs.writeFileSync(policy,JSON.stringify({schemaVersion:'agent-skill-chain/project-policy-manifest/v1',choiceFiles:[],ruleFiles:[],conformanceFiles:[]}));
 fs.writeFileSync(path.join(f.source,'package.json'),JSON.stringify({scripts:{test:'exit 19'}}));f.git('add','.');f.git('commit','-qm','manifest and CLI config');
 const inspection=inspectMigration(f.source);
 assert.throws(()=>prepareMigration(f.source,f.destination),/blockers/);
 const plan={schema:'asc-v05-cutover/v1',sourceHead:inspection.head,files:inspection.configurationInventory.map(e=>({path:e.path,beforeSha256:e.sha256,action:'retain'}))};
 const pkg=plan.files.find(e=>e.path==='package.json');pkg.action='replace';pkg.content=JSON.stringify({scripts:{test:'exit 29'}});
 const result=stageMigration(f.source,f.destination,plan);
 assert.equal(result.needsFreshVerification,true);assert.equal(result.releaseReady,false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(result.candidate,'package.json'))).scripts.test,'exit 29');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.source,'package.json'))).scripts.test,'exit 19');
 assert.equal(f.git('status','--porcelain'),'');
});

test('cutover failed after clone creation preserves partial data and refuses rollback success',async t=>{
 const {stageMigration}=await import('./src/migration.mjs');const {inspectMigration}=await import('./migration_inspect.mjs');const f=fixture(t);
 for(let i=0;i<6;i++)fs.writeFileSync(path.join(f.source,`file-${i}`),Buffer.alloc(11000000));f.git('add','.');f.git('commit','-qm','above total source byte limit');
 const inspection=inspectMigration(f.source),plan={schema:'asc-v05-cutover/v1',sourceHead:inspection.head,files:inspection.configurationInventory.map(e=>({path:e.path,beforeSha256:e.sha256,action:'retain'}))};
 assert.throws(()=>stageMigration(f.source,f.destination,plan),/Source byte limit/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.destination,'transition.json'))).state,'preparing');
 assert.equal(fs.existsSync(path.join(f.destination,'project','.git')),true);
 assert.throws(()=>rollbackMigration(f.destination),/incomplete/);
 assert.throws(()=>stageMigration(f.source,f.destination,plan),/new location/);
 assert.equal(f.git('status','--porcelain'),'');
});

test('normal work entry requires a linked worktree; independent clone is explicit',async t=>{
 const {assertWorkLocation}=await import('./src/migration.mjs');const f=fixture(t);
 assert.throws(()=>assertWorkLocation(f.source),/dedicated Git worktree/);
 assert.equal(assertWorkLocation(f.source,'isolated-clone').mode,'isolated-clone');
 if(process.platform==='win32')assert.equal(assertWorkLocation(f.source.toUpperCase(),'isolated-clone').mode,'isolated-clone');
 assert.throws(()=>assertWorkLocation(f.source,'automatic'),/Unknown/);
 const work=path.join(f.root,'work');f.git('worktree','add','-b','task',work);
 assert.equal(assertWorkLocation(work).mode,'worktree');
 assert.throws(()=>assertWorkLocation(work,'isolated-clone'),/Independent clone/);
 const sub=path.join(work,'sub');fs.mkdirSync(sub);assert.throws(()=>assertWorkLocation(sub),/root required/);
 assert.equal(f.git('status','--porcelain'),'');
});


test('standard worktree creation preserves source edits and never repurposes branches',t=>{
 const f=fixture(t),head=f.git('rev-parse','HEAD');fs.writeFileSync(path.join(f.source,'AGENTS.md'),'owner edit');
 const created=JSON.parse(execFileSync(process.execPath,[path.resolve('bin/asc-v05.mjs'),'worktree-create',f.source,'42','fix','account-api',head],{encoding:'utf8'}));
 assert.equal(created.branch,'fix/42-account-api');assert.match(path.basename(created.repo),/^\d{8}_\d{6}-42-account-api$/);assert.equal(fs.readFileSync(path.join(f.source,'AGENTS.md'),'utf8'),'owner edit');assert.equal(fs.readFileSync(path.join(created.repo,'AGENTS.md'),'utf8'),'Owner instructions');
 assert.throws(()=>createWorktree(f.source,{issue:42,type:'fix',slug:'account-api',base:head}),/already exists/);
 assert.throws(()=>createWorktree(f.source,{issue:42,slug:'..',base:head}),/slug/);
 const second=createWorktree(f.source,{issue:42,type:'fix',slug:'account-ui',base:head});assert.notEqual(second.repo,created.repo);assert.equal(f.git('rev-parse','HEAD'),head);
});


test('worktree creation does not execute source filters or accept an aliased parent',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),marker=path.join(f.root,'executed');
 fs.writeFileSync(path.join(f.source,'.gitattributes'),'AGENTS.md filter=trap\n');f.git('add','.gitattributes');f.git('commit','-qm','filter declaration');
 f.git('config','filter.trap.smudge',`touch '${marker}'; cat`);f.git('config','filter.trap.required','true');
 const created=createWorktree(f.source,{issue:43,slug:'no-filter'});assert(!fs.existsSync(marker));assert.equal(fs.readFileSync(path.join(created.repo,'AGENTS.md'),'utf8'),'Owner instructions');
 const other=fixture(t);fs.symlinkSync(f.root,path.join(other.source,'.worktrees'));
 assert.throws(()=>createWorktree(other.source,{issue:44,slug:'no-alias'}),/real directory/);assert.equal(other.git('branch','--list','feature/44-no-alias'),'');
});


test('migration preserves a project above the old 500-file prototype limit',t=>{
 const f=fixture(t);for(let i=0;i<600;i++)fs.writeFileSync(path.join(f.source,`module-${i}.txt`),`module ${i}\n`);
 f.git('add','.');f.git('commit','-qm','many small modules');const head=f.git('rev-parse','HEAD');
 const observed=new Controller({repo:f.source,base:head,contract:{},implementer:'large-source-test'}).blobs(head);assert.equal(observed.size,602);assert.equal(observed.get('module-599.txt').bytes.toString(),'module 599\n');
 const prepared=prepareMigration(f.source,f.destination);
 assert.equal(prepared.sourceHead,head);assert.equal(fs.readFileSync(path.join(prepared.candidate,'module-599.txt'),'utf8'),'module 599\n');
 assert.equal(f.git('status','--porcelain'),'');assert.equal(rollbackMigration(f.destination).selection,'legacy');
 assert.equal(fs.readFileSync(path.join(prepared.candidate,'module-0.txt'),'utf8'),'module 0\n');
});

test('migration of a clean linked worktree preserves another Issue with dirty files and runtime',t=>{
 const f=fixture(t),selected=path.join(f.root,'selected-issue'),sibling=path.join(f.root,'active-issue');
 f.git('worktree','add','-b','fix/42-selected',selected,'HEAD');
 f.git('worktree','add','-b','feature/43-active',sibling,'HEAD');
 const selectedGit=(...a)=>execFileSync('git',a,{cwd:selected,encoding:'utf8',stdio:'pipe'}).trim();
 const siblingGit=(...a)=>execFileSync('git',a,{cwd:sibling,encoding:'utf8',stdio:'pipe'}).trim();
 fs.writeFileSync(path.join(selected,'selected.txt'),'selected issue committed work');selectedGit('add','.');selectedGit('commit','-qm','selected issue');
 fs.writeFileSync(path.join(sibling,'AGENTS.md'),'other issue work in progress');
 fs.mkdirSync(path.join(sibling,'.agent-skill-chain/runtime'),{recursive:true});
 fs.writeFileSync(path.join(sibling,'.agent-skill-chain/runtime/progress.json'),'{"issue":43,"unfinished":true}\n');
 fs.writeFileSync(path.join(sibling,'untracked-work.txt'),'preserve this unpublished work');
 const before={selected:selectedGit('rev-parse','HEAD'),sibling:siblingGit('rev-parse','HEAD'),status:siblingGit('status','--porcelain'),worktrees:f.git('worktree','list','--porcelain'),main:f.git('rev-parse','HEAD')};
 const prepared=prepareMigration(selected,f.destination);
 assert.equal(prepared.sourceHead,before.selected);
 assert.equal(fs.readFileSync(path.join(prepared.candidate,'selected.txt'),'utf8'),'selected issue committed work');
 assert.equal(fs.existsSync(path.join(prepared.candidate,'untracked-work.txt')),false);
 assert.equal(fs.existsSync(path.join(prepared.candidate,'.agent-skill-chain/runtime')),false);
 fs.writeFileSync(path.join(prepared.candidate,'selected.txt'),'new architecture candidate edit');
 const back=rollbackMigration(f.destination);
 assert.equal(back.source,fs.realpathSync(selected));assert.equal(back.currentLegacyHead,before.selected);
 assert.equal(fs.readFileSync(path.join(prepared.candidate,'selected.txt'),'utf8'),'new architecture candidate edit');
 assert.equal(selectedGit('rev-parse','HEAD'),before.selected);assert.equal(selectedGit('status','--porcelain'),'');
 assert.equal(siblingGit('rev-parse','HEAD'),before.sibling);assert.equal(siblingGit('status','--porcelain'),before.status);
 assert.equal(fs.readFileSync(path.join(sibling,'AGENTS.md'),'utf8'),'other issue work in progress');
 assert.equal(fs.readFileSync(path.join(sibling,'untracked-work.txt'),'utf8'),'preserve this unpublished work');
 assert.equal(fs.readFileSync(path.join(sibling,'.agent-skill-chain/runtime/progress.json'),'utf8'),'{"issue":43,"unfinished":true}\n');
 assert.equal(f.git('worktree','list','--porcelain'),before.worktrees);assert.equal(f.git('rev-parse','HEAD'),before.main);
});

test('accepted large configuration cutover remains readable for repeated rollback',async t=>{
 const {stageMigration}=await import('./src/migration.mjs');const {inspectMigration}=await import('./migration_inspect.mjs');const f=fixture(t);
 for(let i=0;i<240;i++){const file=path.join(f.source,'.agent-skill-chain/skills',`component-${String(i).padStart(3,'0')}-configuration`,'SKILL.md');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'Owner-retained legacy instructions\n');}
 f.git('add','.');f.git('commit','-qm','many legacy configuration entries');const before=f.git('rev-parse','HEAD');const inspected=inspectMigration(f.source);
 const plan={schema:'asc-v05-cutover/v1',sourceHead:before,files:inspected.configurationInventory.map(e=>({path:e.path,beforeSha256:e.sha256,action:'retain'}))};assert(plan.files.length<=256);
 const result=stageMigration(f.source,f.destination,plan);assert(fs.statSync(path.join(f.destination,'transition.json')).size>65536);
 fs.writeFileSync(path.join(result.candidate,'owner-work.txt'),'preserve');
 assert.equal(rollbackMigration(f.destination).selection,'legacy');assert.equal(rollbackMigration(f.destination).selection,'legacy');
 assert.equal(fs.readFileSync(path.join(result.candidate,'owner-work.txt'),'utf8'),'preserve');assert.equal(f.git('rev-parse','HEAD'),before);assert.equal(f.git('status','--porcelain'),'');
});

test('oversized transition metadata is still rejected without changing candidate work',t=>{
 const f=fixture(t),prepared=prepareMigration(f.source,f.destination);fs.writeFileSync(path.join(prepared.candidate,'owner-work.txt'),'preserve');
 const file=path.join(f.destination,'transition.json');fs.appendFileSync(file,Buffer.alloc(16*1024*1024,32));const size=fs.statSync(file).size;
 assert.throws(()=>rollbackMigration(f.destination),/Unsafe transition metadata/);assert.equal(fs.statSync(file).size,size);assert.equal(fs.readFileSync(path.join(prepared.candidate,'owner-work.txt'),'utf8'),'preserve');assert.equal(f.git('status','--porcelain'),'');
});

test('killed migration before final metadata commit preserves source and requires a fresh destination',
 {skip:process.platform!=='linux'},async t=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const {inspectMigration}=await import('./migration_inspect.mjs');const {stageMigration}=await import('./src/migration.mjs');
 for(const mode of ['prepare','stage'])for(const signal of ['SIGTERM','SIGKILL']){
  const f=fixture(t),before={head:f.git('rev-parse','HEAD'),status:f.git('status','--porcelain'),owner:fs.readFileSync(path.join(f.source,'AGENTS.md'),'utf8')};
  const inspection=inspectMigration(f.source),plan={schema:'asc-v05-cutover/v1',sourceHead:before.head,files:inspection.configurationInventory.map(e=>({path:e.path,beforeSha256:e.sha256,action:e.path==='AGENTS.md'?'replace':'retain',...(e.path==='AGENTS.md'?{content:'Owner-approved new instructions'}:{})}))};
  const marker=path.join(f.root,'boundary'),driver=path.join(f.root,'driver.mjs');
  // Test-only fault injection pauses at the real atomic metadata commit, after
  // actual clone/export/replacements. No product test hooks or fake Git operations.
  fs.writeFileSync(driver,`import fs from 'node:fs';import {prepareMigration,stageMigration} from ${JSON.stringify(new URL('./src/migration.mjs',import.meta.url).href)};
const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to===${JSON.stringify(path.join(f.destination,'transition.json'))}&&JSON.parse(fs.readFileSync(from)).state==='prepared'){fs.writeFileSync(${JSON.stringify(marker)},'before-final-commit');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return rename(from,to);};
${mode==='stage'?'stageMigration':'prepareMigration'}(${JSON.stringify(f.source)},${JSON.stringify(f.destination)},${JSON.stringify(plan)});`);
  const child=spawn(process.execPath,[driver],{stdio:'ignore'});
  try{const limit=Date.now()+10000;while(!fs.existsSync(marker)&&Date.now()<limit)await new Promise(r=>setTimeout(r,10));assert(fs.existsSync(marker),'real metadata boundary not reached');const exited=once(child,'exit');assert(child.kill(signal));await exited;}finally{child.kill('SIGKILL');}
  const manifest=path.join(f.destination,'transition.json'),candidate=path.join(f.destination,'project'),retained=fs.readFileSync(path.join(candidate,'AGENTS.md'),'utf8');
  assert.equal(JSON.parse(fs.readFileSync(manifest)).state,'preparing');assert.equal(retained,mode==='stage'?'Owner-approved new instructions':before.owner);
  const manifestBefore=fs.readFileSync(manifest);assert.throws(()=>rollbackMigration(f.destination),/incomplete/);
  assert.throws(()=>mode==='stage'?stageMigration(f.source,f.destination,plan):prepareMigration(f.source,f.destination),/new location|Incomplete/);
  assert(fs.readFileSync(manifest).equals(manifestBefore));assert.equal(fs.readFileSync(path.join(candidate,'AGENTS.md'),'utf8'),retained);
  const fresh=path.join(f.root,'fresh-transition'),result=mode==='stage'?stageMigration(f.source,fresh,plan):prepareMigration(f.source,fresh);
  assert.equal(result.state,'prepared');assert.equal(rollbackMigration(fresh).authorityRestored,false);
  assert.equal(f.git('rev-parse','HEAD'),before.head);assert.equal(f.git('status','--porcelain'),before.status);assert.equal(fs.readFileSync(path.join(f.source,'AGENTS.md'),'utf8'),before.owner);
 }
});
