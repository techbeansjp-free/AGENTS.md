import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMergeTarget, MergeFailureClassifier } from '../../src/lib/pr-freshness.js';

// resolveMergeTarget() の args 解析（`gh` 呼び出しを要さない、対象識別子が args から直接
// 見つかるケース）のみを対象とする単体テスト。cwdベースの暗黙解決フォールバック（`gh pr view`
// 呼び出しを要する）は test/integration/pr-merge.test.ts のAC-4/AC-5が gh-stub 経由で検証する。

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
