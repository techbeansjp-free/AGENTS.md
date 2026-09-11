import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { validateIssue } from "../../src/domain/issue.js";
import { validateDeliveryEvidence } from "../../src/domain/delivery.js";
import { isScenarioId } from "../../src/domain/scenario-id.js";

type Validation = ReturnType<typeof validateIssue>;

interface Judgement {
  id: string;
  issue: boolean;
  delivery: boolean;
}

interface Staging {
  label: string;
  id: string;
  expected: boolean;
  dialect: string | undefined;
  path: string;
}

interface ScenarioIdWorld extends WorkflowWorld {
  issuePath: string;
  validation: Validation;
  ids: string[];
  judgements: Judgement[];
  stagings: Staging[];
  results: Array<{ staging: Staging; validation: Validation }>;
}

const { Given, When, Then } = stepDefinitions<ScenarioIdWorld>();
const repositoryRoot = process.cwd();
const HEAD = "a".repeat(40);
/** 正規IDと文法外IDの混在集合。悪用観点は小文字、下線、全角、空本体、小文字接頭辞 */
const MIXED_IDS = [
  "SCN-69-001",
  "SCN-A",
  "SCN-UNIT-TRACE-001",
  "SCN-69-001a",
  "SCN-69_001",
  "SCN-",
  "SCN-６９-００１",
  "scn-69-001",
];

function filledTemplate(): string {
  return fs
    .readFileSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/templates/issue/00_要求定義_full.md",
      ),
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

function considerationTable(): string {
  return ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"]
    .map(
      (id) =>
        `| ${id} | 対象 | not-applicable | CLI文書だけを変更するため対象外である | 文法検査だけを確認済み |`,
    )
    .join("\n");
}

/** 00はGherkinを持たず、01のscenario行だけがIDの出所になるfull staging */
function writeFullStaging(
  world: ScenarioIdWorld,
  requirements: string,
): string {
  const issuePath = world.temp("asc-scnid-");
  fs.writeFileSync(path.join(issuePath, "00_要求定義.md"), filledTemplate());
  fs.writeFileSync(path.join(issuePath, "01_要件定義.md"), requirements);
  for (const name of ["02_設計.md", "03_実装計画.md"])
    fs.writeFileSync(
      path.join(issuePath, name),
      `# 成果物\n\n${considerationTable()}\n`,
    );
  return issuePath;
}

function issueAccepts(world: ScenarioIdWorld, id: string): boolean {
  const issuePath = writeFullStaging(
    world,
    `# 01\n\n${considerationTable()}\n\nScenario: ${id} 受け入れ例\n`,
  );
  const validation = validateIssue(issuePath);
  return (
    validation.valid &&
    !validation.errors.some((error) => error.includes("GherkinシナリオID"))
  );
}

function deliveryAccepts(id: string): boolean {
  try {
    validateDeliveryEvidence(
      {
        headSha: HEAD,
        review: { approved: true, headSha: HEAD },
        tests: { passed: true, headSha: HEAD, scenarioIds: [id] },
        spec: {
          consistent: true,
          headSha: HEAD,
          impact: "no-spec-impact",
          rationale: "文法検査だけを確認する固定fixture",
        },
      },
      HEAD,
    );
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "テスト証拠に不正なSCN IDがあります"
    )
      return false;
    throw error;
  }
}

Given(
  /^01に「Scenario: (SCN-\S+)」の行を持つfull stagingがある$/u,
  function (id: string) {
    this.issuePath = writeFullStaging(
      this,
      `# 01\n\n${considerationTable()}\n\nScenario: ${id} 受け入れ例\n`,
    );
  },
);

When("SCN ID検査のためIssueを検証する", function () {
  this.validation = validateIssue(this.issuePath);
});

Then(
  /^Issue検証は(SCN-\S+)の文法が不正であるerrorで拒否する$/u,
  function (id: string) {
    assert.equal(this.validation.valid, false);
    const matching = this.validation.errors.filter(
      (error) =>
        error.startsWith("GherkinシナリオIDの文法が不正です") &&
        error.includes(`文法が不正です: ${id}（`),
    );
    assert.equal(matching.length, 1, this.validation.errors.join("\n"));
    assert.match(matching[0] ?? "", /SCN-に大文字英数字とハイフン/u);
    // 末尾境界で閉じるため、文法外IDだけのstagingは正規IDを1件も持たない
    assert.ok(this.validation.errors.includes("GherkinシナリオIDがありません"));
  },
);

Then("SCN ID検査つきのIssue検証は合格する", function () {
  assert.deepEqual(this.validation.errors, []);
  assert.equal(this.validation.valid, true);
});

Given("正規IDと文法外IDを混在させたSCN ID集合がある", function () {
  this.ids = [...MIXED_IDS];
});

When("各IDをscenario行検査とdelivery証跡検査へ与える", function () {
  this.judgements = this.ids.map((id) => ({
    id,
    issue: issueAccepts(this, id),
    delivery: deliveryAccepts(id),
  }));
});

Then("すべてのIDで両検査の受理・拒否が一致する", function () {
  const mismatched = this.judgements.filter(
    (judgement) => judgement.issue !== judgement.delivery,
  );
  assert.deepEqual(mismatched, []);
  // 混在staging（round 1 REV-01）: 正規行と同居しても文法外IDを1件ずつ名指しする
  const mixed = validateIssue(
    writeFullStaging(
      this,
      `# 01\n\n${considerationTable()}\n\n${this.ids
        .map((id) => `Scenario: ${id} 受け入れ例`)
        .join("\n")}\n`,
    ),
  );
  assert.equal(mixed.valid, false);
  for (const id of this.ids.filter((candidate) => !isScenarioId(candidate)))
    assert.equal(
      mixed.errors.filter(
        (error) =>
          error.startsWith("GherkinシナリオIDの文法が不正です") &&
          error.includes(`文法が不正です: ${id}（`),
      ).length,
      1,
      `${id}: ${mixed.errors.join("; ")}`,
    );
  const accepted = this.judgements
    .filter((judgement) => judgement.issue)
    .map((judgement) => judgement.id);
  assert.deepEqual(accepted, ["SCN-69-001", "SCN-A", "SCN-UNIT-TRACE-001"]);
});

Given(
  "行末空白、CRLF、Scenario Outline、シナリオ:の各形で正規IDと文法外IDを置いたstagingがある",
  function () {
    const forms: Array<{
      label: string;
      dialect: string | undefined;
      line: (id: string) => string;
    }> = [
      {
        label: "行末空白",
        dialect: undefined,
        line: (id) => `Scenario: ${id}   \n`,
      },
      {
        label: "CRLF",
        dialect: undefined,
        line: (id) => `Scenario: ${id}\r\n`,
      },
      {
        label: "Outline",
        dialect: undefined,
        line: (id) => `Scenario Outline: ${id} 受け入れ例\n`,
      },
      {
        label: "ja",
        dialect: "ja",
        line: (id) => `シナリオ: ${id} 受け入れ例\n`,
      },
    ];
    this.stagings = [];
    for (const form of forms)
      for (const [id, expected] of [
        ["SCN-69-001", true],
        ["SCN-69-001a", false],
      ] as const)
        this.stagings.push({
          label: form.label,
          id,
          expected,
          dialect: form.dialect,
          path: writeFullStaging(
            this,
            `# 01\n\n${considerationTable()}\n\n${form.line(id)}`,
          ),
        });
  },
);

When("各stagingをそれぞれの方言で検証する", function () {
  this.results = this.stagings.map((staging) => ({
    staging,
    validation: validateIssue(staging.path, {
      gherkinDialect: staging.dialect,
    }),
  }));
});

Then(
  "正規IDのstagingは合格し文法外IDのstagingは当該IDを名指しして拒否する",
  function () {
    for (const { staging, validation } of this.results) {
      const label = `${staging.label}/${staging.id}: ${validation.errors.join("; ")}`;
      if (staging.expected) {
        assert.equal(validation.valid, true, label);
      } else {
        assert.equal(validation.valid, false, label);
        assert.equal(
          validation.errors.filter(
            (error) =>
              error.startsWith("GherkinシナリオIDの文法が不正です") &&
              error.includes(`文法が不正です: ${staging.id}（`),
          ).length,
          1,
          label,
        );
      }
    }
  },
);
