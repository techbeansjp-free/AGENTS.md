import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { main } from "../../src/cli.js";
import {
  issueRequiredHeadings,
  validateIssue,
  type IssueValidationStage,
} from "../../src/domain/issue.js";
import {
  checkIssueTemplateHeadings,
  checkSkillTemplateContracts,
} from "../../scripts/check_skill_templates.js";

type Validation = ReturnType<typeof validateIssue>;
type HeadingCheck = ReturnType<typeof checkIssueTemplateHeadings>;

interface IssueTemplateContractWorld extends WorkflowWorld {
  check: HeadingCheck;
  issuePath: string;
  mode: "full" | "quick" | "poc";
  packageRoot: string;
  requirementTemplate: string;
  results: Validation[];
  validation: Validation;
  cliOutput: string;
  cliStatus: number;
}

const { Given, When, Then } = stepDefinitions<IssueTemplateContractWorld>();
const repositoryRoot = process.cwd();
const templateDirectory = path.join(
  repositoryRoot,
  ".agent-skill-chain/templates/issue",
);

function materializeTemplate(mode: "full" | "quick" | "poc"): string {
  const file = path.join(templateDirectory, `00_要求定義_${mode}.md`);
  const filled = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) =>
      line.startsWith("## ")
        ? line
        : line
            .replaceAll("applicable / not-applicable", "not-applicable")
            .replace(/（[^）\n]+）/gu, "具体的な記入済み内容")
            .replace(/<[^>\n]+>/gu, "記入済み")
            .replace(/\{[^}\n]+\}/gu, "記入済み"),
    )
    .join("\n");
  return `${filled}

Scenario: SCN-FIXTURE-ISSUE-001 記入済みIssueを検証する
  Given 記入済みである
  When 検証する
  Then 合格する
`;
}

function considerationDocument(): string {
  const rows = ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"]
    .map(
      (id) =>
        `| ${id} | 対象 | not-applicable | CLI文書だけを変更するため対象外である | SCN-FIXTURE-ISSUE-001で確認済み |`,
    )
    .join("\n");
  return `# 検証済み成果物\n\n${rows}\n`;
}

function createIssue(
  world: IssueTemplateContractWorld,
  mode: "full" | "quick" | "poc",
  files: "requirements" | "design" = "design",
): string {
  const issuePath = world.temp("asc-issue-contract-");
  fs.writeFileSync(
    path.join(issuePath, "00_要求定義.md"),
    materializeTemplate(mode),
  );
  if (mode === "full") {
    fs.writeFileSync(
      path.join(issuePath, "01_要件定義.md"),
      considerationDocument(),
    );
    if (files === "design") {
      fs.writeFileSync(
        path.join(issuePath, "02_設計.md"),
        considerationDocument(),
      );
      fs.writeFileSync(
        path.join(issuePath, "03_実装計画.md"),
        considerationDocument(),
      );
    }
  }
  return issuePath;
}

function copyPackageAssets(world: IssueTemplateContractWorld): string {
  const root = world.temp("asc-issue-template-package-");
  for (const relative of [
    ".agent-skill-chain/skills",
    ".agent-skill-chain/templates",
    ".agent-skill-chain/docs",
  ])
    fs.cpSync(path.join(repositoryRoot, relative), path.join(root, relative), {
      recursive: true,
    });
  return root;
}

async function runCli(
  world: IssueTemplateContractWorld,
  arguments_: string[],
): Promise<void> {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    world.cliStatus = await main(arguments_);
    world.cliOutput = output;
  } finally {
    process.stdout.write = originalWrite;
  }
}

Given("出荷Issue templateと検証器の見出し契約がある", function () {
  this.packageRoot = repositoryRoot;
});

When("{string}の要求定義templateを読む", function (mode: string) {
  this.requirementTemplate = fs.readFileSync(
    path.join(
      this.packageRoot,
      ".agent-skill-chain/templates/issue",
      `00_要求定義_${mode}.md`,
    ),
    "utf8",
  );
});

/**
 * 運用ポリシーが求める「着手前に仕様の該当箇所を特定する」を、配布templateの欄として
 * 固定する。**欄が消えると利用側は症状から着手する経路へ戻る。**
 */
Then("要求定義templateは仕様の所有箇所の欄を持つ", function () {
  assert.match(this.requirementTemplate, /^\| *仕様の所有箇所 *\|/mu);
});

When(
  /^(full|quick|poc) modeの見出し契約を検査する$/u,
  function (mode: "full" | "quick" | "poc") {
    this.mode = mode;
    this.check = checkIssueTemplateHeadings(this.packageRoot, [mode]);
  },
);

Then("modeの見出し契約は合格する", function () {
  assert.equal(this.check.valid, true, this.check.errors.join("; "));
});

Given("必須見出しを削除したquick templateがある", function () {
  this.packageRoot = copyPackageAssets(this);
  const file = path.join(
    this.packageRoot,
    ".agent-skill-chain/templates/issue/00_要求定義_quick.md",
  );
  const heading = issueRequiredHeadings("quick")[0];
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(`## ${heading}\n`, ""),
  );
});

Given("任意見出し0. 管理情報を持つquick templateがある", function () {
  this.packageRoot = repositoryRoot;
});

When("変更したIssue templateの見出し契約を検査する", function () {
  this.check = checkIssueTemplateHeadings(this.packageRoot, ["quick"]);
});

Then("quickの不足見出しを示して検査が失敗する", function () {
  assert.equal(this.check.valid, false);
  assert.match(this.check.errors.join(" "), /quick.*必須見出し/u);
});

Given("00と01だけを持つvalidなfull Issueがある", function () {
  this.issuePath = createIssue(this, "full", "requirements");
});

Given("00と01だけが記入済みで02と03が未記入のfull Issueがある", function () {
  this.issuePath = createIssue(this, "full", "requirements");
  fs.writeFileSync(
    path.join(this.issuePath, "02_設計.md"),
    "# 02 設計\n\n将来工程の未記入値は（内容）のままである。\n",
  );
  fs.writeFileSync(
    path.join(this.issuePath, "03_実装計画.md"),
    "# 03 実装計画\n\n将来工程の未記入値は（パス）のままである。\n",
  );
});

When(
  /^(requirements|design)段階でIssueを検証する$/u,
  function (stage: IssueValidationStage) {
    this.validation = validateIssue(this.issuePath, { stage });
  },
);

When("stageを指定せずIssueを検証する", function () {
  this.validation = validateIssue(this.issuePath);
});

Then("Issue検証は合格する", function () {
  assert.equal(this.validation.valid, true, this.validation.errors.join("; "));
});

Then("02と03の不足を示してIssue検証が失敗する", function () {
  assert.equal(this.validation.valid, false);
  assert.match(this.validation.errors.join(" "), /02_設計\.md/u);
  assert.match(this.validation.errors.join(" "), /03_実装計画\.md/u);
});

Given("validなquick Issueがある", function () {
  this.issuePath = createIssue(this, "quick");
});

When("quick Issueを全stage指定と未指定で検証する", function () {
  this.results = [
    validateIssue(this.issuePath),
    validateIssue(this.issuePath, { stage: "requirements" }),
    validateIssue(this.issuePath, { stage: "design" }),
  ];
});

Then("quick Issueの検証結果はすべて同じである", function () {
  assert.ok(this.results.every((result) => result.valid));
  assert.deepEqual(this.results[1], this.results[0]);
  assert.deepEqual(this.results[2], this.results[0]);
});

Given("Gherkin scenario IDがない00と01のfull Issueがある", function () {
  this.issuePath = createIssue(this, "full", "requirements");
  const file = path.join(this.issuePath, "00_要求定義.md");
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(/\nScenario:[\s\S]*$/u, "\n"),
  );
});

Then("Gherkin scenario ID不足を示してIssue検証が失敗する", function () {
  assert.equal(this.validation.valid, false);
  assert.match(this.validation.errors.join(" "), /GherkinシナリオID/u);
});

Given(/^validなquick Issueの本文に(.+)がある$/u, function (kind: string) {
  this.issuePath = createIssue(this, "quick");
  const additions: Record<string, string> = {
    "code spanの型引数":
      "\n技術メモ: `Promise<T>` と ``Map<`key`, T>`` を利用する。\n",
    "code blockのobject literal":
      "\n```ts\nconst value = { key: true };\n```\n",
    説明文の変更しない条件: "\n既存契約（変更しない条件）を維持する。\n",
    "Scenario Outlineのparameter":
      "\nScenario Outline: SCN-FIXTURE-ISSUE-002 入力を検証する\n  Given <parameter>を受け取る\n  Then 正常に扱う\n\n  Examples:\n    | parameter |\n    | value |\n",
    テンプレート由来のplaceholder:
      "\n件名は（人が識別できる件名）のままである。\n",
    placeholder6件: "\n未解決は<a>と<b>と<e>と{c}と{d}と{f}である。\n",
    placeholder5件: "\n未解決は<a>と<b>と<e>と{c}と{d}である。\n",
    templateのラベル行:
      "\n- ドメイン用語台帳の候補差分。列は用語ID、標準語候補、定義、コンテキスト、出典、類義語・禁止表現、状態とする: 追加しない\n- project policyが選択した静的検査。対象外なら理由を書く: lint\n",
  };
  fs.appendFileSync(
    path.join(this.issuePath, "00_要求定義.md"),
    additions[kind] ?? "",
  );
});

When("quick Issueのplaceholderを検証する", function () {
  this.validation = validateIssue(this.issuePath);
});

Then("placeholder errorなしでIssue検証は合格する", function () {
  assert.equal(this.validation.valid, true, this.validation.errors.join("; "));
  assert.equal(
    this.validation.errors.some((error) => error.includes("placeholder")),
    false,
  );
});

Then("placeholder errorを示してIssue検証が失敗する", function () {
  assert.equal(this.validation.valid, false);
  assert.match(this.validation.errors.join(" "), /placeholder/u);
});

function placeholderError(world: { validation: { errors: string[] } }): string {
  const found = world.validation.errors.filter((error) =>
    error.includes("未解決のplaceholder"),
  );
  assert.equal(found.length, 1, world.validation.errors.join("; "));
  return found[0] as string;
}

Then(
  /^placeholder errorが原因の字面"(.+)"を示す$/u,
  function (literal: string) {
    assert.ok(placeholderError(this).includes(literal), placeholderError(this));
  },
);

Then(
  /^placeholder errorが字面"(.+)"と"(.+)"を示す$/u,
  function (literals: string, remainder: string) {
    const error = placeholderError(this);
    assert.equal(this.validation.valid, false);
    assert.ok(error.includes(literals), error);
    assert.ok(error.includes(remainder), error);
  },
);

Then(
  /^placeholder errorが字面"(.+)"を示し省略を示さない$/u,
  function (literals: string) {
    const error = placeholderError(this);
    assert.equal(this.validation.valid, false);
    assert.ok(error.includes(literals), error);
    assert.equal(/ほか\d+件/u.test(error), false, error);
  },
);

Given(
  /^出荷(full|quick) templateを埋めたIssueがある$/u,
  function (mode: "full" | "quick") {
    this.issuePath = createIssue(this, mode);
  },
);

Given("00と01だけを持つ出荷full templateのIssueがある", function () {
  this.issuePath = createIssue(this, "full", "requirements");
});

When("CLIでstageを指定せずIssueを検証する", async function () {
  await runCli(this, ["issue", "validate", `--path=${this.issuePath}`]);
});

When("CLIでrequirements段階のIssueを検証する", async function () {
  await runCli(this, [
    "issue",
    "validate",
    `--path=${this.issuePath}`,
    "--stage=requirements",
  ]);
});

Then("CLIのIssue検証は合格する", function () {
  assert.equal(this.cliStatus, 0, this.cliOutput);
  const output: unknown = JSON.parse(this.cliOutput);
  assert.ok(output && typeof output === "object" && "valid" in output);
  assert.equal(output.valid, true);
});

Given("full templateの必須見出しを改変したpackage資産がある", function () {
  this.packageRoot = copyPackageAssets(this);
  const file = path.join(
    this.packageRoot,
    ".agent-skill-chain/templates/issue/00_要求定義_full.md",
  );
  const heading = issueRequiredHeadings("full")[0];
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(`## ${heading}`, "## 1. 改変見出し"),
  );
});

When("package資産のskills checkを実行する", function () {
  const result = checkSkillTemplateContracts(this.packageRoot);
  this.check = { valid: result.valid, errors: result.errors };
});

Then("fullの不足見出しを示してskills checkが失敗する", function () {
  assert.equal(this.check.valid, false);
  assert.match(this.check.errors.join(" "), /full.*必須見出し/u);
});
