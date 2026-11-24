// Host-side runner for the #1780 gold checks. Starts one disposable container with OS-level limits,
// enforces a wall-clock limit with `docker kill`, keeps at most 64 KiB of output, then removes the container.
// Usage: node run-sandbox.mjs <seconds> <fixture-dir> <worktree-label> -- <node args...>
// The probe directory (this file's directory) is mounted read-only at /probe; the fixture read-only at /target.
// The caller must not pass a home directory or a directory holding secrets as <fixture-dir>.
// Exit status: 0 only when waiting, log collection and removal all succeeded (the container's own exit code
// is reported in the JSON line, not as this process's status).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [seconds, fixture, label, separator, ...args] = process.argv.slice(2);
const limitSeconds = Number(seconds);
if (!Number.isFinite(limitSeconds) || limitSeconds <= 0 || !fixture || !label || separator !== '--' || args.length === 0) {
  throw new Error('usage: node run-sandbox.mjs <seconds> <fixture-dir> <worktree-label> -- <node args...>');
}
// Refuse a missing fixture: `docker run -v` would otherwise create an empty directory on the host.
if (!fs.statSync(fixture, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`fixture directory not found: ${fixture}`);
const probeDir = path.dirname(fileURLToPath(import.meta.url));
const image = 'node:22-alpine';
// A fixed name lets cleanup find the container even if `docker run` fails after creating it.
const name = `asc1780-${process.pid}-${Date.now()}`;
const runArgs = ['run', '-d', '--name', name, '--label', `asc.worktree=${label}`, '--network', 'none', '--ipc', 'none',
  '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534', '--pids-limit', '64',
  '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5', '--ulimit', 'fsize=4194304', '--ulimit', 'nofile=256',
  '--log-driver', 'json-file', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1', '--entrypoint', 'node',
  '--tmpfs', '/scratch:rw,size=16m,mode=1777', '-e', 'HOME=/scratch', '-w', '/scratch',
  '-v', `${path.resolve(fixture)}:/target:ro`, '-v', `${probeDir}:/probe:ro`, image, ...args];

const remove = () => spawnSync('docker', ['rm', '-f', '-v', name]).status === 0;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    remove();
    process.exit(1);
  });
}

const started = Date.now();
let killed = false;
const result = { containerExit: null, wallClockKilled: false, elapsedMs: null, runError: null, waitError: null,
  logsStatus: null, truncated: false, removed: false };
try {
  const run = spawnSync('docker', runArgs, { encoding: 'utf8' });
  if (run.status !== 0) {
    result.runError = `docker run status=${run.status} ${String(run.stderr).trim().slice(0, 200)}`;
  } else {
    const timer = setTimeout(() => {
      killed = spawnSync('docker', ['kill', name]).status === 0;
      // If kill fails, force-remove so that `docker wait` returns instead of waiting without a limit.
      if (!killed) spawnSync('docker', ['rm', '-f', '-v', name]);
    }, limitSeconds * 1000);
    // `docker wait` runs asynchronously so the wall-clock timer can fire while it blocks.
    const waited = await new Promise((resolve) => {
      const child = spawn('docker', ['wait', name]);
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('error', (error) => resolve({ code: null, signal: null, out, error: error.code ?? String(error) }));
      child.on('close', (code, signal) => resolve({ code, signal, out, error: null }));
    });
    clearTimeout(timer);
    result.elapsedMs = Date.now() - started;
    const exit = waited.out.trim();
    if (waited.code === 0 && waited.signal === null && /^\d+$/.test(exit)) result.containerExit = Number(exit);
    else result.waitError = waited.error ?? `docker wait code=${waited.code} signal=${waited.signal} stdout=${JSON.stringify(exit)}`;
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    result.logsStatus = logs.error ? (logs.error.code ?? String(logs.error)) : logs.status;
    const output = Buffer.from(`${logs.stdout ?? ''}${logs.stderr ?? ''}`);
    result.truncated = output.length > 65536;
    process.stdout.write(output.subarray(0, 65536).toString('utf8'));
  }
} finally {
  // Remove the container on every path that reaches here, including wait or log failures.
  result.removed = remove();
  result.wallClockKilled = killed;
  console.log(JSON.stringify(result));
  if (result.runError || result.waitError || result.logsStatus !== 0 || !result.removed) process.exitCode = 1;
}
