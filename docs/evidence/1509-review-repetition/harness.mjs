import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../..');
export const manifest = JSON.parse(fs.readFileSync(path.join(here, 'frozen-manifest.json'), 'utf8'));
export const root = manifest.fixture_root;
export const scenarios = ['authorization', 'private-helper', 'failed-save'];
export const stages = ['initial', 'after'];
export const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

export function checkFrozen({ includeFixtures = true, includeSkills = true } = {}) {
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    if (!includeFixtures && path.isAbsolute(name)) continue;
    const file = path.isAbsolute(name) ? name : path.join(repo, name);
    assert.equal(digest(file), expected, name);
  }
  if (includeSkills) {
    for (const [name, expected] of Object.entries(manifest.skill_sha256)) {
      assert.equal(digest(path.join(repo, name)), expected, name);
    }
  }
}

// Keep subprocess time finite without expanding the child review's permissions.
export function runProcess(argv, { cwd, input = '', timeoutMs = 600000, killGraceMs = 5000 } = {}) {
  return new Promise(resolve => {
    const started = performance.now();
    const child = spawn(argv[0], argv.slice(1), { cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, killTimer, settled = false;
    let closed = false, cleanupComplete = true, outcome;
    const signals = [];
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {}); // Preserve spawn/close result if the child closes stdin early.
    const send = signal => {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
        signals.push(signal);
      } catch (error) { if (error.code !== 'ESRCH') stderr += `\n${error.message}`; }
    };
    const finish = () => {
      if (settled || !closed || !cleanupComplete) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer);
      resolve({ ...outcome, stdout, stderr, timedOut, signals, timeoutCleanupComplete: cleanupComplete, wallSeconds: Math.round((performance.now() - started) * 1000) / 1000000 });
    };
    const recordClose = (exitCode, signal, error = null) => {
      if (!closed) outcome = { exitCode, signal, error };
      closed = true; finish();
    };
    const timer = setTimeout(() => {
      timedOut = true; cleanupComplete = false; send('SIGTERM');
      // A direct child may close while descendants ignore TERM with closed stdio.
      // Keep group cleanup pending independently of the direct child's close event.
      killTimer = setTimeout(() => {
        send('SIGKILL'); cleanupComplete = true; finish();
      }, killGraceMs);
    }, timeoutMs);
    child.once('error', error => recordClose(null, null, error.message));
    child.once('close', (code, signal) => recordClose(code, signal));
    child.stdin.end(input);
  });
}
