import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface FinalizeIgnoredCliWorld extends WorkflowWorld {
  root: string;
  worktree: string;
  evidence: string;
  finalizeProcess: SpawnSyncReturns<string>;
  surveyProcess: SpawnSyncReturns<string>;
  surveyResult: Record<string, unknown>;
}

const { Given, When, Then } = stepDefinitions<FinalizeIgnoredCliWorld>();

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", path.resolve("bin/agent-skill-chain.ts"), ...args],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
}

function createFinalizeFixture(
  world: FinalizeIgnoredCliWorld,
  artifact: "dist" | "ignored-env" | "untracked",
): void {
  world.root = world.initRepo();
  const remote = world.temp("asc-finalign-remote-");
  git(remote, ["init", "--bare"]);
  fs.writeFileSync(
    path.join(world.root, ".gitignore"),
    ".worktrees/\ndist/\nnode_modules/\n.env\n",
  );
  git(world.root, ["add", ".gitignore"]);
  git(world.root, ["commit", "-m", "fixture: ignore policy"]);
  git(world.root, ["remote", "add", "origin", remote]);
  git(world.root, ["push", "-u", "origin", "main"]);
  git(world.root, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);
  world.worktree = path.join(world.root, ".worktrees", "894-finalign");
  fs.mkdirSync(path.dirname(world.worktree), { recursive: true });
  git(world.root, [
    "worktree",
    "add",
    "-b",
    "bugfix/894-finalign",
    world.worktree,
    "origin/main",
  ]);
  fs.writeFileSync(path.join(world.worktree, "implementation.txt"), "done\n");
  git(world.worktree, ["add", "implementation.txt"]);
  git(world.worktree, ["commit", "-m", "fix: fixture implementation"]);
  git(world.worktree, ["push", "-u", "origin", "bugfix/894-finalign"]);
  git(world.root, [
    "merge",
    "--no-ff",
    "bugfix/894-finalign",
    "-m",
    "merge fixture",
  ]);
  git(world.root, ["push", "origin", "main"]);

  if (artifact === "dist") {
    fs.mkdirSync(path.join(world.worktree, "dist", "src"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(world.worktree, "dist", "src", "cli.js"), "x\n");
  } else if (artifact === "ignored-env")
    fs.writeFileSync(path.join(world.worktree, ".env"), "SECRET=fixture\n");
  else fs.writeFileSync(path.join(world.worktree, "pending.txt"), "pending\n");

  world.evidence = path.join(world.root, "finalize-evidence.json");
  fs.writeFileSync(
    world.evidence,
    `${JSON.stringify({
      repository: "fixture/repository",
      base: "main",
      specConsistent: true,
      testsPassed: true,
      reviewApproved: true,
      prMerged: true,
    })}\n`,
  );
}

function finalizeDryRun(world: FinalizeIgnoredCliWorld): void {
  world.finalizeProcess = runCli([
    "worktree",
    "finalize",
    `--root=${world.root}`,
    `--path=${world.worktree}`,
    `--evidence=${world.evidence}`,
    "--dry-run",
  ]);
}

function parsedFinalize(world: FinalizeIgnoredCliWorld) {
  assert.equal(world.finalizeProcess.error, undefined);
  return JSON.parse(world.finalizeProcess.stdout) as Record<string, unknown>;
}

Given("distだけを持つmerge済みfinalize fixtureがある", function () {
  createFinalizeFixture(this, "dist");
});

Given("ignore済み.envを持つmerge済みfinalize fixtureがある", function () {
  createFinalizeFixture(this, "ignored-env");
});

Given("未追跡fileを持つmerge済みfinalize fixtureがある", function () {
  createFinalizeFixture(this, "untracked");
});

When("fixture worktreeをfinalize dry-runする", function () {
  finalizeDryRun(this);
});

When("fixture worktreeをsurveyしてfinalize dry-runする", function () {
  this.surveyProcess = runCli(["worktree", "survey", `--root=${this.root}`]);
  assert.equal(this.surveyProcess.error, undefined);
  this.surveyResult = JSON.parse(this.surveyProcess.stdout) as Record<
    string,
    unknown
  >;
  finalizeDryRun(this);
});

Then("finalize dry-runは対象を受理する", function () {
  const result = parsedFinalize(this);
  assert.equal(this.finalizeProcess.status, 0, this.finalizeProcess.stdout);
  assert.equal(result.safe, true);
  assert.equal((result.cleanup as Record<string, unknown>).state, "ready");
});

Then("finalize dry-runは.envのpathを示して拒否する", function () {
  const result = parsedFinalize(this);
  assert.equal(this.finalizeProcess.status, 1);
  assert.equal(result.safe, false);
  assert.ok(
    (result.reasons as string[]).some((reason) => reason.includes(".env")),
  );
});

Then("cleanup-readyの対象をfinalize dry-runが受理する", function () {
  assert.ok(
    (this.surveyResult.cleanupReady as string[]).includes(this.worktree),
  );
  assert.equal(this.finalizeProcess.status, 0, this.finalizeProcess.stdout);
});

Then("retainの対象をfinalize dry-runが拒否する", function () {
  assert.ok((this.surveyResult.retained as string[]).includes(this.worktree));
  assert.equal(this.finalizeProcess.status, 1);
});

Then("finalize dry-runは拒否しfixture worktreeを保持する", function () {
  assert.equal(this.finalizeProcess.status, 1);
  assert.equal(fs.existsSync(this.worktree), true);
  assert.match(
    git(this.root, ["worktree", "list", "--porcelain"]),
    /bugfix\/894-finalign/u,
  );
});
