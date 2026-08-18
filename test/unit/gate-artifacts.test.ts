import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import {
  artifactSetStatus,
  extractAcIdsFromArtifact,
  readArtifactAtSha,
  readRequiredGateArtifacts,
} from '../../src/lib/gate-artifacts.js';

function commit(repoDir: string): string {
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'test: artifact states'], { cwd: repoDir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
}

test('target treeから存在・不在・blob以外を三値で区別する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  fs.writeFileSync(path.join(repo.dir, 'SPEC.md'), '# SPEC\n\n#### AC-2: two\n#### AC-1: one\n');
  fs.mkdirSync(path.join(repo.dir, 'PLAN.md'));
  fs.writeFileSync(path.join(repo.dir, 'PLAN.md', 'nested.txt'), 'not a blob\n');
  const sha = commit(repo.dir);

  const spec = readArtifactAtSha(repo.dir, sha, 'SPEC.md');
  assert.equal(spec.status, 'present');
  assert.deepEqual(extractAcIdsFromArtifact(spec), { status: 'present', ids: ['AC-1', 'AC-2'] });
  assert.equal(readArtifactAtSha(repo.dir, sha, 'DESIGN.md').status, 'absent');
  assert.equal(readArtifactAtSha(repo.dir, sha, 'PLAN.md').status, 'unreadable');
  assert.equal(artifactSetStatus(readRequiredGateArtifacts(repo.dir, sha, 'design')), 'unreadable');
  assert.equal(artifactSetStatus(readRequiredGateArtifacts(repo.dir, sha, 'implementation')), 'present');
  const unreadable = readArtifactAtSha(repo.dir, 'not-a-commit', 'SPEC.md');
  assert.equal(unreadable.status, 'unreadable');
  assert.deepEqual(extractAcIdsFromArtifact(unreadable), { status: 'unreadable', ids: [] });
});

test('Git pathspec magicを含む成果物パスを別のblobへ誤束縛しない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  fs.writeFileSync(path.join(repo.dir, 'foo'), 'pathspec target\n');
  fs.writeFileSync(path.join(repo.dir, ':(literal)foo'), 'literal filename\n');
  const sha = commit(repo.dir);

  assert.deepEqual(readArtifactAtSha(repo.dir, sha, ':(literal)foo'), {
    status: 'present',
    path: ':(literal)foo',
    content: 'literal filename\n',
  });
});
