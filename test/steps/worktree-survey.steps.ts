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
  surveyWorktrees,
  type WorktreeObservation,
  type WorktreeSurvey,
} from "../../src/domain/worktree-survey.js";
import { init } from "../../src/domain/lifecycle.js";

interface SurveyWorld extends WorkflowWorld {
  input: unknown;
  survey: WorktreeSurvey;
  root: string;
  worktree: string;
  process: SpawnSyncReturns<string>;
  before: string;
  after: string;
}

const { Given, When, Then } = stepDefinitions<SurveyWorld>();

function observation(
  overrides: Partial<WorktreeObservation> = {},
): WorktreeObservation {
  return {
    repositoryRoot: "/repo",
    path: "/repo/.worktrees/20260825_120000-883-survey",
    branch: "feature/883-survey",
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
    ...overrides,
  };
}

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function createSurveyRepository(world: SurveyWorld, merged: boolean): void {
  world.root = world.initRepo();
  const remote = world.temp("asc-survey-remote-");
  runGit(remote, ["init", "--bare"]);
  runGit(world.root, ["remote", "add", "origin", remote]);
  runGit(world.root, ["push", "-u", "origin", "main"]);
  runGit(world.root, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);
  world.worktree = path.join(
    world.root,
    ".worktrees",
    "20260825_120000-883-survey",
  );
  fs.mkdirSync(path.dirname(world.worktree), { recursive: true });
  runGit(world.root, [
    "worktree",
    "add",
    "-b",
    "feature/883-survey",
    world.worktree,
    "origin/main",
  ]);
  fs.writeFileSync(path.join(world.worktree, "survey.txt"), "survey\n");
  runGit(world.worktree, ["add", "survey.txt"]);
  runGit(world.worktree, ["commit", "-m", "fixture: survey"]);
  runGit(world.worktree, ["push", "-u", "origin", "feature/883-survey"]);
  if (merged) {
    runGit(world.root, [
      "merge",
      "--no-ff",
      "feature/883-survey",
      "-m",
      "merge fixture",
    ]);
    runGit(world.root, ["push", "origin", "main"]);
  }
}

function runCli(world: SurveyWorld, args: string[]): void {
  world.process = spawnSync(
    process.execPath,
    ["--import", "tsx", "bin/agent-skill-chain.ts", ...args],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
}

function parsed(world: SurveyWorld): Record<string, unknown> {
  assert.equal(world.process.error, undefined);
  return JSON.parse(world.process.stdout) as Record<string, unknown>;
}

function directoryContents(root: string): string {
  const walk = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      if (entry.isDirectory()) return [`D ${relative}`, ...walk(absolute)];
      if (entry.isSymbolicLink())
        return [`L ${relative} ${fs.readlinkSync(absolute)}`];
      return [`F ${relative} ${fs.readFileSync(absolute).toString("base64")}`];
    });
  return walk(root).sort().join("\n");
}

Given("未mergeのworktree観測がある", function () {
  this.input = [observation({ mergedIntoDefault: false })];
});
Given("merge済みかつcleanなworktree観測がある", function () {
  this.input = [observation()];
});
Given("merge済みで未commit変更を持つworktree観測がある", function () {
  this.input = [observation({ dirty: true })];
});
Given("merge済みで未追跡fileを2件持つworktree観測がある", function () {
  this.input = [observation({ untracked: ["a", "b"] })];
});
Given("merge済みで未pushのcommitを3件持つworktree観測がある", function () {
  this.input = [observation({ unpushedCommits: 3 })];
});
Given("merge済みで復旧参照のないworktree観測がある", function () {
  this.input = [observation({ recoveryReachable: false })];
});
Given("merge済みで4種類の保持条件を持つworktree観測がある", function () {
  this.input = [
    observation({
      dirty: true,
      untracked: ["a"],
      unpushedCommits: 1,
      recoveryReachable: false,
    }),
  ];
});
Given("repository root自身のworktree観測がある", function () {
  this.input = [observation({ path: "/repo", isPrimary: true })];
});
Given("未mergeかつdirtyなworktree観測がある", function () {
  this.input = [observation({ mergedIntoDefault: false, dirty: true })];
});
Given("未知fieldを持つ観測と正常な観測がある", function () {
  this.input = [
    { ...observation({ path: "/invalid" }), unknown: true },
    observation(),
  ];
});
Given("pathが重複するworktree観測がある", function () {
  this.input = [observation(), observation({ branch: "feature/other" })];
});
Given("未pushcommit数が負数のworktree観測がある", function () {
  this.input = [observation({ unpushedCommits: -1 })];
});
Given("worktree観測入力が配列でない", function () {
  this.input = {};
});
Given("worktree観測入力が空配列である", function () {
  this.input = [];
});
Given("directory名とbranch名のslugが異なるworktree観測がある", function () {
  this.input = [observation({ branch: "feature/883-renamed" })];
});
Given(
  "directory名とbranch名のIssue番号が異なるworktree観測がある",
  function () {
    this.input = [observation({ branch: "feature/894-survey" })];
  },
);
Given("cleanup-readyでslugだけが異なるworktree観測がある", function () {
  this.input = [observation({ branch: "feature/883-renamed" })];
});
When("worktree走査を純粋判定する", function () {
  this.survey = surveyWorktrees(this.input);
});
Then("判定はin-progressである", function () {
  assert.equal(this.survey.entries[0]?.disposition, "in-progress");
});
Then("判定はcleanup-readyである", function () {
  assert.equal(this.survey.entries[0]?.disposition, "cleanup-ready");
});
Then("判定はretainで未commit理由を含む", function () {
  assert.equal(this.survey.entries[0]?.disposition, "retain");
  assert.ok(
    this.survey.entries[0]?.reasons.includes(
      "未commitの追跡対象fileがあります",
    ),
  );
});
Then("判定はretainで未追跡2件の理由を含む", function () {
  assert.ok(
    this.survey.entries[0]?.reasons.includes("未追跡fileが2件あります"),
  );
});
Then("判定はretainで未push3件の理由を含む", function () {
  assert.ok(
    this.survey.entries[0]?.reasons.includes("未pushのcommitが3件あります"),
  );
});
Then("判定はretainで復旧不能理由を含む", function () {
  assert.equal(this.survey.entries[0]?.disposition, "retain");
  assert.ok(
    this.survey.entries[0]?.reasons.some((reason) =>
      reason.includes("復旧手段"),
    ),
  );
});
Then("4種類の保持理由をすべて含む", function () {
  assert.equal(this.survey.entries[0]?.reasons.length, 4);
});
Then("判定はprimaryで後片付け一覧に含まれない", function () {
  assert.equal(this.survey.entries[0]?.disposition, "primary");
  assert.deepEqual(this.survey.cleanupReady, []);
  assert.deepEqual(this.survey.retained, []);
  assert.deepEqual(this.survey.inProgress, []);
});
Then("未知fieldのerrorと正常な判定を返す", function () {
  assert.ok(this.survey.errors.some((error) => error.includes("未知field")));
  assert.equal(this.survey.entries.length, 1);
});
Then("path重複のerrorを返す", function () {
  assert.ok(this.survey.errors.some((error) => error.includes("重複")));
  assert.equal(this.survey.entries.length, 0);
});
Then("未pushcommit数のerrorを返す", function () {
  assert.ok(this.survey.errors.some((error) => error.includes("0以上の整数")));
});
Then("配列入力のerrorを返す", function () {
  assert.ok(this.survey.errors.some((error) => error.includes("配列")));
});
Then("errorのない空の走査結果を返す", function () {
  assert.deepEqual(this.survey, {
    entries: [],
    cleanupReady: [],
    retained: [],
    inProgress: [],
    errors: [],
  });
});
Then("slug不一致を理由として報告する", function () {
  assert.ok(
    this.survey.entries[0]?.reasons.some((reason) =>
      reason.includes("slugが一致しません"),
    ),
  );
});
Then("Issue番号不一致を理由として報告する", function () {
  assert.ok(
    this.survey.entries[0]?.reasons.some((reason) =>
      reason.includes("Issue番号が一致しません"),
    ),
  );
});
Then("slug不一致を報告しても判定はcleanup-readyである", function () {
  assert.equal(this.survey.entries[0]?.disposition, "cleanup-ready");
  assert.ok(
    this.survey.entries[0]?.reasons.some((reason) =>
      reason.includes("slugが一致しません"),
    ),
  );
});

Given("走査用のfixture repositoryがある", function () {
  createSurveyRepository(this, false);
});
Given("merge済みの走査用worktreeがある", function () {
  createSurveyRepository(this, true);
});
Given("未commit変更を持つmerge済みの走査用worktreeがある", function () {
  createSurveyRepository(this, true);
  fs.writeFileSync(path.join(this.worktree, "survey.txt"), "dirty\n");
});
Given("branch改名でslugがずれたmerge済みworktreeがある", function () {
  createSurveyRepository(this, true);
  runGit(this.worktree, ["branch", "-m", "bugfix/883-renamed"]);
});
Given(
  "doctor可能でmerge済みworktreeを持つfixture repositoryがある",
  function () {
    createSurveyRepository(this, true);
    init(this.root, { apply: true });
  },
);
When("worktree surveyをJSON形式で実行する", function () {
  runCli(this, ["worktree", "survey", `--root=${this.root}`]);
});
When("directory内容を比較してworktree surveyを実行する", function () {
  this.before = directoryContents(this.root);
  runCli(this, ["worktree", "survey", `--root=${this.root}`]);
  this.after = directoryContents(this.root);
});
When("applyを指定してworktree surveyを実行する", function () {
  runCli(this, ["worktree", "survey", `--root=${this.root}`, "--apply"]);
});
When("worktree surveyをtext形式で実行する", function () {
  runCli(this, ["worktree", "survey", `--root=${this.root}`, "--format=text"]);
});
When("doctor CLIを実行する", function () {
  runCli(this, ["doctor", `--root=${this.root}`]);
});
Then("登録済みworktreeがすべて列挙される", function () {
  assert.equal((parsed(this).entries as unknown[]).length, 2);
});
Then("対象worktreeはcleanup-readyとして報告される", function () {
  assert.ok((parsed(this).cleanupReady as string[]).includes(this.worktree));
});
Then("対象worktreeはretainで未commit理由を報告する", function () {
  const entries = parsed(this).entries as Array<Record<string, unknown>>;
  const target = entries.find((entry) => entry.path === this.worktree);
  assert.equal(target?.disposition, "retain");
  assert.ok(
    (target?.reasons as string[]).includes("未commitの追跡対象fileがあります"),
  );
});
Then("実行前後のdirectory内容は一致する", function () {
  assert.equal(this.after, this.before);
});
Then("日本語errorで拒否される", function () {
  assert.equal(this.process.status, 1);
  assert.match(this.process.stdout, /read-onlyのため--applyを受け付けません/u);
});
Then("走査の終了コードは0である", function () {
  assert.equal(this.process.status, 0);
});
Then("日本語の要約表が出力される", function () {
  assert.equal(this.process.status, 0);
  assert.match(this.process.stdout, /worktree後片付け走査/u);
  assert.match(this.process.stdout, /要約: 後片付け可能/u);
});
Then("doctorはworktree要約を報告する", function () {
  const worktrees = parsed(this).worktrees as Record<string, unknown>;
  assert.equal(worktrees.cleanupReadyCount, 1);
  assert.ok(
    (worktrees.diagnostics as string[]).some((item) =>
      item.includes(this.worktree),
    ),
  );
});
Then("doctorはhealthyを維持する", function () {
  assert.equal(parsed(this).healthy, true);
});
Then("対象worktreeはslug不一致を報告する", function () {
  const entries = parsed(this).entries as Array<Record<string, unknown>>;
  const target = entries.find((entry) => entry.path === this.worktree);
  assert.ok(
    (target?.reasons as string[]).some((reason) =>
      reason.includes("slugが一致しません"),
    ),
  );
});
Then("対象worktreeはslug不一致でもcleanup-readyを維持する", function () {
  const entries = parsed(this).entries as Array<Record<string, unknown>>;
  const target = entries.find((entry) => entry.path === this.worktree);
  assert.equal(target?.disposition, "cleanup-ready");
  assert.ok((parsed(this).cleanupReady as string[]).includes(this.worktree));
});
