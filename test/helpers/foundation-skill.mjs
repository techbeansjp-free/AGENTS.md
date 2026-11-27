import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Reviewed distribution bytes, including the subsequently requested scope refinements.
export const foundationHashes={
 'SKILL.md':'6b2d643c8b0de24cee492a3294e783bee751a1bb9b69e090f116a57d7bbe88fb',
 'references/foundation-decisions.md':'a4d142bba1ba48ad5f086b04a49be39977a8829cda9f572339910a5546e7d685',
 'references/contracts-and-ui.md':'b34cb8f0bdda28ecdd29013bbee99728386d68bd80012d3921ad3370a5f3a834',
 'references/containers-and-worktrees.md':'039ca0ed4dc4ee741b5652b190706787ca07fcdb018206b2cb6fc3d915dd68d4',
 'references/verification-and-security.md':'c06644aecd521e4ed68a7e43148bebd9d79262c11fc82320c28424b7a1388327',
 'agents/openai.yaml':'e6f37911eb5101ba3b446133beadaa4ad5bf7afc452d7958afa61d53e7312ea1'
};
export function assertFoundation(root){
 const files=fs.readdirSync(root,{recursive:true}).filter(name=>fs.statSync(path.join(root,name)).isFile()).map(name=>name.split(path.sep).join('/'));
 assert.deepEqual(files.sort(),Object.keys(foundationHashes).sort());
 for(const [name,digest] of Object.entries(foundationHashes)){
  const file=path.join(root,name),bytes=fs.readFileSync(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,name);
  if(name.endsWith('.md'))for(const [,link] of bytes.toString().matchAll(/\]\(([^)]+)\)/g))assert(fs.existsSync(path.resolve(path.dirname(file),link)),`${name}: ${link}`);
 }
}
export function assertFoundationEntry(project){
 const file=path.join(project,'.agents/skills/project-foundation/SKILL.md'),entry=fs.readFileSync(file,'utf8');
 const canonical=path.join(project,'.agent-skill-chain/skills/project-foundation/SKILL.md');
 const frontmatter=/^---\n[\s\S]*?\n---\n/;
 assert.equal(entry.match(frontmatter)[0],fs.readFileSync(canonical,'utf8').match(frontmatter)[0]);
 const links=[...entry.matchAll(/\]\(([^)]+)\)/g)];assert.equal(links.length,1);
 assert.equal(fs.realpathSync(path.resolve(path.dirname(file),links[0][1])),fs.realpathSync(canonical));
}
