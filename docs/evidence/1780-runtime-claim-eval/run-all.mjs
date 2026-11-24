// Run the fixed #1780 schedule: 3 fixtures x 3 replicates x {R0, R1}, order alternated, one retry per failed slot.
// Usage: node run-all.mjs <work-dir> [model]. Fixtures run in parallel lanes; each lane runs its 6 slots in order.
// Writes <work-dir>/schedule.json (condition per run id). Console output carries run ids only, not conditions,
// so that scoring can be done blind to the condition.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [workDir, model = 'opus'] = process.argv.slice(2);
if (!workDir) throw new Error('usage: node run-all.mjs <work-dir> [model]');
const work = path.resolve(workDir);
if (fs.existsSync(path.join(work, 'schedule.json'))) throw new Error('schedule already exists');
fs.mkdirSync(work, { recursive: true });
// Fixed order: F1 and F3 start with R0 in replicates 1 and 3; F2 is mirrored.
const orders = { F1: ['R0R1', 'R1R0', 'R0R1'], F2: ['R1R0', 'R0R1', 'R1R0'], F3: ['R0R1', 'R1R0', 'R0R1'] };
const slots = [];
for (const [fixture, list] of Object.entries(orders)) {
  list.forEach((pair, index) => {
    [pair.slice(0, 2), pair.slice(2)].forEach((condition, position) => {
      slots.push({ fixture, replicate: index + 1, position: index * 2 + position + 1, condition, attempts: [], scoredRunId: null });
    });
  });
}
const save = () => fs.writeFileSync(path.join(work, 'schedule.json'), `${JSON.stringify({ model, slots }, null, 2)}\n`);
save();

const runOnce = (slot) => new Promise((resolve) => {
  const runId = crypto.randomBytes(6).toString('hex');
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [path.join(here, 'run-reviewer.mjs'), path.join(work, 'runs'), runId, slot.fixture,
    slot.condition, path.join(here, 'prompt-review.txt'), path.join(work, 'out', runId), model], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('close', (code) => {
    let parsed = false;
    try {
      const text = fs.readFileSync(path.join(work, 'out', runId, 'result.txt'), 'utf8').trim();
      const json = JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
      parsed = Array.isArray(json.items);
    } catch { parsed = false; }
    const ok = code === 0 && parsed && stdout.includes('"unchanged":true');
    console.log(JSON.stringify({ runId, fixture: slot.fixture, ok }));
    resolve({ runId, startedAt, runnerExit: code, parsedJson: parsed, ok, runnerStderr: stderr.slice(0, 500) });
  });
});

await Promise.all(Object.keys(orders).map(async (fixture) => {
  for (const slot of slots.filter((s) => s.fixture === fixture).sort((a, b) => a.position - b.position)) {
    for (let attempt = 0; attempt < 2 && !slot.scoredRunId; attempt++) {
      const result = await runOnce(slot);
      slot.attempts.push(result);
      if (result.ok) slot.scoredRunId = result.runId;
      save();
    }
  }
}));
console.log('done');
