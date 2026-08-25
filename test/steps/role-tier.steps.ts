import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { validateProjectChoices } from "../../src/domain/policy.js";
import { classifyProjectChoiceDiff } from "../../src/domain/project-choice-diff.js";
import {
  DEFAULT_ROLE_CONTRACTS,
  requiredTier,
  validateProviderSelection,
  validateRoleAssignment,
  validateRoleOperation,
  validateTierSelection,
  type HumanOverride,
  type ModelTier,
} from "../../src/domain/role.js";
import { isRecord } from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

type Validation = { valid: boolean; errors: string[] };
type Assignment = { role: string; identity: string; context: string };
type ProviderInput = Parameters<typeof validateProviderSelection>[0];

class RoleTierWorld extends WorkflowWorld {
  roleOperation: Parameters<typeof validateRoleOperation>[0] | undefined;
  assignments: Assignment[] = [];
  validation: Validation | undefined;
  tierInputs: Array<Parameters<typeof requiredTier>[0]> = [];
  tiers: ModelTier[] = [];
  tierSelection: Parameters<typeof validateTierSelection>[0] | undefined;
  providerInputs: ProviderInput[] = [];
  validations: Validation[] = [];
  fixtureFile = "";
  fixtureValue: unknown = undefined;
  terminalOperations: Array<Parameters<typeof validateRoleOperation>[0]> = [];
  trustedChoice: unknown = undefined;
  candidateChoice: unknown = undefined;
  cliResult: SpawnSyncReturns<string> | undefined;
}

const { Given, When, Then } = stepDefinitions<RoleTierWorld>();

function requireValidation(world: RoleTierWorld): Validation {
  assert.ok(world.validation);
  return world.validation;
}

function validOverride(overrides: Partial<HumanOverride> = {}): HumanOverride {
  return {
    provider: "codex",
    selection: "xhigh",
    issue: 830,
    scope: "role-tier",
    instructedBy: "human-owner@example.invalid",
    instructedAt: "2026-08-25T00:00:00.000Z",
    expiresAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

Given("coordinatorのproduct実装操作がある", function () {
  this.roleOperation = {
    role: "coordinator",
    operation: "implement_product",
    paths: ["src/domain/role.ts"],
    evidence: ["assignment_record", "state_record"],
  };
});

When("role操作契約を検証する", function () {
  assert.ok(this.roleOperation);
  this.validation = validateRoleOperation(this.roleOperation);
});

Then("role操作はproduct実装禁止として拒否される", function () {
  const result = requireValidation(this);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /implement_product.*禁止/u);
});

Given("implementerとreviewerへ同一identityを割り当てる", function () {
  this.assignments = [
    { role: "coordinator", identity: "coord", context: "coord-context" },
    { role: "implementer", identity: "same-agent", context: "impl-context" },
    { role: "reviewer", identity: "same-agent", context: "review-context" },
  ];
});

Given("implementerとreviewerへ同一contextを割り当てる", function () {
  this.assignments = [
    { role: "coordinator", identity: "coord", context: "coord-context" },
    { role: "implementer", identity: "impl", context: "same-context" },
    { role: "reviewer", identity: "review", context: "same-context" },
  ];
});

When("role割当契約を検証する", function () {
  this.validation = validateRoleAssignment({
    scope: "role-tier",
    assignments: this.assignments,
  });
});

Then("role割当はidentity違反として拒否される", function () {
  const result = requireValidation(this);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /異なるidentity/u);
});

Then("role割当はcontext違反として拒否される", function () {
  const result = requireValidation(this);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /異なるcontext/u);
});

Given("implementerの許可path外と必要証拠不足の操作がある", function () {
  this.roleOperation = {
    role: "implementer",
    operation: "run_test",
    paths: [".github/workflows/ci.yml"],
    evidence: [],
  };
});

Then("role操作はpathと証拠の違反として拒否される", function () {
  const result = requireValidation(this);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /許可path外/u);
  assert.match(result.errors.join(" "), /必要証拠/u);
});

Given("強度が増加するriskとscopeがある", function () {
  this.tierInputs = [
    { risk: "quality", mode: "quick", scope: "read-only列挙" },
    { risk: "quality", mode: "quick", scope: "通常実装" },
    { risk: "security", mode: "full", scope: "architecture review" },
    { risk: "authority", mode: "full", scope: "merge" },
  ];
});

When("最低model tierを順に決定する", function () {
  this.tiers = this.tierInputs.map(requiredTier);
});

Then("model tierは単調に増加する", function () {
  assert.deepEqual(this.tiers, ["routine", "standard", "advanced", "critical"]);
});

Given("advancedが必要なscopeでstandardを選択する", function () {
  this.tierSelection = {
    required: "advanced",
    selected: "standard",
    mapping: { "model-a": "standard" },
    model: "model-a",
  };
});

Given("mappingに存在しないmodelを選択する", function () {
  this.tierSelection = {
    required: "standard",
    selected: "standard",
    mapping: {},
    model: "unknown-model",
  };
});

When("model tier選択を検証する", function () {
  assert.ok(this.tierSelection);
  this.validation = validateTierSelection(this.tierSelection);
});

Then("tier降格は拒否される", function () {
  const result = requireValidation(this);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /降格/u);
});

Then("silent fallbackは拒否される", function () {
  const result = requireValidation(this);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /mappingが未定義/u);
});

Given("critical tierとauthority違反の操作がある", function () {
  this.tierSelection = {
    required: "critical",
    selected: "critical",
    mapping: { "model-critical": "critical" },
    model: "model-critical",
  };
  this.roleOperation = {
    role: "coordinator",
    operation: "merge_arbitration",
    paths: [],
    evidence: ["assignment_record", "state_record"],
  };
});

When("tierと操作authorityを別々に検証する", function () {
  assert.ok(this.tierSelection);
  assert.ok(this.roleOperation);
  this.validations = [
    validateTierSelection(this.tierSelection),
    validateRoleOperation(this.roleOperation),
  ];
});

Then("tierは合格しても操作authorityは拒否される", function () {
  assert.deepEqual(
    this.validations.map((result) => result.valid),
    [true, false],
  );
});

Given("Codex highとClaude Opusをoverrideなしで選択する", function () {
  this.providerInputs = [
    {
      provider: "codex",
      selection: "high",
      issue: 830,
      scope: "x",
      now: "2026-08-25T12:00:00Z",
    },
    {
      provider: "claude",
      selection: "Opus",
      issue: 830,
      scope: "x",
      now: "2026-08-25T12:00:00Z",
    },
  ];
});

Given(
  "対象scopeに一致する人間overrideでCodex xhighとClaude Fableを選択する",
  function () {
    this.providerInputs = [
      {
        provider: "codex",
        selection: "xhigh",
        issue: 830,
        scope: "role-tier",
        now: "2026-08-25T12:00:00Z",
        override: validOverride(),
      },
      {
        provider: "claude",
        selection: "Fable",
        issue: 830,
        scope: "role-tier",
        now: "2026-08-25T12:00:00Z",
        override: validOverride({ provider: "claude", selection: "Fable" }),
      },
    ];
  },
);

Given("別Issueと別scopeと失効済みのoverrideがある", function () {
  const base = {
    provider: "codex",
    selection: "xhigh",
    issue: 830,
    scope: "role-tier",
    now: "2026-08-25T12:00:00Z",
  };
  this.providerInputs = [
    { ...base, override: validOverride({ issue: 829 }) },
    { ...base, override: validOverride({ scope: "other" }) },
    { ...base, override: validOverride({ expiresAt: "2026-08-25T11:59:59Z" }) },
    { ...base, override: validOverride({ provider: "claude" }) },
    { ...base, override: validOverride({ selection: "max" }) },
  ];
});

Given("coordinatorが自己発行したoverrideがある", function () {
  this.providerInputs = [
    {
      provider: "codex",
      selection: "xhigh",
      issue: 830,
      scope: "role-tier",
      now: "2026-08-25T12:00:00Z",
      override: validOverride({ instructedBy: "coordinator" }),
    },
  ];
});

Given("provider aliasと自動routing選択がある", function () {
  this.providerInputs = [
    {
      provider: "codex-latest",
      selection: "high",
      issue: 830,
      scope: "x",
      now: "2026-08-25T12:00:00Z",
    },
    {
      provider: "claude",
      selection: "auto",
      issue: 830,
      scope: "x",
      now: "2026-08-25T12:00:00Z",
    },
    {
      provider: "codex",
      selection: "fallback",
      issue: 830,
      scope: "x",
      now: "2026-08-25T12:00:00Z",
    },
  ];
});

When("provider自律選択上限を検証する", function () {
  this.validations = this.providerInputs.map(validateProviderSelection);
});

Then("上限内のprovider選択は許可される", function () {
  assert.ok(this.validations.every((result) => result.valid));
});

Then("上限超過のprovider選択は許可される", function () {
  assert.ok(this.validations.every((result) => result.valid));
});

Then("すべての再利用overrideは拒否される", function () {
  assert.ok(this.validations.every((result) => !result.valid));
});

Then("AI自己発行overrideは拒否される", function () {
  assert.equal(this.validations[0]?.valid, false);
  assert.match(this.validations[0]?.errors.join(" ") ?? "", /自己発行/u);
});

Then("aliasと自動routingは拒否される", function () {
  assert.ok(this.validations.every((result) => !result.valid));
});

Given(
  "一時directoryにrole契約とtier mappingを持つproject choice fixtureがある",
  function () {
    const directory = this.temp("asc-role-tier-choice-");
    this.fixtureFile = path.join(directory, "development.json");
    const choice = JSON.parse(
      fs.readFileSync(
        path.resolve(".agent-skill-chain/project/choices/development.json"),
        "utf8",
      ),
    ) as unknown;
    assert.ok(isRecord(choice) && isRecord(choice.modelMapping));
    choice.modelMapping.roleContracts = Object.fromEntries(
      Object.entries(DEFAULT_ROLE_CONTRACTS).map(([role, contract]) => [
        role,
        {
          allowedPaths: contract.allowedPaths,
          allowedOperations: contract.allowedOperations,
          forbiddenOperations: contract.forbiddenOperations,
          requiredEvidence: contract.requiredEvidence,
        },
      ]),
    );
    choice.modelMapping.tierMapping = { "fixture-model": "advanced" };
    choice.modelMapping.minimumTierByRisk = { security: "advanced" };
    fs.writeFileSync(this.fixtureFile, `${JSON.stringify(choice, null, 2)}\n`);
  },
);

When("project choice fixtureをruntimeで検証する", function () {
  this.fixtureValue = JSON.parse(
    fs.readFileSync(this.fixtureFile, "utf8"),
  ) as unknown;
  this.validation = validateProjectChoices(this.fixtureValue);
});

Then("project choice fixtureは妥当である", function () {
  assert.deepEqual(requireValidation(this), { valid: true, errors: [] });
});

Given("PRとmergeとfinalizeに必要なrole・tier証拠がない", function () {
  this.terminalOperations = ["open_pr", "verify_merge", "safe_cleanup"].map(
    (operation) => ({ role: "finalizer", operation, paths: [], evidence: [] }),
  );
  this.tierSelection = {
    required: "critical",
    selected: "critical",
    mapping: {},
    model: "unmapped-finalizer-model",
  };
});

When("終端role操作を検証する", function () {
  assert.ok(this.tierSelection);
  this.validations = [
    ...this.terminalOperations.map(validateRoleOperation),
    validateTierSelection(this.tierSelection),
  ];
});

Then("すべての終端role操作はfail closedで拒否される", function () {
  assert.ok(this.validations.every((result) => !result.valid));
  assert.ok(
    this.validations
      .slice(0, 3)
      .every((result) => /必要証拠/u.test(result.errors.join(" "))),
  );
  assert.match(this.validations[3]?.errors.join(" ") ?? "", /mappingが未定義/u);
});

Given(
  "role禁止操作を削除しtierを引き下げたproject choice差分がある",
  function () {
    const base = JSON.parse(
      fs.readFileSync(
        path.resolve(".agent-skill-chain/project/choices/development.json"),
        "utf8",
      ),
    ) as unknown;
    assert.ok(isRecord(base) && isRecord(base.modelMapping));
    base.modelMapping.roleContracts = {
      coordinator: {
        allowedPaths: [],
        allowedOperations: [],
        forbiddenOperations: ["implement_product", "self_approve"],
        requiredEvidence: ["assignment_record"],
      },
    };
    base.modelMapping.tierMapping = { "fixture-model": "advanced" };
    base.modelMapping.minimumTierByRisk = { security: "advanced" };
    this.trustedChoice = base;
    const candidate = structuredClone(base);
    assert.ok(isRecord(candidate) && isRecord(candidate.modelMapping));
    const contracts = candidate.modelMapping.roleContracts;
    assert.ok(isRecord(contracts) && isRecord(contracts.coordinator));
    contracts.coordinator.forbiddenOperations = ["self_approve"];
    candidate.modelMapping.tierMapping = { "fixture-model": "standard" };
    candidate.modelMapping.minimumTierByRisk = { security: "routine" };
    this.candidateChoice = candidate;
  },
);

When("role tierのproject choice差分を分類する", function () {
  this.value = classifyProjectChoiceDiff(
    this.trustedChoice,
    this.candidateChoice,
  );
});

Then("role契約弱化とtier引き下げが記録される", function () {
  assert.ok(isRecord(this.value) && Array.isArray(this.value.weakened));
  const weakened = this.value.weakened.join(" ");
  assert.match(weakened, /forbiddenOperations/u);
  assert.match(weakened, /tierMapping/u);
  assert.match(weakened, /minimumTierByRisk/u);
});

Given("build済みCLIへ同一identityとcontextのrole割当を渡す", function () {
  this.assignments = [
    { role: "coordinator", identity: "coord", context: "coord-context" },
    { role: "implementer", identity: "same", context: "same-context" },
    { role: "reviewer", identity: "same", context: "same-context" },
  ];
});

When("routing rolesを実行する", function () {
  const cli = path.resolve("dist/bin/agent-skill-chain.js");
  this.cliResult = spawnSync(
    process.execPath,
    [
      cli,
      "routing",
      "roles",
      "--scope=role-tier",
      `--assignments=${JSON.stringify(this.assignments)}`,
    ],
    { encoding: "utf8" },
  );
});

Then("CLIは非0と日本語の構造化診断を返す", function () {
  assert.equal(this.cliResult?.status, 1, this.cliResult?.stderr);
  const output = JSON.parse(this.cliResult?.stdout ?? "") as unknown;
  assert.ok(isRecord(output) && isRecord(output.messageJa));
  assert.match(this.cliResult?.stdout ?? "", /ルールID|目的|具体的根拠/u);
  assert.match(this.cliResult?.stdout ?? "", /異なるidentity/u);
});
