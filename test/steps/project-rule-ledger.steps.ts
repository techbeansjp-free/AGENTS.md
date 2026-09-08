import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
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
  enforceOperation,
  resolveEffectivePolicy,
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
import type { Policy, Rule } from "../../src/types.js";
import {
  loadProjectPolicySet,
  loadProjectPolicySetAtCommit,
  loadEffectiveTrustedPolicySet,
  ruleFragmentSources,
  validatePolicy,
  validateProjectPolicyManifest,
  type PolicyManifest,
  type PolicySet,
} from "../../src/domain/policy.js";
import {
  planFileMigration,
  type MigrationState,
} from "../../src/domain/migration.js";
import { createPullRequest } from "../../src/domain/delivery.js";
import { conformingPullRequestBody } from "../support/world.js";

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
  retirementTrusted: Policy | undefined = undefined;
  retirementCandidate: Policy | undefined = undefined;
  retirementRaw = "";
  deliveryObservations: ReturnType<typeof observeDelivery>[] = [];
  retirementCases: Array<ReturnType<typeof compareTrustedPolicy>> = [];
  retirementSet: PolicySet | undefined = undefined;
  retirementFloor: Policy | undefined = undefined;
  retirementPlan: ReturnType<typeof planFileMigration> | undefined = undefined;
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

function retirementPolicy(rules: Rule[]): Policy {
  return {
    schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
    delivery: { stopAt: "pull_request" },
    merge: {
      mode: "disabled",
      branches: ["feature/*"],
      methods: ["merge"],
      requiredChecks: ["test"],
      requiredReviews: 1,
    },
    budgets: { localFeedbackMs: 120000, prGateMs: 900000 },
    rules,
  };
}

function retirementProposal(raw: string) {
  return {
    ruleId: "ASC-DOGFOOD-FIXTURE-001",
    beforeSha256: crypto.createHash("sha256").update(raw, "utf8").digest("hex"),
    reason: "利用しなくなったruleを廃止する",
    owner: "project owner",
  };
}

function compareRetirement(world: ProjectRuleLedgerWorld) {
  assert.ok(world.retirementTrusted);
  assert.ok(world.retirementCandidate);
  const options = {
    trustedRuleSources: [
      {
        ruleId: "ASC-DOGFOOD-FIXTURE-001",
        fragmentPath: "project/rules/fixture.json",
        raw: world.retirementRaw,
      },
    ],
  };
  return compareTrustedPolicy(
    world.retirementTrusted,
    world.retirementCandidate,
    options as Parameters<typeof compareTrustedPolicy>[2],
  );
}

Given("trusted fragmentとproject rule廃止提案がある", function () {
  const rule = ruleFixture() as Rule;
  this.retirementRaw = `${JSON.stringify(rule, null, 2)}\n`;
  this.retirementTrusted = Object.assign(retirementPolicy([rule]), {
    projectRuleRetirementProposals: [retirementProposal(this.retirementRaw)],
  });
  this.retirementCandidate = retirementPolicy([]);
});

When("承認対象のproject ruleを完全削除して比較する", function () {
  this.retirementComparison = compareRetirement(this);
});

When("trustedの廃止提案を撤回して削除を比較する", function () {
  assert.ok(this.retirementTrusted);
  this.retirementTrusted = retirementPolicy(this.retirementTrusted.rules);
  this.retirementComparison = compareRetirement(this);
});

When("candidate側だけに廃止提案を置いて削除を比較する", function () {
  assert.ok(this.retirementTrusted);
  this.retirementCandidate = Object.assign(retirementPolicy([]), {
    projectRuleRetirementProposals: [retirementProposal(this.retirementRaw)],
  });
  this.retirementTrusted = retirementPolicy(this.retirementTrusted.rules);
  this.retirementComparison = compareRetirement(this);
});

When("未承認ruleも同時に削除して比較する", function () {
  assert.ok(this.retirementTrusted);
  this.retirementTrusted.rules.push(
    ruleFixture({ ruleId: "ASC-DOGFOOD-FIXTURE-002" }) as Rule,
  );
  this.retirementComparison = compareRetirement(this);
});

Then("承認済みrule廃止のIDとpathと両SHAを返す", function () {
  assert.ok(
    this.retirementComparison?.allowed,
    JSON.stringify(this.retirementComparison),
  );
  assert.deepEqual(
    Reflect.get(this.retirementComparison, "acceptedRetirements"),
    [
      {
        ruleId: "ASC-DOGFOOD-FIXTURE-001",
        fragmentPath: "project/rules/fixture.json",
        proposedSha256: retirementProposal(this.retirementRaw).beforeSha256,
        observedSha256: retirementProposal(this.retirementRaw).beforeSha256,
      },
    ],
  );
});

Then("project rule削除をASC-TRUST-001で拒否する", function () {
  assert.equal(this.retirementComparison?.allowed, false);
  assert.ok(
    this.retirementComparison?.rejected.some(
      (item) => item.ruleId === "ASC-TRUST-001",
    ),
  );
});

Then("承認済みrule廃止を記録してもpolicy全体を拒否する", function () {
  assert.equal(this.retirementComparison?.allowed, false);
  assert.ok(this.retirementComparison);
  assert.equal(this.retirementComparison.rejected.length, 1);
  assert.equal(
    (Reflect.get(this.retirementComparison, "acceptedRetirements") as unknown[])
      .length,
    1,
  );
  const secondRule = this.retirementTrusted!.rules[1]!;
  const raw = JSON.stringify(secondRule);
  const trusted = structuredClone(this.retirementTrusted!);
  trusted.projectRuleRetirementProposals!.push({
    ...retirementProposal(raw),
    ruleId: secondRule.ruleId,
  });
  const result = compareTrustedPolicy(trusted, this.retirementCandidate!, {
    trustedRuleSources: [
      {
        ruleId: "ASC-DOGFOOD-FIXTURE-001",
        fragmentPath: "project/rules/fixture.json",
        raw: this.retirementRaw,
      },
      {
        ruleId: secondRule.ruleId,
        fragmentPath: "project/rules/second.json",
        raw,
      },
    ],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.acceptedRetirements.length, 2);
});

function malformedRetirementProposals(raw: string): unknown[] {
  const proposal = retirementProposal(raw);
  return [
    null,
    {},
    "proposal",
    [null],
    [{ ...proposal, extra: true }],
    ...["ruleId", "beforeSha256", "reason", "owner"].flatMap((key) => [
      [{ ...proposal, [key]: "" }],
      [{ ...proposal, [key]: 1 }],
      [{ ...proposal, [key]: undefined }],
    ]),
    [{ ...proposal, beforeSha256: proposal.beforeSha256.toUpperCase() }],
    [{ ...proposal, reason: " \t" }],
    [{ ...proposal, owner: "owner\u200b" }],
    [{ ...proposal, reason: "reason\n" }],
    [
      proposal,
      {
        owner: proposal.owner,
        reason: proposal.reason,
        beforeSha256: proposal.beforeSha256,
        ruleId: proposal.ruleId,
      },
    ],
    Array.from({ length: 17 }, (_, index) => ({
      ...proposal,
      reason: `reason ${index}`,
    })),
  ];
}

When("廃止提案とsourceの境界値を比較する", function () {
  const trusted = this.retirementTrusted!;
  const candidate = this.retirementCandidate!;
  const source = {
    ruleId: trusted.rules[0]!.ruleId,
    fragmentPath: "project/rules/fixture.json",
    raw: this.retirementRaw,
  };
  this.retirementCases = [
    undefined,
    [],
    [{ ...source, raw: `${source.raw} ` }],
    [{ ...source, ruleId: "ASC-OTHER" }],
    [source, source],
    [{ ...source, fragmentPath: "../rule.json" }],
  ].map((trustedRuleSources) =>
    compareTrustedPolicy(trusted, candidate, { trustedRuleSources }),
  );
  for (const proposals of malformedRetirementProposals(this.retirementRaw)) {
    const malformed = { ...trusted, projectRuleRetirementProposals: proposals };
    assert.equal(
      validatePolicy(malformed).valid,
      false,
      JSON.stringify(proposals),
    );
    this.retirementCases.push(
      compareTrustedPolicy(malformed as Policy, candidate, {
        trustedRuleSources: [source],
      }),
    );
  }
  const wrongId = {
    ...trusted,
    projectRuleRetirementProposals: [
      { ...retirementProposal(source.raw), ruleId: "ASC-OTHER" },
    ],
  };
  this.retirementCases.push(
    compareTrustedPolicy(wrongId, candidate, { trustedRuleSources: [source] }),
  );
  const oldAndNew = {
    ...trusted,
    projectRuleRetirementProposals: [
      { ...retirementProposal(source.raw), beforeSha256: "0".repeat(64) },
      retirementProposal(source.raw),
    ],
  };
  assert.equal(
    compareTrustedPolicy(oldAndNew, candidate, { trustedRuleSources: [source] })
      .allowed,
    true,
  );
});

Then("全不正入力を拒否して観測値またはsource欠落を返す", function () {
  for (const result of this.retirementCases) {
    assert.equal(result.allowed, false, JSON.stringify(result));
    assert.deepEqual(result.acceptedRetirements, []);
    assert.match(JSON.stringify(result.rejected), /source欠落|observedSha256/u);
  }
  const mismatch = JSON.stringify(this.retirementCases[2]!.rejected);
  assert.match(
    mismatch,
    new RegExp(retirementProposal(this.retirementRaw).beforeSha256, "u"),
  );
  assert.match(
    mismatch,
    new RegExp(retirementProposal(`${this.retirementRaw} `).beforeSha256, "u"),
  );
  assert.doesNotMatch(mismatch, /利用しなくなったrule|project owner/u);
});

When("提案対象ruleを残して部分弱化する", function () {
  this.retirementCases = [
    { scope: [] },
    { activation: "disabled" },
    { enforcement: "record" },
    { owner: "other" },
    { overridePolicy: "never" },
  ].map((change) => {
    this.retirementCandidate = retirementPolicy([ruleFixture(change) as Rule]);
    return compareRetirement(this);
  });
});

Then("部分弱化を拒否して承認済みrule廃止を返さない", function () {
  for (const result of this.retirementCases) {
    assert.equal(result.allowed, false);
    assert.deepEqual(result.acceptedRetirements, []);
  }
});

function writeRetirementSet(root: string, policy: Policy): PolicySet {
  const { rules, ...settings } = policy;
  const manifest: PolicyManifest = {
    schemaVersion: "agent-skill-chain/project-policy-manifest/v1",
    policy: settings,
    choiceFiles: ["project/choices/development.json"],
    ruleFiles: rules.map((_, index) => `project/rules/rule-${index}.json`),
    conformanceFiles: [],
    conformanceScope: "package-attested",
    conformanceDirectory: "project/conformance",
  };
  const base = path.join(root, ".agent-skill-chain");
  for (const dir of ["project/choices", "project/rules", "project/conformance"])
    fs.mkdirSync(path.join(base, dir), { recursive: true });
  const notApplicable = {
    status: "not-applicable",
    reason: "隔離CLI fixtureは当該機能を持たない",
    evidence: "project rule廃止の隔離fixture",
  };
  const choices = {
    language: "日本語",
    testRunner: "cucumber-js",
    gherkinDialect: "en",
    testLayers: ["unit", "integration"],
    forbiddenTestFileSuffixes: [],
    naming: "一意なSCN ID",
    packageManager: "npm",
    runtime: "Node.js",
    ci: "fixture check",
    release: "手動操作",
    projectKind: "cli",
    capabilities: {
      privacySecurity: {
        status: "applicable",
        reason: "trusted境界を検証する",
        evidence: "隔離fixture",
      },
      observability: notApplicable,
      humanCenteredUi: notApplicable,
      designTokens: notApplicable,
    },
    quality: {
      implementationLanguage: "TypeScript",
      strictTypecheck: true,
      forbiddenTypes: [],
      lintCommand: "fixture lint",
      formatCheckCommand: "fixture format",
      formatWriteCommand: "fixture format",
      typecheckCommand: "fixture types",
      runtimeValidation: "fixture validation",
      auxiliaryLanguages: {},
    },
  };
  fs.writeFileSync(
    path.join(base, manifest.choiceFiles[0]!),
    JSON.stringify(choices),
  );
  fs.writeFileSync(
    path.join(base, "project-policy.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  rules.forEach((rule, index) =>
    fs.writeFileSync(
      path.join(base, manifest.ruleFiles[index]!),
      `${JSON.stringify(rule, null, 2)}\n`,
    ),
  );
  return loadProjectPolicySet(root);
}

When("空project inventoryを読みpackage floorへ合成する", function () {
  this.retirementSet = writeRetirementSet(
    this.temp("asc-retired-empty-"),
    this.retirementCandidate!,
  );
  this.retirementFloor = JSON.parse(
    fs.readFileSync(".agent-skill-chain/policy/default.json", "utf8"),
  ) as Policy;
  assert.equal(validatePolicy(this.retirementSet.policy).valid, true);
  const trusted = resolveEffectivePolicy(
    this.retirementFloor,
    this.retirementTrusted!,
    { trusted: true },
  );
  assert.equal(trusted.valid, true);
  assert.deepEqual(
    trusted.policy.projectRuleRetirementProposals,
    this.retirementTrusted!.projectRuleRetirementProposals,
  );
  const effective = resolveEffectivePolicy(
    trusted.policy,
    this.retirementSet.policy,
    { packageFloor: this.retirementFloor },
  );
  assert.equal(effective.valid, true);
  this.retirementCandidate = effective.policy;
  assert.equal(effective.policy.projectRuleRetirementProposals, undefined);
  this.retirementComparison = compareTrustedPolicy(
    trusted.policy,
    effective.policy,
    {
      trustedRuleSources: [
        {
          ruleId: "ASC-DOGFOOD-FIXTURE-001",
          fragmentPath: "project/rules/fixture.json",
          raw: this.retirementRaw,
        },
      ],
    },
  );
});

Then(
  "package floorを保持し存在しないruleのoperationを拒否して復元できる",
  function () {
    assert.equal(
      this.retirementComparison?.allowed,
      true,
      JSON.stringify(this.retirementComparison),
    );
    assert.deepEqual(
      this.retirementCandidate!.rules,
      this.retirementFloor!.rules,
    );
    assert.equal(
      enforceOperation({
        policy: this.retirementCandidate!,
        ruleId: "ASC-DOGFOOD-FIXTURE-001",
        boundary: "fixture",
        violated: false,
      }).allowed,
      false,
    );
    const restored = resolveEffectivePolicy(
      this.retirementFloor!,
      this.retirementTrusted!,
      { trusted: true },
    );
    assert.equal(restored.valid, true);
    assert.ok(
      restored.policy.rules.some(
        (rule) => rule.ruleId === "ASC-DOGFOOD-FIXTURE-001",
      ),
    );
    assert.deepEqual(ruleFragmentSources(this.retirementSet!), []);
  },
);

When("既存rule差分を提案の有無で比較する", function () {
  const trusted = this.retirementTrusted!;
  for (const change of [
    {},
    { packageDefault: "metadata" },
    { activation: "disabled" },
    { scope: [] },
    { enforcement: "record" },
  ]) {
    const candidate = retirementPolicy([ruleFixture(change) as Rule]);
    const noProposal = retirementPolicy(trusted.rules);
    assert.deepEqual(
      compareTrustedPolicy(trusted, candidate),
      compareTrustedPolicy(noProposal, candidate),
    );
  }
  this.retirementCases = ["staged", "active"].map((activation) =>
    compareTrustedPolicy(
      trusted,
      retirementPolicy([
        ...trusted.rules,
        ruleFixture({ ruleId: "ASC-NEW-001", activation }) as Rule,
      ]),
    ),
  );
});

Then("追加と部分弱化とmetadataの既存判定は変わらない", function () {
  assert.deepEqual(
    this.retirementCases.map((result) => result.allowed),
    [true, false],
  );
});

When("隔離policy setのrule廃止migrationを計画する", function () {
  const root = this.temp("asc-retirement-migration-");
  const trusted = writeRetirementSet(root, this.retirementTrusted!);
  const candidate = writeRetirementSet(
    this.temp("asc-retirement-after-"),
    this.retirementCandidate!,
  );
  const entries = Object.entries(candidate.rawEntries).map(
    ([relative, after]) => ({
      kind: "policy" as const,
      path: `.agent-skill-chain/${relative}`,
      after,
    }),
  );
  this.retirementPlan = planFileMigration(root, trusted, candidate, entries);
  const revoked = structuredClone(trusted);
  delete revoked.policy.projectRuleRetirementProposals;
  const rejected = planFileMigration(root, revoked, candidate, entries);
  assert.equal(rejected.allowed, false, JSON.stringify(rejected));
  const sources = ruleFragmentSources(trusted);
  assert.equal(sources.length, 1);
  const missing = structuredClone(trusted);
  delete missing.rawEntries[sources[0]!.fragmentPath];
  assert.deepEqual(ruleFragmentSources(missing), []);
  const wrong = structuredClone(trusted);
  wrong.rules[0]!.ruleId = "ASC-OTHER";
  assert.deepEqual(ruleFragmentSources(wrong), []);
  const floor = JSON.parse(
    fs.readFileSync(".agent-skill-chain/policy/default.json", "utf8"),
  ) as Policy;
  const effectiveTrusted = resolveEffectivePolicy(floor, trusted.policy, {
    trusted: true,
  });
  assertDeliveryRetirement(
    { policy: effectiveTrusted.policy, packageFloor: floor },
    candidate,
    sources,
    "a".repeat(40),
  );
});

Then("migrationで承認済みrule廃止を返し提案撤回時は拒否する", function () {
  assert.ok(this.retirementPlan?.allowed, JSON.stringify(this.retirementPlan));
  assert.ok("compatibility" in this.retirementPlan);
  assert.equal(
    (this.retirementPlan as MigrationState).compatibility.acceptedRetirements
      .length,
    1,
  );
});

function deliveryRetirementInput(
  trusted: { policy: Policy; packageFloor: Policy },
  candidate: { policy: Policy },
  sources: ReturnType<typeof ruleFragmentSources>,
  headSha: string,
) {
  return {
    apply: false,
    issue: 1211,
    head: "feature/retire",
    base: "main",
    repository: "fixture/retirement",
    headSha,
    body: conformingPullRequestBody({
      title: "rule廃止",
      canonicalIssue: 1211,
    }),
    evidence: {
      headSha,
      review: { approved: true, headSha },
      tests: { passed: true, headSha, scenarioIds: ["SCN-INT-LEDGER-008"] },
      spec: {
        consistent: true,
        headSha,
        impact: "updated",
        trace: {
          requirements: ["REQ-SQ-004"],
          scenarios: ["SCN-INT-LEDGER-008"],
          tests: ["project-rule-ledger.feature"],
        },
      },
      ownership: { classified: true, owner: "project", targetLayer: "project" },
    },
    trustedPolicy: trusted.policy,
    candidatePolicy: candidate.policy,
    packageFloor: trusted.packageFloor,
    trustedRuleSources: sources,
  };
}

function assertDeliveryRetirement(
  trusted: { policy: Policy; packageFloor: Policy },
  candidate: { policy: Policy },
  sources: ReturnType<typeof ruleFragmentSources>,
  headSha: string,
) {
  const input = deliveryRetirementInput(trusted, candidate, sources, headSha);
  const revoked = structuredClone(trusted.policy);
  delete revoked.projectRuleRetirementProposals;
  const selfApproved = structuredClone(candidate.policy);
  selfApproved.projectRuleRetirementProposals =
    trusted.policy.projectRuleRetirementProposals;
  const noRemote = () => {
    throw new Error("実remoteを呼んではならない");
  };
  assert.equal(createPullRequest(input, noRemote).state, "preview");
  assert.throws(
    () => createPullRequest({ ...input, trustedRuleSources: [] }, noRemote),
    /trusted rule|ASC-TRUST/u,
  );
  assert.throws(
    () =>
      createPullRequest(
        { ...input, trustedPolicy: revoked, candidatePolicy: selfApproved },
        noRemote,
      ),
    /trusted rule|ASC-TRUST/u,
  );
}

When("隔離Gitの固定commitからrule廃止を検証する", function () {
  const root = this.initRepo();
  writeRetirementSet(root, this.retirementTrusted!);
  const base = path.join(root, ".agent-skill-chain");
  fs.mkdirSync(path.join(base, "policy"));
  fs.copyFileSync(
    ".agent-skill-chain/policy/default.json",
    path.join(base, "policy/default.json"),
  );
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git(["add", "."]);
  git(["commit", "-qm", "trusted proposal"]);
  const trustedSha = git(["rev-parse", "HEAD"]);
  git(["update-ref", "refs/remotes/origin/main", trustedSha]);
  const trusted = loadEffectiveTrustedPolicySet(root, "main");
  fs.unlinkSync(path.join(base, "project/rules/rule-0.json"));
  writeRetirementSet(root, this.retirementCandidate!);
  git(["add", "."]);
  git(["commit", "-qm", "retire rule"]);
  const headSha = git(["rev-parse", "HEAD"]);
  // 固定commit読取がworktree上のraw改変に依存しないことも検証する。
  fs.writeFileSync(
    path.join(base, "project-policy.json"),
    "invalid worktree JSON",
  );
  const candidate = loadProjectPolicySetAtCommit(root, headSha);
  const sources = ruleFragmentSources(trusted);
  const effective = resolveEffectivePolicy(trusted.policy, candidate.policy, {
    packageFloor: trusted.packageFloor,
  });
  this.retirementComparison = compareTrustedPolicy(
    trusted.policy,
    effective.policy,
    { trustedRuleSources: sources },
  );
  const selfApproved = structuredClone(candidate.policy);
  selfApproved.projectRuleRetirementProposals =
    this.retirementTrusted!.projectRuleRetirementProposals;
  const revoked = structuredClone(trusted.policy);
  delete revoked.projectRuleRetirementProposals;
  const candidateEffective = resolveEffectivePolicy(revoked, selfApproved, {
    packageFloor: trusted.packageFloor,
  });
  this.retirementCases = [
    compareTrustedPolicy(revoked, candidateEffective.policy, {
      trustedRuleSources: sources,
    }),
  ];
  assert.equal(
    candidateEffective.policy.projectRuleRetirementProposals,
    undefined,
  );
  assertDeliveryRetirement(trusted, candidate, sources, headSha);
});

Then(
  "trustedで先行登録した廃止だけが受理されcandidate自己承認は拒否される",
  function () {
    assert.equal(
      this.retirementComparison?.allowed,
      true,
      JSON.stringify(this.retirementComparison),
    );
    assert.equal(this.retirementComparison?.acceptedRetirements.length, 1);
    assert.equal(this.retirementCases[0]!.allowed, false);
    assert.deepEqual(this.retirementCases[0]!.acceptedRetirements, []);
  },
);

Given("project rule廃止の配布契約がある", function () {
  this.retirementRaw = JSON.stringify(ruleFixture());
});

interface ProposalSchemaContract {
  type: string;
  maxItems: number;
  uniqueItems: boolean;
  items: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, { type: string; pattern: string }>;
  };
}

When("schemaとruntimeと利用案内を照合する", function () {
  const read = (file: string) =>
    JSON.parse(
      fs.readFileSync(`.agent-skill-chain/schemas/${file}`, "utf8"),
    ) as { properties: Record<string, unknown> };
  const assembled = read("project-policy.schema.json");
  const manifest = read("project-policy-manifest.schema.json");
  const proposalSchema = assembled.properties
    .projectRuleRetirementProposals as ProposalSchemaContract;
  assert.deepEqual(
    (manifest.properties.policy as { properties: Record<string, unknown> })
      .properties.projectRuleRetirementProposals,
    proposalSchema,
  );
  assert.equal(proposalSchema.type, "array");
  assert.equal(proposalSchema.maxItems, 16);
  assert.equal(proposalSchema.uniqueItems, true);
  assert.equal(proposalSchema.items.type, "object");
  assert.equal(proposalSchema.items.additionalProperties, false);
  assert.deepEqual([...proposalSchema.items.required].sort(), [
    "beforeSha256",
    "owner",
    "reason",
    "ruleId",
  ]);
  for (const value of [
    retirementProposal(this.retirementRaw),
    {
      ...retirementProposal(this.retirementRaw),
      reason: "日本語",
      owner: "責任者",
    },
  ]) {
    for (const [key, field] of Object.entries(
      proposalSchema.items.properties,
    )) {
      assert.equal(field.type, "string");
      assert.match(
        value[key as keyof typeof value],
        new RegExp(field.pattern, "u"),
      );
    }
    assert.equal(
      validatePolicy({
        ...retirementPolicy([]),
        projectRuleRetirementProposals: [value],
      }).valid,
      true,
    );
  }
  for (const [key, invalid] of [
    ["ruleId", "ASC-lower"],
    ["beforeSha256", "A".repeat(64)],
    ["reason", " \t"],
    ["reason", "a\n"],
    ["owner", "a\u200b"],
  ]) {
    assert.doesNotMatch(
      invalid!,
      new RegExp(proposalSchema.items.properties[key!]!.pattern, "u"),
    );
  }
  assert.equal(
    (assembled.properties.rules as { minItems?: number }).minItems ?? 0,
    0,
  );
  assert.equal(
    (manifest.properties.ruleFiles as { minItems?: number }).minItems ?? 0,
    0,
  );
  const emptyManifest = {
    schemaVersion: "agent-skill-chain/project-policy-manifest/v1",
    policy: retirementPolicy([]),
    choiceFiles: ["project/choices/development.json"],
    ruleFiles: [],
    conformanceFiles: [],
    conformanceScope: "package-attested",
    conformanceDirectory: "project/conformance",
  };
  const { rules: omittedRules, ...settings } = emptyManifest.policy;
  assert.deepEqual(omittedRules, []);
  for (const proposals of malformedRetirementProposals(this.retirementRaw))
    assert.equal(
      validateProjectPolicyManifest({
        ...emptyManifest,
        policy: { ...settings, projectRuleRetirementProposals: proposals },
      }).valid,
      false,
    );
  assert.equal(
    validateProjectPolicyManifest({
      ...emptyManifest,
      policy: {
        ...settings,
        projectRuleRetirementProposals: [
          retirementProposal(this.retirementRaw),
        ],
      },
    }).valid,
    true,
  );
  this.ledgerSource = fs.readFileSync(
    ".agent-skill-chain/schemas/00_利用案内.md",
    "utf8",
  );
});

Then("宣言形式と二段階手順と撤回とrollbackが一致する", function () {
  const start = this.ledgerSource.indexOf("## project ruleの廃止");
  assert.ok(start >= 0);
  const guide = this.ledgerSource.slice(start);
  for (const term of [
    "projectRuleRetirementProposals",
    "beforeSha256",
    "ruleId",
    "reason",
    "owner",
    "sha256sum",
    "後続PR",
    "候補側",
    "撤回",
    "rollback",
    "raw UTF-8",
  ])
    assert.ok(guide.includes(term), term);
});

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
    // 提案なしの削除は拒否し、二段階の廃止経路を診断する。
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

Then("削除を拒否しauthorityと先行登録経路を診断へ返す", function () {
  assert.equal(this.retirementComparison?.allowed, false);
  const reasons = this.retirementDiagnostics.flatMap(
    (item: { reasons: string[] }) => item.reasons,
  );
  assert.match(reasons.join("; "), /trusted ruleを削除している/u);
  const next = this.retirementDiagnostics
    .map((item: { next: string }) => item.next)
    .join(" ");
  assert.match(next, /既定branchのproject policy owner/u);
  assert.match(next, /projectRuleRetirementProposals/u);
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

function deliveryFloorFixture() {
  const packageFloor = JSON.parse(
    fs.readFileSync(".agent-skill-chain/policy/default.json", "utf8"),
  ) as Policy;
  const rule = ruleFixture() as Rule;
  const raw = `${JSON.stringify(rule, null, 2)}\n`;
  const trusted = resolveEffectivePolicy(
    packageFloor,
    retirementPolicy([rule]),
    { trusted: true },
  );
  assert.equal(trusted.valid, true);
  const input = deliveryRetirementInput(
    { policy: trusted.policy, packageFloor },
    { policy: retirementPolicy([]) },
    [{ ruleId: rule.ruleId, fragmentPath: "project/rules/fixture.json", raw }],
    "a".repeat(40),
  );
  return { ...input, authorization: "approved", baseSha: "b".repeat(40) };
}

const missingFloorError =
  "trustedPolicyを使うPR作成には有効なpackageFloor（空でないrules）が必要です。trusted loaderのloadEffectiveTrustedPolicySetが返すpackageFloorをcandidateから独立して供給してください";

function observeDelivery(input: unknown) {
  let calls = 0;
  let error: unknown;
  let result: ReturnType<typeof createPullRequest> | undefined;
  try {
    // JavaScript callerの型検査を経ない入力をruntimeへ渡す。
    result = createPullRequest(
      input as Parameters<typeof createPullRequest>[0],
      () => {
        calls += 1;
        return { url: "https://example.invalid/pr/1284" };
      },
    );
  } catch (caught) {
    error = caught;
  }
  return { calls, error, result };
}

Given("deliveryの正規floorと未承認削除candidateがある", function () {
  this.retirementFloor = deliveryFloorFixture().packageFloor;
});

When("floor省略をpreviewとapplyおよびcandidate有無で実行する", function () {
  this.boundaryErrors = [];
  for (const apply of [false, true]) {
    for (const withCandidate of [false, true]) {
      const input: Record<string, unknown> = {
        ...deliveryFloorFixture(),
        apply,
      };
      delete input.packageFloor;
      if (!withCandidate) delete input.candidatePolicy;
      const observed = observeDelivery(input);
      assert.equal(
        observed.calls,
        0,
        `apply=${apply}, candidate=${withCandidate}`,
      );
      assert.ok(
        observed.error instanceof Error,
        `apply=${apply}, candidate=${withCandidate}`,
      );
      this.boundaryErrors.push(observed.error.message);
    }
  }
});

When("不正floorをpreviewとapplyおよびcandidate有無で実行する", function () {
  const floor = deliveryFloorFixture().packageFloor;
  const invalidFloors: unknown[] = [
    undefined,
    null,
    {},
    [],
    "raw-secret-1284",
    0,
    false,
    { ...floor, rules: [] },
    { ...floor, rules: null },
    { ...floor, rules: [{ ...floor.rules[0], owner: "" }] },
    { ...floor, rules: [{ ...floor.rules[0], ruleId: "raw-secret-1284" }] },
    { ...floor, merge: null },
    { ...floor, delivery: {} },
    { ...floor, schemaVersion: "raw-secret-1284" },
    { ...floor, budgets: null },
  ];
  this.boundaryErrors = [];
  for (const packageFloor of invalidFloors) {
    for (const apply of [false, true]) {
      for (const withCandidate of [false, true]) {
        const input: Record<string, unknown> = {
          ...deliveryFloorFixture(),
          apply,
          packageFloor,
        };
        if (!withCandidate) delete input.candidatePolicy;
        const observed = observeDelivery(input);
        assert.equal(observed.calls, 0);
        assert.ok(observed.error instanceof Error);
        this.boundaryErrors.push(observed.error.message);
      }
    }
  }
});

Then("全呼出しがraw入力を含まない固定floor復旧errorを返す", function () {
  assert.ok(this.boundaryErrors.length >= 4);
  for (const message of this.boundaryErrors) {
    assert.equal(message, missingFloorError);
    assert.doesNotMatch(message, /raw-secret-1284/u);
  }
});

When("正規floorでも提案なしとsourceなしの削除を実行する", function () {
  this.deliveryObservations = [];
  for (const apply of [false, true]) {
    const input = { ...deliveryFloorFixture(), apply };
    const withProposal = structuredClone(input.trustedPolicy);
    withProposal.projectRuleRetirementProposals = [
      retirementProposal(input.trustedRuleSources[0]!.raw),
    ];
    for (const attempt of [
      input,
      { ...input, trustedPolicy: withProposal, trustedRuleSources: undefined },
    ]) {
      this.deliveryObservations.push(observeDelivery(attempt));
    }
  }
});

Then("正規floorの無承認削除はprovider呼出し前に拒否される", function () {
  assert.equal(this.deliveryObservations.length, 4);
  for (const observed of this.deliveryObservations) {
    assert.equal(observed.calls, 0);
    assert.ok(observed.error instanceof Error);
    assert.match(observed.error.message, /trusted rule|ASC-TRUST/u);
  }
});

When(
  "非trusted previewとtrusted正常入力とpackage rule弱化を実行する",
  function () {
    const input = deliveryFloorFixture();
    const legacy = {
      ...input,
      trustedPolicy: undefined,
      packageFloor: undefined,
    };
    const trustedOnly = { ...input, candidatePolicy: undefined };
    const candidatePolicy = structuredClone(input.trustedPolicy);
    candidatePolicy.rules.find(
      (rule) => rule.ruleId === "ASC-TRUST-001",
    )!.enforcement = "record";
    this.deliveryObservations = [
      observeDelivery(legacy),
      observeDelivery(trustedOnly),
      observeDelivery({ ...trustedOnly, apply: true }),
      observeDelivery({ ...input, candidatePolicy }),
    ];
  },
);

Then("互換previewと正規applyを保ちpackage保護を維持する", function () {
  const [legacy, trustedOnly, applied, rejected] = this.deliveryObservations;
  for (const preview of [legacy!, trustedOnly!]) {
    assert.equal(preview.error, undefined);
    assert.equal(preview.result?.state, "preview");
    assert.equal(preview.calls, 0);
  }
  assert.equal(applied!.error, undefined);
  assert.equal(applied!.calls, 1);
  assert.equal(applied!.result?.state, "waiting_for_human_review");
  assert.equal(rejected!.calls, 0);
  assert.ok(rejected!.error instanceof Error);
  assert.match(rejected!.error.message, /ASC-TRUST|floor/u);
});
