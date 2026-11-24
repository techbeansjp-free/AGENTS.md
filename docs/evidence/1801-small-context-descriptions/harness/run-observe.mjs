// Runs one listing observation in a disposable container (no network, read-only root, no home or secret mounts),
// reusing the #1783 in-container harness (docs/evidence/1783-skill-coexistence/harness, mounted read only).
// Usage: node run-observe.mjs <worktree-label> <image> <fixture-dir> <conditions.json> <condition> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [label, image, fixtureArg, condsArg, cond, outArg] = process.argv.slice(2);
const [fixture, conds, out] = [fixtureArg, condsArg, outArg].map((p) => path.resolve(p));
const harness = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../1783-skill-coexistence/harness');
fs.mkdirSync(out, {recursive: true});
const r = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only',
  '--tmpfs', '/home/eval:rw,size=512m,uid=1001,gid=1001,mode=0700', '--tmpfs', '/tmp:rw,size=64m',
  '--memory', '1g', '--cpus', '2', '--pids-limit', '256', '--user', '1001:1001',
  '--label', `asc.worktree=${label}`, '--label', 'asc.issue=1801',
  '-v', `${harness}:/harness:ro`, '-v', `${fixture}:/fixture:ro`, '-v', `${conds}:/conds.json:ro`, '-v', `${out}:/out`,
  image, 'node', '/harness/observe-in-container.mjs', '/conds.json', cond, '/out'], {stdio: 'inherit'});
if (r.error || r.signal) console.error(`docker run failed: ${r.error ?? r.signal}`);
process.exit(r.status ?? 1);
