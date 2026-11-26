// Placement guard for #1814 (owner requirement: the sample project lives outside this repository and outside the real
// HOME, so no ancestor instruction file, project settings or auto-memory can be picked up as in #1807).
// Refuses a directory when any ancestor (parent up to /) holds CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude, .agents,
// .codex or .git, or when it lies under the real HOME or under the given repository root. No model call.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKERS = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude', '.agents', '.codex', '.git'];
// Real path of p, or of its nearest existing ancestor joined with the rest (the trial directory may not exist yet).
const real = (p) => {
  const abs = path.resolve(p);
  if (fs.existsSync(abs)) return fs.realpathSync(abs);
  const up = path.dirname(abs);
  return up === abs ? abs : path.join(real(up), path.basename(abs));
};
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

export function placementProblems(dir, {repoRoot = null, home = os.homedir()} = {}) {
  const target = real(path.resolve(dir));
  const problems = [];
  if (home && inside(target, real(home))) problems.push('under the real HOME');
  if (repoRoot && inside(target, real(repoRoot))) problems.push('under the ASC repository');
  let p = path.dirname(target);
  for (;;) {
    for (const m of MARKERS) if (fs.existsSync(path.join(p, m))) problems.push(`ancestor ${m} at ${p === target ? '.' : p}`);
    const up = path.dirname(p);
    if (up === p) break;
    p = up;
  }
  return problems;
}

export function assertPlacement(dir, opts) {
  const problems = placementProblems(dir, opts);
  if (problems.length) throw new Error(`refused placement: ${problems.join('; ')}`);
}
