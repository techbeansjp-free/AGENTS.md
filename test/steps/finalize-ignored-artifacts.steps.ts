import fs from "node:fs";
import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  buildFinalizeReport,
  planWorktreeCleanup,
} from "../../src/domain/finalize.js";
import {
  DEFAULT_FINALIZE_IGNORED_PATH_ALLOWLIST,
  isSafeFinalizeIgnoredPathPrefix,
  resolveFinalizeIgnoredPathAllowlist,
} from "../../src/domain/worktree-removal-safety.js";
import { validateProjectPolicyManifest } from "../../src/domain/policy.js";
import {
  surveyWorktrees,
  type WorktreeObservation,
} from "../../src/domain/worktree-survey.js";

interface FinalizeIgnoredUnitWorld extends WorkflowWorld {
  state: Parameters<typeof buildFinalizeReport>[0];
  report: ReturnType<typeof buildFinalizeReport>;
  allowlist: string[];
  manifest: unknown;
  validation: ReturnType<typeof validateProjectPolicyManifest>;
  observation: WorktreeObservation;
  surveySafe: boolean;
  finalizeSafe: boolean;
  schemaAllowsPattern: boolean;
  schemaPatterns: string[];
  finalizeIgnoredPathInput: string;
  schemaResults: boolean[];
  runtimeResult: boolean;
  cleanupPlan: ReturnType<typeof planWorktreeCleanup>;
  cleanupPlans: Array<ReturnType<typeof planWorktreeCleanup>>;
  representativeResults: Array<{
    input: string;
    expected: boolean;
    schemaResults: boolean[];
    runtimeResult: boolean;
  }>;
}

const { Given, When, Then } = stepDefinitions<FinalizeIgnoredUnitWorld>();

function safeState() {
  return {
    repositoryRoot: "/repo",
    repository: "owner/repository",
    worktree: "/repo/.worktrees/target",
    branch: "bugfix/894-finalize-ignored-artifacts",
    base: "main",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    dirty: false,
    untracked: [] as string[],
    stashes: [] as string[],
    temporaryArtifacts: [] as string[],
    ignoredArtifacts: [] as string[],
    ignoredPathAllowlist: resolveFinalizeIgnoredPathAllowlist(),
    pushed: true,
    remoteBranch: true,
    prMerged: true,
    specConsistent: true,
    testsPassed: true,
    reviewApproved: true,
    recoveryReachable: true,
    recoveryRef: "origin/bugfix/894-finalize-ignored-artifacts",
  };
}

function safeObservation(): WorktreeObservation {
  return {
    repositoryRoot: "/repo",
    path: "/repo/.worktrees/target",
    branch: "bugfix/894-finalize-ignored-artifacts",
    headState: "attached",
    headSha: "a".repeat(40),
    isPrimary: false,
    mergedIntoDefault: true,
    dirty: false,
    untracked: [],
    ignoredArtifacts: [],
    stashes: [],
    unpushedCommits: 0,
    pushed: true,
    remoteBranch: true,
    recoveryReachable: true,
  };
}

function projectManifest(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(".agent-skill-chain/project-policy.json", "utf8"),
  ) as Record<string, unknown>;
}

function manifestWorktree(manifest: Record<string, unknown>) {
  const policy = manifest.policy as Record<string, unknown>;
  return policy.worktree as Record<string, unknown>;
}

const FINALIZE_IGNORED_PATH_SCHEMA_FILES = [
  ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
  ".agent-skill-chain/schemas/project-policy.schema.json",
] as const;

const ACCEPTED_FINALIZE_IGNORED_PATH_INPUTS = [
  "dist/",
  "node_modules/",
  "build/output/",
  "a.b/",
  "a-b/",
  "a_b/",
] as const;

const REJECTED_FINALIZE_IGNORED_PATH_INPUTS = [
  "./",
  "cache/./",
  "../",
  "a/../b/",
  ".git/",
  "/abs/",
  "a*/",
  "a?/",
  "a[/",
  "a{/",
  "a|/",
  "a^/",
  "a$/",
  "a+/",
  "a\\/",
  "control/\u0000/",
  "cafe\u0301/",
  "dist",
  "",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectFinalizeIgnoredPathPatterns(value: unknown): string[] {
  if (Array.isArray(value))
    return value.flatMap(collectFinalizeIgnoredPathPatterns);
  if (!isRecord(value)) return [];
  const properties = value.properties;
  if (isRecord(properties)) {
    const allowlist = properties.finalizeIgnoredPathAllowlist;
    if (isRecord(allowlist) && isRecord(allowlist.items)) {
      const pattern = allowlist.items.pattern;
      if (typeof pattern !== "string")
        throw new TypeError(
          "finalizeIgnoredPathAllowlistのpatternは文字列でなければなりません",
        );
      return [pattern];
    }
  }
  return Object.values(value).flatMap(collectFinalizeIgnoredPathPatterns);
}

function readFinalizeIgnoredPathPattern(schemaFile: string): string {
  const schema: unknown = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
  const patterns = collectFinalizeIgnoredPathPatterns(schema);
  assert.equal(
    patterns.length,
    1,
    `${schemaFile}のfinalizeIgnoredPathAllowlist patternは1件でなければなりません`,
  );
  return patterns[0] as string;
}

function readFinalizeIgnoredPathPatterns(): string[] {
  return FINALIZE_IGNORED_PATH_SCHEMA_FILES.map(readFinalizeIgnoredPathPattern);
}

function safeCleanupInput(): Parameters<typeof planWorktreeCleanup>[0] {
  return {
    repositoryRoot: "/repo",
    target: {
      path: "/repo/.worktrees/target",
      branch: "bugfix/894-finalize-ignored-artifacts",
    },
    registered: [
      {
        path: "/repo/.worktrees/target",
        branch: "bugfix/894-finalize-ignored-artifacts",
      },
    ],
    prMerged: true,
    clean: true,
    trackedChanges: false,
    pushed: true,
    remoteBranch: true,
    recoveryReachable: true,
    untracked: [],
    stashes: [],
    temporaryArtifacts: [],
    ignoredArtifacts: [],
    ignoredPathAllowlist: resolveFinalizeIgnoredPathAllowlist(),
  };
}

function unsafeCleanupInput(
  overrides: Record<string, unknown>,
): Parameters<typeof planWorktreeCleanup>[0] {
  return {
    ...safeCleanupInput(),
    ...overrides,
  } as unknown as Parameters<typeof planWorktreeCleanup>[0];
}

Given("dist生成物だけを持つ安全なfinalize状態がある", function () {
  this.state = {
    ...safeState(),
    ignoredArtifacts: ["dist/bin/agent-skill-chain.js", "dist/src/cli.js"],
  };
});

Given("allowlist外の.envを持つ安全なfinalize状態がある", function () {
  this.state = { ...safeState(), ignoredArtifacts: [".env"] };
});

Given(
  "dist生成物とallowlist外の.envを持つ安全なfinalize状態がある",
  function () {
    this.state = {
      ...safeState(),
      ignoredArtifacts: ["dist/src/cli.js", ".env"],
    };
  },
);

Given("未commitの追跡対象fileを持つfinalize状態がある", function () {
  this.state = { ...safeState(), dirty: true };
});

Given("未pushのcommitを持つfinalize状態がある", function () {
  this.state = { ...safeState(), pushed: false };
});

Given("到達不能commitを持つfinalize状態がある", function () {
  this.state = { ...safeState(), recoveryReachable: false };
});

Given("stashを持つfinalize状態がある", function () {
  this.state = { ...safeState(), stashes: ["stash@{0}: fixture"] };
});

Given("PR未mergeのfinalize状態がある", function () {
  this.state = { ...safeState(), prMerged: false };
});

When("ignore対象を含むfinalize reportを作成する", function () {
  this.report = buildFinalizeReport(this.state);
});

Then("finalize reportは安全である", function () {
  assert.equal(this.report.safe, true);
});

Then("finalize reportは拒否される", function () {
  assert.equal(this.report.safe, false);
});

Then("拒否理由に.envのpathを含む", function () {
  assert.ok(this.report.reasons.some((reason) => reason.includes(".env")));
});

Then("拒否理由にdistのpathを含まない", function () {
  assert.equal(
    this.report.reasons.some((reason) => reason.includes("dist/src/cli.js")),
    false,
  );
});

Then("未commit理由でfinalize reportは拒否される", function () {
  assert.equal(this.report.safe, false);
  assert.ok(this.report.reasons.some((reason) => reason.includes("未commit")));
});

Then("未push理由でfinalize reportは拒否される", function () {
  assert.equal(this.report.safe, false);
  assert.ok(this.report.reasons.some((reason) => reason.includes("push")));
});

Then("到達不能理由でfinalize reportは拒否される", function () {
  assert.equal(this.report.safe, false);
  assert.ok(
    this.report.reasons.some((reason) => reason.includes("到達できず")),
  );
});

Then("stash理由でfinalize reportは拒否される", function () {
  assert.equal(this.report.safe, false);
  assert.ok(this.report.reasons.some((reason) => reason.includes("stash")));
});

Then("PR未merge理由でfinalize reportは拒否される", function () {
  assert.equal(this.report.safe, false);
  assert.ok(
    this.report.reasons.some((reason) => reason.includes("マージ済み")),
  );
});

Given("package既定のfinalize ignore allowlistがある", function () {
  this.allowlist = [...DEFAULT_FINALIZE_IGNORED_PATH_ALLOWLIST];
});

When("finalize ignore allowlistを解決する", function () {
  this.allowlist = resolveFinalizeIgnoredPathAllowlist(this.allowlist);
});

Then("node_modulesとdistを含む", function () {
  assert.ok(this.allowlist.includes("node_modules/"));
  assert.ok(this.allowlist.includes("dist/"));
});

Given("利用projectがcache directoryをallowlistへ追加する", function () {
  const manifest = projectManifest();
  manifestWorktree(manifest).finalizeIgnoredPathAllowlist = ["cache/"];
  this.manifest = manifest;
});

Given("利用projectがglob patternをallowlistへ追加する", function () {
  const manifest = projectManifest();
  manifestWorktree(manifest).finalizeIgnoredPathAllowlist = ["**/"];
  this.manifest = manifest;
  const schema = JSON.parse(
    fs.readFileSync(
      ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
      "utf8",
    ),
  ) as {
    properties: {
      policy: {
        properties: {
          worktree: {
            properties: {
              finalizeIgnoredPathAllowlist: {
                items: { pattern: string };
              };
            };
          };
        };
      };
    };
  };
  const pattern =
    schema.properties.policy.properties.worktree.properties
      .finalizeIgnoredPathAllowlist.items.pattern;
  this.schemaAllowsPattern = new RegExp(pattern, "u").test("**/");
});

When("project policy manifestをruntime検証する", function () {
  this.validation = validateProjectPolicyManifest(this.manifest);
});

Then("追加allowlistを持つmanifestは有効である", function () {
  assert.equal(this.validation.valid, true, this.validation.errors.join("\n"));
  assert.ok(resolveFinalizeIgnoredPathAllowlist(["cache/"]).includes("cache/"));
});

Then("過度に広いallowlistはschemaとruntime検証で拒否される", function () {
  assert.equal(this.validation.valid, false);
  assert.equal(this.schemaAllowsPattern, false);
  assert.ok(
    this.validation.errors.some((error) =>
      error.includes("安全な相対directory prefix"),
    ),
  );
});

Given("同じignore対象を持つsurvey観測とfinalize状態がある", function () {
  this.state = { ...safeState(), ignoredArtifacts: [".env"] };
  this.observation = { ...safeObservation(), ignoredArtifacts: [".env"] };
});

When("surveyとfinalizeの共通判定を実行する", function () {
  this.finalizeSafe = buildFinalizeReport(this.state).safe;
  this.surveySafe =
    surveyWorktrees([this.observation], resolveFinalizeIgnoredPathAllowlist())
      .entries[0]?.disposition === "cleanup-ready";
});

Then("surveyとfinalizeの安全判定は一致する", function () {
  assert.equal(this.surveySafe, this.finalizeSafe);
});

Given(
  "schema fileから読み取ったfinalize ignore allowlistのpatternと代表入力集合がある",
  function () {
    this.schemaPatterns = readFinalizeIgnoredPathPatterns();
  },
);

When("各schema patternとruntime述語で代表入力集合を判定する", function () {
  const inputs = [
    ...ACCEPTED_FINALIZE_IGNORED_PATH_INPUTS.map((input) => ({
      input,
      expected: true,
    })),
    ...REJECTED_FINALIZE_IGNORED_PATH_INPUTS.map((input) => ({
      input,
      expected: false,
    })),
  ];
  this.representativeResults = inputs.map(({ input, expected }) => ({
    input,
    expected,
    schemaResults: this.schemaPatterns.map((pattern) =>
      new RegExp(pattern, "u").test(input),
    ),
    runtimeResult: isSafeFinalizeIgnoredPathPrefix(input),
  }));
});

Then("受理と拒否を含む代表入力集合の判定は全件一致する", function () {
  assert.ok(this.representativeResults.some(({ expected }) => expected));
  assert.ok(this.representativeResults.some(({ expected }) => !expected));
  for (const result of this.representativeResults) {
    assert.deepEqual(
      [...result.schemaResults, result.runtimeResult],
      [result.expected, result.expected, result.expected],
      `入力${JSON.stringify(result.input)}のschema・runtime判定が一致しません`,
    );
  }
});

Given(
  "{string}をfinalize ignore allowlistの入力にする",
  function (input: string) {
    this.finalizeIgnoredPathInput = input;
    this.schemaPatterns = readFinalizeIgnoredPathPatterns();
  },
);

When("各schema patternとruntime述語で入力を判定する", function () {
  this.schemaResults = this.schemaPatterns.map((pattern) =>
    new RegExp(pattern, "u").test(this.finalizeIgnoredPathInput),
  );
  this.runtimeResult = isSafeFinalizeIgnoredPathPrefix(
    this.finalizeIgnoredPathInput,
  );
});

Then("schemaとruntimeの双方が入力を拒否する", function () {
  assert.deepEqual(this.schemaResults, [false, false]);
  assert.equal(this.runtimeResult, false);
});

Given(
  "2つのschema fileからfinalize ignore allowlistのpatternを読み取る",
  function () {
    this.schemaPatterns = readFinalizeIgnoredPathPatterns();
  },
);

When("2つのschema patternを比較する", function () {
  assert.equal(this.schemaPatterns.length, 2);
});

Then("2つのschema patternは同一である", function () {
  assert.equal(this.schemaPatterns[0], this.schemaPatterns[1]);
});

Given("temporaryArtifactsが配列でないcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ temporaryArtifacts: "unknown" }),
  );
});

Given("registeredが配列でない既削除cleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ registered: "unknown", targetAbsent: true }),
  );
});

Given("ignoredArtifactsが配列でないcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ ignoredArtifacts: null }),
  );
});

Given("untrackedがnullでconsumerAssetsが空のcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ untracked: null, consumerAssets: [] }),
  );
});

Given("trackedChangesがnullでcleanなcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ trackedChanges: null, clean: true }),
  );
});

Given("ignoredPathAllowlistがnullのcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ ignoredPathAllowlist: null }),
  );
});

Given("stashesが配列でないcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(unsafeCleanupInput({ stashes: null }));
});

Given("remoteBranchが不明でpushed済みのcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ remoteBranch: undefined, pushed: true }),
  );
});

Given("targetAbsentがbooleanでないcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ targetAbsent: "unknown" }),
  );
});

Given(
  "cleanがbooleanでなくtrackedChangesがfalseのcleanup入力がある",
  function () {
    this.cleanupPlan = planWorktreeCleanup(
      unsafeCleanupInput({ clean: null, trackedChanges: false }),
    );
  },
);

Given(
  "consumerAssetsが配列でなくuntrackedが空のcleanup入力がある",
  function () {
    this.cleanupPlan = planWorktreeCleanup(
      unsafeCleanupInput({ consumerAssets: "unknown", untracked: [] }),
    );
  },
);

Given("trackedChangesがfalseでcleanがfalseのcleanup入力がある", function () {
  this.cleanupPlan = planWorktreeCleanup(
    unsafeCleanupInput({ trackedChanges: false, clean: false }),
  );
});

Given(
  "trackedChangesとcleanが整合する安全側と拒否側のcleanup入力がある",
  function () {
    this.cleanupPlans = [
      planWorktreeCleanup(
        unsafeCleanupInput({ trackedChanges: false, clean: true }),
      ),
      planWorktreeCleanup(
        unsafeCleanupInput({ trackedChanges: true, clean: false }),
      ),
    ];
  },
);

Given(
  "trackedChangesまたはcleanだけを持つ安全側と拒否側のcleanup入力がある",
  function () {
    this.cleanupPlans = [
      planWorktreeCleanup(
        unsafeCleanupInput({ trackedChanges: false, clean: undefined }),
      ),
      planWorktreeCleanup(
        unsafeCleanupInput({ trackedChanges: true, clean: undefined }),
      ),
      planWorktreeCleanup(
        unsafeCleanupInput({ trackedChanges: undefined, clean: true }),
      ),
      planWorktreeCleanup(
        unsafeCleanupInput({ trackedChanges: undefined, clean: false }),
      ),
    ];
  },
);

Given(
  "untrackedが空でconsumerAssetsにmemoがあるcleanup入力がある",
  function () {
    this.cleanupPlan = planWorktreeCleanup(
      unsafeCleanupInput({ untracked: [], consumerAssets: ["memo"] }),
    );
  },
);

When("worktree cleanupを計画する", function () {
  assert.ok(this.cleanupPlan);
});

When("整合するworktree cleanupをそれぞれ計画する", function () {
  assert.equal(this.cleanupPlans.length, 2);
});

When("片方だけのworktree cleanupをそれぞれ計画する", function () {
  assert.equal(this.cleanupPlans.length, 4);
});

Then("worktree cleanupは拒否される", function () {
  assert.equal(this.cleanupPlan.state, "rejected");
});

Then("拒否理由はtrackedChangesがfalseでcleanがfalseの矛盾を示す", function () {
  assert.ok(
    this.cleanupPlan.reasons.some(
      (reason) =>
        reason.includes("trackedChanges=false") &&
        reason.includes("clean=false") &&
        reason.includes("矛盾"),
    ),
  );
});

Then("整合する安全側は削除可能で拒否側は未commit理由で拒否される", function () {
  assert.equal(this.cleanupPlans[0]?.state, "ready");
  assert.equal(this.cleanupPlans[1]?.state, "rejected");
  assert.ok(
    this.cleanupPlans[1]?.reasons.includes("未commitの追跡対象fileがあります"),
  );
});

Then(
  "片方だけでも安全側は削除可能で拒否側は未commit理由で拒否される",
  function () {
    assert.deepEqual(
      this.cleanupPlans.map((plan) => plan.state),
      ["ready", "rejected", "ready", "rejected"],
    );
    for (const plan of [this.cleanupPlans[1], this.cleanupPlans[3]])
      assert.ok(plan?.reasons.includes("未commitの追跡対象fileがあります"));
  },
);

Then("拒否理由は一時資産があるか状態不明であることを示す", function () {
  assert.ok(
    this.cleanupPlan.reasons.some((reason) =>
      reason.includes("一時資産があるか状態が不明"),
    ),
  );
});
