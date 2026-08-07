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

test('init: 標準資産・Claude worker agentを実体化し、GitHub Actionsは展開しない', (t) => {
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
  assert.equal(fs.existsSync(path.join(targetDir, '.github')), false);
  const workerAgent = path.join(targetDir, '.claude', 'agents', 'agent-skill-chain-worker.md');
  assert.ok(fs.existsSync(workerAgent), 'Claude custom subagent種別をinit時に展開すること');
  const workerAgentText = fs.readFileSync(workerAgent, 'utf8');
  assert.match(workerAgentText, /tools: Read, Grep, Glob, Edit, Write, MultiEdit, Bash/);
  assert.doesNotMatch(workerAgentText, /tools:.*\bAgent\b/, '再帰dispatch可能なAgent toolを許可しないこと');
  assert.match(result.stdout, /GitHub workflowは未展開/);

  const installedVersion = fs.readFileSync(
    path.join(targetDir, '.agent-skill-chain', '.installed_version'),
    'utf8',
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string };
  assert.equal(installedVersion.trim(), pkg.version);
});

test('init: 導入されたAGENTS.mdに実際のupgrade起動コマンド構文が記載されている（Issue #298）', (t) => {
  const targetDir = mkScratch('init-upgrade-doc-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  const agentsMd = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8');
  assert.match(
    agentsMd,
    /npx github:techbeansjp-free\/AGENTS\.md upgrade/,
    'consumerが導入後に自リポジトリ内だけでアップグレード起動コマンドを再発見できること',
  );
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

test('init: 所有権記録(.owned-files.json)が新規作成され、書き込んだファイル一覧を復元できる（Issue #492 AC-1）', (t) => {
  const targetDir = mkScratch('init-ownership-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  const recordPath = path.join(targetDir, '.agent-skill-chain', '.owned-files.json');
  assert.ok(fs.existsSync(recordPath));
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as {
    version: string;
    files: Record<string, string>;
  };
  assert.ok(Object.prototype.hasOwnProperty.call(record.files, 'AGENTS.md'));
  assert.ok(
    Object.prototype.hasOwnProperty.call(record.files, '.agent-skill-chain/config/agent-skill-chain.yaml'),
  );
  assert.match(record.files['AGENTS.md'] ?? '', /^sha256:[0-9a-f]{64}$/);
});

test('init --dry-run: 所有権記録は作成されない', (t) => {
  const targetDir = mkScratch('init-ownership-dry-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir, '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(targetDir, '.agent-skill-chain', '.owned-files.json')), false);
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

test('init: 既存所有権記録にretainedとして残っていたエントリは、再実行後も消失しない（手動implementation-gateレビュー指摘: init-rerun-drops-prior-ownership-entries）', (t) => {
  const targetDir = mkScratch('init-retains-prior-ownership');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  // upgradeが「配布元で廃止されたが導入先で変更が検出された」等の理由でretained保持していた
  // 状況を模す: 現行配布元には存在しないファイルのエントリを所有権記録へ直接追加する。
  const recordPath = path.join(targetDir, '.agent-skill-chain', '.owned-files.json');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { version: string; files: Record<string, string> };
  const retainedKey = '.agent-skill-chain/standards/RETIRED_STANDARD_STILL_EDITED_BY_USER.md';
  record.files[retainedKey] = `sha256:${'0'.repeat(64)}`;
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));

  const second = runCli(['init', targetDir]);
  assert.equal(second.status, 0, second.stderr);

  const afterRecord = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { files: Record<string, string> };
  assert.equal(
    Object.prototype.hasOwnProperty.call(afterRecord.files, retainedKey),
    true,
    '過去にretainedとして保持されていたエントリが2回目のinit実行で失われないこと',
  );
});
