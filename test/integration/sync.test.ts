import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// sync templates を bin/agents-md.js 経由で subprocess 実行し、.github/ ミラーコピーの
// 作成・上書き挙動を検証する。gh を一切呼ばないコマンドであることも確認する。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('sync templates: 空のtarget_dirへ実行するとファイルが作成される（gh不要）', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const targetDir = mkScratch('sync-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: 素の空ディレクトリ（gitリポジトリではない）を同期先とする
  // When: gh-stubを一切注入せず（PATHにgh-stub bin dirを加えず）sync templatesを実行する
  const result = runCli(['sync', 'templates', targetDir], { cwd: repo.dir, env: process.env });

  // Then: ghを一切呼ばないため、gh-stub無しでも成功する
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(targetDir, '.github', 'CODEOWNERS')), '.github/CODEOWNERS が作成されること');
  assert.ok(
    fs.existsSync(path.join(targetDir, '.github', 'workflows', 'agent-skill-chain-ci.yml')),
    '.github/workflows 配下も作成されること',
  );
  assert.ok(
    fs.existsSync(path.join(targetDir, '.claude', 'agents', 'agent-skill-chain-worker.md')),
    'Claude custom subagent種別も同期されること',
  );
  assert.match(result.stdout, /^created: /m);
});

test('sync templates: 既に一部異なる内容で存在するファイルは上書き（overwritten）される', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const targetDir = mkScratch('sync-overwrite-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: 1回目の同期で.githubを実体化しておく
  const first = runCli(['sync', 'templates', targetDir], { cwd: repo.dir, env: process.env });
  assert.equal(first.status, 0, first.stderr);

  const codeownersPath = path.join(targetDir, '.github', 'CODEOWNERS');
  const originalContent = fs.readFileSync(codeownersPath, 'utf8');

  // Given: 同期済みファイルの内容を意図的に書き換える
  fs.writeFileSync(codeownersPath, '# 意図的に書き換えた別内容\n');

  // When: 同じtarget_dirへ再度sync templatesを実行する
  const second = runCli(['sync', 'templates', targetDir], { cwd: repo.dir, env: process.env });

  // Then: 成功し、変更していたファイルは配布元の内容へ上書き（overwritten）される
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, new RegExp(`overwritten: ${escapeRegExp(codeownersPath)}`));
  assert.equal(fs.readFileSync(codeownersPath, 'utf8'), originalContent, '書き換えた内容は配布元の内容へ戻ること');
});

test('sync templates: cwdが非gitディレクトリでもtarget_dirを明示指定すれば成功する', (t) => {
  const nonGitCwd = mkScratch('sync-non-git-cwd');
  t.after(() => fs.rmSync(nonGitCwd, { recursive: true, force: true }));
  const targetDir = mkScratch('sync-non-git-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: cwd・target_dirともにgitリポジトリではない素のディレクトリ
  // When: sync templates <target_dir> を、非gitディレクトリをcwdにして実行する
  const result = runCli(['sync', 'templates', targetDir], { cwd: nonGitCwd, env: process.env });

  // Then: resolveAsset は target_dir を root として解決し（.git不要）、
  // target_dir/.agent-skill-chain に見つからなければ配布元（packageRoot）へフォールバックするため成功する
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(targetDir, '.github', 'CODEOWNERS')));
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
