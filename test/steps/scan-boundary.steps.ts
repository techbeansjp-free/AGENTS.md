import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  compareScanBoundary,
  observeScanBoundary,
  type ExclusionPredicateSource,
  type ScanBoundaryComparison,
  type ScanBoundaryIncompleteCode,
  type ScanBoundaryObservation,
} from "../../src/domain/scan-boundary.js";
import {
  isIssueStagingPath,
  isStagingLifecyclePath,
  isStagingLifecycleScanPath,
} from "../../src/domain/staging.js";
import { expandIgnoredEntries } from "../../scripts/report_scan_boundary.js";
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

/**
 * **同じ入力に対する判定差を観測するための2述語**（Issue #1276）。
 *
 * `isIssueStagingPath`と合わせて3述語を並べると、`..\\draft.md`について
 * `false / true / true`という差が観測される。**是正前はこの差が1つも測れなかった。**
 */
const LIFECYCLE_PREDICATE: ExclusionPredicateSource = {
  id: "staging-lifecycle",
  owner: "check_trace.ts",
  appliesTo: "追跡混入検査の走査範囲のみ",
  reasonCode: "staging-lifecycle",
  reason: "一時ステージング領域を追跡混入検査の走査範囲から除く",
  excludes: isStagingLifecyclePath,
};

const LIFECYCLE_SCAN_PREDICATE: ExclusionPredicateSource = {
  id: "staging-lifecycle-scan",
  owner: "check_trace.ts",
  appliesTo: "SCN配置検査の走査範囲のみ",
  reasonCode: "staging-lifecycle-scan",
  reason: "一時ステージング領域をSCN配置検査の走査範囲から除く",
  excludes: isStagingLifecycleScanPath,
};

/**
 * **理由codeの列挙を製品の型と結ぶ**（Issue #1276）。
 *
 * `Record<ScanBoundaryIncompleteCode, true>`は、unionへcodeを足すと欄が欠けて
 * `npm run typecheck`が落ち、削ると余分な欄として落ちる。**testの中へ書き写した
 * 配列だけでは、unionを増やす変更を1件も検出できない。**
 */
const REGISTERED_INCOMPLETE_CODES: Readonly<
  Record<ScanBoundaryIncompleteCode, true>
> = Object.freeze({
  "unknown-predicate": true,
  "duplicate-predicate": true,
  "missing-predicate": true,
  "unresolvable-path": true,
  "predicate-unavailable": true,
  "scan-failed": true,
});

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
  /** 述語が受け取った引数。**入力そのものが渡ることを観測する**（Issue #1276）。 */
  predicateArguments: string[] = [];
  observableTarget = "";
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
    assert.ok(codes.includes("duplicate-predicate"), codes.join(" "));
    assert.ok(codes.includes("predicate-unavailable"), codes.join(" "));
    /**
     * **`unknown-predicate`の中身まで見る。** 重複登録と期待一覧外は同じcodeで
     * 報告されるため、件数やcodeの有無だけでは片方を消す変異を素通しする。
     */
    const unknown = observed.incomplete.filter(
      (entry) => entry.code === "unknown-predicate",
    );
    /**
     * **二重登録は専用のcodeで返ることを見る。** `detail`の文字列だけでは
     * 呼び出し側が理由で分岐できない。
     */
    const duplicate = observed.incomplete.filter(
      (entry) => entry.code === "duplicate-predicate",
    );
    assert.equal(duplicate.length, 1, JSON.stringify(duplicate));
    assert.equal(duplicate[0].predicate, "source-quality-directories");
    assert.ok(
      !unknown.some(
        (entry) => entry.predicate === "source-quality-directories",
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

Then("展開中のfilesystem例外は走査失敗として報告される", function () {
  /**
   * **例外経路を実行環境の権限に頼らない。** rootで走ると権限不足が起きない。
   * test doubleで例外を確実に起こす。
   */
  const expanded = expandIgnoredEntries("/dummy", ["ignored-area"], {
    lstat: () => {
      throw new Error("EACCES: permission denied");
    },
    readdir: () => [],
  });
  assert.deepEqual(expanded.paths, []);
  assert.equal(expanded.incomplete.length, 1);
  assert.equal(expanded.incomplete[0].code, "scan-failed");
  assert.equal(expanded.incomplete[0].path, "ignored-area");
  assert.ok(
    expanded.incomplete[0].detail.includes("EACCES"),
    expanded.incomplete[0].detail,
  );
});

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

/**
 * **実行OSの区切りを隠さない**（Issue #1276）。
 *
 * `isObservableRelativePath`は`path.sep`だけを正規化する。判定はOSに依存するため、
 * **どのOSで測ったかをscenarioの側で先に固定する。** CIは`ubuntu-latest`であり
 * `path.sep`は`/`である。Windowsでは`..\x`が本物の親参照になり結果が変わる。
 */
Given("実行OSの区切りが {string} である", function (separator: string) {
  assert.equal(
    path.sep,
    separator,
    `本scenarioは path.sep が ${separator} の環境を前提とする。実測値は ${path.sep}`,
  );
});

/**
 * **POSIXで実在しうる合法なfile名を与える**（Issue #1276）。
 *
 * `..\draft.md`はPOSIXでは1つの正常なsegmentであり、`tmp/issues/`配下のfileである。
 * backslashを無条件に区切りとして解釈すると、このpathはどの述語へも届かない。
 */
Given(
  "backslashを含む合法なfile名の観測入力がある",
  function (this: ScanBoundaryWorld) {
    this.observableTarget =
      ".agent-skill-chain/tmp/issues/20260101_000000_例/..\\draft.md";
    /** **1述語では判定差を観測できない**（Issue #1276）。3述語を並べる。 */
    this.predicates = [
      "issue-staging",
      "staging-lifecycle",
      "staging-lifecycle-scan",
    ];
    this.sources = [
      STAGING_PREDICATE,
      LIFECYCLE_PREDICATE,
      LIFECYCLE_SCAN_PREDICATE,
    ];
    this.paths = [this.observableTarget];
  },
);

Given(
  "親参照と現在参照と絶対pathとdrive修飾と空文字の観測入力がある",
  function (this: ScanBoundaryWorld) {
    this.predicates = ["issue-staging"];
    this.sources = [STAGING_PREDICATE];
    /**
     * **実行OSの区切りで解釈したときに不正segmentを生じる入力だけを並べる。**
     *
     * **1分類につき1件では、位置や大小文字で条件を狭める変異が生存する**
     * （Issue #1276の独立reviewで実測）。親参照・現在参照・空segmentは
     * 先頭・中間・末尾を、drive修飾は大文字と小文字を並べる。
     */
    this.paths = [
      "../x",
      "a/../b",
      "a/..",
      "..",
      "./x",
      "a/./b",
      "a/.",
      ".",
      "/absolute.md",
      "a//b",
      "a/",
      "C:/outside.md",
      "C:\\outside.md",
      "c:/outside.md",
      "",
    ];
  },
);

Given(
  "複数の理由codeが同時に生じる観測入力がある",
  function (this: ScanBoundaryWorld) {
    /**
     * **合法な入力だけでは`incomplete`が空になり、走査が0回で終わる**
     * （Issue #1276の独立reviewで実測）。**空振りするassertionにしない。**
     */
    this.predicates = [
      "issue-staging",
      "source-quality-directories",
      "登録されていない述語",
    ];
    this.sources = [
      STAGING_PREDICATE,
      STAGING_PREDICATE,
      UNAVAILABLE_PREDICATE,
      { ...STAGING_PREDICATE, id: "期待一覧に無い述語" },
    ];
    this.paths = [
      "a/../b",
      ".agent-skill-chain/tmp/issues/20260101_000000_例/00_要求定義.md",
    ];
  },
);

Given(
  "引数を記録する述語とbackslashを含むpathがある",
  function (this: ScanBoundaryWorld) {
    this.predicateArguments = [];
    const recorded = this.predicateArguments;
    this.predicates = ["recording"];
    this.sources = [
      {
        id: "recording",
        owner: "trace:check",
        appliesTo: "SCN配置検査の走査範囲のみ",
        reasonCode: "recording",
        reason: "述語が受け取った引数を記録する",
        excludes: (candidate: string) => {
          recorded.push(candidate);
          return true;
        },
      },
    ];
    /**
     * **1入力では「入力そのものを渡す」を強制できない**
     * （Issue #1276の独立reviewで実測）。**代表的な書き換えで実際に
     * 変化する入力を並べる。** 小文字化、trim、Unicode正規化のいずれも
     * この配列のどれかを変える。
     */
    this.paths = [
      ".agent-skill-chain/tmp/issues/20260101_000000_例/..\\draft.md",
      "src/Domain/Staging.TS",
      " 前後に空白のあるfile名.md ",
      "docs/e\u0301tude.md",
    ];
  },
);

Then(
  "そのpathは観測対象に入り述語の判定結果へ現れる",
  function (this: ScanBoundaryWorld) {
    const observation = this.observation!;
    assert.deepEqual(
      [...observation.observedPaths],
      [this.observableTarget],
      "合法なfile名が観測対象へ入っていません",
    );
    /**
     * **述語ごとの判定差こそが観測すべき対象である**（Issue #1276）。
     *
     * POSIXでは`..\\draft.md`が1つの正常なsegmentになるため、`.agent-skill-chain/
     * tmp/issues/<slug>/`直下の成果物名を要求する`isIssueStagingPath`だけが偽を返し、
     * 領域接頭辞だけを見る他の2述語は真を返す。**是正前はこの差が1件も測れず、
     * 3述語のいずれも実行されないまま`incomplete`へ落ちていた。**
     */
    assert.deepEqual(
      observation.predicates.map((entry) => [
        entry.predicate,
        entry.excluded.map((item) => item.path),
      ]),
      [
        ["issue-staging", []],
        ["staging-lifecycle", [this.observableTarget]],
        ["staging-lifecycle-scan", [this.observableTarget]],
      ],
      "述語ごとの判定結果が実測と違います",
    );
    assert.deepEqual(
      [...observation.uncovered],
      [],
      "いずれかの述語に掛かった生成物がuncoveredへ残っています",
    );
  },
);

Then("判定不能なpathは1件も報告されない", function (this: ScanBoundaryWorld) {
  const unresolvable = this.observation!.incomplete.filter(
    (item) => item.code === "unresolvable-path",
  );
  assert.deepEqual(
    unresolvable.map((item) => item.path),
    [],
    "判定不能として落ちたpathがあります",
  );
});

Then(
  "すべて判定不能として報告され観測対象に入らない",
  function (this: ScanBoundaryWorld) {
    const observation = this.observation!;
    assert.deepEqual(
      [...observation.observedPaths],
      [],
      "拒否すべきpathが観測対象へ入っています",
    );
    /** **件数だけでなく、どのpathが落ちたかを名指しで突合する。** */
    assert.deepEqual(
      observation.incomplete
        .filter((item) => item.code === "unresolvable-path")
        .map((item) => item.path),
      [...this.paths],
      "拒否したpath集合が入力と一致しません",
    );
  },
);

Then(
  "報告されうる理由codeは登録済みの6件だけである",
  function (this: ScanBoundaryWorld) {
    const observed = this.observation!.incomplete.map((item) => item.code);
    /** **走査が0回で終わっていないことを先に固定する。** */
    assert.ok(observed.length > 0, "理由codeが1件も観測されていません");
    assert.deepEqual(
      [...new Set(observed)].sort(),
      [
        "duplicate-predicate",
        "missing-predicate",
        "predicate-unavailable",
        "unknown-predicate",
        "unresolvable-path",
      ],
      "観測された理由codeの集合が想定と違います",
    );
    /**
     * **列挙の不変は型が強制する**（Issue #1276）。
     * `REGISTERED_INCOMPLETE_CODES`は製品のunionを網羅する`Record`であり、
     * unionへcodeを足すと`npm run typecheck`が落ちる。
     */
    assert.equal(Object.keys(REGISTERED_INCOMPLETE_CODES).length, 6);
    for (const code of observed)
      assert.ok(
        code in REGISTERED_INCOMPLETE_CODES,
        `登録外の理由codeが報告されました: ${code}`,
      );
  },
);

Then(
  "述語が受け取った文字列は入力と1文字も違わない",
  function (this: ScanBoundaryWorld) {
    assert.deepEqual(
      this.predicateArguments,
      [...this.paths],
      "観測層が述語へ渡す文字列を書き換えています",
    );
  },
);
