/** Synthetic owner-driven Git cutover. No provider, network, or host settings. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

const policyFormat=process.argv[3]??'manifest';
assert(['flat','manifest'].includes(policyFormat));
const installed=fs.realpathSync(process.argv[2]);
const metadata=JSON.parse(fs.readFileSync(path.join(installed,'package.json')));
assert.equal(metadata.name,'agent-skill-chain');
const cli=path.join(installed,metadata.bin['agent-skill-chain']);
const skill=path.join(path.dirname(cli),'../skills/asc/SKILL.md');
assert(fs.existsSync(skill));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-config-roundtrip-'));
const started=performance.now();
const env={PATH:process.env.PATH,HOME:root,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
const run=(cwd,command,args)=>execFileSync(command,args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
const git=(cwd,...args)=>run(cwd,'git',['-c','core.hooksPath=/dev/null',...args]);
const write=(repo,name,text)=>{const file=path.join(repo,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const main=path.join(root,'origin');fs.mkdirSync(main);
git(main,'init','-q');git(main,'config','user.name','Synthetic Owner');git(main,'config','user.email','fixture@example.invalid');
const ownerRule='Preserve the project API and owner formatting. No external communication.\n';
const oldSkill='.agents/skills/asc-step/SKILL.md',newSkill='.agents/skills/asc/SKILL.md';
const oldHook={type:'command',command:'node .agent-skill-chain/hooks/legacy.mjs'};
const ownerHook={type:'command',command:'node tools/owner-check.mjs'};
const initial={
 'AGENTS.md':ownerRule+'Use .agents/skills/asc-step/SKILL.md.\n',
 [oldSkill]:'---\nname: asc-step\ndescription: Synthetic retired entry\n---\nUse the legacy workflow.\n',
 '.agent-skill-chain/project-policy.json':JSON.stringify(policyFormat==='flat'?{schemaVersion:'agent-skill-chain/project-policy/v0.3.1'}:{schemaVersion:'agent-skill-chain/project-policy-manifest/v1',policy:{schemaVersion:'agent-skill-chain/project-policy/v0.3.1'},choiceFiles:[],ruleFiles:['project/rules/owner.json'],conformanceFiles:[],providerFiles:[]}),
 '.agent-skill-chain/project/rules/owner.json':JSON.stringify({ownerRequirement:'Preserve the project API'}),
 '.claude/settings.json':JSON.stringify({permissions:{deny:['Read(.env)']},hooks:{PreToolUse:[{matcher:'Bash',hooks:[oldHook,ownerHook]}]}}),
 'tools/owner-check.mjs':'process.exitCode=0;\n',
 'app.mjs':'export const value=1;\n',
 'app-test.mjs':"import assert from 'node:assert/strict';import {value} from './app.mjs';assert(Number.isInteger(value)&&value>0);\n"
};
for(const [name,text] of Object.entries(initial))write(main,name,text);
git(main,'add','.');git(main,'commit','-qm','synthetic legacy configuration');
const base=git(main,'rev-parse','HEAD');
const source=path.join(root,'source'),sibling=path.join(root,'other-issue');
git(main,'worktree','add','-b','source',source);git(main,'worktree','add','-b','other',sibling);
write(sibling,'app.mjs','export const value=99;\n');write(sibling,'notes.txt','unfinished owner work\n');
const registrations=git(main,'worktree','list','--porcelain');
const transition=path.join(root,'transition');
const inspection=JSON.parse(run(root,process.execPath,[cli,'migration-inspect',source]));
const plan=path.join(root,'owner-cutover.json');
fs.writeFileSync(plan,JSON.stringify({schema:'asc-v05-cutover/v1',sourceHead:base,files:inspection.configurationInventory.map(e=>({path:e.path,beforeSha256:e.sha256,action:'retain'}))}));
const preparation=policyFormat==='manifest'?['migration-stage',source,transition,plan]:['migration-prepare',source,transition];
const prepared=JSON.parse(run(root,process.execPath,[cli,...preparation]));
const project=prepared.candidate;
git(project,'config','user.name','Synthetic Owner');git(project,'config','user.email','fixture@example.invalid');
// Ordinary owner-reviewed Git changes handle additions/removals, not stageMigration.
fs.unlinkSync(path.join(project,oldSkill));
write(project,newSkill,`---\nname: asc\ndescription: Owner-selected installed ASC entry\n---\nRead the installed skill at ${skill}.\nUse the fixed CLI ${cli}. Do not infer approval from this entry.\n`);
write(project,'AGENTS.md',ownerRule+`Use ${newSkill}.\n`);
const settings=JSON.parse(initial['.claude/settings.json']);
settings.hooks.PreToolUse[0].hooks=settings.hooks.PreToolUse[0].hooks.filter(h=>h.command!==oldHook.command);
write(project,'.claude/settings.json',JSON.stringify(settings));
git(project,'add','AGENTS.md','.agents','.claude/settings.json');
git(project,'commit','-qm','owner configuration cutover');const cutover=git(project,'rev-parse','HEAD');
const capability=JSON.parse(run(project,process.execPath,[cli,'capabilities']));
assert.equal(capability.legacyFallback,false);assert(capability.commands.includes('run-adaptive'));
assert.equal(fs.existsSync(path.join(project,oldSkill)),false);
assert.equal(fs.readFileSync(path.join(project,'AGENTS.md'),'utf8').startsWith(ownerRule),true);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project,'.claude/settings.json'))),{permissions:{deny:['Read(.env)']},hooks:{PreToolUse:[{matcher:'Bash',hooks:[ownerHook]}]}});
// A later application commit must survive reversal of the settings commit.
write(project,'app.mjs','export const value=2;\n');git(project,'add','app.mjs');git(project,'commit','-qm','later application work');
run(project,process.execPath,['app-test.mjs']);
git(project,'revert','--no-edit',cutover);
for(const name of ['AGENTS.md',oldSkill,'.claude/settings.json'])assert.equal(fs.readFileSync(path.join(project,name),'utf8'),initial[name]);
assert.equal(fs.existsSync(path.join(project,newSkill)),false);
assert.equal(fs.readFileSync(path.join(project,'app.mjs'),'utf8'),'export const value=2;\n');
run(project,process.execPath,['app-test.mjs']);
// Conflicting later configuration must stop rather than force old settings over it.
const conflict=path.join(root,'conflicting-cutover');git(project,'worktree','add','-b','conflict',conflict,cutover);
const laterSettings=ownerRule+`Use ${newSkill} with an additional owner restriction.\n`;
write(conflict,'AGENTS.md',laterSettings);git(conflict,'add','AGENTS.md');git(conflict,'commit','-qm','later owner settings');
const conflictHead=git(conflict,'rev-parse','HEAD');
const refused=spawnSync('git',['-c','core.hooksPath=/dev/null','revert','--no-edit',cutover],{cwd:conflict,env,encoding:'utf8',timeout:30000});
assert.equal(refused.status,1);assert(git(conflict,'ls-files','--unmerged').includes('AGENTS.md'));
assert.equal(git(conflict,'rev-parse','HEAD'),conflictHead);
git(conflict,'revert','--abort');assert.equal(fs.readFileSync(path.join(conflict,'AGENTS.md'),'utf8'),laterSettings);
const rollback=JSON.parse(run(root,process.execPath,[cli,'migration-rollback',transition]));assert.equal(rollback.authorityRestored,false);
assert.equal(git(source,'rev-parse','HEAD'),base);assert.equal(git(source,'status','--porcelain'),'');
for(const [name,text] of Object.entries(initial))assert.equal(fs.readFileSync(path.join(source,name),'utf8'),text);
assert.equal(git(main,'worktree','list','--porcelain'),registrations);
assert.equal(fs.readFileSync(path.join(sibling,'app.mjs'),'utf8'),'export const value=99;\n');
assert.equal(fs.readFileSync(path.join(sibling,'notes.txt'),'utf8'),'unfinished owner work\n');
const result={schema:'asc-configuration-roundtrip/v1',status:'passed',policyFormat,preparationCommand:preparation[0],root,version:metadata.version,base,cutover,restoredHead:git(project,'rev-parse','HEAD'),seconds:(performance.now()-started)/1000,agentCalls:0,
 guarantees:['installed CLI migration preparation/rollback','old entry removed, new fixed-path entry added','owner rule, permission and unrelated hook preserved','configuration reverted while later application commit survives','source and dirty sibling worktree preserved','conflicting settings revert stops; abort restores later owner settings'],
 limitations:['Synthetic owner-directed configuration only; no actual legacy runtime or host Skill discovery executed','No model, remote CI or release; does not prove arbitrary configuration migration','Git conflict resolution remains an owner-reviewed operation; no forced rollback']};
fs.writeFileSync(path.join(root,'evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
