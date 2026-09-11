import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../src/cli.js";
import { validateIssue } from "../../src/domain/issue.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

type Validation = ReturnType<typeof validateIssue>;

interface RiskShortFormWorld extends WorkflowWorld {
  issuePath: string;
  validation: Validation;
  templates: string[];
  cliOutput: string;
  cliStatus: number;
}

const { Given, When, Then } = stepDefinitions<RiskShortFormWorld>();
const repositoryRoot = process.cwd();

function considerationRows(): string {
  return ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"]
    .map(
      (id) =>
        `| ${id} | 対象 | not-applicable | CLI成果物検証だけを変更するため対象外である | SCN-WF-1334-001で確認する |`,
    )
    .join("\n");
}

function requirement(): string {
  const headings = [
    "0. 管理情報",
    "1. 目的と背景",
    "2. 対象範囲",
    "3. 利害関係者と利用場面",
    "4. ドメイン影響",
    "5. 要求の概要",
    "6. 制約、前提、依存関係",
    "7. 受け入れ条件と成功基準",
    "8. リスクと安全側への縮小",
    "9. モード判定Q-01〜Q-08",
    "10. P-01〜P-07の適用計画",
    "11. 図表と識別子の判断",
    "12. 参考資料、未決事項、再開地点",
  ];
  return [
    "# 00 要求定義",
    "",
    "| モード | `full` |",
    ...headings.flatMap((heading) => [`## ${heading}`, "", "記入済み内容"]),
    "",
    ...Array.from(
      { length: 7 },
      (_, index) => `P-${String(index + 1).padStart(2, "0")}: 記入済み証拠`,
    ),
    "",
    considerationRows(),
    "",
    "Scenario: SCN-WF-1334-001 risk比例の成果物を検証する",
    "  Given 記入済みである",
    "  When 検証する",
    "  Then 合格する",
  ].join("\n");
}

function artifact(kind: "short" | "empty" | "detailed", plan: boolean): string {
  const value =
    kind === "short"
      ? "対象外: この変更では該当する判断がないため"
      : kind === "empty"
        ? "対象外:"
        : "既存契約を維持し、具体的な判断と検証方法を記録する。";
  const sections = plan
    ? [`## 5. 実行可能な受け入れ例とtest計画`, `### 5.2 安全性の必須観点`]
    : [
        `## 4. ドメインモデルとデータ`,
        `### 4.2 識別子・UUID（必要な場合だけ）`,
        `## 8. UIと表示契約（該当時）`,
        `## 9. 観測可能性`,
      ];
  return [
    plan ? "# 03 実装計画" : "# 02 設計",
    "",
    considerationRows(),
    "",
    ...sections.flatMap((heading, index) => [
      heading,
      "",
      heading.startsWith("###") || index > 0 ? value : "記入済み内容",
      "",
    ]),
  ].join("\n");
}

function writeStaging(
  world: RiskShortFormWorld,
  risk: string,
  kind: "short" | "empty" | "detailed",
): void {
  world.issuePath = world.temp("asc-issue-risk-short-");
  fs.writeFileSync(path.join(world.issuePath, "00_要求定義.md"), requirement());
  fs.writeFileSync(
    path.join(world.issuePath, "01_要件定義.md"),
    `# 01 要件定義\n\n${considerationRows()}\n`,
  );
  fs.writeFileSync(
    path.join(world.issuePath, "02_設計.md"),
    artifact(kind, false),
  );
  fs.writeFileSync(
    path.join(world.issuePath, "03_実装計画.md"),
    artifact(kind, true),
  );
  fs.writeFileSync(
    path.join(world.issuePath, "verification-input.json"),
    JSON.stringify({
      changeType: "documentation",
      risk,
      affectedBoundaries: ["Issue成果物検証"],
      requirementIds: ["REQ-WF-018"],
      acceptanceCriteriaIds: ["AC-WF-018-01"],
      impactAnalysis: {
        securityRelevant: false,
        dataLossPossible: false,
        irreversibleOperation: false,
        externalContractChanged: false,
        concurrentBehaviorChanged: false,
      },
    }),
  );
}

Given(
  /^Verification Set riskが"([^"]+)"で02と03の対象節が理由付き短縮行である$/u,
  function (risk: string) {
    writeStaging(this, risk, "short");
  },
);

Given(
  /^Verification Set riskが"([^"]+)"で02と03の対象節が理由なし短縮行である$/u,
  function (risk: string) {
    writeStaging(this, risk, "empty");
  },
);

Given(
  /^Verification Set riskが"([^"]+)"で02と03の対象節が詳細記述である$/u,
  function (risk: string) {
    writeStaging(this, risk, "detailed");
  },
);

Given("low-risk短縮行のVerification Set入力がsymlinkである", function () {
  writeStaging(this, "low", "short");
  const input = path.join(this.issuePath, "verification-input.json");
  const target = path.join(this.issuePath, "verification-target.json");
  fs.renameSync(input, target);
  fs.symlinkSync(path.basename(target), input);
});

When("risk比例のIssue成果物を検証する", function () {
  this.validation = validateIssue(this.issuePath, { stage: "design" });
});

Then("risk比例のIssue検証は合格する", function () {
  assert.equal(this.validation.valid, true, this.validation.errors.join("; "));
});

When("CLIでrisk比例のIssue成果物を検証する", async function () {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    this.cliStatus = await main([
      "issue",
      "validate",
      `--path=${this.issuePath}`,
      "--stage=design",
    ]);
    this.cliOutput = output;
  } finally {
    process.stdout.write = originalWrite;
  }
});

Then("CLIのrisk比例Issue検証は合格する", function () {
  assert.equal(this.cliStatus, 0, this.cliOutput);
  assert.equal((JSON.parse(this.cliOutput) as { valid: boolean }).valid, true);
});

Then("CLIはrisk=low限定の診断で失敗する", function () {
  assert.equal(this.cliStatus, 1, this.cliOutput);
  assert.match(this.cliOutput, /risk=low/u);
  assert.match(this.cliOutput, /対象外/u);
});

Then("short formを許可するriskがlowだけだと示して拒否する", function () {
  assert.equal(this.validation.valid, false);
  assert.match(this.validation.errors.join(" "), /risk=low/u);
  assert.match(this.validation.errors.join(" "), /対象外/u);
});

Then("理由付きの単一行書式を示して拒否する", function () {
  assert.equal(this.validation.valid, false);
  assert.match(this.validation.errors.join(" "), /対象外: <理由>.*1行/u);
});

Then("Verification Set入力が通常fileでないと示して拒否する", function () {
  assert.equal(this.validation.valid, false);
  assert.match(this.validation.errors.join(" "), /通常file/u);
});

Given("出荷される02と03のIssue templateがある", function () {
  this.templates = ["02_設計.md", "03_実装計画.md"].map((name) =>
    fs.readFileSync(
      path.join(repositoryRoot, ".agent-skill-chain/templates/issue", name),
      "utf8",
    ),
  );
});

When("risk比例短縮のtemplate注記を検査する", function () {
  // Givenで読み取ったbyte列をThenで契約検査する。
});

Then("両templateがlow限定とissue validateを明記する", function () {
  for (const template of this.templates) {
    assert.match(template, /risk.*`low`/u);
    assert.match(template, /`対象外: <理由>`/u);
    assert.match(template, /`issue validate`/u);
  }
});
