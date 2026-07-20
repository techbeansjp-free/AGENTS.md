import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, FIXED_TIMESTAMP } from '../helpers/tmp-repo.js';
import { loadConfig } from '../../src/lib/config.js';
import {
  listWorktrees,
  hasUncommittedChanges,
  defaultBranch,
  hasUnpushedCommits,
  findIssueWorktree,
  worktreePathRegex,
  branchNameRegex,
} from '../../src/lib/worktree.js';

function gitIn(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitRev(cwd: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

test('listWorktrees: 初期状態ではメインworktree1件のみをbranch:mainで列挙する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const entries = listWorktrees(repo.dir);
  assert.equal(entries.length, 1);
  assert.equal(path.resolve(entries[0].path), path.resolve(repo.dir));
  assert.equal(entries[0].branch, 'main');
  assert.equal(entries[0].bare, undefined);
  assert.equal(entries[0].detached, undefined);
});

test('listWorktrees: git worktree add で作った実物のworktreeを列挙する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-sample-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'feature/42-sample-slug', worktreePath, 'main']);

  const entries = listWorktrees(repo.dir);
  assert.equal(entries.length, 2);
  const added = entries.find((e) => path.resolve(e.path) === path.resolve(worktreePath));
  assert.ok(added, '追加したworktreeが列挙結果に含まれること');
  assert.equal(added!.branch, 'feature/42-sample-slug');
});

test('hasUncommittedChanges: 変更前はfalse、ファイル追加後はtrueになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-sample-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'feature/42-sample-slug', worktreePath, 'main']);

  assert.equal(hasUncommittedChanges(worktreePath), false);

  fs.writeFileSync(path.join(worktreePath, 'NEW_FILE.md'), '# new\n');
  assert.equal(hasUncommittedChanges(worktreePath), true);
});

test('defaultBranch: mainを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  assert.equal(defaultBranch(repo.dir), 'main');
});

test('hasUnpushedCommits: push前はtrue、git push -u origin後はfalseになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/42-sample-slug';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-sample-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);

  fs.writeFileSync(path.join(worktreePath, 'NEW_FILE.md'), '# new\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add NEW_FILE.md']);

  assert.equal(hasUnpushedCommits(worktreePath, branch), true, 'upstream未設定はpush実績なしとみなしtrue');

  gitIn(worktreePath, ['push', '-u', 'origin', branch]);

  assert.equal(hasUnpushedCommits(worktreePath, branch), false, 'push後はaheadが0でfalse');
});

test('findIssueWorktree: worktree.path_patternに沿ったworktreeをissue番号から見つける', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);

  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-sample-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'feature/42-sample-slug', worktreePath, 'main']);

  // 無関係のissue番号のworktreeも作り、issue番号で正しく絞り込めることを検証する。
  const otherWorktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-99-other-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'feature/99-other-slug', otherWorktreePath, 'main']);

  const found = findIssueWorktree(repo.dir, config, '42');
  assert.ok(found, 'issue 42 に対応するworktreeが見つかること');
  assert.equal(path.resolve(found!.path), path.resolve(worktreePath));

  const notFound = findIssueWorktree(repo.dir, config, '12345');
  assert.equal(notFound, undefined, '存在しないissue番号はundefined');
});

test('findIssueWorktree: .worktrees型レイアウトが無い単一checkout状態でも、現在のブランチがissue_idに一致すればrootをentryとして返す（CI actions/checkoutフォールバック）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);

  // actions/checkout は git worktree add を使わないため、.worktrees/ 型レイアウトは一切作られず
  // `git worktree list --porcelain` はチェックアウト先（root）1件のみを返す状態を再現する。
  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);

  const found = findIssueWorktree(repo.dir, config, '171');
  assert.ok(found, 'issue 171 に対応するエントリがフォールバックで見つかること');
  assert.equal(path.resolve(found!.path), path.resolve(repo.dir));
  assert.equal(found!.branch, 'feature/171-ci-gate-dogfood');
  assert.equal(found!.head, gitRev(repo.dir));
});

test('findIssueWorktree: 単一checkout状態で現在のブランチがissue_idに一致しない場合はundefinedのまま', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);

  const notFound = findIssueWorktree(repo.dir, config, '999');
  assert.equal(notFound, undefined, 'issue 999 のブランチではないためフォールバックも不一致でundefined');
});

test('worktreePathRegex: path_patternに沿った形式のみ許容する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);
  const regex = worktreePathRegex(config);

  assert.match(`${FIXED_TIMESTAMP}-feature-42-sample-slug`, regex);
  assert.doesNotMatch(`${FIXED_TIMESTAMP}-notatype-42-sample-slug`, regex, '許可されていないtypeは不一致');
  assert.doesNotMatch('feature-42-sample-slug', regex, 'タイムスタンプ欠如は不一致');
  assert.doesNotMatch(`${FIXED_TIMESTAMP}-feature-abc-sample-slug`, regex, 'issue_idが数字以外だと不一致');
});

test('branchNameRegex: branch.patternに沿った形式のみ許容する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);
  const regex = branchNameRegex(config);

  assert.match('feature/42-sample-slug', regex);
  assert.doesNotMatch('notatype/42-sample-slug', regex, '許可されていないtypeは不一致');
  assert.doesNotMatch('feature/sample-slug', regex, 'issue_id欠如は不一致');
  assert.doesNotMatch('feature-42-sample-slug', regex, '区切りが / でないと不一致');
});
