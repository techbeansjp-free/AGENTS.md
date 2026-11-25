import {tempDir} from './helpers/temp-dir.mjs';
/**
 * Read trigger (#1814): project-assets proposes appending the v05/USAGE.md pointer to CLAUDE.md as a shown diff and
 * applies it only with --adopt-read-trigger <id>@<beforeSha256|absent> from that plan. Counterexamples: no write without
 * approval, a stale preimage stops everything, existing bytes are kept, no second proposal, AGENTS.md-only or symlinked
 * CLAUDE.md gets manual text, Codex-only registration gets no proposal, uninstall keeps the owner's CLAUDE.md.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {projectAssets,uninstallProjectAssets} from '../src/project-assets.mjs';
import {GIT_NULL_DEVICE} from '../src/source-limits.mjs';

const sha=(b)=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const root=tempDir('asc-read-trigger-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'});
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'app.txt'),'base');git('add','.');git('commit','-qm','base');
 const work=path.join(root,'work');git('worktree','add','-qb','task',work);
 const pkg=path.join(root,'package');fs.mkdirSync(pkg);
 for(const name of ['v05','skills','src','bin','migration_inspect.mjs','README.md','package.json'])fs.cpSync(name,path.join(pkg,name),{recursive:true});
 return {root,work,pkg,claude:path.join(work,'CLAUDE.md')};
}
const usagePointer=()=>/### ASCを読む契機を利用先へ採用する（任意）[\s\S]*?```text\n([\s\S]*?)\n```/.exec(fs.readFileSync('v05/USAGE.md','utf8'))[1].trim();

test('the plan proposes the CLAUDE.md pointer with a diff and writes nothing without approval',t=>{
 const f=fixture(t),opts={packageRoot:f.pkg,registerClaudeSkill:true};
 fs.writeFileSync(f.claude,'# Project\n\nOwner rules.\n');
 const plan=projectAssets(f.work,opts);
 assert.equal(plan.readTrigger.default,'claude-md');
 const o=plan.readTrigger.options[0];
 assert.deepEqual([o.id,o.path,o.action,o.beforeSha256],['claude-md','CLAUDE.md','append',sha('# Project\n\nOwner rules.\n')]);
 assert.match(o.diff,/^--- a\/CLAUDE\.md\n\+\+\+ b\/CLAUDE\.md\n@@ -3,0 \+4,4 @@\n\+\n\+<!-- asc:read-trigger v1 -->\n\+/);
 assert(o.diff.includes(usagePointer()));
 assert.equal(projectAssets(f.work,{...opts,apply:true}).applied,true);
 assert.equal(fs.readFileSync(f.claude,'utf8'),'# Project\n\nOwner rules.\n');
 const record=JSON.parse(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json'),'utf8'));
 assert.equal('readTrigger' in record,false);
});

test('approval appends the delimited block at the end, keeps existing bytes, records it and is not proposed again',t=>{
 const f=fixture(t),opts={packageRoot:f.pkg,registerClaudeSkill:true};
 const owner='# Project\n\nOwner rules.\n';fs.writeFileSync(f.claude,owner);
 const o=projectAssets(f.work,opts).readTrigger.options[0];
 const r=projectAssets(f.work,{...opts,apply:true,adoptReadTrigger:`claude-md@${o.beforeSha256}`});
 assert.equal(r.applied,true);assert.equal(r.conflicts.length,0);
 const after=fs.readFileSync(f.claude,'utf8');
 assert(after.startsWith(owner));
 assert.equal(after,`${owner}\n<!-- asc:read-trigger v1 -->\n${usagePointer()}\n<!-- /asc:read-trigger -->\n`);
 assert.equal(r.readTriggerAdopted.afterSha256,sha(after));
 const record=JSON.parse(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json'),'utf8'));
 assert.deepEqual(record.readTrigger.adopted.map(a=>[a.id,a.path]),[['claude-md','CLAUDE.md']]);
 const again=projectAssets(f.work,opts);
 assert.deepEqual(again.readTrigger.options,[]);assert.equal(again.readTrigger.adopted.length,1);
 // Removed by the owner later: still not proposed again, and never re-added by an update.
 fs.writeFileSync(f.claude,owner);
 assert.deepEqual(projectAssets(f.work,opts).readTrigger.options,[]);
 assert.equal(projectAssets(f.work,{...opts,apply:true}).applied,true);assert.equal(fs.readFileSync(f.claude,'utf8'),owner);
});

test('an absent CLAUDE.md is created with the block only; a file without a final newline keeps its text',t=>{
 const f=fixture(t),opts={packageRoot:f.pkg,registerClaudeSkill:true};
 const o=projectAssets(f.work,opts).readTrigger.options[0];
 assert.deepEqual([o.action,o.beforeSha256],['create','absent']);assert(o.diff.startsWith(`--- ${GIT_NULL_DEVICE}\n`));
 projectAssets(f.work,{...opts,apply:true,adoptReadTrigger:'claude-md@absent'});
 assert(fs.readFileSync(f.claude,'utf8').startsWith('<!-- asc:read-trigger v1 -->\n'));
 const g=fixture(t);fs.writeFileSync(g.claude,'# P\nlast line');
 const p=projectAssets(g.work,opts).readTrigger.options[0];
 assert.match(p.diff,/-last line\n\\ No newline at end of file\n\+last line\n\+\n\+<!-- asc:read-trigger v1 -->/);
 projectAssets(g.work,{...opts,packageRoot:g.pkg,apply:true,adoptReadTrigger:`claude-md@${p.beforeSha256}`});
 assert(fs.readFileSync(g.claude,'utf8').startsWith('# P\nlast line\n\n<!-- asc:read-trigger v1 -->'));
});

test('a changed preimage, a wrong id or a malformed value stops everything before any write',t=>{
 const f=fixture(t),opts={packageRoot:f.pkg,registerClaudeSkill:true};
 fs.writeFileSync(f.claude,'# Project\n');
 const o=projectAssets(f.work,opts).readTrigger.options[0];
 fs.appendFileSync(f.claude,'edited after the plan\n');
 assert.throws(()=>projectAssets(f.work,{...opts,apply:true,adoptReadTrigger:`claude-md@${o.beforeSha256}`}),/changed after planning/);
 assert.throws(()=>projectAssets(f.work,{...opts,apply:true,adoptReadTrigger:'claude-hook@absent'}),/No such read trigger option/);
 assert.throws(()=>projectAssets(f.work,{...opts,apply:true,adoptReadTrigger:'claude-md'}),/Invalid --adopt-read-trigger/);
 assert.equal(fs.readFileSync(f.claude,'utf8'),'# Project\nedited after the plan\n');
 assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain/distribution.json')),false);
});

test('an existing block, an AGENTS.md-only CLAUDE.md or a symlinked CLAUDE.md gets no proposal',t=>{
 const opts=(f)=>({packageRoot:f.pkg,registerClaudeSkill:true});
 const a=fixture(t);fs.writeFileSync(a.claude,'# P\n<!-- asc:read-trigger v1 -->\nown text\n<!-- /asc:read-trigger -->\n');
 const pa=projectAssets(a.work,opts(a));assert.deepEqual(pa.readTrigger.options,[]);assert.equal(pa.readTrigger.present,true);
 const b=fixture(t);fs.writeFileSync(b.claude,'# Claude\n@AGENTS.md\n');
 const pb=projectAssets(b.work,opts(b));assert.deepEqual(pb.readTrigger.options,[]);
 assert.match(pb.readTrigger.manual.reason,/only refers to AGENTS\.md/);assert(pb.readTrigger.manual.text.includes(usagePointer()));
 const c=fixture(t);fs.writeFileSync(path.join(c.work,'AGENTS.md'),'# Agents\n');fs.symlinkSync('AGENTS.md',c.claude);
 const pc=projectAssets(c.work,opts(c));assert.deepEqual(pc.readTrigger.options,[]);assert.match(pc.readTrigger.manual.reason,/symlink/);
 assert.equal(projectAssets(c.work,{...opts(c),apply:true}).applied,true);assert.equal(fs.readFileSync(path.join(c.work,'AGENTS.md'),'utf8'),'# Agents\n');
});

test('Codex-only registration gets no read trigger proposal (Codex stays manual)',t=>{
 const f=fixture(t);
 assert.equal('readTrigger' in projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true}),false);
 assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,apply:true,adoptReadTrigger:'claude-md@absent'}),/No such read trigger option/);
});

test('uninstall keeps the adopted CLAUDE.md and lists it as retained',t=>{
 const f=fixture(t),opts={packageRoot:f.pkg,registerClaudeSkill:true};
 fs.writeFileSync(f.claude,'# Project\n');
 const o=projectAssets(f.work,opts).readTrigger.options[0];
 projectAssets(f.work,{...opts,apply:true,adoptReadTrigger:`claude-md@${o.beforeSha256}`});
 const before=fs.readFileSync(f.claude);
 const plan=uninstallProjectAssets(f.work,{packageRoot:f.pkg});
 assert.deepEqual(plan.retained.map(r=>[r.path,r.kind]),[['CLAUDE.md','read-trigger']]);
 assert(!plan.changes.some(c=>c.path==='CLAUDE.md'));
 assert.equal(uninstallProjectAssets(f.work,{packageRoot:f.pkg,apply:true}).applied,true);
 assert.deepEqual(fs.readFileSync(f.claude),before);
});

test('CLI: --adopt-read-trigger needs --apply and one value',t=>{
 const f=fixture(t);
 const run=(...a)=>spawnSync(process.execPath,[path.resolve('bin/asc-v05.mjs'),'project-assets',f.work,...a],{encoding:'utf8'});
 assert.notEqual(run('--register-claude-skill','--adopt-read-trigger','claude-md@absent').status,0);
 assert.notEqual(run('--register-claude-skill','--apply','--adopt-read-trigger').status,0);
 const plan=JSON.parse(run('--register-claude-skill').stdout);
 assert.equal(plan.readTrigger.options[0].beforeSha256,'absent');
});
