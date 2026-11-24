// Runs one listing observation in a disposable container: no network, read-only root, no home or secret mounts.
// Usage: node run-observe.mjs <worktree-label> <fixture-dir> <conditions.json> <condition> <out-dir>   (absolute paths; used as bind mounts)
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [label, fixtureArg, condsArg, cond, outArg] = process.argv.slice(2);
const [fixture, conds, out] = [fixtureArg, condsArg, outArg].map((p) => path.resolve(p));
const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(out, {recursive: true});
const r = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only',
  '--tmpfs', '/home/eval:rw,size=512m,uid=1001,gid=1001,mode=0700', '--tmpfs', '/tmp:rw,size=64m',
  '--memory', '1g', '--cpus', '2', '--pids-limit', '256', '--user', '1001:1001',
  '--label', `asc.worktree=${label}`, '--label', 'asc.issue=1783',
  '-v', `${here}:/harness:ro`, '-v', `${fixture}:/fixture:ro`, '-v', `${conds}:/conds.json:ro`, '-v', `${out}:/out`,
  'asc-1783-host:2.1.323', 'node', '/harness/observe-in-container.mjs', '/conds.json', cond, '/out'], {stdio: 'inherit'});
if (r.error || r.signal) console.error(`docker run failed: ${r.error ?? r.signal}`);
process.exit(r.status ?? 1);
