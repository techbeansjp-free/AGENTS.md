import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { main } from "../../src/cli.js";
import {
  DEVELOPMENT_CONSIDERATION_REFERENCE_LINE,
  validateDevelopmentConsiderations,
} from "../../src/domain/conformance.js";
import { validateIssue } from "../../src/domain/issue.js";
import { evaluateReview } from "../../src/domain/review.js";

type Validation = ReturnType<typeof validateIssue>;
type Consideration = ReturnType<typeof validateDevelopmentConsiderations>;

interface DevelopmentConsiderationWorld extends WorkflowWorld {
  considerationDocument: string;
  considerationResult: Consideration;
  reviewInput: unknown;
  reviewResult: ReturnType<typeof evaluateReview>;
  issuePath: string;
  validation: Validation;
  validationError: Error | undefined;
  cliOutput: string;
  cliStatus: number;
}

const { Given, When, Then } = stepDefinitions<DevelopmentConsiderationWorld>();
const repositoryRoot = process.cwd();
const templateDirectory = path.join(
  repositoryRoot,
  ".agent-skill-chain/templates/issue",
);
const SCENARIO = `
Scenario: SCN-FIXTURE-ISSUEDC-001 記入済みIssueを検証する
  Given 記入済みである
  When 検証する
  Then 合格する
`;

/** 出荷templateのplaceholderを埋め、Gherkinは付けない（各Givenが受け入れ例を決める） */
function filledTemplate(mode: "full" | "quick"): string {
  return fs
    .readFileSync(
      path.join(templateDirectory, `00_要求定義_${mode}.md`),
      "utf8",
    )
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
}

function considerationRow(id: string, reason: string): string {
  return `| ${id} | 対象 | not-applicable | ${reason} | SCN-FIXTURE-ISSUEDC-001で確認済み |`;
}

function considerationTable(): string {
  return ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"]
    .map((id) => considerationRow(id, "CLI文書だけを変更するため対象外である"))
    .join("\n");
}

function writeFullStaging(
  world: DevelopmentConsiderationWorld,
  documents: { requirement?: string; requirements: string },
): string {
  const issuePath = world.temp("asc-issue-dc-");
  fs.writeFileSync(
    path.join(issuePath, "00_要求定義.md"),
    documents.requirement ?? `${filledTemplate("full")}${SCENARIO}`,
  );
  fs.writeFileSync(
    path.join(issuePath, "01_要件定義.md"),
    `# 01\n\n${documents.requirements}\n`,
  );
  for (const name of ["02_設計.md", "03_実装計画.md"])
    fs.writeFileSync(
      path.join(issuePath, name),
      `# 成果物\n\n${considerationTable()}\n`,
    );
  return issuePath;
}

function writeQuickStaging(
  world: DevelopmentConsiderationWorld,
  acceptanceExample: string,
  root?: string,
): string {
  const issuePath = root
    ? path.join(root, ".agent-skill-chain", "tmp", "issues", "quick-staging")
    : world.temp("asc-issue-ghk-");
  fs.mkdirSync(issuePath, { recursive: true });
  fs.writeFileSync(
    path.join(issuePath, "00_要求定義.md"),
    `${filledTemplate("quick")}\n${acceptanceExample}\n`,
  );
  return issuePath;
}

function validateWithDialect(
  world: DevelopmentConsiderationWorld,
  gherkinDialect?: string,
): void {
  world.validationError = undefined;
  try {
    world.validation = validateIssue(world.issuePath, { gherkinDialect });
  } catch (error) {
    world.validationError =
      error instanceof Error ? error : new Error(String(error));
  }
}

Given(/^理由が「(.+)」である開発考慮事項がある$/u, function (reason: string) {
  this.considerationDocument = [
    considerationRow("DC-PRIVACY", reason),
    considerationRow("DC-OBSERVABILITY", reason),
    considerationRow("DC-UX", reason),
    considerationRow("DC-TOKENS", reason),
  ].join("\n");
});

When("開発考慮事項を検証する", function () {
  this.considerationResult = validateDevelopmentConsiderations(
    this.considerationDocument,
    "01_要件定義.md",
  );
});

Then("開発考慮事項の検証は合格する", function () {
  assert.equal(
    this.considerationResult.valid,
    true,
    this.considerationResult.errors.join("; "),
  );
});

Then("DC-PRIVACYの理由が具体化されていないerrorで拒否する", function () {
  assert.equal(this.considerationResult.valid, false);
  assert.ok(
    this.considerationResult.errors.includes(
      "01_要件定義.md: DC-PRIVACYの理由が具体化されていません",
    ),
    this.considerationResult.errors.join("; "),
  );
});

Given(
  /^developmentConsiderationsの証拠に「(.+)」を残したreview JSONがある$/u,
  function (evidence: string) {
    this.reviewInput = {
      round: 1,
      findings: [],
      developmentConsiderations: [
        {
          id: "DC-PRIVACY",
          status: "not-applicable",
          reason: "CLI文書だけを変更するため対象外である",
          evidence,
        },
        ...["DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"].map((id) => ({
          id,
          status: "not-applicable",
          reason: "CLI文書だけを変更するため対象外である",
          evidence: "SCN-FIXTURE-ISSUEDC-001で確認済み",
        })),
      ],
    };
  },
);

When("reviewを評価する", function () {
  this.reviewResult = evaluateReview(this.reviewInput);
});

Given(
  /^developmentConsiderationsの理由に「(.+)」を含むreview JSONがある$/u,
  function (reason: string) {
    this.reviewInput = {
      round: 1,
      findings: [],
      developmentConsiderations: [
        "DC-PRIVACY",
        "DC-OBSERVABILITY",
        "DC-UX",
        "DC-TOKENS",
      ].map((id) => ({
        id,
        status: "not-applicable",
        reason:
          id === "DC-PRIVACY"
            ? reason
            : "CLI文書だけを変更するため対象外である",
        evidence: "SCN-FIXTURE-ISSUEDC-001で確認済み",
      })),
    };
  },
);

Then(
  "reviewはDC-PRIVACYの理由が具体化されていないerrorで拒否する",
  function () {
    assert.equal(this.reviewResult.approved, false);
    assert.ok(
      this.reviewResult.errors.includes(
        "review: DC-PRIVACYの理由が具体化されていません",
      ),
      this.reviewResult.errors.join("; "),
    );
  },
);

Then(
  "reviewはDC-PRIVACYの証拠が具体化されていないerrorで拒否する",
  function () {
    assert.equal(this.reviewResult.approved, false);
    assert.ok(
      this.reviewResult.errors.includes(
        "review: DC-PRIVACYの証拠が具体化されていません",
      ),
      this.reviewResult.errors.join("; "),
    );
  },
);

Given("01の開発考慮事項欄が参照行1行だけのfull stagingがある", function () {
  this.issuePath = writeFullStaging(this, {
    requirements: DEVELOPMENT_CONSIDERATION_REFERENCE_LINE,
  });
});

Given(
  "01が参照行とplaceholderを残したDC-PRIVACYの1行を持つfull stagingがある",
  function () {
    this.issuePath = writeFullStaging(this, {
      requirements: [
        DEVELOPMENT_CONSIDERATION_REFERENCE_LINE,
        "",
        considerationRow("DC-PRIVACY", "対象外である。（範囲を限定した理由）"),
      ].join("\n"),
    });
  },
);

Given("00の開発考慮事項欄が参照行だけのfull stagingがある", function () {
  const requirement = `${filledTemplate("full")}${SCENARIO}`
    .split("\n")
    .filter((line) => !/^\| DC-[A-Z]+ \|/u.test(line))
    .join("\n")
    .replace(
      /^(### 6\.1 開発考慮事項の適用判定[^\n]*)\n/mu,
      `$1\n\n${DEVELOPMENT_CONSIDERATION_REFERENCE_LINE}\n`,
    );
  assert.ok(requirement.includes(DEVELOPMENT_CONSIDERATION_REFERENCE_LINE));
  this.issuePath = writeFullStaging(this, {
    requirement,
    requirements: considerationTable(),
  });
});

Given("01の開発考慮事項欄が空のfull stagingがある", function () {
  this.issuePath = writeFullStaging(this, {
    requirements: "開発考慮事項は00と同じ",
  });
});

When("方言を指定せずIssueを検証する", function () {
  validateWithDialect(this);
});

Then("参照行つきのIssue検証は合格する", function () {
  assert.equal(this.validationError, undefined);
  assert.equal(this.validation.valid, true, this.validation.errors.join("; "));
});

Then("DC-PRIVACYの理由が具体化されていないerrorだけで拒否する", function () {
  assert.equal(this.validation.valid, false);
  assert.deepEqual(this.validation.errors, [
    "01_要件定義.md: DC-PRIVACYの理由が具体化されていません",
  ]);
});

Then("00_要求定義.mdは参照行を使用できないerrorで拒否する", function () {
  assert.equal(this.validation.valid, false);
  assert.ok(
    this.validation.errors.some((error) =>
      error.startsWith("00_要求定義.mdは参照行を使用できません"),
    ),
    this.validation.errors.join("; "),
  );
});

Then("DC-PRIVACYが重複なく1件必要なerrorで拒否する", function () {
  assert.equal(this.validation.valid, false);
  assert.ok(
    this.validation.errors.includes(
      "01_要件定義.md: DC-PRIVACYは重複なく1件必要です",
    ),
    this.validation.errors.join("; "),
  );
});

Given(
  /^受け入れ例を「(.+)」で書いたquick stagingがある$/u,
  function (scenarioLine: string) {
    this.issuePath = writeQuickStaging(
      this,
      `${scenarioLine} 記入済みIssueを検証する\n  Given 記入済みである\n  Then 合格する\n`,
    );
  },
);

Given(
  "「シナリオテンプレート:」と「<値>」を持つquick stagingがある",
  function () {
    this.issuePath = writeQuickStaging(
      this,
      "シナリオテンプレート: SCN-X-002 <値>を検証する\n  Given <値>を受け取る\n  Then 正常に扱う\n\n  Examples:\n    | 値 |\n    | a |\n",
    );
  },
);

Given(
  "gherkinDialectがjaのproject choiceを4階層上に持つquick stagingがある",
  function () {
    const root = this.temp("asc-issue-ghk-root-");
    fs.mkdirSync(path.join(root, ".agent-skill-chain"), { recursive: true });
    fs.copyFileSync(
      path.join(repositoryRoot, ".agent-skill-chain", "project-policy.json"),
      path.join(root, ".agent-skill-chain", "project-policy.json"),
    );
    fs.cpSync(
      path.join(repositoryRoot, ".agent-skill-chain", "project"),
      path.join(root, ".agent-skill-chain", "project"),
      { recursive: true },
    );
    const choices = path.join(
      root,
      ".agent-skill-chain",
      "project",
      "choices",
      "development.json",
    );
    const parsed: unknown = JSON.parse(fs.readFileSync(choices, "utf8"));
    assert.ok(parsed && typeof parsed === "object");
    fs.writeFileSync(
      choices,
      `${JSON.stringify({ ...parsed, gherkinDialect: "ja" }, null, 2)}\n`,
    );
    this.issuePath = writeQuickStaging(
      this,
      "シナリオ: SCN-X-001 記入済みIssueを検証する\n  Given 記入済みである\n  Then 合格する\n",
      root,
    );
  },
);

When(/^方言(\w+)でIssueを検証する$/u, function (dialect: string) {
  validateWithDialect(this, dialect);
});

When("CLIでIssueを検証する", async function () {
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
    ]);
    this.cliOutput = output;
  } finally {
    process.stdout.write = originalWrite;
  }
  const parsed: unknown = JSON.parse(this.cliOutput);
  assert.ok(parsed && typeof parsed === "object" && "errors" in parsed);
  this.validation = parsed as Validation;
  this.validationError = undefined;
});

Then("GherkinシナリオIDがありませんのerrorを含まない", function () {
  assert.equal(this.validationError, undefined);
  assert.equal(
    this.validation.errors.includes("GherkinシナリオIDがありません"),
    false,
    this.validation.errors.join("; "),
  );
});

Then("GherkinシナリオIDがありませんのerrorを含む", function () {
  assert.equal(this.validationError, undefined);
  assert.ok(this.validation.errors.includes("GherkinシナリオIDがありません"));
});

Then("gherkinDialectが未対応のerrorで拒否する", function () {
  assert.ok(this.validationError, "throwを期待した");
  assert.match(
    this.validationError.message,
    /^gherkinDialectが未対応です: xx/u,
  );
});

Then("ja Outlineのplaceholder errorなしでIssue検証は合格する", function () {
  assert.equal(this.validationError, undefined);
  assert.equal(this.validation.valid, true, this.validation.errors.join("; "));
});
