import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGhStub } from '../helpers/gh-stub.js';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// setup / setup github / setup labels / setup ruleset を bin/agents-md.js 経由で subprocess 実行し、
// 実際にファイルが実体化すること・gh呼び出しがgh-stub経由で記録されることを検証する。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('setup: 空のtarget_dirへの初回導入が成功し、標準資産・.agent-skill-chain名前空間・.githubが実体化する', (t) => {
  const scratchDir = mkScratch('setup-scratch');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);

  const targetDir = mkScratch('setup-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: 空のtarget_dir と gh-stub を用意する
  // When: setup を実行する
  const result = runCli(['setup', targetDir], { env: stub.env(process.env) });

  // Then: 成功し、root直下資産・.agent-skill-chain名前空間配下・.githubテンプレートが作成される
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'AGENTS.md が作成されること');
  assert.ok(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml')),
    '.agent-skill-chain/config/agent-skill-chain.yaml が作成されること',
  );
  assert.ok(fs.existsSync(path.join(targetDir, '.github', 'CODEOWNERS')), '.github/CODEOWNERS が同期されること');
  assert.ok(
    fs.existsSync(path.join(targetDir, '.github', 'workflows', 'agent-skill-chain-ci.yml')),
    '.github/workflows 配下も同期されること',
  );

  // Then: gh-stubの状態にラベルが記録されている（setup labels 段が実行された証跡）
  // 期待件数は、コピーされたlabels.yaml自体から動的に算出する（定義数の変更に追随するため）。
  const copiedLabelsYamlText = fs.readFileSync(
    path.join(targetDir, '.agent-skill-chain', 'templates', 'github', 'provisioning', 'labels.yaml'),
    'utf8',
  );
  const expectedLabelCount = [...copiedLabelsYamlText.matchAll(/name:\s*"([^"]+)"/g)].length;
  assert.ok(expectedLabelCount > 0, 'テスト前提: labels.yamlからラベル名を抽出できること');
  const state = stub.readState();
  assert.ok(state.labels.includes('type:feature'), 'labels.yaml定義のラベルがgh-stub経由で登録されていること');
  assert.equal(
    state.labels.length,
    expectedLabelCount,
    `labels.yaml定義の全件数分が登録されていること（期待: ${expectedLabelCount}, 実際: ${state.labels.length}）`,
  );

  // Then: gh-stubの状態にrulesetも記録されている（setup ruleset段が実行された証跡）
  assert.equal(state.rulesets.length, 1);
  assert.equal((state.rulesets[0] as { name: string }).name, 'main-protection');
});

test('setup: 同じtarget_dirへの2回目の実行は冪等に成功する（unchanged）', (t) => {
  const scratchDir = mkScratch('setup-scratch');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);

  const targetDir = mkScratch('setup-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: 1回目のsetupを実行し、資産を実体化しておく
  const first = runCli(['setup', targetDir], { env: stub.env(process.env) });
  assert.equal(first.status, 0, first.stderr);

  // When: 全く同じtarget_dirへ2回目のsetupを実行する
  const second = runCli(['setup', targetDir], { env: stub.env(process.env) });

  // Then: 内容が同一なため衝突とみなされず、冪等に成功する
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, new RegExp(`unchanged: ${escapeRegExp(path.join(targetDir, 'AGENTS.md'))}`));
  assert.match(
    second.stdout,
    new RegExp(`unchanged: ${escapeRegExp(path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml'))}`),
  );
});

test('setup: target_dirに既存の異なる内容のAGENTS.mdがあると導入を中断しCliErrorを返す', (t) => {
  const targetDir = mkScratch('setup-conflict-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: target_dirに意図的に別内容のAGENTS.mdを先置きする
  fs.writeFileSync(path.join(targetDir, 'AGENTS.md'), '# 別内容のAGENTS.md（衝突させるため）\n');

  // When: setup を実行する（gh呼び出しに到達する前に、資産コピー段で衝突検知され中断するはず）
  const result = runCli(['setup', targetDir], { env: process.env });

  // Then: 終了コード1・CliError由来のエラーメッセージが標準エラーに出る
  assert.equal(result.status, 1);
  assert.match(result.stderr, /導入先に既存の異なる内容のファイルがあるため展開を中断しました/);
  assert.match(result.stderr, new RegExp(escapeRegExp(path.join(targetDir, 'AGENTS.md'))));
});

test('setup github: target_dirへ.github同期のみを行い、AGENTS.md等の標準資産はコピーしない', (t) => {
  const scratchDir = mkScratch('setup-github-scratch');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);

  const targetDir = mkScratch('setup-github-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // When: setup github をtarget_dir指定で単体実行する
  const result = runCli(['setup', 'github', targetDir], { env: stub.env(process.env) });

  // Then: 成功し、.github配下が同期される
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(targetDir, '.github', 'CODEOWNERS')));

  // Then: setup本体が担うroot直下資産・.agent-skill-chain名前空間はコピーされない
  assert.ok(!fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'setup githubはAGENTS.mdをコピーしないこと');
  assert.ok(!fs.existsSync(path.join(targetDir, '.agent-skill-chain')), 'setup githubは.agent-skill-chain名前空間をコピーしないこと');
});

test('setup labels: cwdのリポジトリに対しlabels.yaml定義の全ラベルが適用される', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const scratchDir = mkScratch('setup-labels-scratch');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);

  const labelsYamlPath = path.join(repo.dir, '.agent-skill-chain', 'templates', 'github', 'provisioning', 'labels.yaml');
  const yamlText = fs.readFileSync(labelsYamlPath, 'utf8');
  const expectedNames = [...yamlText.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(expectedNames.length > 0, 'labels.yamlからラベル名を抽出できること（テスト前提の健全性チェック）');

  // When: cwdをリポジトリ内にしてsetup labelsを単体実行する（owner/repo省略）
  const result = runCli(['setup', 'labels'], { cwd: repo.dir, env: stub.env(process.env) });

  // Then: 成功し、labels.yaml定義の全ラベル名が標準出力に含まれる
  assert.equal(result.status, 0, result.stderr);
  for (const name of expectedNames) {
    assert.match(result.stdout, new RegExp(escapeRegExp(name)), `出力にラベル ${name} が含まれること`);
  }

  // Then: gh-stubの状態にも全ラベル名が記録されている
  const state = stub.readState();
  for (const name of expectedNames) {
    assert.ok(state.labels.includes(name), `gh-stub状態にラベル ${name} が記録されていること`);
  }
});

test('setup ruleset: 初回はruleset新規作成(POST)、2回目は既存ruleset検出後に更新(PUT)する', (t) => {
  const repo = createTmpRepo();
  t.after(() => repo.cleanup());
  const scratchDir = mkScratch('setup-ruleset-scratch');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);

  // When: 1回目のsetup rulesetを実行する（owner/repo省略、cwdはリポジトリ内）
  const first = runCli(['setup', 'ruleset'], { cwd: repo.dir, env: stub.env(process.env) });

  // Then: 成功し、gh-stub状態にruleset「main-protection」が1件新規作成される
  assert.equal(first.status, 0, first.stderr);
  let state = stub.readState();
  assert.equal(state.rulesets.length, 1, '初回は新規rulesetが1件作成されること');
  assert.equal((state.rulesets[0] as { name: string; id: number }).name, 'main-protection');
  const firstId = (state.rulesets[0] as { id: number }).id;

  // When: 2回目のsetup rulesetを実行する
  const second = runCli(['setup', 'ruleset'], { cwd: repo.dir, env: stub.env(process.env) });

  // Then: 既存rulesetが検出され、新規追加ではなく同一IDのまま更新される
  assert.equal(second.status, 0, second.stderr);
  state = stub.readState();
  assert.equal(state.rulesets.length, 1, '2回目は新規追加でなく既存1件が更新されること');
  assert.equal((state.rulesets[0] as { id: number }).id, firstId, '更新されたrulesetのIDが1回目と同一であること');
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
