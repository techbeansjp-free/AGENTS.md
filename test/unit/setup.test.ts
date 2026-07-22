import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideGithubBundle } from '../../src/commands/setup.js';

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
