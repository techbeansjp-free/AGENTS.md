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
  resolveCurrentBranch,
  resolveCurrentBranchInfo,
} from '../../src/lib/worktree.js';

function gitIn(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitRev(cwd: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

/** `git <args>` が成功するかどうかだけを真偽値で返す（前提条件の確認用）。 */
function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
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

// actions/checkout@v4 は既定で fetch-depth: 1 かつPRのマージrefのみをフェッチするため、
// origin/HEAD のsymrefが未設定・main/masterのローカルrefも不在という状態になる
// （PR #172 run 29717720242 で実落ち）。以下は `git branch -D main` でローカルmain refを
// 実際に削除し、shallow checkout相当の状態を再現して検証する。

test('defaultBranch: origin/HEAD未設定・main/masterのローカルref不在でもGITHUB_BASE_REFが設定済みならそれを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  gitIn(repo.dir, ['branch', '-D', 'main']);

  // 前提: origin/HEAD未設定・ローカルmain/master ref不在であること
  assert.equal(
    gitOk(repo.dir, ['symbolic-ref', 'refs/remotes/origin/HEAD']),
    false,
    '前提: origin/HEADのsymrefが未設定であること',
  );
  for (const candidate of ['main', 'master']) {
    assert.equal(
      gitOk(repo.dir, ['rev-parse', '--verify', candidate]),
      false,
      `前提: ローカルの${candidate} refが存在しないこと`,
    );
  }

  const original = process.env.GITHUB_BASE_REF;
  process.env.GITHUB_BASE_REF = 'chore/162-agent-skill-chain-bootstrap';
  t.after(() => {
    if (original === undefined) delete process.env.GITHUB_BASE_REF;
    else process.env.GITHUB_BASE_REF = original;
  });

  assert.equal(defaultBranch(repo.dir), 'chore/162-agent-skill-chain-bootstrap');
});

test('defaultBranch: origin/HEAD未設定・main/masterのローカルref不在かつGITHUB_BASE_REFも未設定ならエラーになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  gitIn(repo.dir, ['branch', '-D', 'main']);

  const original = process.env.GITHUB_BASE_REF;
  delete process.env.GITHUB_BASE_REF;
  t.after(() => {
    if (original !== undefined) process.env.GITHUB_BASE_REF = original;
  });

  assert.throws(() => defaultBranch(repo.dir), /デフォルトブランチを特定できません/);
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

// 以下は実際の actions/checkout@v4 が pull_request イベントで作る detached HEAD 状態
// （`switching to 'refs/remotes/pull/<n>/merge'` → `You are in 'detached HEAD' state.`）を
// `git checkout --detach <sha>` で実際に再現して検証する。前回追加分のフォールバックテストは
// 通常ブランチのcheckoutしか再現しておらず、detached HEADでは `git rev-parse --abbrev-ref HEAD`
// が実ブランチ名ではなく文字列 "HEAD" を返すために機能しなかった（PR #172 run 29713661947 で実落ち）。

test('findIssueWorktree: detached HEAD状態でもGITHUB_HEAD_REFがissue_idに一致すればrootをentryとして返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  const sha = gitRev(repo.dir);
  gitIn(repo.dir, ['checkout', '--detach', sha]);
  // detached HEAD の再現を明示的に確認する（ここが 'HEAD' でなければ以降の検証が無意味になる）。
  assert.equal(
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim(),
    'HEAD',
    '前提: detached HEAD状態を再現できていること',
  );

  const originalHeadRef = process.env.GITHUB_HEAD_REF;
  process.env.GITHUB_HEAD_REF = 'feature/171-ci-gate-dogfood';
  t.after(() => {
    if (originalHeadRef === undefined) delete process.env.GITHUB_HEAD_REF;
    else process.env.GITHUB_HEAD_REF = originalHeadRef;
  });

  const found = findIssueWorktree(repo.dir, config, '171');
  assert.ok(found, 'GITHUB_HEAD_REF経由でissue 171 に対応するエントリが見つかること');
  assert.equal(path.resolve(found!.path), path.resolve(repo.dir));
  assert.equal(found!.branch, 'feature/171-ci-gate-dogfood');
  assert.equal(found!.detached, true);
  assert.equal(found!.head, sha);
});

test('findIssueWorktree: detached HEAD状態でGITHUB_HEAD_REFが対象issueと一致しない場合はundefinedのまま', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  const sha = gitRev(repo.dir);
  gitIn(repo.dir, ['checkout', '--detach', sha]);

  const originalHeadRef = process.env.GITHUB_HEAD_REF;
  process.env.GITHUB_HEAD_REF = 'feature/171-ci-gate-dogfood';
  t.after(() => {
    if (originalHeadRef === undefined) delete process.env.GITHUB_HEAD_REF;
    else process.env.GITHUB_HEAD_REF = originalHeadRef;
  });

  // GITHUB_HEAD_REF自体はissue 171のブランチ名で判明しているが、要求されたissue番号(999)とは
  // 一致しないため、単一checkoutフォールバック(entries.length===1)は発火せずundefinedのまま。
  const notFound = findIssueWorktree(repo.dir, config, '999');
  assert.equal(notFound, undefined, 'ブランチ名が判明していて単に不一致な場合は誤爆せずundefined');
});

test('findIssueWorktree: detached HEADかつGITHUB_HEAD_REF未設定でも単一checkoutエントリならissueNumberを信頼してrootを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  const sha = gitRev(repo.dir);
  gitIn(repo.dir, ['checkout', '--detach', sha]);
  assert.equal(
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim(),
    'HEAD',
    '前提: detached HEAD状態を再現できていること',
  );

  const originalHeadRef = process.env.GITHUB_HEAD_REF;
  delete process.env.GITHUB_HEAD_REF;
  t.after(() => {
    if (originalHeadRef !== undefined) process.env.GITHUB_HEAD_REF = originalHeadRef;
  });

  // git worktree list --porcelain のエントリはこのroot自身1件のみ（linked worktree無し）。
  assert.equal(listWorktrees(repo.dir).length, 1, '前提: 単一checkoutエントリであること');

  const found = findIssueWorktree(repo.dir, config, '171');
  assert.ok(found, 'ブランチ名が一切判明しなくても単一checkoutエントリならissueNumberを信頼して見つかること');
  assert.equal(path.resolve(found!.path), path.resolve(repo.dir));
  assert.equal(found!.branch, undefined);
  assert.equal(found!.detached, true);
  assert.equal(found!.head, sha);
});

// resolveCurrentBranch / resolveCurrentBranchInfo は findIssueWorktree・verify branch-name・
// checkpoint が共有する「現在のブランチ名解決」ロジックの唯一の実装。detached HEAD状態を
// `git checkout --detach <sha>` で実際に再現し、GITHUB_HEAD_REF設定済み・未設定の両方を検証する。

test('resolveCurrentBranch/resolveCurrentBranchInfo: 通常チェックアウトでは実ブランチ名を返しdetached=falseになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);

  assert.equal(resolveCurrentBranch(repo.dir), 'feature/171-ci-gate-dogfood');
  const info = resolveCurrentBranchInfo(repo.dir);
  assert.deepEqual(info, { branch: 'feature/171-ci-gate-dogfood', detached: false });
});

test('resolveCurrentBranch/resolveCurrentBranchInfo: detached HEADかつGITHUB_HEAD_REF設定済みならそのブランチ名を返しdetached=trueになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  const sha = gitRev(repo.dir);
  gitIn(repo.dir, ['checkout', '--detach', sha]);
  assert.equal(
    execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim(),
    'HEAD',
    '前提: detached HEAD状態を再現できていること',
  );

  const originalHeadRef = process.env.GITHUB_HEAD_REF;
  process.env.GITHUB_HEAD_REF = 'feature/171-ci-gate-dogfood';
  t.after(() => {
    if (originalHeadRef === undefined) delete process.env.GITHUB_HEAD_REF;
    else process.env.GITHUB_HEAD_REF = originalHeadRef;
  });

  assert.equal(resolveCurrentBranch(repo.dir), 'feature/171-ci-gate-dogfood');
  const info = resolveCurrentBranchInfo(repo.dir);
  assert.deepEqual(info, { branch: 'feature/171-ci-gate-dogfood', detached: true });
});

test('resolveCurrentBranch/resolveCurrentBranchInfo: detached HEADかつGITHUB_HEAD_REF未設定ならbranchはundefinedのままdetached=trueになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  const sha = gitRev(repo.dir);
  gitIn(repo.dir, ['checkout', '--detach', sha]);

  const originalHeadRef = process.env.GITHUB_HEAD_REF;
  delete process.env.GITHUB_HEAD_REF;
  t.after(() => {
    if (originalHeadRef !== undefined) process.env.GITHUB_HEAD_REF = originalHeadRef;
  });

  assert.equal(resolveCurrentBranch(repo.dir), undefined);
  const info = resolveCurrentBranchInfo(repo.dir);
  assert.deepEqual(info, { branch: undefined, detached: true });
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
