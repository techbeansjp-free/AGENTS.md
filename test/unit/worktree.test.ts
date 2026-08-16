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
  resolveIssueWorktreeExactlyOne,
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

// PR #172 run 29717941752 で実落ち: agent-skill-chain-ci.yml が GITHUB_BASE_REF のブランチ自体を
// フェッチしていなかったため、defaultBranch() が返した素のブランチ名では
// `git diff <base>...HEAD` がref解決不能で失敗した（checkOutputExists('code', ...) が
// 誤って「成果物なし」と判定する）。ワークフロー側の修正（`git fetch origin "$BASE_REF" --depth=1`）
// を経ると `origin/<base>` というremote-trackingとして解決可能になるため、defaultBranch() は
// それを優先して返す必要がある。以下はその状態を実際のgit操作（bare remoteへのpush・
// 明示的なremote-trackingref削除でshallow checkout相当を再現→fetch）で検証する。
test('defaultBranch: GITHUB_BASE_REFのブランチが未フェッチのローカルrefでは解決不能でも、fetch後にorigin/<base>が解決可能になればそれを優先して返す（CI fetchステップ後を再現）', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const base = 'chore/162-agent-skill-chain-bootstrap';
  gitIn(repo.dir, ['checkout', '-b', base]);
  fs.writeFileSync(path.join(repo.dir, 'BASE_ONLY.md'), '# base\n');
  gitIn(repo.dir, ['add', '-A']);
  gitIn(repo.dir, ['commit', '-m', 'chore: base-only change']);
  gitIn(repo.dir, ['push', 'origin', base]);

  gitIn(repo.dir, ['checkout', '-b', 'feature/171-ci-gate-dogfood']);
  fs.mkdirSync(path.join(repo.dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'src', 'app.js'), 'console.log(1);\n');
  gitIn(repo.dir, ['add', '-A']);
  gitIn(repo.dir, ['commit', '-m', 'feat: add app.js']);
  gitIn(repo.dir, ['branch', '-D', 'main']);
  gitIn(repo.dir, ['branch', '-D', base]);
  // push した側のリポジトリは remote-tracking ref (origin/<base>) を自動更新してしまうため、
  // 「actions/checkout がPRのマージrefのみをフェッチしbaseブランチ自体は一切フェッチしていない」
  // 状態を明示的に再現するために削除する。
  gitIn(repo.dir, ['branch', '-rd', `origin/${base}`]);

  // 前提: main/master/base いずれのローカルrefも、origin/<base> のremote-trackingも存在しないこと
  assert.equal(gitOk(repo.dir, ['symbolic-ref', 'refs/remotes/origin/HEAD']), false);
  for (const candidate of ['main', 'master', base, `origin/${base}`]) {
    assert.equal(gitOk(repo.dir, ['rev-parse', '--verify', candidate]), false, `前提: ${candidate} refが存在しないこと`);
  }

  const original = process.env.GITHUB_BASE_REF;
  process.env.GITHUB_BASE_REF = base;
  t.after(() => {
    if (original === undefined) delete process.env.GITHUB_BASE_REF;
    else process.env.GITHUB_BASE_REF = original;
  });

  // フェッチ前: origin/<base> が解決不能なため、素のブランチ名へフォールバックする
  // （既存挙動を維持。実CIではこの状態で git diff base...HEAD が失敗し今回のバグを引き起こした）。
  assert.equal(defaultBranch(repo.dir), base);

  // ワークフロー修正後の挙動を再現: base branchを明示的にfetchする
  gitIn(repo.dir, ['fetch', 'origin', base, '--depth=1']);
  assert.equal(gitOk(repo.dir, ['rev-parse', '--verify', `origin/${base}`]), true, 'fetch後はorigin/<base>が解決可能になること');

  // フェッチ後: origin/<base> を優先して返す
  assert.equal(defaultBranch(repo.dir), `origin/${base}`);

  // その値で実際に git diff --stat base...HEAD が解決・成功することを検証する
  // （checkOutputExists('code', ...) が使う実際のコマンド）。
  const diff = execFileSync('git', ['diff', '--stat', `origin/${base}...HEAD`], { cwd: repo.dir, encoding: 'utf8' });
  assert.match(diff, /app\.js/);
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

// Issue #361: GitHubの「Squash and merge」でPRをマージすると、マージ後にリモートブランチが
// 自動削除される。この状態を実際のgit操作（push→squashマージ→リモートブランチ削除）で再現し、
// squashマージ済みにもかかわらず旧実装が「未push」と誤判定していたことの回帰を防ぐ。

test('hasUnpushedCommits: squashマージ後にリモートブランチが削除されてもPR head以降のcommitが無ければfalseになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/42-sample-slug';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-sample-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);

  fs.writeFileSync(path.join(worktreePath, 'NEW_FILE.md'), '# new\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add NEW_FILE.md']);
  gitIn(worktreePath, ['push', '-u', 'origin', branch]);
  const pushedHead = gitRev(worktreePath);

  // 前提: push直後はupstreamが解決可能で、hasUnpushedCommitsはfalse（ahead=0）
  assert.equal(hasUnpushedCommits(worktreePath, branch), false, '前提: push直後はfalse');

  // GitHubの「Squash and merge」相当の操作をmain側で再現する。
  gitIn(repo.dir, ['checkout', 'main']);
  gitIn(repo.dir, ['merge', '--squash', branch]);
  gitIn(repo.dir, ['commit', '-m', `feat: add NEW_FILE.md (squash #${branch})`]);
  gitIn(repo.dir, ['push', 'origin', 'main']);

  // GitHubのブランチ自動削除相当。この操作自体でローカルのremote-trackingブランチ
  // （refs/remotes/origin/<branch>）も失われ、branch@{upstream}がgone状態になる。
  gitIn(repo.dir, ['push', 'origin', '--delete', branch]);

  // 前提: upstreamが解決不能（gone）になっていること
  assert.equal(
    gitOk(worktreePath, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]),
    false,
    '前提: リモートブランチ削除後はbranch@{upstream}が解決不能であること',
  );

  // merge-base --is-ancestorではsquashマージを検出できないこと自体も前提として確認する
  // （祖先関係にならない。tree hash比較フォールバックが必須であることを裏付けるための前提確認）。
  assert.equal(
    gitOk(worktreePath, ['merge-base', '--is-ancestor', branch, 'main']),
    false,
    '前提: squashマージは祖先関係にならないこと',
  );

  assert.equal(
    hasUnpushedCommits(worktreePath, branch, pushedHead),
    false,
    'squashマージで内容が統合済みならupstream goneでもfalseになること',
  );
});

test('hasUnpushedCommits: default branchが別変更で前進した後のsquash mergeもPR headによりfalseになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/692-squash-after-base-advance';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-692-squash-after-base-advance`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);

  fs.writeFileSync(path.join(worktreePath, 'FIRST.md'), '# first\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add FIRST.md']);
  fs.writeFileSync(path.join(worktreePath, 'SECOND.md'), '# second\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add SECOND.md']);
  gitIn(worktreePath, ['push', '-u', 'origin', branch]);
  const pushedHead = gitRev(worktreePath);

  fs.writeFileSync(path.join(repo.dir, 'CONCURRENT.md'), '# concurrent\n');
  gitIn(repo.dir, ['add', '-A']);
  gitIn(repo.dir, ['commit', '-m', 'chore: advance main']);
  gitIn(repo.dir, ['merge', '--squash', branch]);
  gitIn(repo.dir, ['commit', '-m', 'feat: squash feature branch']);
  gitIn(repo.dir, ['push', 'origin', 'main']);
  gitIn(repo.dir, ['push', 'origin', '--delete', branch]);

  assert.equal(gitOk(worktreePath, ['merge-base', '--is-ancestor', branch, 'main']), false);
  assert.notEqual(
    execFileSync('git', ['rev-parse', `${branch}^{tree}`], { cwd: worktreePath, encoding: 'utf8' }).trim(),
    execFileSync('git', ['rev-parse', 'main^{tree}'], { cwd: worktreePath, encoding: 'utf8' }).trim(),
    '前進分により既存のtree一致判定は成立しないこと',
  );
  assert.equal(hasUnpushedCommits(worktreePath, branch, pushedHead), false);
});

test('hasUnpushedCommits: merge commit方式で統合済みなupstream goneブランチはfalseになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/692-merge-commit';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-692-merge-commit`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);
  fs.writeFileSync(path.join(worktreePath, 'MERGED.md'), '# merged\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add MERGED.md']);
  gitIn(worktreePath, ['push', '-u', 'origin', branch]);

  gitIn(repo.dir, ['merge', '--no-ff', '-m', 'merge feature branch', branch]);
  gitIn(repo.dir, ['push', 'origin', 'main']);
  gitIn(repo.dir, ['push', 'origin', '--delete', branch]);

  assert.equal(gitOk(worktreePath, ['merge-base', '--is-ancestor', branch, 'main']), true);
  assert.equal(hasUnpushedCommits(worktreePath, branch), false);
});

test('hasUnpushedCommits: rebase merge方式でSHAが変わった統合済みブランチはfalseになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/692-rebase-merge';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-692-rebase-merge`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);
  fs.writeFileSync(path.join(worktreePath, 'FIRST.md'), '# first\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add FIRST.md']);
  fs.writeFileSync(path.join(worktreePath, 'SECOND.md'), '# second\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add SECOND.md']);
  gitIn(worktreePath, ['push', '-u', 'origin', branch]);
  const originalCommits = execFileSync('git', ['rev-list', '--reverse', `main..${branch}`], {
    cwd: repo.dir,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');

  fs.writeFileSync(path.join(repo.dir, 'CONCURRENT.md'), '# concurrent\n');
  gitIn(repo.dir, ['add', '-A']);
  gitIn(repo.dir, ['commit', '-m', 'chore: advance main']);
  gitIn(repo.dir, ['cherry-pick', ...originalCommits]);
  gitIn(repo.dir, ['push', 'origin', 'main']);
  gitIn(repo.dir, ['push', 'origin', '--delete', branch]);

  assert.equal(gitOk(worktreePath, ['merge-base', '--is-ancestor', branch, 'main']), false);
  assert.equal(hasUnpushedCommits(worktreePath, branch, originalCommits.at(-1)), false);
});

test('hasUnpushedCommits: upstreamがgone状態でもdefault branchへ未統合の内容が残っていればtrueのままになる', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/42-sample-slug';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-sample-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);

  fs.writeFileSync(path.join(worktreePath, 'FIRST.md'), '# first\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add FIRST.md']);
  gitIn(worktreePath, ['push', '-u', 'origin', branch]);

  // FIRST.md分だけsquashマージしてリモートブランチを削除する（gone状態を作る）。
  gitIn(repo.dir, ['checkout', 'main']);
  gitIn(repo.dir, ['merge', '--squash', branch]);
  gitIn(repo.dir, ['commit', '-m', 'feat: add FIRST.md (squash)']);
  gitIn(repo.dir, ['push', 'origin', 'main']);
  gitIn(repo.dir, ['push', 'origin', '--delete', branch]);

  // マージされていない2つ目のコミットをブランチへ積む（default branchへ未統合）。
  fs.writeFileSync(path.join(worktreePath, 'SECOND.md'), '# second\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add SECOND.md']);

  assert.equal(
    hasUnpushedCommits(worktreePath, branch),
    true,
    '未統合の内容が残る場合はupstream goneでも安全側でtrueのままであること',
  );
});

test('hasUnpushedCommits: squash merge後の空白だけのローカル限定commitも統合済みと誤判定しない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/692-unpushed-whitespace';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-692-unpushed-whitespace`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);
  fs.writeFileSync(path.join(worktreePath, 'CONTENT.md'), 'value with space\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add CONTENT.md']);
  gitIn(worktreePath, ['push', '-u', 'origin', branch]);

  gitIn(repo.dir, ['merge', '--squash', branch]);
  gitIn(repo.dir, ['commit', '-m', 'feat: squash CONTENT.md']);
  gitIn(repo.dir, ['push', 'origin', 'main']);
  gitIn(repo.dir, ['push', 'origin', '--delete', branch]);

  fs.writeFileSync(path.join(worktreePath, 'CONTENT.md'), 'value  with space\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'fix: preserve significant whitespace']);

  assert.equal(hasUnpushedCommits(worktreePath, branch), true, '空白差分を含むローカル限定commitは削除から保護すること');
});

test('hasUnpushedCommits: squash済みpathのローカル限定変更とrevertをPR headとの内容一致で見逃さない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/692-same-path-revert';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-692-same-path-revert`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);
  fs.writeFileSync(path.join(worktreePath, 'CONTENT.md'), 'pushed\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add pushed content']);
  gitIn(worktreePath, ['push', '-u', 'origin', branch]);
  const pushedHead = gitRev(worktreePath);

  gitIn(repo.dir, ['merge', '--squash', branch]);
  gitIn(repo.dir, ['commit', '-m', 'feat: squash pushed content']);
  gitIn(repo.dir, ['push', 'origin', 'main']);
  gitIn(repo.dir, ['push', 'origin', '--delete', branch]);

  fs.writeFileSync(path.join(worktreePath, 'CONTENT.md'), 'local only\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'test: change squashed path locally']);
  gitIn(worktreePath, ['revert', '--no-edit', 'HEAD']);

  assert.equal(hasUnpushedCommits(worktreePath, branch, pushedHead), true);
});

test('hasUnpushedCommits: 実remoteで削除済みの古いremote-tracking refをpush済み根拠にしない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());

  const branch = 'feature/692-stale-remote-ref';
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-692-stale-remote-ref`);
  gitIn(repo.dir, ['worktree', 'add', '-b', branch, worktreePath, 'main']);
  fs.writeFileSync(path.join(worktreePath, 'CONTENT.md'), 'pushed once\n');
  gitIn(worktreePath, ['add', '-A']);
  gitIn(worktreePath, ['commit', '-m', 'feat: add pushed content']);
  gitIn(worktreePath, ['push', '-u', 'origin', branch]);

  execFileSync('git', ['--git-dir', repo.remoteDir, 'update-ref', '-d', `refs/heads/${branch}`], { stdio: 'pipe' });
  assert.equal(gitOk(worktreePath, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`]), true);
  assert.equal(gitOk(worktreePath, ['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`]), false);
  assert.equal(hasUnpushedCommits(worktreePath, branch), true);
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

test('resolveIssueWorktreeExactlyOne: 命名パターンに一致するworktreeが1件ならfoundを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);
  const worktreePath = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-sample-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'feature/42-sample-slug', worktreePath, 'main']);

  const result = resolveIssueWorktreeExactlyOne(repo.dir, config, '42');

  assert.equal(result.status, 'found');
  if (result.status === 'found') assert.equal(path.resolve(result.worktree.path), path.resolve(worktreePath));
});

test('resolveIssueWorktreeExactlyOne: 命名パターン0件でも現在branchが一致すればフォールバックをfoundへ変換する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);
  gitIn(repo.dir, ['checkout', '-b', 'feature/42-ci-checkout']);

  const result = resolveIssueWorktreeExactlyOne(repo.dir, config, '42');

  assert.equal(result.status, 'found');
  if (result.status === 'found') assert.equal(path.resolve(result.worktree.path), path.resolve(repo.dir));
});

test('resolveIssueWorktreeExactlyOne: 命名パターンもbranchフォールバックも一致しなければnot_foundを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);

  assert.deepEqual(resolveIssueWorktreeExactlyOne(repo.dir, config, '42'), { status: 'not_found' });
});

test('resolveIssueWorktreeExactlyOne: 同一issueのworktreeが2件なら候補パス付きambiguousを返す', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);
  const first = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-first-slug`);
  const second = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-bugfix-42-second-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'feature/42-first-slug', first, 'main']);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'bugfix/42-second-slug', second, 'main']);

  const result = resolveIssueWorktreeExactlyOne(repo.dir, config, '42');

  assert.equal(result.status, 'ambiguous');
  if (result.status === 'ambiguous') {
    assert.deepEqual(
      result.candidatePaths.map((candidate) => path.resolve(candidate)).sort(),
      [first, second].map((candidate) => path.resolve(candidate)).sort(),
    );
  }
});

test('resolveIssueWorktreeExactlyOne: prunableな同issueエントリは候補から除外する', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);
  const active = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-42-active-slug`);
  const stale = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-bugfix-42-stale-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'feature/42-active-slug', active, 'main']);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'bugfix/42-stale-slug', stale, 'main']);
  fs.rmSync(stale, { recursive: true, force: true });
  assert.equal(
    listWorktrees(repo.dir).find((entry) => path.resolve(entry.path) === path.resolve(stale))?.prunable,
    true,
    '前提: 削除したworktreeがprunableとして列挙されること',
  );

  const result = resolveIssueWorktreeExactlyOne(repo.dir, config, '42');

  assert.equal(result.status, 'found');
  if (result.status === 'found') assert.equal(path.resolve(result.worktree.path), path.resolve(active));
});

test('resolveIssueWorktreeExactlyOne: prunableエントリ併存時はCI単一checkoutフォールバックを発火させない', (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const config = loadConfig(repo.dir);
  const stale = path.join(repo.dir, '.worktrees', `${FIXED_TIMESTAMP}-feature-99-stale-slug`);
  gitIn(repo.dir, ['worktree', 'add', '-b', 'feature/99-stale-slug', stale, 'main']);
  fs.rmSync(stale, { recursive: true, force: true });

  const sha = gitRev(repo.dir);
  gitIn(repo.dir, ['checkout', '--detach', sha]);
  const originalHeadRef = process.env.GITHUB_HEAD_REF;
  delete process.env.GITHUB_HEAD_REF;
  t.after(() => {
    if (originalHeadRef !== undefined) process.env.GITHUB_HEAD_REF = originalHeadRef;
  });

  const entries = listWorktrees(repo.dir);
  assert.equal(entries.length, 2, '前提: rootとprunableな管理エントリが列挙されること');
  assert.equal(
    entries.find((entry) => path.resolve(entry.path) === path.resolve(stale))?.prunable,
    true,
    '前提: 実体を削除したworktreeがprunableであること',
  );

  assert.deepEqual(resolveIssueWorktreeExactlyOne(repo.dir, config, '42'), { status: 'not_found' });
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
