import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  deriveDistributionImpact,
  distributedPaths,
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
  "SCN-UNIT-DISTIMPACT-015": () => {
    /** 配布物影響はGitの変更pathから導出し、散文の節を要求しない（REQ-WF-038）。 */
    assert.deepEqual(
      deriveDistributionImpact({
        changedPaths: [
          "src/cli.ts",
          "scripts/check_file_audit.ts",
          "README.md",
        ],
        packageFiles: PACKAGE_FILES,
      }),
      ["README.md", "src/cli.ts"],
    );
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
