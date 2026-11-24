// Inventory of the distributed Skills at a given ASC checkout (read only).
// Usage: node inventory.mjs <asc-repo-root>
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'src/runtime-files.json'), 'utf8'));
const files = new Set(Array.isArray(runtime) ? runtime : runtime.files ?? Object.values(runtime).flat());
const rows = [];
const read = (rel, kind) => {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)[1];
  const name = /^name: (.+)$/m.exec(fm)[1];
  const description = /^description: (.+)$/m.exec(fm)[1];
  const refs = fs.existsSync(path.join(root, path.dirname(rel), 'references')) ? fs.readdirSync(path.join(root, path.dirname(rel), 'references')).sort() : [];
  rows.push({kind, name, source: rel, inRuntimeFiles: files.has(rel), descriptionChars: [...description].length, descriptionUtf8Bytes: Buffer.byteLength(description), claudeEntry: kind === 'standard' ? `.claude/skills/${name}/SKILL.md` : 'explicit opt-in only', codexEntry: kind === 'standard' ? `.agents/skills/${name}/SKILL.md` : 'explicit opt-in only', body: kind === 'standard' ? `.agent-skill-chain/skills/${name}/SKILL.md` : `.agent-skill-chain/${rel}`, references: refs, description});
};
for (const d of fs.readdirSync(path.join(root, 'skills')).sort()) if (fs.existsSync(path.join(root, 'skills', d, 'SKILL.md'))) read(`skills/${d}/SKILL.md`, 'standard');
for (const d of fs.readdirSync(path.join(root, 'v05/optional-skills')).sort()) read(`v05/optional-skills/${d}/SKILL.md`, 'optional');
const std = rows.filter((r) => r.kind === 'standard');
console.log(JSON.stringify({standard: std.length, optional: rows.length - std.length, standardDescriptionChars: std.reduce((a, r) => a + r.descriptionChars, 0), maxDescriptionChars: Math.max(...std.map((r) => r.descriptionChars)), rows}, null, 1));
