import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  compareScanBoundary,
  observeScanBoundary,
  type ExclusionPredicateSource,
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
const COVERED_ARTIFACTS: readonly string[] = Object.freeze([
  ".agent-skill-chain/tmp/issues/20260101_000000_例/00_要求定義.md",
  ".agent-skill-chain/tmp/issues/20260101_000000_例/journal/steps.jsonl",
]);

/** どの登録済み述語にも掛からない生成物。**本日の`source:check`の実障害と同型。** */
const UNCOVERED_ARTIFACTS: readonly string[] = Object.freeze([
  ".claude/hooks/例.sh",
  "dist/src/domain/例.d.ts",
]);

const TRACKED_PATHS: readonly string[] = Object.freeze([
  "src/domain/staging.ts",
  "test/features/unit/scan-boundary.feature",
]);

const STAGING_PREDICATE: ExclusionPredicateSource = {
  id: "issue-staging",
  owner: "trace:check",
  appliesTo: "SCN配置検査の走査範囲のみ",
  reasonCode: "issue-staging",
  reason: "Issue一時ステージングをSCN配置検査の走査範囲から除く",
  excludes: isIssueStagingPath,
};

const UNAVAILABLE_PREDICATE: ExclusionPredicateSource = {
  id: "source-quality-directories",
  owner: "source:check",
  appliesTo: "実装言語集約検査のdirectory再帰",
  reasonCode: "predicate-unavailable",
  reason: "除外directory集合が非公開定数でありmoduleとして参照できません",
  excludes: undefined,
};

class ScanBoundaryWorld extends WorkflowWorld {
  predicates: string[] = [];
  paths: string[] = [];
  sources: ExclusionPredicateSource[] = [];
  observation?: ScanBoundaryObservation;
  baseline?: ScanBoundaryObservation;
  contaminated?: ScanBoundaryObservation;
  comparison?: ScanBoundaryComparison;
  fixtureRoot = "";
  reportStatus = 0;
  reportOutput = "";
}

const { Given, When, Then } = stepDefinitions<ScanBoundaryWorld>();

function observe(
  predicates: readonly string[],
  paths: readonly string[],
  sources: readonly ExclusionPredicateSource[],
): ScanBoundaryObservation {
  return observeScanBoundary({ predicates, paths, sources });
}

Given("除外述語の被覆の観測入力がある", function (this: ScanBoundaryWorld) {
  this.predicates = ["issue-staging"];
  this.sources = [STAGING_PREDICATE];
  this.paths = [
    ...TRACKED_PATHS,
    ...COVERED_ARTIFACTS,
    ...UNCOVERED_ARTIFACTS,
    "src/../src/domain/staging.ts",
    "C:/outside.ts",
  ];
});

Given(
  "期待した述語を供給元から落とした観測入力がある",
  function (this: ScanBoundaryWorld) {
    this.predicates = ["issue-staging", "source-quality-directories"];
    /**
     * **期待一覧に`issue-staging`があるのに供給元から落とす。** 供給元から期待を
     * 導出していれば、この欠落は検出できない。
     */
    this.sources = [
      UNAVAILABLE_PREDICATE,
      UNAVAILABLE_PREDICATE,
      /** **期待一覧に無い述語も登録する。** 登録側だけが増えた状態を検出させる。 */
      { ...STAGING_PREDICATE, id: "unexpected-predicate" },
    ];
    this.paths = [...TRACKED_PATHS];
  },
);

Given(
  "登録済み述語が覆う生成物を足した観測と足さない観測がある",
  function (this: ScanBoundaryWorld) {
    this.baseline = observe(["issue-staging"], TRACKED_PATHS, [
      STAGING_PREDICATE,
    ]);
    this.contaminated = observe(
      ["issue-staging"],
      [...TRACKED_PATHS, ...COVERED_ARTIFACTS],
      [STAGING_PREDICATE],
    );
  },
);

Given(
  "どの述語にも掛からない生成物を足した観測と足さない観測がある",
  function (this: ScanBoundaryWorld) {
    this.baseline = observe(["issue-staging"], TRACKED_PATHS, [
      STAGING_PREDICATE,
    ]);
    this.contaminated = observe(
      ["issue-staging"],
      [...TRACKED_PATHS, ...UNCOVERED_ARTIFACTS],
      [STAGING_PREDICATE],
    );
  },
);

Given(
  "ignored生成物を持つ一時repositoryがある",
  function (this: ScanBoundaryWorld) {
    const root = this.temp("asc-scan-boundary-report-");
    fs.mkdirSync(path.join(root, ".agent-skill-chain/tmp/issues/例"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".gitignore"),
      ".agent-skill-chain/tmp/\n",
    );
    fs.writeFileSync(path.join(root, "tracked.md"), "# 追跡file\n");
    fs.writeFileSync(
      path.join(root, ".agent-skill-chain/tmp/issues/例/00_要求定義.md"),
      "# 例\n",
    );
    const run = (args: string[]): void => {
      execFileSync("git", args, {
        cwd: root,
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
      });
    };
    run(["init", "-q"]);
    run(["add", ".gitignore", "tracked.md"]);
    this.fixtureRoot = root;
  },
);

When("除外述語の被覆を観測する", function (this: ScanBoundaryWorld) {
  this.observation = observe(this.predicates, this.paths, this.sources);
});

When("2つの観測を比較する", function (this: ScanBoundaryWorld) {
  this.comparison = compareScanBoundary(this.baseline!, this.contaminated!);
});

When("報告scriptを実行する", function (this: ScanBoundaryWorld) {
  try {
    this.reportOutput = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve("scripts/report_scan_boundary.ts"),
        this.fixtureRoot,
      ],
      { encoding: "utf8" },
    );
    this.reportStatus = 0;
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    this.reportStatus = failure.status ?? -1;
    this.reportOutput = failure.stdout ?? "";
  }
});

Then(
  "述語ごとに所有gateと適用範囲と除外pathと理由codeと件数が返る",
  function (this: ScanBoundaryWorld) {
    const observed = this.observation!;
    const entry = observed.predicates.find(
      (candidate) => candidate.predicate === "issue-staging",
    );
    assert.ok(entry, "登録済み述語の観測がありません");
    assert.equal(entry.owner, "trace:check");
    /**
     * **適用範囲まで返すことを見る。** gate名だけを返すと「gate全体の除外」と
     * 読める。述語はgate内の一部にしか適用されない（Issue #960 F-01）。
     */
    assert.ok(entry.appliesTo.includes("SCN配置検査"), entry.appliesTo);
    assert.equal(entry.excludedCount, entry.excluded.length);
    assert.equal(entry.excludedCount, COVERED_ARTIFACTS.length);
    for (const exclusion of entry.excluded) {
      assert.equal(exclusion.reasonCode, "issue-staging");
      assert.ok(exclusion.reason.length > 0, exclusion.path);
    }
    /** **どの述語にも掛からない生成物が被覆漏れとして返ることを見る。** */
    for (const relative of UNCOVERED_ARTIFACTS)
      assert.ok(observed.uncovered.includes(relative), relative);
  },
);

Then(
  "判定不能なpathは除外にも被覆にも現れず理由codeで報告される",
  function (this: ScanBoundaryWorld) {
    const observed = this.observation!;
    assert.equal(observed.complete, false);
    const unresolvable = observed.incomplete.filter(
      (entry) => entry.code === "unresolvable-path",
    );
    assert.equal(unresolvable.length, 2, JSON.stringify(unresolvable));
    for (const relative of ["src/../src/domain/staging.ts", "C:/outside.ts"]) {
      assert.ok(
        unresolvable.some((entry) => entry.path === relative),
        relative,
      );
      assert.ok(!observed.uncovered.includes(relative), relative);
      assert.ok(!observed.observedPaths.includes(relative), relative);
      for (const entry of observed.predicates)
        assert.ok(
          !entry.excluded.some((exclusion) => exclusion.path === relative),
          relative,
        );
    }
  },
);

Then(
  "走査差分は0より大きく被覆差分は0になる",
  function (this: ScanBoundaryWorld) {
    const comparison = this.comparison!;
    assert.equal(comparison.comparable, true, comparison.detail);
    assert.ok(comparison.scopeDelta > 0, `scopeDelta=${comparison.scopeDelta}`);
    assert.equal(comparison.uncoveredDelta, 0, comparison.detail);
    assert.deepEqual(comparison.contributingPaths, []);
  },
);

Then(
  "被覆差分が0より大きく寄与pathが名指しされる",
  function (this: ScanBoundaryWorld) {
    const comparison = this.comparison!;
    assert.equal(comparison.comparable, true, comparison.detail);
    assert.ok(
      comparison.uncoveredDelta > 0,
      `uncoveredDelta=${comparison.uncoveredDelta}`,
    );
    /**
     * **寄与pathの中身まで見る。** 件数だけのassertionは、寄与pathを空で返す
     * 変異を素通しする。
     */
    assert.deepEqual(
      comparison.contributingPaths,
      [...UNCOVERED_ARTIFACTS].sort(),
    );
    assert.ok(comparison.detail.includes("覆っていない"), comparison.detail);
  },
);

Then(
  "述語の欠落と述語未公開と重複登録が別の理由codeで報告される",
  function (this: ScanBoundaryWorld) {
    const observed = this.observation!;
    assert.equal(observed.complete, false);
    const codes = observed.incomplete.map((entry) => entry.code);
    assert.ok(codes.includes("missing-predicate"), codes.join(" "));
    assert.ok(codes.includes("predicate-unavailable"), codes.join(" "));
    /**
     * **`unknown-predicate`の中身まで見る。** 重複登録と期待一覧外は同じcodeで
     * 報告されるため、件数やcodeの有無だけでは片方を消す変異を素通しする。
     */
    const unknown = observed.incomplete.filter(
      (entry) => entry.code === "unknown-predicate",
    );
    assert.ok(
      unknown.some(
        (entry) =>
          entry.predicate === "source-quality-directories" &&
          entry.detail.includes("二重"),
      ),
      JSON.stringify(unknown),
    );
    assert.ok(
      unknown.some(
        (entry) =>
          entry.predicate === "unexpected-predicate" &&
          entry.detail.includes("期待一覧に無い"),
      ),
      JSON.stringify(unknown),
    );
    const missing = observed.incomplete.find(
      (entry) => entry.code === "missing-predicate",
    );
    assert.equal(missing!.predicate, "issue-staging");
    /** **述語未公開のものを観測結果へ含めない。** 含めると除外0件として観測できたように見える。 */
    assert.ok(
      !observed.predicates.some(
        (entry) => entry.predicate === "source-quality-directories",
      ),
      observed.predicates.map((entry) => entry.predicate).join(" "),
    );
  },
);

Then(
  "不完全な観測どうしの比較は拒否される",
  function (this: ScanBoundaryWorld) {
    const comparison = compareScanBoundary(
      this.observation!,
      this.observation!,
    );
    assert.equal(comparison.comparable, false);
    assert.equal(comparison.uncoveredDelta, 0);
    assert.ok(comparison.detail.includes("不完全"), comparison.detail);
  },
);

Then(
  "述語未公開が報告され終了値が非0になる",
  function (this: ScanBoundaryWorld) {
    /**
     * **終了値そのものを観測する。** `valid`だけを見るassertionは、
     * `process.exitCode = 1`を消す変異を素通しする。
     */
    assert.notEqual(this.reportStatus, 0, this.reportOutput);
    const parsed = JSON.parse(this.reportOutput) as {
      valid: boolean;
      incomplete: { code: string; predicate?: string }[];
    };
    assert.equal(parsed.valid, false);
    assert.ok(
      parsed.incomplete.some(
        (entry) =>
          entry.code === "predicate-unavailable" &&
          entry.predicate === "source-quality-directories",
      ),
      JSON.stringify(parsed.incomplete),
    );
  },
);
