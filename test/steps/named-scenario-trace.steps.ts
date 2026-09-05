import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkSpecNormalization } from "../../scripts/check_trace.js";

/** 突合errorの接頭辞。**文字列そのものをassertionの対象にする。** */
const MISSING_LINK =
  "帰属文が名指しするSCNが追跡表の同じ要件へ結線されていません";
const RANGE_ERROR = "帰属文の範囲表記が不正です";
const UNKNOWN_SCN = "帰属文が実在しないSCNを名指ししています";

interface NamedScenarioWorld extends WorkflowWorld {
  root: string;
  errors: string[];
}

const { Given, When, Then } = stepDefinitions<NamedScenarioWorld>();

function write(root: string, relative: string, text: string): void {
  const absolute = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
}

function feature(ids: readonly string[]): string {
  return [
    "@unit",
    "Feature: 例",
    ...ids.map(
      (id) =>
        `\n  Scenario: ${id} 例\n    Given 前提\n    When 操作\n    Then 結果`,
    ),
  ].join("\n");
}

function traceRow(requirement: string, ids: readonly string[]): string {
  return `| ${requirement} | AC-XX-001 | ${ids.join("、")} | unit | \`test/features/unit/例.feature\` | \`scripts/check_trace.ts\` | 合格 |`;
}

function traceTable(rows: readonly string[]): string {
  return [
    "# 追跡表",
    "",
    "| 要件ID | 受け入れ条件ID | シナリオID | テスト層 | Featureパス | 実装 | 結果 |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function requirementDocument(body: string): string {
  return ["# 要件", "", "## REQ-XX-001 例の要件", "", body, ""].join("\n");
}

Given(
  "帰属文の名指しSCNが同要件へ結線されていない仕様がある",
  function (this: NamedScenarioWorld) {
    this.root = this.temp("asc-namedscn-missing-");
    write(
      this.root,
      "docs/specs/02_要件/01_例.md",
      requirementDocument(
        "**この不変条件を強制するのは`SCN-UNIT-XX-002`である。**",
      ),
    );
    write(
      this.root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      traceTable([traceRow("REQ-XX-001", ["SCN-UNIT-XX-001"])]),
    );
    write(
      this.root,
      "test/features/unit/例.feature",
      feature(["SCN-UNIT-XX-001", "SCN-UNIT-XX-002"]),
    );
  },
);

Given(
  "正常な範囲と不正な範囲を含む仕様がある",
  function (this: NamedScenarioWorld) {
    this.root = this.temp("asc-namedscn-range-");
    write(
      this.root,
      "docs/specs/02_要件/01_例.md",
      requirementDocument(
        [
          "**この不変条件を強制するのは`SCN-UNIT-XX-001`から`SCN-UNIT-XX-003`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-003`から`SCN-UNIT-XX-001`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-001`から`SCN-UNIT-YY-003`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-001`から`SCN-UNIT-XX-0003`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-005`から`SCN-UNIT-XX-005`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-006`から`SCN-UNIT-XX-069`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-006`から`SCN-UNIT-XX-070`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-001`から`SCN-UNIT-XX`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-9007199254740992`から`SCN-UNIT-XX-9007199254740992`である。**",
        ].join("\n"),
      ),
    );
    write(
      this.root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      /**
       * **範囲の中間IDだけを結線から外す。** 全件結線すると、両端しか展開しない
       * 実装や先頭1件へ縮退した実装を検出できない（変異試験で実測）。
       */
      traceTable([
        traceRow("REQ-XX-001", [
          "SCN-UNIT-XX-001",
          "SCN-UNIT-XX-003",
          "SCN-UNIT-XX-005",
        ]),
      ]),
    );
    write(
      this.root,
      "test/features/unit/例.feature",
      feature([
        "SCN-UNIT-XX-001",
        "SCN-UNIT-XX-002",
        "SCN-UNIT-XX-003",
        "SCN-UNIT-XX-005",
      ]),
    );
  },
);

Given(
  "否定文と未決文とtilde fence内の帰属文がある仕様がある",
  function (this: NamedScenarioWorld) {
    this.root = this.temp("asc-namedscn-assertion-");
    write(
      this.root,
      "docs/specs/02_要件/01_例.md",
      requirementDocument(
        [
          "この不変条件を強制するのは`SCN-UNIT-XX-009`であるとは限らない。",
          "",
          "この不変条件を強制するのは`SCN-UNIT-XX-009`であるべきではない。",
          "",
          "旧仕様では、この不変条件を強制するのは`SCN-UNIT-XX-009`である、と説明していた。",
          "",
          "この不変条件を強制するのは`SCN-UNIT-XX-009`であるかは未決である。",
          "",
          "~~~markdown",
          "**この不変条件を強制するのは`SCN-UNIT-XX-009`である。**",
          "~~~",
          "",
          /**
           * **4文字fenceの中に3文字fenceと情報付き開始行を置く。** 開始delimiterを
           * 先頭1文字だけで保つ実装は、ここで閉鎖と誤認し後続を本文として抽出する。
           */
          "````markdown",
          "```",
          "**この不変条件を強制するのは`SCN-UNIT-XX-009`である。**",
          "```text",
          "**この不変条件を強制するのは`SCN-UNIT-XX-009`である。**",
          "````",
          "",
          /**
           * **開始と同じ長さの情報付き行を中に置く。** 後続が空白だけであることを
           * 要求しない実装は、ここで閉鎖と誤認して後続の帰属文を本文として抽出する。
           */
          "```markdown",
          "```text",
          "**この不変条件を強制するのは`SCN-UNIT-XX-009`である。**",
          "```",
        ].join("\n"),
      ),
    );
    write(
      this.root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      traceTable([traceRow("REQ-XX-001", ["SCN-UNIT-XX-001"])]),
    );
    write(
      this.root,
      "test/features/unit/例.feature",
      feature(["SCN-UNIT-XX-001"]),
    );
  },
);

Given(
  "soft line breakで折り返した帰属文がある仕様がある",
  function (this: NamedScenarioWorld) {
    this.root = this.temp("asc-namedscn-softbreak-");
    write(
      this.root,
      "docs/specs/02_要件/01_例.md",
      requirementDocument(
        ["**この不変条件を強制するのは", "`SCN-UNIT-XX-002`である。**"].join(
          "\n",
        ),
      ),
    );
    write(
      this.root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      traceTable([traceRow("REQ-XX-001", ["SCN-UNIT-XX-001"])]),
    );
    write(
      this.root,
      "test/features/unit/例.feature",
      feature(["SCN-UNIT-XX-001", "SCN-UNIT-XX-002"]),
    );
  },
);

Given(
  "列挙と範囲を混在させた帰属文と連続した範囲がある仕様がある",
  function (this: NamedScenarioWorld) {
    this.root = this.temp("asc-namedscn-mixed-");
    write(
      this.root,
      "docs/specs/02_要件/01_例.md",
      requirementDocument(
        [
          "**この不変条件を強制するのは`SCN-UNIT-XX-001`と`SCN-UNIT-XX-002`から`SCN-UNIT-XX-004`である。**",
          "",
          "**この不変条件を強制するのは`SCN-UNIT-XX-001`から`SCN-UNIT-XX-002`から`SCN-UNIT-XX-003`である。**",
        ].join("\n"),
      ),
    );
    /** **中間の`SCN-UNIT-XX-003`だけを結線から外す。** 混在形の解釈が誤ると検出できない。 */
    write(
      this.root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      traceTable([
        traceRow("REQ-XX-001", [
          "SCN-UNIT-XX-001",
          "SCN-UNIT-XX-002",
          "SCN-UNIT-XX-004",
        ]),
      ]),
    );
    write(
      this.root,
      "test/features/unit/例.feature",
      feature([
        "SCN-UNIT-XX-001",
        "SCN-UNIT-XX-002",
        "SCN-UNIT-XX-003",
        "SCN-UNIT-XX-004",
      ]),
    );
  },
);

Given(
  "帰属文を持たないSCN参照とcode fence内の帰属文がある仕様がある",
  function (this: NamedScenarioWorld) {
    this.root = this.temp("asc-namedscn-negative-");
    write(
      this.root,
      "docs/specs/02_要件/01_例.md",
      requirementDocument(
        [
          "判定は`SCN-UNIT-XX-009`が示す形に従う。`SCN-UNIT-XX-009`を参照する。",
          "",
          "```markdown",
          "**この不変条件を強制するのは`SCN-UNIT-XX-009`である。**",
          "```",
        ].join("\n"),
      ),
    );
    write(
      this.root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      traceTable([traceRow("REQ-XX-001", ["SCN-UNIT-XX-001"])]),
    );
    write(
      this.root,
      "test/features/unit/例.feature",
      feature(["SCN-UNIT-XX-001"]),
    );
  },
);

Given(
  "名指しSCNが名指し元と別要件の双方へ結線された仕様がある",
  function (this: NamedScenarioWorld) {
    this.root = this.temp("asc-namedscn-shared-");
    write(
      this.root,
      "docs/specs/02_要件/01_例.md",
      [
        "# 要件",
        "",
        "## REQ-XX-001 例の要件",
        "",
        "**この不変条件を強制するのは`SCN-UNIT-XX-001`である。**",
        "",
        "## REQ-XX-002 別の要件",
        "",
        "**この不変条件を強制するのは`SCN-UNIT-XX-002`である。**",
        "",
      ].join("\n"),
    );
    /**
     * **`SCN-UNIT-XX-001`は2要件へ結線する。** 追跡は多対多であり、他要件にも
     * 在ること自体は欠陥ではない。**`SCN-UNIT-XX-002`はREQ-XX-001へだけ結線する。**
     * 名指し元のREQ-XX-002へは辺が無く、これが検出対象である。
     */
    write(
      this.root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      traceTable([
        traceRow("REQ-XX-001", ["SCN-UNIT-XX-001", "SCN-UNIT-XX-002"]),
        traceRow("REQ-XX-003", ["SCN-UNIT-XX-001"]),
      ]),
    );
    write(
      this.root,
      "test/features/unit/例.feature",
      feature(["SCN-UNIT-XX-001", "SCN-UNIT-XX-002"]),
    );
  },
);

When(
  "帰属文の突合を含む仕様正規化検査を実行する",
  function (this: NamedScenarioWorld) {
    this.errors = [...checkSpecNormalization(this.root).errors];
  },
);

Then(
  "要件IDと不足SCNと本文位置を名指しして拒否される",
  function (this: NamedScenarioWorld) {
    const reported = this.errors.filter((error) =>
      error.startsWith(MISSING_LINK),
    );
    assert.equal(reported.length, 1, this.errors.join("\n"));
    /**
     * **4項目すべてが本文に出ることを見る。** 件数やvalidだけのassertionは、
     * 診断から項目が落ちる変異を素通しする。
     */
    assert.ok(reported[0].includes("REQ-XX-001"), reported[0]);
    assert.ok(reported[0].includes("SCN-UNIT-XX-002"), reported[0]);
    assert.ok(
      reported[0].includes("docs/specs/02_要件/01_例.md:"),
      reported[0],
    );
    assert.ok(!reported[0].includes("SCN-UNIT-XX-001"), reported[0]);
  },
);

Then(
  "正常な範囲は連番展開され不正な範囲は明示errorになる",
  function (this: NamedScenarioWorld) {
    /**
     * **中間IDが不足として報告されることで展開の正しさを見る。** 両端だけを列挙する
     * 実装や先頭1件へ縮退した実装では`SCN-UNIT-XX-002`が現れない。
     */
    const missing = this.errors.filter((error) =>
      error.startsWith(MISSING_LINK),
    );
    const missingText = missing.join("\n");
    assert.ok(missingText.includes("SCN-UNIT-XX-002"), missingText);
    assert.ok(!missingText.includes("SCN-UNIT-XX-003"), missingText);
    const ranges = this.errors.filter((error) => error.startsWith(RANGE_ERROR));
    assert.equal(ranges.length, 6, ranges.join("\n"));
    assert.ok(
      ranges.some((error) => error.includes("開始が終了より大きい")),
      ranges.join("\n"),
    );
    assert.ok(
      ranges.some((error) => error.includes("prefixが一致しません")),
      ranges.join("\n"),
    );
    assert.ok(
      ranges.some((error) => error.includes("桁数が一致しません")),
      ranges.join("\n"),
    );
    assert.ok(
      ranges.some((error) => error.includes("上限64を超えます")),
      ranges.join("\n"),
    );
    assert.ok(
      ranges.some((error) => error.includes("末尾数字のSCN IDではありません")),
      ranges.join("\n"),
    );
    /** **`AからA`は1件として展開される。** 結線済みなので不足に現れない。 */
    assert.ok(!missingText.includes("SCN-UNIT-XX-005"), missingText);
    /**
     * **上限ちょうど64件は展開される。** fixtureに定義の無いIDなので不足ではなく
     * 実在しないSCNとして報告される。**両端が揃って現れることで、始端も終端も
     * 落としていないことが分かる。**
     */
    const unknown = this.errors
      .filter((error) => error.startsWith(UNKNOWN_SCN))
      .join("\n");
    assert.ok(unknown.includes("SCN-UNIT-XX-006"), unknown);
    assert.ok(unknown.includes("SCN-UNIT-XX-069"), unknown);
    assert.ok(unknown.includes("SCN-UNIT-XX-037"), unknown);
  },
);

Then(
  "安全整数を超える数値部は展開されず検査が停止しない",
  function (this: NamedScenarioWorld) {
    /**
     * **`2^53`を超える数値部は`value += 1`が値を変えずloopが終わらない。**
     * 展開件数の上限は差分が1と評価されるため防御にならない（Issue #1229 H-01）。
     * ここまで到達していること自体が停止の証拠である。
     */
    assert.ok(
      this.errors.some(
        (error) =>
          error.startsWith(RANGE_ERROR) &&
          error.includes("桁数上限12を超えます"),
      ),
      this.errors.join("\n"),
    );
  },
);

Then(
  "折り返した帰属文の不足SCNが本文位置とともに報告される",
  function (this: NamedScenarioWorld) {
    const reported = this.errors.filter((error) =>
      error.startsWith(MISSING_LINK),
    );
    assert.equal(reported.length, 1, this.errors.join("\n"));
    assert.ok(reported[0].includes("SCN-UNIT-XX-002"), reported[0]);
    /** **本文位置は帰属文の開始行を指す。** 折り返し後の行を指すと原文へ辿れない。 */
    assert.ok(reported[0].includes("01_例.md:5"), reported[0]);
  },
);

Then(
  "混在した範囲の中間IDが不足として報告され連続した範囲は明示errorになる",
  function (this: NamedScenarioWorld) {
    const reported = this.errors.filter((error) =>
      error.startsWith(MISSING_LINK),
    );
    assert.equal(reported.length, 1, this.errors.join("\n"));
    /** **`A と B から D` は A と B..D である。** 両端だけを見る実装では C が消える。 */
    assert.ok(reported[0].includes("SCN-UNIT-XX-003"), reported[0]);
    assert.ok(!reported[0].includes("SCN-UNIT-XX-001"), reported[0]);
    assert.ok(
      this.errors.some(
        (error) =>
          error.startsWith(RANGE_ERROR) && error.includes("範囲表記が連続"),
      ),
      this.errors.join("\n"),
    );
  },
);

Then("帰属文の突合errorは報告されない", function (this: NamedScenarioWorld) {
  assert.deepEqual(
    this.errors.filter(
      (error) =>
        error.startsWith(MISSING_LINK) ||
        error.startsWith(RANGE_ERROR) ||
        error.startsWith(UNKNOWN_SCN),
    ),
    [],
    this.errors.join("\n"),
  );
});

Then(
  "多対多に結線された名指しは不足として報告されない",
  function (this: NamedScenarioWorld) {
    /**
     * **追跡は多対多である。** 名指しSCNが他要件へも結線されていること自体は
     * 欠陥ではない。排他的所属を要求すると正しい追跡を落とす。
     */
    assert.ok(
      !this.errors.some(
        (error) =>
          error.startsWith(MISSING_LINK) && error.includes("SCN-UNIT-XX-001"),
      ),
      this.errors.join("\n"),
    );
  },
);

Then(
  "別要件からのみ到達できる名指しは不足として報告される",
  function (this: NamedScenarioWorld) {
    const reported = this.errors.filter((error) =>
      error.startsWith(MISSING_LINK),
    );
    assert.equal(reported.length, 1, this.errors.join("\n"));
    assert.ok(reported[0].includes("REQ-XX-002"), reported[0]);
    assert.ok(reported[0].includes("SCN-UNIT-XX-002"), reported[0]);
  },
);
