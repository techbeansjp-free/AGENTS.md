import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  classifyProjectChoiceDiff,
  type ProjectChoiceDiff,
} from "../../src/domain/project-choice-diff.js";
import { compareTrustedPolicy } from "../../src/domain/enforcement.js";
import {
  acceptApprovedShrinks,
  type ShrinkAcceptance,
} from "../../src/domain/project-choice-shrink.js";
import {
  loadProjectPolicySet,
  readProjectChoices,
  type PolicySet,
} from "../../src/domain/policy.js";
import { planFileMigration } from "../../src/domain/migration.js";
import {
  isRecord,
  type Diagnostic,
  type ProjectChoiceShrinkProposal,
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
  acceptedShrinks?: string[];
}

class ProjectChoiceDiffWorld extends WorkflowWorld {
  trustedChoice: unknown = undefined;
  candidateChoice: unknown = undefined;
  invalidInputs: Array<[unknown, unknown]> = [];
  diffs: ProjectChoiceDiff[] = [];
  trustedPolicy: Policy | undefined = undefined;
  candidatePolicy: Policy | undefined = undefined;
  comparison: PolicyComparison | undefined = undefined;
  candidateChoicesRaw: string | undefined = undefined;
  trustedPolicySet: PolicySet | undefined = undefined;
  candidatePolicySet: PolicySet | undefined = undefined;
  migrationPlan: unknown = undefined;
  distributedFiles: string[] = [];
  distributedContents: string[] = [];
  shrinkFieldPath = "";
  weakenedBaseline: string[][] = [];
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

const CHOICES_FRAGMENT = "choices/development.json";

/**
 * 縮小後のchoices fragment fileのraw textを作る。
 *
 * **受理判定はこのraw textのsha256だけを見る。** 提案はこのtextを承認した事実を
 * `afterSha256`として持つ。textの整形が1 byteでも違えば別の承認になる。
 */
function shrunkChoicesRaw(shrink: (value: ProjectChoices) => void): string {
  const value = choices();
  shrink(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function proposal(
  fieldPath: string,
  afterSha256: string,
): ProjectChoiceShrinkProposal {
  return {
    fieldPath,
    afterSha256,
    reason: "採用していない方針の宣言を取り除く",
    owner: "利用側project owner",
  };
}

function registerShrink(
  world: ProjectChoiceDiffWorld,
  fieldPath: string,
  shrink: (value: ProjectChoices) => void,
  options: { register?: boolean; candidateSideOnly?: boolean } = {},
): void {
  const trustedChoice = choices();
  const candidateChoice = choices();
  shrink(candidateChoice);
  const raw = shrunkChoicesRaw(shrink);
  const trustedPolicy = policy(trustedChoice);
  const candidatePolicy = policy(candidateChoice);
  const declared = proposal(fieldPath, sha256(raw));
  if (options.register !== false) {
    if (options.candidateSideOnly === true)
      candidatePolicy.projectChoiceShrinkProposals = [declared];
    else trustedPolicy.projectChoiceShrinkProposals = [declared];
  }
  world.trustedPolicy = trustedPolicy;
  world.candidatePolicy = candidatePolicy;
  world.candidateChoicesRaw = raw;
  world.shrinkFieldPath = fieldPath;
}

Given("既定branch側に禁止test suffixの縮小提案が登録されている", function () {
  registerShrink(this, "projectChoices.forbiddenTestFileSuffixes", (value) => {
    value.forbiddenTestFileSuffixes = [];
  });
});

Given("既定branch側にtest層の縮小提案が登録されている", function () {
  registerShrink(this, "projectChoices.testLayers", (value) => {
    value.testLayers = ["unit"];
  });
});

Given("既定branch側に禁止型の縮小提案が登録されている", function () {
  registerShrink(this, "projectChoices.quality.forbiddenTypes", (value) => {
    value.quality.forbiddenTypes = [];
  });
});

Given("既定branch側に縮小提案が登録されていない", function () {
  registerShrink(
    this,
    "projectChoices.forbiddenTestFileSuffixes",
    (value) => {
      value.forbiddenTestFileSuffixes = [];
    },
    { register: false },
  );
});

Given("既定branch側に対象外fieldを指す縮小提案が登録されている", function () {
  registerShrink(this, "projectChoices.capabilities", (value) => {
    value.capabilities.observability = {
      status: "not-applicable",
      reason: "観測を止める",
      evidence: "宣言のみ",
    };
  });
});

Given("型不正な縮小提案とraw byte列を取得できない入力がある", function () {
  registerShrink(this, "projectChoices.forbiddenTestFileSuffixes", (value) => {
    value.forbiddenTestFileSuffixes = [];
  });
  assert.ok(this.trustedPolicy);
  this.trustedPolicy.projectChoiceShrinkProposals = [
    { fieldPath: 1, afterSha256: [], reason: null, owner: undefined },
  ] as never;
  this.candidateChoicesRaw = undefined;
});

Given("対象3 field以外を弱化した入力の一覧がある", function () {
  const weaken: Array<(value: ProjectChoices) => void> = [
    (value) => {
      value.quality.strictTypecheck = {
        status: "not-applicable",
        reason: "検査を止める",
        evidence: "宣言のみ",
      };
    },
    (value) => {
      value.capabilities.privacySecurity = {
        status: "not-applicable",
        reason: "検討しない",
        evidence: "宣言のみ",
      };
    },
    (value) => {
      value.quality.auxiliaryLanguages = {};
    },
    (value) => {
      const structured = mapping();
      structured.roles.reviewer.logicalTier = "cheapest_available" as never;
      value.modelMapping = structured;
    },
    (value) => {
      (value as unknown as Record<string, unknown>).unknownField = "x";
    },
    (value) => {
      (value as unknown as Record<string, unknown>).quality = "文字列";
    },
  ];
  this.invalidInputs = weaken.map((mutate) => {
    const trusted = choices();
    trusted.modelMapping = mapping();
    const candidate = structuredClone(trusted);
    mutate(candidate);
    return [trusted, candidate] as [unknown, unknown];
  });
});

When("一覧の各入力をfield単位で分類する", function () {
  this.diffs = this.invalidInputs.map(([trusted, candidate]) =>
    classifyProjectChoiceDiff(trusted, candidate),
  );
});

Then("対象3 field以外の弱化分類は全件が変更前と一致する", function () {
  assert.equal(this.diffs.length, 6);
  const targets = [
    "projectChoices.testLayers",
    "projectChoices.forbiddenTestFileSuffixes",
    "projectChoices.quality.forbiddenTypes",
  ];
  for (const diff of this.diffs) {
    assert.ok(
      diff.weakened.length > 0,
      `弱化が検出されていません: ${JSON.stringify(diff)}`,
    );
    for (const entry of diff.weakened)
      assert.ok(
        !targets.some((target) =>
          entry.startsWith(`${target}: trusted側の要素を削除している: `),
        ),
        `対象3 fieldの縮小が混入しています: ${entry}`,
      );
  }
});

function compareWithShrink(world: ProjectChoiceDiffWorld): void {
  assert.ok(world.trustedPolicy);
  assert.ok(world.candidatePolicy);
  world.comparison = compareTrustedPolicy(
    world.trustedPolicy,
    world.candidatePolicy,
    {
      candidateChoicesRaw: world.candidateChoicesRaw,
      choicesFragmentPath: CHOICES_FRAGMENT,
    },
  );
}

When("提案と一致する縮小を判定する", function () {
  compareWithShrink(this);
});

When("対象外fieldの弱化を判定する", function () {
  compareWithShrink(this);
});

When("不正な提案で縮小を判定する", function () {
  compareWithShrink(this);
});

When("提案と値の内側の空白1個だけが違う候補の縮小を判定する", function () {
  assert.ok(this.candidateChoicesRaw);
  this.candidateChoicesRaw = this.candidateChoicesRaw.replace(
    '"language": "日本語"',
    '"language":  "日本語"',
  );
  compareWithShrink(this);
});

Then(
  "分類は弱化のままで最終判定は受理となりfield pathが記録される",
  function () {
    assert.ok(this.trustedPolicy?.projectChoices);
    assert.ok(this.candidatePolicy?.projectChoices);
    const diff = classifyProjectChoiceDiff(
      this.trustedPolicy.projectChoices,
      this.candidatePolicy.projectChoices,
    );
    assert.ok(
      diff.weakened.some((entry) =>
        entry.startsWith(`${this.shrinkFieldPath}: `),
      ),
      `分類器が弱化を検出していません: ${JSON.stringify(diff.weakened)}`,
    );
    assert.equal(
      this.comparison?.allowed,
      true,
      JSON.stringify(this.comparison?.rejected),
    );
    assert.deepEqual(this.comparison?.acceptedShrinks, [this.shrinkFieldPath]);
  },
);

function shrinkRejection(world: ProjectChoiceDiffWorld): Diagnostic {
  assert.equal(world.comparison?.allowed, false);
  const diagnostic = world.comparison?.rejected.find(
    (item) => item.purpose === "project choiceによる検証弱化を防止する",
  );
  assert.ok(diagnostic, JSON.stringify(world.comparison?.rejected));
  assert.equal(diagnostic.ruleId, "ASC-TRUST-001");
  return diagnostic;
}

Then("縮小はASC-TRUST-001で拒否される", function () {
  shrinkRejection(this);
  assert.deepEqual(this.comparison?.acceptedShrinks ?? [], []);
});

Then(
  "縮小はASC-TRUST-001で拒否され比較したfragment file pathと両sha256が記録される",
  function () {
    const diagnostic = shrinkRejection(this);
    const reasons = diagnostic.reasons.join(" ");
    assert.match(
      reasons,
      new RegExp(CHOICES_FRAGMENT.replace("/", "\\/"), "u"),
    );
    assert.ok(this.candidateChoicesRaw);
    const observed = sha256(this.candidateChoicesRaw);
    const proposed = sha256(
      shrunkChoicesRaw((value) => {
        value.forbiddenTestFileSuffixes = [];
      }),
    );
    assert.notEqual(observed, proposed);
    assert.match(reasons, new RegExp(observed, "u"));
    assert.match(reasons, new RegExp(proposed, "u"));
  },
);

Then("拒否診断は提案の登録先と次の操作を含む", function () {
  const diagnostic = shrinkRejection(this);
  assert.match(diagnostic.next, /projectChoiceShrinkProposals/u);
  assert.match(diagnostic.next, /既定branch/u);
  assert.match(diagnostic.next, /[ぁ-んァ-ヶ一-龠]/u);
});

/**
 * 実repositoryのpolicy setを土台に、choices fragmentを縮小したcandidate setを作る。
 *
 * **fragmentのraw textは実物をそのまま書き換えて作る。** 受理判定はこのtextの
 * sha256だけを見るため、整形の再現がずれると別の承認になる。
 */
function realPolicySets(options: { registerOn: "trusted" | "candidate" }): {
  trusted: Policy;
  candidate: Policy;
  candidateChoicesRaw: string;
  fragmentPath: string;
} {
  const fragmentPath = "choices/development.json";
  const raw = fs.readFileSync(
    `.agent-skill-chain/project/${fragmentPath}`,
    "utf8",
  );
  const trustedChoice = readProjectChoices(raw);
  const candidateChoice = structuredClone(trustedChoice);
  candidateChoice.forbiddenTestFileSuffixes = [];
  /**
   * **raw textの整形をそのまま尊重して置換する。** 実fileは`[".test.js", ".test.ts"]`の
   * ようにカンマの後へ空白を持つ一方、`JSON.stringify`は空白を入れない。値として
   * 同じでもbyte列が違うため、`JSON.stringify`の出力で置換すると一致しない。
   */
  const candidateRaw = raw.replace(
    /"forbiddenTestFileSuffixes":\s*\[[^\]]*\]/u,
    '"forbiddenTestFileSuffixes": []',
  );
  assert.notEqual(candidateRaw, raw, "縮小後のfragment textを作れていません");
  const trusted = policy(trustedChoice);
  const candidate = policy(candidateChoice);
  const declared = proposal(
    "projectChoices.forbiddenTestFileSuffixes",
    sha256(candidateRaw),
  );
  if (options.registerOn === "trusted")
    trusted.projectChoiceShrinkProposals = [declared];
  else candidate.projectChoiceShrinkProposals = [declared];
  return {
    trusted,
    candidate,
    candidateChoicesRaw: candidateRaw,
    fragmentPath,
  };
}

Given("候補側にだけ縮小提案を置いたpolicy setがある", function () {
  const sets = realPolicySets({ registerOn: "candidate" });
  this.trustedPolicy = sets.trusted;
  this.candidatePolicy = sets.candidate;
  this.candidateChoicesRaw = sets.candidateChoicesRaw;
});

Then("policy比較は縮小をASC-TRUST-001で拒否する", function () {
  shrinkRejection(this);
  assert.deepEqual(this.comparison?.acceptedShrinks ?? [], []);
});

Given("既定branch側へ縮小提案を登録したpolicy setがある", function () {
  const trustedSet = loadProjectPolicySet(process.cwd());
  const fragment = "project/choices/development.json";
  const raw = trustedSet.rawEntries[fragment];
  assert.ok(raw, "choices fragmentのraw textがありません");
  const candidateRaw = raw.replace(
    /"forbiddenTestFileSuffixes":\s*\[[^\]]*\]/u,
    '"forbiddenTestFileSuffixes": []',
  );
  assert.notEqual(candidateRaw, raw, "縮小後のfragment textを作れていません");
  const candidateChoice = readProjectChoices(candidateRaw);
  this.trustedPolicySet = {
    ...trustedSet,
    policy: {
      ...trustedSet.policy,
      projectChoiceShrinkProposals: [
        proposal(
          "projectChoices.forbiddenTestFileSuffixes",
          sha256(candidateRaw),
        ),
      ],
    },
  };
  this.candidatePolicySet = {
    ...trustedSet,
    policy: { ...trustedSet.policy, projectChoices: candidateChoice },
    rawEntries: { ...trustedSet.rawEntries, [fragment]: candidateRaw },
  };
});

/**
 * **`planFileMigration`を実際に通す。** `compareTrustedPolicy`を直接呼ぶと
 * migrate経路の配線を外す変異を検出できない。実測でその変異が生存したため、
 * 製品の関数を経由する形へ改めた。
 */
When("migrate経路で縮小の互換性を判定する", function () {
  assert.ok(this.trustedPolicySet);
  assert.ok(this.candidatePolicySet);
  const entries = Object.keys(this.candidatePolicySet.rawEntries)
    .sort()
    .map((relative) => ({
      kind: "policy" as const,
      path: `.agent-skill-chain/${relative}`,
      after: this.candidatePolicySet!.rawEntries[relative]!,
    }));
  const plan = planFileMigration(
    process.cwd(),
    this.trustedPolicySet,
    this.candidatePolicySet,
    entries,
  );
  this.migrationPlan = plan;
});

Then("migrate経路の判定は縮小を受理する", function () {
  const plan = this.migrationPlan;
  assert.ok(plan, "migration planがありません");
  const compatibility = (plan as { compatibility?: PolicyComparison })
    .compatibility;
  assert.ok(
    compatibility,
    `migrate経路が拒否しました: ${JSON.stringify(plan)}`,
  );
  assert.equal(
    compatibility.allowed,
    true,
    JSON.stringify(compatibility.rejected),
  );
  assert.deepEqual(compatibility.acceptedShrinks, [
    "projectChoices.forbiddenTestFileSuffixes",
  ]);
});

Given("配布物のschemaと利用案内がある", function () {
  this.distributedFiles = [
    ".agent-skill-chain/schemas/project-policy.schema.json",
    ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
    ".agent-skill-chain/schemas/00_利用案内.md",
  ];
});

When("配布物から縮小提案の宣言形式を探す", function () {
  this.distributedContents = this.distributedFiles.map((file) =>
    fs.readFileSync(file, "utf8"),
  );
});

Then("配布物は縮小提案のschemaと二段階手順の案内を含む", function () {
  const [policySchema, manifestSchema, guide] = this.distributedContents;
  for (const schema of [policySchema, manifestSchema]) {
    assert.ok(schema);
    const parsed = JSON.parse(schema) as Record<string, unknown>;
    const node = (
      "properties" in parsed && isRecord(parsed.properties)
        ? isRecord(parsed.properties.policy) &&
          isRecord(parsed.properties.policy.properties)
          ? parsed.properties.policy.properties
          : parsed.properties
        : {}
    ) as Record<string, unknown>;
    const field = node.projectChoiceShrinkProposals;
    assert.ok(field, "schemaへprojectChoiceShrinkProposalsがありません");
    assert.match(JSON.stringify(field), /afterSha256/u);
    assert.match(
      JSON.stringify(field),
      /projectChoices\.quality\.forbiddenTypes/u,
    );
  }
  assert.ok(guide);
  assert.match(guide, /projectChoiceShrinkProposals/u);
  assert.match(guide, /二段階/u);
});

/**
 * 合成した弱化entryを直接受理判定へ渡す。
 *
 * **`classifyProjectChoiceDiff`は3 field以外へ縮小理由のentryを出さない**ため、
 * 分類器を経由する入力では対象field限定の検査へ到達できない。将来4つ目の
 * 単調性fieldが増えたときに受理が漏れないことを、合成入力で先に固定する。
 */
function acceptSynthetic(input: {
  fieldPath: string;
  raw: string | undefined;
}): ShrinkAcceptance {
  return acceptApprovedShrinks({
    diff: {
      authority: [],
      weakened: [
        `${input.fieldPath}: trusted側の要素を削除している: 除去した値`,
      ],
      allowed: [],
    },
    trustedProposals: [
      proposal(input.fieldPath, sha256(input.raw ?? "縮小後のfragment")),
    ],
    candidateChoicesRaw: input.raw,
    choicesFragmentPath: CHOICES_FRAGMENT,
  });
}

Then("対象外fieldの縮小entryは提案が一致しても受理されない", function () {
  const raw = "縮小後のfragment";
  for (const fieldPath of [
    "projectChoices.quality.lintCommand",
    "projectChoices.capabilities",
    "projectChoices.testLayersExtra",
  ]) {
    const result = acceptSynthetic({ fieldPath, raw });
    assert.deepEqual(
      result.accepted,
      [],
      `対象外fieldが受理されました: ${fieldPath}`,
    );
    assert.equal(result.remaining.length, 1);
  }
  const target = acceptSynthetic({
    fieldPath: "projectChoices.testLayers",
    raw,
  });
  assert.equal(
    target.accepted.length,
    1,
    "対象fieldが受理されず、検査が空振りしています",
  );
});

Then("正当な提案でもraw byte列が無ければ受理されない", function () {
  const result = acceptSynthetic({
    fieldPath: "projectChoices.testLayers",
    raw: undefined,
  });
  assert.deepEqual(result.accepted, []);
  assert.equal(result.remaining.length, 1);
});
