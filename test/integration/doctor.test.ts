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

// Issue #188 D1〜D5（AC-3）: doctor追加5観点の意図的な不整合注入によるNG検知・正常時のOK（沈黙）を検証する。

function setDurabilityBackend(repoDir: string, value: 'remote' | 'local_mirror'): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/(durability:\n\s*backend: )\w+/, `$1${value}`);
  if (patched === text) {
    throw new Error('durability.backend の書き換えに失敗しました（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
  fs.writeFileSync(configPath, patched);
}

function writeAdrFixture(
  repoDir: string,
  filename: string,
  id: string,
  status: string,
  supersedes: string[],
  supersededBy: string | null,
): void {
  const dir = path.join(repoDir, 'docs', 'adr');
  fs.mkdirSync(dir, { recursive: true });
  const text = [
    '# ADR',
    '',
    '```yaml',
    `id: ${id}`,
    `status: ${status}`,
    'title: sample',
    'tags: []',
    `supersedes: [${supersedes.join(', ')}]`,
    `superseded-by: ${supersededBy ?? 'null'}`,
    'deprecated-reason: null',
    '```',
    '',
    '## Context',
    'x',
    '',
    '## Decision',
    'x',
    '',
    '## Consequences',
    'x',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, filename), text);
}

// ---- D1: branch名規約 ----

test('doctor D1: worktreeのcheckoutブランチがbranch.patternに適合しないと branch名規約 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  // Given: worktreeのパス自体はworktree.path_patternに適合するが、branchはbranch.patternに適合しない
  const worktreePath = path.join(repo.dir, '.worktrees', '20260101_000000-feature-42-branchmismatch');
  execFileSync('git', ['worktree', 'add', '-b', 'not-a-valid-branch-name', worktreePath, 'main'], {
    cwd: repo.dir,
    stdio: 'pipe',
  });

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, new RegExp(`NG {2}branch名規約: .*${escapeRegExp(worktreePath)}`));
});

test('doctor D1: 追加worktreeが無ければ branch名規約 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.match(result.stdout, /OK {2}branch名規約/);
});

// ---- D2: Durability Backend疎通 ----

test('doctor D2: durability.backend=remoteでoriginへ疎通できないと Durability Backend疎通 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  execFileSync('git', ['remote', 'set-url', 'origin', '/path/does/not/exist-xyz'], { cwd: repo.dir, stdio: 'pipe' });

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}Durability Backend疎通/);
});

test('doctor D2: durability.backend=remoteでoriginへ疎通できれば Durability Backend疎通 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.match(result.stdout, /OK {2}Durability Backend疎通/);
});

test('doctor D2: durability.backend=local_mirrorでミラー先(origin)が存在しないと Durability Backend疎通 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setDurabilityBackend(repo.dir, 'local_mirror');
  execFileSync('git', ['remote', 'set-url', 'origin', '/path/does/not/exist-xyz'], { cwd: repo.dir, stdio: 'pipe' });

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}Durability Backend疎通: .*ミラー先/);
});

test('doctor D2: durability.backend=local_mirrorでミラー先(origin)が実在すれば Durability Backend疎通 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setDurabilityBackend(repo.dir, 'local_mirror');

  // Given: createTmpRepoのoriginは実在するローカルbare repo（remoteDir）を指している
  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.match(result.stdout, /OK {2}Durability Backend疎通/);
});

// ---- D3: writer lease失効（localバックエンドのみ） ----

test('doctor D3 (local backend): 失効済みのwriter leaseが残っていると writer lease失効 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const acquire = runCli(['lease', 'acquire', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(acquire.status, 0, acquire.stderr);
  const leasePath = path.join(repo.dir, 'issues', '1', '.agent-skill-chain', 'lease.yaml');
  const text = fs.readFileSync(leasePath, 'utf8');
  const patched = text.replace(/expires_at:.*/, "expires_at: '2000-01-01T00:00:00.000Z'");
  assert.notEqual(patched, text, 'テスト前提: expires_atを書き換えられること');
  fs.writeFileSync(leasePath, patched);

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}writer lease失効: .*ISSUE-1/);
});

test('doctor D3 (local backend): leaseが存在しなければ writer lease失効 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.match(result.stdout, /OK {2}writer lease失効/);
});

test('doctor D3 (github backend): writer lease失効 検査自体が実行されない（github backendのgit-ref leaseは対象外）', (t) => {
  const repo = createTmpRepo({ backend: 'github' });
  t.after(() => repo.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.doesNotMatch(result.stdout, /writer lease失効/);
});

// ---- D4: AC-ID重複 ----

test('doctor D4: worktree内SPEC.mdでAC-IDが重複していると AC-ID重複 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\nAC-1: duplicate\n');

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}AC-ID重複: .*AC-1/);
});

test('doctor D4: worktree内SPEC.mdのAC-IDが重複していなければ AC-ID重複 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const start = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-feature', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start.status, 0, start.stderr);
  const [, worktreePath] = start.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktreePath, 'SPEC.md'), '# SPEC\n\nAC-1: sample\nAC-2: another\n');

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.match(result.stdout, /OK {2}AC-ID重複/);
});

// ---- D5: ADR整合性 ----

test('doctor D5: supersedes⇔superseded-byが非対称だと ADR整合性 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  writeAdrFixture(repo.dir, 'ADR-0001-a.md', 'ADR-0001', 'superseded', [], 'ADR-0002');
  // ADR-0002はADR-0001をsupersedesすると主張していない（非対称）。
  writeAdrFixture(repo.dir, 'ADR-0002-b.md', 'ADR-0002', 'accepted', [], null);

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}ADR整合性/);
});

test('doctor D5: 不正なstatus値のADRがあると ADR整合性 がNGになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  writeAdrFixture(repo.dir, 'ADR-0001-a.md', 'ADR-0001', 'unknown-status', [], null);

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.equal(result.status >= 1, true);
  assert.match(result.stdout, /NG {2}ADR整合性: .*不正なstatus/);
});

test('doctor D5: supersedes⇔superseded-byが対称であれば ADR整合性 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  writeAdrFixture(repo.dir, 'ADR-0001-a.md', 'ADR-0001', 'superseded', [], 'ADR-0002');
  writeAdrFixture(repo.dir, 'ADR-0002-b.md', 'ADR-0002', 'accepted', ['ADR-0001'], null);

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.match(result.stdout, /OK {2}ADR整合性/);
});

test('doctor D5: docs/adr/が存在しなければ ADR整合性 がOKになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const result = runCli(['doctor'], { cwd: repo.dir });
  assert.match(result.stdout, /OK {2}ADR整合性/);
});
