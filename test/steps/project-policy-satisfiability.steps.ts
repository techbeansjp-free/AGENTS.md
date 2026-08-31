import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../src/cli.js";
import {
  classifyConformanceDeclarationDiff,
  validateProjectConformanceBinding,
  validateRepositoryConformance,
  type ConformanceDeclaration,
} from "../../src/domain/conformance.js";
import { compareTrustedPolicy } from "../../src/domain/enforcement.js";
import { init } from "../../src/domain/lifecycle.js";
import {
  loadProjectPolicySet,
  validateProjectChoices,
  validateProjectPolicyManifest,
} from "../../src/domain/policy.js";
import { classifyProjectChoiceDiff } from "../../src/domain/project-choice-diff.js";
import {
  isRecord,
  type NotApplicableDecision,
  type Policy,
  type ProjectChoices,
  type Rule,
} from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

class SatisfiabilityWorld extends WorkflowWorld {
  manifest: unknown = undefined;
  manifestResult: ValidationResult | undefined = undefined;
  bindingInputs: unknown[] = [];
  bindingResults: ValidationResult[] = [];
  root = "";
  contract: unknown = undefined;
  binding: unknown = undefined;
  evidence: unknown = undefined;
  rules: Rule[] = [];
  expectedCheckIds: string[] = [];
  repositoryResult: ValidationResult | undefined = undefined;
  repositoryResults: ValidationResult[] = [];
  choice: unknown = undefined;
  choiceResult: ValidationResult | undefined = undefined;
  conformanceComparisons: ReturnType<typeof compareTrustedPolicy>[] = [];
  narrowComparison: ReturnType<typeof compareTrustedPolicy> | undefined =
    undefined;
  choiceDiffs: ReturnType<typeof classifyProjectChoiceDiff>[] = [];
  policySetValid = false;
  honestAssets = false;
  currentStrength = false;
  cliResults: CliResult[] = [];
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const { Given, When, Then } = stepDefinitions<SatisfiabilityWorld>();

const notApplicable = (reason: string): NotApplicableDecision => ({
  status: "not-applicable",
  reason,
  evidence: "隔離fixtureの構成を確認した",
});

function choices(): ProjectChoices {
  return {
    language: "日本語",
    testRunner: "self-contained",
    gherkinDialect: "en",
    testLayers: ["integration"],
    forbiddenTestFileSuffixes: [],
    naming: "一意なSCN ID",
    packageManager: "manual",
    runtime: "PHP 8.3",
    ci: "project-owned-check",
    release: "明示authorityによる手動操作",
    projectKind: "theme",
    capabilities: {
      privacySecurity: {
        status: "applicable",
        reason: "template出力境界を検証する",
        evidence: "隔離fixture",
      },
      observability: notApplicable("永続serviceを所有しないため対象外である"),
      humanCenteredUi: {
        status: "applicable",
        reason: "theme画面を利用者へ提供する",
        evidence: "index.php template",
      },
      designTokens: notApplicable(
        "今回のfixtureはtokenを所有しないため対象外である",
      ),
    },
    quality: {
      implementationLanguage: "PHP",
      strictTypecheck: notApplicable(
        "PHP側に静的型検査を導入していないため対象外である",
      ),
      forbiddenTypes: [],
      lintCommand: notApplicable("lint runnerを所有していないため対象外である"),
      formatCheckCommand: notApplicable(
        "format検査を所有していないため対象外である",
      ),
      formatWriteCommand: notApplicable(
        "format書込器を所有していないため対象外である",
      ),
      typecheckCommand: notApplicable(
        "静的型検査を所有していないため対象外である",
      ),
      runtimeValidation: "PHPの自己完結checkでtemplate構造を検証する",
      auxiliaryLanguages: {
        TypeScript: {
          status: "applicable",
          reason: "frontend asset buildに使用する",
          evidence: "src/frontend.ts",
        },
      },
    },
  };
}

function policy(projectChoices = choices()): Policy {
  return {
    schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
    delivery: { stopAt: "pull_request" },
    merge: {
      mode: "disabled",
      branches: [],
      methods: [],
      requiredChecks: [],
      requiredReviews: 1,
    },
    budgets: { localFeedbackMs: 120000, prGateMs: 900000 },
    rules: [],
    projectChoices,
  };
}

function manifest(scope?: "repository-bound" | "package-attested") {
  return {
    schemaVersion: "agent-skill-chain/project-policy-manifest/v1",
    policy: {
      schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
      delivery: { stopAt: "pull_request" },
      merge: {
        mode: "disabled",
        branches: [],
        methods: [],
        requiredChecks: [],
        requiredReviews: 1,
      },
      budgets: { localFeedbackMs: 120000, prGateMs: 900000 },
    },
    choiceFiles: ["project/choices/development.json"],
    ruleFiles: ["project/rules/theme-quality.json"],
    conformanceFiles:
      scope === "package-attested" ? [] : ["project/conformance/bindings.json"],
    ...(scope ? { conformanceScope: scope } : {}),
    conformanceDirectory: "project/conformance",
  };
}

function rule(): Rule {
  return {
    ruleId: "ASC-THEME-QUALITY-001",
    purpose: "themeの自己完結検査を登録する",
    riskClass: "quality",
    scope: ["theme"],
    enforcement: "require",
    activation: "staged",
    owner: "theme owner",
    targetLayer: "project",
    evidence: "checks/theme-check.php",
    remediation: "登録済みcheckを修正する",
    overridePolicy: "bound",
    rollback: "直前のtheme assetへ戻す",
  };
}

function applicableBinding() {
  return {
    schemaVersion: "agent-skill-chain/project-conformance/v1",
    bindings: Array.from({ length: 12 }, (_, index) => ({
      id: `I${index + 1}`,
      sourcePaths: ["src/domain/conformance.ts"],
      enforcement: [
        {
          path: "src/domain/conformance.ts",
          export: "validateProjectConformanceBinding",
        },
      ],
      counterexampleScenarios: ["SCN-UNIT-SAT-004"],
    })),
  };
}

function notApplicableBinding() {
  return {
    schemaVersion: "agent-skill-chain/project-conformance/v1",
    bindings: Array.from({ length: 12 }, (_, index) => ({
      id: `I${index + 1}`,
      status: "not-applicable",
      reason: "consumer実装へpackage不変条件をbindingしない",
      evidence: "package側の適合証拠を再利用する",
    })),
  };
}

function mixedBinding(source: string, scenario: string) {
  const result = notApplicableBinding();
  result.bindings[2] = {
    id: "I3",
    status: "applicable",
    reason: "",
    evidence: "",
  };
  const bindings: unknown[] = result.bindings;
  bindings[2] = {
    id: "I3",
    sourcePaths: [source],
    enforcement: [
      {
        kind: "file-entrypoint",
        path: "checks/theme-check.php",
        runner: "php",
      },
    ],
    counterexampleScenarios: [scenario],
  };
  bindings[11] = {
    id: "I12",
    sourcePaths: ["checks/theme-check.php"],
    enforcement: [{ kind: "check-ref", checkId: "theme-quality-001" }],
    counterexampleScenarios: [scenario],
  };
  return result;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function prepareProject(
  world: SatisfiabilityWorld,
  scope: "repository-bound" | "package-attested",
): void {
  world.root = world.temp("asc-sat-");
  const namespace = path.join(world.root, ".agent-skill-chain");
  fs.mkdirSync(path.join(namespace, "project", "conformance"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(world.root, "checks"), { recursive: true });
  fs.mkdirSync(path.join(world.root, "src"), { recursive: true });
  fs.mkdirSync(path.join(world.root, "docs", "specs"), { recursive: true });
  fs.writeFileSync(path.join(world.root, "index.php"), "<?php echo 'theme';\n");
  fs.writeFileSync(path.join(world.root, "src", "frontend.ts"), "export {};\n");
  fs.writeFileSync(
    path.join(world.root, "checks", "theme-check.php"),
    "<?php exit(0);\n",
  );
  fs.writeFileSync(
    path.join(world.root, "docs", "specs", "requirements.md"),
    "# 要件\n",
  );
  const projectRule = rule();
  writeJson(path.join(namespace, "project-policy.json"), manifest(scope));
  writeJson(
    path.join(namespace, "project", "choices", "development.json"),
    choices(),
  );
  writeJson(
    path.join(namespace, "project", "rules", "theme-quality.json"),
    projectRule,
  );
  if (scope === "repository-bound")
    writeJson(
      path.join(namespace, "project", "conformance", "bindings.json"),
      mixedBinding("docs/specs/requirements.md", "SCN-INT-SAT-001"),
    );
  world.rules = [projectRule];
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function allScenarios(binding: unknown): string[] {
  if (!isRecord(binding)) return [];
  const bindings = binding.bindings;
  if (!Array.isArray(bindings)) return [];
  return bindings.flatMap((item) => {
    if (!isRecord(item)) return [];
    const scenarios = item.counterexampleScenarios;
    return Array.isArray(scenarios)
      ? scenarios.filter((value): value is string => typeof value === "string")
      : [];
  });
}

Given("conformanceScopeを省略したmanifestがある", function () {
  this.manifest = { ...manifest(), conformanceFiles: [] };
});

Given("package-attestedでconformance fileが空のmanifestがある", function () {
  this.manifest = manifest("package-attested");
});

When("project policy manifestを検証する", function () {
  this.manifestResult = validateProjectPolicyManifest(this.manifest);
});

Then("conformance fileなしはrepository-boundとして拒否される", function () {
  assert.equal(this.manifestResult?.valid, false);
  assert.match(
    this.manifestResult?.errors.join(" ") ?? "",
    /repository-bound/u,
  );
});

Then("package-attested manifestはvalidである", function () {
  assert.equal(
    this.manifestResult?.valid,
    true,
    this.manifestResult?.errors.join("; "),
  );
});

Given(
  "not-applicableの正常例と理由欠落と形式的配列を持つbindingがある",
  function () {
    const valid = notApplicableBinding();
    const missingReason = structuredClone(valid);
    delete (missingReason.bindings[0] as { reason?: string }).reason;
    const formalArray = structuredClone(valid);
    (formalArray.bindings[0] as Record<string, unknown>).sourcePaths = [];
    this.bindingInputs = [valid, missingReason, formalArray];
  },
);

Given("applicableの正常例と必須field欠落を持つbindingがある", function () {
  const valid = applicableBinding();
  const missing = structuredClone(valid);
  delete (missing.bindings[0] as { enforcement?: unknown }).enforcement;
  this.bindingInputs = [valid, missing];
});

When("applicability bindingを検証する", function () {
  this.bindingResults = this.bindingInputs.map((value) =>
    validateProjectConformanceBinding(value),
  );
});

Then("正常なnot-applicableだけが合格する", function () {
  assert.deepEqual(
    this.bindingResults.map((result) => result.valid),
    [true, false, false],
  );
});

Then("正常なapplicableだけが合格する", function () {
  assert.deepEqual(
    this.bindingResults.map((result) => result.valid),
    [true, false],
  );
});

Given("実在file-entrypointと登録済みcheck-refを持つbindingがある", function () {
  this.root = this.temp("asc-enforcement-");
  fs.mkdirSync(path.join(this.root, "checks"), { recursive: true });
  fs.writeFileSync(
    path.join(this.root, "checks", "theme-check.php"),
    "<?php exit(0);\n",
  );
  this.contract = readJson(".agent-skill-chain/policy/conformance.json");
  this.binding = mixedBinding("checks/theme-check.php", "SCN-UNIT-SAT-005");
  this.evidence = {
    tool: "cucumber-js",
    passedScenarioIds: ["SCN-UNIT-SAT-005"],
  };
  this.rules = [rule()];
});

Given(
  "不存在file-entrypointとsymlinkと未登録check-refを持つbindingがある",
  function () {
    this.root = this.temp("asc-enforcement-invalid-");
    fs.mkdirSync(path.join(this.root, "checks"), { recursive: true });
    const target = path.join(this.root, "checks", "target.php");
    fs.writeFileSync(target, "<?php exit(0);\n");
    fs.symlinkSync(target, path.join(this.root, "checks", "link.php"));
    this.contract = readJson(".agent-skill-chain/policy/conformance.json");
    this.rules = [rule()];
    const make = (point: Record<string, unknown>) => {
      const document = notApplicableBinding();
      const bindings: unknown[] = document.bindings;
      bindings[0] = {
        id: "I1",
        sourcePaths: ["checks/target.php"],
        enforcement: [point],
        counterexampleScenarios: ["SCN-UNIT-SAT-006"],
      };
      return document;
    };
    this.bindingInputs = [
      make({
        kind: "file-entrypoint",
        path: "checks/missing.php",
        runner: "php",
      }),
      make({ kind: "file-entrypoint", path: "checks/link.php", runner: "php" }),
      make({ kind: "check-ref", checkId: "unregistered-check" }),
    ];
    this.evidence = {
      tool: "cucumber-js",
      passedScenarioIds: ["SCN-UNIT-SAT-006"],
    };
  },
);

Given("未登録check-refと登録済みruleを持つbindingがある", function () {
  this.root = process.cwd();
  this.contract = readJson(".agent-skill-chain/policy/conformance.json");
  const document = notApplicableBinding();
  const bindings: unknown[] = document.bindings;
  bindings[0] = {
    id: "I1",
    sourcePaths: ["src/domain/conformance.ts"],
    enforcement: [{ kind: "check-ref", checkId: "main-branch-protection" }],
    counterexampleScenarios: ["SCN-UNIT-SAT-024"],
  };
  this.bindingInputs = [document];
  this.rules = [
    "ASC-PROJ-MAIN-PROTECT-001",
    "ASC-PROJ-QUALITY-001",
    "ASC-PROJ-TRACE-001",
  ].map((ruleId) => ({ ...rule(), ruleId }));
  this.expectedCheckIds = [
    "proj-main-protect-001",
    "proj-quality-001",
    "proj-trace-001",
  ];
  this.evidence = {
    tool: "cucumber-js",
    passedScenarioIds: ["SCN-UNIT-SAT-024"],
  };
});

Given("未登録check-refとruleを1件も持たないbindingがある", function () {
  const document = notApplicableBinding();
  const bindings: unknown[] = document.bindings;
  bindings[0] = {
    id: "I1",
    sourcePaths: ["src/domain/conformance.ts"],
    enforcement: [{ kind: "check-ref", checkId: "main-branch-protection" }],
    counterexampleScenarios: ["SCN-UNIT-SAT-022"],
  };
  this.bindingInputs = [document];
  this.rules = [];
  this.expectedCheckIds = [];
});

Given("未登録check-refと上限を超えるruleを持つbindingがある", function () {
  const document = notApplicableBinding();
  const bindings: unknown[] = document.bindings;
  bindings[0] = {
    id: "I1",
    sourcePaths: ["src/domain/conformance.ts"],
    enforcement: [{ kind: "check-ref", checkId: "main-branch-protection" }],
    counterexampleScenarios: ["SCN-UNIT-SAT-023"],
  };
  this.bindingInputs = [document];
  this.rules = Array.from({ length: 21 }, (_, index) => ({
    ...rule(),
    ruleId: `ASC-CHECK-${String(index + 1).padStart(2, "0")}`,
  }));
  this.expectedCheckIds = Array.from(
    { length: 21 },
    (_, index) => `check-${String(index + 1).padStart(2, "0")}`,
  );
});

Given("未登録check-refと導出できないruleIdを持つbindingがある", function () {
  const document = notApplicableBinding();
  const bindings: unknown[] = document.bindings;
  bindings[0] = {
    id: "I1",
    sourcePaths: ["src/domain/conformance.ts"],
    enforcement: [{ kind: "check-ref", checkId: "main-branch-protection" }],
    counterexampleScenarios: ["SCN-UNIT-SAT-025"],
  };
  this.bindingInputs = [document];
  this.rules = [
    "ASC-PROJ-MAIN-PROTECT-001",
    "ASC-FOO--BAR",
    `ASC-${"A".repeat(70)}`,
  ].map((ruleId) => ({ ...rule(), ruleId }));
});

Given("配布するconformance binding schemaがある", function () {
  this.contract = readJson(
    ".agent-skill-chain/schemas/project-conformance-binding.schema.json",
  );
  const document = notApplicableBinding();
  const bindings: unknown[] = document.bindings;
  bindings[0] = {
    id: "I1",
    sourcePaths: ["src/domain/conformance.ts"],
    enforcement: [{ kind: "check-ref", checkId: "main-branch-protection" }],
    counterexampleScenarios: ["SCN-UNIT-SAT-026"],
  };
  this.bindingInputs = [document];
  this.rules = [
    "ASC-PROJ-MAIN-PROTECT-001",
    "ASC-PROJ-QUALITY-001",
    "ASC-PROJ-TRACE-001",
  ].map((ruleId) => ({ ...rule(), ruleId }));
});

When("project ruleを与えてapplicability bindingを検証する", function () {
  this.bindingResults = this.bindingInputs.map((value) =>
    validateProjectConformanceBinding(value, this.rules),
  );
});

Then("check-ref診断は導出規則と登録済みcheckIdを示す", function () {
  const diagnostic = this.bindingResults[0]?.errors.find((error) =>
    error.includes("main-branch-protection"),
  );
  assert.ok(typeof diagnostic === "string");
  if (this.rules.length === 0)
    assert.match(diagnostic, /登録済みcheckIdは0件です/u);
  else if (this.rules.length > 20) {
    assert.match(diagnostic, /登録済みcheckId\(21件\):/u);
    assert.match(diagnostic, /ほか1件/u);
  }
  assert.match(
    diagnostic,
    /checkIdはproject ruleのruleIdから接頭辞ASC-を除いて小文字化した値です/u,
  );
  assert.match(diagnostic, /\.agent-skill-chain\/docs\/00_運用ポリシー\.md/u);
  if (this.rules.length > 0)
    assert.match(diagnostic, /登録済みcheckId\([0-9]+件\):/u);
  assert.match(diagnostic, /main-branch-protection/u);
  const expectedCheckIds: string[] = [...this.expectedCheckIds].sort();
  for (const checkId of expectedCheckIds.slice(0, 20))
    assert.ok(
      diagnostic.includes(checkId),
      `導出checkId ${checkId} が診断に現れていません: ${diagnostic}`,
    );
  for (const ruleId of this.rules.map((entry) => entry.ruleId))
    assert.ok(
      !diagnostic.includes(ruleId),
      `導出前のruleId ${ruleId} が診断に現れています: ${diagnostic}`,
    );
});

Then("check-ref診断は2経路で文字列として一致する", function () {
  const bindingDiagnostic = this.bindingResults[0]?.errors.find((error) =>
    error.includes("main-branch-protection"),
  );
  const repositoryDiagnostics = (
    this.repositoryResults[0]?.errors ?? []
  ).filter((error) => error.includes("main-branch-protection"));
  assert.equal(repositoryDiagnostics.length, 2);
  assert.equal(bindingDiagnostic, repositoryDiagnostics[1]);
});

Then("check-ref診断は導出できないruleIdの件数と例を示す", function () {
  const diagnostic = this.bindingResults[0]?.errors.find((error) =>
    error.includes("main-branch-protection"),
  );
  assert.ok(typeof diagnostic === "string");
  const invalidRuleIds = ["ASC-FOO--BAR", `ASC-${"A".repeat(70)}`].sort();
  assert.match(
    diagnostic,
    new RegExp(
      `導出できないruleId\\(2件\\): ${invalidRuleIds.join(", ")}`,
      "u",
    ),
  );
});

Then("checkIdのdescriptionは導出規則の正本を参照する", function () {
  assert.ok(isRecord(this.contract));
  const properties = this.contract.properties;
  assert.ok(isRecord(properties));
  const bindings = properties.bindings;
  assert.ok(isRecord(bindings));
  const items = bindings.items;
  assert.ok(isRecord(items));
  const itemProperties = items.properties;
  assert.ok(isRecord(itemProperties));
  const enforcement = itemProperties.enforcement;
  assert.ok(isRecord(enforcement));
  const enforcementItems = enforcement.items;
  assert.ok(isRecord(enforcementItems));
  const oneOf: unknown = enforcementItems.oneOf;
  assert.ok(Array.isArray(oneOf));
  const checkRef: unknown = oneOf.find(
    (candidate: unknown) =>
      isRecord(candidate) &&
      isRecord(candidate.properties) &&
      isRecord(candidate.properties.kind) &&
      candidate.properties.kind.const === "check-ref",
  );
  assert.ok(isRecord(checkRef));
  assert.ok(isRecord(checkRef.properties));
  assert.ok(isRecord(checkRef.properties.checkId));
  const description = checkRef.properties.checkId.description;
  assert.ok(typeof description === "string");
  assert.match(description, /\.agent-skill-chain\/docs\/00_運用ポリシー\.md/u);
});

When("repository conformanceを新しいenforcement pointで検証する", function () {
  const inputs =
    (this.bindingInputs ?? []).length > 0 ? this.bindingInputs : [this.binding];
  this.repositoryResults = inputs.map((binding) =>
    validateRepositoryConformance(
      this.root,
      this.contract,
      binding,
      this.evidence,
      this.rules,
    ),
  );
});

Then("file-entrypointとcheck-refはvalidである", function () {
  assert.equal(
    this.repositoryResults[0]?.valid,
    true,
    this.repositoryResults[0]?.errors.join("; "),
  );
});

Then("不正なenforcement pointをすべて拒否する", function () {
  assert.ok(this.repositoryResults.every((result) => !result.valid));
  assert.match(
    this.repositoryResults.flatMap((result) => result.errors).join(" "),
    /missing|symlink|登録/u,
  );
});

Given(
  "quality検査項目を理由と証拠付きnot-applicableにしたchoiceがある",
  function () {
    this.choice = choices();
  },
);

/**
 * `executableSource`の走査を壊す形を集めたfixture。
 *
 * **`odd-quote-regex`が偽陰性、`ghost-in-comment`が偽陽性の再現である。** 前者は正規表現literal中の
 * 引用符が奇数個で以降が文字列状態のまま進み、実在するexportを見落とす。後者はcommentの中身が
 * codeとして漏れ出し、実在しないexportを実在と誤認する。
 */
const EXPORT_SCAN_FIXTURES: Readonly<Record<string, string>> = {
  "odd-quote-regex": [
    'const names = [..."abc".matchAll(/"([^"]+)"/gu)];',
    "export function scanned(): void {}",
    "",
  ].join("\n"),
  "ghost-in-comment": [
    'const pattern = /"/;',
    '/* "',
    "export function scanned(): void {}",
    "*/",
    "const other = pattern;",
    "",
  ].join("\n"),
  division: [
    "const ratio = (a: number, b: number): number => a / b / 2;",
    "export function scanned(): void {}",
    "",
  ].join("\n"),
  "unterminated-string": [
    'const broken = "終端していない',
    "export function scanned(): void {}",
    "",
  ].join("\n"),
  /** keywordの直後は値が来る位置であり、`/`は除算ではない。 */
  "keyword-regex": [
    "function pick(): RegExp {",
    '  return /"/;',
    "}",
    '/* "',
    "export function scanned(): void {}",
    "*/",
    "const used = pick;",
    "",
  ].join("\n"),
  /** 除算代入の直後は正規表現ではない。 */
  "division-assign": [
    "let total = 10;",
    "total /= 2;",
    "export function scanned(): void {}",
    "",
  ].join("\n"),
  /**
   * 除算を正規表現と誤読すると、直後のblock comment開始`/*`を正規表現の終端と誤認し、
   * **commentの中身がcodeとして漏れる。** 判別できない位置は解析不能として拒否する。
   */
  "decimal-divide": [
    "const ratio = 1. / 2; /" + "*",
    "export function scanned(): void {}",
    "*" + "/",
    "const tail = ratio;",
    "",
  ].join("\n"),
  "string-divide": [
    'const ratio = +"1" / 2; /' + "*",
    "export function scanned(): void {}",
    "*" + "/",
    "const tail = ratio;",
    "",
  ].join("\n"),
  "postfix-divide": [
    "let n = 1;",
    "n++ / 2; /" + "*",
    "export function scanned(): void {}",
    "*" + "/",
    "const tail = n;",
    "",
  ].join("\n"),
  "regex-divide": [
    "const ratio = /x/ / 2; /" + "*",
    "export function scanned(): void {}",
    "*" + "/",
    "const tail = ratio;",
    "",
  ].join("\n"),
  /** 内側templateの開始backtickを外側の終端と誤認すると、literalの中身が漏れる。 */
  "nested-template": [
    "const a = `x${`y export function scanned(): void {}`}z`;",
    "const b = a;",
    "",
  ].join("\n"),
  /** EOFで終わるline commentは未終端ではない。実在するexportを拒否しない。 */
  "eof-line-comment": [
    "export function scanned(): void {}",
    "// 末尾に改行が無いcomment",
  ].join("\n"),
};

Given(
  "{string}のenforcement exportを参照するbindingがある",
  function (fixture: string) {
    const source = EXPORT_SCAN_FIXTURES[fixture];
    if (source === undefined)
      throw new Error(`未定義のexport走査fixtureです: ${fixture}`);
    this.root = this.temp("asc-export-scan-");
    fs.mkdirSync(path.join(this.root, "checks"), { recursive: true });
    fs.writeFileSync(path.join(this.root, "checks", "target.ts"), source);
    this.contract = readJson(".agent-skill-chain/policy/conformance.json");
    this.rules = [rule()];
    const document = notApplicableBinding();
    const bindings: unknown[] = document.bindings;
    bindings[0] = {
      id: "I1",
      sourcePaths: ["checks/target.ts"],
      enforcement: [{ path: "checks/target.ts", export: "scanned" }],
      counterexampleScenarios: ["SCN-UNIT-SAT-014"],
    };
    this.binding = document;
    this.bindingInputs = [];
    this.evidence = {
      tool: "cucumber-js",
      passedScenarioIds: ["SCN-UNIT-SAT-014"],
    };
  },
);

Then("enforcement exportの判定は{string}になる", function (verdict: string) {
  const errors = (this.repositoryResults ?? []).flatMap(
    (result: { errors: string[] }) => result.errors,
  );
  const missing = errors.filter((error: string) =>
    error.includes("enforcement exportが実在しません"),
  );
  if (verdict === "valid")
    assert.deepEqual(missing, [], "実在するexportを見落としています");
  else
    assert.equal(
      missing.length,
      1,
      `実在しないexportを実在と誤認しています: ${errors.join(" | ")}`,
    );
});

Given("quality検査項目をapplicable objectにしたchoiceがある", function () {
  const value = choices() as unknown as { quality: Record<string, unknown> };
  value.quality.typecheckCommand = {
    status: "applicable",
    reason: "型検査は適用すると宣言する",
    evidence: "値は未指定",
  };
  this.choice = value;
});

When("project choiceを検証する", function () {
  this.choiceResult = validateProjectChoices(this.choice);
});

Then("quality applicabilityはvalidである", function () {
  assert.equal(
    this.choiceResult?.valid,
    true,
    this.choiceResult?.errors.join("; "),
  );
});

Then("値を持たないapplicable qualityはinvalidである", function () {
  assert.equal(this.choiceResult?.valid, false);
  assert.match(this.choiceResult?.errors.join(" ") ?? "", /not-applicable/u);
});

Given("conformance宣言の格下げと強化candidateがある", function () {
  const applicable = applicableBinding();
  const notApplicableDocument = notApplicableBinding();
  const weak: ConformanceDeclaration = {
    scope: "package-attested",
    bindingDocuments: [notApplicableDocument],
  };
  const strong: ConformanceDeclaration = {
    scope: "repository-bound",
    bindingDocuments: [applicable],
  };
  const trustedApplicable: ConformanceDeclaration = {
    bindingDocuments: [applicable],
  };
  const trustedNotApplicable: ConformanceDeclaration = {
    scope: "package-attested",
    bindingDocuments: [notApplicableDocument],
  };
  this.conformanceComparisons = [
    compareTrustedPolicy(policy(), policy(), {
      trustedConformance: trustedApplicable,
      candidateConformance: weak,
    }),
    compareTrustedPolicy(policy(), policy(), {
      trustedConformance: trustedNotApplicable,
      candidateConformance: strong,
    }),
  ];
  assert.ok(
    classifyConformanceDeclarationDiff(trustedApplicable, weak).weakened
      .length > 0,
  );
});

When("trusted policyからconformance差分を比較する", function () {});

Then("conformance格下げは拒否され強化は許可される", function () {
  assert.equal(this.conformanceComparisons[0]?.allowed, false);
  assert.equal(this.conformanceComparisons[1]?.allowed, true);
});

Given(
  "quality具体値の格下げとnot-applicableからの強化candidateがある",
  function () {
    const trusted = choices();
    trusted.quality.strictTypecheck = true;
    trusted.quality.typecheckCommand = "npm run typecheck";
    const weak = structuredClone(trusted);
    weak.quality.strictTypecheck =
      notApplicable("型検査を外すため対象外へ変更する");
    weak.quality.typecheckCommand = notApplicable(
      "型検査commandを外すため対象外へ変更する",
    );
    const weakDiff = classifyProjectChoiceDiff(trusted, weak);
    const baseline = choices();
    const strong = structuredClone(baseline);
    strong.quality.strictTypecheck = true;
    strong.quality.typecheckCommand = "npm run typecheck";
    this.choiceDiffs = [weakDiff, classifyProjectChoiceDiff(baseline, strong)];
  },
);

When("project choiceのquality差分を比較する", function () {});

Then("quality格下げは拒否され強化は許可される", function () {
  assert.ok(
    this.choiceDiffs[0]?.weakened.some((item) =>
      item.includes("strictTypecheck"),
    ),
  );
  assert.ok(
    this.choiceDiffs[0]?.weakened.some((item) =>
      item.includes("typecheckCommand"),
    ),
  );
  assert.deepEqual(this.choiceDiffs[1]?.weakened, []);
  assert.ok(
    this.choiceDiffs[1]?.allowed.some((item) =>
      item.includes("typecheckCommand"),
    ),
  );
});

Given(
  "PHP templateとTypeScript frontendを持つ隔離theme project policyがある",
  function () {
    prepareProject(this, "repository-bound");
  },
);

Given("型検査を持たない隔離project policyがある", function () {
  prepareProject(this, "package-attested");
});

When("隔離theme project policy一式を検証する", function () {
  const set = loadProjectPolicySet(this.root);
  const binding = set.conformanceBindings[0];
  this.repositoryResult = validateRepositoryConformance(
    this.root,
    readJson(".agent-skill-chain/policy/conformance.json"),
    binding,
    { tool: "cucumber-js", passedScenarioIds: ["SCN-INT-SAT-001"] },
    set.rules,
  );
  this.policySetValid = true;
  this.honestAssets =
    fs.existsSync(path.join(this.root, "checks", "theme-check.php")) &&
    allScenarios(binding).every((id) => /^SCN-[A-Z0-9-]+$/u.test(id));
});

When("隔離project policy一式を検証する", function () {
  const set = loadProjectPolicySet(this.root);
  this.policySetValid = set.conformanceBindings.length === 0;
});

Then("虚偽のexportと不存在pathと未採番SCNなしでvalidである", function () {
  assert.equal(this.policySetValid, true);
  assert.equal(
    this.repositoryResult?.valid,
    true,
    this.repositoryResult?.errors.join("; "),
  );
  assert.equal(this.honestAssets, true);
});

Then("package-attestedとquality applicabilityでvalidである", function () {
  assert.equal(this.policySetValid, true);
});

Given("現行repositoryのproject policyを変更せず読み込む", function () {
  this.root = process.cwd();
});

When("現行repositoryのpolicyとconformanceを検証する", function () {
  const set = loadProjectPolicySet(this.root);
  const manifestValue = set.manifest as { conformanceScope?: unknown };
  const currentChoice = set.choices[0];
  const binding = set.conformanceBindings[0];
  this.repositoryResult = validateRepositoryConformance(
    this.root,
    readJson(".agent-skill-chain/policy/conformance.json"),
    binding,
    { tool: "cucumber-js", passedScenarioIds: allScenarios(binding) },
    set.rules,
  );
  this.currentStrength =
    manifestValue.conformanceScope === undefined &&
    Boolean(currentChoice) &&
    currentChoice?.quality.strictTypecheck === true &&
    typeof currentChoice?.quality.typecheckCommand === "string" &&
    isAllApplicable(binding);
});

function isAllApplicable(binding: unknown): boolean {
  if (!isRecord(binding)) return false;
  const bindings = binding.bindings;
  return (
    Array.isArray(bindings) &&
    bindings.every(
      (item) =>
        isRecord(item) &&
        (item.status === undefined || item.status === "applicable"),
    )
  );
}

Then(
  "scope省略と全applicableとquality実値の同じ強度でvalidである",
  function () {
    assert.equal(this.currentStrength, true);
    assert.equal(
      this.repositoryResult?.valid,
      true,
      this.repositoryResult?.errors.join("; "),
    );
  },
);

Given("現行conformanceを3種類弱化した反例がある", function () {
  this.root = process.cwd();
  this.contract = readJson(".agent-skill-chain/policy/conformance.json");
  const original = readJson(
    ".agent-skill-chain/project/conformance/bindings.json",
  );
  const deleted = structuredClone(original) as { bindings: unknown[] };
  deleted.bindings.shift();
  const missingExport = structuredClone(original) as {
    bindings: Array<{ enforcement: Array<Record<string, unknown>> }>;
  };
  const firstPoint = missingExport.bindings[0]?.enforcement[0];
  assert.ok(firstPoint);
  firstPoint.export = "exportThatDoesNotExist";
  this.bindingInputs = [deleted, missingExport, original];
  const scenarios = allScenarios(original);
  this.evidence = {
    tool: "cucumber-js",
    passedScenarioIds: scenarios.slice(1),
  };
  this.rules = loadProjectPolicySet(this.root).rules;
});

When("現行repositoryのconformance反例を検証する", function () {
  const scenarios = allScenarios(this.bindingInputs[0]);
  this.repositoryResults = [
    validateRepositoryConformance(
      this.root,
      this.contract,
      this.bindingInputs[0],
      { tool: "cucumber-js", passedScenarioIds: scenarios },
      this.rules,
    ),
    validateRepositoryConformance(
      this.root,
      this.contract,
      this.bindingInputs[1],
      {
        tool: "cucumber-js",
        passedScenarioIds: allScenarios(this.bindingInputs[1]),
      },
      this.rules,
    ),
    validateRepositoryConformance(
      this.root,
      this.contract,
      this.bindingInputs[2],
      this.evidence,
      this.rules,
    ),
  ];
});

Then("I1削除と不存在exportとSCN証拠削除をすべて拒否する", function () {
  assert.ok(this.repositoryResults.every((result) => !result.valid));
  const errors = this.repositoryResults
    .flatMap((result) => result.errors)
    .join(" ");
  assert.match(errors, /I1/u);
  assert.match(errors, /exportThatDoesNotExist/u);
  assert.match(errors, /成功証拠/u);
});

async function execute(args: string[]): Promise<CliResult> {
  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    return { status: await main(args), stdout, stderr: "" };
  } finally {
    process.stdout.write = originalWrite;
  }
}

Given("policyがmissingとvalidとinvalidの3つの隔離consumerがある", function () {
  const missing = this.temp("asc-doctor-missing-");
  const valid = this.temp("asc-doctor-valid-");
  const invalid = this.temp("asc-doctor-invalid-");
  for (const root of [missing, valid, invalid]) init(root, { apply: true });
  fs.cpSync(
    ".agent-skill-chain/project",
    path.join(valid, ".agent-skill-chain", "project"),
    { recursive: true },
  );
  fs.copyFileSync(
    ".agent-skill-chain/project-policy.json",
    path.join(valid, ".agent-skill-chain", "project-policy.json"),
  );
  writeJson(
    path.join(invalid, ".agent-skill-chain", "project-policy.json"),
    manifest(),
  );
  this.bindingInputs = [missing, valid, invalid];
});

When("各consumerでdoctor CLIを実行する", async function () {
  this.cliResults = [];
  for (const root of this.bindingInputs)
    this.cliResults.push(await execute(["doctor", `--root=${String(root)}`]));
});

Then("doctorは3種類のproject policy状態を報告する", function () {
  const states = this.cliResults.map((result) => {
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      projectPolicyStatus?: unknown;
    };
    return output.projectPolicyStatus;
  });
  assert.deepEqual(states, ["missing", "valid", "invalid"]);
});

Given("既存themeの隔離directoryがある", function () {
  this.root = this.temp("asc-bootstrap-theme-");
  fs.writeFileSync(path.join(this.root, "index.php"), "<?php echo 'theme';\n");
});

When("theme project bootstrap CLIをapplyする", async function () {
  this.cliResults = [
    await execute([
      "project",
      "bootstrap",
      `--root=${this.root}`,
      "--kind=theme",
      "--onboard-existing",
      "--apply",
    ]),
  ];
});

Then(
  "bootstrapはdocs specsだけの生成とpolicy未検証と次の安全な操作を返す",
  function () {
    const result = this.cliResults[0];
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.deepEqual(output.generatedScope, ["docs/specs/"]);
    assert.equal(output.projectPolicyStatus, "not-generated-not-validated");
    assert.match(String(output.nextSafeOperation), /policy validate/u);
    assert.equal(
      fs.existsSync(
        path.join(this.root, ".agent-skill-chain", "project-policy.json"),
      ),
      false,
    );
  },
);

/**
 * 縮小（弱化）の拒否理由は、**候補側から適用する経路が製品CLIに無いこと**まで返す。
 * 「trusted側を先に更新せよ」とだけ返すと、`policy migrate`も同じ比較で拒否するため
 * 利用者が循環する（Issue #982、#998）。
 */
Given("testLayersを縮小したcandidate policyがある", function () {
  const trustedChoices = choices();
  trustedChoices.testLayers = ["unit", "integration"];
  const candidateChoices = structuredClone(trustedChoices);
  candidateChoices.testLayers = ["unit"];
  this.narrowComparison = compareTrustedPolicy(
    policy(trustedChoices),
    policy(candidateChoices),
  );
});

When("trusted policyから縮小差分を比較する", function () {});

Then("縮小の拒否理由は候補側に適用経路が無いことを示す", function () {
  assert.equal(this.narrowComparison?.allowed, false);
  const rejected = this.narrowComparison?.rejected.find(
    (entry) => entry.ruleId === "ASC-TRUST-001",
  );
  assert.ok(rejected, "ASC-TRUST-001の拒否がありません");
  assert.match(
    rejected.next,
    /既定branchのproject policyを先に更新してください/u,
  );
  assert.match(rejected.next, /候補側から適用する経路は製品CLIにありません/u);
  assert.equal(
    rejected.requiredAuthority,
    "既定ブランチのproject policy owner",
  );
});
