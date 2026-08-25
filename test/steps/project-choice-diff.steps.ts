import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyProjectChoiceDiff,
  type ProjectChoiceDiff,
} from "../../src/domain/project-choice-diff.js";
import { compareTrustedPolicy } from "../../src/domain/enforcement.js";
import { readProjectChoices } from "../../src/domain/policy.js";
import {
  type Diagnostic,
  type ModelMappingChoice,
  type Policy,
  type ProjectChoices,
} from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface PolicyComparison {
  allowed: boolean;
  rejected: Diagnostic[];
  stagedAdditions: string[];
  projectChoiceChanges: string[];
}

class ProjectChoiceDiffWorld extends WorkflowWorld {
  trustedChoice: unknown = undefined;
  candidateChoice: unknown = undefined;
  invalidInputs: Array<[unknown, unknown]> = [];
  diffs: ProjectChoiceDiff[] = [];
  trustedPolicy: Policy | undefined = undefined;
  candidatePolicy: Policy | undefined = undefined;
  comparison: PolicyComparison | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<ProjectChoiceDiffWorld>();

function mapping(): ModelMappingChoice {
  const role = {
    provider: "Codex",
    logicalTier: "project_default" as const,
    reasoningEffort: "high" as const,
    speed: "standard" as const,
  };
  return {
    roles: {
      coordinator: { ...role },
      implementer: { ...role },
      reviewer: {
        ...role,
        independence: { differentFrom: "implementer" },
      },
    },
    fallback: {
      when: "implementer_unavailable",
      role: "coordinator",
      modelSelection: "project_default",
    },
    evidenceStoreRoot: "docs/evidence/routing/",
    retention: {
      retentionDays: 30,
      maxRecordsPerIssue: 20,
      maxRecordBytes: 65536,
      rotationCondition: "oldest_first",
      deletionMethod: "preview_then_explicit",
    },
  };
}

function choices(): ProjectChoices {
  return {
    language: "日本語",
    testRunner: "cucumber-js",
    gherkinDialect: "en",
    testLayers: ["unit", "integration"],
    forbiddenTestFileSuffixes: [".test.ts"],
    naming: "一意なSCN ID",
    packageManager: "npm",
    runtime: "Node.js 20以上",
    ci: ".github/workflows/ci.yml",
    modelMapping: "roleごとにprojectが選択する",
    release: "明示authorityによる手動操作",
    projectKind: "cli",
    capabilities: {
      privacySecurity: {
        status: "applicable",
        reason: "policy境界を検証する",
        evidence: "反例BDD",
      },
      observability: {
        status: "applicable",
        reason: "診断を記録する",
        evidence: "診断BDD",
      },
      humanCenteredUi: {
        status: "not-applicable",
        reason: "CLIだけを提供する",
        evidence: "package.jsonのbin",
      },
      designTokens: {
        status: "not-applicable",
        reason: "画面を提供しない",
        evidence: "UI sourceなし",
      },
    },
    quality: {
      implementationLanguage: "TypeScript",
      strictTypecheck: true,
      forbiddenTypes: ["any"],
      lintCommand: "npm run lint",
      formatCheckCommand: "npm run format:check",
      formatWriteCommand: "npm run format:write",
      typecheckCommand: "npm run typecheck",
      runtimeValidation: "unknown入力をtype guardで検証する",
      auxiliaryLanguages: {
        shell: {
          status: "applicable",
          reason: "起動境界に使用する",
          evidence: "shell検査",
        },
      },
    },
  };
}

function policy(projectChoices: ProjectChoices): Policy {
  return {
    schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
    delivery: { stopAt: "pull_request" },
    merge: {
      mode: "disabled",
      branches: ["main"],
      methods: ["squash"],
      requiredChecks: [],
      requiredReviews: 1,
    },
    rules: [],
    projectChoices,
  };
}

function requireDiff(world: ProjectChoiceDiffWorld): ProjectChoiceDiff {
  const diff = world.diffs[0];
  assert.ok(diff);
  return diff;
}

function includesPath(items: string[], fieldPath: string): boolean {
  return items.some((item) => item.includes(fieldPath));
}

Given("releaseだけを変更したproject choice差分がある", function () {
  const trusted = choices();
  this.trustedChoice = trusted;
  const candidate = structuredClone(trusted);
  candidate.release = "自動release";
  this.candidateChoice = candidate;
});

Given("CI選択だけを変更したproject choice差分がある", function () {
  const trusted = choices();
  this.trustedChoice = trusted;
  const candidate = structuredClone(trusted);
  candidate.ci = ".github/workflows/release.yml";
  this.candidateChoice = candidate;
});

Given("test層を削除したproject choice差分がある", function () {
  const trusted = choices();
  this.trustedChoice = trusted;
  const candidate = structuredClone(trusted);
  candidate.testLayers = ["unit"];
  this.candidateChoice = candidate;
});

Given(
  "禁止型を縮小しstrict型検査を無効にしたproject choice差分がある",
  function () {
    const trusted = choices();
    this.trustedChoice = trusted;
    const candidate = structuredClone(trusted) as unknown as {
      quality: { forbiddenTypes: string[]; strictTypecheck: boolean };
    };
    candidate.quality.forbiddenTypes = [];
    candidate.quality.strictTypecheck = false;
    this.candidateChoice = candidate;
  },
);

Given(
  "capabilityを格下げし補助言語宣言を削除したproject choice差分がある",
  function () {
    const trusted = choices();
    this.trustedChoice = trusted;
    const candidate = structuredClone(trusted);
    candidate.capabilities.privacySecurity.status = "not-applicable";
    delete candidate.quality.auxiliaryLanguages.shell;
    this.candidateChoice = candidate;
  },
);

Given(
  "modelMappingだけを構造化値へ変更したproject choice差分がある",
  function () {
    const trusted = choices();
    this.trustedChoice = trusted;
    const candidate = structuredClone(trusted);
    candidate.modelMapping = mapping();
    this.candidateChoice = candidate;
  },
);

Given("test層と禁止型を追加したproject choice差分がある", function () {
  const trusted = choices();
  this.trustedChoice = trusted;
  const candidate = structuredClone(trusted);
  candidate.testLayers.push("e2e");
  candidate.quality.forbiddenTypes.push("unknown assertion");
  this.candidateChoice = candidate;
});

Given("未知fieldを持つ入力とobjectでない入力がある", function () {
  const trusted = choices();
  this.invalidInputs = [
    [trusted, { ...structuredClone(trusted), unknownChoice: true }],
    [trusted, null],
  ];
});

When("project choice差分をfield単位で分類する", function () {
  this.diffs = [
    classifyProjectChoiceDiff(this.trustedChoice, this.candidateChoice),
  ];
});

When("不正なproject choice差分をfield単位で分類する", function () {
  this.diffs = this.invalidInputs.map(([trusted, candidate]) =>
    classifyProjectChoiceDiff(trusted, candidate),
  );
});

Then("release変更はauthority違反として分類される", function () {
  const diff = requireDiff(this);
  assert.deepEqual(diff.authority, ["projectChoices.release"]);
  assert.deepEqual(diff.weakened, []);
});

Then("CI選択変更はauthority違反として分類される", function () {
  const diff = requireDiff(this);
  assert.deepEqual(diff.authority, ["projectChoices.ci"]);
  assert.deepEqual(diff.weakened, []);
});

Then("test層の縮小は検証弱化として分類される", function () {
  assert.ok(
    includesPath(requireDiff(this).weakened, "projectChoices.testLayers"),
  );
});

Then("禁止型とstrict型検査の変更は検証弱化として分類される", function () {
  const diff = requireDiff(this);
  assert.ok(
    includesPath(diff.weakened, "projectChoices.quality.forbiddenTypes"),
  );
  assert.ok(
    includesPath(diff.weakened, "projectChoices.quality.strictTypecheck"),
  );
});

Then("capabilityと補助言語の変更は検証弱化として分類される", function () {
  const diff = requireDiff(this);
  assert.ok(
    includesPath(diff.weakened, "projectChoices.capabilities.privacySecurity"),
  );
  assert.ok(
    includesPath(
      diff.weakened,
      "projectChoices.quality.auxiliaryLanguages.shell",
    ),
  );
});

Then("modelMapping変更は許可されfield pathが記録される", function () {
  assert.deepEqual(requireDiff(this), {
    authority: [],
    weakened: [],
    allowed: ["projectChoices.modelMapping"],
  });
});

Then("検証強化は許可され変更field pathが記録される", function () {
  const diff = requireDiff(this);
  assert.deepEqual(diff.authority, []);
  assert.deepEqual(diff.weakened, []);
  assert.deepEqual(diff.allowed, [
    "projectChoices.testLayers",
    "projectChoices.quality.forbiddenTypes",
  ]);
});

Then("未知fieldとobjectでない事実は検証弱化として分類される", function () {
  assert.equal(this.diffs.length, 2);
  assert.ok(
    includesPath(this.diffs[0]?.weakened ?? [], "projectChoices.unknownChoice"),
  );
  assert.match((this.diffs[0]?.weakened ?? []).join(" "), /未知/u);
  assert.match((this.diffs[1]?.weakened ?? []).join(" "), /object/u);
});

Given(
  "実repositoryのproject choiceでmodelMappingだけを有効化したcandidateがある",
  function () {
    const trustedChoice = readProjectChoices(
      fs.readFileSync(
        ".agent-skill-chain/project/choices/development.json",
        "utf8",
      ),
    );
    trustedChoice.modelMapping = "roleごとにprojectが選択する";
    const candidateChoice = structuredClone(trustedChoice);
    candidateChoice.modelMapping = mapping();
    this.trustedPolicy = policy(trustedChoice);
    this.candidatePolicy = policy(candidateChoice);
  },
);

Given(
  "実repositoryのproject choiceでreleaseだけを変更したcandidateがある",
  function () {
    const trustedChoice = readProjectChoices(
      fs.readFileSync(
        ".agent-skill-chain/project/choices/development.json",
        "utf8",
      ),
    );
    const candidateChoice = structuredClone(trustedChoice);
    candidateChoice.release = "自動release";
    this.trustedPolicy = policy(trustedChoice);
    this.candidatePolicy = policy(candidateChoice);
  },
);

When(
  "trusted policyとcandidate policyのproject choice差分を比較する",
  function () {
    assert.ok(this.trustedPolicy);
    assert.ok(this.candidatePolicy);
    this.comparison = compareTrustedPolicy(
      this.trustedPolicy,
      this.candidatePolicy,
    );
  },
);

Then("policy比較はmodelMapping変更を許可し変更pathを返す", function () {
  assert.equal(this.comparison?.allowed, true);
  assert.deepEqual(this.comparison?.projectChoiceChanges, [
    "projectChoices.modelMapping",
  ]);
});

Then("policy比較はrelease変更を日本語のauthority診断で拒否する", function () {
  assert.equal(this.comparison?.allowed, false);
  const diagnostic = this.comparison?.rejected.find(
    (item) =>
      item.purpose === "authorityを含むproject choiceの自己変更を防止する",
  );
  assert.ok(diagnostic);
  assert.match(diagnostic.reasons.join(" "), /projectChoices\.release/u);
  assert.match(diagnostic.reasons.join(" "), /[ぁ-んァ-ヶ一-龠]/u);
  assert.match(diagnostic.requiredAuthority, /[ぁ-んァ-ヶ一-龠]/u);
  assert.match(diagnostic.rollback, /[ぁ-んァ-ヶ一-龠]/u);
});
