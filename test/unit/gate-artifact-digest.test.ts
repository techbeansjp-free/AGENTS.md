import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { artifactDigestAtSha } from '../../src/commands/gate.js';
import { digestOf } from '../../src/lib/digest.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';

test('artifact digestはinvalid UTF-8をlossy文字列化せずGit blobのexact bytesをhashする', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const artifactPath = path.join(repo.dir, 'binary-artifact.bin');

  fs.writeFileSync(artifactPath, Buffer.from([0x80]));
  execFileSync('git', ['add', 'binary-artifact.bin'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: binary artifact one'], { cwd: repo.dir });
  const firstSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  fs.writeFileSync(artifactPath, Buffer.from([0x81]));
  execFileSync('git', ['add', 'binary-artifact.bin'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: binary artifact two'], { cwd: repo.dir });
  const secondSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  const firstBytes = execFileSync('git', ['show', `${firstSha}:binary-artifact.bin`], { cwd: repo.dir });
  const secondBytes = execFileSync('git', ['show', `${secondSha}:binary-artifact.bin`], { cwd: repo.dir });
  assert.equal(firstBytes.toString('utf8'), secondBytes.toString('utf8'), 'lossy decodeでは同じ置換文字になる前提');
  assert.notDeepEqual(firstBytes, secondBytes);
  assert.equal(artifactDigestAtSha(repo.dir, 'binary-artifact.bin', firstSha), digestOf(firstBytes));
  assert.equal(artifactDigestAtSha(repo.dir, 'binary-artifact.bin', secondSha), digestOf(secondBytes));
  assert.notEqual(
    artifactDigestAtSha(repo.dir, 'binary-artifact.bin', firstSha),
    artifactDigestAtSha(repo.dir, 'binary-artifact.bin', secondSha),
  );
});

test('artifact digestは実在blobと欠落sentinelをdomain separationして削除を必ず検出する', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const artifactPath = path.join(repo.dir, 'collision.txt');

  fs.writeFileSync(artifactPath, 'agent-skill-chain:artifact-absent:v1');
  execFileSync('git', ['add', 'collision.txt'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: add sentinel collision bytes'], { cwd: repo.dir });
  const presentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo.dir,
    encoding: 'utf8',
  }).trim();

  fs.rmSync(artifactPath);
  execFileSync('git', ['add', 'collision.txt'], { cwd: repo.dir });
  execFileSync('git', ['commit', '-m', 'test: remove sentinel collision bytes'], { cwd: repo.dir });
  const absentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo.dir,
    encoding: 'utf8',
  }).trim();

  assert.notEqual(
    artifactDigestAtSha(repo.dir, 'collision.txt', presentSha, true),
    artifactDigestAtSha(repo.dir, 'collision.txt', absentSha, true),
  );
});
