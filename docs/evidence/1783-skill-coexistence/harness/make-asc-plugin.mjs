// Repackages the ASC Claude Code entries that project-assets generated in a fixture as one plugin,
// because `claude plugin eval` loads plugins only (project .claude/ is not read in its isolated runs).
// Frontmatter (name, description) is kept byte for byte. Only the entry link is rewritten from
// `../../../.agent-skill-chain/` (relative to the project entry) to a working-directory path.
// Usage: node make-asc-plugin.mjs <fixture-dir> <plugin-dir> <plugin-name>
import fs from 'node:fs';
import path from 'node:path';
const [fixture, out, name] = process.argv.slice(2);
const src = path.join(fixture, '.claude/skills');
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(path.join(out, '.claude-plugin'), {recursive: true});
fs.writeFileSync(path.join(out, '.claude-plugin/plugin.json'), JSON.stringify({name, version: '0.5.0', description: 'ASC distributed Skill entries (evaluation copy)'}));
const rows = [];
for (const d of fs.readdirSync(src).sort()) {
  const text = fs.readFileSync(path.join(src, d, 'SKILL.md'), 'utf8');
  const rewritten = text.replaceAll('../../../.agent-skill-chain/', '.agent-skill-chain/').replace(/(\]\(\.agent-skill-chain\/[^)]+\))/, '$1（作業ディレクトリ基準）');
  fs.mkdirSync(path.join(out, 'skills', d), {recursive: true});
  fs.writeFileSync(path.join(out, 'skills', d, 'SKILL.md'), rewritten);
  rows.push(d);
}
console.log(JSON.stringify({plugin: name, skills: rows.length}));
