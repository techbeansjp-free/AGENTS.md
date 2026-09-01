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
  remote: string;
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
  artifact: "dist" | "ignored-env" | "untracked" | "remote-deleted",
): void {
  world.root = world.initRepo();
  const remote = world.temp("asc-finalign-remote-");
  world.remote = remote;
  git(remote, ["init", "--bare"]);
  fs.writeFileSync(
    path.join(world.root, ".gitignore"),
    ".worktrees/\ndist/\nnode_modules/\n.env\n",
  );
  /**
   * apply経路は既定branch上のtrusted policyを要求する。
   * `package default safety floorがありません`で止まるため同梱する（Issue #1099）。
   */
  fs.mkdirSync(path.join(world.root, ".agent-skill-chain", "policy"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.resolve(".agent-skill-chain", "policy", "default.json"),
    path.join(world.root, ".agent-skill-chain", "policy", "default.json"),
  );
  fs.copyFileSync(
    path.resolve(".agent-skill-chain", "project-policy.json"),
    path.join(world.root, ".agent-skill-chain", "project-policy.json"),
  );
  fs.cpSync(
    path.resolve(".agent-skill-chain", "project"),
    path.join(world.root, ".agent-skill-chain", "project"),
    { recursive: true },
  );
  git(world.root, ["add", ".gitignore", ".agent-skill-chain"]);
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
  else if (artifact === "remote-deleted") {
    /**
     * PRがmergeされremote branchが削除された着地形。**remote側のrefだけを消す。**
     * `push --delete`はlocalのremote-tracking refまで消してしまい、実運用で頻出する
     * 「prune前の陳腐化したtracking refが残る」形にならない（Issue #1097の実測）。
     */
    git(world.remote, ["update-ref", "-d", "refs/heads/bugfix/894-finalign"]);
    git(world.worktree, ["merge", "--ff-only", "main"]);
  } else
    fs.writeFileSync(path.join(world.worktree, "pending.txt"), "pending\n");

  /**
   * evidence fileはroot外へ置く。root直下に置くと未追跡fileとなり、
   * `--complete`のroot-update phaseが`root worktreeに変更または未追跡ファイルがあります`
   * で拒否してcleanup phaseへ到達しない（Issue #1099の実測）。
   */
  world.evidence = path.join(
    world.temp("asc-finalign-evidence-"),
    "finalize-evidence.json",
  );
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

Given("remote branchを失ったmerge済みfinalize fixtureがある", function () {
  createFinalizeFixture(this, "remote-deleted");
});

Given("未追跡fileを持つmerge済みfinalize fixtureがある", function () {
  createFinalizeFixture(this, "untracked");
});

When("fixture worktreeをfinalize dry-runする", function () {
  finalizeDryRun(this);
});

When("fixture worktreeを--completeでfinalize dry-runする", function () {
  this.finalizeProcess = runCli([
    "worktree",
    "finalize",
    `--root=${this.root}`,
    `--path=${this.worktree}`,
    `--evidence=${this.evidence}`,
    `--merge-sha=${git(this.root, ["rev-parse", "HEAD"])}`,
    "--complete",
    "--dry-run",
  ]);
});

When("fixture worktreeを--completeでfinalize applyする", function () {
  const preview = runCli([
    "worktree",
    "finalize",
    `--root=${this.root}`,
    `--path=${this.worktree}`,
    `--evidence=${this.evidence}`,
    `--merge-sha=${git(this.root, ["rev-parse", "HEAD"])}`,
    "--complete",
    "--dry-run",
  ]);
  const parsedPreview = JSON.parse(preview.stdout) as {
    previewDigest?: string;
  };
  assert.equal(typeof parsedPreview.previewDigest, "string");
  this.finalizeProcess = runCli([
    "worktree",
    "finalize",
    `--root=${this.root}`,
    `--path=${this.worktree}`,
    `--evidence=${this.evidence}`,
    `--merge-sha=${git(this.root, ["rev-parse", "HEAD"])}`,
    `--approved-digest=${String(parsedPreview.previewDigest)}`,
    "--complete",
    "--authorize=approved",
    "--cleanup-authority",
    "--apply",
  ]);
});

/**
 * **apply実行時に再計算されるcleanup計画**を観測する。`executeCompletionFlow`は
 * apply経路でstateを取り直して`planWorktreeCleanup`を呼び直すため、dry-runとは
 * 別の呼び出しを通る（Issue #1099）。
 *
 * 完了そのものは検査しない。fixtureにtrusted policyのsafety floorが無く
 * `cleanup-apply`が別理由で止まるためで、本scenarioが測る量ではない。
 */
When("fixture worktreeをfinalize applyする", function () {
  const preview = runCli([
    "worktree",
    "finalize",
    `--root=${this.root}`,
    `--path=${this.worktree}`,
    `--evidence=${this.evidence}`,
    "--dry-run",
  ]);
  const parsedPreview = JSON.parse(preview.stdout) as { hash?: string };
  assert.equal(typeof parsedPreview.hash, "string");
  this.finalizeProcess = runCli([
    "worktree",
    "finalize",
    `--root=${this.root}`,
    `--path=${this.worktree}`,
    `--evidence=${this.evidence}`,
    `--report-hash=${String(parsedPreview.hash)}`,
    "--authorize=approved",
    "--apply",
  ]);
});

/**
 * **`--complete`を伴わないapply経路**で再計算されるcleanup計画を観測する。
 * `executeCompletionFlow`とは別の呼び出しを通る（Issue #1099）。
 */
Then("applyはworktreeを削除しbranchを保持する", function () {
  const parsed = JSON.parse(this.finalizeProcess.stdout) as {
    state?: string;
    branchPreserved?: boolean;
  };
  assert.equal(
    parsed.state,
    "finalized",
    `finalizeされません: ${this.finalizeProcess.stdout.slice(0, 400)}`,
  );
  assert.equal(parsed.branchPreserved, true);
  assert.equal(fs.existsSync(this.worktree), false);
});

Then("apply時のcleanup preview phaseも拒否されない", function () {
  const parsed = parsedFinalize(this) as {
    phases?: Array<{ phase: string; state: string; reasons?: string[] }>;
  };
  const preview = parsed.phases?.find(
    (phase) => phase.phase === "cleanup-preview",
  );
  assert.ok(preview, "cleanup-preview phaseがありません");
  assert.deepEqual(preview.reasons ?? [], []);
  assert.equal(preview.state, "succeeded");
});

Then("cleanup preview phaseは拒否されない", function () {
  const parsed = parsedFinalize(this) as {
    phases?: Array<{ phase: string; state: string; reasons?: string[] }>;
  };
  const preview = parsed.phases?.find(
    (phase) => phase.phase === "cleanup-preview",
  );
  assert.ok(preview, "cleanup-preview phaseがありません");
  assert.equal(
    preview.state,
    "succeeded",
    `cleanup previewが成立しません: ${JSON.stringify(preview.reasons)}`,
  );
});

Then("cleanup計画はreadyである", function () {
  const parsed = parsedFinalize(this) as {
    cleanup?: { state?: string; reasons?: string[] };
  };
  const cleanup = parsed.cleanup;
  assert.ok(cleanup, "cleanup計画がありません");
  assert.deepEqual(cleanup.reasons ?? [], []);
  assert.equal(cleanup.state, "ready");
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
