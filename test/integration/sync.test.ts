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

// ISSUE-538 AC-2/AC-3/AC-5: sync templates --dry-run は実書込みを行わず変更予定一覧のみを表示する。

test('sync templates --dry-run: 実書込みを一切行わず、変更予定一覧を終了コード0で表示する', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const targetDir = mkScratch('sync-dry-run-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: 配布元と一部異なる既存の.github/CODEOWNERSを持つ導入済み状態
  const first = runCli(['sync', 'templates', targetDir], { cwd: repo.dir, env: process.env });
  assert.equal(first.status, 0, first.stderr);
  const codeownersPath = path.join(targetDir, '.github', 'CODEOWNERS');
  const originalContent = fs.readFileSync(codeownersPath, 'utf8');
  fs.writeFileSync(codeownersPath, '# 意図的に書き換えた別内容\n');
  const beforeMtime = fs.statSync(codeownersPath).mtimeMs;

  // When: --dry-run を付けて sync templates を実行する
  const result = runCli(['sync', 'templates', targetDir, '--dry-run'], { cwd: repo.dir, env: process.env });

  // Then: 終了コード0で、変更予定一覧が標準出力へ表示される
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /planned overwritten: /);
  // Then: 展開先のファイルシステムには一切書込みが行われない（内容・mtimeとも不変）
  assert.equal(fs.readFileSync(codeownersPath, 'utf8'), '# 意図的に書き換えた別内容\n', 'dry-runでは既存ファイルが上書きされないこと');
  assert.equal(fs.statSync(codeownersPath).mtimeMs, beforeMtime, 'dry-runではファイルへの書込みが発生しないこと');
  assert.notEqual(originalContent, '# 意図的に書き換えた別内容\n');
});

test('sync templates --help / -h: --dry-run フラグの説明が含まれる', (t) => {
  const help = runCli(['sync', 'templates', '--help'], { env: process.env });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--dry-run/);

  const h = runCli(['sync', 'templates', '-h'], { env: process.env });
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /--dry-run/);
});

// ISSUE-538 AC-4/AC-5/AC-6: 大文字小文字のみ異なる既存ファイルとの衝突検知。

test('sync templates: 大文字小文字のみ異なる既存ファイルがあると検知され、既存ファイルは無警告で上書きされない', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const targetDir = mkScratch('sync-case-collision-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: 配布元の展開先パス .github/pull_request_template.md と大文字小文字のみ異なる
  // 既存カスタムファイル .github/PULL_REQUEST_TEMPLATE.md を先置きする
  fs.mkdirSync(path.join(targetDir, '.github'), { recursive: true });
  const existingPath = path.join(targetDir, '.github', 'PULL_REQUEST_TEMPLATE.md');
  fs.writeFileSync(existingPath, '# consumerが独自にカスタマイズした内容\n');

  // When: --dry-run を付けずに sync templates を実行する
  const result = runCli(['sync', 'templates', targetDir], { cwd: repo.dir, env: process.env });

  // Then: 検知され、終了コード0以外・大文字小文字に言及したエラーが標準エラー出力に明示される
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /大文字小文字/);
  // Then: 既存ファイルは無警告のまま失われない
  assert.equal(fs.readFileSync(existingPath, 'utf8'), '# consumerが独自にカスタマイズした内容\n');
});

test('sync templates --dry-run: 大文字小文字衝突は実書込み無しに検知される', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const targetDir = mkScratch('sync-case-collision-dry-run-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(targetDir, '.github'), { recursive: true });
  const existingPath = path.join(targetDir, '.github', 'PULL_REQUEST_TEMPLATE.md');
  fs.writeFileSync(existingPath, '# consumerが独自にカスタマイズした内容\n');

  const result = runCli(['sync', 'templates', targetDir, '--dry-run'], { cwd: repo.dir, env: process.env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /大文字小文字/);
  assert.equal(fs.readFileSync(existingPath, 'utf8'), '# consumerが独自にカスタマイズした内容\n');
  assert.equal(
    fs.existsSync(path.join(targetDir, '.github', 'pull_request_template.md')) &&
      fs.readFileSync(path.join(targetDir, '.github', 'pull_request_template.md'), 'utf8') !==
        '# consumerが独自にカスタマイズした内容\n',
    false,
    'dry-runでは配布元パスへも一切書込みが発生しないこと',
  );
});

test('sync templates: 大文字小文字含め完全一致する既存ファイルへの既存動作（無条件上書き）は変更しない', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const targetDir = mkScratch('sync-exact-match-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: 配布元と大文字小文字含め完全一致するパスに、異なる内容の既存ファイルを先置きする
  fs.mkdirSync(path.join(targetDir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, '.github', 'pull_request_template.md'), '# 別内容（完全一致パス）\n');

  const result = runCli(['sync', 'templates', targetDir], { cwd: repo.dir, env: process.env });

  // Then: 従来どおり配布元の内容で上書きされ、大文字小文字衝突検知は発火しない（回帰無し）
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`overwritten: ${escapeRegExp(path.join(targetDir, '.github', 'pull_request_template.md'))}`));
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
