import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSettings,
  writeSettings,
  addPreToolUseHook,
  removePreToolUseHook,
  isPreToolUseHookWired,
} from '../../src/lib/claude-settings.js';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Issue #169 T5: claude-settings.ts（.claude/settings.json のPreToolUse hookエントリのマージ/削除）

test('readSettings: ファイル不在時は空オブジェクトを返す', () => {
  const dir = mkdtemp('claude-settings-');
  const settings = readSettings(path.join(dir, '.claude', 'settings.json'));
  assert.deepEqual(settings, {});
});

test('readSettings: 不正なJSONは例外を投げる', () => {
  const dir = mkdtemp('claude-settings-');
  const filePath = path.join(dir, 'settings.json');
  fs.writeFileSync(filePath, '{ not json');
  assert.throws(() => readSettings(filePath));
});

test('addPreToolUseHook: 2回連続適用してもエントリが重複しない（idempotent）', () => {
  const once = addPreToolUseHook({}, 'hooks/claude-pretooluse.sh');
  const twice = addPreToolUseHook(once, 'hooks/claude-pretooluse.sh');

  assert.equal(twice.hooks?.PreToolUse?.length, 1);
});

test('addPreToolUseHook: 既存のpermissions.deny等の無関係なフィールドを変更しない', () => {
  const before = { permissions: { deny: ['Bash(rm -rf *)'] } };
  const after = addPreToolUseHook(before, 'hooks/claude-pretooluse.sh');

  assert.deepEqual(after.permissions, { deny: ['Bash(rm -rf *)'] });
  assert.equal(after.hooks?.PreToolUse?.[0]?.matcher, 'Bash');
  assert.equal(after.hooks?.PreToolUse?.[0]?.hooks[0]?.command, 'hooks/claude-pretooluse.sh');
});

test('addPreToolUseHook: 既存の他のhooksイベント(SomeOtherEvent等)を温存する', () => {
  const before = { hooks: { SomeOtherEvent: [{ foo: 'bar' }] } };
  const after = addPreToolUseHook(before, 'hooks/claude-pretooluse.sh');

  assert.deepEqual(after.hooks?.SomeOtherEvent, [{ foo: 'bar' }]);
});

test('removePreToolUseHook: 対象commandPathのエントリのみを除去し、無関係な既存エントリは温存する', () => {
  const before = addPreToolUseHook(
    { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other/unrelated.sh' }] }] } },
    'hooks/claude-pretooluse.sh',
  );

  const after = removePreToolUseHook(before, 'hooks/claude-pretooluse.sh');

  assert.equal(after.hooks?.PreToolUse?.length, 1);
  assert.equal(after.hooks?.PreToolUse?.[0]?.hooks[0]?.command, 'other/unrelated.sh');
});

test('removePreToolUseHook: 除去後にPreToolUseが空になればキー自体を削除する', () => {
  const wired = addPreToolUseHook({}, 'hooks/claude-pretooluse.sh');
  const removed = removePreToolUseHook(wired, 'hooks/claude-pretooluse.sh');

  assert.equal(removed.hooks?.PreToolUse, undefined);
});

test('removePreToolUseHook: 未配線のsettingsに対しても例外を投げず、そのまま返す（冪等）', () => {
  const before = { permissions: { deny: [] } };
  const after = removePreToolUseHook(before, 'hooks/claude-pretooluse.sh');

  assert.deepEqual(after, before);
});

test('isPreToolUseHookWired: 配線済み/未配線を正しく判定する', () => {
  const unwired = {};
  const wired = addPreToolUseHook(unwired, 'hooks/claude-pretooluse.sh');

  assert.equal(isPreToolUseHookWired(unwired, 'hooks/claude-pretooluse.sh'), false);
  assert.equal(isPreToolUseHookWired(wired, 'hooks/claude-pretooluse.sh'), true);
});

test('writeSettings → readSettings: ラウンドトリップで内容を復元し、親ディレクトリも自動作成する', () => {
  const dir = mkdtemp('claude-settings-');
  const filePath = path.join(dir, '.claude', 'settings.json');

  writeSettings(filePath, { permissions: { deny: ['x'] } });

  assert.deepEqual(readSettings(filePath), { permissions: { deny: ['x'] } });
});
