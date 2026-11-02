import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Reviewed distribution bytes, including the subsequently requested scope refinements.
export const foundationHashes={
 'SKILL.md':'82af3e5396338adfebda74c9862b23ac02c5e6b8115ad9679a4d9858dee7bc10',
 'references/foundation-decisions.md':'cfe26357d3579c1803f922ea90fad47625523d996ff8f8544cbd5ddf850c6941',
 'references/contracts-and-ui.md':'e2cf251ba71e829d84f52ccd80f3817240b3c4734f882d20e1f22b2a473c58be',
 'references/containers-and-worktrees.md':'039ca0ed4dc4ee741b5652b190706787ca07fcdb018206b2cb6fc3d915dd68d4',
 'references/verification-and-security.md':'5b704c7e6d445e931cd5471bda6d68e6fc3a1bb4fad418a55f8ee752e87c4831',
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
