import assert from "node:assert/strict";
import { fixtureInstant } from "../support/fixture-instant.js";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { main } from "../../src/cli.js";
import {
  DEVELOPMENT_CONSIDERATION_REFERENCE_LINE,
  validateDevelopmentConsiderations,
} from "../../src/domain/conformance.js";
import { createIssueStaging, validateIssue } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import { isRecord } from "../../src/types.js";
import {
  STEP_JOURNAL_FILE,
  parseStepJournal,
} from "../../src/domain/workflow.js";
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

Given(
  "01が参照行と未知ID DC-UNKNOWNの1行を持つfull stagingがある",
  function () {
    this.issuePath = writeFullStaging(this, {
      requirements: [
        DEVELOPMENT_CONSIDERATION_REFERENCE_LINE,
        "",
        considerationRow("DC-UNKNOWN", "十分に具体的な差分理由である"),
      ].join("\n"),
    });
  },
);

Given("01がcode fenceの中にだけ参照行を持つfull stagingがある", function () {
  this.issuePath = writeFullStaging(this, {
    requirements: `~~~text\n${DEVELOPMENT_CONSIDERATION_REFERENCE_LINE}\n~~~`,
  });
});

Then("DC-UNKNOWNは未知の開発契約IDのerrorで拒否する", function () {
  assert.equal(this.validation.valid, false);
  assert.ok(
    this.validation.errors.includes(
      "01_要件定義.md: DC-UNKNOWNは未知の開発契約IDです",
    ),
    this.validation.errors.join("; "),
  );
});

Given(
  "01がmarkdown fenceの中にtext fenceと参照行を持つfull stagingがある",
  function () {
    this.issuePath = writeFullStaging(this, {
      requirements: [
        "```markdown",
        "```text",
        DEVELOPMENT_CONSIDERATION_REFERENCE_LINE,
        "```",
        "```",
      ].join("\n"),
    });
  },
);

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
  "「シナリオテンプレート:」と「前提 <値>」を持つquick stagingがある",
  function () {
    this.issuePath = writeQuickStaging(
      this,
      "シナリオテンプレート: SCN-X-004 入力を検証する\n  前提 <値>を受け取る\n  ならば 正常に扱う\n\n  例:\n    | 値 |\n    | a |\n",
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

Given("Gherkinを含まない完成済みfull要求だけがある", function () {
  this.issuePath = this.temp("asc-full-request-");
  fs.writeFileSync(
    path.join(this.issuePath, "00_要求定義.md"),
    filledTemplate("full"),
  );
});

Given("Gherkinを含まない「{word}」要求がある", function (mode: string) {
  assert.ok(["full", "quick", "poc"].includes(mode));
  this.issuePath = this.temp("asc-required-scenario-");
  const document = filledTemplate(mode === "full" ? "full" : "quick");
  fs.writeFileSync(
    path.join(this.issuePath, "00_要求定義.md"),
    mode === "poc"
      ? document.replace(/\|\s*モード\s*\|[^\n]+/u, "| モード | poc |")
      : document,
  );
});

When("request段階でIssueを検証する", function () {
  this.validation = validateIssue(this.issuePath, { stage: "request" });
});

When("「{word}」段階でIssueを検証する", function (stage: string) {
  assert.ok(["request", "requirements", "default"].includes(stage));
  this.validation = validateIssue(this.issuePath, {
    ...(stage === "default"
      ? {}
      : { stage: stage as "request" | "requirements" }),
  });
});

Then("full要求だけで検証が成功する", function () {
  assert.equal(this.validation.valid, true, this.validation.errors.join("; "));
  assert.equal(this.validation.mode, "full");
  assert.deepEqual(this.validation.errors, []);
});

When("不正なGherkin IDを追記してrequest段階で検証する", function () {
  fs.appendFileSync(
    path.join(this.issuePath, "00_要求定義.md"),
    "\nScenario: SCN-invalid 不正ID\n",
  );
  this.validation = validateIssue(this.issuePath, { stage: "request" });
});

Then("Gherkin IDの文法エラーで拒否する", function () {
  assert.equal(this.validation.valid, false);
  assert.ok(
    this.validation.errors.some((error) =>
      error.includes("GherkinシナリオIDの文法が不正"),
    ),
  );
});

async function recordFullRequest(
  world: DevelopmentConsiderationWorld,
  prepareNext = false,
  failNext = false,
): Promise<void> {
  const root = world.initRepo();
  const requirement = fs.readFileSync(
    path.join(world.issuePath, "00_要求定義.md"),
    "utf8",
  );
  world.issuePath = createIssueStaging(root, {
    title: "full-request-stage",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: false, evidence: "隔離fixtureの要求範囲で確認済み" },
      ]),
    ),
    requestedMode: "full",
    now: new Date(fixtureInstant()),
  }).path;
  fs.writeFileSync(path.join(world.issuePath, "00_要求定義.md"), requirement);
  const originalWrite = process.stdout.write;
  const originalStringify = JSON.stringify;
  const previousContext = process.env.ASC_EXECUTION_CONTEXT_MODE;
  process.env.ASC_EXECUTION_CONTEXT_MODE = "short-lived";
  let injected = false;
  if (failNext)
    JSON.stringify = new Proxy(originalStringify, {
      apply(
        target,
        receiver: unknown,
        args: Parameters<typeof JSON.stringify>,
      ) {
        const value: unknown = args[0];
        if (
          !injected &&
          isRecord(value) &&
          value.step === 2 &&
          value.role === "requirements" &&
          "boundary" in value
        ) {
          injected = true;
          throw new Error("injected next Work Unit observation failure");
        }
        return Reflect.apply(target, receiver, args) as string | undefined;
      },
    });
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    world.cliStatus = await main([
      "workflow",
      "advance",
      `--staging=${world.issuePath}`,
      "--artifact=00_要求定義.md",
      "--evidence=full要求が完成し後工程のGherkinを先取りしない",
      "--apply",
      ...(prepareNext ? ["--prepare-next"] : []),
    ]);
    world.cliOutput = output;
    if (failNext) assert.equal(injected, true);
  } finally {
    process.stdout.write = originalWrite;
    JSON.stringify = originalStringify;
    if (previousContext === undefined)
      delete process.env.ASC_EXECUTION_CONTEXT_MODE;
    else process.env.ASC_EXECUTION_CONTEXT_MODE = previousContext;
  }
}

When("full要求を正規のworkflow advanceで記録する", async function () {
  await recordFullRequest(this);
});

When("full要求を記録して次Work Unitを返す", async function () {
  await recordFullRequest(this, true);
});

Then("次の知的作業を返し追加のStepを適用しない", function () {
  const result: unknown = JSON.parse(this.cliOutput);
  assert.ok(isRecord(result) && isRecord(result.preparation));
  assert.equal(result.preparation.status, "ready");
  const plan = result.preparation.executionPlan;
  assert.ok(isRecord(plan) && isRecord(plan.action));
  assert.equal(plan.kind, "asc-execution-plan/v1");
  assert.equal(plan.authority, "advisory");
  assert.equal(plan.state, "ready");
  assert.equal(plan.step, 2);
  assert.equal(plan.action.executor, "fresh-worker");
  assert.equal(plan.action.maxTransitions, 1);
});

When("full要求の記録後に次Work Unitの観測が失敗する", async function () {
  await recordFullRequest(this, true, true);
});

Then(
  "適用済みStepを保持し読取だけで同じ次Work Unitを回復する",
  async function () {
    assert.equal(this.cliStatus, 1, this.cliOutput);
    const result: unknown = JSON.parse(this.cliOutput);
    assert.ok(isRecord(result) && isRecord(result.preparation));
    assert.equal(result.state, "applied");
    assert.equal(result.preparation.status, "blocked");
    assert.ok(isRecord(result.preparation.recovery));
    assert.equal(result.preparation.recovery.appliesTransition, false);
    assert.deepEqual(result.preparation.recovery.argv, [
      "workflow",
      "advance",
      `--staging=${this.issuePath}`,
      "--plan",
    ]);
    const journalPath = path.join(this.issuePath, STEP_JOURNAL_FILE);
    const before = fs.readFileSync(journalPath, "utf8");
    assert.deepEqual(
      parseStepJournal(before).entries.map(({ step }) => step),
      [0, 1],
    );
    const originalWrite = process.stdout.write;
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const plans: unknown[] = [];
      for (let i = 0; i < 2; i++) {
        output = "";
        assert.equal(
          await main([
            "workflow",
            "advance",
            `--staging=${this.issuePath}`,
            "--plan",
          ]),
          0,
          output,
        );
        const plan: unknown = JSON.parse(output);
        assert.ok(isRecord(plan) && isRecord(plan.action));
        assert.equal(plan.step, 2);
        assert.equal(plan.action.executor, "fresh-worker");
        plans.push(plan);
        assert.equal(fs.readFileSync(journalPath, "utf8"), before);
      }
      assert.deepEqual(plans[0], plans[1]);
    } finally {
      process.stdout.write = originalWrite;
    }
  },
);

Then("Step 1だけが記録され後工程は未完了のままである", function () {
  assert.equal(this.cliStatus, 0, this.cliOutput);
  const result: unknown = JSON.parse(this.cliOutput);
  assert.ok(isRecord(result));
  assert.equal(result.state, "applied");
  assert.equal(result.targetStep, 1);
  assert.equal(result.validationStage, "request");
  const journal = parseStepJournal(
    fs.readFileSync(path.join(this.issuePath, STEP_JOURNAL_FILE), "utf8"),
  );
  assert.deepEqual(
    journal.entries.map(({ step }) => step),
    [0, 1],
  );
  const downstream = validateIssue(this.issuePath, { stage: "requirements" });
  assert.equal(downstream.valid, false);
  assert.ok(downstream.errors.includes("GherkinシナリオIDがありません"));
});
