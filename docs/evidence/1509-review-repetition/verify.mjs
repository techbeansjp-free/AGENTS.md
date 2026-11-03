// Re-execute exactly the original behavioral counterexamples with a Node harness.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { here, root, checkFrozen, runProcess, writeJson } from './harness.mjs';

checkFrozen({ includeSkills: false });
const original = JSON.parse(fs.readFileSync(path.join(here, 'behavior-verification.json'), 'utf8'));
const rows = [];
for (const sample of original) {
  const target = path.join(root, sample.scenario, sample.stage);
  const result = await runProcess(sample.argv, { cwd: target, timeoutMs: 30000 });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.timedOut, false);
  const observation = JSON.parse(result.stdout);
  assert.deepEqual(observation, sample.stdout, `${sample.scenario}/${sample.stage}`);
  const existing = await runProcess(['node', 'test.mjs'], { cwd: target, timeoutMs: 30000 });
  assert.equal(existing.exitCode, 0, existing.stderr);
  assert.equal(existing.timedOut, false);
  rows.push({ ...sample, target, stdout: observation, stderr: result.stderr, existing_test: { exit_code: existing.exitCode, stdout: existing.stdout } });
}
checkFrozen({ includeSkills: false });
writeJson(path.join(here, 'node-behavior-verification.json'), { runner: 'Node port; not an additional Codex CLI measurement', checked_at_utc: new Date().toISOString(), oracle_matches: rows.length, fixtures_unchanged: true, rows });
console.log(JSON.stringify({ oracle_matches: rows.length, fixtures_unchanged: true }));
