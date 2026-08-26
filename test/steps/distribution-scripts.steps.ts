import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkProjectQualityContract } from "../../scripts/check_project_quality.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

/**
 * 配布前品質gateの正本。`scripts/check_project_quality.ts`の`DISTRIBUTION_GATES`と
 * 同じ順序をtest側へ固定値で置く。**導出値どうしの比較にするとvacuousになるため、
 * ここは実装から輸入しない。**
 */
const GATES = [
  "project:quality",
  "quality",
  "build",
  "docs:format",
  "test:format",
  "trace:check",
  "architecture:check",
  "conformance:check",
  "audit:check",
  "package:check",
] as const;

const GATE_COMMAND = GATES.map((gate) => `npm run ${gate}`).join(" && ");
const PREPARE_COMMAND = "npm run build";

type Scripts = Record<string, unknown>;

function replicate(world: WorkflowWorld): string {
  const source = process.cwd();
  const target = world.temp("asc-distscript-");
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

function outcome(
  world: WorkflowWorld,
  change: (scripts: Scripts) => void,
): { accepted: boolean; errors: string[] } {
  const root = replicate(world);
  const file = path.join(root, "package.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    scripts: Scripts;
  };
  change(parsed.scripts);
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
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

/** 新しい配布準備形へ移す。 */
function adoptDistributionShape(scripts: Scripts): void {
  scripts.prepack = PREPARE_COMMAND;
  scripts.prepare = PREPARE_COMMAND;
  scripts["verify:distribution"] = GATE_COMMAND;
}

/**
 * 現行の配布準備形へ**明示的に**戻す。
 *
 * **作業treeの`package.json`をそのまま使わない。** 後続の移行で作業treeが新しい形へ
 * 変わると、「現行形を受理する」scenarioが新しい形を検査するようになり、名前を保ったまま
 * 現行形のcoverageが消える。固定fixtureとして構築することでこれを防ぐ。
 */
function adoptLegacyShape(scripts: Scripts): void {
  scripts.prepack = GATE_COMMAND;
  delete scripts.prepare;
  delete scripts["verify:distribution"];
}

function assertRejected(
  result: { accepted: boolean; errors: string[] },
  expected: string,
): void {
  assert.equal(result.accepted, false);
  assert.ok(
    result.errors.some((entry) => entry.includes(expected)),
    `期待した拒否理由がありません: ${expected} / 実際: ${result.errors.join(" | ")}`,
  );
}

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-UNIT-DISTSCRIPT-001": (world) => {
    const result = outcome(world, adoptLegacyShape);
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted, true);
  },
  "SCN-UNIT-DISTSCRIPT-002": (world) => {
    const result = outcome(world, adoptDistributionShape);
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted, true);
  },
  "SCN-UNIT-DISTSCRIPT-003": (world) => {
    const result = outcome(world, (scripts) => {
      adoptDistributionShape(scripts);
      scripts["verify:distribution"] = GATE_COMMAND.replace(
        "npm run quality &&",
        "npm run quality && exit 0 &&",
      );
    });
    assertRejected(result, "verify:distributionは配布前品質gate");
  },
  "SCN-UNIT-DISTSCRIPT-004": (world) => {
    const result = outcome(world, (scripts) => {
      adoptDistributionShape(scripts);
      scripts["verify:distribution"] = GATE_COMMAND.replace(
        "npm run build && npm run docs:format",
        "npm run docs:format && npm run build",
      );
    });
    assertRejected(result, "verify:distributionは配布前品質gate");
  },
  "SCN-UNIT-DISTSCRIPT-005": (world) => {
    const result = outcome(world, (scripts) => {
      adoptDistributionShape(scripts);
      scripts["verify:distribution"] = GATE_COMMAND.replace(
        " && npm run audit:check",
        "",
      );
    });
    assertRejected(result, "verify:distributionは配布前品質gate");
  },
  "SCN-UNIT-DISTSCRIPT-006": (world) => {
    const result = outcome(world, (scripts) => {
      adoptDistributionShape(scripts);
      delete scripts.prepare;
    });
    assertRejected(result, "prepareも同じ内容が必要です");
  },
  "SCN-UNIT-DISTSCRIPT-007": (world) => {
    const result = outcome(world, (scripts) => {
      adoptLegacyShape(scripts);
      scripts.prepare = "true";
    });
    assertRejected(result, "prepareはnpm run buildでなければなりません");
  },
  "SCN-UNIT-DISTSCRIPT-008": (world) => {
    const result = outcome(world, (scripts) => {
      adoptLegacyShape(scripts);
      scripts.prepack = "echo skip";
    });
    assertRejected(result, "prepack scriptを自己緩和できません");
  },
  "SCN-UNIT-DISTSCRIPT-009": (world) => {
    const result = outcome(world, (scripts) => {
      adoptDistributionShape(scripts);
      scripts["verify:distribution"] =
        `${GATE_COMMAND} && npm run publish:extra`;
    });
    assertRejected(result, "verify:distributionは配布前品質gate");
  },
};

Given("配布script単体検査の準備がある", function (this: WorkflowWorld) {
  this.value = undefined;
});

When(
  "{string}の配布script単体検査を実行する",
  function (this: WorkflowWorld, id: string) {
    const check = CHECKS[id];
    assert.ok(check, `未知の配布script単体検査です: ${id}`);
    check(this);
  },
);

Then("配布script単体検査は期待結果になる", function () {
  assert.ok(true);
});
