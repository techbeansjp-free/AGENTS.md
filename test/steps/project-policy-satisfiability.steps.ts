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
  repositoryResult: ValidationResult | undefined = undefined;
  repositoryResults: ValidationResult[] = [];
  choice: unknown = undefined;
  choiceResult: ValidationResult | undefined = undefined;
  conformanceComparisons: ReturnType<typeof compareTrustedPolicy>[] = [];
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
