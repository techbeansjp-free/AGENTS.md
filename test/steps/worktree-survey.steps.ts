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
import { inspectRecoveryState } from "../../src/domain/worktree.js";
import {
  assessWorktreeRemovalSafety,
  type WorktreeRemovalSafetyObservation,
} from "../../src/domain/worktree-removal-safety.js";
import { init } from "../../src/domain/lifecycle.js";

interface SurveyWorld extends WorkflowWorld {
  remote: string;
  recovery: ReturnType<typeof inspectRecoveryState>;
  safety: ReturnType<typeof assessWorktreeRemovalSafety>;
  removalObservation: WorktreeRemovalSafetyObservation;
  ignoredOutputBytes: number;
  input: unknown;
  survey: WorktreeSurvey;
  root: string;
  worktree: string;
  detachedWorktree: string;
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
    ...overrides,
  };
}

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function createSurveyRepository(
  world: SurveyWorld,
  merged: boolean,
  ignoreRules?: string,
): void {
  world.root = world.initRepo();
  if (ignoreRules !== undefined) {
    fs.writeFileSync(path.join(world.root, ".gitignore"), ignoreRules);
    runGit(world.root, ["add", ".gitignore"]);
    runGit(world.root, ["commit", "-q", "-m", "ignore"]);
  }
  const remote = world.temp("asc-survey-remote-");
  world.remote = remote;
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

/**
 * `git ls-files --others --ignored --exclude-standard`の出力が`spawnSync`の既定maxBuffer
 * 1MiBを超えると子processが停止させられ、走査はworktreeを1件も分類できなくなる（Issue #993）。
 * 1MiBの直上では全量が届いてから停止するため`status`が0のまま残り欠陥が現れない。
 * 利用者報告と同じ3MiB規模にして`status`がnullになる領域を再現する。
 * 発火点はignored file約4,218件（平均path長249byte）だが、fixtureはdirectory名で
 * path長を稼ぎ、少ないfile数で同じ出力量へ到達する。
 */
const IGNORED_OUTPUT_BYTES = 3 * 1024 * 1024;

function fillIgnoredArtifacts(worktree: string): number {
  const directory = path.join(
    worktree,
    "node_modules",
    "d".repeat(120),
    "e".repeat(120),
    "g".repeat(120),
  );
  fs.mkdirSync(directory, { recursive: true });
  let bytes = 0;
  for (let index = 0; bytes < IGNORED_OUTPUT_BYTES; index += 1) {
    const file = path.join(
      directory,
      `${String(index).padStart(6, "0")}${"f".repeat(240)}`,
    );
    fs.writeFileSync(file, "");
    bytes += Buffer.byteLength(path.relative(worktree, file)) + 1;
  }
  return bytes;
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
  /**
   * `recoveryReachable`を偽にする。既定branchから到達できるなら未pushのcommitも
   * remoteに存在するため、Issue #1097以降は保持理由にならない。**未pushを保持理由に
   * するのは復旧可能性が成立しないときだけである。** この scenario が守るのは
   * 「復旧できないときに件数を理由へ含める」ことであり、その意図は変わらない。
   */
  this.input = [observation({ unpushedCommits: 3, recoveryReachable: false })];
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
Given("detached HEADでmerge済みかつcleanなworktree観測がある", function () {
  this.input = [observation({ branch: null, headState: "detached" })];
});
Given("detached HEADで未mergeのworktree観測がある", function () {
  this.input = [
    observation({
      branch: null,
      headState: "detached",
      mergedIntoDefault: false,
    }),
  ];
});
Given(
  "attachedなのにbranchが空の観測とdetachedなのにbranchを持つ観測と正常な観測がある",
  function () {
    this.input = [
      observation({
        path: "/repo/.worktrees/20260825_120000-883-empty",
        branch: "",
      }),
      observation({
        path: "/repo/.worktrees/20260825_120000-883-contradict",
        branch: "feature/883-survey",
        headState: "detached",
      }),
      observation(),
    ];
  },
);
Given("headStateが不明なworktree観測がある", function () {
  this.input = [
    {
      ...observation({ path: "/repo/.worktrees/20260825_120000-883-unknown" }),
      headState: "unknown",
    },
  ];
});
When("worktree走査を純粋判定する", function () {
  this.survey = surveyWorktrees(this.input);
});
Then("判定はretainでdetached理由を含みbranchはnullである", function () {
  const entry = this.survey.entries[0];
  assert.ok(entry, "entriesへ入っていません");
  assert.equal(entry.disposition, "retain");
  assert.equal(entry.branch, null);
  assert.equal(entry.headState, "detached");
  assert.ok(
    entry.reasons.includes(
      "HEADがdetachedです。現行のfinalizeは対象branchを要求するため、この経路では後片付けできません",
    ),
    `detached理由がありません: ${entry.reasons.join(" | ")}`,
  );
  assert.deepEqual(this.survey.errors, []);
  assert.deepEqual(this.survey.cleanupReady, []);
});
Then("判定はin-progressでdetached理由を含む", function () {
  const entry = this.survey.entries[0];
  assert.ok(entry, "entriesへ入っていません");
  assert.equal(entry.disposition, "in-progress");
  assert.equal(entry.branch, null);
  assert.ok(
    entry.reasons.includes(
      "HEADがdetachedです。現行のfinalizeは対象branchを要求するため、この経路では後片付けできません",
    ),
  );
});
Then(
  "attachment状態の矛盾はpath付きerrorになり正常な観測だけが分類される",
  function () {
    assert.equal(this.survey.entries.length, 1);
    assert.equal(this.survey.entries[0]?.path, observation().path);
    assert.ok(
      this.survey.errors.some(
        (error: string) =>
          error.includes("/repo/.worktrees/20260825_120000-883-empty") &&
          error.includes(
            "branchはattachedのとき空でない文字列でなければなりません",
          ),
      ),
      `attachedで空branchのerrorがありません: ${this.survey.errors.join(" | ")}`,
    );
    assert.ok(
      this.survey.errors.some(
        (error: string) =>
          error.includes("/repo/.worktrees/20260825_120000-883-contradict") &&
          error.includes("branchはdetachedのときnullでなければなりません"),
      ),
      `detachedでbranchありのerrorがありません: ${this.survey.errors.join(" | ")}`,
    );
  },
);
Then("headState不明はpath付きerrorになりentriesへ入らない", function () {
  assert.equal(this.survey.entries.length, 0);
  assert.ok(
    this.survey.errors.some(
      (error: string) =>
        error.includes("/repo/.worktrees/20260825_120000-883-unknown") &&
        error.includes("headStateはattachedまたはdetachedでなければなりません"),
    ),
    `headState不明のerrorがありません: ${this.survey.errors.join(" | ")}`,
  );
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
    this.survey.entries[0]?.reasons.some((reason: string) =>
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
    this.survey.entries[0]?.reasons.some((reason: string) =>
      reason.includes("slugが一致しません"),
    ),
  );
});
Then("Issue番号不一致を理由として報告する", function () {
  assert.ok(
    this.survey.entries[0]?.reasons.some((reason: string) =>
      reason.includes("Issue番号が一致しません"),
    ),
  );
});
Then("slug不一致を報告しても判定はcleanup-readyである", function () {
  assert.equal(this.survey.entries[0]?.disposition, "cleanup-ready");
  assert.ok(
    this.survey.entries[0]?.reasons.some((reason: string) =>
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
Given("ignored出力が1MiBを超える走査用worktreeがある", function () {
  createSurveyRepository(this, true, "node_modules/\n");
  this.ignoredOutputBytes = fillIgnoredArtifacts(this.worktree);
});
/**
 * PRがmergeされremote branchが削除された着地形。upstream refは陳腐化し
 * `rev-list --count @{upstream}..HEAD`は0でなくなるが、**HEADは既定branchから到達できる**
 * ためcommitは失われない（Issue #1097）。survey CLIが未pushを保持理由にしないことを確かめる。
 */
Given("remote branchを削除したmerge済みの走査用worktreeがある", function () {
  createSurveyRepository(this, true);
  /**
   * 実物#996と同じ形にする。remote側のrefだけを消してlocalのremote-tracking refを
   * 陳腐化させ、branchをmergeの結果へ追随させる。`rev-list --count @{upstream}..HEAD`は
   * 0でなくなるが、**HEADは既定branchから到達できるためcommitは失われない**（Issue #1097）。
   * `push --delete`ではlocalのtracking refも消えてこの形にならない。
   */
  runGit(this.remote, ["update-ref", "-d", "refs/heads/feature/883-survey"]);
  runGit(this.worktree, ["merge", "--ff-only", "main"]);
});

Given("detached HEADのmerge済み走査用worktreeがある", function () {
  createSurveyRepository(this, true);
  this.detachedWorktree = path.join(
    this.root,
    ".worktrees",
    "20260825_120000-884-detached",
  );
  runGit(this.root, [
    "worktree",
    "add",
    "--detach",
    this.detachedWorktree,
    "origin/main",
  ]);
});
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
Then("detached worktreeはretainでbranchがnullとして報告される", function () {
  const survey = parsed(this);
  const entries = survey.entries as Array<Record<string, unknown>>;
  const target = entries.find((entry) => entry.path === this.detachedWorktree);
  assert.ok(
    target,
    `detached worktreeがentriesにありません: ${JSON.stringify(survey.errors)}`,
  );
  assert.equal(target.branch, null);
  assert.equal(target.headState, "detached");
  assert.equal(target.disposition, "retain");
  assert.ok(
    (target.reasons as string[]).some((reason) =>
      reason.includes("HEADがdetachedです"),
    ),
    `detached理由がありません: ${JSON.stringify(target.reasons)}`,
  );
  assert.ok(!(survey.cleanupReady as string[]).includes(this.detachedWorktree));
  assert.deepEqual(survey.errors, []);
  assert.equal(this.process.status, 0);
});
Then("要約表にdetachedの行がある", function () {
  assert.equal(this.process.status, 0);
  const line = this.process.stdout
    .split("\n")
    .find((row: string) => row.includes(this.detachedWorktree));
  assert.ok(line, `detached worktreeの行がありません: ${this.process.stdout}`);
  assert.ok(line.includes("(detached)"), `(detached)表記がありません: ${line}`);
  assert.ok(line.startsWith("retain\t"), `retainではありません: ${line}`);
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

Then("走査はerrorなしで登録済みworktreeを分類する", function () {
  assert.ok(this.ignoredOutputBytes > IGNORED_OUTPUT_BYTES);
  const survey = parsed(this);
  assert.deepEqual(survey.errors, []);
  const entries = survey.entries as Array<Record<string, unknown>>;
  assert.equal(entries.length, 2);
  assert.ok(entries.some((entry) => entry.path === this.worktree));
});

Given("既定branchへmerge済みでupstreamを失ったworktreeがある", function () {
  createSurveyRepository(this, true);
  runGit(this.root, ["push", "origin", "--delete", "feature/883-survey"]);
  runGit(this.worktree, ["fetch", "--prune", "origin"]);
});

Given("既定branchから到達できないcommitを持つworktreeがある", function () {
  createSurveyRepository(this, false);
  fs.writeFileSync(path.join(this.worktree, "unmerged.txt"), "unmerged\n");
  runGit(this.worktree, ["add", "unmerged.txt"]);
  runGit(this.worktree, ["commit", "-m", "fixture: unmerged"]);
});

Given("既定branch refを解決できないworktreeがある", function () {
  createSurveyRepository(this, true);
  runGit(this.root, ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"]);
});

When("復旧可能性を観測する", function () {
  this.recovery = inspectRecoveryState(this.worktree);
});

Then("復旧可能性は{string}である", function (expected: string) {
  assert.equal(this.recovery.recoveryReachable, expected === "真");
});

Then("既定branch到達は{string}である", function (expected: string) {
  assert.equal(this.recovery.reachableFromDefaultBranch, expected === "真");
});

const UPSTREAM_DERIVED = [
  "未pushのcommit",
  "コミットがpushされていません",
  "リモートブランチがありません",
];

function removalObservation(
  overrides: Partial<WorktreeRemovalSafetyObservation> = {},
): WorktreeRemovalSafetyObservation {
  return {
    repositoryRoot: "/repo",
    worktreePath: "/repo/.worktrees/20260825_120000-883-survey",
    worktreeRoot: "/repo/.worktrees",
    trackedChanges: false,
    untracked: [],
    ignoredArtifacts: [],
    ignoredPathAllowlist: [],
    stashes: [],
    pushed: false,
    remoteBranch: false,
    merged: true,
    recoveryReachable: true,
    unpushedCommits: 2,
    ...overrides,
  };
}

Given(
  "既定branch到達を観測できupstream由来の観測が偽の入力がある",
  function () {
    this.removalObservation = removalObservation({
      reachableFromDefaultBranch: true,
    });
  },
);

Given("既定branch到達が不明でupstream由来の観測が偽の入力がある", function () {
  this.removalObservation = removalObservation();
});

When("worktree削除の安全性を判定する", function () {
  this.safety = assessWorktreeRemovalSafety(this.removalObservation);
});

Then("拒否理由にupstream由来は含まれない", function () {
  const reasons: readonly string[] = this.safety.reasons;
  const matched = reasons.filter((reason: string) =>
    UPSTREAM_DERIVED.some((needle) => reason.includes(needle)),
  );
  assert.deepEqual(matched, []);
});

Then("拒否理由にupstream由来が含まれる", function () {
  const reasons: readonly string[] = this.safety.reasons;
  for (const needle of UPSTREAM_DERIVED.slice(0, 1).concat(UPSTREAM_DERIVED[2]))
    assert.ok(
      reasons.some((reason: string) => reason.includes(needle)),
      `${needle}がありません: ${reasons.join(" / ")}`,
    );
});
