import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMergeTarget, MergeFailureClassifier, checkFreshness } from '../../src/lib/pr-freshness.js';
import { createGhStub } from '../helpers/gh-stub.js';

// resolveMergeTarget() の args 解析（`gh` 呼び出しを要さない、対象識別子が args から直接
// 見つかるケース）のみを対象とする単体テスト。cwdベースの暗黙解決フォールバック（`gh pr view`
// 呼び出しを要する）は test/integration/pr-merge.test.ts のAC-4/AC-5が gh-stub 経由で検証する。

/**
 * `checkFreshness()` は内部で `gh`（`exec.ts` の `gh()`）を呼ぶため、`gh` CLI を
 * `test/helpers/gh-stub.ts` のスタブへ差し替えて直接呼び出す。`exec.ts` の `run()` は
 * `spawnSync` に明示的な `env` を渡さず既定で `process.env` を継承するため、テスト実行中の
 * `process.env.PATH`/`AGENT_SKILL_CHAIN_GH_STUB_STATE` を一時的に書き換えて注入し、
 * テスト終了時に必ず元へ戻す。
 */
function withGhStub(run: (stub: ReturnType<typeof createGhStub>) => void): void {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stub-pr-freshness-unit-'));
  const stub = createGhStub(scratchDir);
  const originalPath = process.env.PATH;
  const originalStateVar = process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
  const env = stub.env(process.env);
  process.env.PATH = env.PATH;
  process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
  try {
    run(stub);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalStateVar === undefined) delete process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE;
    else process.env.AGENT_SKILL_CHAIN_GH_STUB_STATE = originalStateVar;
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

// Issue #493実装ゲート是正（blocking: merge-state-status-masks-behind /
// behind-detection-contract-mismatch）: mergeStateStatusはbase branch側のrulesetが
// 「Require branches to be up to date」等を有効にしている場合にのみBEHINDを返す仕様であり、
// 無効な環境では実際にbehindでもCLEAN/BLOCKED等が返り得る。この反例を直接 checkFreshness() へ
// 与え、compare APIの判定が優先されることを固定回帰させる。
test('checkFreshness: mergeStateStatusがCLEANでも実際にbehind（compare API）ならbehindと判定する', () => {
  withGhStub((stub) => {
    stub.seedPrFreshnessQueue(70, [{ mergeStateStatus: 'CLEAN', compareStatus: 'behind', compareBehindBy: 2 }]);
    const result = checkFreshness(process.cwd(), '70', undefined, { allowUnknownBackoff: false });
    assert.equal(result.status, 'behind');
  });
});

test('checkFreshness: mergeStateStatusがBLOCKEDでも実際にbehind（compare API）ならbehindと判定する', () => {
  withGhStub((stub) => {
    stub.seedPrFreshnessQueue(71, [{ mergeStateStatus: 'BLOCKED', compareStatus: 'behind', compareBehindBy: 1 }]);
    const result = checkFreshness(process.cwd(), '71', undefined, { allowUnknownBackoff: false });
    assert.equal(result.status, 'behind');
  });
});

test('checkFreshness: mergeStateStatusがCLEANでcompare APIもidenticalならfreshと判定する（回帰防止）', () => {
  withGhStub((stub) => {
    stub.seedPrFreshnessQueue(72, [{ mergeStateStatus: 'CLEAN', compareStatus: 'identical', compareBehindBy: 0 }]);
    const result = checkFreshness(process.cwd(), '72', undefined, { allowUnknownBackoff: false });
    assert.equal(result.status, 'fresh');
  });
});

// Issue #493実装ゲート是正（blocking: update-branch-target-not-pr-number /
// update-branch-non-numeric-target）: 対象識別子がブランチ名でも、FreshnessResult.prNumber には
// `gh pr view` が返す実際の数値PR番号が正規化されて入ることを検証する。
test('checkFreshness: targetがブランチ名でもprNumber（正規化された数値PR番号）を返す', () => {
  withGhStub((stub) => {
    stub.seedOpenPr({ number: 82, headRefName: 'feature/unit-target-branch', body: 'body' });
    const result = checkFreshness(process.cwd(), 'feature/unit-target-branch', undefined, {
      allowUnknownBackoff: false,
    });
    assert.equal(result.prNumber, '82');
  });
});

/** バックオフ用の環境変数を一時的に短縮値へ差し替えて `run` を実行する。 */
function withShortBackoff(run: () => void): void {
  const original = process.env.AGENT_SKILL_CHAIN_TEST_UNKNOWN_BACKOFF_DELAYS_MS;
  process.env.AGENT_SKILL_CHAIN_TEST_UNKNOWN_BACKOFF_DELAYS_MS = '1,1,1';
  try {
    run();
  } finally {
    if (original === undefined) delete process.env.AGENT_SKILL_CHAIN_TEST_UNKNOWN_BACKOFF_DELAYS_MS;
    else process.env.AGENT_SKILL_CHAIN_TEST_UNKNOWN_BACKOFF_DELAYS_MS = original;
  }
}

// Issue #493実装ゲート2回目是正（warning: unknown-merge-state-aborts-merge）: バックオフ枯渇後も
// mergeStateStatusがUNKNOWNのままだと、compare APIを呼ばずcheck_failedを返していた。
// mergeStateStatusは判定の根拠ではなくUNKNOWN解決待ちのポーリング制御にのみ使うため、バックオフ後
// 解決しなくてもcompare API呼び出しへ進み、その結果で判定すべきという反例を固定回帰させる。
test('checkFreshness: バックオフ後もmergeStateStatusがUNKNOWNのままならcompare API結果でfreshと判定する', () => {
  withShortBackoff(() => {
    withGhStub((stub) => {
      stub.seedPrFreshnessQueue(91, [{ mergeStateStatus: 'UNKNOWN', compareStatus: 'identical', compareBehindBy: 0 }]);
      const result = checkFreshness(process.cwd(), '91', undefined, { allowUnknownBackoff: true });
      assert.equal(result.status, 'fresh');
    });
  });
});

test('checkFreshness: バックオフ後もmergeStateStatusがUNKNOWNのままcompare APIがbehindを返せばbehindと判定する', () => {
  withShortBackoff(() => {
    withGhStub((stub) => {
      stub.seedPrFreshnessQueue(92, [{ mergeStateStatus: 'UNKNOWN', compareStatus: 'behind', compareBehindBy: 4 }]);
      const result = checkFreshness(process.cwd(), '92', undefined, { allowUnknownBackoff: true });
      assert.equal(result.status, 'behind');
    });
  });
});

test('checkFreshness: compare API呼び出し自体が失敗した場合はcheck_failedのままとする', () => {
  withShortBackoff(() => {
    withGhStub((stub) => {
      stub.seedPrFreshnessQueue(93, [{ mergeStateStatus: 'UNKNOWN', compareFail: true }]);
      const result = checkFreshness(process.cwd(), '93', undefined, { allowUnknownBackoff: true });
      assert.equal(result.status, 'check_failed');
    });
  });
});

// Issue #493実装ゲート2回目是正（blocking: fork-pr-compare-head-ref-unqualified）: fork（別リポジトリ）
// 由来のPRでは、compare APIのhead側を`<owner>:<branch>`形式で修飾しなければ誤ったブランチ同士の
// 比較・404になる。isCrossRepository/headRepositoryOwnerを与えた場合にheadが正しく修飾されることを
// 固定回帰させる。
test('checkFreshness: fork由来PR（isCrossRepository）はcompareのhead引数をowner:branch形式で修飾する', () => {
  withGhStub((stub) => {
    stub.seedPrCrossRepoInfo(94, { isCrossRepository: true, headRepositoryOwner: { login: 'fork-owner' } });
    stub.seedPrFreshnessQueue(94, [{ mergeStateStatus: 'CLEAN', compareStatus: 'identical', compareBehindBy: 0 }]);
    const result = checkFreshness(process.cwd(), '94', undefined, { allowUnknownBackoff: false });
    assert.equal(result.status, 'fresh');
    const state = stub.readState();
    const compareCall = (state.compareRepoCalls ?? []).find((call) => call.head.startsWith('fork-owner:'));
    assert.ok(compareCall, 'compare呼び出しのheadがowner:branch形式で修飾されているはず');
    assert.equal(compareCall?.head, 'fork-owner:stub-head-94');
    assert.equal(compareCall?.repo, 'test/repo', 'base側は対象PR自身のリポジトリのまま（修飾不要）');
  });
});

test('checkFreshness: isCrossRepositoryがfalse（同一リポジトリ）ならheadを修飾しない（回帰防止）', () => {
  withGhStub((stub) => {
    stub.seedPrCrossRepoInfo(95, { isCrossRepository: false });
    stub.seedPrFreshnessQueue(95, [{ mergeStateStatus: 'CLEAN', compareStatus: 'identical', compareBehindBy: 0 }]);
    checkFreshness(process.cwd(), '95', undefined, { allowUnknownBackoff: false });
    const state = stub.readState();
    const compareCall = (state.compareRepoCalls ?? []).find((call) => call.head === 'stub-head-95');
    assert.ok(compareCall, 'headは修飾されずそのままのブランチ名のはず');
  });
});

// Issue #493実装ゲート2回目是正（blocking: repo-resolution-inconsistent-between-pr-view-and-api）:
// -R無しでPR URL（cwdの既定リポジトリと異なるリポジトリ）を対象指定した場合、compareが
// cwdの既定リポジトリ（本スタブの既定 'test/repo'）ではなく、gh pr viewの応答（url）から
// 導出した実際のリポジトリへ呼ばれることを固定回帰させる。
test('checkFreshness: 対象識別子がPR URL（cwdの既定リポジトリと異なるリポジトリ）でもURL由来のリポジトリでcompareする', () => {
  withGhStub((stub) => {
    stub.seedPrFreshnessQueue(96, [{ mergeStateStatus: 'CLEAN', compareStatus: 'identical', compareBehindBy: 0 }]);
    const result = checkFreshness(
      process.cwd(),
      'https://github.com/other-owner/other-repo/pull/96',
      undefined,
      { allowUnknownBackoff: false },
    );
    assert.equal(result.status, 'fresh');
    assert.equal(result.repo, 'other-owner/other-repo');
    assert.equal(result.prNumber, '96');
    const state = stub.readState();
    const compareCall = (state.compareRepoCalls ?? []).find((call) => call.repo === 'other-owner/other-repo');
    assert.ok(compareCall, 'compareはURL由来の実際のリポジトリへ呼ばれるはず（cwdの既定リポジトリではない）');
    const wrongRepoCall = (state.compareRepoCalls ?? []).find((call) => call.repo === 'test/repo');
    assert.equal(wrongRepoCall, undefined, 'cwdの既定リポジトリへは一切呼ばれないはず');
  });
});

// Issue #615: 実際の `gh pr view --json` は `baseRefOid` フィールドを受理せず、指定すると
// `gh pr view` 自体が非ゼロ終了するため `checkFreshness()` が常に `check_failed` を返していた
// （gh-stub は実 `gh` CLI と異なり未知フィールドでも常に成功していたため、この既存の単体・結合
// テストでは検出できなかった）。この反例を、`gh pr view` へ実際に渡されたフィールド一覧
// （gh-stub の `prViewCalls[].fields`）を直接検査することで固定回帰させる。
test('checkFreshness: gh pr viewへ渡す--jsonフィールドにbaseRefOid（実gh CLIに存在しないフィールド）を含めない', () => {
  withGhStub((stub) => {
    stub.seedPrFreshnessQueue(73, [{ mergeStateStatus: 'CLEAN', compareStatus: 'identical', compareBehindBy: 0 }]);
    const result = checkFreshness(process.cwd(), '73', undefined, { allowUnknownBackoff: false });
    assert.equal(result.status, 'fresh');
    const state = stub.readState();
    const viewCalls = (state.prViewCalls ?? []).filter((call) => call.key === '73');
    assert.ok(viewCalls.length >= 1, 'gh pr viewが呼ばれているはず');
    for (const call of viewCalls) {
      assert.ok(
        !call.fields.includes('baseRefOid'),
        `gh pr view --json に存在しないフィールド baseRefOid を含めてはならない: ${call.fields.join(',')}`,
      );
    }
  });
});

// Issue #615: base branchの現在のコミットSHA（FreshnessResult.baseSha）は `gh pr view` の応答
// ではなく、compare API応答（`base_commit.sha`）から取得することを固定回帰させる。
test('checkFreshness: baseShaはcompare APIの応答（base_commit.sha）から取得される', () => {
  withGhStub((stub) => {
    stub.seedPrFreshnessQueue(74, [
      { mergeStateStatus: 'CLEAN', compareStatus: 'identical', compareBehindBy: 0, baseRefOid: 'sha-from-compare-74' },
    ]);
    const result = checkFreshness(process.cwd(), '74', undefined, { allowUnknownBackoff: false });
    assert.equal(result.status, 'fresh');
    assert.equal(result.baseSha, 'sha-from-compare-74');
  });
});

test('resolveMergeTarget: 対象識別子（PR番号）がargsの先頭にあれば直接抽出する', () => {
  const result = resolveMergeTarget(['123', '--squash', '--admin'], '/repo');
  assert.equal(result.target, '123');
  assert.equal(result.repoOverride, undefined);
});

test('resolveMergeTarget: -R/--repo の値取りは対象識別子探索から除外する', () => {
  const result = resolveMergeTarget(['-R', 'owner/repo', '123', '--admin'], '/repo');
  assert.equal(result.target, '123');
  assert.equal(result.repoOverride, 'owner/repo');
});

test('resolveMergeTarget: --repo=value 形式でもrepoOverrideを検出する', () => {
  const result = resolveMergeTarget(['123', '--repo=owner/other'], '/repo');
  assert.equal(result.target, '123');
  assert.equal(result.repoOverride, 'owner/other');
});

test('resolveMergeTarget: 対象識別子がargsのどこにあっても（オプション後）検出する', () => {
  const result = resolveMergeTarget(['--admin', '--squash', '456'], '/repo');
  assert.equal(result.target, '456');
});

test('resolveMergeTarget: 値取り型オプション（-b/--body等）の値は対象識別子として誤認識しない', () => {
  const result = resolveMergeTarget(['-b', 'not-a-target', '789'], '/repo');
  assert.equal(result.target, '789');
});

test('resolveMergeTarget: --author-email/-t/-F/--match-head-commit の値も対象識別子として誤認識しない', () => {
  const result = resolveMergeTarget(
    ['-A', 'author@example.com', '-t', 'subject text', '-F', 'body.txt', '--match-head-commit', 'sha123', '999'],
    '/repo',
  );
  assert.equal(result.target, '999');
});

test('resolveMergeTarget: -R/--repoは対象識別子が直接見つかる場合でも同一走査で検出される', () => {
  const result = resolveMergeTarget(['123', '-R', 'owner/other-repo', '--admin'], '/repo');
  assert.equal(result.target, '123');
  assert.equal(result.repoOverride, 'owner/other-repo');
});

// Issue #493実装ゲート2回目是正（warning: repo-shorthand-attached-value-missed）: ghは
// `-R` について値密着の短縮形式（`-Rowner/repo`）も受け付けるが、`=`区切り・フラグ単独＋次要素の
// 2形式しか認識していなかった。この反例を固定回帰させる。
test('resolveMergeTarget: -R値密着形式（-Rowner/repo）でもrepoOverrideを検出する', () => {
  const result = resolveMergeTarget(['123', '-Rowner/repo', '--admin'], '/repo');
  assert.equal(result.target, '123');
  assert.equal(result.repoOverride, 'owner/repo');
});

test('resolveMergeTarget: -R値密着形式は対象識別子より前にあっても検出する', () => {
  const result = resolveMergeTarget(['-Rowner/other', '456'], '/repo');
  assert.equal(result.target, '456');
  assert.equal(result.repoOverride, 'owner/other');
});

test('resolveMergeTarget: --repo（長いオプション名）は値密着形式を認識しない（=区切りのみ許容）', () => {
  // `--repoowner/repo` のような長いオプション名の値密着は gh の慣例に無いため、
  // 対象識別子として誤認識されないことのみ確認する（repoOverrideには反映されない）。
  const result = resolveMergeTarget(['--repoowner/repo', '789'], '/repo');
  assert.equal(result.target, '789');
  assert.equal(result.repoOverride, undefined);
});

test('MergeFailureClassifier.classifyMergeFailure: 権限不足は unrelated', () => {
  assert.equal(
    MergeFailureClassifier.classifyMergeFailure('GraphQL: You do not have permission to merge this pull request'),
    'unrelated',
  );
});

test('MergeFailureClassifier.classifyMergeFailure: 既にマージ済みは unrelated', () => {
  assert.equal(MergeFailureClassifier.classifyMergeFailure('Pull request is already merged'), 'unrelated');
});

test('MergeFailureClassifier.classifyMergeFailure: 既にクローズ済みは unrelated', () => {
  assert.equal(MergeFailureClassifier.classifyMergeFailure('This pull request is closed'), 'unrelated');
});

test('MergeFailureClassifier.classifyMergeFailure: 未知の失敗理由（base branch進行等）は安全側でambiguous', () => {
  assert.equal(
    MergeFailureClassifier.classifyMergeFailure('GraphQL: Base branch was modified. Review and try the merge again.'),
    'ambiguous',
  );
});

test('MergeFailureClassifier.classifyMergeFailure: 空文字列も安全側でambiguous', () => {
  assert.equal(MergeFailureClassifier.classifyMergeFailure(''), 'ambiguous');
});
