import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

// Issue #169 T1: dry-run 対応（02_設計§2.5 ADR / 03_実装計画 2.1.3）

test('copyTreeFailOnConflict: dryRun:true では宛先にファイルが一切作成されない', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'world');

  const results = copyTreeFailOnConflict(src, dest, { dryRun: true });

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.planned === true));
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false);
  assert.equal(fs.existsSync(path.join(dest, 'sub')), false, 'ネストしたサブディレクトリも作成されないこと');
});

test('copyTreeFailOnConflict: dryRun:true でも内容が異なる既存ファイルへの衝突は検知されCliErrorを投げる', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'new-content');
  fs.writeFileSync(path.join(dest, 'a.txt'), 'old-content');

  assert.throws(() => copyTreeFailOnConflict(src, dest, { dryRun: true }), CliError);
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'old-content', '衝突検知後も既存ファイルは変更されないこと');
});

test('copyTreeFailOnConflict: dryRun:true・内容が同一な既存ファイルは unchanged (planned) になる', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'same-content');
  fs.writeFileSync(path.join(dest, 'a.txt'), 'same-content');

  const results = copyTreeFailOnConflict(src, dest, { dryRun: true });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.action, 'unchanged');
  assert.equal(results[0]?.planned, true);
});

test('copyTreeMirror: dryRun:true では宛先にファイルが一切作成されない', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello');

  const results = copyTreeMirror(src, dest, { dryRun: true });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.action, 'created');
  assert.equal(results[0]?.planned, true);
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false);
});

test('copyTreeMirror: source symlinkは追従せず書込み前に拒否する', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  const outside = path.join(mkdtemp('fs-copy-outside-'), 'outside.txt');
  fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(src, 'linked.txt'));

  assert.throws(() => copyTreeMirror(src, dest), /mirror元.*symlink/);
  assert.deepEqual(fs.readdirSync(dest), []);
});

test('copyTreeMirror: source boundary symlinkは追従せず書込み前に拒否する', () => {
  const sourceContainer = mkdtemp('fs-copy-source-container-');
  const outside = mkdtemp('fs-copy-source-outside-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(outside, 'a.txt'), 'outside');
  const linkedSource = path.join(sourceContainer, 'linked-source');
  fs.symlinkSync(outside, linkedSource);

  assert.throws(
    () => copyTreeMirror(linkedSource, dest, { sourceBoundary: linkedSource }),
    /mirror元.*symlink/,
  );
  assert.deepEqual(fs.readdirSync(dest), []);
});
test('copyTreeMirror: destination file symlinkは追従せず外部fileを変更しない', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  const outside = path.join(mkdtemp('fs-copy-outside-'), 'outside.txt');
  fs.writeFileSync(path.join(src, 'a.txt'), 'new');
  fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(dest, 'a.txt'));

  assert.throws(() => copyTreeMirror(src, dest), /mirror先.*symlink/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
});

test('copyTreeMirror: destination parent symlinkは追従せず外部directoryを書き換えない', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.mkdirSync(path.join(src, 'sub'));
  fs.writeFileSync(path.join(src, 'sub', 'a.txt'), 'new');
  fs.writeFileSync(path.join(outside, 'a.txt'), 'outside');
  fs.symlinkSync(outside, path.join(dest, 'sub'));

  assert.throws(() => copyTreeMirror(src, dest), /mirror先.*symlink/);
  assert.equal(fs.readFileSync(path.join(outside, 'a.txt'), 'utf8'), 'outside');
});

test('copyTreeMirror: destination rootの親symlinkは追従せず外部directoryを書き換えない', () => {
  const src = mkdtemp('fs-copy-src-');
  const aliasContainer = mkdtemp('fs-copy-alias-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'new');
  fs.symlinkSync(outside, path.join(aliasContainer, 'linked-parent'));
  const destination = path.join(aliasContainer, 'linked-parent', 'dest');

  assert.throws(
    () =>
      copyTreeMirror(src, destination, {
        destinationBoundary: path.join(aliasContainer, 'linked-parent'),
      }),
    /mirror先.*symlink/,
  );
  assert.equal(fs.existsSync(path.join(outside, 'dest', 'a.txt')), false);
});

test('copyTreeMirror: source FIFOはopenせず書込み前に拒否する', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  execFileSync('mkfifo', [path.join(src, 'pipe')]);

  assert.throws(() => copyTreeMirror(src, dest), /mirror元.*special file/);
  assert.deepEqual(fs.readdirSync(dest), []);
});

test('copyTreeMirror: destinationのfile位置がdirectoryなら書込み前に拒否する', () => {
  const src = mkdtemp('fs-copy-src-');
  const dest = mkdtemp('fs-copy-dest-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'new');
  fs.mkdirSync(path.join(dest, 'a.txt'));

  assert.throws(() => copyTreeMirror(src, dest), /mirror先.*種別不一致/);
  assert.ok(fs.lstatSync(path.join(dest, 'a.txt')).isDirectory());
});
