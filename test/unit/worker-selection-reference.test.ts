import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

// AC-4 の恒久検査（受入条件ID形式・自己参照的「本Issue」文言）と AC-5 の自己検証テストケースの
// 両方が同一の正規表現を用いていることを保証するため、リテラルを1箇所に集約して共有する。
const ACCEPTANCE_CRITERIA_ID_PATTERN = /AC-[0-9]+/;
const SELF_REFERENTIAL_ISSUE_PATTERN = /本 ?Issue/;

test('ISSUE-325 AC-1/AC-4: worker選択のコメントに禁止された設計書参照がない', () => {
  for (const relativePath of [
    '.agent-skill-chain/scripts/worker-launch.sh',
    'src/lib/worker-selection.ts',
  ]) {
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

    assert.doesNotMatch(contents, /DESIGN\.md §/, `${relativePath} に禁止参照がないこと`);
  }
});

test('ISSUE-325 AC-4: worker-selection.ts に破棄されたSPEC.mdの受入条件ID参照が残存しない', () => {
  const contents = fs.readFileSync(path.join(repositoryRoot, 'src/lib/worker-selection.ts'), 'utf8');

  assert.doesNotMatch(
    contents,
    ACCEPTANCE_CRITERIA_ID_PATTERN,
    'src/lib/worker-selection.ts に受入条件ID形式（AC-数字）の参照が残っていないこと',
  );
});

test('ISSUE-325 AC-4: worker-selection.ts に自己参照的な「本Issue」文言が残存しない', () => {
  const contents = fs.readFileSync(path.join(repositoryRoot, 'src/lib/worker-selection.ts'), 'utf8');

  assert.doesNotMatch(
    contents,
    SELF_REFERENTIAL_ISSUE_PATTERN,
    'src/lib/worker-selection.ts に「本Issue」「本 Issue」という自己参照的文言が残っていないこと',
  );
});

test('ISSUE-325 AC-5: 回帰防止テストの正規表現が陳腐化パターン混入を実際に検知できることを自己検証する', () => {
  // 実ファイル src/lib/worker-selection.ts は読み取り専用で使うのみで、一切書き戻さない。
  // 上記2つのAC-4恒久検査が使う正規表現（ACCEPTANCE_CRITERIA_ID_PATTERN・
  // SELF_REFERENTIAL_ISSUE_PATTERN）そのものを、意図的に汚染したin-memory文字列に適用し、
  // 正規表現自体が陳腐化パターンを検知する能力を保持していることを検証する。
  // これにより、将来これらの正規表現の書き方が壊れて検知力を失っても、この自己検証テスト
  // ケース自体が失敗することで気付ける（回帰防止テストに対する回帰防止＝メタテスト）。
  //
  // 単一実例のみでは、正規表現が特定の桁数・空白パターンへ縮退しても気付けない
  // （vacuous pass）。桁数違い（1桁・2桁・3桁）／空白有無違いの複数独立fixtureを
  // それぞれ独立した assert.match で検証することでこれを防ぐ
  // （DESIGN.md「回帰防止テストの拡張設計」参照）。各fixtureは実在の受入条件番号
  // （AC-1〜AC-5）と紛れない数字を用いる。

  // 意図的な合成fixture。実際の陳腐化参照ではなくAC-5自己検証専用のテストデータであり、
  // Issue #332（test/配下の陳腐化参照一掃）の対象から除外する。
  const oneDigitAcFixture = '// 正本: AGENTS.md §設定 / SPEC.md AC-9';
  // 意図的な合成fixture。実際の陳腐化参照ではなくAC-5自己検証専用のテストデータであり、
  // Issue #332（test/配下の陳腐化参照一掃）の対象から除外する。
  const twoDigitAcFixture = 'adapter は◯◯・△△・□□（AC-42, AC-43）の順で解決する';
  // 意図的な合成fixture。実際の陳腐化参照ではなくAC-5自己検証専用のテストデータであり、
  // Issue #332（test/配下の陳腐化参照一掃）の対象から除外する。
  const threeDigitAcFixture = 'SPEC.md AC-777 スコープ外: claude/human 用モデルの追加';

  assert.match(
    oneDigitAcFixture,
    ACCEPTANCE_CRITERIA_ID_PATTERN,
    '正規表現 /AC-[0-9]+/ が1桁の受入条件ID形式（例: AC-9）に対して実際にマッチすること',
  );
  assert.match(
    twoDigitAcFixture,
    ACCEPTANCE_CRITERIA_ID_PATTERN,
    '正規表現 /AC-[0-9]+/ が2桁の受入条件ID形式（例: AC-42）に対して実際にマッチすること',
  );
  assert.match(
    threeDigitAcFixture,
    ACCEPTANCE_CRITERIA_ID_PATTERN,
    '正規表現 /AC-[0-9]+/ が3桁の受入条件ID形式（例: AC-777）に対して実際にマッチすること',
  );

  // 意図的な合成fixture。実際の陳腐化参照ではなくAC-5自己検証専用のテストデータであり、
  // Issue #332（test/配下の陳腐化参照一掃）の対象から除外する。
  const spacedIssueFixture = '本 Issue のスコープ外';
  // 意図的な合成fixture。実際の陳腐化参照ではなくAC-5自己検証専用のテストデータであり、
  // Issue #332（test/配下の陳腐化参照一掃）の対象から除外する。
  const unspacedIssueFixture = '本Issueで許容するアダプタキーは codex のみ';

  assert.match(
    spacedIssueFixture,
    SELF_REFERENTIAL_ISSUE_PATTERN,
    '正規表現 /本 ?Issue/ が空白ありパターン「本 Issue」に対して実際にマッチすること',
  );
  assert.match(
    unspacedIssueFixture,
    SELF_REFERENTIAL_ISSUE_PATTERN,
    '正規表現 /本 ?Issue/ が空白無しパターン「本Issue」に対して実際にマッチすること',
  );
});
