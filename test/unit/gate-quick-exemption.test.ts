import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { stateFilePath } from '../../src/lib/local-state.js';
import { resolveGateQuickExemption } from '../../src/lib/gate-quick-exemption.js';

function writeSignals(root: string, size: unknown, risk: unknown): void {
  const statePath = stateFilePath(root, '1');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, stringify({ size, risk }));
}

test('ゲート用quick免除は固定SHA差分と三値シグナルからだけ成立する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(repo.dir, 'code.txt'), 'change\n');
  execFileSync('git', ['add', 'code.txt'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: ordinary change'], { cwd: repo.dir });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(repo.dir, 'AGENTS.md'), '# changed\n');
  execFileSync('git', ['add', 'AGENTS.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: guarded change'], { cwd: repo.dir });
  const guardedTargetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  for (const size of ['quick', 'standard'] as const) {
    for (const risk of ['normal', 'high'] as const) {
      for (const guardrail of [false, true]) {
        writeSignals(repo.dir, size, risk);
        const result = resolveGateQuickExemption({
          root: repo.dir,
          issueNumber: '1',
          backend: 'local',
          baseSha,
          targetSha: guardrail ? guardedTargetSha : targetSha,
        });
        assert.equal(
          result.exempt,
          size === 'quick' && risk === 'normal' && !guardrail,
          `${size}/${risk}/guardrail=${guardrail}`,
        );
      }
    }
  }

  fs.writeFileSync(stateFilePath(repo.dir, '1'), stringify({}));
  const defaults = resolveGateQuickExemption({ root: repo.dir, issueNumber: '1', backend: 'local', baseSha, targetSha });
  assert.deepEqual(defaults.size, { status: 'resolved', value: 'standard' });
  assert.deepEqual(defaults.risk, { status: 'resolved', value: 'other' });
  assert.equal(defaults.exempt, false);

  writeSignals(repo.dir, 'invalid', 'normal');
  const invalid = resolveGateQuickExemption({ root: repo.dir, issueNumber: '1', backend: 'local', baseSha, targetSha });
  assert.equal(invalid.exempt, false);
  assert.equal(invalid.size.status, 'unresolved');
});

test('base SHA不在とガードレール差分は免除不成立へ倒す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writeSignals(repo.dir, 'quick', 'normal');
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(repo.dir, 'AGENTS.md'), '# changed\n');
  execFileSync('git', ['add', 'AGENTS.md'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: guardrail'], { cwd: repo.dir });
  const targetSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  assert.equal(resolveGateQuickExemption({ root: repo.dir, issueNumber: '1', backend: 'local', targetSha }).exempt, false);
  assert.equal(resolveGateQuickExemption({ root: repo.dir, issueNumber: '1', backend: 'local', baseSha, targetSha }).exempt, false);
  const invalidDiff = resolveGateQuickExemption({
    root: repo.dir,
    issueNumber: '1',
    backend: 'local',
    baseSha,
    targetSha: 'not-a-commit',
  });
  assert.equal(invalidDiff.exempt, false);
  assert.equal(invalidDiff.guardrail.status, 'unresolved');
});
