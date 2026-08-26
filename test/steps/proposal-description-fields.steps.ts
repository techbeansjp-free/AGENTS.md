import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkProjectQualityContract } from "../../scripts/check_project_quality.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

const REGISTRY = ".github/trusted-quality-proposals.json";

type Proposal = Record<string, unknown>;

function replicate(world: WorkflowWorld): string {
  const source = process.cwd();
  const target = world.temp("asc-propfield-");
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: source,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((entry) => entry !== "");
  for (const relative of files) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, relative), destination);
  }
  return target;
}

function mutate(root: string, change: (proposals: Proposal[]) => void): void {
  const file = path.join(root, REGISTRY);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    proposals: Proposal[];
  };
  change(parsed.proposals);
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
}

function outcome(
  world: WorkflowWorld,
  change: (proposals: Proposal[]) => void,
): { accepted: boolean; errors: string[] } {
  const root = replicate(world);
  mutate(root, change);
  try {
    const result = checkProjectQualityContract(root, process.cwd());
    return { accepted: result.errors.length === 0, errors: result.errors };
  } catch (error) {
    return {
      accepted: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

const UPDATED_ROLLBACK = "更新したrollback手順をここへ十分な長さで記述する";
const UPDATED_RATIONALE = "更新したrationaleをここへ十分な長さで記述する";

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-UNIT-PROPFIELD-001": (world) => {
    const result = outcome(world, (proposals) => {
      proposals[0]!.rollback = UPDATED_ROLLBACK;
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted, true);
  },
  "SCN-UNIT-PROPFIELD-002": (world) => {
    const result = outcome(world, (proposals) => {
      proposals[0]!.rationale = UPDATED_RATIONALE;
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted, true);
  },
  "SCN-UNIT-PROPFIELD-003": (world) => {
    const result = outcome(world, (proposals) => {
      proposals[0]!.owner = "別のrepository maintainer";
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted, true);
  },
  "SCN-UNIT-PROPFIELD-004": (world) => {
    const result = outcome(world, (proposals) => {
      proposals[0]!.rollback = "   ";
    });
    assert.equal(result.accepted, false);
  },
  "SCN-UNIT-PROPFIELD-005": (world) => {
    const result = outcome(world, (proposals) => {
      delete proposals[0]!.rollback;
    });
    assert.equal(result.accepted, false);
  },
  "SCN-UNIT-PROPFIELD-006": (world) => {
    const result = outcome(world, (proposals) => {
      const targets = proposals[0]!.targets as Record<string, unknown>[];
      targets[0]!.afterSha256 = "0".repeat(64);
    });
    assert.equal(result.accepted, false);
    assert.ok(
      result.errors.some((error) =>
        error.includes("契約fieldは変更できません"),
      ),
    );
  },
  "SCN-UNIT-PROPFIELD-007": (world) => {
    const result = outcome(world, (proposals) => {
      proposals[0]!.toVersion = 99;
    });
    assert.equal(result.accepted, false);
  },
  "SCN-UNIT-PROPFIELD-008": (world) => {
    const result = outcome(world, (proposals) => {
      proposals.shift();
    });
    assert.equal(result.accepted, false);
    assert.ok(result.errors.some((error) => error.includes("削除できません")));
  },
};

Given("proposal記述field単体検査の準備がある", function () {
  this.value = undefined;
});

When(
  "{string}のproposal記述field単体検査を実行する",
  function (scenario: string) {
    const check = CHECKS[scenario];
    if (!check) return;
    check(this);
    this.validationOutcome = { valid: true };
  },
);

Then("proposal記述field単体検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
