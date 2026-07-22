import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readInstalledVersion, writeInstalledVersion, versionMarkerPath } from '../../src/lib/version-marker.js';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Issue #169 T1: .agent-skill-chain/.installed_version の読み書き（02_設計§4データ設計）

test('readInstalledVersion: .installed_version が存在しない場合 undefined を返す', () => {
  const root = mkdtemp('version-marker-');
  assert.equal(readInstalledVersion(root), undefined);
});

test('writeInstalledVersion → readInstalledVersion: ラウンドトリップで元のバージョン文字列を復元する', () => {
  const root = mkdtemp('version-marker-');

  writeInstalledVersion(root, '0.1.51');

  assert.equal(readInstalledVersion(root), '0.1.51');
  assert.equal(fs.readFileSync(versionMarkerPath(root), 'utf8'), '0.1.51\n');
});

test('writeInstalledVersion: 親ディレクトリ（.agent-skill-chain/）が無くても自動作成する', () => {
  const root = mkdtemp('version-marker-');
  assert.equal(fs.existsSync(path.join(root, '.agent-skill-chain')), false);

  writeInstalledVersion(root, '1.0.0');

  assert.equal(readInstalledVersion(root), '1.0.0');
});

test('writeInstalledVersion: 既存の記録は新しいバージョンで上書きされる', () => {
  const root = mkdtemp('version-marker-');
  writeInstalledVersion(root, '0.1.0');
  writeInstalledVersion(root, '0.2.0');

  assert.equal(readInstalledVersion(root), '0.2.0');
});
