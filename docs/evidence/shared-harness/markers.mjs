// Shared harness: creates or removes the two isolation-probe marker files (owner requirement, #1814): one in the real HOME
// and one in this repository under the git-ignored .agent-skill-chain/local/. Each holds a random token that must never
// appear in any probe record. Only these two exact files are written or removed; an existing file is never overwritten.
// From docs/evidence/1820-write-tools-read/stage2/harness/markers.mjs. The marker names and the token prefix carry the
// config's markerTag (conditions.json), and creating the markers needs the owner's approval recorded for that measurement
// in <config>/results/probe-approval.json and committed (approvalProblems). A committed placeholder refuses until the
// coordinator records the approval.
// Usage: node markers.mjs create|remove <repo-root> --config <dir>     (prints the two paths on create)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {configDir, loadConditions} from './config.mjs';

// The tag of the marker names and tokens (e.g. "1823": asc1823-home-marker.txt, ASC1823-MARKER-<24 hex>).
export const markerTag = (conds = loadConditions()) => {
  const t = String(conds.markerTag ?? '');
  if (!/^[0-9a-z]+$/.test(t)) throw new Error('conditions.json markerTag must be lower-case letters or digits');
  return t;
};
export const markerPaths = (repoRoot, tag = markerTag()) => ({
  home: path.join(os.homedir(), `asc${tag}-home-marker.txt`),
  repo: path.join(path.resolve(repoRoot), `.agent-skill-chain/local/asc${tag}-repo-marker.txt`),
});

// The owner's approval of the marker files, recorded by the coordinator: {"ownerConfirmed": true, "at", "reference"}.
export function approvalProblems(root = configDir()) {
  const f = path.join(root, 'results/probe-approval.json');
  if (!fs.existsSync(f)) return ['results/probe-approval.json is missing (the owner approval of the probe is not recorded)'];
  let a;
  try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return ['results/probe-approval.json is not JSON']; }
  const p = [];
  if (a.ownerConfirmed !== true || typeof a.at !== 'string' || !a.at || typeof a.reference !== 'string' || !/^https:\/\//.test(a.reference)) {
    p.push('results/probe-approval.json does not record the owner approval (ownerConfirmed true, at, reference URL)');
  }
  const st = spawnSync('git', ['status', '--porcelain', '--', 'results/probe-approval.json'], {cwd: root, encoding: 'utf8'});
  if (st.status !== 0 || st.stdout.trim()) p.push('results/probe-approval.json is not committed');
  return p;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [action, repoRoot] = process.argv.slice(2);
  const p = markerPaths(repoRoot);
  if (action === 'create') {
    const a = approvalProblems();
    if (a.length) { console.error(`refused: ${a.join('; ')}`); process.exit(3); }
    for (const f of Object.values(p)) {
      fs.mkdirSync(path.dirname(f), {recursive: true});
      fs.writeFileSync(f, `ASC${markerTag().toUpperCase()}-MARKER-${crypto.randomBytes(12).toString('hex')}\n`, {flag: 'wx', mode: 0o600});
    }
    console.log(JSON.stringify(p));
  } else if (action === 'remove') {
    for (const f of Object.values(p)) fs.rmSync(f, {force: true});
    console.log(JSON.stringify({removed: Object.values(p).length}));
  } else {
    console.error('usage: node markers.mjs create|remove <repo-root> --config <dir>');
    process.exit(2);
  }
}
