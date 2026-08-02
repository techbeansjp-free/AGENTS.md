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
//
// Issue #188 AC-1（local backend時はGitHub固有処理をスキップ）について: 資産コピー段
// （copyTreeFailOnConflict）は既存内容と異なる内容のconfigが対象targetDirに事前存在すると
// 非破壊のため必ずCliErrorで中断する仕様であり、これは本Issueのスコープ外の既存挙動である。
// このため「backend: localを持つ既存configへ向けてbare setupを再実行する」という完全なCLI
// subprocess経路でのAC-1実測は、事前存在するconfigとの内容衝突により資産コピー段で必ず失敗し
// githubBundle判定へ到達できない（backend分岐のスキップ動作自体を隠蔽してしまう）。したがって
// AC-1の中核ロジック（decideGithubBundle の判定分岐）は test/unit/setup.test.ts で
// 資産コピーを経由しない単体テストとして実測する（SPEC.mdの検証方法見込み: hybrid に対応）。
// AC-2（github明示時に既存挙動が後退しないこと）は本ファイルの後続テストが実際にCLI
// subprocess経由でlabels/ruleset適用まで実測しており、githubBundle実行経路の回帰なしを担保する。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('setup: 非推奨aliasはローカル資産だけを導入し、GitHub Actions/APIを暗黙変更しない', (t) => {
  const scratchDir = mkScratch('setup-scratch');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);

  const targetDir = mkScratch('setup-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  // Given: 空のtarget_dir と gh-stub を用意する
  // When: setup を実行する
  const result = runCli(['setup', targetDir], { env: stub.env(process.env) });

  // Then: 成功し、root直下資産・.agent-skill-chain名前空間だけが作成される
  assert.equal(result.status, 0, result.stderr);
  // Then: 非推奨警告がstderrへ出力される（Issue #169 ADR-1、戻り値・生成物は無変更のまま警告のみ追加）
  assert.match(result.stderr, /警告: setup は非推奨です。init（\+ 必要なら setup github）を使用してください。/);
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'AGENTS.md が作成されること');
  assert.ok(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml')),
    '.agent-skill-chain/config/agent-skill-chain.yaml が作成されること',
  );
  assert.equal(fs.existsSync(path.join(targetDir, '.github')), false, '.githubは暗黙作成しないこと');
  const state = stub.readState();
  assert.deepEqual(state.labels, []);
  assert.deepEqual(state.rulesets, []);
  assert.match(result.stdout, /setup github.*未実行/);
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
  const result = runCli(['setup', 'github', targetDir], {
    env: stub.env({ ...process.env, ASC_GATE_APP_ID: '77' }),
  });

  // Then: 成功し、.github配下が同期される
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(targetDir, '.github', 'CODEOWNERS')));

  // Then: setup本体が担うroot直下資産・.agent-skill-chain名前空間はコピーされない
  assert.ok(!fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'setup githubはAGENTS.mdをコピーしないこと');
  assert.ok(!fs.existsSync(path.join(targetDir, '.agent-skill-chain')), 'setup githubは.agent-skill-chain名前空間をコピーしないこと');
});

test('setup github: consumerへ本体専用release workflowを配布しない', (t) => {
  const scratchDir = mkScratch('setup-github-release-exclusion-scratch');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);

  const targetDir = mkScratch('setup-github-release-exclusion-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['setup', 'github', targetDir], {
    env: stub.env({ ...process.env, ASC_GATE_APP_ID: '77' }),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.existsSync(path.join(targetDir, '.github', 'workflows', 'agent-skill-chain-release.yml')),
    false,
  );
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
  const first = runCli(['setup', 'ruleset'], {
    cwd: repo.dir,
    env: stub.env({ ...process.env, ASC_GATE_APP_ID: '77' }),
  });

  // Then: 成功し、gh-stub状態にruleset「main-protection」が1件新規作成される
  assert.equal(first.status, 0, first.stderr);
  let state = stub.readState();
  assert.equal(state.rulesets.length, 1, '初回は新規rulesetが1件作成されること');
  assert.equal((state.rulesets[0] as { name: string; id: number }).name, 'main-protection');
  const firstId = (state.rulesets[0] as { id: number }).id;

  // When: 2回目のsetup rulesetを実行する
  const second = runCli(['setup', 'ruleset'], {
    cwd: repo.dir,
    env: stub.env({ ...process.env, ASC_GATE_APP_ID: '77' }),
  });

  // Then: 既存rulesetが検出され、新規追加ではなく同一IDのまま更新される
  assert.equal(second.status, 0, second.stderr);
  state = stub.readState();
  assert.equal(state.rulesets.length, 1, '2回目は新規追加でなく既存1件が更新されること');
  assert.equal((state.rulesets[0] as { id: number }).id, firstId, '更新されたrulesetのIDが1回目と同一であること');
  const checks = (
    state.rulesets[0] as {
      rules: { type: string; parameters: { required_status_checks: { context: string; integration_id?: number }[] } }[];
    }
  ).rules.find((rule) => rule.type === 'required_status_checks')?.parameters.required_status_checks ?? [];
  for (const name of ['spec', 'design', 'implementation', 'validation']
    .map((gate) => `agent-skill-chain/${gate}-gate`)) {
    assert.equal(checks.find((check) => check.context === name)?.integration_id, 77);
  }
});

test('setup github: 専用App未設定時は配布物・labels・rulesetを部分展開しない', (t) => {
  const scratchDir = mkScratch('setup-github-preflight');
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const stub = createGhStub(scratchDir);
  const targetDir = mkScratch('setup-github-preflight-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['setup', 'github', targetDir], { env: stub.env(process.env) });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /専用Appをrulesetへ固定できません/);
  assert.equal(fs.existsSync(path.join(targetDir, '.github')), false);
  assert.deepEqual(stub.readState().labels, []);
  assert.deepEqual(stub.readState().rulesets, []);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
