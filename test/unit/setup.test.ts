import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideGithubBundle, validateLabelDescriptions, GITHUB_LABEL_DESCRIPTION_MAX_LENGTH } from '../../src/commands/setup.js';

// Issue #188 AC-1/AC-2: decideGithubBundle（純関数）が coordination.backend を正しく判定することを
// 単体テストで実測する。setup() 本体の資産コピー・githubBundle() 実行とは独立して検証できる
// （DESIGN.md「判定関数と副作用実行を分離」）。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

function writeConfig(targetDir: string, yamlText: string): void {
  const configDir = path.join(targetDir, '.agent-skill-chain', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'agent-skill-chain.yaml'), yamlText, 'utf8');
}

test('decideGithubBundle: coordination.backend が github なら run: true を返す（AC-2）', (t) => {
  const targetDir = mkScratch('decide-github');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  writeConfig(targetDir, 'coordination:\n  backend: github\n');

  const decision = decideGithubBundle(targetDir);
  assert.equal(decision.run, true);
  assert.equal(decision.message, '');
});

test('decideGithubBundle: coordination.backend が local なら run: false・スキップ理由を返す（AC-1）', (t) => {
  const targetDir = mkScratch('decide-local');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  writeConfig(targetDir, 'coordination:\n  backend: local\n');

  const decision = decideGithubBundle(targetDir);
  assert.equal(decision.run, false);
  assert.match(decision.message, /local/);
  assert.match(decision.message, /setup github/);
});

test('decideGithubBundle: config/agent-skill-chain.yaml が存在しない場合は安全側でrun: falseを返す（AC-1）', (t) => {
  const targetDir = mkScratch('decide-missing');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  // config を一切書かない（未導入状態）。

  const decision = decideGithubBundle(targetDir);
  assert.equal(decision.run, false);
  assert.match(decision.message, /見つかりません/);
});

test('decideGithubBundle: configがYAML構文として不正な場合も安全側でrun: falseを返す（AC-1）', (t) => {
  const targetDir = mkScratch('decide-broken');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  writeConfig(targetDir, 'coordination: [unbalanced\n');

  const decision = decideGithubBundle(targetDir);
  assert.equal(decision.run, false);
  assert.match(decision.message, /読込に失敗/);
});

test('decideGithubBundle: coordination.backend が未設定（フィールド自体が無い）場合もrun: falseを返す（AC-1）', (t) => {
  const targetDir = mkScratch('decide-nobackend');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  writeConfig(targetDir, 'schema_version: agent-skill-chain/config/v1\n');

  const decision = decideGithubBundle(targetDir);
  assert.equal(decision.run, false);
  assert.match(decision.message, /不明/);
});

// Issue #439: GitHub Labels API の description 上限（100文字）超過を、実際に `gh label create` を
// 呼ぶ前に検出できることを実測する。gh-stub は実APIのバリデーションを再現しないため、この単体
// テストが超過検出の唯一の実測箇所になる（DESIGN.md参照）。
test('validateLabelDescriptions: 全descriptionが上限以内なら undefined を返す', () => {
  const violation = validateLabelDescriptions([
    { name: 'type:bugfix', color: 'd73a4a', description: 'a'.repeat(GITHUB_LABEL_DESCRIPTION_MAX_LENGTH) },
  ]);
  assert.equal(violation, undefined);
});

test('validateLabelDescriptions: 上限を1文字でも超えるdescriptionがあれば、ラベル名と実文字数を含む日本語メッセージを返す', () => {
  const violation = validateLabelDescriptions([
    { name: 'size:quick', color: 'd4c5f9', description: 'a'.repeat(GITHUB_LABEL_DESCRIPTION_MAX_LENGTH + 1) },
  ]);
  assert.match(violation ?? '', /size:quick/);
  assert.match(violation ?? '', new RegExp(String(GITHUB_LABEL_DESCRIPTION_MAX_LENGTH + 1)));
  assert.match(violation ?? '', new RegExp(String(GITHUB_LABEL_DESCRIPTION_MAX_LENGTH)));
});

test('validateLabelDescriptions: 複数ラベルが超過している場合は全件を1つのメッセージへ含める', () => {
  const violation = validateLabelDescriptions([
    { name: 'a', color: '000000', description: 'x'.repeat(GITHUB_LABEL_DESCRIPTION_MAX_LENGTH + 5) },
    { name: 'b', color: '000000', description: 'y'.repeat(GITHUB_LABEL_DESCRIPTION_MAX_LENGTH + 10) },
  ]);
  assert.match(violation ?? '', /a/);
  assert.match(violation ?? '', /b/);
});
