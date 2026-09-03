import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { unsupportedClaimRows } from "../../scripts/check_file_audit.js";

interface ClaimVocabularyWorld extends WorkflowWorld {
  artifact: string;
  claimFindings: string[];
}

const { Given, When, Then } = stepDefinitions<ClaimVocabularyWorld>();

/** 判定列を持つ表を1つだけ持つ最小のreview artifactを作る。 */
function artifactWithRow(header: string, row: string): string {
  return ["## 3. 肯定的評価", "", header, "|---|---|---|", row, ""].join("\n");
}

Given(
  "pass行へ検証の併記がない性質主張があるreview artifactがある",
  function () {
    this.artifact = artifactWithRow(
      "| 観点 | 判定 | 根拠 |",
      "| 保守性 | pass | 判定は純関数へ分離した |",
    );
  },
);

Given(
  "pass行へSCN IDを併記した性質主張があるreview artifactがある",
  function () {
    this.artifact = artifactWithRow(
      "| 観点 | 判定 | 根拠 |",
      "| 保守性 | pass | 判定は純関数へ分離した。SCN-UNIT-EXAMPLE-001で固定する |",
    );
  },
);

Given(
  "pass行へ原文引用を併記した性質主張があるreview artifactがある",
  function () {
    this.artifact = artifactWithRow(
      "| 観点 | 判定 | 根拠 |",
      "| 保守性 | pass | 判定は純関数へ分離した。`const value = compute(input);` |",
    );
  },
);

Given("not-applicable行へ裸の性質主張があるreview artifactがある", function () {
  this.artifact = artifactWithRow(
    "| 観点 | 判定 | 根拠 |",
    "| 損失 | not-applicable | 読み取り側の純関数であり書き込み単位を変えていない |",
  );
});

Given("判定列のない表へ裸の性質主張があるreview artifactがある", function () {
  this.artifact = artifactWithRow(
    "| 観点 | 内容 | 備考 |",
    "| 保守性 | 判定は純関数へ分離した | pass |",
  );
});

Given(
  "個別判定列のpass行へ裸の性質主張があるreview artifactがある",
  function () {
    this.artifact = artifactWithRow(
      "| path | 責務 | 個別判定 |",
      "| `src/a.ts` | 判定は純関数1つ | pass |",
    );
  },
);

Given("pass行へ登録外の全称語だけがあるreview artifactがある", function () {
  this.artifact = artifactWithRow(
    "| 観点 | 判定 | 根拠 |",
    "| 保守性 | pass | 常に同じ結果になり、必ず成立する |",
  );
});

/**
 * **判定列が無い表は、末尾cellが`pass`でも対象にしない。**
 *
 * 判定列の特定を外すと`cells[-1]`が`undefined`になり`pass`限定で弾かれるため、
 * 判定列の特定だけを消した変異は他のscenarioでは検出できない。末尾cellを
 * `pass`にすることで、**判定列の特定が実際に効いているか**を区別する。
 */
Given(
  "判定列が無く末尾cellがpassの表へ裸の性質主張があるreview artifactがある",
  function () {
    this.artifact = artifactWithRow(
      "| 観点 | 内容 | 備考 |",
      "| 保守性 | 判定は純関数へ分離した | pass |",
    );
  },
);

When("pass根拠の性質主張を検査する", function () {
  this.claimFindings = unsupportedClaimRows(this.artifact);
});

Then("検証を伴わない主張として拒否される", function () {
  assert.equal(this.claimFindings.length, 1, this.claimFindings.join("; "));
  assert.match(
    this.claimFindings[0] as string,
    /pass判定の根拠へ検証を伴わない性質の主張があります/u,
  );
});

Then("検証を伴わない主張は0件である", function () {
  assert.deepEqual(this.claimFindings, []);
});
