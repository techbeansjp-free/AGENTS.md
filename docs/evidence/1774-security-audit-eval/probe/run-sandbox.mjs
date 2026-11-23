// Host-side runner for the #1774 sandbox probes. Starts one disposable container with OS-level limits,
// enforces a wall-clock limit with `docker kill`, keeps at most 64 KiB of output, then removes the container.
// Usage: node run-sandbox.mjs <seconds> <fixture-dir> <worktree-label> -- <node args...>
// The probe directory (this file's directory) is mounted read-only at /probe; the fixture read-only at /target.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [seconds, fixture, label, separator, ...args] = process.argv.slice(2);
if (!seconds || !fixture || !label || separator !== '--' || args.length === 0) {
  throw new Error('usage: node run-sandbox.mjs <seconds> <fixture-dir> <worktree-label> -- <node args...>');
}
const probeDir = path.dirname(fileURLToPath(import.meta.url));
const image = 'node:22-alpine';
const runArgs = ['run', '-d', '--label', `asc.worktree=${label}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges', '--user', '65534:65534', '--pids-limit', '64', '--memory', '256m', '--memory-swap', '256m',
  '--cpus', '0.5', '--ulimit', 'fsize=4194304', '--ulimit', 'nofile=256', '--entrypoint', 'node',
  '--tmpfs', '/scratch:rw,size=16m,mode=1777', '-e', 'HOME=/scratch', '-w', '/scratch',
  '-v', `${path.resolve(fixture)}:/target:ro`, '-v', `${probeDir}:/probe:ro`, image, ...args];
const id = execFileSync('docker', runArgs, { encoding: 'utf8' }).trim();
let killed = false;
const timer = setTimeout(() => {
  killed = spawnSync('docker', ['kill', id]).status === 0;
}, Number(seconds) * 1000);
// `docker wait` runs asynchronously so the wall-clock timer can fire while it blocks.
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn('docker', ['wait', id]);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.on('error', reject);
  child.on('close', () => resolve(Number(out.trim())));
});
clearTimeout(timer);
const logs = spawnSync('docker', ['logs', id], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
spawnSync('docker', ['rm', '-v', id]);
process.stdout.write(`${logs.stdout}${logs.stderr}`.slice(0, 65536));
console.log(JSON.stringify({ containerExit: exitCode, wallClockKilled: killed }));
