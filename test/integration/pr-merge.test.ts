import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpRepo, removeMergeAutonomous, setMergeAutonomous, setMergeAutoUpdateBranch } from '../helpers/tmp-repo.js';
import { runCli } from '../helpers/cli.js';
import { createGhStub } from '../helpers/gh-stub.js';

// Issue #493（pr merge のbase branch最新性チェック）の受入検証。ポーリング（checkFreshness の
// UNKNOWNバックオフ・attemptUpdateBranch の update-branch 反映待ち）を実時間で待つと
// テストが極端に遅くなるため、本番既定値（3秒間隔・最大10回等）とは別に、テスト実行時のみ
// 短縮したポーリング間隔・バックオフを環境変数で注入する。
const FAST_POLL_ENV = {
  AGENT_SKILL_CHAIN_TEST_UPDATE_BRANCH_POLL_INTERVAL_MS: '5',
  AGENT_SKILL_CHAIN_TEST_UPDATE_BRANCH_POLL_MAX_ATTEMPTS: '4',
  AGENT_SKILL_CHAIN_TEST_UNKNOWN_BACKOFF_DELAYS_MS: '5,5,5',
};

// Issue #398（PRマージ後のローカルmain worktree自動同期）の受入検証: `agent-skill-chain
// pr merge` という CLI 経路そのもの（`gh pr merge` への引数透過・マージ成功後の
// main worktree同期・マージ失敗時の同期スキップ）を、ビルド後の bin/agents-md.js を
// 子プロセスとして実際に実行することで検証する。gh は test/helpers/gh-stub.ts のスタブに
// 差し替え、実際のGitHub API・ネットワークへは一切アクセスしない。git は実バイナリを使う
// （test/integration/release.test.ts と同一のテスト方式）。

function makeStub() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-pr-merge-'));
  const stub = createGhStub(scratchDir);
  const env = { ...stub.env(process.env), ...FAST_POLL_ENV };
  return { stub, env, cleanup: () => fs.rmSync(scratchDir, { recursive: true, force: true }) };
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

// Issue #493: pr merge のbase branch最新性チェック（AC-1〜AC-7）。

test('pr merge (AC-1/AC-3): behindな対象PRは --admin を指定しても自動最新化オプトイン無しでは中断される', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-ac1');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrFreshnessQueue(42, [{ mergeStateStatus: 'BEHIND' }]);

  const result = runCli(['pr', 'merge', '42', '--squash', '--admin'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0, '--adminを指定してもbehindのままではマージを実行しないはず');
  assert.match(result.stderr, /最新ではありません/);
  assert.match(
    result.stderr,
    /進行役がこの設定を有効化する、または update-branch API を直接呼び出すことは、ローカルでコミットを作成せず GitHub 側でサーバーサイドのマージ／調整状態操作を行うため、I5 違反ではありません。/,
  );
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
});

// Issue #493実装ゲート是正（blocking: merge-state-status-masks-behind /
// behind-detection-contract-mismatch）: mergeStateStatusはbase branch側のrulesetで
// 「Require branches to be up to date」等が有効な場合にのみBEHINDを返す仕様であり、無効な
// 環境ではBEHIND以外（CLEAN/UNSTABLE/BLOCKED等）が実際にbehindでも返り得る。この反例を
// 再現し、mergeStateStatusのみに依存する実装では見逃されていたことを固定回帰させる。
test('pr merge (Issue #493 blocking是正): mergeStateStatusがCLEANでも実際にはbehind（compare API）なら中断する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-behind-mask-clean');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  // mergeStateStatus自体はCLEAN（rulesetのup-to-date必須設定が無い環境の実際の応答を模擬）だが、
  // compare APIは独立にbehindを返す反例。
  stub.seedPrFreshnessQueue(60, [{ mergeStateStatus: 'CLEAN', compareStatus: 'behind', compareBehindBy: 3 }]);

  const result = runCli(['pr', 'merge', '60', '--admin'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0, 'mergeStateStatusがCLEANでもcompare APIがbehindを示す限りマージを実行しないはず');
  assert.match(result.stderr, /最新ではありません/);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
});

test('pr merge (Issue #493 blocking是正): mergeStateStatusがBLOCKEDでも実際にはbehind（compare API）なら中断する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-behind-mask-blocked');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrFreshnessQueue(61, [{ mergeStateStatus: 'BLOCKED', compareStatus: 'behind', compareBehindBy: 1 }]);

  const result = runCli(['pr', 'merge', '61', '--admin'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /最新ではありません/);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
});

test('pr merge (Issue #493 blocking是正・回帰防止): mergeStateStatusがCLEANでcompare APIもidenticalならfreshとしてマージする', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-behind-mask-fresh');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrFreshnessQueue(62, [{ mergeStateStatus: 'CLEAN', compareStatus: 'identical', compareBehindBy: 0 }]);

  const result = runCli(['pr', 'merge', '62', '--admin'], { cwd: issueWorktree, env });

  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length, 1);
});

test('pr merge (AC-2): auto_update_branch有効時、update-branch API自体が失敗すれば中断する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutoUpdateBranch(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-ac2-api-fail');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrFreshnessQueue(43, [{ mergeStateStatus: 'BEHIND' }]);
  stub.failUpdateBranch(43);

  const result = runCli(['pr', 'merge', '43'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  const state = stub.readState();
  assert.equal(state.updateBranchCalls?.length, 1);
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
});

test('pr merge (AC-2): auto_update_branch有効でもポーリング上限まで反映されなければ中断する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutoUpdateBranch(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-ac2-poll-exhaust');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  // キューは1件のみ（'BEHIND'）。末尾到達後は同じエントリを返し続けるため、
  // ポーリング上限（FAST_POLL_ENVで4回）に達しても解決しない状況を再現する。
  stub.seedPrFreshnessQueue(44, [{ mergeStateStatus: 'BEHIND' }]);

  const result = runCli(['pr', 'merge', '44'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  const state = stub.readState();
  assert.equal(state.updateBranchCalls?.length, 1);
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
});

test('pr merge (AC-2 正常系): 複数回のポーリングを経てfreshに到達すれば最新化後にマージへ進む', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutoUpdateBranch(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-ac2-poll-success');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrFreshnessQueue(45, [
    { mergeStateStatus: 'BEHIND' }, // merge()の初回checkFreshness
    { mergeStateStatus: 'BEHIND' }, // ポーリング1回目
    { mergeStateStatus: 'CLEAN', baseRefOid: 'sha-fresh-45' }, // ポーリング2回目でfreshに到達
  ]);

  const result = runCli(['pr', 'merge', '45', '--squash'], { cwd: issueWorktree, env });

  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  assert.equal(state.updateBranchCalls?.length, 1);
  assert.equal(state.mergeCalls?.length, 1);
  assert.deepEqual(state.mergeCalls?.[0]?.args, ['pr', 'merge', '45', '--squash']);
});

test('pr merge (AC-4): 最新性確認自体（gh pr view）が失敗した場合はマージを実行しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-ac4-check-fail');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrViewFailure('46', { stderr: 'gh: could not resolve to a PullRequest\n' });

  const result = runCli(['pr', 'merge', '46'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
});

test('pr merge (AC-4): 対象識別子省略時にcwdベースの暗黙解決も失敗すれば中断する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-ac4-no-target');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.failImplicitPrResolution();
  const localMainShaBefore = git(repo.dir, ['rev-parse', 'main']);

  // 対象識別子を含まない引数（--squashのみ）で実行する。
  const result = runCli(['pr', 'merge', '--squash'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /対象PRを特定できませんでした/);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
  const localMainShaAfter = git(repo.dir, ['rev-parse', 'main']);
  assert.equal(localMainShaAfter, localMainShaBefore, 'syncMainWorktree()も呼ばれないはず');
});

test('pr merge (AC-5): 対象識別子省略時、cwdベースの暗黙解決が成功しfreshなら従来通りマージが成立する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  // repoRoot() は linked worktree からでも常にmain worktreeへ解決される（coordination状態の
  // 基点をworktree間で統一する設計）ため、resolveMergeTarget()のフォールバック（`cwd=root`）・
  // `gh(['pr','merge',...args], root)`・syncMainWorktree()（default branchをチェックアウトして
  // いる前提）は、いずれも実行時cwdではなくmain worktree（repo.dir）自身が今チェックアウトして
  // いるブランチを参照する（既存のsyncMainWorktree()の前提と一貫させた設計）。
  // repo.dir はdefault branch（main）をチェックアウトしたままにする必要がある（syncMainWorktree
  // の前提）ため、このテストではPRのheadRefNameとして 'main' を登録し、cwdベースの暗黙解決が
  // 'main'に紐づくPRを見つけられることのみを検証する（stub上の割当であり、実際のGitHub PRの
  // head branchがmainになることを意味しない）。
  stub.seedOpenPr({ number: 47, headRefName: 'main', body: 'body' });

  // 対象識別子を含まない引数（gh pr merge自体の暗黙解決に相当する実運用パターン）。
  const result = runCli(['pr', 'merge', '--squash', '--admin'], { cwd: repo.dir, env });

  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length, 1);
  // args自体はresolveMergeTarget()が注入せず、本Issue対応前と同一のまま透過されるはず。
  assert.deepEqual(state.mergeCalls?.[0]?.args, ['pr', 'merge', '--squash', '--admin']);
  const implicitCall = state.prViewCalls?.find((call) => call.key === '(implicit)');
  assert.ok(implicitCall, 'cwdベースの暗黙解決フォールバックが呼ばれているはず');
});

// Issue #493実装ゲート2回目是正（warning: unknown-merge-state-aborts-merge）: バックオフ枯渇後も
// mergeStateStatusがUNKNOWNのままだと、compare APIを一切呼ばずcheck_failedとして中断していた。
// mergeStateStatusはUNKNOWN解決待ちのポーリング制御にのみ使う補助的な値であり、最新性判定自体は
// compare APIの結果で行うべきという設計に基づき、CLI経路でもcompare結果でマージへ進むことを検証する。
test('pr merge (Issue #493実装ゲート2回目是正): バックオフ後もmergeStateStatusがUNKNOWNのままでもcompare API結果でマージへ進む', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-unknown-mergestate');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  // mergeStateStatusは常にUNKNOWN（バックオフ上限まで解決しない）が、compare APIはidenticalを返す。
  stub.seedPrFreshnessQueue(99, [{ mergeStateStatus: 'UNKNOWN', compareStatus: 'identical', compareBehindBy: 0 }]);

  const result = runCli(['pr', 'merge', '99'], { cwd: issueWorktree, env });

  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  assert.equal(
    state.mergeCalls?.length,
    1,
    'mergeStateStatusがUNKNOWNのままでもcompare API結果（identical）でfreshと判定しマージへ進むはず',
  );
  // FAST_POLL_ENVのバックオフ（'5,5,5' = 3回）を全消費してから判定していることも確認する。
  assert.ok(
    (state.prFreshnessCallCounts?.['99'] ?? 0) >= 4,
    'バックオフ全消費（初回+3回）後に判定しているはず',
  );
});

test('pr merge (AC-6): 最新性と無関係な失敗（権限不足）は既存のgh pr merge出力をそのまま維持する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-ac6-permission');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  const message = 'GraphQL: You do not have permission to merge this pull request\n';
  stub.failNextMerge(1);
  const state1 = stub.readState();
  state1.failMergeMessage = message;
  stub.writeState(state1);
  const localMainShaBefore = git(repo.dir, ['rev-parse', 'main']);

  const result = runCli(['pr', 'merge', '48'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, message, 'AC-6は本Issue対応前と同一の出力をそのまま返すはず（追加メッセージ無し）');
  const localMainShaAfter = git(repo.dir, ['rev-parse', 'main']);
  assert.equal(localMainShaAfter, localMainShaBefore, 'syncMainWorktree()は呼ばれないはず');
});

test('pr merge (AC-7): 確認通過後のTOCTOU競合でgh pr mergeが失敗した場合は安全側エラーを付加する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-ac7-toctou');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  const message = 'GraphQL: Base branch was modified. Review and try the merge again.\n';
  stub.failNextMerge(1);
  const state1 = stub.readState();
  state1.failMergeMessage = message;
  stub.writeState(state1);

  const result = runCli(['pr', 'merge', '49', '--admin'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(message.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stderr, /TOCTOU競合/);
});

// Issue #493実装ゲート2回目是正: -R/--repoは`gh pr view`呼び出し自体への`--repo`ヒントとしてのみ
// 使われ、compare・update-branchの根拠にはならない（`checkFreshness()`がPR自身の応答から導出した
// 実際のリポジトリを使う）。-Rが対象PRの実際のリポジトリと一致する場合は、結果として
// compare・update-branchも同じリポジトリへ一貫して呼ばれることを検証する（-R不一致時に誤った
// リポジトリへ作用しないことは別テストで検証する）。
test('pr merge (設計上の確認事項): -R/--repoが対象PRの実際のリポジトリと一致する場合、checkFreshness/attemptUpdateBranchへ一貫して伝播する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutoUpdateBranch(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-repo-override');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  // -R で指定するリポジトリが対象PRの実際の所属リポジトリと一致する状況を再現する。
  stub.seedPrCrossRepoInfo(50, { repoFullName: 'owner/other-repo' });
  stub.seedPrFreshnessQueue(50, [
    { mergeStateStatus: 'BEHIND' },
    { mergeStateStatus: 'CLEAN', baseRefOid: 'sha-fresh-50' },
  ]);

  const result = runCli(['pr', 'merge', '50', '-R', 'owner/other-repo', '--admin'], { cwd: issueWorktree, env });

  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  const targetedViewCalls = (state.prViewCalls ?? []).filter((call) => call.key === '50');
  assert.ok(targetedViewCalls.length >= 1);
  for (const call of targetedViewCalls) {
    assert.equal(call.repo, 'owner/other-repo', '-Rはgh pr view呼び出し自体への--repoヒントとして伝播するはず');
  }
  assert.equal(state.updateBranchCalls?.length, 1);
  assert.equal(
    state.updateBranchCalls?.[0]?.repo,
    'owner/other-repo',
    'update-branchはgh pr viewの応答から導出した実際のリポジトリへ呼ばれるはず',
  );
  assert.deepEqual(state.mergeCalls?.[0]?.args, ['pr', 'merge', '50', '-R', 'owner/other-repo', '--admin']);
});

// Issue #493実装ゲート是正（blocking: update-branch-target-not-pr-number /
// update-branch-non-numeric-target）: 対象識別子がPR番号でない場合（ブランチ名／URL）でも、
// update-branch APIは`checkFreshness()`が`gh pr view`から取得した実際のPR番号へ正規化した
// うえで呼ばれること（生の対象識別子をそのままAPIパスへ使わないこと）を検証する。
test('pr merge (Issue #493 blocking是正): 対象識別子がブランチ名でもupdate-branch APIは正規化されたPR番号で呼ばれる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutoUpdateBranch(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-target-normalize');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedOpenPr({ number: 81, headRefName: 'feature/target-branch', body: 'body' });
  stub.seedPrFreshnessQueue(81, [
    { mergeStateStatus: 'BEHIND' },
    { mergeStateStatus: 'CLEAN', baseRefOid: 'sha-fresh-81' },
  ]);

  const result = runCli(['pr', 'merge', 'feature/target-branch', '--squash'], { cwd: issueWorktree, env });

  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  assert.equal(state.updateBranchCalls?.length, 1);
  assert.equal(
    state.updateBranchCalls?.[0]?.prNumber,
    '81',
    'ブランチ名がそのままAPIパスへ使われるのではなく、正規化されたPR番号で呼ばれるはず',
  );
  // gh pr merge へ渡す引数自体は正規化せず、対象識別子をそのまま透過するはず。
  assert.deepEqual(state.mergeCalls?.[0]?.args, ['pr', 'merge', 'feature/target-branch', '--squash']);
});

// Issue #493実装ゲート是正: マージ成立後のベストエフォート事後検知は、コンフリクトの無い
// 通常の成功マージでも必ずbaseが前進するため常に誤検知（狼少年化）する欠陥があったため撤去した。
// 競合の無い通常の成功マージでは警告が出力されず、かつマージ成立後に追加のfreshness確認自体が
// 発生しない（窓の最小化のみで対応する設計へ変更）ことを検証する。
test('pr merge (Issue #493 warning是正): 事後検知は撤去済みのため、通常の成功マージでは追加のfreshness確認も警告も発生しない', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-post-merge-removed');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrFreshnessQueue(53, [{ mergeStateStatus: 'CLEAN' }]);

  const result = runCli(['pr', 'merge', '53'], { cwd: issueWorktree, env });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /新しいコミットが追加されていた可能性/);
  const state = stub.readState();
  assert.equal(
    state.prFreshnessCallCounts?.['53'],
    1,
    'マージ成立後の追加freshness確認（gh pr view）は発生しないはず（事後検知の撤去、窓の最小化のみで対応）',
  );
});

// Issue #493実装ゲート2回目是正（blocking: compare-head-ref-not-owner-qualified /
// fork-pr-compare-head-ref-unqualified）: fork（別リポジトリ）由来のPRでは、compare APIの
// head側を`<owner>:<branch>`形式で修飾しなければ誤ったブランチ同士の比較・404になる。
// CLI経路（`agent-skill-chain pr merge`）を通して、isCrossRepositoryなPRのcompare呼び出しが
// 正しく修飾されることを検証する。
test('pr merge (Issue #493実装ゲート2回目是正): fork由来PR（isCrossRepository）はCLI経由でもcompareのheadをowner:branch形式で修飾する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-fork-pr-compare');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrCrossRepoInfo(97, { isCrossRepository: true, headRepositoryOwner: { login: 'fork-owner' } });
  stub.seedPrFreshnessQueue(97, [{ mergeStateStatus: 'CLEAN', compareStatus: 'identical', compareBehindBy: 0 }]);

  const result = runCli(['pr', 'merge', '97', '--admin'], { cwd: issueWorktree, env });

  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length, 1);
  const compareCall = (state.compareRepoCalls ?? []).find((call) => call.head.startsWith('fork-owner:'));
  assert.ok(compareCall, 'compare呼び出しのheadがowner:branch形式で修飾されているはず');
  assert.equal(compareCall?.head, 'fork-owner:stub-head-97');
});

// Issue #493実装ゲート2回目是正（blocking: repo-resolution-inconsistent-between-pr-view-and-api）:
// `-R`無しでPR URL（cwdの既定リポジトリと異なるリポジトリを指すURL）を対象指定した場合、
// 状態取得（`gh pr view`）は正しいPRから行われる一方、compare・update-branchがcwdの既定
// リポジトリに対して実行される反例を固定回帰させる。compare・update-branchが
// PR URL由来の実際のリポジトリへ呼ばれ、cwdの既定リポジトリへは一切呼ばれないことを検証する。
test('pr merge (Issue #493実装ゲート2回目是正): -R無しでPR URL（cwdの既定リポジトリと異なるリポジトリ）を対象指定した場合、compare・update-branchはURL由来のリポジトリに対して呼ばれる', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutoUpdateBranch(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-url-repo-mismatch');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrFreshnessQueue(98, [
    { mergeStateStatus: 'BEHIND' },
    { mergeStateStatus: 'CLEAN', baseRefOid: 'sha-fresh-98' },
  ]);

  const result = runCli(
    ['pr', 'merge', 'https://github.com/other-owner/other-repo/pull/98', '--squash'],
    { cwd: issueWorktree, env },
  );

  assert.equal(result.status, 0, result.stderr);
  const state = stub.readState();
  assert.equal(state.updateBranchCalls?.length, 1);
  assert.equal(
    state.updateBranchCalls?.[0]?.repo,
    'other-owner/other-repo',
    'update-branchはPR URL由来の実際のリポジトリへ呼ばれるはず（cwdの既定リポジトリではない）',
  );
  const compareCalls = state.compareRepoCalls ?? [];
  assert.ok(compareCalls.length > 0, 'compareが呼ばれているはず');
  for (const call of compareCalls) {
    assert.equal(
      call.repo,
      'other-owner/other-repo',
      'compareもPR URL由来の実際のリポジトリへ呼ばれるはず（cwdの既定リポジトリではない）',
    );
  }
  assert.deepEqual(
    state.mergeCalls?.[0]?.args,
    ['pr', 'merge', 'https://github.com/other-owner/other-repo/pull/98', '--squash'],
  );
});

// Issue #493実装ゲート3回目是正（info: not-applicable-status-unhandled-in-merge）: 初回の
// checkFreshness()結果がnot_applicable（対象PRが既にOPENでない）の場合、attemptUpdateBranch()側
// のnot_applicableには専用の日本語メッセージがあるのに対し、初回判定側には無く一貫性を欠いて
// いた。専用メッセージで中断し、gh pr mergeへフォールスルーしないことを固定回帰させる。
test('pr merge (Issue #493実装ゲート3回目是正): 初回の最新性確認で対象PRが既にOPENでない場合は専用メッセージで中断する', async (t) => {
  const repo = createTmpRepo({ backend: 'local' });
  t.after(() => repo.cleanup());
  setMergeAutonomous(repo.dir, true);
  const { stub, env, cleanup } = makeStub();
  t.after(cleanup);

  const issueWorktree = addIssueWorktree(repo.dir, 'feature/493-initial-not-applicable');
  t.after(() => fs.rmSync(issueWorktree, { recursive: true, force: true }));

  stub.seedPrFreshnessQueue(99, [{ state: 'MERGED' }]);

  const result = runCli(['pr', 'merge', '99', '--admin'], { cwd: issueWorktree, env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /既にクローズ・マージ済みのため最新性確認を行えません/);
  const state = stub.readState();
  assert.equal(state.mergeCalls?.length ?? 0, 0, 'gh pr mergeは一切実行されていないはず');
});
