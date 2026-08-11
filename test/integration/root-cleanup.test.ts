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

/** repoRoot直下（repoDir自身）に対象ファイルを作成し、現在チェックアウト中のブランチ（既定は
 * main、default branchがmain以外のテストではそのブランチ）へcommit・pushする（「squash mergeの
 * たびに前Issueの成果物がdefault branchルート直下へ恒久混入する」状態の再現）。 */
function writeStrayArtifacts(repoDir: string, files: string[]): void {
  for (const file of files) {
    fs.writeFileSync(path.join(repoDir, file), `# ${file}\n\nstray root artifact\n`);
  }
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-m', 'chore: simulate merged issue segment artifacts at repo root']);
  git(repoDir, ['push', 'origin', 'HEAD']);
}

function extractHeadBranch(args: string[]): string | undefined {
  const i = args.indexOf('--head');
  return i === -1 ? undefined : args[i + 1];
}

function currentBranch(repoDir: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
}

/** ISSUE-619 AC（復元失敗時のfail-closed）検証用: `git push` 完了直後（=
 * performCleanupBranch内のpush成功後、restoreCheckoutState呼び出し前）に、ローカルの
 * branchToDelete参照とその remote-tracking 参照を両方消し、`git checkout <branchToDelete>` が
 * どのrefにも解決できず実際に失敗する状況を再現する（ローカル参照のみを消すと、git checkoutは
 * リモート追跡ブランチから新規ローカルブランチを暗黙作成するフォールバックで復元に成功してしまう
 * ため、両方を消す必要がある）。 */
function installPrePushHookDeletingBranch(repoDir: string, branchToDelete: string): void {
  const hooksDir = path.join(repoDir, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-push');
  fs.writeFileSync(
    hookPath,
    `#!/bin/sh\ngit branch -D ${branchToDelete} || true\ngit update-ref -d refs/remotes/origin/${branchToDelete} || true\nexit 0\n`,
    { mode: 0o755 },
  );
}

/** 指定refから見た pushed cleanup branch上でのファイル存在有無を確認する（ISSUE-619: 復元により
 * ローカルのチェックアウトは実行前の状態＝削除前へ戻るため、実際の削除自体はpushされた一時
 * ブランチの内容で検証する）。 */
function remoteBranchHasFile(remoteDir: string, ref: string, file: string): boolean {
  try {
    execFileSync('git', ['--git-dir', remoteDir, 'cat-file', '-e', `${ref}:${file}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** ISSUE-628: pushされた短命ブランチが `from` からどのファイルを変更しているかを実際のgit差分
 * （bare remote上）から取得する。gh-stubの `setDefaultPrFiles` 固定値ではなく、実際に push された
 * 内容そのものを検証するために使う。 */
function remoteDiffFiles(remoteDir: string, from: string, to: string): string[] {
  const out = execFileSync('git', ['--git-dir', remoteDir, 'diff', '--name-only', `${from}..${to}`], {
    encoding: 'utf8',
  }).trim();
  return out === '' ? [] : out.split('\n');
}

// ---- (a) 0件no-op ----

test('root-cleanup run: 対象4ファイルが0件のときno-opになり、PR作成・admin mergeを一切行わない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const branchBefore = currentBranch(repo.dir);
  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-op/);
  assert.equal((stub.readState().prCreateCalls ?? []).length, 0);
  assert.equal((stub.readState().mergeCalls ?? []).length, 0);
  // ISSUE-619 AC-3: no-opでは新規ブランチ作成・チェックアウト切り替えが一切発生しないこと
  assert.equal(currentBranch(repo.dir), branchBefore, 'no-opではチェックアウト状態が変化しないこと');
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

  // ISSUE-619 AC-1・AC-6: mainをチェックアウト中に実行し、成功時の既存の標準出力形式
  // （PR番号）・終了コードに回帰が無いこと、かつ完了後にmainへ戻っていることを確認する。
  assert.equal(currentBranch(repo.dir), 'main');
  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+$/, 'マージしたPR番号を標準出力へ返すこと');
  assert.equal(currentBranch(repo.dir), 'main', '完了後、mainへ戻っていること（一時ブランチのまま取り残されないこと）');

  // Then（該当ファイルのみ削除される。PLAN.md/VALIDATION.mdは元々存在しないため対象外）。
  // ISSUE-619 design-gate再通過分（syncBaseBranchAfterAdminMerge）: admin merge成功後、現在の
  // チェックアウトがbase（main）と一致するため、ローカルmainがadmin merge結果へfast-forward
  // 追従し、repo.dir直下からも削除対象ファイルが直接確認できるようになる。
  assert.equal(fs.existsSync(path.join(repo.dir, 'UNRELATED.md')), true, '無関係なファイルは削除されないこと');
  assert.equal(fs.existsSync(path.join(repo.dir, 'SPEC.md')), false, 'admin merge後のfast-forward追従によりSPEC.mdもrepo.dir直下から消えていること');
  assert.equal(fs.existsSync(path.join(repo.dir, 'DESIGN.md')), false, 'admin merge後のfast-forward追従によりDESIGN.mdもrepo.dir直下から消えていること');

  // Then: 短命ブランチ chore/root-cleanup-* がheadとしてPR作成され、mainへpushされていること
  const prCalls = stub.readState().prCreateCalls ?? [];
  assert.equal(prCalls.length, 1);
  const headBranch = extractHeadBranch(prCalls[0].args);
  assert.ok(headBranch && /^chore\/root-cleanup-\d{8}T\d{6}Z$/.test(headBranch), `headBranch=${headBranch}`);
  assert.match(prCalls[0].args.join(' '), /--base main/);
  const remoteBranches = git(repo.dir, ['ls-remote', '--heads', 'origin', headBranch!]);
  assert.match(remoteBranches, new RegExp(`refs/heads/${headBranch}`));
  assert.equal(remoteBranchHasFile(repo.remoteDir, headBranch!, 'SPEC.md'), false, 'pushされた一時ブランチではSPEC.mdが削除されていること');
  assert.equal(remoteBranchHasFile(repo.remoteDir, headBranch!, 'DESIGN.md'), false, 'pushされた一時ブランチではDESIGN.mdが削除されていること');

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

  // ISSUE-619 design-gate再通過分（syncBaseBranchAfterAdminMerge）: admin merge成功後、
  // ローカルmainがfast-forward追従するため、pushされた一時ブランチの内容に加え、
  // repo.dir直下（mainチェックアウト中のworktree自体）でも直接削除を確認できる。
  const prCalls = stub.readState().prCreateCalls ?? [];
  assert.equal(prCalls.length, 1);
  const headBranch = extractHeadBranch(prCalls[0].args);
  assert.ok(headBranch);
  for (const file of ['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md']) {
    assert.equal(remoteBranchHasFile(repo.remoteDir, headBranch!, file), false, `${file} が削除されていること`);
    assert.equal(fs.existsSync(path.join(repo.dir, file)), false, `${file} がrepo.dir直下からも削除されていること`);
  }
});

// ---- default branch解決（ISSUE-588、AC-1・AC-3） ----

test('root-cleanup run (ISSUE-588 AC-1): default branchがmain以外(develop)のリポジトリでも、PRのbaseに実際のdefault branch名が使われ成功する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  // Given: 対象リポジトリのdefault branchをdevelopへ切り替える（'main'という名前のブランチ自体を
  // ローカル・リモート双方から無くす）
  git(repo.dir, ['checkout', '-b', 'develop']);
  git(repo.dir, ['push', 'origin', 'develop']);
  git(repo.remoteDir, ['symbolic-ref', 'HEAD', 'refs/heads/develop']);
  git(repo.dir, ['push', 'origin', '--delete', 'main']);
  git(repo.dir, ['branch', '-D', 'main']);
  git(repo.dir, ['remote', 'set-head', 'origin', '-a']);

  writeStrayArtifacts(repo.dir, ['SPEC.md']);
  stub.setDefaultPrFiles(['SPEC.md']);

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+$/, 'マージしたPR番号を標準出力へ返すこと');

  const prCalls = stub.readState().prCreateCalls ?? [];
  assert.equal(prCalls.length, 1);
  assert.match(prCalls[0].args.join(' '), /--base develop\b/, 'PR baseに実際のdefault branch名(develop)が使われること');
  assert.doesNotMatch(
    prCalls[0].args.join(' '),
    /--base main\b/,
    "'main'固定文字列がbaseとして渡されないこと",
  );
});

test('root-cleanup run (ISSUE-588 AC-3): default branchを機械的に特定できない場合、PR作成を試みる前に原因を含むエラーで失敗する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['SPEC.md']);
  stub.setDefaultPrFiles(['SPEC.md']);

  // Given: origin/HEADのsymbolic-refが未設定（createTmpRepoはcloneではなくinit+push構築のため
  // 元々未設定）かつ、main/masterブランチが共に不在の状態を作る
  git(repo.dir, ['checkout', '-b', 'tmp-hold']);
  git(repo.dir, ['branch', '-D', 'main']);
  let originHeadResolved = true;
  try {
    execFileSync('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd: repo.dir, stdio: 'pipe' });
  } catch {
    originHeadResolved = false;
  }
  assert.equal(originHeadResolved, false, '前提: origin/HEADのsymbolic-refが未設定であること');

  // GITHUB_BASE_REFの解決フォールバックに依存せず「特定不能」を再現するため明示的に未設定化する
  const envWithoutGithubBaseRef: NodeJS.ProcessEnv = { ...env };
  delete envWithoutGithubBaseRef.GITHUB_BASE_REF;

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env: envWithoutGithubBaseRef });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /デフォルトブランチを特定できません/);
  assert.equal((stub.readState().prCreateCalls ?? []).length, 0, 'PR作成を試みる前に失敗していること');
  assert.equal((stub.readState().mergeCalls ?? []).length, 0);
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

  // ISSUE-619 AC-4: 既存のOPEN cleanup PRを再利用する2回目のrunは、このコマンド呼び出し自身は
  // 一度もチェックアウト切り替えを行わない（existingBranch && pr の再利用経路）。
  const branchBeforeSecond = currentBranch(repo.dir);
  const second = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(currentBranch(repo.dir), branchBeforeSecond, '既存OPENブランチ・PR再利用時はチェックアウト状態が変化しないこと');

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
  // ISSUE-619の復元によりローカルのチェックアウトはmain（削除前の状態）へ戻るため、削除自体の
  // 検証はpushされた一時ブランチの内容で行う。
  const prCallsForCleanup = stub.readState().prCreateCalls ?? [];
  const cleanupHeadBranch = extractHeadBranch(prCallsForCleanup[0]?.args ?? []);
  assert.ok(cleanupHeadBranch);
  assert.equal(remoteBranchHasFile(repo.remoteDir, cleanupHeadBranch!, 'SPEC.md'), false, '前提: pushされた一時ブランチではSPEC.mdが削除されていること');

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

// ---- ISSUE-619: 永続main worktreeから直接実行した場合のチェックアウト状態復元 ----

test('root-cleanup run (ISSUE-619 AC-2 / ISSUE-628強化): main以外のブランチをチェックアウト中に実行した場合、完了後に元のブランチへ戻り、そのブランチ固有の未反映コミットは短命ブランチへ巻き込まれない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  // Given: mainへstray artifactが混入済み（実際のsquash mergeによる混入相当）
  writeStrayArtifacts(repo.dir, ['SPEC.md']);
  stub.setDefaultPrFiles(['SPEC.md']);
  const mainShaAtBranchPoint = git(repo.dir, ['rev-parse', 'main']);

  // Given: mainから分岐したfeature/other-branchをチェックアウト中で、mainへ未反映の独自コミット
  // （分岐後の追加コミット）を持つ状態を作る（ISSUE-628: このコミットが短命ブランチへ巻き込まれる
  // 実害を、スタブの固定値ではなく実際のgit差分から検証できるようにするための強化）。
  git(repo.dir, ['checkout', '-b', 'feature/other-branch']);
  fs.writeFileSync(
    path.join(repo.dir, 'FEATURE_ONLY.md'),
    '# feature-only change\n\nmainには存在しない、このブランチ固有の未反映コミット。\n',
  );
  git(repo.dir, ['add', '-A']);
  git(repo.dir, ['commit', '-m', 'feat: add feature-branch-only file (must not leak into root-cleanup branch)']);
  git(repo.dir, ['push', '-u', 'origin', 'feature/other-branch']);
  assert.equal(currentBranch(repo.dir), 'feature/other-branch');

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+$/, 'マージしたPR番号を標準出力へ返すこと');

  assert.equal(currentBranch(repo.dir), 'feature/other-branch', '完了後、実行前と同じブランチへ戻っていること');

  // PR base には（現在チェックアウト中のブランチではなく）実際のdefault branch(main)が使われること
  const prCalls = stub.readState().prCreateCalls ?? [];
  assert.equal(prCalls.length, 1);
  assert.match(prCalls[0].args.join(' '), /--base main\b/);
  const headBranch = extractHeadBranch(prCalls[0].args);
  assert.ok(headBranch);
  // ISSUE-619の復元によりローカルのチェックアウトはfeature/other-branch（削除前の状態）へ戻るため、
  // 削除自体の検証はpushされた一時ブランチの内容で行う。
  assert.equal(remoteBranchHasFile(repo.remoteDir, headBranch!, 'SPEC.md'), false, 'pushされた一時ブランチではSPEC.mdが削除されていること');

  // Then（ISSUE-628）: 短命ブランチはmainの分岐点（stray artifact混入直後）から作成されており、
  // feature/other-branch固有のコミット内容を一切引き継いでいないことを、実際のgit操作から検証する。
  const headParent = execFileSync('git', ['--git-dir', repo.remoteDir, 'rev-parse', `${headBranch}^`], {
    encoding: 'utf8',
  }).trim();
  assert.equal(
    headParent,
    mainShaAtBranchPoint,
    '短命ブランチはfeature/other-branchのHEADではなく、origin側のmain最新から分岐していること',
  );
  const diffFiles = remoteDiffFiles(repo.remoteDir, mainShaAtBranchPoint, headBranch!);
  assert.deepEqual(diffFiles, ['SPEC.md'], '短命ブランチの変更内容はSPEC.mdの削除のみで、feature/other-branch固有のFEATURE_ONLY.mdを含まないこと');
});

// ---- ISSUE-619 design-gate再通過分（PLAN #16）: syncBaseBranchAfterAdminMerge の非適用確認 ----

test('root-cleanup run (design-gate再通過, PLAN #16): baseと異なるブランチをチェックアウト中は、admin merge成功後もfetch/ff-only同期を試みない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['SPEC.md']);
  stub.setDefaultPrFiles(['SPEC.md']);
  git(repo.dir, ['checkout', '-b', 'feature/other-branch']);
  git(repo.dir, ['push', '-u', 'origin', 'feature/other-branch']);
  assert.equal(currentBranch(repo.dir), 'feature/other-branch');

  const localMainShaBefore = git(repo.dir, ['rev-parse', 'refs/heads/main']);
  const featureBranchShaBefore = git(repo.dir, ['rev-parse', 'HEAD']);

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentBranch(repo.dir), 'feature/other-branch', '完了後、実行前と同じブランチへ戻っていること（sync対象外のため復元先のまま）');

  // Then: 現在のチェックアウト（feature/other-branch）はbase（main）と一致しないため
  // syncBaseBranchAfterAdminMergeは何もしない。ローカルmain参照・feature/other-branch自体の
  // 内容・commit履歴はrun前後で一切変化しない。
  const localMainShaAfter = git(repo.dir, ['rev-parse', 'refs/heads/main']);
  assert.equal(localMainShaAfter, localMainShaBefore, 'ローカルmain参照はfast-forward追従されないこと（現在のチェックアウトがbaseと不一致のため）');
  const featureBranchShaAfter = git(repo.dir, ['rev-parse', 'HEAD']);
  assert.equal(featureBranchShaAfter, featureBranchShaBefore, 'feature/other-branch自体のcommit履歴は変化しないこと');
});

test('root-cleanup run (ISSUE-619 AC-5): commit・push成功後にPR作成が失敗した場合も、エラー終了しつつチェックアウト状態が実行前へ戻る', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['SPEC.md']);
  stub.failNextPrCreate(1, 'gh-stub: simulated pr create failure (ISSUE-619 AC-5)\n');
  assert.equal(currentBranch(repo.dir), 'main');

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gh pr create に失敗しました/);
  assert.equal(currentBranch(repo.dir), 'main', 'PR作成失敗後もmainへ復元されていること');
  assert.equal((stub.readState().mergeCalls ?? []).length, 0, 'PR作成前に失敗しているためadmin mergeへは進まないこと');

  // fail-closedで終了する前に、削除対象ファイル自体はmain上に復元済み（cleanupブランチ側の
  // git rmはmainへ影響しない）であること
  assert.equal(fs.existsSync(path.join(repo.dir, 'SPEC.md')), true);
});

test('root-cleanup run (ISSUE-619): チェックアウト状態の復元自体が失敗した場合、スコープ検査・admin mergeを実行せずエラー終了する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  writeStrayArtifacts(repo.dir, ['SPEC.md']);
  stub.setDefaultPrFiles(['SPEC.md']);

  // Given: commit・push自体は成功するが、push完了直後（復元試行の前）に復元先ブランチ(main)の
  // ローカル参照が失われる状況を再現する（例: worktreeに競合するuntracked/変更内容が生じた等と
  // 同種の「復元先の参照が実行中に消失した」失敗モード）。
  installPrePushHookDeletingBranch(repo.dir, 'main');

  const result = runCli(['root-cleanup', 'run'], { cwd: repo.dir, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /復元/, '復元に失敗した旨を含めること');
  assert.match(result.stderr, /main/, '復元先のブランチ名を含めること');
  assert.equal((stub.readState().prCreateCalls ?? []).length, 1, '前提: PR作成自体は成功していること（復元失敗のみを再現するため）');
  assert.equal((stub.readState().mergeCalls ?? []).length, 0, '復元失敗時はスコープ検査・admin mergeへ進まないこと');
});

// ---- verify root-clean（AC-4）はこの新設サブコマンド自身の合否検証であり、
// test/integration/verify.test.ts の他 verify サブコマンド群と同じ場所（同ファイル）でも検証する。
