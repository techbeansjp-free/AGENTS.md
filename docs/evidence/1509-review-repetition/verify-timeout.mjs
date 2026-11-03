// Local process-lifecycle counterexamples; never call Codex or change the fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcess, here, writeJson } from './harness.mjs';

assert.equal(process.platform, 'linux', 'This process-group counterexample is verified on Linux.');
const rows = [];
const ignored = [process.execPath, '-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"];
const direct = await runProcess(ignored, { timeoutMs: 500, killGraceMs: 100 });
assert.equal(direct.timedOut, true);
assert.deepEqual(direct.signals, ['SIGTERM', 'SIGKILL']);
assert.equal(direct.signal, 'SIGKILL');
assert.match(direct.stdout, /ready/);
rows.push({ name: 'direct child ignores TERM', argv: ignored, ...direct });

const source = `
const {spawn}=require('node:child_process');
const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
console.log(descendant.pid);
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{},1000);
`;
const descendantCase = [process.execPath, '-e', source];
const result = await runProcess(descendantCase, { timeoutMs: 500, killGraceMs: 100 });
const pid = Number(result.stdout.trim());
assert.equal(Number.isSafeInteger(pid) && pid > 0, true);
function state() {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
  } catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error; }
}
let afterReturn, after250ms;
try {
  // KILL delivery is asynchronous; a short bounded wait distinguishes a live
  // orphan from an already terminated zombie awaiting the system's reaper.
  for (let attempt = 0; attempt < 20 && !['absent', 'Z', 'X'].includes(state()); attempt++) await delay(10);
  afterReturn = state();
  await delay(250); after250ms = state();
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 0, 'Direct child exits normally on TERM.');
  assert.deepEqual(result.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.timeoutCleanupComplete, true);
  assert.ok(result.wallSeconds >= 0.6, 'Return must wait for the 500ms timeout plus 100ms group grace.');
  assert.ok(['absent', 'Z', 'X'].includes(afterReturn), `Live descendant after return: ${afterReturn}`);
  assert.ok(['absent', 'Z', 'X'].includes(after250ms), `Live descendant after 250ms: ${after250ms}`);
} finally {
  if (!['absent', 'Z', 'X'].includes(state())) process.kill(pid, 'SIGKILL');
}
rows.push({ name: 'direct child closes on TERM; ignored-stdio descendant ignores TERM', argv: descendantCase, descendant_pid: pid, after_return_state: afterReturn, after_250ms_state: after250ms, zombie_interpretation: 'Z means terminated, awaiting system reaping; it is not a live executing descendant.', ...result });
const failure = await runProcess(['/definitely-missing-asc-1509-executable'], { timeoutMs: 500 });
assert.notEqual(failure.error, null); assert.equal(failure.exitCode, null);
rows.push({ name: 'spawn error', ...failure });
writeJson(path.join(here, 'node-harness-verification.json'), { checked_at_utc: new Date().toISOString(), node: process.version, timeout_ms: 500, kill_grace_ms: 100, model_measurement_executed: false, rows });
console.log(JSON.stringify({ direct_timeout_verified: true, descendant_cleanup_verified: true, spawn_failure_verified: true, model_measurement_executed: false }));
