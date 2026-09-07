import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { createIssueStaging, validateIssue } from "../../src/domain/issue.js";
import { bootstrapProject, validateSpecs } from "../../src/domain/spec.js";

interface IssueSpecWorld extends WorkflowWorld {
  answers: Parameters<typeof createIssueStaging>[1]["answers"];
  invalidGlossaries: Array<ReturnType<typeof validateSpecs>>;
  changeLogTermValidations?: {
    [k: string]: ReturnType<typeof validateSpecs>;
  };
  issue: ReturnType<typeof createIssueStaging>;
  issueValidation: ReturnType<typeof validateIssue>;
  mtime: number;
  projectKind?: "ui" | "api";
  result: ReturnType<typeof bootstrapProject>;
  root: string;
  sentinel: string;
  specIndex: string;
  specValidation?: ReturnType<typeof validateSpecs>;
  title: string;
  timezoneInstant: Date;
  timezoneStagingNames: Record<string, string>;
  validGlossary: ReturnType<typeof validateSpecs>;
}

const { Given, When, Then } = stepDefinitions<IssueSpecWorld>();

const fixedNow = new Date("2026-08-22T15:30:45Z");

Given("GitHub remoteを持たない一時repositoryがある", function () {
  this.root = this.initRepo();
});
When("title {string}でissue stagingを作成する", function (title: string) {
  this.issue = createIssueStaging(this.root, {
    title,
    answers: this.answers,
    now: fixedNow,
  });
});
Then("modeはquickである", function () {
  assert.equal(this.issue.mode, "quick");
});
Then("stagingは{string}配下にある", function (expected: string) {
  assert.ok(
    this.issue.path.includes(
      `${path.sep}${expected.replaceAll("/", path.sep)}${path.sep}`,
    ),
  );
});
Then("durabilityとsyncedはfalseである", function () {
  assert.equal(this.issue.durable, false);
  assert.equal(this.issue.synced, false);
});
Then("00_要求定義.mdが存在する", function () {
  assert.equal(
    fs.existsSync(path.join(this.issue.path, "00_要求定義.md")),
    true,
  );
});
Then("staging記録がlocal-activeで存在する", function () {
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(this.issue.path, "staging-record.json"), "utf8"),
  );
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.equal("state" in value ? value.state : undefined, "local-active");
  assert.equal("tracker" in value ? value.tracker : undefined, null);
});

Given(
  "title {string}で同じ時刻のstagingを作成済みである",
  function (title: string) {
    this.title = title;
    this.issue = createIssueStaging(this.root, {
      title,
      answers: this.answers,
      now: fixedNow,
    });
  },
);
Given("staging内に{string}というsentinelがある", function (content: string) {
  this.sentinel = path.join(this.issue.path, "sentinel");
  fs.writeFileSync(this.sentinel, content);
});
When("同じtitleと時刻で再作成する", function () {
  try {
    createIssueStaging(this.root, {
      title: this.title,
      answers: this.answers,
      now: fixedNow,
    });
  } catch (error) {
    this.error = error;
  }
});
Then("atomic createは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("sentinel内容は{string}のままである", function (content: string) {
  assert.equal(fs.readFileSync(this.sentinel, "utf8"), content);
});
Then("pending directoryは残らない", function () {
  const parent = path.dirname(this.issue.path);
  assert.equal(
    fs.readdirSync(parent).some((name) => name.startsWith(".pending-")),
    false,
  );
});

Given("quick stagingを作成済みである", function () {
  this.issue = createIssueStaging(this.root, {
    title: "upgrade",
    answers: this.answers,
    now: fixedNow,
  });
});
When("changed file {string}でissueを検証する", function (file: string) {
  this.issueValidation = validateIssue(this.issue.path, {
    changedFiles: [file],
  });
});
When("changed fileなしでissueを検証する", function () {
  this.issueValidation = validateIssue(this.issue.path, { changedFiles: [] });
});
Then("validation modeはfullである", function () {
  assert.equal(this.issueValidation.mode, "full");
});
Then("validationはinvalidである", function () {
  assert.equal(this.issueValidation.valid, false);
});
Then("errorに単調昇格が含まれる", function () {
  assert.ok(
    this.issueValidation.errors.some((error: string) =>
      error.includes("単調昇格"),
    ),
  );
});
Then("errorにplaceholderが含まれる", function () {
  assert.ok(
    this.issueValidation.errors.some((error: string) =>
      error.includes("placeholder"),
    ),
  );
});

Given("local time比較用の同一instantがある", function () {
  this.timezoneInstant = fixedNow;
});
When(/^UTC環境とAsia\/Tokyo環境のissue stagingを作成する$/u, function () {
  const originalTimezone = process.env.TZ;
  this.timezoneStagingNames = {};
  try {
    for (const timezone of ["UTC", "Asia/Tokyo"] as const) {
      process.env.TZ = timezone;
      const issue = createIssueStaging(this.temp(), {
        title: "timezone",
        answers: this.answers,
        now: this.timezoneInstant,
      });
      this.timezoneStagingNames[timezone] = path.basename(issue.path);
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
Then("UTCのprefixは{string}である", function (expected: string) {
  assert.ok(this.timezoneStagingNames.UTC.startsWith(`${expected}_`));
});
Then(/^Asia\/Tokyoのprefixは"([^"]+)"である$/u, function (expected: string) {
  assert.ok(this.timezoneStagingNames["Asia/Tokyo"].startsWith(`${expected}_`));
});

When(
  "unsafe title {string}でissue stagingを作成する",
  function (title: string) {
    try {
      createIssueStaging(this.root, {
        title,
        answers: this.answers,
        now: fixedNow,
      });
    } catch (error) {
      this.error = error;
    }
  },
);
Then("staging rootにentryは0件である", function () {
  const staging = path.join(this.root, ".agent-skill-chain", "tmp", "issues");
  assert.deepEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], []);
});

Given("空の新規project directoryがある", function () {
  this.root = this.temp();
});
Given("空のCLI project directoryがある", function () {
  this.root = this.temp();
});
Given("既存project directoryがある", function () {
  this.root = this.temp();
  fs.writeFileSync(path.join(this.root, "README.md"), "# existing\n");
});
When("CLI project bootstrapをapplyする", function () {
  this.result = bootstrapProject(this.root, {
    apply: true,
    newProject: true,
    projectKind: "cli",
  });
});
When("UI project bootstrapをapplyする", function () {
  this.result = bootstrapProject(this.root, {
    apply: true,
    newProject: true,
    projectKind: "ui",
  });
});
When("API project bootstrapをapplyする", function () {
  this.result = bootstrapProject(this.root, {
    apply: true,
    newProject: true,
    projectKind: "api",
  });
});
When("onboardingなしでbootstrapをapplyする", function () {
  try {
    bootstrapProject(this.root, {
      apply: true,
      newProject: false,
      projectKind: "cli",
    });
  } catch (error) {
    this.error = error;
  }
});
When("new projectと申告してbootstrapをapplyする", function () {
  try {
    bootstrapProject(this.root, {
      apply: true,
      newProject: true,
      projectKind: "cli",
    });
  } catch (error) {
    this.error = error;
  }
});
When("UI project bootstrapをdry-runする", function () {
  this.result = bootstrapProject(this.root, {
    apply: false,
    newProject: true,
    projectKind: "ui",
  });
});
const requiredCliCategories = [
  "00_仕様書構成",
  "01_システム概要",
  "02_要件",
  "03_アーキテクチャ",
  "04_機能",
  "06_外部インターフェース",
  "07_データ",
  "08_バッチ・ジョブ",
  "09_基盤・ネットワーク",
  "10_セキュリティ",
  "11_非機能",
  "12_運用保守",
  "13_移行・廃止",
  "14_開発・品質",
  "15_要件追跡",
  "16_参照資料",
];

Then("docs specsの必須16カテゴリと固定文書が存在する", function () {
  const specs = path.join(this.root, "docs", "specs");
  assert.equal(fs.existsSync(path.join(specs, "00_利用案内.md")), true);
  for (const category of requiredCliCategories)
    assert.equal(
      fs.statSync(path.join(specs, category)).isDirectory(),
      true,
      category,
    );
  for (const file of [
    "00_仕様書構成/00_仕様書索引.md",
    "03_アーキテクチャ/00_全体構成.md",
    "14_開発・品質/00_ディレクトリ構成.md",
    "14_開発・品質/01_コーディング標準.md",
    "16_参照資料/00_官公庁一次資料台帳.md",
  ]) {
    assert.equal(fs.existsSync(path.join(specs, file)), true, file);
  }
});
Then("画面とdesignとlayoutのカテゴリは存在しない", function () {
  for (const name of ["05_画面", "17_デザイン", "18_レイアウト"])
    assert.equal(
      fs.existsSync(path.join(this.root, "docs", "specs", name)),
      false,
    );
});
Then("画面とdesignとlayoutのカテゴリが存在する", function () {
  for (const name of ["05_画面", "17_デザイン", "18_レイアウト"])
    assert.equal(
      fs.statSync(path.join(this.root, "docs", "specs", name)).isDirectory(),
      true,
    );
});
Then("spec validationはvalidである", function () {
  assert.equal((this.specValidation ?? validateSpecs(this.root)).valid, true);
});
Then("spec validationはinvalidである", function () {
  assert.equal(this.specValidation?.valid, false);
});
When(
  "有効行と重複IDと同一context重複とcandidateと置換先なし廃止を検証する",
  function () {
    const glossary = path.join(
      this.root,
      "docs",
      "specs",
      "01_システム概要",
      "02_用語・略語.md",
    );
    const header =
      "| 用語ID | 標準語 | 定義 | 種別 | 境界づけられたコンテキスト | 成立例・反例 | 類義語・禁止表現 | 根拠ID・資料 | owner | 状態・適用版・置換先 |\n" +
      "|---|---|---|---|---|---|---|---|---|---|\n";
    const row = (
      id: string,
      term: string,
      type: string,
      context: string,
      lifecycle: string,
    ) =>
      `| ${id} | ${term} | 判定可能な定義 | ${type} | ${context} | 成立例・反例 | 禁止表現なし | FR-001 | domain owner | ${lifecycle} |\n`;
    const validate = (rows: string) => {
      fs.writeFileSync(glossary, `# 用語・略語\n\n${header}${rows}`);
      return validateSpecs(this.root);
    };
    this.validGlossary = validate(
      row("TERM-ORDER-001", "注文", "business", "受注", "active、v1、なし"),
    );
    this.invalidGlossaries = [
      validate(
        row("TERM-ORDER-001", "注文", "business", "受注", "active、v1、なし") +
          row("TERM-ORDER-001", "受注", "business", "受注", "active、v1、なし"),
      ),
      validate(
        row("TERM-ORDER-001", "注文", "business", "受注", "active、v1、なし") +
          row("TERM-ORDER-002", "注文", "business", "受注", "active、v1、なし"),
      ),
      validate(
        row(
          "TERM-ORDER-001",
          "注文",
          "business",
          "受注",
          "candidate、v1、なし",
        ),
      ),
      validate(
        row(
          "TERM-ORDER-001",
          "注文",
          "business",
          "受注",
          "deprecated、v1、なし",
        ),
      ),
    ];
  },
);
When("変更履歴の用語ID列と台帳の突合を検証する", function () {
  const specs = path.join(this.root, "docs", "specs");
  const glossary = path.join(specs, "01_システム概要", "02_用語・略語.md");
  const changeLog = path.join(specs, "15_要件追跡", "01_変更履歴.md");
  const header =
    "| 用語ID | 標準語 | 定義 | 種別 | 境界づけられたコンテキスト | 成立例・反例 | 類義語・禁止表現 | 根拠ID・資料 | owner | 状態・適用版・置換先 |\n" +
    "|---|---|---|---|---|---|---|---|---|---|\n";
  fs.writeFileSync(
    glossary,
    `# 用語・略語\n\n${header}| TERM-ORDER-001 | 注文 | 判定可能な定義 | business | 受注 | 成立例・反例 | 禁止表現なし | FR-001 | domain owner | active、v1、なし |\n`,
  );
  const logHeader =
    "# 仕様変更履歴\n\n| 日付 | 変更 | 要件・SCN | 用語ID | 更新文書 | Issue・PR | 互換性 | 判断者 | HEAD SHA |\n" +
    "|---|---|---|---|---|---|---|---|---|\n";
  const logRow = (terms: string) =>
    `| 2026-09-06 | 変更 | FR-001 | ${terms} | 文書 | Issue | 変更なし | owner | tree |\n`;
  const validate = (terms: string) => {
    fs.writeFileSync(changeLog, `${logHeader}${logRow(terms)}`);
    return validateSpecs(this.root);
  };
  this.changeLogTermValidations = {
    /** 台帳に無いIDを名指しした状態。 */
    unregistered: validate("TERM-ORDER-999を追加"),
    /** 範囲記法。中間IDが走査で拾えない。 */
    range: validate("TERM-ORDER-001〜003を追加"),
    /** 名指ししない行。逆方向を要求しないことの観測でもある。 */
    silent: validate("追加・変更なし"),
    /** 台帳に在るIDを個別列挙した状態。 */
    registered: validate("TERM-ORDER-001を追加"),
  };
});

Then("未登録の名指しと範囲記法だけが拒否され逆方向は要求されない", function () {
  const observed = this.changeLogTermValidations;
  assert.ok(observed, "突合の観測がありません");
  assert.equal(observed.unregistered.valid, false);
  assert.ok(
    observed.unregistered.errors.some(
      (error: string) =>
        error.includes("仕様変更履歴が名指しする用語IDが台帳にありません") &&
        error.includes("TERM-ORDER-999"),
    ),
    observed.unregistered.errors.join(" "),
  );
  assert.equal(observed.range.valid, false);
  assert.ok(
    observed.range.errors.some((error: string) =>
      error.includes("仕様変更履歴の用語ID列へ範囲記法を置けません"),
    ),
    observed.range.errors.join(" "),
  );
  /**
   * **台帳に在り変更履歴が名指ししない用語を拒否しない。** 網羅は不変条件では
   * なく、要求すると既存台帳が即座に不合格になる（Issue #1129）。
   */
  assert.equal(observed.silent.valid, true);
  assert.equal(observed.registered.valid, true);
});

Then("有効な用語行だけが合格し不正な用語台帳はすべて拒否される", function () {
  assert.equal(
    this.validGlossary.valid,
    true,
    this.validGlossary.errors.join("; "),
  );
  assert.ok(
    this.invalidGlossaries.every(
      (result: ReturnType<typeof validateSpecs>) => !result.valid,
    ),
  );
  assert.match(
    this.invalidGlossaries
      .flatMap((result: ReturnType<typeof validateSpecs>) => result.errors)
      .join(" "),
    /重複|candidate|置換先/u,
  );
});
Then("bootstrapは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("docs specsは存在しない", function () {
  assert.equal(fs.existsSync(path.join(this.root, "docs", "specs")), false);
});
Then("bootstrap resultはpreviewである", function () {
  assert.equal(this.result.applied, false);
});
Then("docs directoryは存在しない", function () {
  assert.equal(fs.existsSync(path.join(this.root, "docs")), false);
});

Given("必須specを持つCLI projectがある", function () {
  this.root = this.temp();
  bootstrapProject(this.root, {
    apply: true,
    newProject: true,
    projectKind: "cli",
  });
});
Given("spec indexの更新時刻を記録する", function () {
  this.specIndex = path.join(
    this.root,
    "docs",
    "specs",
    "00_仕様書構成",
    "00_仕様書索引.md",
  );
  this.mtime = fs.statSync(this.specIndex).mtimeMs;
});
When("architecture file変更をno-spec-impactで検証する", function () {
  this.specValidation = validateSpecs(this.root, {
    changedFiles: ["src/architecture/router.ts"],
    review: {
      specImpact: "no-spec-impact",
      rationale: "wording only rationale",
    },
  });
});
When("{string}変更をno-spec-impactで検証する", function (file: string) {
  this.specValidation = validateSpecs(this.root, {
    changedFiles: [file],
    review: {
      specImpact: "no-spec-impact",
      rationale: "文言だけで振る舞いと契約は変わらないと主張する",
    },
  });
});
When("README文言変更を根拠付きno-spec-impactで検証する", function () {
  this.specValidation = validateSpecs(this.root, {
    changedFiles: ["README.md"],
    review: {
      specImpact: "no-spec-impact",
      rationale: "wording only; behavior and contracts unchanged",
    },
  });
});
Then("spec indexの更新時刻は変わらない", function () {
  assert.equal(fs.statSync(this.specIndex).mtimeMs, this.mtime);
});
Then("生成した仕様file名は連番付き日本語である", function () {
  const specs = path.join(this.root, "docs", "specs");
  const entries = fs.readdirSync(specs, { withFileTypes: true });
  const categories = entries.filter((entry) => entry.isDirectory());
  assert.ok(categories.length >= 16);
  assert.ok(
    categories.every((entry) =>
      /^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
        entry.name,
      ),
    ),
  );
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .concat(
      categories.flatMap((entry) =>
        fs
          .readdirSync(path.join(specs, entry.name), { withFileTypes: true })
          .filter((child) => child.isFile())
          .map((child) => child.name),
      ),
    );
  assert.ok(files.length >= 30);
  assert.ok(
    files.every((name) =>
      /^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}].*\.md$/u.test(
        name,
      ),
    ),
  );
});
Then("生成した仕様本文は日本語文書形式検査に合格する", function () {
  const result = spawnSync(
    "npx",
    ["--import", "tsx", "scripts/check_japanese_docs.ts", this.root],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
Then(
  "機能と画面とAPIとdataとbatchとnetworkの個別仕様templateが存在する",
  function () {
    const specs = path.join(this.root, "docs", "specs");
    for (const file of [
      "04_機能/01_個別機能テンプレート.md",
      "05_画面/02_個別画面テンプレート.md",
      "06_外部インターフェース/02_個別APIテンプレート.md",
      "07_データ/02_データ項目テンプレート.md",
      "08_バッチ・ジョブ/01_個別ジョブテンプレート.md",
      "09_基盤・ネットワーク/01_論理ネットワーク.md",
    ])
      assert.equal(fs.existsSync(path.join(specs, file)), true, file);
  },
);
Then(
  "画面遷移と処理sequenceとERとnetworkのMermaid記入欄が存在する",
  function () {
    const specs = path.join(this.root, "docs", "specs");
    const expectations = [
      ["05_画面/01_画面遷移.md", "flowchart"],
      ["04_機能/01_個別機能テンプレート.md", "sequenceDiagram"],
      ["07_データ/01_データモデル.md", "erDiagram"],
      ["09_基盤・ネットワーク/01_論理ネットワーク.md", "flowchart"],
    ];
    for (const [file, diagram] of expectations)
      assert.match(
        fs.readFileSync(path.join(specs, file), "utf8"),
        new RegExp(`mermaid[\\s\\S]*${diagram}`),
        file,
      );
  },
);

/**
 * **projectKindを保持する。** 対応契約の検査は画面categoryの有無で分岐するため、
 * 生成物の実在から種別を推測すると、画面templateの生成が止まった回帰を
 * 「画面なしのproject」として黙って通してしまう。
 */
const PROJECT_KIND_BY_LABEL: ReadonlyMap<string, "ui" | "api"> = new Map([
  ["UI", "ui"],
  ["API", "api"],
]);

When("{string} project bootstrapをapplyする", function (label: string) {
  const projectKind = PROJECT_KIND_BY_LABEL.get(label);
  assert.notEqual(projectKind, undefined, `未知のproject種別です: ${label}`);
  this.projectKind = projectKind;
  this.result = bootstrapProject(this.root, {
    apply: true,
    newProject: true,
    projectKind: projectKind as "ui" | "api",
  });
});

/**
 * 業務単位の設計契約の記入欄が、bootstrapした生成物へ届いていることを検査する。
 *
 * **欄名だけでなく記入内容の字面まで名指しする。** `- 事後条件:`のように接頭辞だけを
 * 見ると、値を空へ置き換えた変異が生存する。**参照先を含む1行を丸ごと期待値にする。**
 * ユースケース詳細は9欄すべての実在を要求し、1欄でも落ちたら失敗させる。
 * **画面の契約は種別で分岐させ、UIでだけ必須にする。** 生成物に無ければ非適用と
 * 読み替える書き方をしない。
 */
const USECASE_DETAIL_FIELDS = [
  "- UC-001 目的: {この業務で達成する結果}",
  "- 主体・権限: {主体と必要な権限}",
  "- 起動: {画面操作 / API / CLI / イベント / 時刻}",
  "- 前提条件: {成立していなければ開始しない条件}",
  "- 事後条件: {業務として成立した結果。受付や画面操作の成功と混同しない}",
  "- 主フロー: {手順}",
  "- 代替フロー: {条件と手順}",
  "- 失敗フロー: {条件、保持される状態、利用者の再開手段}",
  "- 依存ユースケース・完了観測: {同期処理か、非同期で依存するユースケースと完了を観測する方法。該当しない場合は理由}",
  "- 業務規則・受け入れ例: {BR-...、SCN-...}",
] as const;

/** 非機能要件一覧templateが持つ品質特性の行数。行が消えたことも検出する。 */
const NFR_REQUIREMENT_ROWS = 12;

/** 要件ID・品質特性・要求・測定条件・合格基準・検証方法・参照・適用の8列。 */
const NFR_COLUMNS = 8;

/** 参照列は0起点で6列目。列の位置が動いたことも検出する。 */
const NFR_REFERENCE_COLUMN = 6;

const NFR_REFERENCE_CELL = "{実現する設計の正本と、劣化時の監視・復旧手順}";

const RELATED_USECASE_FIELD =
  "- 関連ユースケース: {UC ID。対応の正本は`15_要件追跡/00_追跡表.md`}";

Then(
  "生成した仕様はユースケースと機能・画面・ジョブの対応契約を保持する",
  function () {
    const specs = path.join(this.root, "docs", "specs");
    const flow = "01_システム概要/01_業務・利用者フロー.md";
    const trace = "15_要件追跡/00_追跡表.md";
    const expectations: [string, string][] = [
      [flow, "## ユースケース詳細"],
      [
        flow,
        "**対応関係の正本は`15_要件追跡/00_追跡表.md`とし、ここへ複製しない。** 今回届ける単位のユースケースだけを詳細化する。",
      ],
      ...USECASE_DETAIL_FIELDS.map((field): [string, string] => [flow, field]),
      [trace, "## ユースケースと機能・画面・ジョブの対応"],
      [
        trace,
        "| UC ID | FN ID | SCR ID | JOB ID | 受け入れ条件・SCN | 詳細参照 |",
      ],
      [
        trace,
        "| UC-001 | FN-001 | SCR-001 / 対象外: {理由} | JOB-001 / 対象外: {理由} | AC-... / SCN-... | {パス} |",
      ],
      [trace, "ユースケースと機能・画面・ジョブの直積にしない"],
      [trace, "画面やジョブを持たない構成は空欄にせず、`対象外`と理由を書く"],
      [
        trace,
        "**対応の条件と理由をこの表以外へ書かない。** 各詳細が持つのは関連ユースケース欄からこの表への参照であり、対応の複製ではない。",
      ],
      ["04_機能/01_個別機能テンプレート.md", RELATED_USECASE_FIELD],
      ["08_バッチ・ジョブ/01_個別ジョブテンプレート.md", RELATED_USECASE_FIELD],
      [
        "03_アーキテクチャ/00_全体構成.md",
        "業務規則と認可の最終判断はサーバーとドメインが持つ。フロントエンドは表示、操作状態、入力支援に限る。",
      ],
      [
        "03_アーキテクチャ/00_全体構成.md",
        "- 技術スタック・基盤の選定根拠: {必要な能力、制約、不採用案、版管理方針。製品名だけを結論にしない}",
      ],
      [
        "06_外部インターフェース/01_共通契約.md",
        "業務の意味、状態遷移、権限はドメインが判定する。",
      ],
      [
        "06_外部インターフェース/01_共通契約.md",
        "型が通ることを業務資格の充足と読み替えない",
      ],
      [
        "14_開発・品質/01_コーディング標準.md",
        "事前条件、事後条件、不変条件を宣言し、境界検証済みの型、生成時の制約、副作用前の検証のいずれで保証するかを割り当てる",
      ],
      [
        "11_非機能/00_非機能要件一覧.md",
        "| 要件ID | 品質特性 | 要求 | 測定条件 | 合格基準 | 検証方法 | 設計・監視復旧の参照 | 適用 |",
      ],
    ];
    if (this.projectKind === "ui")
      expectations.push(
        ["05_画面/02_個別画面テンプレート.md", RELATED_USECASE_FIELD],
        [
          "05_画面/02_個別画面テンプレート.md",
          "- 業務完了の判定と表示: {どの層が業務完了を判定するか。画面が何を根拠に完了と表示するか。非同期確定なら未確定中の表示}",
        ],
      );
    for (const [file, contract] of expectations) {
      const target = path.join(specs, file);
      assert.equal(fs.existsSync(target), true, `生成物にありません: ${file}`);
      assert.equal(
        fs.readFileSync(target, "utf8").includes(contract),
        true,
        `${file}に記入契約がありません: ${contract}`,
      );
    }
    /**
     * **非機能要件は全行が参照欄を持つ。** `includes`だけでは、1行の欄を空へ
     * 置き換えても他の行が一致して通る。行ごとに要求し、件数ではなく
     * 「参照欄を欠く行が0件であること」を判定する。
     *
     * **行の抽出を字面の接頭辞に依存させず、cell境界で分解する。**
     * `startsWith("| REQ-")`は、行頭の空白1文字や`|`直後の空白の有無で
     * 抽出対象から外れる。**外れた行は「欠く行が0件」も件数一致も素通りする。**
     * cellへ分解して、列数と参照列の位置まで判定する。
     */
    const nfr = "11_非機能/00_非機能要件一覧.md";
    const nfrRows = fs
      .readFileSync(path.join(specs, nfr), "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|") && line.endsWith("|"))
      .map((line) =>
        line
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.trim()),
      )
      .filter((cells) => (cells[0] ?? "").startsWith("REQ-{domain}-"));
    assert.equal(
      nfrRows.length,
      NFR_REQUIREMENT_ROWS,
      `${nfr}の要件行が${NFR_REQUIREMENT_ROWS}行ではありません: ${nfrRows.length}`,
    );
    assert.deepEqual(
      nfrRows.filter(
        (cells) =>
          cells.length !== NFR_COLUMNS ||
          cells[NFR_REFERENCE_COLUMN] !== NFR_REFERENCE_CELL,
      ),
      [],
      `${nfr}に設計・監視復旧の参照欄を欠く行、または列数が${NFR_COLUMNS}でない行があります`,
    );
  },
);
