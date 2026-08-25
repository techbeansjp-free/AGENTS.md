import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  POC_HIGH_RISK_IDS,
  classifyMode,
  type ModeAnswer,
  type PocDeclaration,
} from "../../src/domain/mode.js";
import {
  createIssueStaging,
  planPocPromotion,
  validateIssue,
} from "../../src/domain/issue.js";

interface PocModeWorld extends WorkflowWorld {
  answers: Record<string, ModeAnswer>;
  declaration: PocDeclaration;
  issue: ReturnType<typeof createIssueStaging>;
  legacyModes: string[];
  modeResult: ReturnType<typeof classifyMode>;
  promotion: ReturnType<typeof planPocPromotion>;
  quickIssue: ReturnType<typeof createIssueStaging>;
  root: string;
  validations: Array<ReturnType<typeof validateIssue>>;
}

const { Given, When, Then } = stepDefinitions<PocModeWorld>();

function completeAnswers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: true, evidence: `根拠${index + 1}` },
    ]),
  );
}

function completeDeclaration(): PocDeclaration {
  return {
    purpose: "検索仮説を短期間で検証する",
    period: { from: "2026-08-25", to: "2026-09-05" },
    outOfScope: "正式提供と本番データ",
    successCriteria: "試験利用者5名中4名が完了する",
    abortCriteria: "情報漏えいriskまたは期限超過を検出する",
    owner: "PoC責任者",
    highRisk: POC_HIGH_RISK_IDS.map((id) => ({
      id,
      present: false,
      evidence: `${id}を対象外と確認済み`,
    })),
  };
}

Given("完全でhigh riskのないPoC宣言がある", function () {
  this.answers = completeAnswers();
  this.declaration = completeDeclaration();
});

Given("PoC宣言の全必須欄が記入済みである", function () {
  assert.ok(this.declaration.purpose);
  assert.equal(this.declaration.highRisk.length, POC_HIGH_RISK_IDS.length);
});

Given("従来判定用のQ-01〜Q-08回答がある", function () {
  this.answers = completeAnswers();
});

When("pocを明示してモード判定する", function () {
  this.modeResult = classifyMode(this.answers, {
    requestedMode: "poc",
    poc: this.declaration,
  });
});

Then("PoC判定結果はpocである", function () {
  assert.equal(this.modeResult.mode, "poc");
});

Then("PoC判定理由は0件である", function () {
  assert.deepEqual(this.modeResult.reasons, []);
});

Given("PoC宣言の目的が欠落している", function () {
  this.declaration.purpose = "";
});

Given("personal-dataのhigh risk確認が不明である", function () {
  this.declaration.highRisk = this.declaration.highRisk.filter(
    (risk) => risk.id !== "personal-data",
  );
});

Then("PoC判定結果はfullである", function () {
  assert.equal(this.modeResult.mode, "full");
});

Then("PoC判定理由に目的とpersonal-dataが含まれる", function () {
  const reasons = this.modeResult.reasons.join(" ");
  assert.match(reasons, /目的/u);
  assert.match(reasons, /personal-data/u);
});

Given("external-exposureのhigh risk条件が存在する", function () {
  const risk = this.declaration.highRisk.find(
    (entry) => entry.id === "external-exposure",
  );
  assert.ok(risk);
  risk.present = true;
});

Then("PoC判定理由にexternal-exposureとfull昇格が含まれる", function () {
  const reasons = this.modeResult.reasons.join(" ");
  assert.match(reasons, /external-exposure/u);
  assert.match(reasons, /full.*昇格/u);
});

When("fullからpocへの途中降格を要求する", function () {
  this.modeResult = classifyMode(this.answers, {
    requestedMode: "poc",
    currentMode: "full",
    poc: completeDeclaration(),
  });
});

Given("PoCの変更fileに{string}がある", function (file: string) {
  this.value = [file];
});

When("変更fileを含めてpocを明示判定する", function () {
  assert.ok(Array.isArray(this.value));
  const changedFiles = this.value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  this.modeResult = classifyMode(this.answers, {
    requestedMode: "poc",
    poc: this.declaration,
    changedFiles,
  });
});

Then("PoC判定理由にpublic-apiが含まれる", function () {
  assert.match(this.modeResult.reasons.join(" "), /public-api/u);
});

When("第2引数なしで従来の完全回答と不明回答を判定する", function () {
  const incomplete = completeAnswers();
  incomplete["Q-08"] = { answer: "unknown", evidence: "未確認" };
  this.legacyModes = [
    classifyMode(completeAnswers()).mode,
    classifyMode(incomplete).mode,
  ];
});

Then("従来判定はquickとfullである", function () {
  assert.deepEqual(this.legacyModes, ["quick", "full"]);
});

Given("PoC検証用の隔離repositoryと完全宣言がある", function () {
  this.root = this.temp("asc-poc-int-");
  this.answers = completeAnswers();
  this.declaration = completeDeclaration();
});

Given("PoCの最小stagingを生成する条件が揃っている", function () {
  assert.equal(fs.statSync(this.root).isDirectory(), true);
  assert.equal(
    this.declaration.highRisk.every((risk) => !risk.present),
    true,
  );
});

When("pocのissue stagingを作成する", function () {
  this.issue = createIssueStaging(this.root, {
    title: "検索仮説の検証",
    answers: this.answers,
    requestedMode: "poc",
    poc: this.declaration,
    now: new Date("2026-08-25T00:00:00Z"),
  });
});

Given("pocのissue stagingを作成済みである", function () {
  this.issue = createIssueStaging(this.root, {
    title: "検索仮説の検証",
    answers: this.answers,
    requestedMode: "poc",
    poc: this.declaration,
    now: new Date("2026-08-25T00:00:00Z"),
  });
});

Then("stagingのモードはpocである", function () {
  assert.equal(this.issue.mode, "poc");
});

Then("stagingには00要求定義とstaging記録が存在する", function () {
  assert.deepEqual(fs.readdirSync(this.issue.path), [
    "00_モード判定.json",
    "00_要求定義.md",
    "journal",
    "staging-record.json",
  ]);
});

Then(
  "00要求定義に目的と期間と成功中止条件と非対象と責任者が日本語で記録される",
  function () {
    const document = fs.readFileSync(
      path.join(this.issue.path, "00_要求定義.md"),
      "utf8",
    );
    for (const expected of [
      this.declaration.purpose,
      this.declaration.period.from,
      this.declaration.period.to,
      this.declaration.successCriteria,
      this.declaration.abortCriteria,
      this.declaration.outOfScope,
      this.declaration.owner,
    ])
      assert.ok(document.includes(expected), expected);
  },
);

Then("00要求定義の管理情報はpocである", function () {
  const document = fs.readFileSync(
    path.join(this.issue.path, "00_要求定義.md"),
    "utf8",
  );
  assert.match(document, /^\|\s*モード\s*\|\s*`poc`\s*\|\s*$/mu);
});

When("pocでreleaseと自動mergeと本番cleanupを検証する", function () {
  this.validations = ["release", "automatic-merge", "production-cleanup"].map(
    (requestedOperation) =>
      validateIssue(this.issue.path, {
        requestedOperation,
        delivery: { stopAt: "pull_request" },
      }),
  );
});

Then("すべての禁止操作は拒否される", function () {
  assert.ok(this.validations.every((validation) => !validation.valid));
  for (const validation of this.validations)
    assert.match(validation.errors.join(" "), /PoC.*できません/u);
});

Then("PoCの禁止操作一覧が返る", function () {
  for (const validation of this.validations)
    assert.deepEqual(validation.blockedOperations, [
      "release",
      "automatic-merge",
      "production-cleanup",
    ]);
});

When("PoCの正式開発昇格計画を作る", function () {
  this.promotion = planPocPromotion(this.issue.path);
});

Then("fullに不足する01と02と03の成果物が列挙される", function () {
  assert.deepEqual(this.promotion.missing, [
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("昇格根拠と補完理由が返る", function () {
  assert.match(this.promotion.reasons.join(" "), /PoC宣言.*昇格根拠/u);
  assert.match(this.promotion.reasons.join(" "), /補完が必要/u);
});

Given("quickとpocを実行する隔離ディレクトリがある", function () {
  this.root = this.temp("asc-poc-e2e-");
});

When("公開staging経路からquickとpocを生成する", function () {
  const answers = completeAnswers();
  this.quickIssue = createIssueStaging(this.root, {
    title: "quick",
    answers,
    now: new Date("2026-08-25T00:00:00Z"),
  });
  this.issue = createIssueStaging(this.root, {
    title: "poc",
    answers,
    requestedMode: "poc",
    poc: completeDeclaration(),
    now: new Date("2026-08-25T00:00:01Z"),
  });
});

function e2eOutput(world: PocModeWorld): {
  quick: { mode: string; files: string[]; text: string };
  poc: { mode: string; files: string[]; text: string };
} {
  return {
    quick: {
      mode: world.quickIssue.mode,
      files: fs.readdirSync(world.quickIssue.path),
      text: fs.readFileSync(
        path.join(world.quickIssue.path, "00_要求定義.md"),
        "utf8",
      ),
    },
    poc: {
      mode: world.issue.mode,
      files: fs.readdirSync(world.issue.path),
      text: fs.readFileSync(
        path.join(world.issue.path, "00_要求定義.md"),
        "utf8",
      ),
    },
  };
}

Then("quickとpocはどちらも00要求定義とstaging記録を生成する", function () {
  const output = e2eOutput(this);
  assert.equal(output.quick.mode, "quick");
  assert.equal(output.poc.mode, "poc");
  assert.deepEqual(output.quick.files, [
    "00_モード判定.json",
    "00_要求定義.md",
    "journal",
    "staging-record.json",
  ]);
  assert.deepEqual(output.poc.files, [
    "00_モード判定.json",
    "00_要求定義.md",
    "journal",
    "staging-record.json",
  ]);
});

Then("quickにはPoC宣言がなくpocにはPoC宣言と停止点がある", function () {
  const output = e2eOutput(this);
  assert.doesNotMatch(output.quick.text, /PoC宣言/u);
  assert.match(output.poc.text, /PoC宣言/u);
  assert.match(output.poc.text, /release、自動merge、本番cleanupは禁止/u);
});
