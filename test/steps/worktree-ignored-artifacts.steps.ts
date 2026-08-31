import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { inspectFinalizeState } from "../../src/domain/worktree.js";
import { buildFinalizeReport } from "../../src/domain/finalize.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface FinalizeReport {
  safe: boolean;
  reasons: string[];
  snapshot: { ignoredArtifacts?: unknown };
}

class IgnoredArtifactsWorld extends WorkflowWorld {
  repositoryRoot = "";
  worktree = "";
  ignoredNames: string[] = [];
  reports: FinalizeReport[] = [];
  cliStdout = "";
}

const { Given, When, Then } = stepDefinitions<IgnoredArtifactsWorld>();

const EVIDENCE = {
  repository: "owner/repo",
  base: "main",
  specConsistent: true,
  testsPassed: true,
  reviewApproved: true,
  prMerged: true,
} as const;

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
}

/**
 * 無視対象の種別ごとにfile名を決める。
 *
 * **絶対pathと`..`・`.git` segmentは作らない。** `git ls-files`はrepository相対path
 * しか出力せず、filesystemも`..`というsegment名のentryを作れない。
 */
function ignoredNamesFor(kind: string): string[] {
  if (kind === "非ASCII名") return ["ignored/メモ.txt"];
  if (kind === "改行を含む名前") return ["ignored/a\nb.txt"];
  if (kind === "ASCII名のみ") return ["ignored/alpha.txt", "ignored/beta.txt"];
  if (kind === "危険なpath")
    return ["ignored/tab\tname.txt", `ignored/${"ガ".normalize("NFD")}.txt`];
  if (kind === "allowlist済み非ASCII名") return ["node_modules/メモ.txt"];
  throw new Error(`未知の無視対象種別です: ${kind}`);
}

function allowlistFor(kind: string): string[] {
  /**
   * **非ASCII prefixはallowlistとして使えない。** `isSafeFinalizeIgnoredPathPrefix`が
   * segmentを`/^[A-Za-z0-9._-]+$/u`へ限定するため、ASCII prefix配下へ非ASCII名を置く。
   */
  if (kind === "allowlist済み非ASCII名") return ["node_modules/"];
  return [];
}

function createIsolatedWorktree(world: IgnoredArtifactsWorld): void {
  world.repositoryRoot = world.initRepo();
  fs.writeFileSync(
    path.join(world.repositoryRoot, ".gitignore"),
    "ignored/\nnode_modules/\n",
  );
  runGit(world.repositoryRoot, ["add", ".gitignore"]);
  runGit(world.repositoryRoot, ["commit", "-q", "-m", "ignore"]);
  const remote = world.temp("asc-wtign-remote-");
  runGit(remote, ["init", "--bare"]);
  runGit(world.repositoryRoot, ["remote", "add", "origin", remote]);
  runGit(world.repositoryRoot, ["push", "-u", "origin", "main"]);
  runGit(world.repositoryRoot, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);
  world.worktree = path.join(
    world.repositoryRoot,
    ".worktrees",
    "20260831_120000-1034-ignored",
  );
  fs.mkdirSync(path.dirname(world.worktree), { recursive: true });
  runGit(world.repositoryRoot, [
    "worktree",
    "add",
    "-b",
    "bugfix/1034-ignored",
    world.worktree,
    "origin/main",
  ]);
  fs.writeFileSync(path.join(world.worktree, "tracked.txt"), "tracked\n");
  runGit(world.worktree, ["add", "tracked.txt"]);
  runGit(world.worktree, ["commit", "-q", "-m", "fixture"]);
  runGit(world.worktree, ["push", "-u", "origin", "bugfix/1034-ignored"]);
}

function report(world: IgnoredArtifactsWorld, kind: string): FinalizeReport {
  const state = inspectFinalizeState(
    world.repositoryRoot,
    world.worktree,
    EVIDENCE,
    allowlistFor(kind),
  );
  return buildFinalizeReport(state as never) as unknown as FinalizeReport;
}

Given("{string}の無視対象を持つ隔離worktreeがある", function (kind: string) {
  createIsolatedWorktree(this);
  this.ignoredNames = ignoredNamesFor(kind);
  for (const relative of this.ignoredNames) {
    const file = path.join(this.worktree, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "ignored\n");
  }
  this.value = kind;
});

When("worktreeの後片付け可否を観測する", function () {
  this.reports = [report(this, String(this.value))];
});

When("quotepathをtrueとfalseの両方にして後片付け可否を観測する", function () {
  this.reports = ["true", "false"].map((quotepath) => {
    runGit(this.worktree, ["config", "core.quotepath", quotepath]);
    return report(this, String(this.value));
  });
});

When("隔離repositoryへworktree survey CLIを実行する", function () {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "bin/agent-skill-chain.ts",
      "worktree",
      "survey",
      `--root=${this.repositoryRoot}`,
    ],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  this.cliStdout = result.stdout;
});

Then("後片付け判定は{string}である", function (expectation: string) {
  const unknownKind = (value: FinalizeReport): string[] =>
    value.reasons.filter((reason) => reason.includes("種別が不明"));
  const ignoredBlocking = (value: FinalizeReport): string[] =>
    value.reasons.filter(
      (reason) =>
        reason.includes("種別が不明") ||
        reason.includes("allowlist外の無視対象資産です"),
    );
  if (expectation === "種別不明の理由を含まない") {
    const found = unknownKind(this.reports[0]!);
    assert.deepEqual(found, [], found.join("; "));
    return;
  }
  if (expectation === "種別不明の理由を含む") {
    assert.notEqual(unknownKind(this.reports[0]!).length, 0);
    return;
  }
  if (expectation === "無視対象を理由にblockingしない") {
    const found = ignoredBlocking(this.reports[0]!);
    assert.deepEqual(found, [], found.join("; "));
    return;
  }
  if (expectation === "2値で一致する") {
    assert.equal(this.reports.length, 2);
    assert.deepEqual(
      this.reports[0]!.snapshot.ignoredArtifacts,
      this.reports[1]!.snapshot.ignoredArtifacts,
    );
    assert.deepEqual(this.reports[0]!.reasons, this.reports[1]!.reasons);
    return;
  }
  throw new Error(`未知の期待値です: ${expectation}`);
});

Then("無視対象資産の観測列は{string}である", function (expectation: string) {
  const observed = this.reports[0]!.snapshot.ignoredArtifacts;
  if (expectation === "改行を含む名前1件") {
    assert.deepEqual(observed, ["ignored/a\nb.txt"]);
    return;
  }
  if (expectation === "ASCII名2件") {
    assert.deepEqual(observed, ["ignored/alpha.txt", "ignored/beta.txt"]);
    return;
  }
  throw new Error(`未知の期待値です: ${expectation}`);
});

Then("survey CLIの出力は{string}である", function (expectation: string) {
  assert.equal(expectation, "種別不明の理由を含まない");
  assert.ok(
    !this.cliStdout.includes("種別が不明"),
    `survey CLIが種別不明を返しています: ${this.cliStdout.slice(0, 400)}`,
  );
});
