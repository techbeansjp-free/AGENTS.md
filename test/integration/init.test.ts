import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../helpers/cli.js';

// Issue #169 T2: init コマンドの結合テスト（bin/agents-md.js 経由でsubprocess実行）。
// GitHub API（labels/ruleset）には触れないため、gh-stubは不要。

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('init --dry-run: 実ファイルは一切作成されず、作成予定一覧のみが標準出力に表示される', (t) => {
  const targetDir = path.join(mkScratch('init-dry-parent'), 'target');
  t.after(() => fs.rmSync(path.dirname(targetDir), { recursive: true, force: true }));

  const result = runCli(['init', targetDir, '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /planned created:/);
  assert.equal(fs.existsSync(targetDir), false, 'target_dir自体が作成されないこと');
});

test('init: 標準資産・.agent-skill-chain名前空間（hooks含む）・.githubが実体化し、.installed_versionが記録される', (t) => {
  const targetDir = mkScratch('init-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'docs', 'GLOSSARY.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml')));
  assert.ok(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'hooks', 'claude-pretooluse.sh')),
    'hooks/ 名前空間もinitで導入されること',
  );
  assert.ok(fs.existsSync(path.join(targetDir, '.github', 'CODEOWNERS')));

  const installedVersion = fs.readFileSync(
    path.join(targetDir, '.agent-skill-chain', '.installed_version'),
    'utf8',
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string };
  assert.equal(installedVersion.trim(), pkg.version);
});

test('init: 既存docs資産と衝突する場合は非破壊で停止し、終了コードが0以外になる', (t) => {
  const targetDir = mkScratch('init-conflict-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(targetDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'docs', 'GLOSSARY.md'), '# 別内容のGLOSSARY.md（衝突させるため）\n');

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /導入先に既存の異なる内容のファイルがあるため展開を中断しました/);
});

test('init: 既存docs資産と衝突する場合、衝突より前に処理される他のファイルも一切書き込まれない（部分適用しない）', (t) => {
  const targetDir = mkScratch('init-conflict-no-partial-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(targetDir, 'docs'), { recursive: true });
  const originalGlossary = '# 別内容のGLOSSARY.md（衝突させるため）\n';
  fs.writeFileSync(path.join(targetDir, 'docs', 'GLOSSARY.md'), originalGlossary);

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /導入先に既存の異なる内容のファイルがあるため展開を中断しました/);
  assert.equal(
    fs.existsSync(path.join(targetDir, 'AGENTS.md')),
    false,
    'AGENTS.mdも作成されないこと（ROOT_LEVEL_ENTRIESの中でGLOSSARY.mdより先に処理されるため、対策前は書き込まれてしまっていた）',
  );
  assert.equal(fs.existsSync(path.join(targetDir, 'CLAUDE.md')), false, 'CLAUDE.mdも作成されないこと');
  assert.equal(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain')),
    false,
    '.agent-skill-chain名前空間も一切作成されないこと',
  );
  assert.equal(fs.existsSync(path.join(targetDir, '.github')), false, '.githubも作成されないこと');
  assert.equal(
    fs.readFileSync(path.join(targetDir, 'docs', 'GLOSSARY.md'), 'utf8'),
    originalGlossary,
    '衝突した既存ファイル自体の内容も変更されないこと',
  );
});

test('init: 同一target_dirへの2回目の実行は冪等に成功する（unchanged）', (t) => {
  const targetDir = mkScratch('init-idempotent-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const first = runCli(['init', targetDir]);
  assert.equal(first.status, 0, first.stderr);

  const second = runCli(['init', targetDir]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /unchanged: /);
});
