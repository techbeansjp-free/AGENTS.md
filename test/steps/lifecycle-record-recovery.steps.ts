import assert from "node:assert/strict";
import * as lifecycle from "../../src/domain/lifecycle.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * 1資産の分類の期待表（Issue #1305）。
 *
 * **期待値を製品の実装から導出しない。** 導出すると両側が同じ向きへずれ、
 * 分類を狭める変異も広げる変異も検出できなくなる。ここへ書き写した表が
 * 実装と食い違えば、この検査が落ちる。
 */
interface ClassificationRow {
  readonly label: string;
  readonly exists: boolean;
  readonly regularFile: boolean;
  readonly expected: string | undefined;
  readonly destDigest: string;
  readonly sourceDigest: string;
  readonly classification: string;
}

const DEST = "1111111111111111111111111111111111111111111111111111111111111111";
const SOURCE =
  "2222222222222222222222222222222222222222222222222222222222222222";

const ROWS: readonly ClassificationRow[] = [
  {
    label: "不在なら正本を配置する",
    exists: false,
    regularFile: false,
    expected: undefined,
    destDigest: DEST,
    sourceDigest: SOURCE,
    classification: "place",
  },
  {
    label: "非通常fileは上書きせず保持する",
    exists: true,
    regularFile: false,
    expected: DEST,
    destDigest: DEST,
    sourceDigest: SOURCE,
    classification: "retain",
  },
  {
    label: "記録があり実digestが期待どおりなら上書きする",
    exists: true,
    regularFile: true,
    expected: DEST,
    destDigest: DEST,
    sourceDigest: SOURCE,
    classification: "overwrite",
  },
  {
    label: "記録があり実digestが期待と違えば保持する",
    exists: true,
    regularFile: true,
    expected: SOURCE,
    destDigest: DEST,
    sourceDigest: SOURCE,
    classification: "retain",
  },
  {
    label: "記録が無く正本とbyte一致なら採用する",
    exists: true,
    regularFile: true,
    expected: undefined,
    destDigest: SOURCE,
    sourceDigest: SOURCE,
    classification: "adopt",
  },
  {
    label: "記録が無く正本と相違するなら保持する",
    exists: true,
    regularFile: true,
    expected: undefined,
    destDigest: DEST,
    sourceDigest: SOURCE,
    classification: "retain",
  },
];

/**
 * 分類の列挙が増減したら落ちるようにする。**件数だけを数えない。**
 * 新しい分類を足したまま表を更新しなければ、この検査が落ちる。
 */
const CLASSIFICATIONS: Readonly<Record<string, true>> = {
  place: true,
  overwrite: true,
  adopt: true,
  retain: true,
};

interface RecoveryWorld extends WorkflowWorld {
  classified?: string[];
}

const { Given, When, Then } = stepDefinitions<RecoveryWorld>();

Given("1資産の分類が取り得る入力の全件表がある", function () {
  assert.equal(ROWS.length, 6);
  const labels = new Set(ROWS.map((row) => row.label));
  assert.equal(labels.size, ROWS.length);
});

When("分類の純関数へ全件表の各行を渡す", function () {
  const classify = (
    lifecycle as unknown as {
      classifyManagedAsset?: (input: {
        exists: boolean;
        regularFile: boolean;
        expected: string | undefined;
        destDigest: string;
        sourceDigest: string;
      }) => string;
    }
  ).classifyManagedAsset;
  assert.ok(
    typeof classify === "function",
    "classifyManagedAssetがexportされていません",
  );
  this.classified = ROWS.map((row) =>
    classify({
      exists: row.exists,
      regularFile: row.regularFile,
      expected: row.expected,
      destDigest: row.destDigest,
      sourceDigest: row.sourceDigest,
    }),
  );
});

Then("各行は表が定める分類を返し記録の無い相違資産は保持になる", function () {
  const classified = this.classified;
  assert.ok(classified, "分類結果がありません");
  assert.equal(classified.length, ROWS.length);
  for (const [index, row] of ROWS.entries())
    assert.equal(
      classified[index],
      row.classification,
      `${row.label}: ${row.classification}を期待したが${String(classified[index])}だった`,
    );
  for (const value of classified)
    assert.ok(
      CLASSIFICATIONS[value],
      `未知の分類です: ${value}。分類の列挙が増えたら期待表も更新してください`,
    );
  /**
   * **記録が無く相違する資産がoverwriteへ倒れないことを名指しで固定する。**
   * INV-01の本体である。
   */
  const unrecordedDifferent = ROWS.findIndex(
    (row) =>
      row.exists &&
      row.regularFile &&
      row.expected === undefined &&
      row.destDigest !== row.sourceDigest,
  );
  assert.notEqual(unrecordedDifferent, -1);
  assert.equal(classified[unrecordedDifferent], "retain");
});
