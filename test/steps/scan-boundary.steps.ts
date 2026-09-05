import assert from "node:assert/strict";
import {
  compareScanBoundary,
  observeScanBoundary,
  type GateExclusionSource,
  type ScanBoundaryComparison,
  type ScanBoundaryObservation,
} from "../../src/domain/scan-boundary.js";
import { isIssueStagingPath } from "../../src/domain/staging.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

/**
 * 代表的なignored生成物。
 *
 * **対象codeから導出しない。** `git status --porcelain --ignored=matching`の実測から
 * 独立に列挙する。対象から導出すると、除外規則と期待値が同じ向きにずれたときに
 * 変異を検出できない。
 */
const REPRESENTATIVE_IGNORED_PATHS: readonly string[] = Object.freeze([
  ".agent-skill-chain/tmp/issues/20260101_000000_例/00_要求定義.md",
  ".agent-skill-chain/tmp/issues/20260101_000000_例/journal/steps.jsonl",
  ".claude/hooks/例.sh",
  "dist/src/domain/例.d.ts",
]);

const TRACKED_PATHS: readonly string[] = Object.freeze([
  "src/domain/staging.ts",
  "test/features/unit/scan-boundary.feature",
]);

const STAGING_SOURCE: GateExclusionSource = {
  gate: "trace:check",
  reason: "Issue一時ステージングをSCN配置検査の走査範囲から除く",
  excludes: isIssueStagingPath,
};

/** 除外述語を無効化した反例。**除外規則そのものを消す変異に相当する。** */
const DISABLED_SOURCE: GateExclusionSource = {
  ...STAGING_SOURCE,
  excludes: () => false,
};

class ScanBoundaryWorld extends WorkflowWorld {
  sources: GateExclusionSource[] = [];
  gates: string[] = [];
  paths: string[] = [];
  observation?: ScanBoundaryObservation;
  baseline?: ScanBoundaryObservation;
  contaminated?: ScanBoundaryObservation;
  comparison?: ScanBoundaryComparison;
}

const { Given, When, Then } = stepDefinitions<ScanBoundaryWorld>();

function observe(
  gates: readonly string[],
  paths: readonly string[],
  sources: readonly GateExclusionSource[],
): ScanBoundaryObservation {
  return observeScanBoundary({ gates, paths, sources });
}

Given("走査境界の観測入力がある", function (this: ScanBoundaryWorld) {
  this.sources = [STAGING_SOURCE];
  this.gates = ["trace:check", "未登録:check"];
  this.paths = [
    ...TRACKED_PATHS,
    ...REPRESENTATIVE_IGNORED_PATHS,
    "/absolute/path.ts",
    "src/../src/domain/staging.ts",
  ];
});

Given(
  "除外述語を公開していないgateを含む観測入力がある",
  function (this: ScanBoundaryWorld) {
    this.sources = [
      STAGING_SOURCE,
      {
        gate: "source:check",
        reason: "除外directory集合が非公開定数でありmoduleとして参照できません",
        excludes: undefined,
      },
    ];
    this.gates = ["trace:check", "source:check", "未登録:check"];
    this.paths = [...TRACKED_PATHS, "/absolute/path.ts"];
  },
);

Given(
  "代表ignored生成物を足した観測と足さない観測がある",
  function (this: ScanBoundaryWorld) {
    this.baseline = observe(["trace:check"], TRACKED_PATHS, [STAGING_SOURCE]);
    this.contaminated = observe(
      ["trace:check"],
      [
        ...TRACKED_PATHS,
        ...REPRESENTATIVE_IGNORED_PATHS.filter((relative) =>
          isIssueStagingPath(relative),
        ),
      ],
      [STAGING_SOURCE],
    );
  },
);

Given(
  "除外述語を無効化した走査境界の観測がある",
  function (this: ScanBoundaryWorld) {
    this.baseline = observe(["trace:check"], TRACKED_PATHS, [DISABLED_SOURCE]);
    this.contaminated = observe(
      ["trace:check"],
      [
        ...TRACKED_PATHS,
        ...REPRESENTATIVE_IGNORED_PATHS.filter((relative) =>
          isIssueStagingPath(relative),
        ),
      ],
      [DISABLED_SOURCE],
    );
  },
);

When("走査境界を観測する", function (this: ScanBoundaryWorld) {
  this.observation = observe(this.gates, this.paths, this.sources);
});

When("2つの観測を比較する", function (this: ScanBoundaryWorld) {
  this.comparison = compareScanBoundary(this.baseline!, this.contaminated!);
});

Then(
  "gateごとにpathとincluded・excludedと理由codeと件数が返る",
  function (this: ScanBoundaryWorld) {
    const observed = this.observation!;
    const gate = observed.gates.find((entry) => entry.gate === "trace:check");
    assert.ok(gate, "登録済みgateの観測がありません");
    assert.equal(gate.includedCount, gate.included.length);
    assert.equal(gate.excludedCount, gate.excluded.length);
    /**
     * **除外側に理由が付いていることまで見る。** 件数だけを数えるassertionは、
     * 理由を落とす変異を素通しする。
     */
    assert.ok(gate.excludedCount > 0, "代表生成物が1件も除外されていません");
    for (const entry of gate.excluded)
      assert.ok(entry.reason.length > 0, `除外理由が空です: ${entry.path}`);
    assert.ok(
      gate.included.includes("src/domain/staging.ts"),
      gate.included.join(" "),
    );
  },
);

Then(
  "未知のgate keyとroot外pathと相対参照は不完全として報告される",
  function (this: ScanBoundaryWorld) {
    const observed = this.observation!;
    assert.equal(observed.complete, false);
    const codes = observed.incomplete.map((entry) => entry.code);
    assert.ok(codes.includes("unknown-gate"), codes.join(" "));
    assert.ok(codes.includes("unresolvable-path"), codes.join(" "));
    /**
     * **判定不能なpathがincludedにもexcludedにも現れないことを見る。**
     * 除外側へ倒すと、走査から外れたのか判定できなかったのかを区別できない。
     */
    for (const gate of observed.gates) {
      const all = [...gate.included, ...gate.excluded.map((e) => e.path)];
      assert.ok(!all.includes("/absolute/path.ts"), all.join(" "));
      assert.ok(!all.includes("src/../src/domain/staging.ts"), all.join(" "));
    }
  },
);

Then(
  "走査差分は0より大きく判定差分は0になる",
  function (this: ScanBoundaryWorld) {
    const comparison = this.comparison!;
    assert.equal(comparison.comparable, true);
    assert.ok(comparison.scopeDelta > 0, `scopeDelta=${comparison.scopeDelta}`);
    assert.equal(comparison.semanticDelta, 0, comparison.detail);
    assert.deepEqual(comparison.contributingPaths, []);
  },
);

Then(
  "判定差分が0より大きく寄与pathが名指しされる",
  function (this: ScanBoundaryWorld) {
    const comparison = this.comparison!;
    assert.equal(comparison.comparable, true);
    assert.ok(
      comparison.semanticDelta > 0,
      `semanticDelta=${comparison.semanticDelta}`,
    );
    /**
     * **寄与pathの中身まで見る。** 件数だけのassertionは、寄与pathを空で返す
     * 変異を素通しする。
     */
    assert.ok(
      comparison.contributingPaths.includes(
        ".agent-skill-chain/tmp/issues/20260101_000000_例/00_要求定義.md",
      ),
      comparison.contributingPaths.join(" "),
    );
    assert.ok(
      comparison.detail.includes("除外が効いていない"),
      comparison.detail,
    );
  },
);

Then(
  "述語未公開と未知gateと判定不能pathが別の理由codeで報告される",
  function (this: ScanBoundaryWorld) {
    const observed = this.observation!;
    assert.equal(observed.complete, false);
    const byCode = new Map(
      observed.incomplete.map((entry) => [entry.code, entry]),
    );
    assert.ok(byCode.has("predicate-unavailable"), "述語未公開が報告されない");
    assert.ok(byCode.has("unknown-gate"), "未知gateが報告されない");
    assert.ok(byCode.has("unresolvable-path"), "判定不能pathが報告されない");
    assert.equal(byCode.get("predicate-unavailable")!.gate, "source:check");
    assert.equal(byCode.get("unknown-gate")!.gate, "未登録:check");
    /**
     * **述語未公開のgateを観測結果へ含めない。** 含めると「除外0件」として
     * 観測できたように見える。
     */
    assert.ok(
      !observed.gates.some((gate) => gate.gate === "source:check"),
      observed.gates.map((gate) => gate.gate).join(" "),
    );
  },
);

Then(
  "対象gate一覧が一致しない2観測の比較は拒否される",
  function (this: ScanBoundaryWorld) {
    const left = observe(["trace:check"], TRACKED_PATHS, [STAGING_SOURCE]);
    const right = observe(["trace:check", "directories:check"], TRACKED_PATHS, [
      STAGING_SOURCE,
      { ...STAGING_SOURCE, gate: "directories:check" },
    ]);
    const comparison = compareScanBoundary(left, right);
    assert.equal(comparison.comparable, false);
    assert.equal(comparison.semanticDelta, 0);
    assert.ok(
      comparison.detail.includes("directories:check"),
      comparison.detail,
    );
  },
);
