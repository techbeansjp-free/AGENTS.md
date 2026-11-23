// Host-side runner for the #1774 sandbox probes. Starts one disposable container with OS-level limits,
// enforces a wall-clock limit with `docker kill`, keeps at most 64 KiB of output, then removes the container.
// Usage: node run-sandbox.mjs <seconds> <fixture-dir> <worktree-label> -- <node args...>
// The probe directory (this file's directory) is mounted read-only at /probe; the fixture read-only at /target.
// The caller must not pass a home directory or a directory holding secrets as <fixture-dir>.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [seconds, fixture, label, separator, ...args] = process.argv.slice(2);
const limitSeconds = Number(seconds);
if (!Number.isFinite(limitSeconds) || limitSeconds <= 0 || !fixture || !label || separator !== '--' || args.length === 0) {
  throw new Error('usage: node run-sandbox.mjs <seconds> <fixture-dir> <worktree-label> -- <node args...>');
}
const probeDir = path.dirname(fileURLToPath(import.meta.url));
const image = 'node:22-alpine';
const runArgs = ['run', '-d', '--label', `asc.worktree=${label}`, '--network', 'none', '--ipc', 'none', '--read-only',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534', '--pids-limit', '64',
  '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5', '--ulimit', 'fsize=4194304', '--ulimit', 'nofile=256',
  '--log-driver', 'json-file', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1', '--entrypoint', 'node',
  '--tmpfs', '/scratch:rw,size=16m,mode=1777', '-e', 'HOME=/scratch', '-w', '/scratch',
  '-v', `${path.resolve(fixture)}:/target:ro`, '-v', `${probeDir}:/probe:ro`, image, ...args];
const id = execFileSync('docker', runArgs, { encoding: 'utf8' }).trim();

let killed = false;
let result = { containerExit: null, wallClockKilled: false, waitError: null, removed: false };
try {
  const timer = setTimeout(() => {
    killed = spawnSync('docker', ['kill', id]).status === 0;
  }, limitSeconds * 1000);
  // `docker wait` runs asynchronously so the wall-clock timer can fire while it blocks.
  const waited = await new Promise((resolve) => {
    const child = spawn('docker', ['wait', id]);
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', (error) => resolve({ code: null, signal: null, out, error: error.code ?? String(error) }));
    child.on('close', (code, signal) => resolve({ code, signal, out, error: null }));
  });
  clearTimeout(timer);
  const exit = waited.out.trim();
  if (waited.code === 0 && waited.signal === null && /^\d+$/.test(exit)) result.containerExit = Number(exit);
  else result.waitError = waited.error ?? `docker wait code=${waited.code} signal=${waited.signal} stdout=${JSON.stringify(exit)}`;
  const logs = spawnSync('docker', ['logs', id], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  process.stdout.write(Buffer.from(`${logs.stdout ?? ''}${logs.stderr ?? ''}`).subarray(0, 65536).toString('utf8'));
} finally {
  // Always stop and remove the container, even if waiting or log collection failed.
  result.removed = spawnSync('docker', ['rm', '-f', '-v', id]).status === 0;
  result.wallClockKilled = killed;
  console.log(JSON.stringify(result));
}
