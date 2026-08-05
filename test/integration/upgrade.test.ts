import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGhStub } from '../helpers/gh-stub.js';
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
  const workerAgentPath = path.join(targetDir, '.claude', 'agents', 'agent-skill-chain-worker.md');
  const originalWorkerAgent = fs.readFileSync(workerAgentPath, 'utf8');
  fs.writeFileSync(workerAgentPath, 'customized worker agent\n');

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
    fs.readFileSync(workerAgentPath, 'utf8'),
    originalWorkerAgent,
    '展開済みClaude custom subagent種別も配布templateへ同期されること',
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

test('upgrade: 配布templateは更新するが、展開済みlegacy workflowは暗黙変更しない', (t) => {
  const targetDir = mkScratch('upgrade-gate-migration');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  const relative = path.join('workflows', 'agent-skill-chain-ci.yml');
  const installedTemplate = path.join(targetDir, '.agent-skill-chain', 'templates', 'github', '.github', relative);
  const deployed = path.join(targetDir, '.github', relative);
  const legacy = 'name: legacy ci\n# in-ci model invocation\n';
  fs.writeFileSync(installedTemplate, legacy);
  fs.mkdirSync(path.dirname(deployed), { recursive: true });
  fs.writeFileSync(deployed, legacy);

  const result = runCli(['upgrade', targetDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(installedTemplate, 'utf8'), /agent-skill-chain \/ ci/);
  assert.equal(fs.readFileSync(deployed, 'utf8'), legacy);
  assert.match(result.stdout, /GitHub workflowは未更新/);
});

test('upgrade: 展開済みworkflowのlocal customizationを保持して標準assetだけ更新する', (t) => {
  const targetDir = mkScratch('upgrade-gate-conflict');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  const relative = path.join('workflows', 'agent-skill-chain-ci.yml');
  const installedTemplate = path.join(targetDir, '.agent-skill-chain', 'templates', 'github', '.github', relative);
  const deployed = path.join(targetDir, '.github', relative);
  const conventions = path.join(targetDir, '.agent-skill-chain', 'standards', 'GIT_CONVENTIONS.md');
  const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
  fs.mkdirSync(path.dirname(deployed), { recursive: true });
  fs.writeFileSync(deployed, 'name: consumer ci\n');
  fs.appendFileSync(deployed, '\n# consumer customization\n');
  fs.appendFileSync(conventions, '\ncustom standard before failed upgrade\n');
  fs.writeFileSync(version, '0.0.1\n');
  const beforeDeployed = fs.readFileSync(deployed);

  const result = runCli(['upgrade', targetDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(fs.readFileSync(installedTemplate, 'utf8'), '');
  assert.deepEqual(fs.readFileSync(deployed), beforeDeployed);
  assert.doesNotMatch(fs.readFileSync(conventions, 'utf8'), /custom standard before failed upgrade/);
  assert.notEqual(fs.readFileSync(version, 'utf8'), '0.0.1\n');
});

// Issue #352: 再設計以前（Issue #157〜#188, PR #191）の旧世代アセットが残留した状態を模し、
// upgradeが検知・警告することを確認する（サイレント残留の禁止 = AGENTS.md I8）。

test('upgrade: 旧世代の.agent-skill-chain/source/が残留している場合は警告する', (t) => {
  const targetDir = mkScratch('upgrade-legacy-source');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  const legacySourceDir = path.join(targetDir, '.agent-skill-chain', 'source', 'boot');
  fs.mkdirSync(legacySourceDir, { recursive: true });
  fs.writeFileSync(path.join(legacySourceDir, 'CORE.md'), '# legacy core\n');

  const result = runCli(['upgrade', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /警告: 再設計以前の旧世代アセットが検知されました/);
  assert.match(result.stdout, /\.agent-skill-chain\/source\//);
  // 検知のみで削除はしない（非破壊）
  assert.equal(fs.existsSync(path.join(legacySourceDir, 'CORE.md')), true);
});

test('upgrade: 単体ファイルの旧.claude/hooks/PreToolUse.shが残留している場合は警告する', (t) => {
  const targetDir = mkScratch('upgrade-legacy-hook-file');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  const legacyHookDir = path.join(targetDir, '.claude', 'hooks');
  fs.mkdirSync(legacyHookDir, { recursive: true });
  fs.writeFileSync(path.join(legacyHookDir, 'PreToolUse.sh'), '#!/bin/sh\n# legacy hook\n');

  const result = runCli(['upgrade', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /警告: 再設計以前の旧世代アセットが検知されました/);
  assert.match(result.stdout, /\.claude\/hooks\/PreToolUse\.sh/);
  // 検知のみで削除はしない（非破壊）
  assert.equal(fs.existsSync(path.join(legacyHookDir, 'PreToolUse.sh')), true);
});

test('upgrade: .claude/settings.jsonに旧hookパスへの参照が残っている場合は警告する', (t) => {
  const targetDir = mkScratch('upgrade-legacy-settings-ref');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  const settingsDir = path.join(targetDir, '.claude');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(settingsDir, 'settings.json'),
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: '.claude/hooks/PreToolUse.sh' }] },
          ],
        },
      },
      null,
      2,
    ),
  );

  const result = runCli(['upgrade', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /警告: 再設計以前の旧世代アセットが検知されました/);
  assert.match(result.stdout, /settings\.json.*旧hookパスへの参照/);
});

test('upgrade: .claude/skills/配下の旧skill-chain方式への参照を警告する', (t) => {
  const targetDir = mkScratch('upgrade-legacy-skill-content');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  const skillFile = path.join(targetDir, '.claude', 'skills', 'agent', 'SKILL.md');
  const readmeFile = path.join(targetDir, '.claude', 'skills', 'requirements', 'README.md');
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.mkdirSync(path.dirname(readmeFile), { recursive: true });
  fs.writeFileSync(skillFile, '# legacy agent\n.agent-skill-chain/source/boot/CORE.mdを読み込む\n');
  fs.writeFileSync(readmeFile, '# legacy requirements\n00_要求定義.mdを生成する\n');
  const skillBefore = fs.readFileSync(skillFile);
  const readmeBefore = fs.readFileSync(readmeFile);

  const result = runCli(['upgrade', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /警告: 再設計以前の旧世代アセットが検知されました/);
  assert.match(result.stdout, /\.claude\/skills\/agent\/SKILL\.md/);
  assert.match(result.stdout, /\.claude\/skills\/requirements\/README\.md/);
  assert.match(result.stdout, /現行方式に沿った内容へ書き換えるか削除するか/);
  assert.deepEqual(fs.readFileSync(skillFile), skillBefore, '検知時にSKILL.mdを書き換えないこと');
  assert.deepEqual(fs.readFileSync(readmeFile), readmeBefore, '検知時にREADME.mdを書き換えないこと');
});

test('upgrade: 現行方式のenforce onで配線済みの場合は旧世代警告を出さない', (t) => {
  const targetDir = mkScratch('upgrade-current-enforce');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);
  assert.equal(runCli(['enforce', 'on', targetDir]).status, 0);

  const result = runCli(['upgrade', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /警告: 再設計以前の旧世代アセットが検知されました/);
});

test('upgrade後のsetup github再実行でも本体専用release workflowを新規配布しない', (t) => {
  const scratchDir = mkScratch('upgrade-release-exclusion-scratch');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);
  const githubEnv = stub.env({ ...process.env, ASC_GATE_APP_ID: '77' });

  const targetDir = mkScratch('upgrade-release-exclusion-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  assert.equal(runCli(['init', targetDir]).status, 0);
  const firstSetup = runCli(['setup', 'github', targetDir], { env: githubEnv });
  assert.equal(firstSetup.status, 0, firstSetup.stderr);
  const deployedRelease = path.join(targetDir, '.github', 'workflows', 'agent-skill-chain-release.yml');
  assert.equal(fs.existsSync(deployedRelease), false);

  const upgrade = runCli(['upgrade', targetDir]);
  assert.equal(upgrade.status, 0, upgrade.stderr);
  const secondSetup = runCli(['setup', 'github', targetDir], { env: githubEnv });
  assert.equal(secondSetup.status, 0, secondSetup.stderr);
  assert.equal(fs.existsSync(deployedRelease), false);
});
