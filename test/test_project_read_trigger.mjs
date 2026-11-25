import {tempDir} from './helpers/temp-dir.mjs';
/**
 * Read trigger (#1814): project-assets proposes appending the v05/USAGE.md pointer to CLAUDE.md as a shown diff and
 * applies it only with --adopt-read-trigger <id>@<beforeSha256|absent>:<blockSha256> from that plan. Counterexamples:
 * no write without approval, a stale preimage or changed text stops everything, existing bytes are kept byte for byte
 * (CRLF kept, non-UTF-8 left to the owner), no second proposal, AGENTS.md-only / symlinked / hardlinked / differently
 * cased CLAUDE.md gets manual text, Codex-only registration gets no proposal, conflicts write nothing, a failed apply
 * restores CLAUDE.md, a malformed record stops update and uninstall, uninstall keeps the owner's CLAUDE.md.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {projectAssets,uninstallProjectAssets,readTriggerText} from '../src/project-assets.mjs';
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
const text=()=>{const s=readTriggerText();assert.equal(typeof s,'string');assert(s.includes('.agent-skill-chain/skills/asc/SKILL.md'));return s;};
const block=()=>`<!-- asc:read-trigger v1 -->\n${text()}\n<!-- /asc:read-trigger -->\n`;
const approve=(o)=>`${o.id}@${o.beforeSha256}:${o.blockSha256}`;
const opts=(f)=>({packageRoot:f.pkg,registerClaudeSkill:true});

test('the shipped USAGE holds the read trigger text (a heading change is caught here, not by users)',()=>{
 assert(text().startsWith('このプロジェクトでASCを使う'));
});

test('the plan proposes the CLAUDE.md pointer with a diff and both hashes, and writes nothing without approval',t=>{
 const f=fixture(t);fs.writeFileSync(f.claude,'# Project\n\nOwner rules.\n');
 const plan=projectAssets(f.work,opts(f));
 assert.equal(plan.readTrigger.default,'claude-md');
 const o=plan.readTrigger.options[0];
 assert.deepEqual([o.id,o.path,o.action,o.beforeSha256,o.blockSha256],['claude-md','CLAUDE.md','append',sha('# Project\n\nOwner rules.\n'),sha(block())]);
 assert.match(o.diff,/^--- a\/CLAUDE\.md\n\+\+\+ b\/CLAUDE\.md\n@@ -3,0 \+4,4 @@\n\+\n\+<!-- asc:read-trigger v1 -->\n\+/);
 assert(o.diff.includes(text()));
 assert.equal(projectAssets(f.work,{...opts(f),apply:true}).applied,true);
 assert.equal(fs.readFileSync(f.claude,'utf8'),'# Project\n\nOwner rules.\n');
 assert.equal('readTrigger' in JSON.parse(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json'),'utf8')),false);
});

test('approval appends the block byte-wise at the end, records it and is not proposed again',t=>{
 const f=fixture(t);const owner=Buffer.from('# Project\n\nOwner rules.\n');fs.writeFileSync(f.claude,owner);
 const o=projectAssets(f.work,opts(f)).readTrigger.options[0];
 const r=projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:approve(o)});
 assert.equal(r.applied,true);assert.equal(r.conflicts.length,0);
 const after=fs.readFileSync(f.claude);
 assert(after.subarray(0,owner.length).equals(owner));
 assert.equal(after.toString(),`${owner}\n${block()}`);
 assert.equal(r.readTriggerAdopted.afterSha256,sha(after));
 const record=JSON.parse(fs.readFileSync(path.join(f.work,'.agent-skill-chain/distribution.json'),'utf8'));
 assert.deepEqual(record.readTrigger.adopted,[{id:'claude-md',path:'CLAUDE.md',blockSha256:sha(block())}]);
 const again=projectAssets(f.work,opts(f));assert.deepEqual(again.readTrigger.options,[]);assert.equal(again.readTrigger.adopted.length,1);
 fs.writeFileSync(f.claude,owner); // removed by the owner later: not proposed again, never re-added by an update
 assert.deepEqual(projectAssets(f.work,opts(f)).readTrigger.options,[]);
 assert.equal(projectAssets(f.work,{...opts(f),apply:true}).applied,true);assert(fs.readFileSync(f.claude).equals(owner));
});

test('absent file, missing final newline and CRLF: existing bytes are kept, CRLF stays CRLF',t=>{
 const a=fixture(t);const oa=projectAssets(a.work,opts(a)).readTrigger.options[0];
 assert.deepEqual([oa.action,oa.beforeSha256],['create','absent']);assert(oa.diff.startsWith(`--- ${GIT_NULL_DEVICE}\n`));
 projectAssets(a.work,{...opts(a),apply:true,adoptReadTrigger:approve(oa)});assert.equal(fs.readFileSync(a.claude,'utf8'),block());
 const b=fixture(t);const ob=Buffer.from('# P\nlast line');fs.writeFileSync(b.claude,ob);
 const pb=projectAssets(b.work,opts(b)).readTrigger.options[0];
 assert.match(pb.diff,/-last line\n\\ No newline at end of file\n\+last line\n\+\n\+<!-- asc:read-trigger v1 -->/);
 projectAssets(b.work,{...opts(b),apply:true,adoptReadTrigger:approve(pb)});
 const ab=fs.readFileSync(b.claude);assert(ab.subarray(0,ob.length).equals(ob));assert(ab.toString().startsWith('# P\nlast line\n\n<!-- asc:read-trigger v1 -->'));
 const c=fixture(t);const oc=Buffer.from('# P\r\nrule\r\n');fs.writeFileSync(c.claude,oc);
 const pc=projectAssets(c.work,opts(c)).readTrigger.options[0];assert.match(pc.diff,/CRLF/);assert.equal(pc.blockSha256,sha(block()));
 projectAssets(c.work,{...opts(c),apply:true,adoptReadTrigger:approve(pc)});
 const ac=fs.readFileSync(c.claude);assert(ac.subarray(0,oc.length).equals(oc));
 assert.equal(ac.toString(),`# P\r\nrule\r\n\r\n${block().replaceAll('\n','\r\n')}`);
});

test('non-UTF-8, UTF-16 or NUL-containing CLAUDE.md is never rewritten: manual text instead',t=>{
 for(const bytes of [Buffer.from([0x23,0x20,0x83,0x76,0x83,0x8d,0x0a]),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('# P\n','utf16le')]),Buffer.from('# P\n\0x\n')]){
  const f=fixture(t);fs.writeFileSync(f.claude,bytes);
  const p=projectAssets(f.work,opts(f));
  assert.deepEqual(p.readTrigger.options,[]);assert.match(p.readTrigger.manual.reason,/not UTF-8/);assert(p.readTrigger.manual.text.includes(text()));
  assert.throws(()=>projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:`claude-md@${sha(bytes)}:${sha(block())}`}),/No such read trigger option/);
  assert(fs.readFileSync(f.claude).equals(bytes));
 }
});

test('a changed preimage, changed text, wrong id or malformed value stops everything before any write',t=>{
 const f=fixture(t);fs.writeFileSync(f.claude,'# Project\n');
 const o=projectAssets(f.work,opts(f)).readTrigger.options[0];
 assert.throws(()=>projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:`claude-md@${o.beforeSha256}:${'0'.repeat(64)}`}),/text changed after planning/);
 assert.throws(()=>projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:`claude-md@${o.beforeSha256}`}),/Invalid --adopt-read-trigger/);
 assert.throws(()=>projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:`claude-hook@absent:${o.blockSha256}`}),/No such read trigger option/);
 // A package whose shipped text differs from the one shown: the approval no longer matches.
 const usage=path.join(f.pkg,'v05/USAGE.md');fs.writeFileSync(usage,fs.readFileSync(usage,'utf8').replace('このプロジェクトでASCを使う','このプロジェクトではASCを使う'));
 assert.throws(()=>projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:approve(o)}),/text changed after planning/);
 fs.appendFileSync(f.claude,'edited after the plan\n');
 assert.throws(()=>projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:approve(o)}),/target changed after planning/);
 assert.equal(fs.readFileSync(f.claude,'utf8'),'# Project\nedited after the plan\n');
 assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain/distribution.json')),false);
});

test('existing block, AGENTS.md-only, symlink, hardlink or differently cased file: no proposal',t=>{
 const a=fixture(t);fs.writeFileSync(a.claude,'# P\n<!-- asc:read-trigger v1 -->\nown text\n<!-- /asc:read-trigger -->\n');
 const pa=projectAssets(a.work,opts(a));assert.deepEqual(pa.readTrigger.options,[]);assert.equal(pa.readTrigger.present,true);
 const b=fixture(t);fs.writeFileSync(b.claude,'# Claude\n@AGENTS.md\n');
 const pb=projectAssets(b.work,opts(b));assert.deepEqual(pb.readTrigger.options,[]);assert.match(pb.readTrigger.manual.reason,/only refers to AGENTS\.md/);
 const c=fixture(t);fs.writeFileSync(path.join(c.work,'AGENTS.md'),'# Agents\n');fs.symlinkSync('AGENTS.md',c.claude);
 const pc=projectAssets(c.work,opts(c));assert.deepEqual(pc.readTrigger.options,[]);assert.match(pc.readTrigger.manual.reason,/symlink/);
 assert.equal(projectAssets(c.work,{...opts(c),apply:true}).applied,true);assert.equal(fs.readFileSync(path.join(c.work,'AGENTS.md'),'utf8'),'# Agents\n');
 const d=fixture(t);const other=path.join(d.root,'other.md');fs.writeFileSync(other,'# Shared\n');fs.linkSync(other,d.claude);
 const pd=projectAssets(d.work,opts(d));assert.deepEqual(pd.readTrigger.options,[]);assert.match(pd.readTrigger.manual.reason,/cannot be read safely/);
 assert.equal(fs.readFileSync(other,'utf8'),'# Shared\n');
 const e=fixture(t);fs.writeFileSync(path.join(e.work,'claude.md'),'# lower\n');
 if(!fs.existsSync(path.join(e.work,'CLAUDE.md'))||fs.readdirSync(e.work).includes('claude.md')){
  const pe=projectAssets(e.work,opts(e));assert.deepEqual(pe.readTrigger.options,[]);assert.match(pe.readTrigger.manual.reason,/claude\.md exists/);
 }
});

test('Codex-only registration gets no read trigger proposal (Codex stays manual)',t=>{
 const f=fixture(t);
 assert.equal('readTrigger' in projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true}),false);
 assert.throws(()=>projectAssets(f.work,{packageRoot:f.pkg,registerSkill:true,apply:true,adoptReadTrigger:`claude-md@absent:${sha(block())}`}),/No such read trigger option/);
});

test('a conflicting asset stops everything: the adopted CLAUDE.md is not written',t=>{
 const f=fixture(t);fs.writeFileSync(f.claude,'# Project\n');
 fs.mkdirSync(path.join(f.work,'.claude/skills/asc'),{recursive:true});fs.writeFileSync(path.join(f.work,'.claude/skills/asc/SKILL.md'),'owner file with the same name');
 const plan=projectAssets(f.work,opts(f));assert(plan.conflicts.length>0);
 const r=projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:approve(plan.readTrigger.options[0])});
 assert.equal(r.applied,false);assert.equal(fs.readFileSync(f.claude,'utf8'),'# Project\n');
});

test('a failed apply restores CLAUDE.md (appended and created)',t=>{
 for(const existing of [true,false]){
  const f=fixture(t);if(existing)fs.writeFileSync(f.claude,'# Project\n');
  const o=projectAssets(f.work,opts(f)).readTrigger.options[0];
  // CommonJS so the fake Git runs on every supported Node: it applies the patch, then fails, so rollback must run.
  const tools=path.join(f.root,'tools');fs.mkdirSync(tools);
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),originalPath=process.env.PATH;
  fs.writeFileSync(path.join(tools,'git'),`#!${process.execPath}\nconst {spawnSync}=require('node:child_process');const args=process.argv.slice(2);const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});if(args.includes('apply'))process.exit(1);process.exit(r.status??1);\n`,{mode:0o755});
  try{process.env.PATH=tools+path.delimiter+originalPath;assert.throws(()=>projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:approve(o)}),/Asset Git operation failed/);}finally{process.env.PATH=originalPath;}
  if(existing)assert.equal(fs.readFileSync(f.claude,'utf8'),'# Project\n');else assert.equal(fs.existsSync(f.claude),false);
  assert.equal(fs.existsSync(path.join(f.work,'.agent-skill-chain/distribution.json')),false);
 }
});

test('a malformed readTrigger record stops update and uninstall; a record without it (older version) still works',t=>{
 const f=fixture(t);assert.equal(projectAssets(f.work,{...opts(f),apply:true}).applied,true);
 const file=path.join(f.work,'.agent-skill-chain/distribution.json'),record=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal('readTrigger' in record,false);assert.equal(projectAssets(f.work,opts(f)).readTrigger.options.length,1);
 for(const bad of [{adopted:'x'},{adopted:[{id:'claude-hook',path:'CLAUDE.md',blockSha256:'0'.repeat(64)}]},{adopted:[{id:'claude-md',path:'../CLAUDE.md',blockSha256:'0'.repeat(64)}]}]){
  fs.writeFileSync(file,JSON.stringify({...record,readTrigger:bad}));
  assert.throws(()=>projectAssets(f.work,opts(f)),/Invalid read trigger record/);
  assert.throws(()=>uninstallProjectAssets(f.work,{packageRoot:f.pkg}),/Invalid read trigger record/);
 }
});

test('uninstall keeps the adopted CLAUDE.md and lists it as retained',t=>{
 const f=fixture(t);fs.writeFileSync(f.claude,'# Project\n');
 const o=projectAssets(f.work,opts(f)).readTrigger.options[0];
 projectAssets(f.work,{...opts(f),apply:true,adoptReadTrigger:approve(o)});
 const before=fs.readFileSync(f.claude);
 const plan=uninstallProjectAssets(f.work,{packageRoot:f.pkg});
 assert.deepEqual(plan.retained.map(r=>[r.path,r.kind]),[['CLAUDE.md','read-trigger']]);assert(!plan.changes.some(c=>c.path==='CLAUDE.md'));
 assert.equal(uninstallProjectAssets(f.work,{packageRoot:f.pkg,apply:true}).applied,true);assert.deepEqual(fs.readFileSync(f.claude),before);
});

test('CLI: --adopt-read-trigger needs --apply and one value',t=>{
 const f=fixture(t);
 const run=(...a)=>spawnSync(process.execPath,[path.resolve('bin/asc-v05.mjs'),'project-assets',f.work,...a],{encoding:'utf8'});
 assert.notEqual(run('--register-claude-skill','--adopt-read-trigger',`claude-md@absent:${sha(block())}`).status,0);
 assert.notEqual(run('--register-claude-skill','--apply','--adopt-read-trigger').status,0);
 const o=JSON.parse(run('--register-claude-skill').stdout).readTrigger.options[0];
 assert.equal(o.beforeSha256,'absent');
 assert.equal(run('--register-claude-skill','--apply','--adopt-read-trigger',approve(o)).status,0);
 assert.equal(fs.readFileSync(f.claude,'utf8'),block());
});
