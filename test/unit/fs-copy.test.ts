import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyTreeFailOnConflict, copyTreeMirror } from '../../src/lib/fs-copy.js';
import { CliError } from '../../src/lib/issue.js';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('copyTreeFailOnConflict: 新規ファイルは created として作成される', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello');

  const results = copyTreeFailOnConflict(src, dest);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.action, 'created');
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'hello');
});

test('copyTreeFailOnConflict: 内容が同一の既存ファイルは unchanged になり上書きされない', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'same-content');
  fs.writeFileSync(path.join(dest, 'a.txt'), 'same-content');

  const results = copyTreeFailOnConflict(src, dest);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.action, 'unchanged');
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'same-content');
});

test('copyTreeFailOnConflict: 内容が異なる既存ファイルがあると CliError を投げ、既存ファイルは変更されない', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'new-content');
  fs.writeFileSync(path.join(dest, 'a.txt'), 'old-content');

  assert.throws(() => copyTreeFailOnConflict(src, dest), CliError);
  // 例外後も既存ファイルの内容は書き換えられていないこと。
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'old-content');
});

test('copyTreeFailOnConflict: ネストしたディレクトリ構造を再帰的にコピーする', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.mkdirSync(path.join(src, 'sub', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(src, 'top.txt'), 'top');
  fs.writeFileSync(path.join(src, 'sub', 'mid.txt'), 'mid');
  fs.writeFileSync(path.join(src, 'sub', 'deep', 'leaf.txt'), 'leaf');

  const results = copyTreeFailOnConflict(src, dest);

  assert.equal(results.length, 3);
  assert.equal(fs.readFileSync(path.join(dest, 'top.txt'), 'utf8'), 'top');
  assert.equal(fs.readFileSync(path.join(dest, 'sub', 'mid.txt'), 'utf8'), 'mid');
  assert.equal(fs.readFileSync(path.join(dest, 'sub', 'deep', 'leaf.txt'), 'utf8'), 'leaf');
  assert.ok(results.every((r) => r.action === 'created'));
});

test('copyTreeFailOnConflict: src が存在しない場合は何もせず空配列を返す', () => {
  const src = path.join(mkdtemp('fs-copy-src-'), 'does-not-exist');
  const dest = mkdtemp('fs-copy-dest-');

  const results = copyTreeFailOnConflict(src, dest);

  assert.deepEqual(results, []);
});

test('copyTreeMirror: 新規ファイルは created になる', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello');

  const results = copyTreeMirror(src, dest);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.action, 'created');
});

test('copyTreeMirror: 既存ファイルは内容の異同に関わらず常に上書きされ overwritten になる', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'new-content');
  fs.writeFileSync(path.join(dest, 'a.txt'), 'old-content');

  const results = copyTreeMirror(src, dest);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.action, 'overwritten');
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'new-content');
});

test('copyTreeMirror: 既存ファイルと内容が同一でも overwritten として扱われる（常に上書き）', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'same-content');
  fs.writeFileSync(path.join(dest, 'a.txt'), 'same-content');

  const results = copyTreeMirror(src, dest);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.action, 'overwritten');
});

test('copyTreeMirror: ネストしたディレクトリ構造を再帰的にミラーコピーする', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.mkdirSync(path.join(src, 'sub', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(src, 'top.txt'), 'top');
  fs.writeFileSync(path.join(src, 'sub', 'mid.txt'), 'mid');
  fs.writeFileSync(path.join(src, 'sub', 'deep', 'leaf.txt'), 'leaf');

  const results = copyTreeMirror(src, dest);

  assert.equal(results.length, 3);
  assert.equal(fs.readFileSync(path.join(dest, 'top.txt'), 'utf8'), 'top');
  assert.equal(fs.readFileSync(path.join(dest, 'sub', 'mid.txt'), 'utf8'), 'mid');
  assert.equal(fs.readFileSync(path.join(dest, 'sub', 'deep', 'leaf.txt'), 'utf8'), 'leaf');
  assert.ok(results.every((r) => r.action === 'created'));
});
