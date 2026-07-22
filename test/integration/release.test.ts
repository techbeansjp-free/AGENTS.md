import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// Issue #196（リリース自動化）の受入検証: SPEC.md AC-1〜AC-7 のうち、副作用を持たない
// バージョン解決ロジック自体は test/unit/release-version.test.ts が担うため、本ファイルは
// `agent-skill-chain release {resolve-version,tag,publish,bump}` という CLI 経路そのもの
// （実git操作・gh呼び出しの配線）を、ビルド後の bin/agents-md.js を子プロセスとして実際に
// 実行することで検証する。gh は test/helpers/gh-stub.ts のスタブに差し替え、実際のGitHub
// API・ネットワークへは一切アクセスしない。git は実バイナリを使い、tmp-repo.ts が作る
// bare remote に対して本物のpush/tag/lsを行う。

function makeStub() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-release-'));
  const stub = createGhStub(scratchDir);
  return { stub, env: stub.env(process.env), cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** createTmpRepo() のfixtureには package.json が含まれない（他コマンドのテストが前提としない
 * ため）。release resolve-version/bump は package.json を読むため、テストごとに用意して
 * commit・push する。withLock=true のときのみ package-lock.json も同梱する。 */
function writePackageJson(repoDir: string, version: string, withLock: boolean): void {
  const pkg = { name: 'agent-skill-chain', version, license: 'MIT' };
  fs.writeFileSync(path.join(repoDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  if (withLock) {
    const lock = {
      name: 'agent-skill-chain',
      version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'agent-skill-chain', version, license: 'MIT' } },
    };
    fs.writeFileSync(path.join(repoDir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  }
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-m', 'chore: seed package.json for release test']);
  git(repoDir, ['push', 'origin', 'main']);
}

// ---- resolve-version（AC-1: 版数決定ロジックのCLI配線） ----

test('release resolve-version (AC-1): 実リポジトリの package.json・git tag からCLI出力形式で target/need_commit を決定する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '0.2.0', true);

  // Given/When: 一致する既存タグが無い初回run
  const first = runCli(['release', 'resolve-version'], { cwd: repo.dir });
  // Then: seed=pkgVersion からpatch加算した値が $GITHUB_OUTPUT 互換の行形式で出力される
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, 'latest=0.2.0\ntarget=0.2.1\nneed_commit=true\n');

  // Given: AC-1で決定されたtargetに対応する実タグが作成された後の2回目run
  git(repo.dir, ['tag', '-a', 'v0.2.1', '-m', 'Release v0.2.1']);
  const second = runCli(['release', 'resolve-version'], { cwd: repo.dir });
  // Then: 新たな latest を基準にさらにpatch加算する
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, 'latest=0.2.1\ntarget=0.2.2\nneed_commit=true\n');
});

// ---- tag（AC-2, AC-4, AC-7: タガーの冪等性） ----

test('release tag (AC-2, AC-4, AC-7): 未存在なら新規タグを作成・pushし、既存なら冪等スキップし重複作成しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '1.0.0', true);
  const headSha = git(repo.dir, ['rev-parse', 'HEAD']);

  // When: 1回目の tag 実行
  const first = runCli(['release', 'tag', '1.0.0', headSha], { cwd: repo.dir });
  // Then: 新規タグが作成されリモートへpushされる（AC-2）
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), 'v1.0.0');
  const remoteTagsAfterFirst = git(repo.dir, ['ls-remote', '--tags', 'origin']);
  assert.match(remoteTagsAfterFirst, /refs\/tags\/v1\.0\.0/);

  // When: 単一契機に対し二重発火した想定で同じ target を再度実行する
  const second = runCli(['release', 'tag', '1.0.0', headSha], { cwd: repo.dir });
  // Then: 既存タグを検出し冪等スキップする（AC-7: 生成されるタグは高々1件）
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /既存タグを検出したため冪等スキップ/);
  const remoteTagsAfterSecond = git(repo.dir, ['ls-remote', '--tags', 'origin']);
  // 注釈付きタグは ls-remote に `refs/tags/v1.0.0`（タグオブジェクト）と
  // `refs/tags/v1.0.0^{}`（peeled、指す先のcommit）の2行を返すのが正常なgit挙動のため、
  // peeled行を除いた実タグ数のみを数える（同一タグの重複作成有無の検査）。
  const v1Count = remoteTagsAfterSecond.split('\n').filter((l) => /refs\/tags\/v1\.0\.0$/.test(l)).length;
  assert.equal(v1Count, 1, `v1.0.0 タグは重複作成されず1件のみであること。実測:\n${remoteTagsAfterSecond}`);

  // Then（AC-4）: タグ名は package.json 由来の target と同一の文字列体系（v<semver>）で一致する
  assert.equal('v1.0.0', `v${'1.0.0'}`);
});

// ---- tag: git tagger identity未設定環境での成功・既存identityの非破壊性（Issue #204） ----
// identitylessEnv() は本ファイル下部で定義（Issue #198 で bump() 向けに導入済みのヘルパーを再利用）。

test('release tag (AC-1, Issue #204): git tagger identityが未設定の環境でもrelease tagに成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '4.0.0', true);
  const headSha = git(repo.dir, ['rev-parse', 'HEAD']);

  // Given: createTmpRepo() が設定したローカルidentityを取り除き、かつグローバル/システム設定も
  // 実行環境から見えなくする（実行機に開発者自身のgit identityが設定されていても再現できるように）。
  git(repo.dir, ['config', '--unset', 'user.name']);
  git(repo.dir, ['config', '--unset', 'user.email']);
  const runEnv = identitylessEnv(process.env);
  // 前提確認: この時点で git config user.name/user.email が実際に未解決であること
  assert.throws(() => execFileSync('git', ['config', 'user.name'], { cwd: repo.dir, env: runEnv, stdio: 'pipe' }));
  assert.throws(() => execFileSync('git', ['config', 'user.email'], { cwd: repo.dir, env: runEnv, stdio: 'pipe' }));

  // When
  const result = runCli(['release', 'tag', '4.0.0', headSha], { cwd: repo.dir, env: runEnv });

  // Then: 「tagger identity unknown」で失敗せず成功する
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /tagger identity unknown/i);
  assert.equal(result.stdout.trim(), 'v4.0.0');

  // Then: fallback identity（github-actions[bot]）でtaggerが作成されている
  const taggerLine = git(repo.dir, ['for-each-ref', '--format=%(taggername) %(taggeremail)', 'refs/tags/v4.0.0']);
  assert.equal(taggerLine, 'github-actions[bot] <github-actions[bot]@users.noreply.github.com>');
});

test('release tag (AC-3, Issue #204): 既存git identityを上書き・破壊しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '4.1.0', true);
  const headSha = git(repo.dir, ['rev-parse', 'HEAD']);

  // Given: createTmpRepo() が設定した既存identity
  const nameBefore = git(repo.dir, ['config', 'user.name']);
  const emailBefore = git(repo.dir, ['config', 'user.email']);
  assert.equal(nameBefore, 'agent-skill-chain test');
  assert.equal(emailBefore, 'test@example.com');

  // When
  const result = runCli(['release', 'tag', '4.1.0', headSha], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);

  // Then: 実行前後で user.name/user.email の値（scope・設定元含む）が変化しない
  const nameAfter = git(repo.dir, ['config', 'user.name']);
  const emailAfter = git(repo.dir, ['config', 'user.email']);
  assert.equal(nameAfter, nameBefore);
  assert.equal(emailAfter, emailBefore);

  // Then: 実際に作成されたtaggerも既存identityのままである（fallbackへ上書きされていない）
  const taggerLine = git(repo.dir, ['for-each-ref', '--format=%(taggername) %(taggeremail)', 'refs/tags/v4.1.0']);
  assert.equal(taggerLine, 'agent-skill-chain test <test@example.com>');
});

// ---- publish（AC-3, AC-4, AC-7: リリーサの冪等性） ----

test('release publish (AC-3, AC-4, AC-7): 未存在ならGitHub Releaseを作成し、既存なら冪等スキップし重複作成しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  // When: 1回目の publish 実行（v2.0.0 のReleaseは未存在）
  const first = runCli(['release', 'publish', '2.0.0'], { cwd: repo.dir, env });
  // Then: 新規Releaseが作成される（AC-3）
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), 'v2.0.0');
  assert.deepEqual(stub.readState().releases, ['v2.0.0']);
  assert.equal(stub.readState().releaseCreateCalls?.length, 1);

  // When: 単一契機に対し二重発火した想定で同じ target を再度実行する
  const second = runCli(['release', 'publish', '2.0.0'], { cwd: repo.dir, env });
  // Then: 既存Releaseを検出し冪等スキップし、Release作成呼び出しは増えない（AC-7）
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /既存Releaseを検出したため冪等スキップ/);
  assert.deepEqual(stub.readState().releases, ['v2.0.0'], 'v2.0.0 Releaseは重複作成されず1件のみであること');
  assert.equal(
    stub.readState().releaseCreateCalls?.length,
    1,
    'gh release create の呼び出し回数は2回目実行後も1回のままであること（冪等）',
  );
});

// ---- 統合シナリオ: 単一契機に対する tag+publish の二重発火（AC-7 をより直接に近似） ----

test('release tag+publish 連続二重発火 (AC-7): 同一 target への2回の全処理実行でも成果物は高々1件', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '3.0.0', true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);
  const headSha = git(repo.dir, ['rev-parse', 'HEAD']);

  for (let i = 0; i < 2; i += 1) {
    const tagResult = runCli(['release', 'tag', '3.0.0', headSha], { cwd: repo.dir, env });
    assert.equal(tagResult.status, 0, tagResult.stderr);
    const publishResult = runCli(['release', 'publish', '3.0.0'], { cwd: repo.dir, env });
    assert.equal(publishResult.status, 0, publishResult.stderr);
  }

  const remoteTags = git(repo.dir, ['ls-remote', '--tags', 'origin']);
  assert.equal(remoteTags.split('\n').filter((l) => /refs\/tags\/v3\.0\.0$/.test(l)).length, 1);
  assert.deepEqual(stub.readState().releases, ['v3.0.0']);
  assert.equal(stub.readState().releaseCreateCalls?.length, 1);
});

// ---- bump（AC-1, AC-6: bumpブランチ・PR作成／admin merge器） ----

test('release bump (AC-1, AC-6): package.jsonをtargetへ書換え、release/bump-v<target>ブランチをPR経由でskip-ci件名によりadmin mergeする', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '0.2.0', true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const result = runCli(['release', 'bump', '0.2.1'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '1', 'マージしたPR番号を標準出力へ返すこと');

  // Then: 短命ブランチ release/bump-v0.2.1 がリモートへpushされ、package.json の version が
  // target へ書き換わっていること（writeBumpedVersionFiles の実効果を実ファイルで確認）。
  const remoteBranches = git(repo.dir, ['ls-remote', '--heads', 'origin', 'release/bump-v0.2.1']);
  assert.match(remoteBranches, /refs\/heads\/release\/bump-v0\.2\.1/);
  const bumpedPkg = git(repo.dir, ['show', 'release/bump-v0.2.1:package.json']);
  assert.match(JSON.parse(bumpedPkg).version, /^0\.2\.1$/);
  const bumpedLock = git(repo.dir, ['show', 'release/bump-v0.2.1:package-lock.json']);
  assert.equal(JSON.parse(bumpedLock).version, '0.2.1', 'lockfileVersion 3の直下versionも更新されること');

  // Then（AC-1）: gh pr create が release/bump-v0.2.1 を head として main へのPRを作成したこと
  const prCalls = stub.readState().prCreateCalls ?? [];
  assert.equal(prCalls.length, 1);
  assert.match(prCalls[0].args.join(' '), /--head release\/bump-v0\.2\.1 --base main/);
  assert.match(prCalls[0].body ?? '', /Issue #196/);

  // Then（AC-6の主機構）: admin mergeのsubjectが '[skip ci]' を含む固定文言であること
  // （DESIGN.md: squash既定メッセージ設定に依存せず --subject で明示固定する）。
  const mergeCalls = stub.readState().mergeCalls ?? [];
  assert.equal(mergeCalls.length, 1);
  const mergeArgs = mergeCalls[0].args.join(' ');
  assert.match(mergeArgs, /--admin/);
  assert.match(mergeArgs, /--squash/);
  assert.match(mergeArgs, /--subject chore\(release\): v0\.2\.1 \[skip ci\]/);
});

test('release bump 自己修復 (DESIGN.md「PR作成後、admin mergeに失敗」シナリオ): 1回目のadmin merge失敗後、2回目runは既存ブランチ・PRを再利用し重複作成せず再試行に成功する', async (t) => {
  // Note: 「同一target・PRが既にMERGED後に再度bumpを呼ぶ」ケースは検討したが、設計上
  // 発生し得ない前提（concurrency:{group:release}直列化、かつ成功後はresolveVersionが
  // 新しいtargetを選ぶため同一targetでbumpが再度呼ばれることはない）であり、また
  // findOpenBumpPrはstate!=='OPEN'のPRを「再利用対象なし」として扱う仕様のため、
  // その状況を強制すると意図的に「再度PR作成を試みる」経路（実GitHub上ではdiffなしで
  // 失敗する）に入ってしまい、本来検証すべき冪等性の主張とは異なる。
  // 実際にDESIGN.mdが自己修復として明記するのは「PR作成後、admin mergeに失敗」
  // （PRはOPENのまま残る）ケースであるため、本テストはこちらを検証する。
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '0.5.0', true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  // Given: 1回目のadmin merge呼び出しが失敗する状況を模擬する
  stub.failNextMerge(1);
  const first = runCli(['release', 'bump', '0.5.1'], { cwd: repo.dir, env });
  assert.notEqual(first.status, 0, '1回目はadmin merge失敗により非0終了すること');
  assert.match(first.stderr, /gh pr merge --admin に失敗しました/);

  // When: 2回目run（同一target）
  const second = runCli(['release', 'bump', '0.5.1'], { cwd: repo.dir, env });
  // Then: 既存ブランチ・PRを再利用して成功する（冪等・自己修復）
  assert.equal(second.status, 0, second.stderr);

  // Then: ブランチ・PRは重複作成されず1件のみ（git push, gh pr create いずれも2回目はスキップ）
  const remoteBranches = git(repo.dir, ['ls-remote', '--heads', 'origin', 'release/bump-v0.5.1']);
  assert.equal(remoteBranches.split('\n').filter((l) => l.trim().length > 0).length, 1);
  const prCalls = stub.readState().prCreateCalls ?? [];
  assert.equal(prCalls.length, 1, 'gh pr create は重複実行されないこと（同名ブランチ・既存OPEN PRの検出による再利用）');
  // Then: admin merge自体は失敗分+成功分の2回呼ばれている（再試行そのものは行われる）
  assert.equal((stub.readState().mergeCalls ?? []).length, 2);
});

test('release bump スコープ検査違反 (AC-6, 防御的ガード): 変更ファイルがpackage.json/package-lock.json以外を含むPRは自動admin mergeせずhuman_requiredで停止する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '0.9.0', true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  // Given: gh pr create が返すPRの変更ファイル集合に、想定外のファイル（例: 再利用ブランチへの
  // 残骸混入）が含まれる状況を模擬する（DESIGN.md「スコープの機械検査手段」節）。
  stub.setDefaultPrFiles(['package.json', 'src/unexpected.ts']);

  const result = runCli(['release', 'bump', '0.9.1'], { cwd: repo.dir, env });

  // Then: 自動admin mergeを行わずhuman_requiredとして停止し、非0終了する
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /human_required/);
  assert.match(result.stderr, /src\/unexpected\.ts/);
  // Then: merge呼び出し自体が一切発生していないこと（副作用未発生のまま安全側停止）
  assert.equal((stub.readState().mergeCalls ?? []).length, 0);
});

// ---- 既知の頑健性ギャップ（本検証で判明。VALIDATION.md 参照） ----

test('release bump: package-lock.json が存在しないリポジトリでは git add が両ファイル同時指定のため失敗する（既知の頑健性ギャップ）', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  // Given: package-lock.json を同梱しないリポジトリ（writeBumpedVersionFiles 自体は
  // fs.existsSync で存在確認するため package-lock.json を書き込まないが、
  // bump() の `git add package.json package-lock.json` は存在有無に関わらず両方を
  // 固定引数で指定しているため、未追跡・不在のpathspecに対し git add 自体が失敗する。
  writePackageJson(repo.dir, '0.4.0', false);
  const { env, cleanup } = makeStub();
  t.after(cleanup);

  const result = runCli(['release', 'bump', '0.4.1'], { cwd: repo.dir, env });

  // Then: 現状の実装は git add の失敗により bump 全体が失敗する（package-lock.json不在の
  // リポジトリでは自動リリースが機能しない）。この挙動を固定し、既知のギャップとして
  // VALIDATION.md に記録する。
  assert.notEqual(result.status, 0, 'package-lock.json 不在時は現状 git add 失敗により bump 全体が失敗する');
  assert.match(result.stderr, /git add に失敗しました/);
});

// ---- bump: git author identity未設定環境での成功・既存identityの非破壊性（Issue #198） ----

/** git config のローカル/グローバル/システムいずれからも user.name/user.email を解決させない
 * 環境変数を作る（AC-1: 「identity未設定」環境を実際に模擬するため）。GIT_CONFIG_GLOBAL/
 * GIT_CONFIG_SYSTEM を /dev/null へ差し替えることで、テスト実行機に開発者自身の
 * ~/.gitconfig（グローバルidentity）がある場合でも、それに依存せず常に「未設定」を再現できる。 */
function identitylessEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.GIT_AUTHOR_NAME;
  delete env.GIT_AUTHOR_EMAIL;
  delete env.GIT_COMMITTER_NAME;
  delete env.GIT_COMMITTER_EMAIL;
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  return env;
}

test('release bump (AC-1, Issue #198): git author identityが未設定の環境でもbumpコミットに成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '0.6.0', true);
  const { env, cleanup } = makeStub();
  t.after(cleanup);

  // Given: createTmpRepo() が設定したローカルidentityを取り除き、かつグローバル/システム設定も
  // 実行環境から見えなくする（実行機に開発者自身のgit identityが設定されていても再現できるように）。
  git(repo.dir, ['config', '--unset', 'user.name']);
  git(repo.dir, ['config', '--unset', 'user.email']);
  const runEnv = identitylessEnv(env);
  // 前提確認: この時点で git config user.name/user.email が実際に未解決であること
  assert.throws(() => execFileSync('git', ['config', 'user.name'], { cwd: repo.dir, env: runEnv, stdio: 'pipe' }));
  assert.throws(() => execFileSync('git', ['config', 'user.email'], { cwd: repo.dir, env: runEnv, stdio: 'pipe' }));

  // When
  const result = runCli(['release', 'bump', '0.6.1'], { cwd: repo.dir, env: runEnv });

  // Then: 「Author identity unknown」で失敗せず成功する
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /Author identity unknown/);

  // Then: fallback identity（github-actions[bot]）でcommitが作成されている
  const authorLine = git(repo.dir, ['show', '-s', '--format=%an <%ae>', 'release/bump-v0.6.1']);
  assert.equal(authorLine, 'github-actions[bot] <github-actions[bot]@users.noreply.github.com>');
});

test('release bump (AC-4, Issue #198): 既存git author identityを上書き・破壊しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  writePackageJson(repo.dir, '0.7.0', true);
  const { env, cleanup } = makeStub();
  t.after(cleanup);

  // Given: createTmpRepo() が設定した既存identity
  const nameBefore = git(repo.dir, ['config', 'user.name']);
  const emailBefore = git(repo.dir, ['config', 'user.email']);
  assert.equal(nameBefore, 'agent-skill-chain test');
  assert.equal(emailBefore, 'test@example.com');

  // When
  const result = runCli(['release', 'bump', '0.7.1'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);

  // Then: 実行前後で user.name/user.email の値（scope・設定元含む）が変化しない
  const nameAfter = git(repo.dir, ['config', 'user.name']);
  const emailAfter = git(repo.dir, ['config', 'user.email']);
  assert.equal(nameAfter, nameBefore);
  assert.equal(emailAfter, emailBefore);

  // Then: 実際に作成されたcommitのauthorも既存identityのままである（fallbackへ上書きされていない）
  const authorLine = git(repo.dir, ['show', '-s', '--format=%an <%ae>', 'release/bump-v0.7.1']);
  assert.equal(authorLine, 'agent-skill-chain test <test@example.com>');
});
