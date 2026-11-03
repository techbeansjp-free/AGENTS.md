import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const additionalSkills=['contract-enforcement','engineering-judgment','estimate-and-scope','execution-recovery','migration-assurance','research-to-implementation','review-and-remediation','security-evidence','subagent-model-selection','user-journey-acceptance','verification-optimization','work-coordination'];
export const registeredSkills=['asc','project-foundation',...additionalSkills].sort();
export const registrations=registeredSkills.map(name=>`.agents/skills/${name}/SKILL.md`);
export function skillFiles(root){
 return fs.readdirSync(root,{recursive:true}).filter(name=>fs.statSync(path.join(root,name)).isFile()).map(name=>name.split(path.sep).join('/')).sort();
}
export function assertAdditionalSkills(root,sourceRoot){
 for(const name of additionalSkills){
  const target=path.join(root,name),source=path.join(sourceRoot,name),files=skillFiles(source);
  assert(files.includes('SKILL.md')); // Supporting references are optional for self-contained Skills.
  assert.deepEqual(skillFiles(target),files);
  for(const file of files){
   const bytes=fs.readFileSync(path.join(target,file));assert.deepEqual(bytes,fs.readFileSync(path.join(source,file)),`${name}/${file}`);
   if(file.endsWith('.md'))for(const [,link] of bytes.toString().matchAll(/\]\(([^)]+)\)/g))assert(fs.existsSync(path.resolve(target,path.dirname(file),link)),`${name}/${file}: ${link}`);
  }
 }
 const guide=fs.readFileSync(path.join(root,'README.md'),'utf8');
 for(const name of registeredSkills)assert(guide.includes(`](${name}/SKILL.md)`),name);
 for(const [,link] of guide.matchAll(/\]\(([^)]+)\)/g))assert(fs.existsSync(path.resolve(root,link)),link);
}
export function assertAdditionalEntries(project){
 for(const name of additionalSkills){
  const entryFile=path.join(project,`.agents/skills/${name}/SKILL.md`),entry=fs.readFileSync(entryFile,'utf8');
  const sourceFile=path.join(project,`.agent-skill-chain/skills/${name}/SKILL.md`),source=fs.readFileSync(sourceFile,'utf8');
  const pattern=/^---\n[\s\S]*?\n---\n/;
  assert.equal(entry.match(pattern)[0],source.match(pattern)[0]);
  const links=[...entry.matchAll(/\]\(([^)]+)\)/g)];assert.equal(links.length,1);
  assert.equal(fs.realpathSync(path.resolve(path.dirname(entryFile),links[0][1])),fs.realpathSync(sourceFile));
 }
}
