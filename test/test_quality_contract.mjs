/** Exercise the trusted checker against inert temporary configuration copies. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const source=fileURLToPath(new URL('../',import.meta.url)),checker=path.join(source,'scripts/check_project_quality.ts');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-quality-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const base=path.join(root,'base'),candidate=path.join(root,'candidate');
 const declaration=fs.readFileSync(checker,'utf8').match(/const V05_PROTECTED_FILES = \[([\s\S]*?)\] as const;/);assert.ok(declaration);
 const names=[...declaration[1].matchAll(/"([^"\n]+)"/g)].map(m=>m[1]);names.push('.github/trusted-quality-proposals.json');
 for(const name of names){const dest=path.join(base,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,name),dest);}
 const reset=()=>{fs.rmSync(candidate,{recursive:true,force:true});fs.cpSync(base,candidate,{recursive:true});};reset();
 const check=(expected,pattern)=>{
  const p=spawnSync(process.execPath,['--import','tsx',checker,`--root=${candidate}`,`--trusted-root=${base}`],{cwd:source,encoding:'utf8'});
  assert.equal(p.error,undefined);assert.equal(p.status,expected?0:1,p.stdout+p.stderr);if(!p.stdout.trim()){assert.equal(expected,false);assert.match(p.stderr,/Error/);return;}const result=JSON.parse(p.stdout);assert.equal(result.valid,expected);if(pattern)assert.match(result.errors.join('\n'),pattern);return result;
 };
 const editPackage=fn=>{const file=path.join(candidate,'package.json'),data=JSON.parse(fs.readFileSync(file));fn(data);fs.writeFileSync(file,JSON.stringify(data));};
 return {root,base,candidate,reset,check,editPackage};
}
test('current v0.5 contract rejects candidate self-relaxation and retired configuration',t=>{
 const f=fixture(t);f.check(true);
 f.editPackage(p=>{p.scripts.test='node -e "process.exit(0)"';});f.check(false);f.reset();
 const marker=path.join(f.root,'executed');fs.writeFileSync(path.join(f.candidate,'scripts/check_project_quality.ts'),`import {createHash} from 'node:crypto';import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'ran');`);
 f.check(false);assert.equal(fs.existsSync(marker),false,'candidate checker must never execute');f.reset();
 fs.writeFileSync(path.join(f.candidate,'cucumber.mjs'),'export default {};');f.check(false,/retired/);f.reset();
 f.editPackage(p=>{p.version='0.4.99';});f.check(false,/legacy/);
});
test('current checker rejects missing base and malformed proposal registry',t=>{
 const f=fixture(t),p=spawnSync(process.execPath,['--import','tsx',checker,`--root=${f.candidate}`],{cwd:source,encoding:'utf8'});
 assert.equal(p.status,1);assert.match(p.stdout,/trusted base/);
 fs.writeFileSync(path.join(f.candidate,'.github/trusted-quality-proposals.json'),'{}');f.check(false);
});

test('maintenance requires a proposal registered in base before activating exact bytes',t=>{
 const f=fixture(t),name='scripts/check_project_quality.ts',old=fs.readFileSync(path.join(f.base,name)),after=Buffer.concat([old,Buffer.from('\n// synthetic maintenance\n')]);
 const hash=v=>createHash('sha256').update(v).digest('hex'),metadata=JSON.parse(fs.readFileSync(path.join(f.base,'package.json'))),version=metadata.qualityContractVersion;
 const registryPath='.github/trusted-quality-proposals.json',registry=JSON.parse(fs.readFileSync(path.join(f.base,registryPath)));
 registry.proposals.push({proposalId:'TQP-AUDIT-TEST',status:'staged',fromVersion:version,toVersion:version+1,owner:'synthetic owner',rationale:'Test base registration',rollback:'Register reverse bytes',targets:[{kind:'file',name,beforeSha256:hash(old),afterSha256:hash(after)},{kind:'packageField',name:'agentSkillChain.qualityContractVersion',beforeSha256:hash(String(version)),afterSha256:hash(String(version+1))}]});
 fs.writeFileSync(path.join(f.candidate,registryPath),JSON.stringify(registry));f.check(true);
 fs.writeFileSync(path.join(f.candidate,name),after);f.editPackage(p=>{p.qualityContractVersion=version+1;});f.check(false);
 fs.writeFileSync(path.join(f.base,registryPath),JSON.stringify(registry));f.check(true);
 fs.appendFileSync(path.join(f.candidate,name),'// unapproved extra change\n');f.check(false);
});
test('protected helpers, CI files and indirect or missing configuration cannot bypass the checker',t=>{
 const f=fixture(t);
 for(const name of ['scripts/quality-support/lib/security.ts','.github/workflows/ci.yml','.github/workflows/trusted-quality.yml']){
  fs.appendFileSync(path.join(f.candidate,name),'\n# unauthorized change\n');f.check(false);f.reset();
 }
 fs.unlinkSync(path.join(f.candidate,'eslint.config.mjs'));f.check(false);f.reset();
 fs.rmSync(path.join(f.candidate,'.github'),{recursive:true});fs.symlinkSync(path.join(f.base,'.github'),path.join(f.candidate,'.github'),process.platform==='win32'?'junction':'dir');f.check(false);
});
test('strict JSON parser preserves special keys and rejects duplicate authority keys',()=>{
 const script=`import assert from 'node:assert/strict';import {parseJsonStrict,stableJson} from './scripts/quality-support/lib/security.ts';
 for(const text of ['{"__proto__":{"polluted":true}}','{"__proto__":null}','{"constructor":1,"prototype":2}']){const parsed=parseJsonStrict(text);assert.deepEqual(parsed,JSON.parse(text));assert.equal(Object.getPrototypeOf(parsed),Object.prototype);assert.deepEqual(JSON.parse(stableJson(parsed)),JSON.parse(text));}
 assert.throws(()=>parseJsonStrict('{"__proto__":1,"__proto__":2}'),/重複/);`;
 const p=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:source,encoding:'utf8'});assert.equal(p.error,undefined);assert.equal(p.status,0,p.stdout+p.stderr);
});
