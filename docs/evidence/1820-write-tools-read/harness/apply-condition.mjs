// #1820: reduced from docs/evidence/1817-skill-application/harness/apply-condition.mjs. Every cell keeps the CLAUDE.md the
// product's adoption produced (make-fixture.mjs, #1814 condition I), so the pointer and hook paths of #1814 are gone; what
// stays is the one commit with the same neutral subject in every trial copy (#1814 review M1: the Host shows recent commit
// subjects in its git context). No model call.
// Review L1 (pre-written drop of a tools level): conditions.json droppableLevels names the only level that may be dropped
// (X) when its isolation probe fails; fixation.mjs drop-level records the drop in results/fixation.json before any planned
// trial. loadConditions() returns the conditions with that drop applied (applyDrop); loadRawConditions() the file as is.
// Usage: node apply-condition.mjs <fixture-copy>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {git, gitEnv} from './make-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
export const NEUTRAL_SUBJECT = 'Update project files';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const loadRawConditions = () => JSON.parse(fs.readFileSync(path.join(ev, 'conditions.json'), 'utf8'));

// The conditions without the cells of a dropped tools level (only a level in droppableLevels). The dropped probe cells
// and cells are kept as droppedCells; rawProbeCells keeps every probe cell (the gate still needs the dropped probe).
export function applyDrop(conds, level) {
  if (!level) return conds;
  if (!(conds.droppableLevels ?? []).includes(level)) throw new Error(`tools level ${level} may not be dropped (conditions.json droppableLevels: ${(conds.droppableLevels ?? []).join(',') || 'none'})`);
  const c = structuredClone(conds);
  const droppedCells = Object.keys(conds.cells).filter((id) => conds.cells[id].tools === level);
  c.cells = Object.fromEntries(Object.entries(conds.cells).filter(([id]) => !droppedCells.includes(id)));
  c.toolLevels = Object.fromEntries(Object.entries(conds.toolLevels).filter(([id]) => id !== level));
  c.rawProbeCells = [...conds.probeCells];
  c.probeCells = conds.probeCells.filter((id) => !droppedCells.includes(id));
  c.negativeCells = conds.negativeCells.filter((id) => !droppedCells.includes(id));
  c.droppedLevel = level;
  c.droppedCells = droppedCells;
  return c;
}

// The tools level dropped by a record of results/fixation.json (fixation.mjs drop-level), or null.
export function droppedLevel(root = ev) {
  const f = path.join(root, 'results/fixation.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8')).records?.findLast((r) => r.dropLevel)?.dropLevel ?? null;
}

export const loadConditions = () => applyDrop(loadRawConditions(), droppedLevel());

export function applyCondition(fixture) {
  const md = path.join(fixture, 'CLAUDE.md');
  const out = {claudeMdSha256: fs.existsSync(md) ? sha256(fs.readFileSync(md)) : null};
  git(['add', '-A'], fixture);
  out.changedFiles = spawnSync('git', ['diff', '--cached', '--name-only'], {cwd: fixture, env: gitEnv(fixture), encoding: 'utf8'}).stdout.split('\n').filter(Boolean);
  git(['commit', '-q', '--allow-empty', '-m', NEUTRAL_SUBJECT], fixture);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(applyCondition(path.resolve(process.argv[2]))));
}
