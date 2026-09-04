import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildRuleCoverage,
  validateProjectRuleLedgerEntry,
  type RuleCoverageOrphan,
} from "../../src/domain/conformance.js";
import {
  checkFixedMarkdownNames,
  validateFixedMarkdownName,
} from "../../scripts/check_directory_guides.js";
import {
  compareTrustedPolicy,
  validateRule,
} from "../../src/domain/enforcement.js";
import {
  checkPackageDistributionBoundary,
  checkPackageManagerBoundary,
  checkQualityCiTriggers,
  checkRegistryPublishProhibition,
  checkRepositoryRuleLedger,
  type RepositoryRuleLedgerResult,
} from "../../scripts/check_conformance.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

/**
 * `checkRepositoryRuleLedger`の本体へ合成されている個別検査の宣言。
 *
 * **この集合と実際の合成を双方向で突き合わせる**（Issue #988）。片方向だと、
 * 合成行がrefactoringで落ちたときか、新しい検査が登録されないまま増えたときの
 * どちらかを見逃す。製品repositoryは違反を持たないため、合成から外しても
 * `conformance:check`はexit 0のままであり、実行結果からは検出できない。
 *
 * **配線の存在で回帰を検出する。** 個別検査それぞれに違反treeを作る案は、
 * `replicate`がrepository全体の複写とproject policy一式を要求するため、
 * 支援層の所要時間が成果物構築を上回る。
 */
const LEDGER_COMPOSED_CHECKS: readonly string[] = [
  "checkCanonicalDuplication",
  "checkCanonicalScopeAlignment",
  "checkDistributionGateReachability",
  "checkExecutionEntry",
  "checkLifecycleIgnore",
  "checkModeQuestionText",
  "checkNodeRuntimeAlignment",
  "checkPackageDistributionBoundary",
  "checkPackageManagerBoundary",
  "checkQualityCiPermissions",
  "checkQualityCiTriggers",
  "checkQualityCommands",
  "checkRegistryPublishProhibition",
  "checkReleaseJobDocumentation",
  "checkRequirementIdScheme",
  "checkTrustedPolicyBoundary",
  "checkTrustedScriptPinning",
  "checkWorkflowStepDocument",
  "checkWorktreeContract",
  "validateReviewExceptions",
];

/**
 * `checkRepositoryRuleLedger`の本体で`errors`へ合成されている検査名を実際に読む。
 *
 * **`errors.push(`の直後だけを見ない。** 1回の`push`へ複数の検査を並べる書き方が
 * 実在し、2件目以降を見落とす。本体全体からspread呼び出しを拾う。
 */
export function observeLedgerComposition(source: string): string[] {
  const start = source.indexOf("export function checkRepositoryRuleLedger");
  if (start < 0) return [];
  const end = source.indexOf("\nexport function ", start + 1);
  const body = end < 0 ? source.slice(start) : source.slice(start, end);
  return [
    ...new Set(
      [...body.matchAll(/\.\.\.((?:check|validate)\w+)\s*\(/gu)].map(
        (match) => match[1]!,
      ),
    ),
  ].sort();
}

function ruleFixture(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: "ASC-DOGFOOD-FIXTURE-001",
    purpose: "project rule構造を検証する",
    riskClass: "quality",
    scope: ["fixture"],
    enforcement: "require",
    activation: "active",
    owner: "fixture owner",
    targetLayer: "project",
    evidence: "fixture test evidence",
    remediation: "fixtureを修正する",
    overridePolicy: "bound",
    rollback: "fixtureを元へ戻す",
    ...overrides,
  };
}

type LedgerCoverage = ReturnType<typeof buildRuleCoverage>;

class ProjectRuleLedgerWorld extends WorkflowWorld {
  rules: unknown[] = [];
  ruleValidations: Array<ReturnType<typeof validateProjectRuleLedgerEntry>> =
    [];
  coverageInput: Parameters<typeof buildRuleCoverage>[0] | undefined =
    undefined;
  coverage: LedgerCoverage | undefined = undefined;
  markdownNames: string[] = [];
  markdownResults: string[][] = [];
  ledger: RepositoryRuleLedgerResult | undefined = undefined;
  fixtureRoot = "";
  boundaryErrors: string[] = [];
  fixedMarkdownErrors: string[] = [];
  runtimeRuleValidations: Array<ReturnType<typeof validateRule>> = [];
  metadataComparison: ReturnType<typeof compareTrustedPolicy> | undefined =
    undefined;
  /** trusted rule削除の判定結果（Issue #967）。 */
  retirementComparison: ReturnType<typeof compareTrustedPolicy> | undefined =
    undefined;
  /** npm公開禁止の強制点検査（Issue #1215）。 */
  registryRoots: string[] = [];
  registryResults: string[][] = [];
  retirementDiagnostics: ReturnType<typeof compareTrustedPolicy>["rejected"] =
    [];
  /** 適合性検査scriptの本体。 */
  ledgerSource = "";
  /** 本体から実際に読み取った合成済み検査名。 */
  composedChecks: string[] = [];
}

const { Given, When, Then } = stepDefinitions<ProjectRuleLedgerWorld>();

Given(
  "必須fieldだけのlegacy ruleと変更authorityを持つ拡張ruleがある",
  function () {
    this.rules = [
      ruleFixture(),
      ruleFixture({
        ruleId: "ASC-DOGFOOD-FIXTURE-002",
        packageDefault: "package側は値を固定しない",
        projectOverride: "fixture projectの値を使う",
        changeAuthority: "fixture project owner",
      }),
    ];
  },
);

When("project ruleの構造を検証する", function () {
  this.ruleValidations = this.rules.map((rule, index) =>
    validateProjectRuleLedgerEntry(rule, `rule[${index}]`),
  );
});

Then("後方互換を保ち拡張ruleの変更authorityも検証される", function () {
  assert.equal(this.ruleValidations.length, 2);
  assert.ok(this.ruleValidations.every((result) => result.valid));
  const invalid = validateProjectRuleLedgerEntry(
    ruleFixture({
      packageDefault: "package既定値",
      projectOverride: "project上書き値",
      changeAuthority: "",
    }),
  );
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /changeAuthority/u);
});

Given("runtimeにもCIにもIDがないrule coverage入力がある", function () {
  this.coverageInput = {
    rules: [ruleFixture()],
    normativeText: "ASC-DOGFOOD-FIXTURE-001",
    schemaText: "",
    runtimeText: "",
    ciText: "",
  };
});

Given("policy未定義のrule IDを持つ規範文書がある", function () {
  this.coverageInput = {
    rules: [],
    normativeText: "ASC-DOGFOOD-NORMATIVE-ONLY-001",
    schemaText: "",
    runtimeText: "",
    ciText: "",
  };
});

Given("policy未定義のrule IDを持つCIがある", function () {
  this.coverageInput = {
    rules: [],
    normativeText: "",
    schemaText: "",
    runtimeText: "",
    ciText: "ASC-DOGFOOD-CI-ONLY-001",
  };
});

When("rule coverage matrixを構築する", function () {
  assert.ok(this.coverageInput);
  this.coverage = buildRuleCoverage(this.coverageInput);
});

function orphanReasons(orphans: RuleCoverageOrphan[] | undefined): string {
  return (orphans ?? []).map(({ reason }) => reason).join(" ");
}

Then("未検証ruleがorphanとして拒否される", function () {
  assert.match(orphanReasons(this.coverage?.orphans), /runtimeにもCIにも/u);
});

Then("規範だけのruleがorphanとして拒否される", function () {
  assert.match(orphanReasons(this.coverage?.orphans), /project policyに定義/u);
});

Then("CIだけの暗黙ruleがorphanとして拒否される", function () {
  assert.match(orphanReasons(this.coverage?.orphans), /CIだけ/u);
});

Given("連番または日本語名を欠く固定Markdown名がある", function () {
  this.markdownNames = ["仕様.md", "01_spec.md"];
});

Given("契約上の固定名称と未知の英語Markdown名がある", function () {
  this.markdownNames = ["AGENTS.md", "SKILL.md", "README.md", "POLICY.md"];
});

When("固定Markdown名を検証する", function () {
  this.markdownResults = this.markdownNames.map(validateFixedMarkdownName);
});

Then("すべての不正な固定Markdown名が拒否される", function () {
  assert.equal(this.markdownResults.length, 2);
  assert.ok(this.markdownResults.every((errors) => errors.length > 0));
});

Then("明示された固定名称だけが許可される", function () {
  assert.deepEqual(
    this.markdownResults.map((errors) => errors.length === 0),
    [true, true, true, false],
  );
});

Given(
  "metadataを省略したruleと有効・空文字列・非文字列のmetadataを持つruleがある",
  function () {
    const metadataFields = [
      "packageDefault",
      "projectOverride",
      "changeAuthority",
    ];
    this.rules = [
      ruleFixture(),
      ruleFixture({
        packageDefault: "package既定値",
        projectOverride: "project上書き値",
        changeAuthority: "project policy owner",
      }),
      ...metadataFields.map((field) =>
        ruleFixture({ [field]: `${field}の有効値` }),
      ),
      ...metadataFields.map((field) => ruleFixture({ [field]: "" })),
      ...metadataFields.map((field) => ruleFixture({ [field]: 1 })),
    ];
  },
);

Given("privateを持つpackage.jsonと持たないpackage.jsonがある", function () {
  /**
   * **npm registryへ公開しない強制点はnpm自身である。** `private: true`があると
   * npmは`EPRIVATE`でpublishを拒否する（dummy認証つきの実publishで観測した）。
   * ここが見るのは**その強制点が宣言され続けること**である（Issue #1215）。
   *
   * **`--dry-run`はこの拒否を通過する。** 実publishでしか観測できないため、
   * CIはfileの宣言だけを見る。
   */
  const withPrivate = this.temp("asc-registry-private-");
  fs.writeFileSync(
    path.join(withPrivate, "package.json"),
    JSON.stringify({ name: "x", private: true }, null, 2),
  );
  const withoutPrivate = this.temp("asc-registry-public-");
  fs.writeFileSync(
    path.join(withoutPrivate, "package.json"),
    JSON.stringify({ name: "x" }, null, 2),
  );
  this.registryRoots = [withPrivate, withoutPrivate];
});

When("npm公開禁止の強制点を検査する", function () {
  this.registryResults = this.registryRoots.map((root) =>
    checkRegistryPublishProhibition(root),
  );
});

Then("privateを持つ側だけを受理する", function () {
  assert.deepEqual(this.registryResults[0], []);
  assert.match(
    (this.registryResults[1] ?? []).join(" "),
    /package\.jsonのprivateがtrueではありません/u,
  );
});

Given(
  "trusted policyのproject ruleを候補側から取り除いた差分がある",
  function () {
    /**
     * **trusted ruleの削除は受理されない。** 候補側から適用する経路は製品CLIに無く、
     * `policy migrate`も`compareTrustedPolicy`を互換性判定に使うため同じ理由で拒否する。
     * **利用者が「永久に廃止できない」と誤読しないよう、診断が経路の所在まで返す**
     * （Issue #967）。
     */
    const trustedRule = ruleFixture();
    const policy = (rules: unknown[]) => ({
      schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
      delivery: { stopAt: "pull_request" as const },
      merge: {
        mode: "disabled" as const,
        branches: [],
        methods: [],
        requiredChecks: [],
        requiredReviews: 1,
      },
      budgets: { localFeedbackMs: 120000, prGateMs: 900000 },
      rules,
    });
    this.retirementComparison = compareTrustedPolicy(
      policy([trustedRule]) as Parameters<typeof compareTrustedPolicy>[0],
      policy([]) as Parameters<typeof compareTrustedPolicy>[1],
    );
  },
);

When("trusted rule削除の判定結果を読む", function () {
  const comparison = this.retirementComparison;
  assert.ok(comparison);
  this.retirementDiagnostics = comparison.rejected;
});

Then("削除を拒否しauthorityと候補側経路の不在を診断へ返す", function () {
  assert.equal(this.retirementComparison?.allowed, false);
  const reasons = this.retirementDiagnostics.flatMap(
    (item: { reasons: string[] }) => item.reasons,
  );
  assert.ok(reasons.includes("trusted ruleを削除している"), reasons.join("; "));
  const next = this.retirementDiagnostics
    .map((item: { next: string }) => item.next)
    .join(" ");
  /**
   * **「既定ブランチへの正規migrationを行え」だけを返すと利用者を循環させる。**
   * その手段が製品内に無いためである。authorityと経路の不在を名指しする。
   */
  assert.match(next, /既定branchのproject policy owner/u);
  assert.match(next, /候補側から適用する経路は製品CLIにありません/u);
  assert.match(next, /manifestから外すだけでは受理されません/u);
  const authority = this.retirementDiagnostics
    .map((item: { requiredAuthority: string }) => item.requiredAuthority)
    .join(" ");
  assert.match(authority, /default branch policy owner/u);
});

When("runtimeでrule metadataとtrusted policy比較を検証する", function () {
  this.runtimeRuleValidations = this.rules.map(validateRule);
  const trustedRule = ruleFixture();
  const candidateRule = ruleFixture({
    packageDefault: "package既定値",
    projectOverride: "project上書き値",
    changeAuthority: "project policy owner",
  });
  const policy = (rule: unknown) => ({
    schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
    delivery: { stopAt: "pull_request" as const },
    merge: {
      mode: "disabled" as const,
      branches: [],
      methods: [],
      requiredChecks: [],
      requiredReviews: 1,
    },
    budgets: { localFeedbackMs: 120000, prGateMs: 900000 },
    rules: [rule],
  });
  this.metadataComparison = compareTrustedPolicy(
    policy(trustedRule) as Parameters<typeof compareTrustedPolicy>[0],
    policy(candidateRule) as Parameters<typeof compareTrustedPolicy>[1],
  );
});

Then(
  "metadata省略と有効値だけを許可しmetadata追加を意味変更として拒否しない",
  function () {
    assert.deepEqual(
      this.runtimeRuleValidations.map(({ valid }) => valid),
      [true, true, true, true, true, false, false, false, false, false, false],
    );
    const errors = this.runtimeRuleValidations
      .slice(5)
      .flatMap(({ errors: validationErrors }) => validationErrors)
      .join(" ");
    assert.doesNotMatch(errors, /未知field/u);
    assert.match(errors, /packageDefault/u);
    assert.match(errors, /projectOverride/u);
    assert.match(errors, /changeAuthority/u);
    assert.equal(
      this.metadataComparison?.allowed,
      true,
      JSON.stringify(this.metadataComparison),
    );
  },
);

Given("実repositoryのproject rule台帳がある", function () {
  this.fixtureRoot = process.cwd();
});

When("repository rule台帳conformanceを検証する", function () {
  this.ledger = checkRepositoryRuleLedger(this.fixtureRoot);
});

Then("全ruleがcoverageを持ちorphanは0件になる", function () {
  assert.ok(this.ledger);
  assert.equal(this.ledger.valid, true, this.ledger.errors.join("; "));
  assert.equal(this.ledger.coverage.orphans.length, 0);
  assert.equal(this.ledger.coverage.rows.length, this.ledger.rules.length);
  assert.ok(this.ledger.coverage.rows.every((row) => row.runtime || row.ci));
});

Given("pull requestとpushで重複発火する隔離品質CIがある", function () {
  this.fixtureRoot = this.temp("asc-ledger-ci-");
  const workflow = path.join(this.fixtureRoot, "ci.yml");
  fs.writeFileSync(workflow, "on:\n  pull_request:\n  push:\n");
});

When("隔離品質CIのtriggerを検証する", function () {
  this.boundaryErrors = checkQualityCiTriggers(
    fs.readFileSync(path.join(this.fixtureRoot, "ci.yml"), "utf8"),
  );
});

Then("pull request以外のtriggerが拒否される", function () {
  assert.match(this.boundaryErrors.join(" "), /push/u);
});

Given(
  "npmと別package managerのlockfileを持つ隔離repositoryがある",
  function () {
    this.fixtureRoot = this.temp("asc-ledger-package-manager-");
    fs.writeFileSync(path.join(this.fixtureRoot, "package-lock.json"), "{}\n");
    fs.writeFileSync(
      path.join(this.fixtureRoot, "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
    );
    const choices = path.join(
      this.fixtureRoot,
      ".agent-skill-chain/project/choices",
    );
    fs.mkdirSync(choices, { recursive: true });
    fs.writeFileSync(
      path.join(choices, "development.json"),
      `${JSON.stringify({ packageManager: "npm" })}\n`,
    );
    const workflows = path.join(this.fixtureRoot, ".github/workflows");
    fs.mkdirSync(workflows, { recursive: true });
    for (const name of ["ci.yml", "trusted-quality.yml", "release.yml"])
      fs.writeFileSync(path.join(workflows, name), "steps:\n  - run: npm ci\n");
  },
);

When("隔離repositoryのpackage manager境界を検証する", function () {
  this.boundaryErrors = checkPackageManagerBoundary(this.fixtureRoot);
});

Then("npm以外のlockfileが拒否される", function () {
  assert.match(this.boundaryErrors.join(" "), /pnpm-lock\.yaml/u);
});

Given("配布外project資産をfilesへ含めた隔離packageがある", function () {
  this.fixtureRoot = this.temp("asc-ledger-distribution-");
  fs.writeFileSync(
    path.join(this.fixtureRoot, "package.json"),
    `${JSON.stringify({ files: ["dist/", ".agent-skill-chain/project/", ".agent-skill-chain/role-log/", ".agent-skill-chain/metrics/"] })}\n`,
  );
});

When("隔離packageの配布境界を検証する", function () {
  this.boundaryErrors = checkPackageDistributionBoundary(this.fixtureRoot);
});

Then("project policyと実行記録の配布が拒否される", function () {
  const errors = this.boundaryErrors.join(" ");
  assert.match(errors, /project/u);
  assert.match(errors, /role-log/u);
  assert.match(errors, /metrics/u);
});

Given("実repositoryのproject rule台帳と固定Markdownがある", function () {
  this.fixtureRoot = process.cwd();
});

When("dogfooding境界を一括検証する", function () {
  this.ledger = checkRepositoryRuleLedger(this.fixtureRoot);
  this.fixedMarkdownErrors = checkFixedMarkdownNames(this.fixtureRoot);
});

Then("project ruleと固定Markdownの全境界が合格する", function () {
  assert.ok(this.ledger);
  assert.equal(this.ledger.valid, true, this.ledger.errors.join("; "));
  assert.deepEqual(this.fixedMarkdownErrors, []);
});

Given("適合性検査scriptの本体がある", function () {
  this.ledgerSource = fs.readFileSync(
    path.join(process.cwd(), "scripts/check_conformance.ts"),
    "utf8",
  );
});

When("公開入口へ合成されている個別検査を読む", function () {
  this.composedChecks = observeLedgerComposition(this.ledgerSource);
});

Then("宣言した個別検査がすべて合成されている", function () {
  const observed = new Set(this.composedChecks);
  const missing = LEDGER_COMPOSED_CHECKS.filter((name) => !observed.has(name));
  assert.deepEqual(
    missing,
    [],
    `公開入口のerrorsへ合成されていない個別検査があります: ${missing.join(", ")}`,
  );
});

Then("合成されている個別検査がすべて宣言されている", function () {
  const declared = new Set<string>(LEDGER_COMPOSED_CHECKS);
  const unregistered = this.composedChecks.filter(
    (name) => !declared.has(name),
  );
  assert.deepEqual(
    unregistered,
    [],
    `LEDGER_COMPOSED_CHECKSへ未登録の個別検査があります: ${unregistered.join(", ")}`,
  );
});
