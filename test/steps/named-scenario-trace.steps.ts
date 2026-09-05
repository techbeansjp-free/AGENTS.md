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
        traceRow("REQ-XX-001", ["SCN-UNIT-XX-001", "SCN-UNIT-XX-003"]),
      ]),
    );
    write(
      this.root,
      "test/features/unit/例.feature",
      feature(["SCN-UNIT-XX-001", "SCN-UNIT-XX-002", "SCN-UNIT-XX-003"]),
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
    assert.equal(missing.length, 1, this.errors.join("\n"));
    assert.ok(missing[0].includes("SCN-UNIT-XX-002"), missing[0]);
    assert.ok(!missing[0].includes("SCN-UNIT-XX-001"), missing[0]);
    assert.ok(!missing[0].includes("SCN-UNIT-XX-003"), missing[0]);
    const ranges = this.errors.filter((error) => error.startsWith(RANGE_ERROR));
    assert.equal(ranges.length, 3, ranges.join("\n"));
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
