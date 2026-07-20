import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../helpers/cli.js';

// Issue #169 T5: enforce コマンドの結合テスト。.claude/settings.json への配線/解除・既存フィールドの
// 温存・idempotencyをbin/agents-md.js経由のsubprocess実行で検証する。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

function initTargetDir(prefix: string): string {
  const targetDir = mkScratch(prefix);
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);
  return targetDir;
}

function readSettingsJson(targetDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(targetDir, '.claude', 'settings.json'), 'utf8'));
}

test('enforce on: hooks.PreToolUseにエントリが追加され、既存のpermissions.deny等の無関係フィールドは変更されない', (t) => {
  const targetDir = initTargetDir('enforce-on');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(targetDir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { deny: ['Bash(rm -rf *)'] } }),
  );

  const result = runCli(['enforce', 'on', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /配線したhookはBashツールのコマンド文字列のみを検査します/);
  assert.match(result.stdout, /Agent\/Task等の非Bashツール呼び出しは本hookの対象外/);

  const settings = readSettingsJson(targetDir) as {
    permissions?: { deny: string[] };
    hooks?: { PreToolUse?: { matcher?: string; hooks: { type: string; command: string }[] }[] };
  };
  assert.deepEqual(settings.permissions, { deny: ['Bash(rm -rf *)'] }, '既存フィールドが変更されないこと');
  assert.equal(settings.hooks?.PreToolUse?.length, 1);
  assert.equal(settings.hooks?.PreToolUse?.[0]?.matcher, 'Bash');

  assert.ok(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'hooks', 'claude-pretooluse.sh')),
    'hookスクリプト本体が配置されること',
  );
});

test('enforce on: 2回連続実行してもPreToolUseエントリが重複しない（idempotent）', (t) => {
  const targetDir = initTargetDir('enforce-idempotent');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const first = runCli(['enforce', 'on', targetDir]);
  assert.equal(first.status, 0, first.stderr);
  const second = runCli(['enforce', 'on', targetDir]);
  assert.equal(second.status, 0, second.stderr);

  const settings = readSettingsJson(targetDir) as { hooks?: { PreToolUse?: unknown[] } };
  assert.equal(settings.hooks?.PreToolUse?.length, 1);
});

test('enforce off: 配線済みエントリのみを除去し、他のhooksイベント・フィールドは温存する', (t) => {
  const targetDir = initTargetDir('enforce-off');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(targetDir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { SomeOtherEvent: [{ foo: 'bar' }] } }),
  );

  const on = runCli(['enforce', 'on', targetDir]);
  assert.equal(on.status, 0, on.stderr);

  const off = runCli(['enforce', 'off', targetDir]);
  assert.equal(off.status, 0, off.stderr);

  const settings = readSettingsJson(targetDir) as { hooks?: { PreToolUse?: unknown[]; SomeOtherEvent?: unknown[] } };
  assert.equal(settings.hooks?.PreToolUse, undefined, 'PreToolUseエントリが除去されること');
  assert.deepEqual(settings.hooks?.SomeOtherEvent, [{ foo: 'bar' }], '無関係な既存hooksイベントは温存されること');
});

test('enforce off: 未配線状態に対しても冪等にエラーなく成功する', (t) => {
  const targetDir = initTargetDir('enforce-off-noop');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['enforce', 'off', targetDir]);

  assert.equal(result.status, 0, result.stderr);
});

test('enforce: on/off以外の第一引数は使い方を表示し終了コード1を返す', (t) => {
  const targetDir = initTargetDir('enforce-invalid');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['enforce', 'maybe', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /'on' または 'off'/);
});

test('enforce on: .claude/settings.jsonのJSON解析に失敗する場合は理由を返しファイルを変更しない', (t) => {
  const targetDir = initTargetDir('enforce-invalid-json');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(targetDir, '.claude'), { recursive: true });
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  fs.writeFileSync(settingsPath, '{ not valid json');

  const result = runCli(['enforce', 'on', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /解析に失敗しました/);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ not valid json', 'ファイルが変更されないこと');
});
