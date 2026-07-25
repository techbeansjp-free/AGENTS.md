import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const script = path.join(repoRoot, '.agent-skill-chain', 'scripts', 'detect-changed-segments.sh');
const ciWorkflow = path.join(repoRoot, '.github', 'workflows', 'agent-skill-chain-ci.yml');
const ciTemplate = path.join(repoRoot, '.agent-skill-chain', 'templates', 'github', '.github', 'workflows', 'agent-skill-chain-ci.yml');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function withRepository(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-segment-detection-'));
  try {
    git(dir, ['init', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
    git(dir, ['add', 'README.md']);
    git(dir, ['commit', '-m', 'initial']);
    git(dir, ['checkout', '-b', 'feature/segment-detection']);
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function detect(dir: string): string[] {
  return execFileSync('bash', [script, 'main'], { cwd: dir, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

test('detect-changed-segments: 成果物と実装の差分から開始済みセグメントだけを固定順で返す', () => {
  withRepository((dir) => {
    fs.writeFileSync(path.join(dir, 'SPEC.md'), '# SPEC\n');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), '# DESIGN\n');
    fs.writeFileSync(path.join(dir, 'PLAN.md'), '# PLAN\n');
    fs.mkdirSync(path.join(dir, 'docs', 'adr'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'adr', 'ADR-0001.md'), '# ADR\n');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const value = 1;\n');
    fs.mkdirSync(path.join(dir, 'test', 'unit'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'test', 'unit', 'app.test.ts'), 'export {};\n');
    fs.writeFileSync(path.join(dir, 'VALIDATION.md'), '# VALIDATION\n');
    git(dir, ['add', '--all']);
    git(dir, ['commit', '-m', 'add every segment artifact']);

    assert.deepEqual(detect(dir), ['spec', 'design', 'implementation', 'validation']);
  });
});

test('detect-changed-segments: CI設定だけの変更は未開始セグメントを作らない', () => {
  withRepository((dir) => {
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: fixture\n');
    git(dir, ['add', '--all']);
    git(dir, ['commit', '-m', 'change workflow only']);

    assert.deepEqual(detect(dir), []);
  });
});

test('CIはvalidationが開始されたPRだけでAC対応を検証し、配布テンプレートも一致する', () => {
  const workflow = fs.readFileSync(ciWorkflow, 'utf8');
  assert.match(workflow, /id: segments/);
  assert.match(workflow, /contains\(steps\.segments\.outputs\.values, 'validation'\)/);
  assert.equal(workflow, fs.readFileSync(ciTemplate, 'utf8'));
});
