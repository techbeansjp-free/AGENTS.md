import fs from "node:fs";
import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { buildFinalizeReport } from "../../src/domain/finalize.js";
import {
  DEFAULT_FINALIZE_IGNORED_PATH_ALLOWLIST,
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
