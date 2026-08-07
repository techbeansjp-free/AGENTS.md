import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readOwnershipRecord,
  writeOwnershipRecord,
  ownershipRecordPath,
  toOwnershipKey,
  fromOwnershipKey,
  isWithinRoot,
  OWNERSHIP_RECORD_UNREADABLE_WARNING,
} from '../../src/lib/ownership-record.js';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Issue #492 AC-1: 所有権記録が過去の書き込みファイル一覧を保持する（データ設計）。

test('readOwnershipRecord: ファイル不在は正常系としてrecord=undefined・warning無しを返す', () => {
  const root = mkdtemp('ownership-record-');
  const result = readOwnershipRecord(root);
  assert.equal(result.record, undefined);
  assert.equal(result.warning, undefined);
});

test('writeOwnershipRecord → readOwnershipRecord: ラウンドトリップで元の記録を復元する', () => {
  const root = mkdtemp('ownership-record-');
  writeOwnershipRecord(root, { version: '0.3.0', files: { 'AGENTS.md': 'sha256:abc' } });

  const result = readOwnershipRecord(root);

  assert.deepEqual(result.record, { version: '0.3.0', files: { 'AGENTS.md': 'sha256:abc' } });
  assert.equal(result.warning, undefined);
});

test('writeOwnershipRecord: 親ディレクトリ（.agent-skill-chain/）が無くても自動作成する', () => {
  const root = mkdtemp('ownership-record-');
  assert.equal(fs.existsSync(path.join(root, '.agent-skill-chain')), false);

  writeOwnershipRecord(root, { version: '0.1.0', files: {} });

  assert.equal(fs.existsSync(ownershipRecordPath(root)), true);
});

test('writeOwnershipRecord: 既存の記録は新しい内容で上書きされる', () => {
  const root = mkdtemp('ownership-record-');
  writeOwnershipRecord(root, { version: '0.1.0', files: { a: 'sha256:1' } });
  writeOwnershipRecord(root, { version: '0.2.0', files: { b: 'sha256:2' } });

  assert.deepEqual(readOwnershipRecord(root).record, { version: '0.2.0', files: { b: 'sha256:2' } });
});

// Issue #492 DESIGN.md 障害・ロールバック考慮: 所有権記録の破損は例外を投げず安全側（空集合）に倒れる。

test('readOwnershipRecord: JSON構文エラーの場合は例外を投げず記録なし+警告を返す', () => {
  const root = mkdtemp('ownership-record-');
  fs.mkdirSync(path.dirname(ownershipRecordPath(root)), { recursive: true });
  fs.writeFileSync(ownershipRecordPath(root), '{ this is not valid json');

  const result = readOwnershipRecord(root);

  assert.equal(result.record, undefined);
  assert.equal(result.warning, OWNERSHIP_RECORD_UNREADABLE_WARNING);
});

test('readOwnershipRecord: 想定構造と異なる（filesが配列等）場合は記録なし+警告を返す', () => {
  const root = mkdtemp('ownership-record-');
  fs.mkdirSync(path.dirname(ownershipRecordPath(root)), { recursive: true });
  fs.writeFileSync(ownershipRecordPath(root), JSON.stringify({ version: '0.1.0', files: ['a', 'b'] }));

  const result = readOwnershipRecord(root);

  assert.equal(result.record, undefined);
  assert.equal(result.warning, OWNERSHIP_RECORD_UNREADABLE_WARNING);
});

test('readOwnershipRecord: versionフィールド欠損の場合は記録なし+警告を返す', () => {
  const root = mkdtemp('ownership-record-');
  fs.mkdirSync(path.dirname(ownershipRecordPath(root)), { recursive: true });
  fs.writeFileSync(ownershipRecordPath(root), JSON.stringify({ files: {} }));

  const result = readOwnershipRecord(root);

  assert.equal(result.record, undefined);
  assert.equal(result.warning, OWNERSHIP_RECORD_UNREADABLE_WARNING);
});

// パス正規化（root相対・`/`区切りキー）のラウンドトリップ。

test('toOwnershipKey / fromOwnershipKey: 絶対パス⇔正規化キーを相互変換できる', () => {
  const root = path.join(path.sep, 'tmp', 'target');
  const absolute = path.join(root, '.agent-skill-chain', 'standards', 'GIT_CONVENTIONS.md');

  const key = toOwnershipKey(root, absolute);

  assert.equal(key, '.agent-skill-chain/standards/GIT_CONVENTIONS.md');
  assert.equal(fromOwnershipKey(root, key), absolute);
});

test('isWithinRoot: 通常のキーはroot配下と判定される', () => {
  const root = path.join(path.sep, 'tmp', 'target');
  assert.equal(isWithinRoot(root, 'AGENTS.md'), true);
  assert.equal(isWithinRoot(root, '.agent-skill-chain/standards/GIT_CONVENTIONS.md'), true);
});

test('isWithinRoot: root外を指す破損・改ざんキーはfalseと判定される', () => {
  const root = path.join(path.sep, 'tmp', 'target');
  assert.equal(isWithinRoot(root, '../outside.txt'), false);
  assert.equal(isWithinRoot(root, '../../etc/passwd'), false);
});
