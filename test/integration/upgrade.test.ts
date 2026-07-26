import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

for (const workflow of [
  'agent-skill-chain-reconcile.yml',
  'agent-skill-chain-trusted-gate.yml',
  'agent-skill-chain-release.yml',
]) {
  test(`upgrade: ${workflow}のlocal customizationも全体を無変更で停止する`, (t) => {
    const targetDir = mkScratch('upgrade-managed-conflict');
    t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
    assert.equal(runCli(['init', targetDir]).status, 0);
    const deployed = path.join(targetDir, '.github', 'workflows', workflow);
    const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
    fs.appendFileSync(deployed, '\n# consumer customization\n');
    fs.writeFileSync(version, '0.0.1\n');
    const before = fs.readFileSync(deployed);

    const result = runCli(['upgrade', targetDir]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /local customization競合/);
    assert.deepEqual(fs.readFileSync(deployed), before);
    assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
  });
}

test('upgrade: new managed filenameの既存custom collisionをcopy前に全体停止する', (t) => {
  const targetDir = mkScratch('upgrade-new-managed-collision');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);
  const relative = path.join('workflows', 'agent-skill-chain-trusted-gate.yml');
  const installed = path.join(targetDir, '.agent-skill-chain', 'templates', 'github', '.github', relative);
  const deployed = path.join(targetDir, '.github', relative);
  fs.rmSync(installed);
  fs.writeFileSync(deployed, 'name: consumer-owned collision\n');
  const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
  fs.writeFileSync(version, '0.0.1\n');

  const result = runCli(['upgrade', targetDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new managed filename.*既存custom assetと衝突/);
  assert.equal(fs.readFileSync(deployed, 'utf8'), 'name: consumer-owned collision\n');
  assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
});

test('upgrade: old managed fileの展開物欠落は全体停止し、unmanaged extraは保持する', (t) => {
  const targetDir = mkScratch('upgrade-managed-missing');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);
  const missing = path.join(targetDir, '.github', 'workflows', 'agent-skill-chain-release.yml');
  const unmanaged = path.join(targetDir, '.github', 'workflows', 'consumer-extra.yml');
  fs.rmSync(missing);
  fs.writeFileSync(unmanaged, 'name: consumer extra\n');

  const result = runCli(['upgrade', targetDir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /展開物が欠落/);
  assert.equal(fs.readFileSync(unmanaged, 'utf8'), 'name: consumer extra\n');
});

test('upgrade: managed集合外のextraは成功時も保持する', (t) => {
  const targetDir = mkScratch('upgrade-unmanaged-extra');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);
  const unmanaged = path.join(targetDir, '.github', 'workflows', 'consumer-extra.yml');
  fs.writeFileSync(unmanaged, 'name: consumer extra\n');

  const result = runCli(['upgrade', targetDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(unmanaged, 'utf8'), 'name: consumer extra\n');
});

for (const linkCase of [
  { label: 'absolute symlink（同内容）', relative: false, content: 'same' },
  { label: 'absolute symlink（異内容）', relative: false, content: 'different' },
  { label: 'absolute symlink（壊れ）', relative: false, content: 'broken' },
  { label: 'relative symlink（同内容）', relative: true, content: 'same' },
  { label: 'relative symlink（異内容）', relative: true, content: 'different' },
  { label: 'relative symlink（壊れ）', relative: true, content: 'broken' },
] as const) {
  test(`upgrade: managed deployed ${linkCase.label}を追従せず全体を無変更で拒否する`, (t) => {
    const targetDir = mkScratch('upgrade-managed-symlink');
    const outsideDir = mkScratch('upgrade-managed-symlink-outside');
    t.after(() => {
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });
    assert.equal(runCli(['init', targetDir]).status, 0);

    const deployed = path.join(targetDir, '.github', 'workflows', 'agent-skill-chain-release.yml');
    const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
    const conventions = path.join(targetDir, '.agent-skill-chain', 'standards', 'GIT_CONVENTIONS.md');
    const installedContent = fs.readFileSync(deployed);
    const outside = path.join(outsideDir, 'linked.yml');
    if (linkCase.content !== 'broken') {
      fs.writeFileSync(outside, linkCase.content === 'same' ? installedContent : 'different external content\n');
    }
    fs.rmSync(deployed);
    const linkTarget = linkCase.relative ? path.relative(path.dirname(deployed), outside) : outside;
    fs.symlinkSync(linkTarget, deployed);
    fs.writeFileSync(version, '0.0.1\n');
    fs.appendFileSync(conventions, '\nunchanged sentinel\n');
    const beforeConventions = fs.readFileSync(conventions);
    const beforeOutside = linkCase.content === 'broken' ? undefined : fs.readFileSync(outside);

    const result = runCli(['upgrade', targetDir]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink/);
    assert.ok(fs.lstatSync(deployed).isSymbolicLink());
    assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
    assert.deepEqual(fs.readFileSync(conventions), beforeConventions);
    if (beforeOutside) assert.deepEqual(fs.readFileSync(outside), beforeOutside);
    else assert.equal(fs.existsSync(outside), false);
  });
}

test('upgrade: managed deployed FIFOをopenせず全体を無変更で拒否する', (t) => {
  const targetDir = mkScratch('upgrade-managed-fifo');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);
  const deployed = path.join(targetDir, '.github', 'workflows', 'agent-skill-chain-release.yml');
  const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
  const conventions = path.join(targetDir, '.agent-skill-chain', 'standards', 'GIT_CONVENTIONS.md');
  fs.rmSync(deployed);
  execFileSync('mkfifo', [deployed]);
  fs.writeFileSync(version, '0.0.1\n');
  const beforeConventions = fs.readFileSync(conventions);

  const result = runCli(['upgrade', targetDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /special file/);
  assert.ok(fs.lstatSync(deployed).isFIFO());
  assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
  assert.deepEqual(fs.readFileSync(conventions), beforeConventions);
});

test('upgrade: managed deployed fileのdirectory置換を全体を無変更で拒否する', (t) => {
  const targetDir = mkScratch('upgrade-managed-directory');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);
  const deployed = path.join(targetDir, '.github', 'workflows', 'agent-skill-chain-release.yml');
  const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
  const conventions = path.join(targetDir, '.agent-skill-chain', 'standards', 'GIT_CONVENTIONS.md');
  fs.rmSync(deployed);
  fs.mkdirSync(deployed);
  fs.writeFileSync(version, '0.0.1\n');
  const beforeConventions = fs.readFileSync(conventions);

  const result = runCli(['upgrade', targetDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /directory/);
  assert.ok(fs.lstatSync(deployed).isDirectory());
  assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
  assert.deepEqual(fs.readFileSync(conventions), beforeConventions);
});

test('upgrade: managed deployed parent symlinkを追従せず外部directoryを変更しない', (t) => {
  const targetDir = mkScratch('upgrade-managed-parent-symlink');
  const outsideDir = mkScratch('upgrade-managed-parent-symlink-outside');
  t.after(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
  assert.equal(runCli(['init', targetDir]).status, 0);
  const workflows = path.join(targetDir, '.github', 'workflows');
  const outsideWorkflows = path.join(outsideDir, 'workflows');
  fs.cpSync(workflows, outsideWorkflows, { recursive: true });
  fs.rmSync(workflows, { recursive: true });
  fs.symlinkSync(outsideWorkflows, workflows);
  const outsideRelease = path.join(outsideWorkflows, 'agent-skill-chain-release.yml');
  const beforeOutside = fs.readFileSync(outsideRelease);
  const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
  fs.writeFileSync(version, '0.0.1\n');

  const result = runCli(['upgrade', targetDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /親.*symlink/);
  assert.ok(fs.lstatSync(workflows).isSymbolicLink());
  assert.deepEqual(fs.readFileSync(outsideRelease), beforeOutside);
  assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
});

test('upgrade: namespaced destination parent symlinkを全copy前に拒否し外部directoryを変更しない', (t) => {
  const targetDir = mkScratch('upgrade-namespaced-parent-symlink');
  const outsideDir = mkScratch('upgrade-namespaced-parent-symlink-outside');
  t.after(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
  assert.equal(runCli(['init', targetDir]).status, 0);
  const standards = path.join(targetDir, '.agent-skill-chain', 'standards');
  const outsideStandards = path.join(outsideDir, 'standards');
  fs.cpSync(standards, outsideStandards, { recursive: true });
  fs.rmSync(standards, { recursive: true });
  fs.symlinkSync(outsideStandards, standards);
  const outsideConventions = path.join(outsideStandards, 'GIT_CONVENTIONS.md');
  fs.appendFileSync(outsideConventions, '\nexternal sentinel\n');
  const beforeOutside = fs.readFileSync(outsideConventions);
  const version = path.join(targetDir, '.agent-skill-chain', '.installed_version');
  const rootAgents = path.join(targetDir, 'AGENTS.md');
  fs.appendFileSync(rootAgents, '\nroot sentinel before later hazard\n');
  const beforeRootAgents = fs.readFileSync(rootAgents);
  fs.writeFileSync(version, '0.0.1\n');

  const result = runCli(['upgrade', targetDir]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mirror先.*symlink/);
  assert.ok(fs.lstatSync(standards).isSymbolicLink());
  assert.deepEqual(fs.readFileSync(outsideConventions), beforeOutside);
  assert.deepEqual(fs.readFileSync(rootAgents), beforeRootAgents, '後段hazardより前のroot assetも変更されないこと');
  assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
});

for (const directoryName of ['.agent-skill-chain', '.github'] as const) {
  test(`upgrade: ${directoryName} directory symlinkを追従せず全体を無変更で拒否する`, (t) => {
    const targetDir = mkScratch('upgrade-root-directory-symlink');
    const outsideDir = mkScratch('upgrade-root-directory-symlink-outside');
    t.after(() => {
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });
    assert.equal(runCli(['init', targetDir]).status, 0);
    const entry = path.join(targetDir, directoryName);
    const outsideEntry = path.join(outsideDir, directoryName);
    fs.cpSync(entry, outsideEntry, { recursive: true });
    fs.rmSync(entry, { recursive: true });
    fs.symlinkSync(outsideEntry, entry);
    const outsideSentinel = path.join(outsideEntry, 'external-sentinel.txt');
    fs.writeFileSync(outsideSentinel, 'outside unchanged\n');
    const rootAgents = path.join(targetDir, 'AGENTS.md');
    fs.appendFileSync(rootAgents, '\nroot unchanged sentinel\n');
    const beforeRootAgents = fs.readFileSync(rootAgents);

    const result = runCli(['upgrade', targetDir]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink/);
    assert.ok(fs.lstatSync(entry).isSymbolicLink());
    assert.equal(fs.readFileSync(outsideSentinel, 'utf8'), 'outside unchanged\n');
    assert.deepEqual(fs.readFileSync(rootAgents), beforeRootAgents);
  });
}

test('upgrade: target root自身がsymlinkなら外部targetを更新しない', (t) => {
  const realParent = mkScratch('upgrade-target-parent-real');
  const aliasParent = mkScratch('upgrade-target-parent-alias');
  t.after(() => {
    fs.rmSync(realParent, { recursive: true, force: true });
    fs.rmSync(aliasParent, { recursive: true, force: true });
  });
  const realTarget = path.join(realParent, 'target');
  assert.equal(runCli(['init', realTarget]).status, 0);
  const aliasedTarget = path.join(aliasParent, 'linked-target');
  fs.symlinkSync(realTarget, aliasedTarget);
  const rootAgents = path.join(realTarget, 'AGENTS.md');
  fs.appendFileSync(rootAgents, '\nparent symlink sentinel\n');
  const beforeRootAgents = fs.readFileSync(rootAgents);
  const version = path.join(realTarget, '.agent-skill-chain', '.installed_version');
  fs.writeFileSync(version, '0.0.1\n');

  const result = runCli(['upgrade', aliasedTarget]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink/);
  assert.deepEqual(fs.readFileSync(rootAgents), beforeRootAgents);
  assert.equal(fs.readFileSync(version, 'utf8'), '0.0.1\n');
});
