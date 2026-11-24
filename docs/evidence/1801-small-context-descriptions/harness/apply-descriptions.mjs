// Copies an ASC-registered fixture and replaces the `description:` line of every ASC SKILL.md
// (Claude Code entries and the distributed bodies) with the candidate text, keyed by `name:`.
// Usage: node apply-descriptions.mjs <fixture-dir> <out-dir> <candidates.json> <candidate-id>
// A candidate whose `descriptions` is null keeps the distributed text (control).
import fs from 'node:fs';
import path from 'node:path';
const [src, out, candFile, id] = process.argv.slice(2).map((a, i) => (i < 3 ? path.resolve(a) : a));
const cand = JSON.parse(fs.readFileSync(candFile, 'utf8')).candidates.find((c) => c.id === id);
if (!cand) throw new Error(`unknown candidate ${id}`);
fs.rmSync(out, {recursive: true, force: true});
fs.cpSync(src, out, {recursive: true});
const dirs = ['.claude/skills', '.agent-skill-chain/skills', '.agent-skill-chain/managed-runtime/skills'].map((d) => path.join(out, d));
let changed = 0;
for (const d of dirs) for (const name of fs.existsSync(d) ? fs.readdirSync(d) : []) {
  const f = path.join(d, name, 'SKILL.md');
  if (!fs.existsSync(f) || !cand.descriptions) continue;
  const text = fs.readFileSync(f, 'utf8');
  const m = /^---\nname: (.+)\n/.exec(text);
  const next = m && cand.descriptions[m[1]];
  if (!next) continue;
  fs.writeFileSync(f, text.replace(/^description: .+$/m, `description: ${next}`));
  changed++;
}
console.log(JSON.stringify({candidate: id, changed}));
