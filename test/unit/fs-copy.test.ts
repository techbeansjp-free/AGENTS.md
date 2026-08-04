import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyTreeFailOnConflict, copyTreeMirror } from '../../src/lib/fs-copy.js';
import { CliError } from '../../src/lib/issue.js';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * ディレクトリ配下のentry種別・内容を再現可能な文字列へ落とす。導入先ルート外のsentinelが
 * 1byteも変わらず、新規fileも増えていないことを機械的に検証するために使う（Issue #288）。
 */
function snapshot(dir: string): string {
  const lines: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) {
        lines.push(`symlink ${rel} -> ${fs.readlinkSync(full)}`);
        continue;
      }
      if (entry.isDirectory()) {
        lines.push(`dir ${rel}`);
        walk(full, rel);
        continue;
      }
      if (entry.isFile()) {
        lines.push(`file ${rel} ${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
        continue;
      }
      lines.push(`other ${rel}`);
    }
  };
  walk(dir, '');
  return lines.join('\n');
}

/** mkfifo が使えない環境ではFIFO関連の検証を成立させられないため、その旨を呼び出し側へ返す。 */
function tryMakeFifo(target: string): boolean {
  try {
    execFileSync('mkfifo', [target], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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

// Issue #169 T1: dry-run 対応（ADR判断事項）

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

// Issue #288: 配布先・配布元のsymlink追従による導入先ルート外への書込みを塞ぐ。
// 各testは「導入先ルート外のsentinelがbyte単位で不変」かつ「ルート外に新規fileが増えない」ことを検証する。

test('AC-1: 配布先leafが絶対symlinkのとき追従せず停止し、リンク先を書き換えない', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'external');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  fs.symlinkSync(sentinel, path.join(dest, 'a.txt'));
  const before = snapshot(outside);

  assert.throws(
    () => copyTreeFailOnConflict(src, dest, { root }),
    (error: unknown) => error instanceof CliError && error.message.includes('symlink'),
  );
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'external');
  assert.equal(snapshot(outside), before, '導入先ルート外は1byteも変わらないこと');
  assert.equal(fs.lstatSync(path.join(dest, 'a.txt')).isSymbolicLink(), true, 'symlink自体も残すこと');
});

test('AC-1: 配布先leafが相対symlinkのとき追従せず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'external');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  fs.symlinkSync(path.relative(dest, sentinel), path.join(dest, 'a.txt'));
  const before = snapshot(outside);

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'external');
  assert.equal(snapshot(outside), before);
});

test('AC-1: 配布先leafが同一内容を指すsymlinkでも unchanged 扱いにせず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'same-content');
  fs.writeFileSync(path.join(src, 'a.txt'), 'same-content');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  fs.symlinkSync(sentinel, path.join(dest, 'a.txt'));

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
});

test('AC-1: 配布先leafがbroken symlinkのときリンク先を作成せず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const missing = path.join(outside, 'missing.txt');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  fs.symlinkSync(missing, path.join(dest, 'a.txt'));
  const before = snapshot(outside);

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.existsSync(missing), false, 'リンク先を新規作成しないこと');
  assert.equal(snapshot(outside), before);
});

test('AC-1: 配布先の親componentがsymlinkのとき、その先へ一切作成せず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  fs.symlinkSync(outside, path.join(root, '.agent-skill-chain'));
  const dest = path.join(root, '.agent-skill-chain', 'scripts');
  const before = snapshot(outside);

  assert.throws(
    () => copyTreeFailOnConflict(src, dest, { root }),
    (error: unknown) => error instanceof CliError && error.message.includes('symlink'),
  );
  assert.equal(snapshot(outside), before, 'ルート外へ新規fileが作られないこと');
});

test('AC-1: 配布先ディレクトリ自体がsymlinkのとき停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.symlinkSync(outside, dest);
  const before = snapshot(outside);

  assert.throws(() => copyTreeFailOnConflict(src, dest), CliError);
  assert.equal(snapshot(outside), before);
});

test('AC-1: dry-runでも配布先symlinkを検知して停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'external');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  fs.symlinkSync(sentinel, path.join(dest, 'a.txt'));
  const before = snapshot(outside);

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root, dryRun: true }), CliError);
  assert.equal(snapshot(outside), before);
});

test('AC-1: 配布先が導入先ルートの外を指す場合は停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const before = snapshot(outside);

  assert.throws(() => copyTreeFailOnConflict(src, path.join(root, '..', path.basename(outside)), { root }), CliError);
  assert.equal(snapshot(outside), before);
});

test('AC-2: 配布元leafがsymlinkのとき1byteも配布せず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'external');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  fs.symlinkSync(sentinel, path.join(src, 'z-link.txt'));
  const dest = path.join(root, 'assets');

  assert.throws(
    () => copyTreeFailOnConflict(src, dest, { root }),
    (error: unknown) => error instanceof CliError && error.message.includes('配布元'),
  );
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false, '前段のentryも書き込まれないこと');
});

test('AC-2: 配布元のサブディレクトリがsymlinkのとき停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'external');
  fs.symlinkSync(outside, path.join(src, 'sub'));
  const dest = path.join(root, 'assets');

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.existsSync(path.join(dest, 'sub')), false);
});

test('AC-2: 配布元ルート自体がsymlinkのとき停止する', () => {
  const real = mkdtemp('fs-copy-real-');
  const holder = mkdtemp('fs-copy-holder-');
  const root = mkdtemp('fs-copy-root-');
  fs.writeFileSync(path.join(real, 'a.txt'), 'package-asset');
  const src = path.join(holder, 'link');
  fs.symlinkSync(real, src);
  const dest = path.join(root, 'assets');

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.existsSync(dest), false);
});

test('AC-2: 配布元にFIFOがあるとき1byteも配布せず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  if (!tryMakeFifo(path.join(src, 'z-fifo'))) return; // mkfifo非対応環境では検証不能
  const dest = path.join(root, 'assets');

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false, '前段のentryも書き込まれないこと');
});

test('AC-2: 配布先がFIFOのとき通常ファイルとして扱わず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  if (!tryMakeFifo(path.join(dest, 'a.txt'))) return; // mkfifo非対応環境では検証不能

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.lstatSync(path.join(dest, 'a.txt')).isFIFO(), true, 'FIFOを置き換えないこと');
});

test('AC-3: 配布先の同名entryがディレクトリのとき種別違いとして停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(path.join(dest, 'a.txt'), { recursive: true });

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.statSync(path.join(dest, 'a.txt')).isDirectory(), true);
});

test('AC-3: 配布先の同名entryがファイルなのに配布元がディレクトリのとき停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  fs.mkdirSync(path.join(src, 'sub'));
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'sub'), 'existing-file');

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.readFileSync(path.join(dest, 'sub'), 'utf8'), 'existing-file');
});

test('AC-3: 後段のentryで衝突したとき前段のentryも書き込まれない', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'new-a');
  fs.writeFileSync(path.join(src, 'b.txt'), 'new-b');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'b.txt'), 'old-b');

  assert.throws(() => copyTreeFailOnConflict(src, dest, { root }), CliError);
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false, '衝突検知前のentryも作られないこと');
  assert.equal(fs.readFileSync(path.join(dest, 'b.txt'), 'utf8'), 'old-b');
});

test('AC-3: 通常のfile・directoryのみのtreeは導入先ルート内だけに作成される', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.mkdirSync(path.join(src, 'sub'));
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'b');
  const dest = path.join(root, '.agent-skill-chain', 'scripts');
  const before = snapshot(outside);

  const results = copyTreeFailOnConflict(src, dest, { root });

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.action === 'created'));
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'a');
  assert.equal(fs.readFileSync(path.join(dest, 'sub', 'b.txt'), 'utf8'), 'b');
  assert.equal(snapshot(outside), before, '導入先ルート外に新規fileが作られないこと');
  // 2回目は冪等（unchanged）であること。
  const again = copyTreeFailOnConflict(src, dest, { root });
  assert.ok(again.every((r) => r.action === 'unchanged'));
});

test('AC-3: 配布元の実行権限が導入先へ引き継がれる', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const script = path.join(src, 'run.sh');
  fs.writeFileSync(script, '#!/usr/bin/env bash\n');
  fs.chmodSync(script, 0o755);
  const dest = path.join(root, 'assets');

  copyTreeFailOnConflict(src, dest, { root });

  assert.equal(fs.statSync(path.join(dest, 'run.sh')).mode & 0o111, 0o111, '実行bitが保たれること');
});

test('AC-4: 検査後にleafがsymlinkへ置換されても追従せず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'external');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  const before = snapshot(outside);

  assert.throws(
    () =>
      copyTreeFailOnConflict(src, dest, {
        root,
        onPlanComplete: () => fs.symlinkSync(sentinel, path.join(dest, 'a.txt')),
      }),
    CliError,
  );
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'external');
  assert.equal(snapshot(outside), before);
});

test('AC-4: 検査後に親ディレクトリがsymlinkへ置換されても追従せず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.mkdirSync(path.join(src, 'sub'));
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  fs.mkdirSync(dest);
  const before = snapshot(outside);

  assert.throws(
    () =>
      copyTreeFailOnConflict(src, dest, {
        root,
        onPlanComplete: () => fs.symlinkSync(outside, path.join(dest, 'sub')),
      }),
    CliError,
  );
  assert.equal(snapshot(outside), before, 'リンク先へ新規fileが作られないこと');
});

test('AC-4: 検査後に親ディレクトリが別の実ディレクトリへ置換されたら停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  fs.mkdirSync(path.join(src, 'sub'));
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'package-asset');
  const dest = path.join(root, 'assets');
  const destSub = path.join(dest, 'sub');
  fs.mkdirSync(destSub, { recursive: true });
  const decoy = path.join(root, 'decoy');
  fs.mkdirSync(decoy);

  assert.throws(
    () =>
      copyTreeFailOnConflict(src, dest, {
        root,
        onPlanComplete: () => {
          fs.rmdirSync(destSub);
          fs.renameSync(decoy, destSub);
        },
      }),
    CliError,
  );
  assert.equal(fs.existsSync(path.join(destSub, 'b.txt')), false);
});

test('AC-4: 検査後に配布元がsymlinkへ置換されても追従せず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'external');
  const asset = path.join(src, 'a.txt');
  fs.writeFileSync(asset, 'package-asset');
  const dest = path.join(root, 'assets');

  assert.throws(
    () =>
      copyTreeFailOnConflict(src, dest, {
        root,
        onPlanComplete: () => {
          fs.unlinkSync(asset);
          fs.symlinkSync(sentinel, asset);
        },
      }),
    (error: unknown) => error instanceof CliError && error.message.includes('配布元'),
  );
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false);
});

test('AC-4: 検査後に配布元が別の実ファイルへ置換されたら停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const asset = path.join(src, 'a.txt');
  fs.writeFileSync(asset, 'package-asset');
  const decoy = path.join(src, 'decoy');
  fs.writeFileSync(decoy, 'swapped');
  const dest = path.join(root, 'assets');

  assert.throws(
    () =>
      copyTreeFailOnConflict(src, dest, {
        root,
        onPlanComplete: () => fs.renameSync(decoy, asset),
      }),
    CliError,
  );
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false);
});

test('copyTreeMirror: 配布先leafがsymlinkでもリンク先を上書きせず停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'external');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  const dest = path.join(root, '.github');
  fs.mkdirSync(dest);
  fs.symlinkSync(sentinel, path.join(dest, 'a.txt'));
  const before = snapshot(outside);

  assert.throws(() => copyTreeMirror(src, dest, { root }), CliError);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'external');
  assert.equal(snapshot(outside), before);
});

test('copyTreeMirror: 配布先の親componentがsymlinkのとき停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.writeFileSync(path.join(src, 'a.txt'), 'package-asset');
  fs.symlinkSync(outside, path.join(root, '.agent-skill-chain'));
  const before = snapshot(outside);

  assert.throws(() => copyTreeMirror(src, path.join(root, '.agent-skill-chain', 'templates'), { root }), CliError);
  assert.equal(snapshot(outside), before);
});

test('copyTreeMirror: 配布元にsymlinkがあるとき停止する', () => {
  const src = mkdtemp('fs-copy-src-');
  const root = mkdtemp('fs-copy-root-');
  const outside = mkdtemp('fs-copy-outside-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'external');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(src, 'a.txt'));
  const dest = path.join(root, '.github');

  assert.throws(() => copyTreeMirror(src, dest, { root }), CliError);
  assert.equal(fs.existsSync(path.join(dest, 'a.txt')), false);
});
