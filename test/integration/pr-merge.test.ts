import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, removeMergeAutonomous, setMergeAutonomous } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// Issue #398（PRマージ後のローカルmain worktree自動同期）の受入検証: `agent-skill-chain
// pr merge` という CLI 経路そのもの（`gh pr merge` への引数透過・マージ成功後の
// main worktree同期・マージ失敗時の同期スキップ）を、ビルド後の bin/agents-md.js を
// 子プロセスとして実際に実行することで検証する。gh は test/helpers/gh-stub.ts のスタブに
// 差し替え、実際のGitHub API・ネットワークへは一切アクセスしない。git は実バイナリを使う
// （test/integration/release.test.ts と同一のテスト方式）。

function makeStub() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-pr-merge-'));
  const stub = createGhStub(scratchDir);
  return { stub, env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * `repo` とは別クローンから origin/main を1コミット進める。GitHub上で（このテストが検証する
 * `pr merge` 呼び出しとは無関係に）先行して main が進んでいた状態を再現する。これにより
 * 「`pr merge` 成功後に main worktree が origin/main へ追従したか」を、gh スタブの
 * マージ副作用（gh-stub.ts の `applyMergedPrToMain`）に依存せず独立に検証できる。
 */
function advanceOriginMainIndependently(repo: { dir: string; remoteDir: string }, marker: string): void {
  const scratchClone = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-merge-advance-'));
  try {
    execFileSync('git', ['clone', repo.remoteDir, scratchClone], { stdio: 'pipe' });
    git(scratchClone, ['config', 'user.email', 'test@example.com']);
    git(scratchClone, ['config', 'user.name', 'agent-skill-chain test']);
    fs.writeFileSync(path.join(scratchClone, marker), `${marker}\n`);
    git(scratchClone, ['add', '-A']);
    git(scratchClone, ['commit', '-m', `chore: advance main independently (${marker})`]);
    git(scratchClone, ['push', 'origin', 'main']);
  } finally {
    fs.rmSync(scratchClone, { recursive: true, force: true });
  }
}

/** Issueのworktree相当（mainとは別ブランチをチェックアウトしたlinked worktree）を作る。 */
function addIssueWorktree(repoDir: string, branch: string): string {
  const wtPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-merge-issue-wt-'));
  fs.rmdirSync(wtPath); // git worktree add は宛先が未存在であることを要求する
  git(repoDir, ['worktree', 'add', wtPath, '-b', branch]);
  return wtPath;
}

test('pr merge (AC): gh pr merge 成功後、cwdがissue worktreeでもmain worktreeをorigin/mainへfast-forward同期する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  // Issue #427: このテストは自動マージが明示的に許可された状況（merge.autonomous: true）を検証する。
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/398-example');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  // Given: GitHub側でorigin/mainが（今回のpr merge呼び出しとは独立に）先行して進んでいる
  advanceOriginMainIndependently(repo, 'independent-advance.txt');
  const remoteMainSha = git(repo.dir, ['ls-remote', repo.remoteDir, 'refs/heads/main']).split('\t')[0];
  const localMainShaBefore = git(repo.dir, ['rev-parse', 'main']);
  assert.notEqual(localMainShaBefore, remoteMainSha, 'テスト前提: ローカルmainはまだ古いはず');

  // When: issue worktree（main worktreeではないcwd）から pr merge を実行する
  const result = runCli(['pr', 'merge', '1', '--squash', '--admin'], { cwd: issueWorktree, env });

  // Then: gh pr merge へオプションが透過され、成功する
  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length, 1);
  assert.deepEqual(state.mergeCalls?.[0]?.args, ['pr', 'merge', '1', '--squash', '--admin']);

  // Then: main worktree（repo.dir）のローカルmainがorigin/mainへfast-forward同期されている
  const localMainShaAfter = git(repo.dir, ['rev-parse', 'main']);
  assert.equal(localMainShaAfter, remoteMainSha);
  assert.ok(
    fs.existsSync(path.join(repo.dir, 'independent-advance.txt')),
    'main worktreeの作業ツリー自体にも同期後のファイルが反映されているはず',
  );
});

test('pr merge (AC): gh pr merge が失敗した場合、main worktreeの同期は実行されず非0で終了する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  // Issue #427: このテストは自動マージが明示的に許可された状況（merge.autonomous: true）を検証する。
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/398-example-fail');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  // Given: 次のgh pr mergeを失敗させる。origin/mainは（もし誤って同期処理が走った場合に
  // 検出できるよう）先行して進めておく
  stub.failNextMerge(1);
  advanceOriginMainIndependently(repo, 'should-not-sync.txt');
  const remoteTrackingBefore = git(repo.dir, ['rev-parse', 'refs/remotes/origin/main']);
  const localMainShaBefore = git(repo.dir, ['rev-parse', 'main']);

  // When
  const result = runCli(['pr', 'merge', '1', '--squash', '--admin'], { cwd: issueWorktree, env });

  // Then: マージ失敗がそのまま非0終了・エラーメッセージとして伝播する
  assert.notEqual(result.status, 0);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length, 1);

  // Then: 同期処理（git fetch/merge）は一切実行されていない
  // （fetchが走っていれば refs/remotes/origin/main が進んでいるはずだが、変化していないことで検証する）
  const remoteTrackingAfter = git(repo.dir, ['rev-parse', 'refs/remotes/origin/main']);
  assert.equal(remoteTrackingAfter, remoteTrackingBefore, 'マージ失敗時はfetchすら行われないはず');
  const localMainShaAfter = git(repo.dir, ['rev-parse', 'main']);
  assert.equal(localMainShaAfter, localMainShaBefore, 'マージ失敗時はローカルmainが変化しないはず');
  assert.ok(!fs.existsSync(path.join(repo.dir, 'should-not-sync.txt')));
});

// Issue #427: 進行役によるPR自動マージは既定（merge.autonomous 未設定）で無効であり、
// `gh pr merge` を一切実行せず日本語エラーで非0終了することを固定化する。
test('pr merge (AC): merge.autonomousが未設定（既定）の場合、gh pr mergeを実行せず日本語エラーで非0終了する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  // 本物のリポジトリ自身の config は dogfooding のため merge.autonomous: true を持つ
  // （開発リポジトリでは自走的マージ運用を明示承認済み）。「未設定＝既定 false」を検証する
  // ため、fixture からその値を明示的に外す。
  removeMergeAutonomous(repo.dir);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/427-example-default');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  const localMainShaBefore = git(repo.dir, ['rev-parse', 'main']);

  const result = runCli(['pr', 'merge', '1', '--squash', '--admin'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0, 'merge.autonomousが未設定なら非0で終了するはず');
  assert.match(result.stderr, /人間/, '人間への確認を促す日本語メッセージを含むはず');
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');

  const localMainShaAfter = git(repo.dir, ['rev-parse', 'main']);
  assert.equal(localMainShaAfter, localMainShaBefore, 'マージ自体を実行していないためローカルmainも変化しないはず');
});

test('pr merge (AC): merge.autonomousをfalseに明示設定した場合も、gh pr mergeを実行せず非0終了する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, false);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/427-example-explicit-false');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  const result = runCli(['pr', 'merge', '1'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
});
