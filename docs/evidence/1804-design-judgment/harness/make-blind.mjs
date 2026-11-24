// Builds a blinded folder for one case: random IDs, screenshots, notes. The key (ID -> trial) is written outside it.
// Usage: node make-blind.mjs <runs-root> <render-dir> <case-id> <blind-dir> <key-file> <seed>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [runs, render, caseId, blind, keyFile, seed] = process.argv.slice(2);
if (fs.existsSync(blind)) throw new Error('blind dir exists');
fs.mkdirSync(blind, {recursive: true});
const short = caseId.slice(0, 4);
const rng = (s) => () => { s = crypto.createHash('sha256').update(String(s)).digest('hex'); return parseInt(s.slice(0, 8), 16) / 2 ** 32; };
const rand = rng(seed);
const ids = new Set(); const mk = () => { let id; do { id = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0'); } while (ids.has(id)); ids.add(id); return id; };
fs.copyFileSync(path.join(here, '..', 'cases', caseId, 'BRIEF.md'), path.join(blind, 'BRIEF.md'));
fs.copyFileSync(path.join(here, '..', 'rubric.md'), path.join(blind, 'RUBRIC.md'));
const vps = short === 'ui03' ? ['desktop', 'tablet', 'desktop-gray'] : ['desktop', 'mobile', 'desktop-gray'];
const key = {};
const excluded = [];
for (const trial of fs.readdirSync(path.join(runs, caseId)).sort()) {
  if (!fs.existsSync(path.join(render, trial, 'desktop.png'))) { excluded.push(trial); continue; }
  const id = mk(); key[id] = trial;
  for (const vp of vps) { const src = path.join(render, trial, `${vp}.png`); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(blind, `${id}-${vp.replace('desktop-gray', 'gray')}.png`)); }
  const notes = path.join(runs, caseId, trial, 'fixture', 'out', 'DESIGN-NOTES.md');
  fs.writeFileSync(path.join(blind, `${id}-notes.md`), fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8') : '（notesは出力されなかった）\n');
}
if (short === 'ui08') {
  fs.copyFileSync(path.join(render, 'reference-members', 'desktop.png'), path.join(blind, 'reference-desktop.png'));
  fs.copyFileSync(path.join(here, '..', 'cases', caseId, 'app', 'DESIGN-SYSTEM.md'), path.join(blind, 'DESIGN-SYSTEM.md'));
}
fs.writeFileSync(keyFile, JSON.stringify({case: caseId, seed, key, excluded}, null, 1));
console.log(Object.keys(key).join(' '));
