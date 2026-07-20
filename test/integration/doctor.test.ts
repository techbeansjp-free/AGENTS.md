import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';

// Issue #169 T8: doctor拡張（init導入済み・enforce配線状態の情報表示）の結合テスト。
// いずれも情報表示のみであり、未導入・非配線であってもdoctor自体の成否判定には影響しない。

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('doctor: initを実行していないtarget_dirでも、他の必須チェックがOKなら終了コードは0のままで、init未導入が情報表示される', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Issue #174: doctorにtemplate-sync検査・main worktree cleanチェックが追加されたため、
  // このテストの前提（他の必須チェックがすべてOK）を満たすには .github/ を同期・commitしておく必要がある。
  const sync = runCli(['sync', 'templates', repo.dir], { cwd: repo.dir });
  assert.equal(sync.status, 0, sync.stderr);
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: sync templates'], { cwd: repo.dir, stdio: 'pipe' });

  const result = runCli(['doctor'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /情報 {2}init 導入済み: NG（未導入）/);
  assert.match(result.stdout, /情報 {2}enforce の配線状態: OFF/);
});

test('doctor: init実行後は導入済みバージョンが情報表示される', (t) => {
  const targetDir = mkScratch('doctor-init-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);

  // git repository化しないと repoRoot() が親の実リポジトリを拾ってしまうため、
  // 最小限のgit repoにする（.git の存在だけで doctor の git repository チェックは通る）。
  fs.mkdirSync(path.join(targetDir, '.git'), { recursive: true });

  const result = runCli(['doctor'], { cwd: targetDir });

  assert.match(result.stdout, /情報 {2}init 導入済み: OK \(\d+\.\d+\.\d+\)/);
});

test('doctor: enforce on実行後はenforceの配線状態がONと表示される', (t) => {
  const targetDir = mkScratch('doctor-enforce-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const init = runCli(['init', targetDir]);
  assert.equal(init.status, 0, init.stderr);
  fs.mkdirSync(path.join(targetDir, '.git'), { recursive: true });

  const enforceOn = runCli(['enforce', 'on', targetDir]);
  assert.equal(enforceOn.status, 0, enforceOn.stderr);

  const result = runCli(['doctor'], { cwd: targetDir });

  assert.match(result.stdout, /情報 {2}enforce の配線状態: ON/);
});

// Issue #174 AC-1〜AC-5: doctor拡張4項目（worktree命名規約・main worktreeのclean状態・
// template-sync・schemas構文妥当性）の正常系・意図的な故障注入による異常系を検証する。

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('doctor: worktree.path_patternに適合しないworktreeが存在すると worktree命名規約 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: 規約に適合しない名前のworktreeを追加する
  const badPath = path.join(repo.dir, '.worktrees', 'not-a-valid-worktree-name');
  execFileSync('git', ['worktree', 'add', '-b', 'feature/bad-name', badPath, 'main'], { cwd: repo.dir, stdio: 'pipe' });

  // When: doctorを実行する
  const result = runCli(['doctor'], { cwd: repo.dir });

  // Then: worktree命名規約がNG表示され、終了コードが1以上になる（AC-1）
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, new RegExp(`NG {2}worktree命名規約: .*${escapeRegExp(badPath)}`));
});

test('doctor: worktreeがすべて規約に適合する（追加worktree無し）場合は worktree命名規約 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: 追加worktreeが0件の状態（主worktreeのみ）でdoctorを実行する
  const result = runCli(['doctor'], { cwd: repo.dir });

  // Then: 対象なしでも自明にOKになる（AC-5）
  assert.match(result.stdout, /OK {2}worktree命名規約/);
});

test('doctor: main worktreeに未commit差分があると main worktreeのclean状態 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: main worktree（repo.dir自身）に未commitの変更を作る
  fs.writeFileSync(path.join(repo.dir, 'untracked.txt'), 'dirty\n');

  // When: doctorを実行する
  const result = runCli(['doctor'], { cwd: repo.dir });

  // Then: main worktreeのclean状態がNG表示され、終了コードが1以上になる（AC-2）
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}main worktreeのclean状態: 未commitの変更があります/);
});

test('doctor: main worktreeがclean（commit済み）であれば main worktreeのclean状態 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: createTmpRepoはすべてcommit・push済みの状態でrepoを作る
  const result = runCli(['doctor'], { cwd: repo.dir });

  // Then: main worktreeのclean状態はOKになる（AC-5）
  assert.match(result.stdout, /OK {2}main worktreeのclean状態/);
});

test('doctor: .github/がtemplates/github/.github/と同期していないと template-sync がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: createTmpRepoは.github/を作らない（sync templates未実行）ため、doctorを実行すると
  // Then: template-syncがNG表示され、終了コードが1以上になる（AC-3）
  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}template-sync: /);
});

test('doctor: sync templates後に.github/を改変すると template-sync がNGになり、改変前はOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: sync templatesで.github/を配布元と同期する
  const sync = runCli(['sync', 'templates', repo.dir], { cwd: repo.dir });
  assert.equal(sync.status, 0, sync.stderr);

  // When: 同期直後にdoctorを実行する
  // Then: template-syncはOKになる（AC-5）
  const before = runCli(['doctor'], { cwd: repo.dir });
  assert.match(before.stdout, /OK {2}template-sync/);

  // When: 同期済みファイルの内容を改変してから再度doctorを実行する
  fs.appendFileSync(path.join(repo.dir, '.github', 'CODEOWNERS'), '\n# modified\n');
  const after = runCli(['doctor'], { cwd: repo.dir });

  // Then: template-syncがNGになる（AC-3）
  assert.equal(after.status >= 1, true);
  assert.match(after.stdout, /NG {2}template-sync: .*未同期（差分あり）: CODEOWNERS/);
});

test('doctor: schemas/*.yamlにYAML構文エラーがあると schemas構文妥当性 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: config.schema.yamlをYAML構文として不正な内容に書き換える
  const badSchemaPath = path.join(repo.dir, '.agent-skill-chain', 'schemas', 'config.schema.yaml');
  fs.writeFileSync(badSchemaPath, 'foo: [1, 2\n  bar: [unbalanced brackets\n');

  // When: doctorを実行する
  const result = runCli(['doctor'], { cwd: repo.dir });

  // Then: schemas構文妥当性がNG表示され、終了コードが1以上になる（AC-4）
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}schemas構文妥当性: .*config\.schema\.yaml/);
});

test('doctor: schemasがすべて構文妥当なら schemas構文妥当性 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given/When: 実物のschemasファイル（改変なし）でdoctorを実行する
  const result = runCli(['doctor'], { cwd: repo.dir });

  // Then: schemas構文妥当性はOKになる（AC-5）
  assert.match(result.stdout, /OK {2}schemas構文妥当性/);
});

test('doctor: 追加4項目すべてが正常な状態であれば全項目OK・終了コード0になる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: .github/を配布元と同期する
  const sync = runCli(['sync', 'templates', repo.dir], { cwd: repo.dir });
  assert.equal(sync.status, 0, sync.stderr);

  // Given: 規約に適合する名前のissue用worktreeを1つ追加する（worktree命名規約チェック対象を非0件にする）。
  // backend: local の issue start は root/issues/<id>/.agent-skill-chain/state.yaml をmain worktree側に
  // 書き込むため、.github/同期分と合わせて最後にまとめてcommitし、main worktreeをcleanな状態に保つ。
  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: sync templates + issue start state'], { cwd: repo.dir, stdio: 'pipe' });

  // When: doctorを実行する
  const result = runCli(['doctor'], { cwd: repo.dir });

  // Then: 追加4項目すべてがOK表示され、終了コード0になる（AC-5）
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
  assert.match(result.stdout, /OK {2}worktree命名規約/);
  assert.match(result.stdout, /OK {2}main worktreeのclean状態/);
  assert.match(result.stdout, /OK {2}template-sync/);
  assert.match(result.stdout, /OK {2}schemas構文妥当性/);
});
