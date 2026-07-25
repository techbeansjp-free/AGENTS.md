import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../helpers/cli.js';

// Issue #169 T3: upgrade コマンドの結合テスト。init実行後の資産に対しミラー更新・project/不可侵性・
// 未導入時のエラーハンドリングを検証する。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('upgrade: .installed_version不在（未導入）の場合はエラー終了する', (t) => {
  const targetDir = mkScratch('upgrade-uninitialized');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['upgrade', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /先に init を実行してください/);
});

test('upgrade --dry-run: 実ファイルへは一切書き込まない', (t) => {
  const targetDir = mkScratch('upgrade-dry-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);

  const conventionsPath = path.join(targetDir, '.agent-skill-chain', 'standards', 'GIT_CONVENTIONS.md');
  fs.appendFileSync(conventionsPath, '\ncustom local edit\n');
  const before = fs.readFileSync(conventionsPath, 'utf8');

  const result = runCli(['upgrade', targetDir, '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /planned overwritten:/);
  assert.equal(fs.readFileSync(conventionsPath, 'utf8'), before, 'dry-runでは実ファイルが変更されないこと');
});

test('upgrade: .agent-skill-chain/project/配下のカスタム内容は変更されず、標準アセットはパッケージ同梱版へ上書きされる', (t) => {
  const targetDir = mkScratch('upgrade-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);

  const conventionsPath = path.join(targetDir, '.agent-skill-chain', 'standards', 'GIT_CONVENTIONS.md');
  const originalContent = fs.readFileSync(conventionsPath, 'utf8');
  fs.appendFileSync(conventionsPath, '\ncustom local edit that must be overwritten\n');

  const projectDir = path.join(targetDir, '.agent-skill-chain', 'project');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'RULES.md'), 'カスタムプロジェクトルール\n');

  const result = runCli(['upgrade', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^0\.\d+\.\d+ -> 0\.\d+\.\d+/);
  assert.equal(
    fs.readFileSync(conventionsPath, 'utf8'),
    originalContent,
    '標準アセットはパッケージ同梱版の内容へ上書きされること',
  );
  assert.equal(
    fs.readFileSync(path.join(projectDir, 'RULES.md'), 'utf8'),
    'カスタムプロジェクトルール\n',
    'project/配下は変更されないこと',
  );
});

test('upgrade: .installed_versionが現行パッケージバージョンへ更新される', (t) => {
  const targetDir = mkScratch('upgrade-version-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);

  const versionPath = path.join(targetDir, '.agent-skill-chain', '.installed_version');
  fs.writeFileSync(versionPath, '0.0.1\n');

  const result = runCli(['upgrade', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^0\.0\.1 -> /);
  assert.notEqual(fs.readFileSync(versionPath, 'utf8').trim(), '0.0.1');
});

test('upgrade: 同期済みlegacy gate workflowは配布最新版へ安全に修復する', (t) => {
  const targetDir = mkScratch('upgrade-gate-migration');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  const relative = path.join('workflows', 'agent-skill-chain-gate.yml');
  const installedTemplate = path.join(targetDir, '.agent-skill-chain', 'templates', 'github', '.github', relative);
  const deployed = path.join(targetDir, '.github', relative);
  const legacy = 'name: legacy gate\n# in-ci model invocation\n';
  fs.writeFileSync(installedTemplate, legacy);
  fs.writeFileSync(deployed, legacy);

  const result = runCli(['upgrade', targetDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(deployed, 'utf8'), fs.readFileSync(installedTemplate, 'utf8'));
  assert.match(fs.readFileSync(deployed, 'utf8'), /gate verify-evidence/);
  assert.doesNotMatch(fs.readFileSync(deployed, 'utf8'), /in-ci model invocation/);
});

test('upgrade: 展開済みworkflowのlocal customization競合は全体を無変更で停止する', (t) => {
  const targetDir = mkScratch('upgrade-gate-conflict');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  const relative = path.join('workflows', 'agent-skill-chain-gate.yml');
  const installedTemplate = path.join(targetDir, '.agent-skill-chain', 'templates', 'github', '.github', relative);
  const deployed = path.join(targetDir, '.github', relative);
  const conventions = path.join(targetDir, '.agent-skill-chain', 'standards', 'GIT_CONVENTIONS.md');
  const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
  fs.appendFileSync(deployed, '\n# consumer customization\n');
  fs.appendFileSync(conventions, '\ncustom standard before failed upgrade\n');
  fs.writeFileSync(version, '0.0.1\n');
  const beforeTemplate = fs.readFileSync(installedTemplate);
  const beforeDeployed = fs.readFileSync(deployed);
  const beforeConventions = fs.readFileSync(conventions);

  const result = runCli(['upgrade', targetDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local customization競合/);
  assert.deepEqual(fs.readFileSync(installedTemplate), beforeTemplate);
  assert.deepEqual(fs.readFileSync(deployed), beforeDeployed);
  assert.deepEqual(fs.readFileSync(conventions), beforeConventions);
  assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
});
