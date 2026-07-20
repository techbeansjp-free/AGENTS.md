import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runCli } from '../helpers/cli.js';

// Issue #169 T4: uninstall コマンドの結合テスト。安全確認（未commit差分・残存worktree）・
// project/保持・--force不在（提供しない設計）を検証する。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function initGitRepoWithInit(prefix: string): string {
  const targetDir = mkScratch(prefix);
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);
  git(targetDir, ['init', '-q', '--initial-branch=main']);
  git(targetDir, ['config', 'user.email', 'test@example.com']);
  git(targetDir, ['config', 'user.name', 'agent-skill-chain test']);
  return targetDir;
}

test('uninstall: gitリポジトリでないディレクトリに対してはエラー終了する（削除しない）', (t) => {
  const targetDir = mkScratch('uninstall-not-git');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);

  const result = runCli(['uninstall', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /gitリポジトリではありません/);
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')), '削除が実行されないこと');
});

test('uninstall: 未commitの変更がある場合は安全側で停止し、削除されない', (t) => {
  const targetDir = initGitRepoWithInit('uninstall-dirty');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  // Given: commitしていない（addすらしていない）状態
  const result = runCli(['uninstall', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /未commitの変更が/);
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')), '削除が実行されないこと');
});

test('uninstall: 残存worktreeがある場合は安全側で停止し、削除されない', (t) => {
  const targetDir = initGitRepoWithInit('uninstall-worktree');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  git(targetDir, ['add', '-A']);
  git(targetDir, ['commit', '-q', '-m', 'chore: init']);

  fs.mkdirSync(path.join(targetDir, '.worktrees'), { recursive: true });
  git(targetDir, ['worktree', 'add', '-q', path.join(targetDir, '.worktrees', 'foo'), '-b', 'feature/1-foo']);
  t.after(() => {
    try {
      git(targetDir, ['worktree', 'remove', '--force', path.join(targetDir, '.worktrees', 'foo')]);
    } catch {
      // best-effort cleanup
    }
  });

  const result = runCli(['uninstall', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /残存worktree/);
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')), '削除が実行されないこと');
});

test('uninstall: 安全確認を通過した場合、project/を除く導入資産が削除され、project/は保持される', (t) => {
  const targetDir = initGitRepoWithInit('uninstall-success');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const projectDir = path.join(targetDir, '.agent-skill-chain', 'project');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'RULES.md'), 'カスタムルール\n');

  git(targetDir, ['add', '-A']);
  git(targetDir, ['commit', '-q', '-m', 'chore: init + project policy']);

  const dryRun = runCli(['uninstall', targetDir, '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /planned removed:/);
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'dry-runでは削除されないこと');

  const result = runCli(['uninstall', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /project\/ は保持されます/);
  assert.equal(fs.existsSync(path.join(targetDir, 'AGENTS.md')), false, 'AGENTS.mdが削除されること');
  assert.equal(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'standards')),
    false,
    'standards/が削除されること',
  );
  assert.ok(fs.existsSync(path.join(projectDir, 'RULES.md')), 'project/RULES.mdは削除されず残ること');
});

test('uninstall: 実行後は.installed_versionも削除され、doctorが「未導入」と正しく表示する', (t) => {
  const targetDir = initGitRepoWithInit('uninstall-version-marker');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  git(targetDir, ['add', '-A']);
  git(targetDir, ['commit', '-q', '-m', 'chore: init']);

  assert.ok(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain', '.installed_version')),
    '前提: init直後は.installed_versionが存在すること',
  );

  const result = runCli(['uninstall', targetDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain', '.installed_version')),
    false,
    'uninstall後は.installed_versionも削除されること',
  );

  const doctorResult = runCli(['doctor'], { cwd: targetDir });
  assert.match(
    doctorResult.stdout,
    /情報 {2}init 導入済み: NG（未導入）/,
    'uninstall後にdoctorを実行すると「未導入」と表示されること（削除漏れがあるとOKと誤表示され続けていた）',
  );
});

test('uninstall: --force オプションは提供されない（未知フラグとして使い方表示・成功しない）', (t) => {
  const targetDir = initGitRepoWithInit('uninstall-noforce');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  // 未commitのまま --force 相当を試みても、安全確認を迂回する経路は存在しない
  // （--force はフラグとして特別扱いされず、position引数解釈に混入するのみ）。
  const result = runCli(['uninstall', targetDir, '--force']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /未commitの変更が/, '--forceは安全確認を迂回しないこと');
});
