import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureCheckoutState, restoreCheckoutState } from '../../src/lib/checkout-state.js';

// ISSUE-619: captureCheckoutState/restoreCheckoutState 単体（実git bareでない一時repoに対して検証）。
// root-cleanup run固有のPR作成・スコープ検査・マージ判断には一切触れない。

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitRev(cwd: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

function currentBranch(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-state-repo-'));
  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'checkout-state test']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'chore: initial commit']);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('captureCheckoutState/restoreCheckoutState: ブランチチェックアウト中の記録・復元', (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);

  git(repo.dir, ['checkout', '-b', 'feature/work']);
  const state = captureCheckoutState(repo.dir);
  assert.deepEqual(state, { kind: 'branch', name: 'feature/work' });

  git(repo.dir, ['checkout', '-b', 'chore/temp']);
  assert.equal(currentBranch(repo.dir), 'chore/temp');

  const error = restoreCheckoutState(repo.dir, state);
  assert.equal(error, undefined);
  assert.equal(currentBranch(repo.dir), 'feature/work');
});

test('captureCheckoutState/restoreCheckoutState: detached HEADチェックアウト中の記録・復元（同一commitへ戻る）', (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);

  const sha = gitRev(repo.dir);
  git(repo.dir, ['checkout', sha]);
  assert.equal(currentBranch(repo.dir), 'HEAD', '前提: detached HEAD状態であること');

  const state = captureCheckoutState(repo.dir);
  assert.deepEqual(state, { kind: 'detached', sha });

  git(repo.dir, ['checkout', '-b', 'chore/temp']);
  fs.writeFileSync(path.join(repo.dir, 'extra.txt'), 'extra\n');
  git(repo.dir, ['add', '-A']);
  git(repo.dir, ['commit', '-m', 'chore: extra commit on temp branch']);

  const error = restoreCheckoutState(repo.dir, state);
  assert.equal(error, undefined);
  assert.equal(currentBranch(repo.dir), 'HEAD', '復元後も同じcommitへのdetached HEADであること');
  assert.equal(gitRev(repo.dir), sha, '復元後、同一commitへ戻っていること');
});

test('restoreCheckoutState: 復元先が存在しない場合、復元失敗の旨と失敗後の現在ブランチ名を含むエラーメッセージを返す', (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);

  assert.equal(currentBranch(repo.dir), 'main');

  const error = restoreCheckoutState(repo.dir, { kind: 'branch', name: 'no-such-branch-xyz' });
  assert.ok(error !== undefined, '復元失敗時はエラーメッセージを返すこと');
  assert.match(error!, /復元/);
  assert.match(error!, /no-such-branch-xyz/);
  assert.match(error!, /main/, '失敗後の現在のブランチ名を含むこと');
  assert.equal(currentBranch(repo.dir), 'main', '復元失敗時、チェックアウト状態は変化しないこと（git checkout失敗時の既定挙動）');
});
