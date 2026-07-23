import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// Issue #208（main post-merge cleanup自動化、ADR-0007）の受入検証: `agent-skill-chain
// root-cleanup run` という CLI 経路そのもの（実git操作・gh呼び出しの配線）を、ビルド後の
// bin/agents-md.js を子プロセスとして実際に実行することで検証する。gh は test/helpers/gh-stub.ts
// のスタブに差し替え、実際のGitHub API・ネットワークへは一切アクセスしない。git は実バイナリを使い、
// tmp-repo.ts が作る bare remote に対して本物のpush/lsを行う（test/integration/release.test.ts と
// 同一のテスト方式）。

function makeStub() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-root-cleanup-'));
  const stub = createGhStub(scratchDir);
  return { stub, env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** repoRoot直下（repoDir自身）に対象ファイルを作成し、mainへcommit・pushする（「squash mergeの
 * たびに前Issueの成果物がmainルート直下へ恒久混入する」状態の再現）。 */
function writeStrayArtifacts(repoDir: string, files: string[]): void {
  for (const file of files) {
    fs.writeFileSync(path.join(repoDir, file), `# ${file}\n\nstray root artifact\n`);
  }
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-m', 'chore: simulate merged issue segment artifacts at repo root']);
  git(repoDir, ['push', 'origin', 'main']);
}

function extractHeadBranch(args: string[]): string | undefined {
  const i = args.indexOf('--head');
  return i === -1 ? undefined : args[i + 1];
}

// ---- (a) 0件no-op ----

test('root-cleanup run: 対象4ファイルが0件のときno-opになり、PR作成・admin mergeを一切行わない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-op/);
  assert.equal((stub.readState().prCreateCalls ?? []).length, 0);
  assert.equal((stub.readState().mergeCalls ?? []).length, 0);
});

// ---- (b) 1件以上時の削除対象限定・admin merge ----

test('root-cleanup run: 対象ファイルが1件以上のとき、該当ファイルのみを短命ブランチで削除しPRをadmin mergeする（無関係ファイルは削除しない）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['SPEC.md', 'DESIGN.md']);
  fs.writeFileSync(path.join(repo.dir, 'UNRELATED.md'), '# unrelated\n');
  git(repo.dir, ['add', '-A']);
  git(repo.dir, ['commit', '-m', 'chore: add unrelated file (must not be touched)']);
  git(repo.dir, ['push', 'origin', 'main']);

  // gh-stubは実git diffを見ず、'gh pr create'時に登録するfilesを固定値として返す（release.test.ts
  // と同様の方式）。ここではroot-cleanup runが実際に削除する対象と一致させる。
  stub.setDefaultPrFiles(['SPEC.md', 'DESIGN.md']);

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+$/, 'マージしたPR番号を標準出力へ返すこと');

  // Then（該当ファイルのみ削除される。PLAN.md/VALIDATION.mdは元々存在しないため対象外）
  assert.equal(fs.existsSync(path.join(repo.dir, 'SPEC.md')), false);
  assert.equal(fs.existsSync(path.join(repo.dir, 'DESIGN.md')), false);
  assert.equal(fs.existsSync(path.join(repo.dir, 'UNRELATED.md')), true, '無関係なファイルは削除されないこと');

  // Then: 短命ブランチ chore/root-cleanup-* がheadとしてPR作成され、mainへpushされていること
  const prCalls = stub.readState().prCreateCalls ?? [];
  assert.equal(prCalls.length, 1);
  const headBranch = extractHeadBranch(prCalls[0].args);
  assert.ok(headBranch && /^chore\/root-cleanup-\d{8}T\d{6}Z$/.test(headBranch), `headBranch=${headBranch}`);
  assert.match(prCalls[0].args.join(' '), /--base main/);
  const remoteBranches = git(repo.dir, ['ls-remote', '--heads', 'origin', headBranch!]);
  assert.match(remoteBranches, new RegExp(`refs/heads/${headBranch}`));

  // Then（squash既定メッセージ設定に依存せず --subject で固定文言・[skip ci]を明示する）
  const mergeCalls = stub.readState().mergeCalls ?? [];
  assert.equal(mergeCalls.length, 1);
  const mergeArgs = mergeCalls[0].args.join(' ');
  assert.match(mergeArgs, /--admin/);
  assert.match(mergeArgs, /--squash/);
  assert.match(mergeArgs, /--subject chore: remove stray root-level issue segment artifacts \[skip ci\]/);
});

test('root-cleanup run: 対象4ファイルすべてが存在する場合はすべて削除対象になる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md']);
  stub.setDefaultPrFiles(['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md']);

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);

  for (const file of ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md']) {
    assert.equal(fs.existsSync(path.join(repo.dir, file)), false, `${file} が削除されていること`);
  }
});

// ---- (c) スコープ検査違反時のhuman_required ----

test('root-cleanup run スコープ検査違反（想定外パス混入）: 変更ファイルが対象4ファイル以外を含むPRは自動admin mergeせずhuman_requiredで停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['SPEC.md']);

  // Given: gh pr create が返すPRの変更ファイル集合に、想定外のファイルが含まれる状況を模擬する
  stub.setDefaultPrFiles(['SPEC.md', 'src/unexpected.ts']);

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /human_required/);
  assert.match(result.stderr, /src\/unexpected\.ts/);
  assert.equal((stub.readState().mergeCalls ?? []).length, 0, 'merge呼び出し自体が発生していないこと');
});

test('root-cleanup run スコープ検査違反（削除以外の変更混入）: additions>0のファイルを含むPRは自動admin mergeせずhuman_requiredで停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['SPEC.md', 'DESIGN.md']);

  // Given: SPEC.mdが「削除」ではなく「変更」（additions>0）として報告される想定外の状況を模擬する
  stub.setDefaultPrFiles(['SPEC.md', 'DESIGN.md']);
  stub.setDefaultPrFileStats({ 'SPEC.md': { additions: 3, deletions: 0 } });

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /human_required/);
  assert.match(result.stderr, /削除以外の変更が含まれています/);
  assert.match(result.stderr, /SPEC\.md/);
  assert.equal((stub.readState().mergeCalls ?? []).length, 0);
});

// ---- root-cleanup run 自己修復（admin merge失敗後の次runでの再利用） ----

test('root-cleanup run 自己修復: 1回目のadmin merge失敗後、次runは既存のOPEN cleanup PRを再利用し重複作成せず再試行に成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['VALIDATION.md']);
  stub.setDefaultPrFiles(['VALIDATION.md']);

  stub.failNextMerge(1);
  const first = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.notEqual(first.status, 0, '1回目はadmin merge失敗により非0終了すること');
  assert.match(first.stderr, /gh pr merge --admin に失敗しました/);

  // 実際のCIでは各runが actions/checkout@v4 によるmainの新規checkoutから独立して開始するため、
  // 1回目のrunがローカルに残したcleanupブランチのcheckout状態（対象ファイル削除済み）を、
  // 2回目run前にmainの最新状態（origin/main、まだ削除前）へ明示的に戻す。
  git(repo.dir, ['fetch', 'origin', 'main']);
  git(repo.dir, ['checkout', '-B', 'main', 'origin/main']);
  assert.equal(fs.existsSync(path.join(repo.dir, 'VALIDATION.md')), true, '前提: originのmainはまだ削除前であること');

  const second = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(second.status, 0, second.stderr);

  const prCalls = stub.readState().prCreateCalls ?? [];
  assert.equal(prCalls.length, 1, 'gh pr create は重複実行されないこと（既存OPEN PRの検出による再利用）');
  const mergeCalls = stub.readState().mergeCalls ?? [];
  assert.equal(mergeCalls.length, 2, 'admin merge自体は失敗分+成功分の2回呼ばれていること（再試行は行われる）');
});

// ---- 並行Issue不干渉の自動検証（AC-3） ----

test('root-cleanup run (AC-3): 並行する他Issueのworktree・ブランチのファイル内容・commit履歴は実行前後で一切変化しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const start1 = runCli(['issue', 'start', 'ISSUE-1', 'feature', 'sample-one', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start1.status, 0, start1.stderr);
  const [, worktree1] = start1.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktree1, 'SPEC.md'), '# SPEC issue1\n\nAC-1: sample\n');
  const checkpoint1 = runCli(['checkpoint', 'docs: add SPEC.md for issue1'], { cwd: worktree1 });
  assert.equal(checkpoint1.status, 0, checkpoint1.stderr);

  const start2 = runCli(['issue', 'start', 'ISSUE-2', 'feature', 'sample-two', FIXED_TIMESTAMP], { cwd: repo.dir });
  assert.equal(start2.status, 0, start2.stderr);
  const [, worktree2] = start2.stdout.trim().split('\n');
  fs.writeFileSync(path.join(worktree2, 'DESIGN.md'), '# DESIGN issue2\n');
  const checkpoint2 = runCli(['checkpoint', 'docs: add DESIGN.md for issue2'], { cwd: worktree2 });
  assert.equal(checkpoint2.status, 0, checkpoint2.stderr);

  function snapshot(worktreePath: string, file: string): { content: string; sha: string } {
    return {
      content: fs.readFileSync(path.join(worktreePath, file), 'utf8'),
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' }).trim(),
    };
  }
  const before1 = snapshot(worktree1, 'SPEC.md');
  const before2 = snapshot(worktree2, 'DESIGN.md');

  // When: main root直下に（他の、既にマージ済みの）Issue由来の恒久混入相当のファイルを作り、
  // root-cleanup run を実行する
  writeStrayArtifacts(repo.dir, ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md']);
  stub.setDefaultPrFiles(['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md']);
  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo.dir, 'SPEC.md')), false, '前提: root直下は削除されていること');

  // Then: 他Issueのworktree内ファイル内容・HEAD SHAはbyte-for-byte・SHA一致で不変
  const after1 = snapshot(worktree1, 'SPEC.md');
  const after2 = snapshot(worktree2, 'DESIGN.md');
  assert.deepEqual(after1, before1, 'ISSUE-1のworktreeはroot-cleanup runの影響を受けないこと');
  assert.deepEqual(after2, before2, 'ISSUE-2のworktreeはroot-cleanup runの影響を受けないこと');

  // Then: worktree命名規則検査・findIssueWorktree()経由のIssue解決にも影響しない
  const worktreePathCheck = runCli(['verify', 'worktree-path'], { cwd: repo.dir });
  assert.equal(worktreePathCheck.status, 0, worktreePathCheck.stderr);
  const artifactsCheck1 = runCli(['verify', 'artifacts', 'ISSUE-1', 'spec'], { cwd: repo.dir });
  assert.equal(artifactsCheck1.status, 0, artifactsCheck1.stderr);
});

// ---- verify root-clean（AC-4）はこの新設サブコマンド自身の合否検証であり、
// test/integration/verify.test.ts の他 verify サブコマンド群と同じ場所（同ファイル）でも検証する。
