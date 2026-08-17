import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { packageRoot, repoRoot, worktreeRoot, resolveAsset, ASSET_NAMESPACE } from '../../src/lib/paths.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/**
 * Issue #734: 「祖先に `.git` が一切存在しない起点」を、共有された `os.tmpdir()`（多くの環境で
 * `/tmp`）へ依存せずに作る。
 *
 * `os.tmpdir()` 配下に起点を置くと、遡上が必ず共有ディレクトリ自身を経由する。そこへ他プロセス
 * （同一 `npm test` 内の別テストファイル、別セッション、read-only の `/tmp/.git` を差し込む実行
 * サンドボックス等）が `.git` を作ると、この起点は「.git が見つからない」状態でなくなり、結果が
 * 実行順序・並列度・環境に依存して変わる。
 *
 * repoRoot() の遡上は `path.dirname` による純粋に字句的な操作で、途中ディレクトリの実在を要求
 * しない（実在しないパスの `.git` は lstat が失敗し「無し」と扱われる）。よってファイルシステム
 * ルート直下の一意な未使用名を基点にすれば、遡上が触れる祖先はその一意名配下（誰も作れない）と
 * ファイルシステムルートだけになり、共有一時ディレクトリの汚染から完全に切り離せる。
 */
function gitlessStartDir(): string {
  const fsRoot = path.parse(path.resolve(os.tmpdir())).root;
  const uniqueBase = path.join(fsRoot, `asc-issue734-gitless-${process.pid}-${randomUUID()}`);
  assert.equal(fs.existsSync(uniqueBase), false, `前提: ${uniqueBase} が実在しないこと`);
  return path.join(uniqueBase, 'x', 'y');
}

/** テストが共有一時ディレクトリへ `.git` 付きの残骸を溜めないよう、後始末を必ず登録する。 */
function makeTempDir(t: TestContext, prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('packageRoot: このworktree自身のルートを返す（package.jsonが存在する）', () => {
  const root = packageRoot();
  assert.equal(fs.existsSync(path.join(root, 'package.json')), true);
});

// 通常リポジトリ（.git がディレクトリ）での repoRoot() は Issue #185 の修正前後で
// 1バイトも変わらない（AC-2: regressionゼロ）。この2テストは実際に `.git` を
// ディレクトリとして作り、その回帰なし経路を検証する。
test('repoRoot: .git を含む祖先ディレクトリを、深い階層から呼んでも正しく返す（通常リポジトリ・regressionなし、AC-2）', (t) => {
  const tmp = makeTempDir(t, 'repo-root-test-');
  const gitRoot = path.join(tmp, 'proj');
  const deep = path.join(gitRoot, 'a', 'b', 'c');
  fs.mkdirSync(deep, { recursive: true });
  fs.mkdirSync(path.join(gitRoot, '.git'));

  const result = repoRoot(deep);
  assert.equal(result, gitRoot);
});

test('repoRoot: 起点ディレクトリ自身が .git を持つ場合はそのまま返す（通常リポジトリ・regressionなし、AC-2）', (t) => {
  const tmp = makeTempDir(t, 'repo-root-test-');
  fs.mkdirSync(path.join(tmp, '.git'));

  assert.equal(repoRoot(tmp), tmp);
});

test('repoRoot: .git がどこにも見つからない場合は例外を投げる（AC-2）', () => {
  const orphan = gitlessStartDir();

  // 遡上が触れる祖先のうち、このテストが所有しないのはファイルシステムルートだけ。root所有で
  // 通常の実行主体は書き込めないが、成立しなければ失敗理由が判るよう前提として明示検査する。
  assert.equal(
    fs.existsSync(path.join(path.parse(orphan).root, '.git')),
    false,
    '前提: ファイルシステムルート直下に .git が無いこと',
  );

  assert.throws(() => repoRoot(orphan), /\.git が見つかりません/);
});

// --- ここから Issue #185: git worktree（linked worktree）でのrepoRoot()/worktreeRoot() ---

/** 実際の `git init` + `git worktree add` で、メインの作業ツリーとlinked worktreeを1組作る。 */
function createRepoWithWorktree(): { mainRoot: string; worktreePath: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-root-worktree-test-'));
  const mainRoot = path.join(tmp, 'main');
  fs.mkdirSync(mainRoot, { recursive: true });
  git(mainRoot, ['init', '--initial-branch=main']);
  git(mainRoot, ['config', 'user.email', 'test@example.com']);
  git(mainRoot, ['config', 'user.name', 'agent-skill-chain test']);
  fs.writeFileSync(path.join(mainRoot, 'README.md'), '# fixture\n');
  git(mainRoot, ['add', '-A']);
  git(mainRoot, ['commit', '-m', 'chore: initial commit']);

  const worktreePath = path.join(tmp, 'wt');
  git(mainRoot, ['worktree', 'add', '-b', 'feature/1-sample', worktreePath, 'main']);

  return {
    mainRoot,
    worktreePath,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

test('repoRoot: linked worktree内から呼ぶとメイン作業ツリールートを返す（AC-1: worktree分裂の解消）', (t) => {
  const { mainRoot, worktreePath, cleanup } = createRepoWithWorktree();
  t.after(cleanup);

  // Given: .git がディレクトリの通常リポジトリ（mainRoot）と、そこから作った linked worktree
  //        （worktreePath。ルート直下の .git は `gitdir: <path>` を指す「ファイル」）。
  assert.equal(fs.statSync(path.join(worktreePath, '.git')).isDirectory(), false, '前提: linked worktreeの.gitはファイルであること');

  // When: worktree自身・その深いサブディレクトリの双方から repoRoot() を呼ぶ
  const deep = path.join(worktreePath, 'a', 'b');
  fs.mkdirSync(deep, { recursive: true });

  // Then: いずれもメイン作業ツリールート（mainRoot）を返す（worktree自身のパスではない）。
  assert.equal(repoRoot(worktreePath), mainRoot);
  assert.equal(repoRoot(deep), mainRoot);
});

test('repoRoot: メイン作業ツリーから呼んだ場合はそれ自身を返す（AC-1の前提: 両者が同一値を指すこと）', (t) => {
  const { mainRoot, worktreePath, cleanup } = createRepoWithWorktree();
  t.after(cleanup);

  // メインから呼んでもworktreeから呼んでも同一の基準ディレクトリ（mainRoot）を返すこと。
  assert.equal(repoRoot(mainRoot), mainRoot);
  assert.equal(repoRoot(worktreePath), repoRoot(mainRoot));
});

test('worktreeRoot: 現在いる作業ツリー自身のルートを返す（linked worktree内ではworktree自身、メインではメイン自身）', (t) => {
  const { mainRoot, worktreePath, cleanup } = createRepoWithWorktree();
  t.after(cleanup);

  assert.equal(worktreeRoot(worktreePath), worktreePath);
  assert.equal(worktreeRoot(mainRoot), mainRoot);

  // 深いサブディレクトリから呼んでも、そのworktree自身のルートを返す。
  const deep = path.join(worktreePath, 'a', 'b');
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(worktreeRoot(deep), worktreePath);
});

test('resolveAsset: root/.agent-skill-chain/<relativePath> が存在すればそちらを優先する', (t) => {
  const tmp = makeTempDir(t, 'resolve-asset-test-');
  const inRepoDir = path.join(tmp, ASSET_NAMESPACE, 'config');
  fs.mkdirSync(inRepoDir, { recursive: true });
  const inRepoFile = path.join(inRepoDir, 'agent-skill-chain.yaml');
  fs.writeFileSync(inRepoFile, 'dummy: true\n');

  const resolved = resolveAsset(path.join('config', 'agent-skill-chain.yaml'), tmp);
  assert.equal(resolved, inRepoFile);
});

test('resolveAsset: rootに無ければ packageRoot() 側のアセットへフォールバックする', (t) => {
  const tmp = makeTempDir(t, 'resolve-asset-test-');
  // root には .agent-skill-chain を一切作らない。

  const resolved = resolveAsset(path.join('config', 'agent-skill-chain.yaml'), tmp);
  const expected = path.join(packageRoot(), ASSET_NAMESPACE, 'config', 'agent-skill-chain.yaml');
  assert.equal(resolved, expected);
  assert.equal(fs.existsSync(resolved), true);
});

test('resolveAsset: rootにもpackageRootにも無ければ例外を投げる', (t) => {
  const tmp = makeTempDir(t, 'resolve-asset-test-');

  assert.throws(
    () => resolveAsset(path.join('config', 'does-not-exist-asset.yaml'), tmp),
    /アセットが見つかりません/,
  );
});
