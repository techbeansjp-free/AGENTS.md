import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import {
  applyFinalize,
  buildFinalizeReport,
  planCompletion,
  planRootUpdate,
  planWorktreeCleanup,
  summarizeCompletion,
  type CompletionOutcomeInput,
  type CompletionPhaseResult,
  type CompletionPlanInput,
} from "../../src/domain/finalize.js";
import {
  applyWorkspaceHygiene,
  previewWorkspaceHygiene,
  type HygieneReport,
} from "../../src/domain/hygiene.js";
import type { Policy } from "../../src/types.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

type CompletionPlan = ReturnType<typeof planCompletion>;
type CompletionSummary = ReturnType<typeof summarizeCompletion>;
type CleanupPlan = ReturnType<typeof planWorktreeCleanup>;

interface MergeCompletionWorld extends WorkflowWorld {
  completionInputs: CompletionPlanInput[];
  completionPlans: CompletionPlan[];
  completionOutcome: CompletionOutcomeInput;
  completionSummary: CompletionSummary;
  completionSummaries: CompletionSummary[];
  cleanupPlans: CleanupPlan[];
  removeCalls: number;
  finalizeState: Parameters<typeof buildFinalizeReport>[0];
  finalizeReport: ReturnType<typeof buildFinalizeReport>;
  applyErrors: unknown[];
  hygieneRoots: string[];
  hygieneReports: HygieneReport[];
  repositoryRoot: string;
  targetWorktree: string;
  otherWorktree: string;
  mergeSha: string;
  evidenceFile: string;
  cliResult: SpawnSyncReturns<string>;
  cliPreview: Record<string, unknown>;
}

const { Given, When, Then } = stepDefinitions<MergeCompletionWorld>();

function readyRootUpdate() {
  return planRootUpdate({
    rootPath: "/repo",
    currentBranch: "main",
    defaultBranch: "main",
    dirty: false,
    untracked: [],
    upstreamRef: "origin/main",
    localSha: "a".repeat(40),
    upstreamSha: "b".repeat(40),
    remoteSha: "b".repeat(40),
    mergeSha: "b".repeat(40),
    fastForwardable: true,
  });
}

function rejectedRootUpdate() {
  return planRootUpdate({
    rootPath: "/repo",
    currentBranch: "feature/856",
    defaultBranch: "main",
    dirty: true,
    untracked: [],
    upstreamRef: "origin/main",
    localSha: "a".repeat(40),
    upstreamSha: "b".repeat(40),
    remoteSha: "b".repeat(40),
    mergeSha: "b".repeat(40),
    fastForwardable: true,
  });
}

function readyCleanup(): CleanupPlan {
  return planWorktreeCleanup({
    repositoryRoot: "/repo",
    target: { path: "/repo/.worktrees/target", branch: "feature/856" },
    registered: [{ path: "/repo/.worktrees/target", branch: "feature/856" }],
    prMerged: true,
    clean: true,
    pushed: true,
    remoteBranch: true,
    recoveryReachable: true,
    consumerAssets: [],
    stashes: [],
    temporaryArtifacts: [],
    ignoredArtifacts: [],
  });
}

function readyInput(): CompletionPlanInput {
  const digest = "c".repeat(64);
  return {
    mergeConfirmed: true,
    mergeSha: "b".repeat(40),
    rootUpdate: readyRootUpdate(),
    cleanup: readyCleanup(),
    cleanupAuthorityGranted: true,
    previewDigest: digest,
    approvedDigest: digest,
  };
}

function succeededPhases(): CompletionPhaseResult[] {
  return [
    "merge-confirm",
    "root-update",
    "cleanup-preview",
    "cleanup-apply",
    "post-verify",
  ].map((phase) => ({
    phase: phase as CompletionPhaseResult["phase"],
    state: "succeeded",
    reasons: [],
    recovery: [],
  }));
}

function trustedFinalizePolicy(): Policy {
  return {
    schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
    delivery: { stopAt: "pull_request" },
    merge: {
      mode: "disabled",
      branches: [],
      methods: [],
      requiredChecks: [],
      requiredReviews: 0,
    },
    rules: [
      {
        ruleId: "ASC-WTCLEAN-TEST-001",
        purpose: "safeな対象worktreeだけをcleanupする",
        riskClass: "identity",
        scope: ["worktree"],
        enforcement: "deny",
        activation: "active",
        owner: "policy owner",
        targetLayer: "package",
        evidence: "finalize report",
        remediation: "previewを再実行する",
        overridePolicy: "never",
        rollback: "対象worktreeを保持する",
      },
    ],
  };
}

function safeFinalizeState() {
  return {
    repository: "owner/repository",
    worktree: "/repo/.worktrees/target",
    branch: "feature/856",
    base: "main",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    dirty: false,
    untracked: [] as string[],
    stashes: [] as string[],
    temporaryArtifacts: [] as string[],
    ignoredArtifacts: [] as string[],
    pushed: true,
    remoteBranch: true,
    prMerged: true,
    specConsistent: true,
    testsPassed: true,
    reviewApproved: true,
    recoveryReachable: true,
    recoveryRef: "origin/feature/856",
  };
}

function fixtureGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function configureFixtureRepository(cwd: string): void {
  fixtureGit(cwd, ["config", "user.email", "test@example.invalid"]);
  fixtureGit(cwd, ["config", "user.name", "Test"]);
}

function completionCli(
  world: MergeCompletionWorld,
  args: string[],
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      path.resolve("dist", "bin", "agent-skill-chain.js"),
      "worktree",
      "finalize",
      `--root=${world.repositoryRoot}`,
      `--path=${world.targetWorktree}`,
      `--evidence=${world.evidenceFile}`,
      `--merge-sha=${world.mergeSha}`,
      "--complete",
      ...args,
    ],
    { cwd: world.repositoryRoot, encoding: "utf8" },
  );
}

Given("merge未確認とroot更新拒否の完了入力がある", function () {
  this.completionInputs = [
    { ...readyInput(), mergeConfirmed: false },
    { ...readyInput(), rootUpdate: rejectedRootUpdate() },
  ];
});

Given("cleanup authorityだけがない完了入力がある", function () {
  this.completionInputs = [{ ...readyInput(), cleanupAuthorityGranted: false }];
});

Given("digest不一致と不正digestの完了入力がある", function () {
  this.completionInputs = [
    { ...readyInput(), approvedDigest: "d".repeat(64) },
    { ...readyInput(), approvedDigest: "invalid" },
  ];
});

When("merge完了フローを計画する", function () {
  this.completionPlans = this.completionInputs.map((input) =>
    planCompletion(input),
  );
});

Then("cleanup phaseはすべてskippedになる", function () {
  for (const plan of this.completionPlans) {
    assert.equal(plan.state, "rejected");
    assert.deepEqual(
      plan.phases
        .filter((phase) => phase.phase.startsWith("cleanup-"))
        .map((phase) => phase.state),
      ["skipped", "skipped"],
    );
  }
});

Then("完了計画はcleanup authority待ちのpendingになる", function () {
  const plan = this.completionPlans[0];
  assert.equal(plan?.state, "pending");
  assert.deepEqual(plan?.requiredAuthority, ["worktree.cleanup"]);
  assert.equal(
    plan?.phases.find((phase) => phase.phase === "cleanup-apply")?.state,
    "pending",
  );
});

Then("cleanup applyは新しいpreviewを要求してrejectedになる", function () {
  for (const plan of this.completionPlans) {
    assert.equal(plan.state, "rejected");
    const apply = plan.phases.find((phase) => phase.phase === "cleanup-apply");
    assert.equal(apply?.state, "rejected");
    assert.match(apply?.recovery.join("\n") ?? "", /preview/u);
  }
});

Given("cleanup適用後に事後確認が一致しない完了結果がある", function () {
  this.completionOutcome = {
    phases: succeededPhases(),
    postVerify: {
      rootSha: "a".repeat(40),
      expectedRootSha: "b".repeat(40),
      targetPathAbsent: false,
      otherWorktreesUnchanged: false,
      containerState: "retained",
    },
  };
});

When("merge完了結果を要約する", function () {
  this.completionSummary = summarizeCompletion(this.completionOutcome);
});

Then("完了結果はpartially-completedになる", function () {
  assert.equal(this.completionSummary.state, "partially-completed");
  assert.match(
    this.completionSummary.recovery.join("\n"),
    /root|対象|worktree/u,
  );
});

Given("境界を偽装したworktree cleanup入力がある", function () {
  const base = {
    repositoryRoot: "/repo",
    target: { path: "/repo/.worktrees/pr-856", branch: "feature/856" },
    prMerged: true,
    clean: true,
    pushed: true,
    recoveryReachable: true,
    consumerAssets: [] as string[],
  };
  this.cleanupPlans = [
    planWorktreeCleanup({
      ...base,
      registered: [
        { path: `${base.target.path}-other`, branch: base.target.branch },
      ],
    }),
    planWorktreeCleanup({
      ...base,
      registered: [
        { path: "/repo/.worktrees/PR-856", branch: base.target.branch },
      ],
    }),
    planWorktreeCleanup({
      ...base,
      registered: [base.target, base.target],
    }),
    planWorktreeCleanup({
      ...base,
      registered: [{ path: base.target.path, branch: "feature/857" }],
    }),
    planWorktreeCleanup({
      ...base,
      target: { ...base.target, path: "/outside/pr-856" },
      registered: [{ path: "/outside/pr-856", branch: base.target.branch }],
    }),
    planWorktreeCleanup({
      ...base,
      targetCanonicalPath: "/real/pr-856",
      registered: [base.target],
    }),
  ];
});

When("偽装されたworktree cleanup対象を計画する", function () {
  assert.equal(this.cleanupPlans.length, 6);
});

Then("すべての偽装cleanup計画はrejectedになる", function () {
  assert.ok(this.cleanupPlans.every((plan) => plan.state === "rejected"));
});

Given("unsafeとunknownのcleanup観測がある", function () {
  const safe = {
    repositoryRoot: "/repo",
    target: { path: "/repo/.worktrees/target", branch: "feature/856" },
    registered: [{ path: "/repo/.worktrees/target", branch: "feature/856" }],
    prMerged: true,
    clean: true,
    pushed: true,
    recoveryReachable: true,
    consumerAssets: [] as string[],
  };
  this.cleanupPlans = [
    planWorktreeCleanup({ ...safe, clean: false }),
    planWorktreeCleanup({ ...safe, clean: false, consumerAssets: ["new"] }),
    planWorktreeCleanup({ ...safe, pushed: false }),
    planWorktreeCleanup({ ...safe, prMerged: false }),
    planWorktreeCleanup({ ...safe, recoveryReachable: false }),
    planWorktreeCleanup({ ...safe, consumerAssets: ["memo"] }),
    planWorktreeCleanup({ ...safe, clean: undefined }),
  ];
  this.removeCalls = 0;
});

When("unsafeなworktree cleanupを適用候補として判定する", function () {
  for (const plan of this.cleanupPlans)
    if (plan.state === "ready") this.removeCalls += 1;
});

Then("全観測で削除呼出は0件になる", function () {
  assert.ok(this.cleanupPlans.every((plan) => plan.state === "rejected"));
  assert.equal(this.removeCalls, 0);
});

Given("safe finalize reportと適用直前に変化した状態がある", function () {
  this.finalizeState = safeFinalizeState();
  this.finalizeReport = buildFinalizeReport(this.finalizeState);
  this.applyErrors = [];
  this.removeCalls = 0;
});

When("stale digestと変化後の状態でcleanup applyを試みる", function () {
  const inputs = [
    {
      approvedHash: "d".repeat(64),
      currentState: this.finalizeState,
    },
    {
      approvedHash: this.finalizeReport.hash,
      currentState: { ...this.finalizeState, dirty: true },
    },
  ];
  this.applyErrors = inputs.map((candidate) => {
    try {
      applyFinalize(
        {
          report: this.finalizeReport,
          approvedHash: candidate.approvedHash,
          currentState: candidate.currentState,
          trustedPolicy: trustedFinalizePolicy(),
        },
        () => {
          this.removeCalls += 1;
        },
      );
      return undefined;
    } catch (error) {
      return error;
    }
  });
});

Then("cleanup applyは削除せず新しいpreviewを要求する", function () {
  assert.equal(this.removeCalls, 0);
  assert.ok(this.applyErrors.every((error) => error instanceof Error));
  assert.match(
    this.applyErrors
      .map((error) => (error instanceof Error ? error.message : ""))
      .join("\n"),
    /ハッシュ|TOCTOU/u,
  );
  const stalePlan = planCompletion({
    ...readyInput(),
    approvedDigest: "d".repeat(64),
  });
  assert.match(
    stalePlan.phases.flatMap((phase) => phase.recovery).join("\n"),
    /preview/u,
  );
});

Given("空と非空のworktree containerを持つ隔離repositoryがある", function () {
  const emptyRoot = this.initRepo();
  const retainedRoot = this.initRepo();
  fs.mkdirSync(path.join(emptyRoot, ".worktrees", "target"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(retainedRoot, ".worktrees", "target"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(retainedRoot, ".worktrees", "other"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(retainedRoot, ".worktrees", "other", "asset.txt"),
    "keep\n",
  );
  this.hygieneRoots = [emptyRoot, retainedRoot];
});

When("completed worktree containerだけをhygieneで適用する", function () {
  const emptyRoot = this.hygieneRoots[0];
  const retainedRoot = this.hygieneRoots[1];
  assert.ok(emptyRoot);
  assert.ok(retainedRoot);
  fs.rmdirSync(path.join(emptyRoot, ".worktrees", "target"));
  fs.rmdirSync(path.join(retainedRoot, ".worktrees", "target"));
  this.hygieneReports = this.hygieneRoots.map((root) =>
    previewWorkspaceHygiene({ root }),
  );
  const emptyReport = this.hygieneReports[0];
  assert.ok(emptyReport);
  applyWorkspaceHygiene(
    {
      report: emptyReport,
      approvedHash: emptyReport.hash,
      root: emptyRoot,
      operations: ["completed-worktree-container"],
      paths: [".worktrees"],
    },
    (target) => fs.rmdirSync(target.path),
  );
});

Then("空containerだけが除去され非空containerは保持される", function () {
  const emptyRoot = this.hygieneRoots[0];
  const retainedRoot = this.hygieneRoots[1];
  const retainedReport = this.hygieneReports[1];
  assert.ok(emptyRoot);
  assert.ok(retainedRoot);
  assert.ok(retainedReport);
  assert.equal(fs.existsSync(path.join(emptyRoot, ".worktrees")), false);
  assert.equal(fs.existsSync(path.join(retainedRoot, ".worktrees")), true);
  assert.equal(
    retainedReport.candidates.some(
      (candidate) => candidate.relative === ".worktrees",
    ),
    false,
  );
});

Given(
  "merge済みmainとsafeな対象worktreeを持つ隔離CLI repositoryがある",
  function () {
    const fixture = this.temp("asc-wtclean-cli-");
    const remote = path.join(fixture, "remote.git");
    const seed = path.join(fixture, "seed");
    const root = path.join(fixture, "root");
    fs.mkdirSync(remote);
    fixtureGit(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
    fs.mkdirSync(seed);
    fixtureGit(seed, ["init", "-q", "-b", "main"]);
    configureFixtureRepository(seed);
    fs.writeFileSync(path.join(seed, "README.md"), "# fixture\n");
    fs.copyFileSync(path.resolve(".gitignore"), path.join(seed, ".gitignore"));
    fs.mkdirSync(path.join(seed, ".agent-skill-chain", "policy"), {
      recursive: true,
    });
    fs.copyFileSync(
      path.resolve(".agent-skill-chain", "policy", "default.json"),
      path.join(seed, ".agent-skill-chain", "policy", "default.json"),
    );
    fs.copyFileSync(
      path.resolve(".agent-skill-chain", "project-policy.json"),
      path.join(seed, ".agent-skill-chain", "project-policy.json"),
    );
    fs.cpSync(
      path.resolve(".agent-skill-chain", "project"),
      path.join(seed, ".agent-skill-chain", "project"),
      { recursive: true },
    );
    fixtureGit(seed, ["add", "README.md", ".gitignore", ".agent-skill-chain"]);
    fixtureGit(seed, ["commit", "-q", "-m", "trusted base"]);
    fixtureGit(seed, ["remote", "add", "origin", remote]);
    fixtureGit(seed, ["push", "-q", "-u", "origin", "main"]);
    fixtureGit(fixture, ["clone", "-q", remote, root]);
    configureFixtureRepository(root);
    fs.mkdirSync(path.join(root, ".worktrees"));
    this.targetWorktree = path.join(root, ".worktrees", "target");
    this.otherWorktree = path.join(root, ".worktrees", "other");
    fixtureGit(root, [
      "worktree",
      "add",
      "-q",
      "-b",
      "feature/856",
      this.targetWorktree,
    ]);
    fs.appendFileSync(path.join(this.targetWorktree, "README.md"), "merged\n");
    fixtureGit(this.targetWorktree, ["add", "README.md"]);
    fixtureGit(this.targetWorktree, ["commit", "-q", "-m", "feature"]);
    fixtureGit(this.targetWorktree, [
      "push",
      "-q",
      "-u",
      "origin",
      "feature/856",
    ]);
    fixtureGit(root, [
      "worktree",
      "add",
      "-q",
      "-b",
      "feature/other",
      this.otherWorktree,
      "main",
    ]);
    fixtureGit(seed, ["fetch", "-q", "origin", "feature/856"]);
    fixtureGit(seed, ["merge", "--ff-only", "origin/feature/856"]);
    fixtureGit(seed, ["push", "-q", "origin", "main"]);
    this.mergeSha = fixtureGit(seed, ["rev-parse", "HEAD"]);
    fixtureGit(root, ["fetch", "-q", "origin", "main"]);
    this.evidenceFile = path.join(fixture, "evidence.json");
    fs.writeFileSync(
      this.evidenceFile,
      `${JSON.stringify({
        repository: "owner/repository",
        base: "main",
        specConsistent: true,
        testsPassed: true,
        reviewApproved: true,
        prMerged: true,
      })}\n`,
    );
    this.repositoryRoot = root;
  },
);

When("cleanup previewを承認してmerge完了CLIをapplyする", function () {
  const preview = completionCli(this, ["--dry-run"]);
  assert.equal(preview.status, 1);
  const parsed: unknown = JSON.parse(preview.stdout);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  this.cliPreview = parsed as Record<string, unknown>;
  const digest = this.cliPreview.previewDigest;
  assert.equal(typeof digest, "string");
  this.cliResult = completionCli(this, [
    "--apply",
    "--authorize=approved",
    "--cleanup-authority",
    `--approved-digest=${String(digest)}`,
  ]);
});

Then("main更新と対象cleanupだけがcompletedになる", function () {
  assert.equal(this.cliResult.status, 0, this.cliResult.stdout);
  const output: unknown = JSON.parse(this.cliResult.stdout);
  assert.ok(output && typeof output === "object" && !Array.isArray(output));
  assert.equal((output as Record<string, unknown>).state, "completed");
  assert.equal(
    fixtureGit(this.repositoryRoot, ["rev-parse", "HEAD"]),
    this.mergeSha,
  );
  assert.equal(fs.existsSync(this.targetWorktree), false);
  assert.equal(fs.existsSync(this.otherWorktree), true);
  assert.equal(
    fixtureGit(this.repositoryRoot, [
      "show-ref",
      "--verify",
      "refs/heads/feature/856",
    ]).length > 0,
    true,
  );
});

When("cleanup authorityなしでmerge完了CLIをapplyする", function () {
  this.cliResult = completionCli(this, ["--apply", "--authorize=approved"]);
});

Then("mainは更新されcleanup pendingで対象は保持される", function () {
  assert.equal(this.cliResult.status, 1);
  const output: unknown = JSON.parse(this.cliResult.stdout);
  assert.ok(output && typeof output === "object" && !Array.isArray(output));
  const record = output as Record<string, unknown>;
  assert.equal(record.state, "pending");
  assert.deepEqual(record.requiredAuthority, ["worktree.cleanup"]);
  assert.equal(
    fixtureGit(this.repositoryRoot, ["rev-parse", "HEAD"]),
    this.mergeSha,
  );
  assert.equal(fs.existsSync(this.targetWorktree), true);
});

Given("cleanup失敗後のroot currentな完了phaseがある", function () {
  const phases = succeededPhases();
  const cleanupApply = phases.find((phase) => phase.phase === "cleanup-apply");
  if (cleanupApply) {
    cleanupApply.state = "rejected";
    cleanupApply.reasons = ["Git worktree removeに失敗しました"];
  }
  this.completionOutcome = {
    phases,
    postVerify: {
      rootSha: "b".repeat(40),
      expectedRootSha: "b".repeat(40),
      targetPathAbsent: false,
      otherWorktreesUnchanged: true,
      containerState: "retained",
    },
  };
});

When("同じ完了結果を事後確認し直す", function () {
  const initial = summarizeCompletion(this.completionOutcome);
  const converged: CompletionOutcomeInput = {
    phases: succeededPhases(),
    postVerify: {
      ...this.completionOutcome.postVerify,
      targetPathAbsent: true,
      containerState: "absent",
    },
  };
  this.completionSummaries = [initial, summarizeCompletion(converged)];
});

Then("初回はpartially-completedで再確認後はcompletedになる", function () {
  assert.deepEqual(
    this.completionSummaries.map((summary) => summary.state),
    ["partially-completed", "completed"],
  );
});
