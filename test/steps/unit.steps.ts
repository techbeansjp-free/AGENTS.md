import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  classifyMode,
  detectQuickDisqualifiers,
} from "../../src/domain/mode.js";
import {
  safeSlug,
  resolveContained,
  redactSecrets,
} from "../../src/lib/security.js";
import { evaluateReview } from "../../src/domain/review.js";
import {
  loadOperationPolicy,
  validatePolicy,
} from "../../src/domain/policy.js";
import { validateScenarioTrace } from "../../src/domain/trace.js";
import * as traceDomain from "../../src/domain/trace.js";
import {
  collectProjectTrace,
  parseProjectGherkin,
} from "../../scripts/check_trace.js";
import { collectTypeScriptDependencyGraph } from "../../scripts/check_dependency_graph.js";
import { checkFileAudit } from "../../scripts/check_file_audit.js";
import { checkDirectoryGuides } from "../../scripts/check_directory_guides.js";
import { checkSkillTemplateContracts } from "../../scripts/check_skill_templates.js";
import { checkCliContract } from "../../scripts/check_cli_contract.js";
import {
  checkSourceQuality,
  validateSourceTypeSyntax,
} from "../../scripts/check_source_quality.js";
import { checkProjectQualityContract } from "../../scripts/check_project_quality.js";
import { validateDevelopmentConsiderations } from "../../src/domain/conformance.js";
import { run } from "../../src/lib/process.js";
import { main } from "../../src/cli.js";
import {
  COMPATIBLE_POLICY_SCHEMA_VERSIONS,
  CURRENT_POLICY_SCHEMA_VERSION,
  DEPRECATED_POLICY_SCHEMA_ALIASES,
  PACKAGE_VERSION,
  SUPPORTED_POLICY_SCHEMA_VERSIONS,
  isPackageVersion,
  isPolicySchemaPatchVersion,
  packageReleaseVersion,
} from "../../src/lib/version.js";

interface UnitWorld extends WorkflowWorld {
  adrAssets: string[];
  answers: Parameters<typeof classifyMode>[0];
  auditBase: string;
  auditFile: string;
  auditImplementation: string;
  auditMarkdown: string;
  auditedMermaidTemplates: string[];
  blockScalarSkillContractRoot: string;
  blockScalarSkillContracts: {
    valid: boolean;
    errors: string[];
    skills: number;
  };
  brokenDirectoryGuideRoot: string;
  brokenDirectoryGuides: {
    valid: boolean;
    errors: string[];
    directories: number;
    guides: number;
    entries: { [k: string]: string };
  };
  brokenSkillContractRoot: string;
  brokenSkillContracts: { valid: boolean; errors: string[]; skills: number };
  candidate: string;
  changedFiles: string[];
  choiceSchema: ChoiceSchemaFixture;
  considerationDocument: string;
  considerationResult: {
    valid: boolean;
    errors: string[];
    checked: readonly ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"];
  };
  cyclicGraph: { nodes: string[]; edges: { from: string; to: string }[] };
  cyclicResult: {
    valid: boolean;
    errors: string[];
    order: string[];
    diagnostic:
      | {
          ruleId: string;
          purpose: string;
          risk: string;
          reasons: string[];
          scope: string[];
          checks: string[];
          autoFixes: never[];
          next: string;
          requiredAuthority: string;
          rollback: string;
        }
      | undefined;
  };
  defaultPolicy: MutablePolicyFixture;
  defaultSha: string;
  diagnostic: string;
  directoryGuideRoot: string;
  documentCheck: SpawnSyncReturns<string>;
  emptyLayersPolicy: MutablePolicyFixture;
  featureSha: string;
  featuresRoot: string;
  fileAuditContract: string;
  forbiddenFileSuffixes: string[] | never[];
  forbiddenSource: string;
  gherkin:
    | "Feature: 日本語機能\nScenario: SCN-X-001 日本語scenario\n Given 日本語前提\n Then 日本語結果\n"
    | "機能: 日本語機能\nシナリオ: SCN-X-002 日本語scenario\n 前提 日本語前提\n もし 日本語操作\n ならば 日本語結果\n";
  graph: { nodes: string[]; edges: { from: string; to: string }[] };
  invalidAudit:
    | {
        valid: boolean;
        errors: string[];
        base?: undefined;
        implementation?: undefined;
        auditedFiles?: undefined;
        current?: undefined;
        auditPath?: undefined;
      }
    | {
        valid: boolean;
        errors: string[];
        base: string;
        implementation: string;
        auditedFiles: number;
        current?: undefined;
        auditPath?: undefined;
      }
    | {
        valid: boolean;
        errors: string[];
        base: string;
        implementation: string;
        current: string;
        auditPath: string;
        auditedFiles: number;
      };
  legacyCliContract: { valid: boolean; errors: string[]; commands: number };
  legacyCliContractRoot: string;
  missingDirectoryGuideRoot: string;
  missingDirectoryGuides: {
    valid: boolean;
    errors: string[];
    directories: number;
    guides: number;
    entries: { [k: string]: string };
  };
  missingDomainGlossaryContractRoot: string;
  missingDomainGlossaryContracts: {
    valid: boolean;
    errors: string[];
    skills: number;
  };
  missingVocabularyContractRoot: string;
  missingVocabularyContracts: {
    valid: boolean;
    errors: string[];
    skills: number;
  };
  mixedVocabularyContractRoot: string;
  mixedVocabularyContracts: {
    valid: boolean;
    errors: string[];
    skills: number;
  };
  nameOffenders: string[];
  namespaceNormative: string[];
  nonAncestorAudit:
    | {
        valid: boolean;
        errors: string[];
        base?: undefined;
        implementation?: undefined;
        auditedFiles?: undefined;
        current?: undefined;
        auditPath?: undefined;
      }
    | {
        valid: boolean;
        errors: string[];
        base: string;
        implementation: string;
        auditedFiles: number;
        current?: undefined;
        auditPath?: undefined;
      }
    | {
        valid: boolean;
        errors: string[];
        base: string;
        implementation: string;
        current: string;
        auditPath: string;
        auditedFiles: number;
      };
  offenders: unknown;
  omittedSkillContractRoot: string;
  omittedSkillContracts: { valid: boolean; errors: string[]; skills: number };
  operationPolicy: ReturnType<typeof loadOperationPolicy>;
  operationPolicyError: string;
  operationsSpec: string;
  originalCredentials: string[];
  outside: string;
  packageBoundaryOffenders: unknown;
  packageMetadata: PackageMetadataFixture;
  packageRuntime: string[];
  packageScanned: true;
  parsed: ReturnType<typeof parseProjectGherkin>;
  phaseAContractInspected: true;
  phaseAReview: string;
  policy: MutablePolicyFixture;
  policySchema: PolicySchemaFixture;
  policyValidation: ReturnType<typeof validatePolicy>;
  prChecklist: string;
  processSecret: "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
  projectQualityResult: ReturnType<typeof checkProjectQualityContract>;
  projectQualityRoot: string;
  projectQualityTrustedRoot: string;
  releaseVersion: string;
  runtimeInputErrors: string[];
  runtimeManifestFile: string;
  runtimeStateFile: string;
  review: ReviewFixture;
  reviewTemplate: string;
  root: string;
  rootNormative: string[];
  sameCommitAudit:
    | {
        valid: boolean;
        errors: string[];
        base?: undefined;
        implementation?: undefined;
        auditedFiles?: undefined;
        current?: undefined;
        auditPath?: undefined;
      }
    | {
        valid: boolean;
        errors: string[];
        base: string;
        implementation: string;
        auditedFiles: number;
        current?: undefined;
        auditPath?: undefined;
      }
    | {
        valid: boolean;
        errors: string[];
        base: string;
        implementation: string;
        current: string;
        auditPath: string;
        auditedFiles: number;
      };
  skillContractRoot: string;
  skills: string[];
  sourceFiles: string[];
  sourceGraph: { nodes: string[]; edges: { from: string; to: string }[] };
  sourceQuality: { valid: boolean; errors: string[]; files: number };
  sourceQualityRoot: string;
  sourceResult: {
    valid: boolean;
    errors: string[];
    order: string[];
    diagnostic:
      | {
          ruleId: string;
          purpose: string;
          risk: string;
          reasons: string[];
          scope: string[];
          checks: string[];
          autoFixes: never[];
          next: string;
          requiredAuthority: string;
          rollback: string;
        }
      | undefined;
  };
  sourceTypeErrors: string[];
  status: number;
  stdout: string;
  templateBoundaryOffenders: unknown;
  testLayers: string[];
  title: string;
  traceEvidence: string;
  traceRoot: string;
  traceTemplate: string;
  unknownDirectoryGuideRoot: string;
  unknownDirectoryGuides: {
    valid: boolean;
    errors: string[];
    directories: number;
    guides: number;
    entries: { [k: string]: string };
  };
  unroutedSkillContractRoot: string;
  unroutedSkillContracts: { valid: boolean; errors: string[]; skills: number };
  validAudit:
    | {
        valid: boolean;
        errors: string[];
        base?: undefined;
        implementation?: undefined;
        auditedFiles?: undefined;
        current?: undefined;
        auditPath?: undefined;
      }
    | {
        valid: boolean;
        errors: string[];
        base: string;
        implementation: string;
        auditedFiles: number;
        current?: undefined;
        auditPath?: undefined;
      }
    | {
        valid: boolean;
        errors: string[];
        base: string;
        implementation: string;
        current: string;
        auditPath: string;
        auditedFiles: number;
      };
  validCliContract: { valid: boolean; errors: string[]; commands: number };
  validCliContractRoot: string;
  validDirectoryGuides: {
    valid: boolean;
    errors: string[];
    directories: number;
    guides: number;
    entries: { [k: string]: string };
  };
  validSkillContracts: { valid: boolean; errors: string[]; skills: number };
  dependencyResult: ReturnType<typeof traceDomain.validateDependencyGraph>;
  disqualifiers: ReturnType<typeof detectQuickDisqualifiers>;
  modeResult: ReturnType<typeof classifyMode>;
  reviewResult: ReturnType<typeof evaluateReview>;
  traceResult: ReturnType<typeof validateScenarioTrace>;
}

interface MutablePolicyFixture {
  schemaVersion: string;
  delivery: { stopAt: string; [key: string]: unknown };
  merge: {
    mode: string;
    branches: unknown[];
    methods: unknown[];
    requiredChecks: unknown[];
    requiredReviews: number;
    [key: string]: unknown;
  };
  rules?: unknown[];
  projectChoices?: unknown;
  [key: string]: unknown;
}

interface PackageMetadataFixture {
  version: string;
}

interface PolicySchemaFixture {
  properties: { schemaVersion: { enum: string[] } };
}

interface ChoiceSchemaFixture {
  properties: { testLayers: { minItems: number } };
}

interface ReviewFixture {
  round: number;
  developmentConsiderations:
    | Array<{ id: string; status: string; reason: string; evidence: string }>
    | undefined;
  headSha: string;
  candidateEvidence: {
    implementationCommitSha: string;
    finalCommitSha: string;
    implementationTreeSha: string;
    implementationIsAncestor: boolean;
    changedPaths: string[];
    artifact: { path: string; sha256: string; blobOid: string };
  };
  externalEvidence: {
    provenance: Record<string, unknown>;
    implementation: {
      repository: string;
      commitSha: string;
      authorActorId: unknown;
    };
    pr: {
      repository: string;
      number: number;
      headSha: string;
      authorActorId: string;
    };
    ci: {
      repository: string;
      runId: string;
      event: string;
      headSha: string;
      conclusion: string;
      pullRequestNumbers: number[];
    };
    review: {
      repository: string;
      prNumber: number;
      reviewId: string;
      commitSha: string;
      actorId: unknown;
      submittedAt: string;
      verdict: string;
    };
  };
  affirmative: Record<string, string | undefined>;
  adversarial: Record<string, string | undefined>;
  focus?: {
    unresolvedBlocking: string[];
    fixedDiff: string[];
    adjacentScope: string[];
    fullRescan: boolean;
  };
  findings: Array<{
    id: string;
    severity: string;
    status: string;
    evidence: string;
    riskAcceptance?: {
      authority: string;
      owner: string;
      reason: string;
      reviewCondition: string;
    };
  }>;
  tests: string;
  specConsistency: string;
}

const { Given, When, Then } = stepDefinitions<UnitWorld>();

Given("開発考慮事項が3行しかない成果物がある", function () {
  this.considerationDocument = [
    "| ID | 考慮事項 | 判定 | 理由 | 要求・確認証拠 |",
    "|---|---|---|---|---|",
    "| DC-PRIVACY | Privacy | applicable | 個人情報を扱う | NFR-01 |",
    "| DC-OBSERVABILITY | Observability | applicable | 運用対象である | NFR-02 |",
    "| DC-UX | UI/UX | not-applicable | CLIだけを提供する | projectKind=cli |",
  ].join("\n");
});
When("開発考慮事項conformanceを検証する", function () {
  this.considerationResult = validateDevelopmentConsiderations(
    this.considerationDocument,
  );
});
Then("欠落した考慮事項IDを拒否する", function () {
  assert.equal(this.considerationResult.valid, false);
  assert.ok(
    this.considerationResult.errors.some((error: string) =>
      error.includes("DC-TOKENS"),
    ),
  );
});
Given("理由と証拠がxだけの開発考慮事項がある", function () {
  this.considerationDocument = [
    "| ID | 考慮事項 | 判定 | 理由 | 要求・確認証拠 |",
    "|---|---|---|---|---|",
    "| DC-PRIVACY | Privacy | applicable | x | x |",
    "| DC-OBSERVABILITY | Observability | applicable | x | x |",
    "| DC-UX | UI/UX | not-applicable | x | x |",
    "| DC-TOKENS | Token | not-applicable | x | x |",
  ].join("\n");
});
Then("形式的な理由と証拠を拒否する", function () {
  assert.equal(this.considerationResult.valid, false);
  assert.ok(
    this.considerationResult.errors.some((error: string) =>
      error.includes("具体化されていません"),
    ),
  );
});
Given("projectで禁止された型表現を持つsourceがある", function () {
  this.forbiddenSource = "type Unsafe = " + "a" + "ny;";
});
When("source型契約を検証する", function () {
  this.sourceTypeErrors = validateSourceTypeSyntax(this.forbiddenSource);
});
Then("source型契約は失敗する", function () {
  assert.ok(this.sourceTypeErrors.length > 0);
});
Given("JSDoc型注釈を持つTypeScript sourceがある", function () {
  this.forbiddenSource = "/** @" + "param {string} value */";
});
Given("repositoryのproject choiceを読み込む", function () {
  this.sourceQualityRoot = process.cwd();
});
When("repositoryのsource品質を検証する", function () {
  this.sourceQuality = checkSourceQuality(this.sourceQualityRoot);
});
Then("TypeScript集約と補助言語対象外証拠を確認できる", function () {
  assert.equal(
    this.sourceQuality.valid,
    true,
    JSON.stringify(this.sourceQuality),
  );
});
Given(
  "任意directoryに大文字拡張子とshebangのPython sourceを置いたprojectがある",
  function () {
    this.sourceQualityRoot = this.temp("asc-source-bypass-");
    fs.mkdirSync(path.join(this.sourceQualityRoot, ".agent-skill-chain"), {
      recursive: true,
    });
    fs.copyFileSync(
      ".agent-skill-chain/project-policy.json",
      path.join(
        this.sourceQualityRoot,
        ".agent-skill-chain/project-policy.json",
      ),
    );
    fs.cpSync(
      ".agent-skill-chain/project",
      path.join(this.sourceQualityRoot, ".agent-skill-chain/project"),
      { recursive: true },
    );
    const bypassDirectory = path.join(this.sourceQualityRoot, "extensions");
    fs.mkdirSync(bypassDirectory);
    fs.writeFileSync(path.join(bypassDirectory, "unsafe.PY"), "value = 1\n");
    fs.writeFileSync(
      path.join(bypassDirectory, "unsafe-tool"),
      "#!/usr/bin/env python3\nvalue = 1\n",
    );
  },
);
Then("大文字拡張子とshebangのPython source再混入を拒否する", function () {
  assert.equal(this.sourceQuality.valid, false);
  for (const expected of ["extensions/unsafe.PY", "extensions/unsafe-tool"])
    assert.ok(
      this.sourceQuality.errors.some((error: string) =>
        error.includes(expected),
      ),
    );
});
Given(
  "project choiceを乖離させtestとconformanceをtrue、runnerを空、ESLintをoff、trusted jobをfalseへ変更したprojectがある",
  function () {
    this.projectQualityRoot = this.temp("asc-quality-relaxation-");
    for (const relative of [
      ".agent-skill-chain/project/choices/development.json",
      ".github/trusted-quality-proposals.json",
      ".github/workflows/ci.yml",
      ".github/workflows/trusted-quality.yml",
      ".prettierignore",
      "cucumber.mjs",
      "eslint.config.mjs",
      "package-lock.json",
      "scripts/check_project_quality.ts",
      "scripts/check_source_quality.ts",
      "src/lib/entrypoint.ts",
      "src/lib/security.ts",
      "tsconfig.json",
      "tsconfig.build.json",
    ]) {
      const destination = path.join(this.projectQualityRoot, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(relative, destination);
    }
    const metadata = JSON.parse(
      fs.readFileSync("package.json", "utf8"),
    ) as unknown as { scripts: Record<string, string> };
    metadata.scripts.test = "true";
    metadata.scripts["conformance:check"] = "true";
    fs.writeFileSync(
      path.join(this.projectQualityRoot, "package.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    const choicesFile = path.join(
      this.projectQualityRoot,
      ".agent-skill-chain/project/choices/development.json",
    );
    const choices = JSON.parse(
      fs.readFileSync(choicesFile, "utf8"),
    ) as unknown as Record<string, unknown>;
    choices.packageManager = "other";
    choices.runtime = "other";
    choices.ci = ".github/workflows/other.yml";
    fs.writeFileSync(choicesFile, `${JSON.stringify(choices, null, 2)}\n`);
    const eslintFile = path.join(this.projectQualityRoot, "eslint.config.mjs");
    fs.writeFileSync(
      eslintFile,
      fs
        .readFileSync(eslintFile, "utf8")
        .replace(
          '"@typescript-eslint/no-unsafe-assignment": "error"',
          '"@typescript-eslint/no-unsafe-assignment": "off"',
        ),
    );
    const workflowFile = path.join(
      this.projectQualityRoot,
      ".github/workflows/trusted-quality.yml",
    );
    fs.writeFileSync(
      workflowFile,
      fs
        .readFileSync(workflowFile, "utf8")
        .replace(
          "    runs-on: ubuntu-latest",
          "    if: false\n    runs-on: ubuntu-latest",
        ),
    );
    const cucumberFile = path.join(this.projectQualityRoot, "cucumber.mjs");
    fs.writeFileSync(
      cucumberFile,
      fs
        .readFileSync(cucumberFile, "utf8")
        .replace(
          "publishQuiet: true,",
          'publishQuiet: true,\n  tags: "@never",',
        ),
    );
    const stepsRoot = path.join(this.projectQualityRoot, "test/steps");
    fs.mkdirSync(stepsRoot, { recursive: true });
    fs.writeFileSync(
      path.join(stepsRoot, "unsafe.steps.ts"),
      "import { " +
        'Given } from "@cucumber/' +
        'cucumber";\nGiven("unsafe", function () {});\n',
    );
  },
);
When("project品質bindingを検証する", function () {
  this.projectQualityResult = checkProjectQualityContract(
    this.projectQualityRoot,
    process.cwd(),
  );
});

function copyQualityContractFixture(root: string): void {
  for (const relative of [
    ".agent-skill-chain/project/choices/development.json",
    ".github/trusted-quality-proposals.json",
    ".github/workflows/ci.yml",
    ".github/workflows/trusted-quality.yml",
    ".prettierignore",
    "cucumber.mjs",
    "eslint.config.mjs",
    "package-lock.json",
    "package.json",
    "scripts/check_project_quality.ts",
    "scripts/check_source_quality.ts",
    "src/lib/entrypoint.ts",
    "src/lib/security.ts",
    "tsconfig.json",
    "tsconfig.build.json",
  ]) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(relative, destination);
  }
  const stepsRoot = path.join(root, "test/steps");
  fs.mkdirSync(stepsRoot, { recursive: true });
  fs.writeFileSync(
    path.join(stepsRoot, "safe.steps.ts"),
    "const typed = stepDefinitions<WorkflowWorld>();\nvoid typed;\n",
  );
}

function fileSha256(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function valueSha256(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

Given(
  "baseで事前登録したversioned staged品質proposalと完全一致するcandidateがある",
  function () {
    this.projectQualityTrustedRoot = this.temp("asc-quality-trusted-");
    this.projectQualityRoot = this.temp("asc-quality-candidate-");
    copyQualityContractFixture(this.projectQualityTrustedRoot);
    copyQualityContractFixture(this.projectQualityRoot);
    const relative = ".prettierignore";
    const trustedFile = path.join(this.projectQualityTrustedRoot, relative);
    const candidateFile = path.join(this.projectQualityRoot, relative);
    fs.writeFileSync(
      candidateFile,
      fs
        .readFileSync(candidateFile, "utf8")
        .replace("docs/reviews/01_課題834実装レビュー.md\n", ""),
    );
    const candidatePackageFile = path.join(
      this.projectQualityRoot,
      "package.json",
    );
    const trustedPackage = JSON.parse(
      fs.readFileSync(
        path.join(this.projectQualityTrustedRoot, "package.json"),
        "utf8",
      ),
    ) as unknown as {
      agentSkillChain: { qualityContractVersion: number };
    };
    const fromVersion = trustedPackage.agentSkillChain.qualityContractVersion;
    const toVersion = fromVersion + 1;
    const candidatePackage = JSON.parse(
      fs.readFileSync(candidatePackageFile, "utf8"),
    ) as unknown as {
      agentSkillChain: { qualityContractVersion: number };
    };
    candidatePackage.agentSkillChain.qualityContractVersion = toVersion;
    fs.writeFileSync(
      candidatePackageFile,
      `${JSON.stringify(candidatePackage, null, 2)}\n`,
    );
    const proposal = {
      proposalId: "TQP-QUALITY-STRENGTHENING-001",
      status: "staged",
      fromVersion,
      toVersion,
      owner: "repository maintainer",
      rationale: "review文書をformatter対象へ戻して形式品質を強化する",
      rollback: "qualityContractVersion 1と従来ignore内容へ戻す",
      targets: [
        {
          kind: "file",
          name: relative,
          beforeSha256: fileSha256(trustedFile),
          afterSha256: fileSha256(candidateFile),
        },
        {
          kind: "packageField",
          name: "agentSkillChain.qualityContractVersion",
          beforeSha256: valueSha256(fromVersion),
          afterSha256: valueSha256(toVersion),
        },
      ],
    };
    const registry = {
      schemaVersion: "agent-skill-chain/trusted-quality-proposals/v1",
      proposals: [proposal],
    };
    for (const root of [
      this.projectQualityTrustedRoot,
      this.projectQualityRoot,
    ])
      fs.writeFileSync(
        path.join(root, ".github/trusted-quality-proposals.json"),
        `${JSON.stringify(registry, null, 2)}\n`,
      );
  },
);

Given(
  "candidate自身だけが登録した品質proposalで同じ変更を有効化しようとする",
  function () {
    const registryFile = path.join(
      this.projectQualityTrustedRoot,
      ".github/trusted-quality-proposals.json",
    );
    fs.writeFileSync(
      registryFile,
      `${JSON.stringify({ schemaVersion: "agent-skill-chain/trusted-quality-proposals/v1", proposals: [] }, null, 2)}\n`,
    );
  },
);

When("trusted品質契約migrationを検証する", function () {
  this.projectQualityResult = checkProjectQualityContract(
    this.projectQualityRoot,
    this.projectQualityTrustedRoot,
  );
});

Then("事前登録済みの品質強化だけを許可する", function () {
  assert.equal(
    this.projectQualityResult.valid,
    true,
    JSON.stringify(this.projectQualityResult),
  );
});

Then("candidateによる同一PR内の自己承認を拒否する", function () {
  assert.equal(this.projectQualityResult.valid, false);
  assert.ok(
    this.projectQualityResult.errors.some((error: string) =>
      error.includes("baseで事前登録済み"),
    ),
  );
});

Given("型不正なmigration manifestとstateの外部JSONがある", function () {
  const root = this.temp("asc-runtime-input-");
  this.runtimeManifestFile = path.join(root, "manifest.json");
  this.runtimeStateFile = path.join(root, "state.json");
  fs.writeFileSync(
    this.runtimeManifestFile,
    `${JSON.stringify({ root, entries: [{ kind: "runtime", path: 42, after: true }], unknown: "ignored" }, null, 2)}\n`,
  );
  fs.writeFileSync(
    this.runtimeStateFile,
    `${JSON.stringify({ manifest: [], revision: "zero", unknown: "ignored" }, null, 2)}\n`,
  );
  this.runtimeInputErrors = [];
});

When("CLIの入力種別別runtime validatorを実行する", async function () {
  const policy = path.resolve(".agent-skill-chain/policy/default.json");
  for (const argv of [
    [
      "policy",
      "migrate",
      `--trusted=${policy}`,
      `--candidate=${policy}`,
      `--manifest=${this.runtimeManifestFile}`,
      "--dry-run",
    ],
    [
      "policy",
      "migrate",
      "--operation=rollback",
      `--state=${this.runtimeStateFile}`,
      "--dry-run",
    ],
  ]) {
    try {
      await main(argv);
    } catch (error) {
      this.runtimeInputErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
});

Then("型不正と未知fieldを副作用前に拒否する", function () {
  assert.equal(this.runtimeInputErrors.length, 2);
  assert.ok(
    this.runtimeInputErrors.some((error) =>
      error.includes("migration manifestの構造が不正"),
    ),
  );
  assert.ok(
    this.runtimeInputErrors.some((error) =>
      error.includes("file migration stateの構造が不正"),
    ),
  );
  const boundarySources = ["src/cli.ts", "src/adapters/json-input.ts"].map(
    (file) => fs.readFileSync(file, "utf8"),
  );
  for (const source of boundarySources) {
    assert.doesNotMatch(source, /readJson\s*</u);
    assert.doesNotMatch(source, /parseJsonStrict\([^)]*\)\s+as\s+/u);
  }
});
Then("project choice乖離と品質scriptの自己緩和を拒否する", function () {
  assert.equal(this.projectQualityResult.valid, false);
  for (const field of ["packageManager", "runtime", "ci"])
    assert.ok(
      this.projectQualityResult.errors.some((error: string) =>
        error.includes(field),
      ),
    );
  assert.ok(
    this.projectQualityResult.errors.some((error: string) =>
      error.includes("自己緩和"),
    ),
  );
  assert.ok(
    this.projectQualityResult.errors.some((error: string) =>
      error.includes("Cucumber stepを直接import"),
    ),
  );
});

const validAnswers = () =>
  Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: true, evidence: `evidence-${index + 1}` },
    ]),
  );
const H_IMPL = "a".repeat(40);
const H_FINAL = "c".repeat(40);
const developmentConsiderations = () => [
  {
    id: "DC-PRIVACY",
    status: "applicable",
    reason: "個人情報と秘密の境界を確認する",
    evidence: "SCN-UNIT-SEC-005",
  },
  {
    id: "DC-OBSERVABILITY",
    status: "applicable",
    reason: "診断と監査記録を確認する",
    evidence: "SCN-UNIT-RISK-008",
  },
  {
    id: "DC-UX",
    status: "not-applicable",
    reason: "対象製品は画面を持たないCLIである",
    evidence: "projectKind=cli",
  },
  {
    id: "DC-TOKENS",
    status: "not-applicable",
    reason: "視覚componentとlayoutを所有しない",
    evidence: "UI sourceなし",
  },
];
const reviewBase = (): ReviewFixture => ({
  round: 1,
  developmentConsiderations: developmentConsiderations(),
  headSha: H_FINAL,
  candidateEvidence: {
    implementationCommitSha: H_IMPL,
    finalCommitSha: H_FINAL,
    implementationTreeSha: "b".repeat(40),
    implementationIsAncestor: true,
    changedPaths: ["docs/reviews/phase-a.json"],
    artifact: {
      path: "docs/reviews/phase-a.json",
      sha256: "d".repeat(64),
      blobOid: "e".repeat(40),
    },
  },
  externalEvidence: {
    provenance: {
      source: "github",
      repository: "o/r",
      prNumber: 835,
      runId: "32635972969",
      reviewId: "9001",
    },
    implementation: {
      repository: "o/r",
      commitSha: H_IMPL,
      authorActorId: "actor-implementer",
    },
    pr: {
      repository: "o/r",
      number: 835,
      headSha: H_FINAL,
      authorActorId: "actor-pr-author",
    },
    ci: {
      repository: "o/r",
      runId: "32635972969",
      event: "pull_request",
      headSha: H_FINAL,
      conclusion: "success",
      pullRequestNumbers: [835],
    },
    review: {
      repository: "o/r",
      prNumber: 835,
      reviewId: "9001",
      commitSha: H_FINAL,
      actorId: "actor-reviewer",
      submittedAt: "2026-08-23T12:00:00Z",
      verdict: "approved",
    },
  },
  affirmative: {
    correctness: "pass",
    value: "pass",
    feasibility: "pass",
    consistency: "pass",
    maintainability: "pass",
  },
  adversarial: {
    counterexamples: "pass",
    failures: "pass",
    boundaries: "pass",
    abuse: "pass",
    security: "pass",
    dataLoss: "pass",
    rollback: "pass",
    scope: "pass",
  },
  findings: [],
  tests: "pass",
  specConsistency: "pass",
});
const runtimeFiles = () =>
  fs
    .readdirSync("src", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));

Given("remote default branchから分岐したfeature commitがある", function () {
  this.root = this.initRepo();
  fs.mkdirSync(path.join(this.root, ".agent-skill-chain/policy"), {
    recursive: true,
  });
  fs.copyFileSync(
    ".agent-skill-chain/policy/default.json",
    path.join(this.root, ".agent-skill-chain/policy/default.json"),
  );
  spawnSync("git", ["add", ".agent-skill-chain/policy/default.json"], {
    cwd: this.root,
  });
  spawnSync("git", ["commit", "-q", "-m", "trusted default"], {
    cwd: this.root,
  });
  this.defaultSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
  spawnSync(
    "git",
    ["update-ref", "refs/remotes/origin/main", this.defaultSha],
    { cwd: this.root },
  );
  fs.writeFileSync(path.join(this.root, "feature.txt"), "candidate only\n");
  spawnSync("git", ["add", "feature.txt"], { cwd: this.root });
  spawnSync("git", ["commit", "-q", "-m", "feature only"], { cwd: this.root });
  this.featureSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
});
When(
  "feature commitをtrusted commitとexpected base SHAの両方へ指定する",
  function () {
    const candidateHeadSha = "f".repeat(40);
    try {
      this.operationPolicy = loadOperationPolicy(this.root, {
        trustedCommit: this.featureSha,
        expectedBaseSha: this.featureSha,
        candidateHeadSha,
        baseRef: "main",
        defaultBranch: "main",
        repository: "o/r",
        pr: 1,
        provider: {
          provenance: { source: "github", repository: "o/r", prNumber: 1 },
          repository: "o/r",
          prNumber: 1,
          baseRefName: "main",
          defaultBranch: "main",
          defaultBranchTipOid: this.defaultSha,
          baseRefOid: this.featureSha,
          headRefOid: candidateHeadSha,
        },
      });
    } catch (error) {
      this.operationPolicyError =
        error instanceof Error ? error.message : String(error);
    }
  },
);
Then(
  "explicit trusted authorityはremote default branchへ拘束されて拒否される",
  function () {
    assert.equal(this.operationPolicy, undefined);
    assert.match(
      this.operationPolicyError ?? "",
      /default|ancestor|base|trusted/u,
    );
  },
);

Given("Q-01〜Q-08がすべてtrueで、それぞれに根拠がある", function () {
  this.answers = validAnswers();
});
Given("Q-04を{word}にする", function (state: string) {
  if (state === "false")
    this.answers["Q-04"] = { answer: false, evidence: "false evidence" };
  else if (state === "unknown")
    this.answers["Q-04"] = { answer: "unknown", evidence: "unknown evidence" };
  else if (state === "根拠なし")
    this.answers["Q-04"] = { answer: true, evidence: "" };
  else if (state === "未回答") delete this.answers["Q-04"];
});
When("modeを判定する", function () {
  this.modeResult = classifyMode(this.answers);
});
Then("判定結果はquickである", function () {
  assert.equal(this.modeResult.mode, "quick");
});
Then("判定結果はfullである", function () {
  assert.equal(this.modeResult.mode, "full");
});
Then("不適格理由は0件である", function () {
  assert.equal(this.modeResult.reasons.length, 0);
});
Then("不適格理由にQ-04が含まれる", function () {
  assert.ok(
    this.modeResult.reasons.some((reason: string) => reason.includes("Q-04")),
  );
});

Given("quickとして開始した変更fileが{string}である", function (files: string) {
  this.changedFiles = files.split(",");
});
When("quick不適格要因を検査する", function () {
  this.disqualifiers = detectQuickDisqualifiers(this.changedFiles);
});
Then("不適格要因は{string}である", function (expected: string) {
  assert.deepEqual([...this.disqualifiers].sort(), expected.split(",").sort());
});
Then("不適格要因は空である", function () {
  assert.deepEqual(this.disqualifiers, []);
});

Given("issue titleが{string}である", function (title: string) {
  this.title = title.replace("<NUL>", "\u0000").replace("<RLO>", "\u202e");
});
When("安全なslugへ変換する", function () {
  try {
    this.value = safeSlug(this.title);
  } catch (error) {
    this.error = error;
  }
});
Then("title検証は失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("slugは{string}である", function (slug: string) {
  assert.equal(this.value, slug);
});

Given("containment rootと{string}がある", function (candidate: string) {
  this.root = this.temp();
  this.candidate = candidate;
});
When("contained pathを解決する", function () {
  try {
    this.value = resolveContained(this.root, this.candidate);
  } catch (error) {
    this.error = error;
  }
});
Then("path検証は失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Given("containment root内のsymlinkがroot外を指す", function () {
  this.root = this.temp();
  this.outside = this.temp();
  fs.symlinkSync(this.outside, path.join(this.root, "link"));
});
When("symlink配下の未作成fileを解決する", function () {
  try {
    this.value = resolveContained(this.root, "link/file", {
      allowMissingLeaf: true,
    });
  } catch (error) {
    this.error = error;
  }
});

Given("診断文字列にGitHub tokenとBearer credentialが含まれる", function () {
  this.originalCredentials = [
    "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    "abc.def.ghi",
  ];
  this.diagnostic = `token=${this.originalCredentials[0]} Authorization: Bearer ${this.originalCredentials[1]}`;
});
When("secret redactionを行う", function () {
  this.value = redactSecrets(this.diagnostic);
});
Then("診断文字列に元のcredentialは残らない", function () {
  assert.equal(typeof this.value, "string");
  const redacted = this.value as string;
  for (const secret of this.originalCredentials)
    assert.equal(redacted.includes(secret), false);
});
Given("secret tokenを引数に持つ失敗commandがある", function () {
  this.processSecret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
});
When("process境界でcommandを実行する", function () {
  try {
    run(
      process.execPath,
      ["-e", "process.exit(7)", "--", `token=${this.processSecret}`],
      process.cwd(),
    );
  } catch (error) {
    this.error = error;
  }
});
Then("process errorに元のtokenは残らない", function () {
  assert.ok(this.error instanceof Error);
  assert.equal(this.error.message.includes(this.processSecret), false);
});
Then("process errorには伏字が含まれる", function () {
  assert.ok(this.error instanceof Error);
  assert.ok(this.error.message.includes("[REDACTED"));
});

Given("round 1の肯定・敵対rubric、test、specがすべてpassである", function () {
  this.review = reviewBase();
});
Given("開発考慮事項を欠く完全なreviewがある", function () {
  this.review = reviewBase();
  this.review.developmentConsiderations = undefined;
});
Given("findingは0件である", function () {
  this.review.findings = [];
});
Given(
  "{word}の{word}が未評価である",
  function (perspective: string, item: string) {
    assert.ok(perspective === "affirmative" || perspective === "adversarial");
    this.review[perspective][item] = undefined;
  },
);
Given("完全なreviewにMediumとLowのvalid findingがある", function () {
  this.review = reviewBase();
  this.review.findings = [
    { id: "M1", severity: "Medium", status: "valid", evidence: "minor" },
    { id: "L1", severity: "Low", status: "valid", evidence: "style" },
  ];
});
Given(
  "完全なreviewにHighのvalid finding {string}がある",
  function (id: string) {
    this.review = reviewBase();
    this.review.findings = [
      { id, severity: "High", status: "valid", evidence: "risk" },
    ];
  },
);
Given("round 3のfinding分類が{string}である", function (status: string) {
  this.review = reviewBase();
  this.review.round = 3;
  this.review.focus = {
    unresolvedBlocking: ["H1"],
    fixedDiff: ["src/x.ts"],
    adjacentScope: [],
    fullRescan: false,
  };
  this.review.findings = [
    { id: "H1", severity: "High", status, evidence: "risk" },
  ];
});
Given("review roundが{int}である", function (round: number) {
  this.review = reviewBase();
  this.review.round = round;
});
Given("完全なreviewに未知の状態と重大度を持つfindingがある", function () {
  this.review = reviewBase();
  this.review.findings = [
    { id: "X1", severity: "Urgent", status: "mystery", evidence: "risk" },
  ];
});
Given("完全なreviewに人間が条件付き受容したHigh findingがある", function () {
  this.review = reviewBase();
  this.review.findings = [
    {
      id: "H1",
      severity: "High",
      status: "valid",
      evidence: "risk",
      riskAcceptance: {
        authority: "human",
        owner: "project-owner",
        reason: "必須要件と事業期限を比較して受容した",
        reviewCondition: "2026-09-30または前提変更時",
      },
    },
  ];
});
Given("round 2のreviewが全範囲再走査を要求している", function () {
  this.review = reviewBase();
  this.review.round = 2;
  this.review.focus = {
    unresolvedBlocking: ["H1"],
    fixedDiff: ["src/x.ts"],
    adjacentScope: [],
    fullRescan: true,
  };
  this.review.findings = [
    { id: "H1", severity: "High", status: "resolved", evidence: "修正済み" },
  ];
});
Given("完全なreviewに理由なしのnot-applicableがある", function () {
  this.review = reviewBase();
  this.review.affirmative.value = "not-applicable";
});
Given(
  "H_implの後にreview artifactだけを追加したH_finalの完全なreviewがある",
  function () {
    this.review = reviewBase();
  },
);
Given(
  "有効なPhase A review evidenceの{word}を改竄する",
  function (attribute: string) {
    this.review = reviewBase();
    const other = "f".repeat(40);
    if (attribute === "same-head")
      this.review.candidateEvidence.finalCommitSha = H_IMPL;
    if (attribute === "ancestry")
      this.review.candidateEvidence.implementationIsAncestor = false;
    if (attribute === "changed-path")
      this.review.candidateEvidence.changedPaths.push("src/domain/review.ts");
    if (attribute === "artifact-sha")
      this.review.candidateEvidence.artifact.sha256 = "bad";
    if (attribute === "blob-oid")
      this.review.candidateEvidence.artifact.blobOid = "bad";
    if (attribute === "pr-head")
      this.review.externalEvidence.pr.headSha = other;
    if (attribute === "source")
      this.review.externalEvidence.provenance.source = "file";
    if (attribute === "repository")
      this.review.externalEvidence.ci.repository = "x/r";
    if (attribute === "implementation-sha")
      this.review.externalEvidence.implementation.commitSha = other;
    if (attribute === "implementation-author")
      this.review.externalEvidence.implementation.authorActorId = null;
    if (attribute === "pr-id")
      this.review.externalEvidence.review.prNumber = 999;
    if (attribute === "run-id") this.review.externalEvidence.ci.runId = "999";
    if (attribute === "review-id")
      this.review.externalEvidence.review.reviewId = "";
    if (attribute === "ci-head")
      this.review.externalEvidence.ci.headSha = other;
    if (attribute === "ci-event")
      this.review.externalEvidence.ci.event = "push";
    if (attribute === "run-pr")
      this.review.externalEvidence.ci.pullRequestNumbers = [999];
    if (attribute === "empty-run-pr")
      this.review.externalEvidence.ci.pullRequestNumbers = [];
    if (attribute === "ci-conclusion")
      this.review.externalEvidence.ci.conclusion = "failure";
    if (attribute === "reviewer-commit")
      this.review.externalEvidence.review.commitSha = other;
    if (attribute === "reviewer-actor")
      this.review.externalEvidence.review.actorId = "unstable actor name";
    if (attribute === "pr-author-review")
      this.review.externalEvidence.review.actorId =
        this.review.externalEvidence.pr.authorActorId;
    if (attribute === "implementer-review")
      this.review.externalEvidence.review.actorId =
        this.review.externalEvidence.implementation.authorActorId;
    if (attribute === "submitted-at")
      this.review.externalEvidence.review.submittedAt = "sometime";
    if (attribute === "verdict")
      this.review.externalEvidence.review.verdict = "commented";
  },
);
When("review gateを評価する", function () {
  try {
    this.reviewResult = evaluateReview(
      this.review as Parameters<typeof evaluateReview>[0],
    );
  } catch (error) {
    this.error = error;
  }
});
Then("reviewはapprovedである", function () {
  assert.equal(this.reviewResult.approved, true);
});
Then("reviewはrejectedである", function () {
  assert.equal(this.reviewResult.approved, false);
});
Then(/^reviewはrejectedであり(.+)を返す$/u, function (diagnostic: string) {
  assert.equal(this.reviewResult.approved, false);
  assert.ok(
    this.reviewResult.errors.some((error: string) =>
      error.includes(diagnostic),
    ),
    this.reviewResult.errors.join("; "),
  );
});
Given("tracked Phase A review recordを読む", function () {
  this.phaseAReview = fs.readFileSync(
    ".agent-skill-chain/templates/issue/04_レビュー.md",
    "utf8",
  );
});
When("Phase A artifactのimmutable契約を検査する", function () {
  this.phaseAContractInspected = true;
});
Then(
  "H_final後は更新せず外部attestationだけで完了すると明記されている",
  function () {
    assert.match(this.phaseAReview, /H_final後[^。]*更新しない/u);
    assert.match(this.phaseAReview, /完了[^。]*外部attestation/u);
  },
);
Then("blocking findingは0件である", function () {
  assert.equal(this.reviewResult.blocking.length, 0);
});
Then("blocking findingは{string}である", function (id: string) {
  assert.deepEqual(this.reviewResult.blocking, [id]);
});
Then("review評価は例外で停止する", function () {
  assert.ok(this.error instanceof Error);
});

Given("package default policyを読み込む", function () {
  this.policy = JSON.parse(
    fs.readFileSync(".agent-skill-chain/policy/default.json", "utf8"),
  ) as unknown as MutablePolicyFixture;
});
Given("merge policyの{word}をtrueにする", function (operation: string) {
  this.policy.merge[operation] = true;
});
Given("merge modeを{string}にする", function (mode: string) {
  this.policy.merge.mode = mode;
});
Given("policyへ未知fieldと不正な配列値を混入する", function () {
  this.policy.unknown = true;
  this.policy.delivery.unknown = true;
  this.policy.merge.unknown = true;
  this.policy.merge.branches = [123];
  this.policy.merge.methods = ["octopus"];
  this.policy.merge.requiredChecks = ["ci", "ci"];
  this.policy.merge.requiredReviews = 21;
});
When("policyを検証する", function () {
  this.policyValidation = validatePolicy(this.policy);
  this.validationOutcome = this.policyValidation;
});
Then("policyはvalidである", function () {
  assert.equal(this.policyValidation.valid, true);
});
Then("policyはinvalidである", function () {
  assert.equal(this.validationOutcome?.valid, false);
});
Then("delivery stopはpull_requestである", function () {
  assert.equal(this.policy.delivery.stopAt, "pull_request");
});
Then("merge modeはdisabledである", function () {
  assert.equal(this.policy.merge.mode, "disabled");
});
Then("policy schema逸脱をすべて報告する", function () {
  for (const fragment of [
    "unknown",
    "branches",
    "methods",
    "requiredChecks",
    "requiredReviews",
  ])
    assert.ok(
      this.policyValidation.errors.some((error: string) =>
        error.includes(fragment),
      ),
      fragment,
    );
});

Given("v0.3 package assetを走査する", function () {
  this.packageScanned = true;
});
Given("runtime sourceを走査する", function () {
  this.sourceFiles = runtimeFiles();
});
When("skill contractを数える", function () {
  this.skills = fs
    .readdirSync(".agent-skill-chain/skills", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("step-"))
    .map((entry) => entry.name)
    .sort();
});
Then("Step 0〜11が重複なくすべて存在する", function () {
  assert.equal(this.skills.length, 12);
  for (let index = 0; index <= 11; index += 1)
    assert.equal(
      this.skills.filter((name: string) =>
        name.startsWith(`step-${String(index).padStart(2, "0")}-`),
      ).length,
      1,
    );
});
When("gh process callの所在を検査する", function () {
  this.offenders = this.sourceFiles
    .filter(
      (file: string) => file !== path.join("src", "adapters", "github.ts"),
    )
    .filter((file: string) =>
      /(?:run|spawnSync|execFileSync)\s*\(\s*['"]gh['"]/.test(
        fs.readFileSync(file, "utf8"),
      ),
    );
});
Then("GitHub adapter以外の違反fileは0件である", function () {
  assert.deepEqual(this.offenders, []);
});
When("legacy runtime importを検査する", function () {
  this.offenders = this.sourceFiles.filter((file: string) =>
    /from\s+['"][^'"]*(?:\.workflow|\.agents|archive)/.test(
      fs.readFileSync(file, "utf8"),
    ),
  );
});
Then("legacy import違反fileは0件である", function () {
  assert.deepEqual(this.offenders, []);
});
When("ADR実装assetを検査する", function () {
  this.adrAssets = [
    "src/domain/adr.ts",
    ".agent-skill-chain/templates/adr",
  ].filter((file) => fs.existsSync(file));
});
Then("ADR domain、template、CLI、gateは存在しない", function () {
  assert.deepEqual(this.adrAssets, []);
});
When("固定の人向けMarkdown file名を検査する", function () {
  const roots = [
    ".agent-skill-chain/docs",
    ".agent-skill-chain/policy",
    ".agent-skill-chain/schemas",
    ".agent-skill-chain/templates/common",
    ".agent-skill-chain/templates/issue",
    ".agent-skill-chain/templates/specs",
    "docs/specs",
  ];
  this.nameOffenders = [".agent-skill-chain/00_利用案内.md"]
    .filter(
      (file) =>
        !/^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}].*\.md$/u.test(
          path.basename(file),
        ),
    )
    .concat(
      roots.flatMap((root) =>
        fs
          .readdirSync(root, { recursive: true, withFileTypes: true })
          .flatMap((entry) => {
            const name = entry.name;
            if (entry.isDirectory())
              return !/^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
                name,
              )
                ? [path.join(entry.parentPath, name)]
                : [];
            if (entry.isFile() && name.endsWith(".md"))
              return !/^\d{2}_[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}].*\.md$/u.test(
                name,
              )
                ? [path.join(entry.parentPath, name)]
                : [];
            return [];
          }),
      ),
    );
});
Then("連番付き日本語file名の違反は0件である", function () {
  assert.deepEqual(this.nameOffenders, []);
});
When("規範文書の配置を検査する", function () {
  this.rootNormative = [
    "AGENTS.md",
    "POLICY.md",
    "QUALITY.md",
    "WORKFLOW.md",
  ].filter((file) => fs.existsSync(file));
  this.namespaceNormative = fs
    .readdirSync(".agent-skill-chain/docs")
    .filter((name) => name.endsWith(".md"));
});
Then("repository直下の規範文書はAGENTSだけである", function () {
  assert.deepEqual(this.rootNormative, ["AGENTS.md"]);
});
Then("namespace配下に連番付き規範文書が3件ある", function () {
  assert.equal(this.namespaceNormative.length, 3);
  assert.ok(
    this.namespaceNormative.every((name: string) =>
      /^\d{2}_.+\.md$/u.test(name),
    ),
  );
});
Given("英語だけの人向けMarkdownがある", function () {
  this.root = this.temp();
  fs.writeFileSync(
    path.join(this.root, "AGENTS.md"),
    "---\nname: machine-readable-name\ndescription: This description contains only English prose for people.\n---\n\n# 日本語文書\n",
  );
});
Given("英語descriptionをblock scalarへ隠したMarkdownがある", function () {
  this.root = this.temp();
  fs.writeFileSync(
    path.join(this.root, "AGENTS.md"),
    "---\nname: machine-readable-name\ndescription: >\n  This description contains only English prose for people.\n---\n\n# 日本語文書\n",
  );
});
When("日本語文書形式検査を実行する", function () {
  this.documentCheck = spawnSync(
    "npx",
    ["--import", "tsx", "scripts/check_japanese_docs.ts", this.root],
    { cwd: process.cwd(), encoding: "utf8" },
  );
});
Then("日本語文書形式検査は失敗する", function () {
  assert.notEqual(this.documentCheck.status, 0);
  assert.ok(this.documentCheck.stderr.includes("日本語"));
});
Then("block scalar回避として拒否される", function () {
  assert.notEqual(this.documentCheck.status, 0);
  assert.match(this.documentCheck.stderr, /block scalar/u);
});
When("project選択層とfalse block対応の文書契約を検査する", function () {
  this.traceTemplate = fs.readFileSync(
    ".agent-skill-chain/templates/specs/15_要件追跡/00_追跡表.md",
    "utf8",
  );
  this.operationsSpec = fs.readFileSync(
    "docs/specs/12_運用保守/00_運用設計.md",
    "utf8",
  );
});
Then(
  "全test layerは層ごとに追跡されnon-override denyは弱化されない",
  function () {
    for (const fragment of [
      "projectChoices.testLayers",
      "全層",
      "1層1行",
      "固定の層名",
    ])
      assert.ok(this.traceTemplate.includes(fragment), fragment);
    for (const fragment of [
      "non-override deny",
      "弱めず",
      "fail closed",
      "独立review",
    ])
      assert.ok(this.operationsSpec.includes(fragment), fragment);
  },
);

Given("package所有runtimeと変更済みtemplateを走査する", function () {
  this.packageRuntime = runtimeFiles();
  this.auditedMermaidTemplates = [
    ".agent-skill-chain/templates/specs/03_アーキテクチャ/00_全体構成.md",
    ".agent-skill-chain/templates/specs/03_アーキテクチャ/01_システムコンテキスト.md",
    ".agent-skill-chain/templates/specs/03_アーキテクチャ/02_配置・依存.md",
    ".agent-skill-chain/templates/specs/04_機能/01_個別機能テンプレート.md",
    ".agent-skill-chain/templates/specs/04_機能/02_状態遷移.md",
    ".agent-skill-chain/templates/specs/05_画面/01_画面遷移.md",
    ".agent-skill-chain/templates/specs/06_外部インターフェース/02_個別APIテンプレート.md",
    ".agent-skill-chain/templates/specs/07_データ/03_ライフサイクル.md",
    ".agent-skill-chain/templates/specs/08_バッチ・ジョブ/01_個別ジョブテンプレート.md",
    ".agent-skill-chain/templates/specs/09_基盤・ネットワーク/01_論理ネットワーク.md",
    ".agent-skill-chain/templates/specs/09_基盤・ネットワーク/02_物理・配備構成.md",
    ".agent-skill-chain/templates/specs/09_基盤・ネットワーク/03_データフロー.md",
  ];
});
When("repository固有IDと固定表示labelを検査する", function () {
  this.packageBoundaryOffenders = this.packageRuntime.filter((file: string) =>
    fs.readFileSync(file, "utf8").includes("ASC-DOGFOOD-"),
  );
  const fixedLabels =
    /\b(?:Actor|Application|Domain|Adapter|External|Client|Service|Store|Pending|Completed|Denied|ScreenA|ScreenB|SafeResult|Caller|Dependency|Create|Validate|Use|Archive|Delete|Trigger|Guard|Process|Verify|Finish|RegionA|ZoneA|ZoneB|ServiceA|ServiceB|Source|Validation|Processing|Destination)\b/u;
  this.templateBoundaryOffenders = this.auditedMermaidTemplates.filter(
    (file: string) =>
      fixedLabels.test(
        fs.readFileSync(file, "utf8").split("```mermaid")[1]?.split("```")[0] ??
          "",
      ),
  );
});
Then("汎用packageの所有境界違反は0件である", function () {
  assert.deepEqual(this.packageBoundaryOffenders, []);
  assert.deepEqual(this.templateBoundaryOffenders, []);
});

Given("review templateとPR事前確認を読む", function () {
  this.reviewTemplate = fs.readFileSync(
    ".agent-skill-chain/templates/issue/04_レビュー.md",
    "utf8",
  );
  this.prChecklist = fs.readFileSync(
    ".agent-skill-chain/templates/issue/11_プルリクエスト事前確認.md",
    "utf8",
  );
});
When("全変更file監査契約を検査する", function () {
  this.fileAuditContract = `${this.reviewTemplate}\n${this.prChecklist}`;
});
Then("1ファイル1行と差分path集合完全一致が必須である", function () {
  for (const fragment of [
    "1ファイル1行",
    "path集合",
    "完全一致",
    "owner",
    "target layer",
    "依存方向",
    "個別判定",
  ])
    assert.ok(this.fileAuditContract.includes(fragment), fragment);
});

Given("H_implの全変更pathと一致する個別監査artifactがある", function () {
  this.root = this.initRepo();
  this.auditBase = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
  fs.mkdirSync(path.join(this.root, "src"));
  fs.writeFileSync(
    path.join(this.root, "src", "x.ts"),
    "export const x = 1;\n",
  );
  spawnSync("git", ["add", "src/x.ts"], { cwd: this.root });
  spawnSync("git", ["commit", "-q", "-m", "implementation"], {
    cwd: this.root,
  });
  this.auditImplementation = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
  fs.mkdirSync(path.join(this.root, "docs", "reviews"), { recursive: true });
  this.auditFile = path.join(
    this.root,
    "docs",
    "reviews",
    "08_課題836実装レビュー.md",
  );
  this.auditMarkdown = `# review\n\n## 0. レビュー識別情報\n\n| 項目 | 観測値 |\n|---|---|\n| 比較基点 | \`${this.auditBase}\` |\n| H_impl | \`${this.auditImplementation}\` |\n| ラウンド数 | 1 |\n| Step chain | 迂回: fixtureのため製品経路を通していない |\n| 仕様の所有箇所 | docs/specs/fixture.md:1「fixtureの仕様」 |\n| 成果物行数 | 製品 1行 / 支援層 2行 |\n| 縮小の先行評価 | 既存fixtureの流用では監査経路を通らないため |\n\n## 変更ファイル個別監査\n\n| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |\n|---|---|---|---|---|---|---|---|---|\n| \`src/x.ts\` | A | package owner | package | 単一責務 | 非循環 | SCN-X-001 | 削除でrollback | pass |\n`;
  fs.writeFileSync(this.auditFile, this.auditMarkdown);
  spawnSync("git", ["add", "docs/reviews/08_課題836実装レビュー.md"], {
    cwd: this.root,
  });
  spawnSync("git", ["commit", "-q", "-m", "review evidence"], {
    cwd: this.root,
  });
});
When("個別監査gateを正規表と余分なpathで検証する", function () {
  this.validAudit = checkFileAudit(this.root);
  fs.writeFileSync(
    this.auditFile,
    `${this.auditMarkdown}| \`extra.js\` | A | package owner | package | 単一責務 | 非循環 | SCN-X-002 | 削除でrollback | pass |\n`,
  );
  this.invalidAudit = checkFileAudit(this.root);
  fs.writeFileSync(
    this.auditFile,
    this.auditMarkdown.replace(this.auditBase, this.auditImplementation),
  );
  this.sameCommitAudit = checkFileAudit(this.root);
  const unrelated = spawnSync(
    "git",
    ["commit-tree", `${this.auditBase}^{tree}`, "-m", "unrelated audit base"],
    { cwd: this.root, encoding: "utf8" },
  ).stdout.trim();
  fs.writeFileSync(
    this.auditFile,
    this.auditMarkdown.replace(this.auditBase, unrelated),
  );
  this.nonAncestorAudit = checkFileAudit(this.root);
});
Then("正規表だけが合格し余分なpathと空差分基点は拒否される", function () {
  assert.equal(this.validAudit.valid, true, this.validAudit.errors.join("; "));
  assert.equal(this.invalidAudit.valid, false);
  assert.match(this.invalidAudit.errors.join(" "), /path集合/u);
  assert.equal(this.sameCommitAudit.valid, false);
  assert.match(this.sameCommitAudit.errors.join(" "), /異なるcommit/u);
  assert.equal(this.nonAncestorAudit.valid, false);
  assert.match(this.nonAncestorAudit.errors.join(" "), /ancestor/u);
});

Given("package metadataとpolicy version artifactがある", function () {
  this.packageMetadata = JSON.parse(
    fs.readFileSync("package.json", "utf8"),
  ) as unknown as PackageMetadataFixture;
  this.policySchema = JSON.parse(
    fs.readFileSync(
      ".agent-skill-chain/schemas/project-policy.schema.json",
      "utf8",
    ),
  ) as unknown as PolicySchemaFixture;
  this.defaultPolicy = JSON.parse(
    fs.readFileSync(".agent-skill-chain/policy/default.json", "utf8"),
  ) as unknown as MutablePolicyFixture;
});
When("version正本との一致を検証する", function () {
  this.releaseVersion = packageReleaseVersion(this.packageMetadata.version);
});
Then("製品は0.3.1 betaでpolicyはv0.3.0からv0.3.1へ移行する", function () {
  assert.equal(PACKAGE_VERSION, this.packageMetadata.version);
  assert.match(PACKAGE_VERSION, /^0\.3\.1-beta\./u);
  assert.equal(
    CURRENT_POLICY_SCHEMA_VERSION,
    `agent-skill-chain/project-policy/v${this.releaseVersion}`,
  );
  assert.deepEqual(COMPATIBLE_POLICY_SCHEMA_VERSIONS, [
    "agent-skill-chain/project-policy/v0.3.0",
  ]);
  assert.deepEqual(DEPRECATED_POLICY_SCHEMA_ALIASES, {
    "agent-skill-chain/project-policy/v0.3":
      "agent-skill-chain/project-policy/v0.3.0",
  });
  assert.deepEqual(
    this.policySchema.properties.schemaVersion.enum,
    SUPPORTED_POLICY_SCHEMA_VERSIONS,
  );
  assert.equal(this.defaultPolicy.schemaVersion, CURRENT_POLICY_SCHEMA_VERSION);
  const legacyAlias = validatePolicy({
    schemaVersion: "agent-skill-chain/project-policy/v0.3",
    delivery: { stopAt: "pull_request" },
    merge: {
      mode: "disabled",
      branches: [],
      methods: [],
      requiredChecks: [],
      requiredReviews: 0,
    },
  });
  assert.equal(legacyAlias.valid, true);
  assert.ok(legacyAlias.migration);
  assert.deepEqual(legacyAlias.migration.deprecatedAlias, {
    input: "agent-skill-chain/project-policy/v0.3",
    canonical: "agent-skill-chain/project-policy/v0.3.0",
  });
  for (const version of [
    "0.3.0",
    "0.3.1-beta.1",
    "0.3.1+build.7",
    "0.3.1-beta.1+build.7",
  ])
    assert.equal(isPackageVersion(version), true, version);
  for (const version of ["0.3.01", "0.3.1-01", "0.3.1-beta..1", "0.3.1+"])
    assert.equal(isPackageVersion(version), false, version);
  for (const version of ["0.3.0", "0.3.1"])
    assert.equal(isPolicySchemaPatchVersion(version), true, version);
  for (const version of ["0.3.01", "0.3.1-beta.1", "0.3"])
    assert.equal(isPolicySchemaPatchVersion(version), false, version);
  assert.equal(packageReleaseVersion("0.3.1+build.7"), "0.3.1");
});

Given("packageのStep skillとtemplate契約がある", function () {
  this.skillContractRoot = process.cwd();
  this.brokenSkillContractRoot = this.temp("asc-skill-contract-");
  this.omittedSkillContractRoot = this.temp("asc-skill-omission-");
  this.unroutedSkillContractRoot = this.temp("asc-skill-route-");
  this.blockScalarSkillContractRoot = this.temp("asc-skill-frontmatter-");
  this.missingVocabularyContractRoot = this.temp("asc-skill-vocabulary-");
  this.mixedVocabularyContractRoot = this.temp("asc-skill-mixed-vocabulary-");
  this.missingDomainGlossaryContractRoot = this.temp(
    "asc-skill-domain-glossary-",
  );
  fs.mkdirSync(
    path.join(this.brokenSkillContractRoot, ".agent-skill-chain/docs"),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(this.omittedSkillContractRoot, ".agent-skill-chain/docs"),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(this.unroutedSkillContractRoot, ".agent-skill-chain/docs"),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(this.blockScalarSkillContractRoot, ".agent-skill-chain/docs"),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(this.missingVocabularyContractRoot, ".agent-skill-chain/docs"),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(this.mixedVocabularyContractRoot, ".agent-skill-chain/docs"),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(
      this.missingDomainGlossaryContractRoot,
      ".agent-skill-chain/docs",
    ),
    { recursive: true },
  );
  for (const root of [
    this.brokenSkillContractRoot,
    this.omittedSkillContractRoot,
    this.unroutedSkillContractRoot,
    this.blockScalarSkillContractRoot,
    this.missingVocabularyContractRoot,
    this.mixedVocabularyContractRoot,
    this.missingDomainGlossaryContractRoot,
  ]) {
    fs.cpSync(
      ".agent-skill-chain/skills",
      path.join(root, ".agent-skill-chain/skills"),
      { recursive: true },
    );
    fs.cpSync(
      ".agent-skill-chain/templates",
      path.join(root, ".agent-skill-chain/templates"),
      { recursive: true },
    );
    fs.copyFileSync(
      ".agent-skill-chain/docs/01_開発ワークフロー.md",
      path.join(root, ".agent-skill-chain/docs/01_開発ワークフロー.md"),
    );
  }
});
When("正規契約とリンク切れ・対応漏れ・経路欠落契約を検証する", function () {
  this.validSkillContracts = checkSkillTemplateContracts(
    this.skillContractRoot,
  );
  const designSkill = path.join(
    this.brokenSkillContractRoot,
    ".agent-skill-chain/skills/step-05-design/SKILL.md",
  );
  fs.writeFileSync(
    designSkill,
    fs
      .readFileSync(designSkill, "utf8")
      .replace(
        "../../templates/issue/02_設計.md",
        "../../templates/issue/存在しない設計.md",
      ),
  );
  const planSkill = path.join(
    this.omittedSkillContractRoot,
    ".agent-skill-chain/skills/step-06-plan/SKILL.md",
  );
  fs.writeFileSync(
    planSkill,
    fs
      .readFileSync(planSkill, "utf8")
      .replace(
        "[03_実装計画.md](../../templates/issue/03_実装計画.md)",
        "`03_実装計画.md`",
      ),
  );
  const workflow = path.join(
    this.unroutedSkillContractRoot,
    ".agent-skill-chain/docs/01_開発ワークフロー.md",
  );
  fs.writeFileSync(
    workflow,
    fs
      .readFileSync(workflow, "utf8")
      .replace(
        "[step-07-design-review](../skills/step-07-design-review/SKILL.md)",
        "`step-07-design-review`",
      ),
  );
  const blockScalarSkill = path.join(
    this.blockScalarSkillContractRoot,
    ".agent-skill-chain/skills/step-05-design/SKILL.md",
  );
  fs.writeFileSync(
    blockScalarSkill,
    fs
      .readFileSync(blockScalarSkill, "utf8")
      .replace(/^description:.*$/mu, "description: >\n  設計を作成する"),
  );
  const vocabularyWorkflow = path.join(
    this.missingVocabularyContractRoot,
    ".agent-skill-chain/docs/01_開発ワークフロー.md",
  );
  fs.writeFileSync(
    vocabularyWorkflow,
    fs
      .readFileSync(vocabularyWorkflow, "utf8")
      .replace("| システム仕様書 |", "| 未定義成果物 |"),
  );
  const mixedRequest = path.join(
    this.mixedVocabularyContractRoot,
    ".agent-skill-chain/templates/issue/00_要求定義_full.md",
  );
  fs.writeFileSync(
    mixedRequest,
    fs
      .readFileSync(mixedRequest, "utf8")
      .replace("### 5.1 機能上の期待", "### 5.1 機能要求"),
  );
  const missingGlossary = path.join(
    this.missingDomainGlossaryContractRoot,
    ".agent-skill-chain/templates/specs/01_システム概要/02_用語・略語.md",
  );
  fs.writeFileSync(
    missingGlossary,
    fs
      .readFileSync(missingGlossary, "utf8")
      .replace("| 用語ID | 標準語 | 定義 | 種別 |", "| 用語 | 定義 |"),
  );
  this.brokenSkillContracts = checkSkillTemplateContracts(
    this.brokenSkillContractRoot,
  );
  this.omittedSkillContracts = checkSkillTemplateContracts(
    this.omittedSkillContractRoot,
  );
  this.unroutedSkillContracts = checkSkillTemplateContracts(
    this.unroutedSkillContractRoot,
  );
  this.blockScalarSkillContracts = checkSkillTemplateContracts(
    this.blockScalarSkillContractRoot,
  );
  this.missingVocabularyContracts = checkSkillTemplateContracts(
    this.missingVocabularyContractRoot,
  );
  this.mixedVocabularyContracts = checkSkillTemplateContracts(
    this.mixedVocabularyContractRoot,
  );
  this.missingDomainGlossaryContracts = checkSkillTemplateContracts(
    this.missingDomainGlossaryContractRoot,
  );
});
Then(
  "正規契約だけが合格しリンク切れ・対応漏れ・経路欠落は拒否される",
  function () {
    assert.equal(
      this.validSkillContracts.valid,
      true,
      this.validSkillContracts.errors.join("; "),
    );
    assert.equal(this.validSkillContracts.skills, 12);
    assert.equal(this.brokenSkillContracts.valid, false);
    assert.match(
      this.brokenSkillContracts.errors.join(" "),
      /テンプレート対応|リンク先/u,
    );
    assert.equal(this.omittedSkillContracts.valid, false);
    assert.match(
      this.omittedSkillContracts.errors.join(" "),
      /テンプレート対応/u,
    );
    assert.equal(this.unroutedSkillContracts.valid, false);
    assert.match(
      this.unroutedSkillContracts.errors.join(" "),
      /ワークフロー.*対応/u,
    );
    assert.equal(this.blockScalarSkillContracts.valid, false);
    assert.match(
      this.blockScalarSkillContracts.errors.join(" "),
      /block scalar/u,
    );
    assert.equal(this.missingVocabularyContracts.valid, false);
    assert.match(
      this.missingVocabularyContracts.errors.join(" "),
      /システム仕様書の定義/u,
    );
    assert.equal(this.mixedVocabularyContracts.valid, false);
    assert.match(
      this.mixedVocabularyContracts.errors.join(" "),
      /FR\/NFR責務/u,
    );
    assert.equal(this.missingDomainGlossaryContracts.valid, false);
    assert.match(
      this.missingDomainGlossaryContracts.errors.join(" "),
      /ドメイン用語台帳契約/u,
    );
  },
);

Given("packageのdirectory利用案内契約がある", function () {
  this.directoryGuideRoot = process.cwd();
  const copy = () => {
    const root = this.temp("asc-directory-guide-");
    fs.cpSync(".agent-skill-chain", path.join(root, ".agent-skill-chain"), {
      recursive: true,
    });
    fs.copyFileSync("AGENTS.md", path.join(root, "AGENTS.md"));
    return root;
  };
  this.missingDirectoryGuideRoot = copy();
  this.unknownDirectoryGuideRoot = copy();
  this.brokenDirectoryGuideRoot = copy();
});
When(
  "正規契約と入口欠落・未知directory・リンク切れ契約を検証する",
  function () {
    this.validDirectoryGuides = checkDirectoryGuides(this.directoryGuideRoot);
    fs.rmSync(
      path.join(
        this.missingDirectoryGuideRoot,
        ".agent-skill-chain/policy/00_利用案内.md",
      ),
    );
    fs.mkdirSync(
      path.join(
        this.unknownDirectoryGuideRoot,
        ".agent-skill-chain/templates/未説明",
      ),
    );
    fs.appendFileSync(
      path.join(
        this.brokenDirectoryGuideRoot,
        ".agent-skill-chain/00_利用案内.md",
      ),
      "\n[存在しない案内](templates/存在しない案内.md)\n",
    );
    this.missingDirectoryGuides = checkDirectoryGuides(
      this.missingDirectoryGuideRoot,
    );
    this.unknownDirectoryGuides = checkDirectoryGuides(
      this.unknownDirectoryGuideRoot,
    );
    this.brokenDirectoryGuides = checkDirectoryGuides(
      this.brokenDirectoryGuideRoot,
    );
  },
);
Then(
  "正規契約だけが合格し入口欠落・未知directory・リンク切れは拒否される",
  function () {
    assert.equal(
      this.validDirectoryGuides.valid,
      true,
      this.validDirectoryGuides.errors.join("; "),
    );
    assert.equal(this.missingDirectoryGuides.valid, false);
    assert.match(
      this.missingDirectoryGuides.errors.join(" "),
      /入口文書がありません/u,
    );
    assert.equal(this.unknownDirectoryGuides.valid, false);
    assert.match(
      this.unknownDirectoryGuides.errors.join(" "),
      /入口文書が未定義/u,
    );
    assert.equal(this.brokenDirectoryGuides.valid, false);
    assert.match(
      this.brokenDirectoryGuides.errors.join(" "),
      /link先がありません/u,
    );
  },
);

Given("npx lifecycleの公開契約がある", function () {
  this.validCliContractRoot = process.cwd();
  this.legacyCliContractRoot = this.temp("asc-cli-contract-");
  const files = [
    "package.json",
    ".agent-skill-chain/00_利用案内.md",
    "docs/specs/04_機能/01_ワークフローv0.3.md",
    "docs/specs/12_運用保守/00_運用設計.md",
    "docs/specs/13_移行・廃止/01_移行方針.md",
  ];
  for (const relative of files) {
    const destination = path.join(this.legacyCliContractRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(relative, destination);
  }
});
When("正規契約と旧aliasを公開した契約を検証する", function () {
  this.validCliContract = checkCliContract(this.validCliContractRoot);
  const guide = path.join(
    this.legacyCliContractRoot,
    ".agent-skill-chain/00_利用案内.md",
  );
  fs.writeFileSync(
    guide,
    fs
      .readFileSync(guide, "utf8")
      .replaceAll(
        "npx agent-skill-chain install",
        "npx agent-skill-chain init",
      ),
  );
  this.legacyCliContract = checkCliContract(this.legacyCliContractRoot);
});
Then("正規契約だけが合格し旧aliasの公開は拒否される", function () {
  assert.equal(
    this.validCliContract.valid,
    true,
    this.validCliContract.errors.join("; "),
  );
  assert.equal(this.validCliContract.commands, 4);
  assert.equal(this.legacyCliContract.valid, false);
  assert.match(this.legacyCliContract.errors.join(" "), /公開command|旧alias/u);
});

Given("repositoryの全feature fileとCucumber実行結果がある", function () {
  this.traceRoot = process.cwd();
  this.testLayers = ["unit", "integration", "e2e"];
  this.forbiddenFileSuffixes = [".test.js"];
});
When("Gherkin traceを検証する", function () {
  this.traceResult = validateScenarioTrace(
    collectProjectTrace(
      this.traceRoot,
      this.testLayers,
      this.forbiddenFileSuffixes,
    ),
    { layers: this.testLayers },
  );
});
Then("全scenarioに一意なSCN IDとGiven、When、Thenがある", function () {
  assert.equal(
    this.traceResult.errors.filter((error: string) =>
      /duplicate|missing/.test(error),
    ).length,
    0,
  );
});
Then("unit、integration、E2Eの各layerにscenarioがある", function () {
  for (const layer of ["unit", "integration", "e2e"])
    assert.ok(this.traceResult.layerCounts[layer] > 0);
});
Then("JavaScriptのNode test起票は0件である", function () {
  assert.deepEqual(this.traceResult.nodeTests, []);
});
Given("Whenが欠けたGherkin scenarioがある", function () {
  this.gherkin =
    "Feature: 日本語機能\nScenario: SCN-X-001 日本語scenario\n Given 日本語前提\n Then 日本語結果\n";
});
When("Gherkin構造を解析する", function () {
  this.parsed = parseProjectGherkin(this.gherkin);
});
Then("When不足を検出する", function () {
  assert.equal(this.parsed[0].steps.includes("when"), false);
});
Given("日本語keywordのGherkin scenarioがある", function () {
  this.gherkin =
    "機能: 日本語機能\nシナリオ: SCN-X-002 日本語scenario\n 前提 日本語前提\n もし 日本語操作\n ならば 日本語結果\n";
});
When("日本語方言でGherkin構造を解析する", function () {
  this.parsed = parseProjectGherkin(this.gherkin, "ja");
});
Then("canonical Given When Thenへ変換される", function () {
  assert.deepEqual(this.parsed[0].steps, ["given", "when", "then"]);
});
Given("空のtestLayersを持つcurrent project policyがある", function () {
  this.emptyLayersPolicy = JSON.parse(
    fs.readFileSync(".agent-skill-chain/policy/default.json", "utf8"),
  ) as unknown as MutablePolicyFixture;
  this.emptyLayersPolicy.projectChoices = {
    ...(JSON.parse(
      fs.readFileSync(
        ".agent-skill-chain/project/choices/development.json",
        "utf8",
      ),
    ) as unknown as Record<string, unknown>),
    testLayers: [],
  };
  this.choiceSchema = JSON.parse(
    fs.readFileSync(
      ".agent-skill-chain/schemas/project-choice.schema.json",
      "utf8",
    ),
  ) as unknown as ChoiceSchemaFixture;
});
When("current project policyを検証する", function () {
  this.policyValidation = validatePolicy(this.emptyLayersPolicy);
  this.validationOutcome = this.policyValidation;
});
Then("runtimeとschemaは空のtestLayersを拒否する", function () {
  assert.equal(this.policyValidation.valid, false);
  assert.match(this.policyValidation.errors.join(" "), /testLayers.*1件以上/u);
  assert.equal(this.choiceSchema.properties.testLayers.minItems, 1);
});
Given("同じSCN IDを持つ2つのGherkin scenarioがある", function () {
  const root = this.temp();
  this.traceRoot = root;
  this.featuresRoot = path.join(root, "test", "features");
  this.testLayers = ["unit", "integration", "e2e"];
  this.forbiddenFileSuffixes = [];
  for (const layer of ["unit", "integration", "e2e"])
    fs.mkdirSync(path.join(this.featuresRoot, layer), { recursive: true });
  fs.writeFileSync(
    path.join(this.featuresRoot, "unit", "x.feature"),
    "Feature: 日本語機能\nScenario: SCN-X-001 日本語一\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\nScenario: SCN-X-001 日本語二\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n",
  );
  fs.writeFileSync(
    path.join(this.featuresRoot, "integration", "x.feature"),
    "Feature: 日本語結合\nScenario: SCN-X-002 日本語結合\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n",
  );
  fs.writeFileSync(
    path.join(this.featuresRoot, "e2e", "x.feature"),
    "Feature: 日本語E2E\nScenario: SCN-X-003 日本語E2E\n Given 日本語前提\n When 日本語操作\n Then 日本語結果\n",
  );
});
Then("重複errorを検出する", function () {
  assert.ok(
    this.traceResult.errors.some((error: string) => error.includes("重複")),
  );
});
Given("projectがcomponentとjourneyのtest layerを選択する", function () {
  const root = this.temp();
  this.traceRoot = root;
  this.featuresRoot = path.join(root, "test", "features");
  this.testLayers = ["component", "journey"];
  for (const layer of this.testLayers) {
    fs.mkdirSync(path.join(this.featuresRoot, layer), { recursive: true });
    fs.writeFileSync(
      path.join(this.featuresRoot, layer, `${layer}.feature`),
      `Feature: configured layer\nScenario: SCN-${layer.toUpperCase()}-001 configured scenario\n Given configured precondition\n When configured action\n Then configured result\n`,
    );
  }
});
When("configured layerでGherkin traceを検証する", function () {
  this.traceResult = validateScenarioTrace(
    collectProjectTrace(this.traceRoot, this.testLayers, []),
    { layers: this.testLayers },
  );
});
Then("generic traceはfixed 3 layerを要求しない", function () {
  assert.equal(
    this.traceResult.valid,
    true,
    this.traceResult.errors.join("; "),
  );
  assert.deepEqual(Object.keys(this.traceResult.layerCounts), this.testLayers);
  assert.equal(JSON.stringify(this.traceResult).includes("unit"), false);
  assert.equal(JSON.stringify(this.traceResult).includes("integration"), false);
  assert.equal(JSON.stringify(this.traceResult).includes("e2e"), false);
});
Given("testLayersを持たないlegacy project policyとGherkinがある", function () {
  this.root = this.temp();
  fs.mkdirSync(path.join(this.root, ".agent-skill-chain"), { recursive: true });
  fs.writeFileSync(
    path.join(this.root, ".agent-skill-chain/project-policy.json"),
    `${JSON.stringify({ schemaVersion: "agent-skill-chain/project-policy/v0.3.0", delivery: { stopAt: "pull_request" }, merge: { mode: "disabled", branches: [], methods: [], requiredChecks: [], requiredReviews: 0 } })}\n`,
  );
  this.traceEvidence = path.join(this.root, "trace.json");
  fs.writeFileSync(
    this.traceEvidence,
    `${JSON.stringify({ adapter: "test", scenarios: [{ id: "SCN-LEGACY-001", title: "legacy", source: "legacy.feature", layer: "legacy", steps: ["given", "when", "then"] }], forbiddenFiles: [] })}\n`,
  );
});
When("trace CLIでlegacy policyを検証する", async function () {
  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  try {
    this.status = await main([
      "trace",
      "validate",
      `--root=${this.root}`,
      `--evidence=${this.traceEvidence}`,
    ]);
  } catch (error) {
    this.error = error;
  } finally {
    process.stdout.write = originalWrite;
  }
  this.stdout = stdout;
});
Then("project choice不足をstructured invalidとして返す", function () {
  assert.equal(this.error, undefined);
  assert.equal(this.status, 1);
  assert.match(this.stdout, /project policy/u);
});
Given("{word}を持つdependency graphがある", function (variant: string) {
  this.graph =
    variant === "cycle"
      ? {
          nodes: ["requirement", "design", "test"],
          edges: [
            { from: "requirement", to: "design" },
            { from: "design", to: "test" },
            { from: "test", to: "requirement" },
          ],
        }
      : variant === "self-loop"
        ? { nodes: ["review"], edges: [{ from: "review", to: "review" }] }
        : {
            nodes: ["requirement"],
            edges: [{ from: "requirement", to: "missing" }],
          };
});
When("dependency graphを検証する", function () {
  this.dependencyResult = traceDomain.validateDependencyGraph(
    this.graph.nodes,
    this.graph.edges,
  );
});
Then("dependency graphはcycle diagnostic付きでinvalidである", function () {
  assert.equal(this.dependencyResult.valid, false);
  assert.match(
    this.dependencyResult.errors.join(" "),
    /cycle|self-loop|unknown/u,
  );
});
Given("repository sourceのimport graphと循環反例がある", function () {
  const { nodes, edges } = collectTypeScriptDependencyGraph(process.cwd());
  this.sourceGraph = { nodes, edges };
  this.cyclicGraph = {
    nodes,
    edges: [...edges, { from: nodes[0], to: nodes[0] }],
  };
});
When("project hookのdependency graphを検証する", function () {
  this.sourceResult = traceDomain.validateDependencyGraph(
    this.sourceGraph.nodes,
    this.sourceGraph.edges,
  );
  this.cyclicResult = traceDomain.validateDependencyGraph(
    this.cyclicGraph.nodes,
    this.cyclicGraph.edges,
  );
});
Then("source graphは非循環で循環反例だけを拒否する", function () {
  assert.equal(
    this.sourceResult.valid,
    true,
    this.sourceResult.errors.join("; "),
  );
  assert.equal(this.cyclicResult.valid, false);
});
