import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { runCli } from '../helpers/cli.js';
import { evidencePromptDigest } from '../../src/lib/review-evidence.js';

const MAX_INJECTED_OBJECTS = 20_000;
const OBJECT_BATCH_SIZE = 1_000;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initializeSourceRepo(dir: string): { baseSha: string; targetSha: string } {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'user.name', 'agent-skill-chain test']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# reviewer prompt determinism fixture\n', 'utf8');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'test: add fixture base']);
  const baseSha = git(dir, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(dir, 'SPEC.md'), '# SPEC\n\nAC-1: deterministic prompt\n', 'utf8');
  git(dir, ['add', 'SPEC.md']);
  git(dir, ['commit', '-m', 'test: add fixture target']);
  return { baseSha, targetSha: git(dir, ['rev-parse', 'HEAD']) };
}

function cloneRepo(sourceDir: string, destination: string): void {
  execFileSync('git', ['clone', '--quiet', '--no-local', sourceDir, destination], { stdio: 'pipe' });
}

function defaultAbbrevLength(repoDir: string, targetSha: string): number {
  return git(repoDir, ['rev-parse', '--short', targetSha]).length;
}

function injectBlobBatch(repoDir: string, start: number, count: number): void {
  const records: string[] = [];
  for (let index = start; index < start + count; index += 1) {
    const body = `gate-reviewer-prompt-object-${index}\n`;
    records.push(`blob\ndata ${Buffer.byteLength(body)}\n${body}`);
  }
  const imported = spawnSync('git', ['fast-import', '--quiet'], {
    cwd: repoDir,
    encoding: 'utf8',
    input: records.join(''),
  });
  if (imported.error) throw imported.error;
  assert.equal(imported.status, 0, imported.stderr);
}

function objectCount(repoDir: string): number {
  const fields = new Map(
    git(repoDir, ['count-objects', '-v'])
      .split('\n')
      .map((line) => line.split(': ', 2) as [string, string]),
  );
  return Number(fields.get('count') ?? 0) + Number(fields.get('in-pack') ?? 0);
}

function reviewerPrompt(repoDir: string, targetSha: string, baseSha: string): string {
  const result = runCli(
    ['gate', 'reviewer-prompt', 'ISSUE-369', 'spec', targetSha, baseSha],
    { cwd: repoDir },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
}

function assertFullIndexHashes(prompt: string): void {
  const diffMatch = prompt.match(/## 判定対象の差分\n```diff\n([\s\S]*?)\n```/);
  assert.ok(diffMatch, '判定対象の差分セクションが存在すること');
  const indexLines = diffMatch[1].match(/^index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?$/gm) ?? [];
  assert.ok(indexLines.length > 0, 'diff区間にindex行が存在すること');
  for (const line of indexLines) {
    const match = line.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: [0-7]{6})?$/);
    assert.ok(match);
    assert.ok(match[1].length === 40 || match[1].length === 64, `old hashが完全長であること: ${line}`);
    assert.equal(match[2].length, match[1].length, `new hashが完全長であること: ${line}`);
  }
}

test('gate reviewer-prompt: auto abbrevが実際に伸長したcloneでも出力とdigestが完全一致する', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-reviewer-prompt-auto-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'source');
  const baselineDir = path.join(root, 'baseline');
  const inflatedDir = path.join(root, 'inflated');
  const { baseSha, targetSha } = initializeSourceRepo(sourceDir);
  cloneRepo(sourceDir, baselineDir);
  cloneRepo(sourceDir, inflatedDir);

  assert.equal(spawnSync('git', ['config', '--get', 'core.abbrev'], { cwd: baselineDir }).status, 1);
  assert.equal(spawnSync('git', ['config', '--get', 'core.abbrev'], { cwd: inflatedDir }).status, 1);
  const baselineAbbrevLength = defaultAbbrevLength(baselineDir, targetSha);
  let inflatedAbbrevLength = baselineAbbrevLength;
  let injectedObjects = 0;
  while (inflatedAbbrevLength <= baselineAbbrevLength && injectedObjects < MAX_INJECTED_OBJECTS) {
    const batchSize = Math.min(OBJECT_BATCH_SIZE, MAX_INJECTED_OBJECTS - injectedObjects);
    injectBlobBatch(inflatedDir, injectedObjects, batchSize);
    injectedObjects += batchSize;
    inflatedAbbrevLength = defaultAbbrevLength(inflatedDir, targetSha);
  }

  assert.ok(
    inflatedAbbrevLength > baselineAbbrevLength,
    `${MAX_INJECTED_OBJECTS}個以内のblob投入でauto abbrevが伸長すること ` +
      `(baseline=${baselineAbbrevLength}, inflated=${inflatedAbbrevLength})`,
  );
  assert.ok(objectCount(inflatedDir) > objectCount(baselineDir));

  const baselinePrompt = reviewerPrompt(baselineDir, targetSha, baseSha);
  const inflatedPrompt = reviewerPrompt(inflatedDir, targetSha, baseSha);
  assertFullIndexHashes(baselinePrompt);
  assertFullIndexHashes(inflatedPrompt);
  assert.equal(inflatedPrompt, baselinePrompt);
  assert.equal(evidencePromptDigest(inflatedPrompt), evidencePromptDigest(baselinePrompt));
});

test('gate reviewer-prompt: core.abbrev=7・12・未設定のcloneで出力とdigestが完全一致する', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-reviewer-prompt-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'source');
  const { baseSha, targetSha } = initializeSourceRepo(sourceDir);
  const variants = [
    { name: 'auto', abbrev: undefined },
    { name: 'abbrev-7', abbrev: '7' },
    { name: 'abbrev-12', abbrev: '12' },
  ];
  const prompts = variants.map(({ name, abbrev }) => {
    const cloneDir = path.join(root, name);
    cloneRepo(sourceDir, cloneDir);
    if (abbrev !== undefined) git(cloneDir, ['config', 'core.abbrev', abbrev]);
    const prompt = reviewerPrompt(cloneDir, targetSha, baseSha);
    assertFullIndexHashes(prompt);
    return prompt;
  });

  for (const prompt of prompts.slice(1)) {
    assert.equal(prompt, prompts[0]);
    assert.equal(evidencePromptDigest(prompt), evidencePromptDigest(prompts[0]));
  }
});
