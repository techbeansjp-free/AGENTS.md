import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  checkSpecNormalization,
  checkTraceGate,
  type SpecNormalizationResult,
  type TraceGateResult,
} from "../../scripts/check_trace.js";

interface SpecNormalizationWorld extends WorkflowWorld {
  root: string;
  normalization?: SpecNormalizationResult;
  gate?: TraceGateResult;
}

const { Given, When, Then } = stepDefinitions<SpecNormalizationWorld>();

function write(root: string, relative: string, content: string) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function requirementIndex(ids = ["REQ-WF-001"]) {
  return [
    "# 要件一覧",
    "",
    "| 要件ID | 種別 | 要件 | 優先度 | 根拠 | 受け入れ条件 | 状態 |",
    "|---|---|---|---|---|---|---|",
    ...ids.map(
      (id, index) =>
        `| ${id} | 機能 | 要件${index + 1} | 必須 | Issue #881 | ${id.replace(/^REQ-/u, "AC-")} | 合意 |`,
    ),
    "",
  ].join("\n");
}

function requirementDefinitions(ids = ["REQ-WF-001"]) {
  return ids
    .map(
      (id, index) =>
        `### ${id} 要件${index + 1}\n\n- 受け入れ条件: ${id.replace(/^REQ-/u, "AC-")}\n- 根拠: Issue #881\n- 実装: \`src/domain/example.ts\`\n`,
    )
    .join("\n");
}

function traceTable(
  rows = [
    "| REQ-WF-001 | AC-WF-001 | SCN-UNIT-FIXTURE-001 | unit | `test/features/unit/fixture.feature` | `src/domain/example.ts` | 合格 |",
  ],
) {
  return [
    "# 要件追跡表",
    "",
    "| 要件ID | 受け入れ条件 | SCN ID | テスト層 | Feature | 実装 | 結果・HEAD SHA |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function createNormalizationFixture(world: SpecNormalizationWorld) {
  const root = world.temp("asc-specnorm-");
  write(root, "docs/specs/02_要件/00_要件一覧.md", requirementIndex());
  write(
    root,
    "docs/specs/02_要件/01_ワークフロー要件.md",
    requirementDefinitions(),
  );
  write(root, "docs/specs/15_要件追跡/00_追跡表.md", traceTable());
  write(
    root,
    "test/features/unit/fixture.feature",
    "Feature: fixture\n  Scenario: SCN-UNIT-FIXTURE-001 正常\n    Given 前提がある\n    When 操作する\n    Then 成功する\n",
  );
  write(root, "src/domain/example.ts", "export const example = true;\n");
  world.root = root;
}

function createGateFixture(world: SpecNormalizationWorld) {
  createNormalizationFixture(world);
  const templates = path.join(
    process.cwd(),
    ".agent-skill-chain",
    "templates",
    "specs",
  );
  fs.cpSync(templates, path.join(world.root, "docs", "specs"), {
    recursive: true,
    force: false,
  });
  write(world.root, "docs/specs/02_要件/00_要件一覧.md", requirementIndex());
  write(
    world.root,
    "docs/specs/02_要件/01_ワークフロー要件.md",
    requirementDefinitions(),
  );
  write(world.root, "docs/specs/15_要件追跡/00_追跡表.md", traceTable());
}

Given("正規化済み仕様の単体fixtureがある", function () {
  createNormalizationFixture(this);
});

Given("同じ要件IDを2つの仕様fileで定義する", function () {
  createNormalizationFixture(this);
  write(
    this.root,
    "docs/specs/02_要件/02_重複要件.md",
    requirementDefinitions(),
  );
});

Given("追跡表が存在しない要件IDを参照する", function () {
  createNormalizationFixture(this);
  write(
    this.root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    traceTable([
      "| REQ-WF-999 | AC-WF-999 | SCN-UNIT-FIXTURE-001 | unit | `test/features/unit/fixture.feature` | `src/domain/example.ts` | 合格 |",
    ]),
  );
});

Given("要件本文が15_要件追跡にだけ存在する", function () {
  createNormalizationFixture(this);
  write(
    this.root,
    "docs/specs/15_要件追跡/01_旧課題追跡.md",
    "# 旧追跡\n\n| 要件ID | 要件本文 |\n|---|---|\n| REQ-OLD-001 | 追跡directoryに残った要件本文 |\n",
  );
});

Given("要件に対応する追跡行がない", function () {
  createNormalizationFixture(this);
  write(this.root, "docs/specs/15_要件追跡/00_追跡表.md", traceTable([]));
});

Given("SCNに対応する追跡行がない", function () {
  createNormalizationFixture(this);
  write(this.root, "docs/specs/15_要件追跡/00_追跡表.md", traceTable([]));
});

Given("要件とSCNが共に孤立している", function () {
  createNormalizationFixture(this);
  write(this.root, "docs/specs/15_要件追跡/00_追跡表.md", traceTable([]));
});

Given("別directoryに同名Feature fileがある", function () {
  createNormalizationFixture(this);
  write(
    this.root,
    "test/features/integration/fixture.feature",
    "Feature: 同名\n  Scenario: SCN-INT-FIXTURE-001 同名\n    Given 前提がある\n    When 操作する\n    Then 成功する\n",
  );
});

Given("追跡表がbasenameだけを参照する", function () {
  write(
    this.root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    traceTable([
      "| REQ-WF-001 | AC-WF-001 | SCN-UNIT-FIXTURE-001 | unit | `fixture.feature` | `src/domain/example.ts` | 合格 |",
    ]),
  );
});

Given("索引と定義見出しの要件ID集合が異なる", function () {
  createNormalizationFixture(this);
  write(
    this.root,
    "docs/specs/02_要件/00_要件一覧.md",
    requirementIndex(["REQ-WF-002"]),
  );
});

Given("要件本文を04_機能に定義する", function () {
  createNormalizationFixture(this);
  write(
    this.root,
    "docs/specs/04_機能/01_不正要件.md",
    "### REQ-BAD-001 配置外要件\n\n- 受け入れ条件: AC-BAD-001\n",
  );
});

Given("2000件の要件と追跡を持つ入力がある", function () {
  createNormalizationFixture(this);
  const ids = Array.from(
    { length: 2000 },
    (_, index) => `REQ-LIN-${String(index + 1).padStart(3, "0")}`,
  );
  write(this.root, "docs/specs/02_要件/00_要件一覧.md", requirementIndex(ids));
  write(
    this.root,
    "docs/specs/02_要件/01_ワークフロー要件.md",
    requirementDefinitions(ids),
  );
  const scenarios = ids
    .map(
      (_, index) =>
        `  Scenario: SCN-UNIT-LIN-${String(index + 1).padStart(4, "0")} 線形検査${index + 1}\n    Given 前提がある\n    When 操作する\n    Then 成功する`,
    )
    .join("\n");
  write(
    this.root,
    "test/features/unit/fixture.feature",
    `Feature: 線形\n${scenarios}\n`,
  );
  write(
    this.root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    traceTable(
      ids.map(
        (id, index) =>
          `| ${id} | ${id.replace(/^REQ-/u, "AC-")} | SCN-UNIT-LIN-${String(index + 1).padStart(4, "0")} | unit | \`test/features/unit/fixture.feature\` | \`src/domain/example.ts\` | 合格 |`,
      ),
    ),
  );
});

When("仕様正規化検査を実行する", function () {
  this.normalization = checkSpecNormalization(this.root);
});

Then("要件IDの一意性検査は合格する", function () {
  assert.equal(
    this.normalization?.valid,
    true,
    this.normalization?.errors.join("; "),
  );
});

Then("重複要件IDと該当する2つのfileを報告する", function () {
  const errors = this.normalization?.errors.join("\n") ?? "";
  assert.match(errors, /REQ-WF-001/u);
  assert.match(errors, /01_ワークフロー要件\.md/u);
  assert.match(errors, /02_重複要件\.md/u);
});

Then("未解決の要件参照を報告する", function () {
  assert.match(
    this.normalization?.errors.join("\n") ?? "",
    /未解決.*REQ-WF-999/u,
  );
});

Then("追跡directoryだけにある要件本文を報告する", function () {
  assert.match(
    this.normalization?.errors.join("\n") ?? "",
    /15_要件追跡.*REQ-OLD-001/u,
  );
});

Then("到達不能な要件を孤立理由と共に報告する", function () {
  assert.deepEqual(this.normalization?.orphanRequirements, ["REQ-WF-001"]);
  assert.match(this.normalization?.errors.join("\n") ?? "", /要件.*到達/u);
});

Then("到達不能なSCNを孤立理由と共に報告する", function () {
  assert.ok(
    this.normalization?.orphanScenarios.includes("SCN-UNIT-FIXTURE-001"),
  );
  assert.match(this.normalization?.errors.join("\n") ?? "", /SCN.*到達/u);
});

Then("孤立判定の理由は日本語である", function () {
  const errors = this.normalization?.errors.join("\n") ?? "";
  assert.match(errors, /どの.*到達できません/u);
});

Then("同名fileは互いの参照を充足しない", function () {
  const errors = this.normalization?.errors.join("\n") ?? "";
  assert.match(errors, /完全path/u);
  assert.ok(
    this.normalization?.orphanScenarios.includes("SCN-UNIT-FIXTURE-001"),
  );
});

Then("二重列挙の両方向の差分を報告する", function () {
  const errors = this.normalization?.errors.join("\n") ?? "";
  assert.match(errors, /索引にだけ存在.*REQ-WF-002/u);
  assert.match(errors, /定義にだけ存在.*REQ-WF-001/u);
});

Then("所定location外の定義pathを報告する", function () {
  assert.match(
    this.normalization?.errors.join("\n") ?? "",
    /所定location外.*docs\/specs\/04_機能\/01_不正要件\.md/u,
  );
});

Then("走査操作数は入力件数に対して線形である", function () {
  assert.equal(
    this.normalization?.valid,
    true,
    this.normalization?.errors.join("; "),
  );
  assert.ok((this.normalization?.operationCount ?? Infinity) < 2000 * 50);
});

Given("製品自身のrepositoryがある", function () {
  this.root = process.cwd();
});

Given("trace gate用の隔離fixtureがある", function () {
  createGateFixture(this);
});

Given("隔離fixtureに重複要件IDがある", function () {
  write(
    this.root,
    "docs/specs/02_要件/02_重複要件.md",
    requirementDefinitions(),
  );
});

Given("隔離fixtureの追跡表に未解決参照がある", function () {
  write(
    this.root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    traceTable([
      "| REQ-WF-999 | AC-WF-999 | SCN-UNIT-FIXTURE-001 | unit | `test/features/unit/fixture.feature` | `src/domain/example.ts` | 合格 |",
    ]),
  );
});

Given("隔離fixtureの追跡行が欠落している", function () {
  write(this.root, "docs/specs/15_要件追跡/00_追跡表.md", traceTable([]));
});

Given("隔離fixtureの必須仕様が欠落している", function () {
  fs.unlinkSync(path.join(this.root, "docs/specs/04_機能/00_機能一覧.md"));
});

When("製品仕様のtrace gateを実行する", function () {
  this.gate = checkTraceGate(this.root, {
    dialect: "en",
    layers: ["unit", "integration", "e2e"],
  });
});

When("隔離fixtureのtrace gateを実行する", function () {
  this.gate = checkTraceGate(this.root, { dialect: "en", layers: ["unit"] });
});

Then("validateSpecsはvalid trueを返す", function () {
  assert.equal(
    this.gate?.specs.valid,
    true,
    this.gate?.specs.errors.join("; "),
  );
  assert.equal(this.gate?.valid, true, this.gate?.errors.join("; "));
});

Then("trace gateは要件ID重複で失敗する", function () {
  assert.equal(this.gate?.valid, false);
  assert.match(this.gate?.errors.join("\n") ?? "", /重複.*REQ-WF-001/u);
});

Then("trace gateは未解決参照で失敗する", function () {
  assert.equal(this.gate?.valid, false);
  assert.match(this.gate?.errors.join("\n") ?? "", /未解決.*REQ-WF-999/u);
});

Then("trace gateは孤立要件と孤立SCNで失敗する", function () {
  assert.equal(this.gate?.valid, false);
  assert.ok((this.gate?.normalization.orphanRequirements.length ?? 0) > 0);
  assert.ok((this.gate?.normalization.orphanScenarios.length ?? 0) > 0);
});

Then("trace gateは必須仕様欠落で失敗する", function () {
  assert.equal(this.gate?.valid, false);
  assert.match(
    this.gate?.errors.join("\n") ?? "",
    /必須仕様.*04_機能\/00_機能一覧\.md/u,
  );
});
