import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  planRootUpdate,
  planWorktreeCleanup,
  type RootUpdateObservation,
} from "../../src/domain/finalize.js";
import { validateIssueClosingReferences } from "../../src/domain/delivery.js";

type RootPlan = ReturnType<typeof planRootUpdate>;
type CleanupPlan = ReturnType<typeof planWorktreeCleanup>;
type ReferenceResult = ReturnType<typeof validateIssueClosingReferences>;

interface FinalizeRootUpdateWorld extends WorkflowWorld {
  rootObservation: RootUpdateObservation;
  rootPlan: RootPlan;
  cleanupPlans: CleanupPlan[];
  referenceBody: string;
  referenceResult: ReferenceResult;
  repositoryRoot: string;
  remoteSha: string;
  initialHead: string;
  initialStatus: string;
  targetWorktree: string;
  otherWorktree: string;
  prunableMetadata: string;
  cleanupPlan: CleanupPlan;
  evidenceFile: string;
  initialWorktrees: string;
  cliResult: SpawnSyncReturns<string>;
}

const { Given, When, Then } = stepDefinitions<FinalizeRootUpdateWorld>();

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function configureRepository(cwd: string): void {
  git(cwd, ["config", "user.email", "test@example.invalid"]);
  git(cwd, ["config", "user.name", "Test"]);
}

function initializeRepository(cwd: string): void {
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, ["init", "-q", "-b", "main"]);
  configureRepository(cwd);
  fs.writeFileSync(path.join(cwd, "README.md"), "# fixture\n");
  git(cwd, ["add", "README.md"]);
  git(cwd, ["commit", "-q", "-m", "fixture"]);
}

function safeRootObservation(): RootUpdateObservation {
  return {
    rootPath: "/tmp/root",
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
  };
}

function observeRoot(root: string, mergeSha: string): RootUpdateObservation {
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ])
    .split(/\r?\n/u)
    .filter(Boolean);
  const upstreamRef = git(root, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  const localSha = git(root, ["rev-parse", "HEAD"]);
  const fastForward = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", localSha, mergeSha],
    { cwd: root, encoding: "utf8" },
  );
  return {
    rootPath: fs.realpathSync(root),
    currentBranch: git(root, ["branch", "--show-current"]),
    defaultBranch: "main",
    dirty: status.some((line) => !line.startsWith("?? ")),
    untracked: status
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3)),
    upstreamRef,
    localSha,
    upstreamSha: git(root, ["rev-parse", "@{upstream}"]),
    remoteSha: git(root, ["rev-parse", "refs/remotes/origin/main"]),
    mergeSha,
    fastForwardable: fastForward.status === 0,
  };
}

function setupMergedRemote(world: FinalizeRootUpdateWorld): void {
  const fixture = world.temp("asc-root-update-");
  const remote = path.join(fixture, "remote.git");
  const seed = path.join(fixture, "seed");
  const root = path.join(fixture, "root");
  const publisher = path.join(fixture, "publisher");
  fs.mkdirSync(remote);
  git(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  initializeRepository(seed);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "-q", "-u", "origin", "main"]);
  git(fixture, ["clone", "-q", remote, root]);
  git(fixture, ["clone", "-q", remote, publisher]);
  configureRepository(root);
  configureRepository(publisher);
  fs.appendFileSync(path.join(publisher, "README.md"), "merged\n");
  git(publisher, ["add", "README.md"]);
  git(publisher, ["commit", "-q", "-m", "merged change"]);
  git(publisher, ["push", "-q", "origin", "main"]);
  world.repositoryRoot = root;
  world.remoteSha = git(publisher, ["rev-parse", "HEAD"]);
  world.initialHead = git(root, ["rev-parse", "HEAD"]);
  world.initialStatus = git(root, ["status", "--porcelain=v1"]);
}

Given("cleanなroot mainの更新観測がある", function () {
  this.rootObservation = safeRootObservation();
});

Given("dirty・非既定branch・upstream不明のroot更新観測がある", function () {
  this.rootObservation = {
    ...safeRootObservation(),
    currentBranch: "feature/x",
    dirty: true,
    upstreamRef: undefined,
  };
});

Given("remote SHA不一致かつdivergedなroot更新観測がある", function () {
  this.rootObservation = {
    ...safeRootObservation(),
    upstreamSha: "c".repeat(40),
    fastForwardable: false,
  };
});

Given("既にmerge SHAへ到達したroot更新観測がある", function () {
  this.rootObservation = {
    ...safeRootObservation(),
    localSha: "b".repeat(40),
    fastForwardable: false,
  };
});

When("root更新を計画する", function () {
  this.rootPlan = planRootUpdate(this.rootObservation);
});

Then("root更新計画はreadyである", function () {
  assert.equal(this.rootPlan.state, "ready");
  assert.deepEqual(this.rootPlan.reasons, []);
});

Then("root更新計画は3つの安全理由でrejectedである", function () {
  assert.equal(this.rootPlan.state, "rejected");
  assert.equal(this.rootPlan.reasons.length, 3);
  assert.match(this.rootPlan.reasons.join("\n"), /既定branch/u);
  assert.match(this.rootPlan.reasons.join("\n"), /変更または未追跡/u);
  assert.match(this.rootPlan.reasons.join("\n"), /upstreamが不明/u);
});

Then("root更新計画はremote同一性とfast-forward不可を報告する", function () {
  assert.equal(this.rootPlan.state, "rejected");
  assert.match(this.rootPlan.reasons.join("\n"), /upstream SHAとremote SHA/u);
  assert.match(this.rootPlan.reasons.join("\n"), /fast-forwardできません/u);
});

Then("root更新計画はfromとtoが同じreadyである", function () {
  assert.equal(this.rootPlan.state, "ready");
  assert.equal(this.rootPlan.from, this.rootPlan.to);
  assert.deepEqual(this.rootPlan.reasons, []);
});

Given(
  "完全一致・prefix一致・大小文字違い・重複のworktree登録がある",
  function () {
    const base = {
      target: { path: "/tmp/pr-829", branch: "feature/829" },
      prMerged: true,
      clean: true,
      pushed: true,
      recoveryReachable: true,
      consumerAssets: [] as string[],
    };
    this.cleanupPlans = [
      planWorktreeCleanup({
        ...base,
        registered: [base.target, { path: "/tmp/other", branch: "other" }],
      }),
      planWorktreeCleanup({
        ...base,
        registered: [{ path: "/tmp/pr-829-extra", branch: "feature/829" }],
      }),
      planWorktreeCleanup({
        ...base,
        registered: [{ path: "/tmp/PR-829", branch: "feature/829" }],
      }),
      planWorktreeCleanup({
        ...base,
        registered: [base.target, base.target],
      }),
    ];
  },
);

When("worktree cleanup対象を計画する", function () {
  assert.equal(this.cleanupPlans.length, 4);
});

Then("完全一致1件だけがreadyで他の照合はrejectedである", function () {
  assert.deepEqual(
    this.cleanupPlans.map((plan) => plan.state),
    ["ready", "rejected", "rejected", "rejected"],
  );
});

Given(
  "canonical IssueをCLOSESで後続IssueをRelates toで参照する本文がある",
  function () {
    this.referenceBody = "CLOSES #829\n\nRelates to #824";
  },
);

Given(
  "canonical Issueと後続Issueを終端keywordで参照する本文がある",
  function () {
    this.referenceBody = "Closed #829\n\nFixes #824";
  },
);

When("Issue終了参照を検証する", function () {
  this.referenceResult = validateIssueClosingReferences(this.referenceBody, {
    canonicalIssue: 829,
    relatedIssues: [824],
  });
});

Then("canonical Issueだけを自動closeする本文はvalidである", function () {
  assert.equal(this.referenceResult.valid, true);
  assert.deepEqual(this.referenceResult.closes, [829]);
  assert.deepEqual(this.referenceResult.relates, [824]);
});

Then("後続Issueを自動closeする本文はinvalidである", function () {
  assert.equal(this.referenceResult.valid, false);
  assert.match(this.referenceResult.errors.join("\n"), /#824/u);
});

Given("merge済みremoteを持つ隔離root repositoryがある", function () {
  setupMergedRemote(this);
});

When("検証済みmerge SHAへrootをfast-forwardする", function () {
  git(this.repositoryRoot, ["fetch", "-q", "origin", "main"]);
  this.rootPlan = planRootUpdate(
    observeRoot(this.repositoryRoot, this.remoteSha),
  );
  assert.equal(this.rootPlan.state, "ready");
  git(this.repositoryRoot, ["merge", "--ff-only", this.remoteSha]);
});

Then("隔離rootのHEADはremote merge SHAと一致する", function () {
  assert.notEqual(this.initialHead, this.remoteSha);
  assert.equal(git(this.repositoryRoot, ["rev-parse", "HEAD"]), this.remoteSha);
});

Given("merge済みremoteを持つdirtyな隔離root repositoryがある", function () {
  setupMergedRemote(this);
  fs.appendFileSync(path.join(this.repositoryRoot, "README.md"), "dirty\n");
  this.initialHead = git(this.repositoryRoot, ["rev-parse", "HEAD"]);
  this.initialStatus = git(this.repositoryRoot, ["status", "--porcelain=v1"]);
});

When("dirtyな隔離rootの更新を計画する", function () {
  this.rootPlan = planRootUpdate(
    observeRoot(this.repositoryRoot, this.remoteSha),
  );
});

Then("隔離rootのHEADと作業内容を変更せずrejectedになる", function () {
  assert.equal(this.rootPlan.state, "rejected");
  assert.equal(
    git(this.repositoryRoot, ["rev-parse", "HEAD"]),
    this.initialHead,
  );
  assert.equal(
    git(this.repositoryRoot, ["status", "--porcelain=v1"]),
    this.initialStatus,
  );
});

Given("対象・他作業・prunable metadataを持つ隔離repositoryがある", function () {
  const fixture = this.temp("asc-cleanup-");
  const root = path.join(fixture, "root");
  initializeRepository(root);
  this.repositoryRoot = root;
  this.targetWorktree = path.join(fixture, "target");
  this.otherWorktree = path.join(fixture, "other");
  const staleWorktree = path.join(fixture, "stale");
  git(root, [
    "worktree",
    "add",
    "-q",
    "-b",
    "feature/target",
    this.targetWorktree,
  ]);
  git(root, [
    "worktree",
    "add",
    "-q",
    "-b",
    "feature/other",
    this.otherWorktree,
  ]);
  git(root, ["worktree", "add", "-q", "-b", "feature/stale", staleWorktree]);
  this.prunableMetadata = path.join(root, ".git", "worktrees", "stale");
  fs.rmSync(staleWorktree, { recursive: true });
  this.cleanupPlan = planWorktreeCleanup({
    target: { path: this.targetWorktree, branch: "feature/target" },
    registered: [
      { path: root, branch: "main" },
      { path: this.targetWorktree, branch: "feature/target" },
      { path: this.otherWorktree, branch: "feature/other" },
      { path: staleWorktree, branch: "feature/stale" },
    ],
    prMerged: true,
    clean: true,
    pushed: true,
    recoveryReachable: true,
    consumerAssets: [],
  });
});

When("完全一致した対象worktreeだけをcleanupする", function () {
  assert.equal(this.cleanupPlan.state, "ready");
  git(this.repositoryRoot, ["worktree", "remove", this.cleanupPlan.target]);
});

Then("他worktreeとprunable metadataは保持される", function () {
  assert.equal(fs.existsSync(this.targetWorktree), false);
  assert.equal(fs.existsSync(this.otherWorktree), true);
  assert.equal(fs.existsSync(this.prunableMetadata), true);
  assert.match(
    git(this.repositoryRoot, ["worktree", "list", "--porcelain"]),
    /feature\/other/u,
  );
});

Given("finalize対象とdirtyなrootを持つ隔離CLI repositoryがある", function () {
  const fixture = this.temp("asc-finalize-cli-");
  const remote = path.join(fixture, "remote.git");
  const seed = path.join(fixture, "seed");
  const root = path.join(fixture, "root");
  fs.mkdirSync(remote);
  git(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  initializeRepository(seed);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "-q", "-u", "origin", "main"]);
  git(fixture, ["clone", "-q", remote, root]);
  configureRepository(root);
  const target = path.join(fixture, "target");
  git(root, ["worktree", "add", "-q", "-b", "feature/pr-829", target]);
  git(target, ["push", "-q", "-u", "origin", "feature/pr-829"]);
  fs.appendFileSync(path.join(root, "README.md"), "dirty\n");
  const evidence = path.join(fixture, "evidence.json");
  fs.writeFileSync(
    evidence,
    `${JSON.stringify({
      repository: "o/r",
      base: "main",
      specConsistent: true,
      testsPassed: true,
      reviewApproved: true,
      prMerged: true,
    })}\n`,
  );
  this.repositoryRoot = root;
  this.targetWorktree = target;
  this.evidenceFile = evidence;
  this.remoteSha = git(root, ["rev-parse", "refs/remotes/origin/main"]);
  this.initialHead = git(root, ["rev-parse", "HEAD"]);
  this.initialStatus = git(root, ["status", "--porcelain=v1"]);
  this.initialWorktrees = git(root, ["worktree", "list", "--porcelain"]);
});

When("update-root付きfinalize CLIをdry-runする", function () {
  const cli = path.resolve(
    process.cwd(),
    "dist",
    "bin",
    "agent-skill-chain.js",
  );
  this.cliResult = spawnSync(
    process.execPath,
    [
      cli,
      "worktree",
      "finalize",
      `--root=${this.repositoryRoot}`,
      `--path=${this.targetWorktree}`,
      `--evidence=${this.evidenceFile}`,
      `--merge-sha=${this.remoteSha}`,
      "--update-root",
      "--dry-run",
    ],
    { cwd: this.repositoryRoot, encoding: "utf8" },
  );
});

Then("CLIは非0でroot HEADと作業内容と全worktreeを保持する", function () {
  assert.notEqual(this.cliResult.status, 0);
  assert.match(this.cliResult.stdout, /rootUpdate/u);
  assert.match(this.cliResult.stdout, /rejected/u);
  assert.equal(
    git(this.repositoryRoot, ["rev-parse", "HEAD"]),
    this.initialHead,
  );
  assert.equal(
    git(this.repositoryRoot, ["status", "--porcelain=v1"]),
    this.initialStatus,
  );
  assert.equal(
    git(this.repositoryRoot, ["worktree", "list", "--porcelain"]),
    this.initialWorktrees,
  );
  assert.equal(fs.existsSync(this.targetWorktree), true);
});
