import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {projectContext} from '../src/project-context.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-context-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const write=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),v);};const config=rules=>write('.agent-skill-chain/project/context.json',JSON.stringify({schema:'asc-project-context/v1',rules}));return {root,write,config};}
test('scoped rules avoid irrelevant bodies and bind selected content without exposing it',t=>{
 const f=fixture(t);f.write('AGENTS.md','owner contract');f.write('src/ui/AGENTS.md','nested');f.write('rules/ui.md','sensitive UI rule');
 f.config([{path:'rules/ui.md',appliesTo:['src/ui']},{path:'missing-api.md',appliesTo:['src/api']}]);
 const a=projectContext(f.root,['src/ui/view.ts']);assert.deepEqual(a.references.map(x=>x.path),['AGENTS.md','src/ui/AGENTS.md','rules/ui.md']);assert(!JSON.stringify(a).includes('sensitive'));assert.equal(projectContext(f.root,['src/ui/view.ts']).digest,a.digest);
 f.write('rules/ui.md','updated');assert.notEqual(projectContext(f.root,['src/ui/view.ts']).digest,a.digest);
 assert.throws(()=>projectContext(f.root),/ENOENT/);assert.throws(()=>projectContext(f.root,['src/api/view.ts']),/ENOENT/);
 assert.deepEqual(projectContext(f.root,['src/uix/view.ts']).references.map(x=>x.path),['AGENTS.md']);
});
test('no settings needs no manifest, while legacy and unindexed rules are explicit',t=>{
 const f=fixture(t);assert.deepEqual(projectContext(f.root).references,[]);f.write('.agent-skill-chain/project/rules.md','owner');f.write('.agent-skill-chain/project-policy.json','{}');const r=projectContext(f.root);assert.equal(r.notices.length,3);assert.equal(r.references[0].path,'.agent-skill-chain/project-policy.json');
});
test('malformed, missing and escaping selected references fail instead of silently waiving rules',t=>{
 const f=fixture(t);for(const p of ['../outside','/etc/passwd','C:/secret','x\\y']){f.config([{path:p}]);assert.throws(()=>projectContext(f.root),/relative/);}
 f.config([{path:'missing'}]);assert.throws(()=>projectContext(f.root),/ENOENT/);
 f.config([{path:'ok',unknown:true}]);assert.throws(()=>projectContext(f.root),/Invalid/);
 f.write('actual','data');fs.symlinkSync('actual',path.join(f.root,'link'));f.config([{path:'link'}]);assert.throws(()=>projectContext(f.root),/symlink/);
});
test('separate project selections never reuse another project context',t=>{
 const a=fixture(t),b=fixture(t);a.write('AGENTS.md','first');b.write('AGENTS.md','second');assert.notEqual(projectContext(a.root).digest,projectContext(b.root).digest);fs.rmSync(path.join(a.root,'AGENTS.md'));assert.equal(projectContext(a.root).references.length,0);assert.equal(projectContext(b.root).references.length,1);
});

test('optional ancestor discovery permits a planned file-to-directory change',t=>{
 const f=fixture(t);f.write('src','old file');assert.deepEqual(projectContext(f.root,['src/new/file.ts']).references,[]);
 f.config([{path:'src/required.md'}]);assert.throws(()=>projectContext(f.root,['src/new/file.ts']),/ENOTDIR/);
});

test('shared ancestor rules are read once per selection and refreshed on the next call',t=>{
 const f=fixture(t);f.write('src/AGENTS.md','shared contract');
 const open=fs.openSync;let reads=0;
 t.mock.method(fs,'openSync',function(file,...args){if(file===path.join(f.root,'src/AGENTS.md'))reads++;return open.call(fs,file,...args);});
 const paths=Array.from({length:100},(_,i)=>`src/file${i}.ts`);
 const first=projectContext(f.root,paths);assert.equal(reads,1);
 f.write('src/AGENTS.md','changed contract');
 const second=projectContext(f.root,paths);assert.equal(reads,2);assert.notEqual(first.digest,second.digest);
});
test('optional missing rule cache cannot waive a required manifest rule',t=>{
 const f=fixture(t);f.config([{path:'src/AGENTS.md',appliesTo:['src']}]);
 assert.throws(()=>projectContext(f.root,['src/a.ts','src/b.ts']),/ENOENT/);
});
