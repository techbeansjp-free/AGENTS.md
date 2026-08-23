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
  issue: ReturnType<typeof createIssueStaging>;
  issueValidation: ReturnType<typeof validateIssue>;
  mtime: number;
  result: ReturnType<typeof bootstrapProject>;
  root: string;
  sentinel: string;
  specIndex: string;
  specValidation?: ReturnType<typeof validateSpecs>;
  title: string;
  validGlossary: ReturnType<typeof validateSpecs>;
}

const { Given, When, Then } = stepDefinitions<IssueSpecWorld>();

const fixedNow = new Date("2026-08-23T01:00:00Z");

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
