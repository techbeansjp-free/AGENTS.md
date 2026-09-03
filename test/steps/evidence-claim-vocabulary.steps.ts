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

Given("code fence内に裸の性質主張があるreview artifactがある", function () {
  /**
   * **説明用code block内の表である。** fence状態を追跡しないと実表として解析され、
   * 実データでない例で`audit:check`が落ちる（Issue #1188のF-01）。
   */
  this.artifact = [
    "## 3. 肯定的評価",
    "",
    "```markdown",
    "| 観点 | 判定 | 根拠 |",
    "|---|---|---|",
    "| 保守性 | pass | 判定は純関数へ分離した |",
    "```",
    "",
  ].join("\n");
});

Given(
  "閉じないcode fenceの後に裸の性質主張があるreview artifactがある",
  function () {
    /**
     * **閉じないfence以降は対象外にする。** 「閉じていないので本文」とすると、
     * fenceを開くだけで残り全体を検査対象へ戻せる。
     */
    this.artifact = [
      "## 3. 肯定的評価",
      "",
      "~~~text",
      "| 観点 | 判定 | 根拠 |",
      "|---|---|---|",
      "| 保守性 | pass | 判定は純関数へ分離した |",
      "",
    ].join("\n");
  },
);

Given(
  "証拠のあるcellと裸のcellへ別の登録語彙があるreview artifactがある",
  function () {
    /**
     * **`idempotent`が1列目、`pure function`が3列目にある。** 宣言順で最初に
     * 一致する`pure function`だけを見る実装では、3列目のSCN併記で通ってしまい
     * 1列目の裸の`idempotent`が検査されない（Issue #1188のF-02）。
     */
    this.artifact = artifactWithRow(
      "| 観点 | 判定 | 根拠 |",
      "| idempotent | pass | pure functionである。SCN-UNIT-EXAMPLE-001で固定する |",
    );
  },
);

Given(
  "同じ登録語彙が証拠ありcellと裸cellの両方にあるreview artifactがある",
  function () {
    this.artifact = artifactWithRow(
      "| 観点 | 判定 | 根拠 |",
      "| 純関数である | pass | 純関数である。SCN-UNIT-EXAMPLE-001で固定する |",
    );
  },
);

Given(
  "判定列がp assの行へ裸の性質主張があるreview artifactがある",
  function () {
    /**
     * **`p ass`は`pass`ではない。** 内部の空白まで削る正規化では`pass`と読まれ、
     * 判定列を厳密な`pass`に限る仕様から外れる（Issue #1188のF-04）。
     */
    this.artifact = artifactWithRow(
      "| 観点 | 判定 | 根拠 |",
      "| 保守性 | p ass | 判定は純関数へ分離した |",
    );
  },
);

Given(
  "pass行へ登録語彙そのものを引用した性質主張があるreview artifactがある",
  function () {
    /**
     * **循環引用である。** 「純関数である。根拠は `純関数`」は、引用が証拠として
     * 機能していないことが字面だけで確定する（Issue #1188のF-03）。
     */
    this.artifact = artifactWithRow(
      "| 観点 | 判定 | 根拠 |",
      "| 保守性 | pass | 判定は純関数である。根拠は `純関数` |",
    );
  },
);

Then("証拠の無い語彙だけが1件拒否される", function () {
  assert.equal(this.claimFindings.length, 1);
  assert.match(this.claimFindings[0] ?? "", /「idempotent」/u);
});

Given(
  "backtick fence内にtilde行と裸の性質主張があるreview artifactがある",
  function () {
    /**
     * **開いたfenceは同じ記号でだけ閉じる。** 記号を問わず閉じる実装では、
     * fence内の`~~~`行がbacktick fenceを閉じてしまい、以降の表が実表として
     * 解析される。
     */
    this.artifact = [
      "## 3. 肯定的評価",
      "",
      "```markdown",
      "~~~",
      "| 観点 | 判定 | 根拠 |",
      "|---|---|---|",
      "| 保守性 | pass | 判定は純関数へ分離した |",
      "```",
      "",
    ].join("\n");
  },
);

Given(
  "cell内にfence記号を含む裸の性質主張があるreview artifactがある",
  function () {
    /**
     * **fence記号の判定を行頭に限る。** 行のどこかにあれば開始と読む実装では、
     * cell内でfence記号に言及しただけでその行が検査対象から外れる。
     */
    this.artifact = artifactWithRow(
      "| 観点 | 判定 | 根拠 |",
      "| 保守性 | pass | fenceは ~~~ で書く。判定は純関数へ分離した |",
    );
  },
);
