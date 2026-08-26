import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  DISTRIBUTION_IMPACT_HEADING,
  distributedPaths,
  validateDistributionImpact,
} from "../../src/domain/conformance.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

const PACKAGE_FILES = [
  "dist/bin/",
  "dist/src/",
  ".agent-skill-chain/00_利用案内.md",
  ".agent-skill-chain/skills/",
  ".agent-skill-chain/templates/",
  ".agent-skill-chain/schemas/",
  ".agent-skill-chain/policy/",
  ".agent-skill-chain/docs/",
  "README.md",
  "AGENTS.md",
];

function section(body: string): string {
  return [
    "# review",
    "",
    "## 変更ファイル個別監査",
    "",
    DISTRIBUTION_IMPACT_HEADING,
    "",
    body,
    "",
    "## 肯定・敵対レビュー",
    "",
  ].join("\n");
}

function check(markdown: string, changedPaths: string[]) {
  return validateDistributionImpact({
    markdown,
    changedPaths,
    packageFiles: PACKAGE_FILES,
  });
}

const REASON =
  "runtimeの利用条件は変わらないため配布文書の更新は不要である。判断の根拠をここへ十分な長さで記述する。";
const DECIDED = `判断: 配布物を更新した\n\n根拠: ${REASON}`;

const CHECKS: Readonly<Record<string, () => void>> = {
  "SCN-UNIT-DISTIMPACT-001": () => {
    assert.deepEqual(
      distributedPaths({
        changedPaths: [
          ".agent-skill-chain/docs/02_品質基準.md",
          "README.md",
          "AGENTS.md",
        ],
        packageFiles: PACKAGE_FILES,
      }),
      [".agent-skill-chain/docs/02_品質基準.md", "AGENTS.md", "README.md"],
    );
  },
  "SCN-UNIT-DISTIMPACT-002": () => {
    assert.deepEqual(
      distributedPaths({
        changedPaths: ["src/cli.ts", "bin/agent-skill-chain.ts"],
        packageFiles: PACKAGE_FILES,
      }),
      ["bin/agent-skill-chain.ts", "src/cli.ts"],
    );
  },
  "SCN-UNIT-DISTIMPACT-003": () => {
    assert.deepEqual(
      distributedPaths({
        changedPaths: [
          "scripts/check_file_audit.ts",
          "docs/specs/02_要件/00_要件一覧.md",
          "test/steps/unit.steps.ts",
          ".github/workflows/ci.yml",
          ".agent-skill-chain/project/rules/docs.json",
        ],
        packageFiles: PACKAGE_FILES,
      }),
      [],
    );
  },
  "SCN-UNIT-DISTIMPACT-004": () => {
    const result = check("# review\n\n## 肯定・敵対レビュー\n", ["src/cli.ts"]);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0]?.includes(DISTRIBUTION_IMPACT_HEADING));
  },
  "SCN-UNIT-DISTIMPACT-005": () => {
    const result = check(
      section(
        `配布境界へ入る変更はない。\n\n判断: 配布物を更新しない\n\n根拠: ${REASON}`,
      ),
      ["src/cli.ts"],
    );
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.includes("src/cli.ts")),
      result.errors.join(" / "),
    );
  },
  "SCN-UNIT-DISTIMPACT-006": () => {
    const result = check(
      section(`| src/cli.ts | 配布される |\n\n根拠: ${REASON}`),
      ["src/cli.ts"],
    );
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.includes("判断:")),
      result.errors.join(" / "),
    );
  },
  "SCN-UNIT-DISTIMPACT-007": () => {
    const result = check(section("判断: 配布物を更新した"), []);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("根拠")));
  },
  "SCN-UNIT-DISTIMPACT-008": () => {
    const result = check(section(`| src/cli.ts | 配布される |\n\n${DECIDED}`), [
      "src/cli.ts",
      "scripts/check_file_audit.ts",
    ]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
    assert.deepEqual(result.distributed, ["src/cli.ts"]);
  },
  "SCN-UNIT-DISTIMPACT-009": () => {
    const markdown = [
      "# review",
      "",
      "## 対処",
      "",
      `review artifactへ\`${DISTRIBUTION_IMPACT_HEADING}\`の節を要求する。`,
      "",
      DISTRIBUTION_IMPACT_HEADING,
      "",
      `| src/cli.ts | 入る |`,
      "",
      DECIDED,
      "",
      "## 肯定・敵対レビュー",
      "",
    ].join("\n");
    const result = check(markdown, ["src/cli.ts"]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  },
  "SCN-UNIT-DISTIMPACT-010": () => {
    assert.deepEqual(
      distributedPaths({
        changedPaths: ["dist/src/cli.js", "dist/bin/agent-skill-chain.js"],
        packageFiles: PACKAGE_FILES,
      }),
      ["dist/bin/agent-skill-chain.js", "dist/src/cli.js"],
    );
  },
  "SCN-UNIT-DISTIMPACT-011": () => {
    const result = check(
      section(
        `判断: 配布物を更新した\n判断: 配布物を更新しない\n\n根拠: ${REASON}`,
      ),
      [],
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("1件だけ必要")));
  },
  "SCN-UNIT-DISTIMPACT-012": () => {
    const result = check(section(`判断: 未定\n\n根拠: ${REASON}`), []);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("いずれか")));
  },
  "SCN-UNIT-DISTIMPACT-013": () => {
    const result = check(
      section(
        "判断: 配布物を更新しない\n\n根拠: {更新しない理由をここへ記述する}",
      ),
      [],
    );
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.includes("placeholder")),
      result.errors.join(" / "),
    );
  },
  "SCN-UNIT-DISTIMPACT-014": () => {
    const markdown = [
      "# review",
      "",
      "## 8. 配布物影響",
      "",
      "| src/cli.ts | 入る |",
      "",
      DECIDED,
      "",
      "## 9. 仕様整合性",
      "",
    ].join("\n");
    const result = check(markdown, ["src/cli.ts"]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  },
};

Given("配布物影響単体検査の準備がある", function () {
  this.value = undefined;
});

When("{string}の配布物影響単体検査を実行する", function (scenario: string) {
  const check = CHECKS[scenario];
  if (!check) return;
  check();
  this.validationOutcome = { valid: true };
});

Then("配布物影響単体検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
