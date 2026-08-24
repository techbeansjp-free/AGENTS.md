import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyWorkspaceHygiene,
  previewWorkspaceHygiene,
  type HygieneKind,
  type HygieneReport,
} from "../../src/domain/hygiene.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface GitState {
  head: string;
  refs: string;
  status: string;
  worktrees: string;
}

interface HygieneWorld extends WorkflowWorld {
  applyResult?: ReturnType<typeof applyWorkspaceHygiene>;
  beforeTree?: string;
  cliResult?: CommandResult;
  dangerousErrors?: Error[];
  gitBefore?: GitState;
  outside?: string;
  permissionParent?: string;
  previewHash?: string;
  rejected?: Error[];
  report?: HygieneReport;
  root?: string;
}

const { Given, When, Then } = stepDefinitions<HygieneWorld>();
const cliEntrypoint = process.execPath;
const cliSource = path.resolve("dist", "bin", "agent-skill-chain.js");

function rootOf(world: HygieneWorld): string {
  assert.ok(world.root, "隔離repositoryが未設定です");
  return world.root;
}

function reportOf(world: HygieneWorld): HygieneReport {
  assert.ok(world.report, "preview reportが未設定です");
  return world.report;
}

function mkdir(root: string, relative: string): string {
  const target = path.join(root, relative);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function write(root: string, relative: string, content = "fixture\n"): string {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function removeNonRecursive(target: { path: string; kind: HygieneKind }): void {
  const stat = fs.lstatSync(target.path);
  if (stat.isSymbolicLink()) throw new Error("symlinkは削除しません");
  if (target.kind === "temporary-artifact") {
    assert.equal(stat.isFile(), true);
    fs.rmSync(target.path);
  } else {
    assert.equal(stat.isDirectory(), true);
    fs.rmdirSync(target.path);
  }
}

function treeSnapshot(root: string): string {
  const visit = (directory: string, relative: string): string[] =>
    fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !(relative === "" && entry.name === ".git"))
      .flatMap((entry) => {
        const childRelative = relative
          ? path.posix.join(relative, entry.name)
          : entry.name;
        const absolute = path.join(directory, entry.name);
        const stat = fs.lstatSync(absolute);
        const own = `${childRelative}:${stat.mode}:${stat.size}:${stat.mtimeMs}`;
        return entry.isDirectory() && !stat.isSymbolicLink()
          ? [own, ...visit(absolute, childRelative)]
          : [own];
      });
  return visit(root, "").sort().join("\n");
}

function gitText(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function gitState(root: string): GitState {
  return {
    head: gitText(root, ["rev-parse", "HEAD"]),
    refs: gitText(root, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
    ]),
    status: gitText(root, [
      "-c",
      "core.quotePath=false",
      "status",
      "--porcelain=v1",
    ]),
    worktrees: gitText(root, ["worktree", "list", "--porcelain"]),
  };
}

function runCli(args: string[]): CommandResult {
  const result = spawnSync(cliEntrypoint, [cliSource, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

Given(
  "空directoryと未追跡一時生成物と偽Git領域を持つ隔離repositoryがある",
  function () {
    this.root = this.initRepo();
    mkdir(this.root, "空-α/深い");
    write(this.root, "tmp/実行.log");
    mkdir(this.root, "sandbox/.git/objects/empty");
    this.beforeTree = treeSnapshot(this.root);
  },
);

When("workspace hygieneをpreviewする", function () {
  this.report = previewWorkspaceHygiene({ root: rootOf(this) });
});

Then("previewは候補のpathと理由とownerと削除可否を返す", function () {
  const candidates = reportOf(this).candidates;
  assert.ok(candidates.some((candidate) => candidate.relative === "空-α/深い"));
  assert.ok(
    candidates.some((candidate) => candidate.relative === "tmp/実行.log"),
  );
  assert.ok(
    candidates.every(
      (candidate) =>
        path.isAbsolute(candidate.path) &&
        candidate.reason.length > 0 &&
        candidate.owner.length > 0 &&
        candidate.removable,
    ),
  );
});

Then("previewはfixtureを書き換えずGit領域の除外理由を返す", function () {
  assert.equal(treeSnapshot(rootOf(this)), this.beforeTree);
  assert.ok(
    reportOf(this).excluded.some(
      (entry) =>
        entry.relative === "sandbox/.git" && entry.reason.includes("Git"),
    ),
  );
  assert.equal(
    fs.existsSync(path.join(rootOf(this), "sandbox/.git/objects/empty")),
    true,
  );
});

Given("空のGit補助directoryを持つ隔離repositoryがある", function () {
  this.root = this.initRepo();
  mkdir(this.root, ".git/objects/fixture-empty");
  mkdir(this.root, ".git/refs/fixture-empty");
  mkdir(this.root, ".git/logs/fixture-empty");
  mkdir(this.root, ".git/worktrees/fixture-empty");
});

Then("Git common directory配下は候補に含まれない", function () {
  assert.ok(
    reportOf(this).candidates.every(
      (candidate) => !candidate.relative.startsWith(".git"),
    ),
  );
  assert.equal(
    fs.existsSync(path.join(rootOf(this), ".git/objects/fixture-empty")),
    true,
  );
});

Then("Git common directoryはoverride不能な除外理由を持つ", function () {
  assert.ok(
    reportOf(this).excluded.some(
      (entry) =>
        entry.relative === ".git" && entry.reason.includes("常に対象外"),
    ),
  );
});

Given("root境界を検査する隔離repositoryがある", function () {
  this.root = this.initRepo();
  mkdir(this.root, "child");
  this.report = previewWorkspaceHygiene({ root: this.root });
});

When(
  "repository内directoryとhomeとfilesystem rootと親参照をpreview rootに指定する",
  function () {
    const root = rootOf(this);
    this.dangerousErrors = [
      path.join(root, "child"),
      os.homedir(),
      path.parse(root).root,
      `${root}/child/..`,
    ].map((candidate) => {
      try {
        previewWorkspaceHygiene({ root: candidate });
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
      return new Error("危険なrootが受理されました");
    });
  },
);

Then("すべての危険なrootを拒否しremoveを呼ばない", function () {
  assert.equal(this.dangerousErrors?.length, 4);
  assert.ok(this.dangerousErrors?.every((error) => error.message.length > 0));
  assert.ok(
    this.dangerousErrors?.every(
      (error) => error.message !== "危険なrootが受理されました",
    ),
  );
  assert.deepEqual(this.calls, []);
});

Then("repository root自身は除外一覧に記録される", function () {
  assert.ok(
    reportOf(this).excluded.some(
      (entry) => entry.relative === "." && entry.reason.includes("root自身"),
    ),
  );
});

Given("repository内外を指すsymlinkを持つ隔離repositoryがある", function () {
  this.root = this.initRepo();
  this.outside = this.temp("asc-hygiene-outside-");
  mkdir(this.root, "inside-empty");
  mkdir(this.root, "holder");
  fs.symlinkSync(this.outside, path.join(this.root, "escape-link"));
  fs.symlinkSync(
    path.join(this.root, "inside-empty"),
    path.join(this.root, "holder", "inside-link"),
  );
});

Then("symlinkとその親directoryは候補に含まれない", function () {
  const relative = reportOf(this).candidates.map(
    (candidate) => candidate.relative,
  );
  assert.ok(!relative.includes("escape-link"));
  assert.ok(!relative.includes("holder/inside-link"));
  assert.ok(!relative.includes("holder"));
});

Then("symlink脱出の除外理由が返る", function () {
  assert.ok(
    reportOf(this).excluded.filter((entry) => entry.reason.includes("symlink"))
      .length >= 2,
  );
});

Given(
  "内容のあるmemoとpackage manager所有directoryを持つ隔離repositoryがある",
  function () {
    this.root = this.initRepo();
    write(this.root, "memo/保持.md");
    mkdir(this.root, "memo/空");
    write(this.root, "node_modules/package/index.js");
    mkdir(this.root, "node_modules/package/empty");
  },
);

Then("内容のあるmemoとnode_modules配下は候補に含まれない", function () {
  const relative = reportOf(this).candidates.map(
    (candidate) => candidate.relative,
  );
  assert.ok(!relative.includes("memo"));
  assert.ok(relative.every((item) => !item.startsWith("node_modules")));
  assert.ok(
    reportOf(this).excluded.some(
      (entry) =>
        entry.relative === "node_modules" &&
        entry.reason.includes("package manager"),
    ),
  );
});

Then("memo内の空directoryだけは候補になる", function () {
  assert.ok(
    reportOf(this).candidates.some(
      (candidate) =>
        candidate.relative === "memo/空" &&
        candidate.kind === "empty-directory",
    ),
  );
});

Given("apply候補を持つ隔離repositoryのpreview reportがある", function () {
  this.root = this.initRepo();
  mkdir(this.root, "stale-empty");
  this.report = previewWorkspaceHygiene({ root: this.root });
});

When("hash不一致とTOCTOU変更後のapplyを順に試みる", function () {
  const root = rootOf(this);
  const report = reportOf(this);
  this.rejected = [];
  try {
    applyWorkspaceHygiene(
      {
        report,
        approvedHash: "0".repeat(64),
        root,
        operations: ["empty-directory"],
      },
      (target) => this.calls.push(target.path),
    );
  } catch (error) {
    this.rejected.push(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  write(root, "stale-empty/changed.txt");
  try {
    applyWorkspaceHygiene(
      {
        report,
        approvedHash: report.hash,
        root,
        operations: ["empty-directory"],
      },
      (target) => this.calls.push(target.path),
    );
  } catch (error) {
    this.rejected.push(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
});

Then("どちらのapplyもremoveを一度も呼ばず拒否される", function () {
  assert.equal(this.rejected?.length, 2);
  assert.deepEqual(this.calls, []);
  assert.equal(
    fs.existsSync(path.join(rootOf(this), "stale-empty/changed.txt")),
    true,
  );
});

Given("複数operationの候補を持つ隔離repositoryがある", function () {
  this.root = this.initRepo();
  mkdir(this.root, "keep-empty");
  write(this.root, "cleanup.log");
  this.report = previewWorkspaceHygiene({ root: this.root });
});

When("temporary artifactだけを明示してapplyする", function () {
  const report = reportOf(this);
  this.applyResult = applyWorkspaceHygiene(
    {
      report,
      approvedHash: report.hash,
      root: rootOf(this),
      operations: ["temporary-artifact"],
    },
    removeNonRecursive,
  );
});

Then("指定したoperationだけが削除される", function () {
  assert.equal(fs.existsSync(path.join(rootOf(this), "cleanup.log")), false);
  assert.equal(fs.existsSync(path.join(rootOf(this), "keep-empty")), true);
  assert.deepEqual(this.applyResult?.removed, ["cleanup.log"]);
});

Then("指定外のoperationはskipped理由とともに返る", function () {
  assert.ok(
    this.applyResult?.skipped.some(
      (entry) =>
        entry.relative === "keep-empty" &&
        entry.reason.includes("明示operation"),
    ),
  );
});

Given("削除対象と保持対象を分離した隔離repositoryがある", function () {
  this.root = this.initRepo();
  mkdir(this.root, "空directory/Unicode-空");
  write(this.root, "run.log");
  write(this.root, "tmp/cache.tmp-1");
  write(this.root, "memo/保持.md");
  write(this.root, "other-project/asset.txt");
  write(this.root, "node_modules/package/asset.js");
});

When("全workspace hygiene operationをpreview reportからapplyする", function () {
  const report = previewWorkspaceHygiene({ root: rootOf(this) });
  this.report = report;
  this.applyResult = applyWorkspaceHygiene(
    {
      report,
      approvedHash: report.hash,
      root: rootOf(this),
      operations: [
        "empty-directory",
        "temporary-artifact",
        "completed-worktree-container",
      ],
    },
    removeNonRecursive,
  );
});

Then("空directoryと一時生成物だけが削除される", function () {
  const root = rootOf(this);
  assert.equal(fs.existsSync(path.join(root, "空directory")), false);
  assert.equal(fs.existsSync(path.join(root, "run.log")), false);
  assert.equal(fs.existsSync(path.join(root, "tmp/cache.tmp-1")), false);
});

Then("内容のあるmemoと他project資産とnode_modulesは保持される", function () {
  const root = rootOf(this);
  assert.equal(fs.existsSync(path.join(root, "memo/保持.md")), true);
  assert.equal(fs.existsSync(path.join(root, "other-project/asset.txt")), true);
  assert.equal(
    fs.existsSync(path.join(root, "node_modules/package/asset.js")),
    true,
  );
});

Given("permission failureを含む複数の空directory候補がある", function () {
  this.root = this.initRepo();
  mkdir(this.root, "a-parent/first");
  this.permissionParent = mkdir(this.root, "z-blocked/second");
  const blockedParent = path.dirname(this.permissionParent);
  fs.chmodSync(blockedParent, 0o555);
  this.permissionParent = blockedParent;
});

When("実際の非再帰削除をapplyする", function () {
  const root = rootOf(this);
  const report = previewWorkspaceHygiene({ root });
  this.report = report;
  try {
    this.applyResult = applyWorkspaceHygiene(
      {
        report,
        approvedHash: report.hash,
        root,
        operations: ["empty-directory"],
      },
      (target) => {
        if (target.path.includes(`${path.sep}z-blocked${path.sep}`))
          throw new Error("EACCES: permission denied");
        removeNonRecursive(target);
      },
    );
  } catch (error) {
    this.error = error;
  } finally {
    if (this.permissionParent) fs.chmodSync(this.permissionParent, 0o755);
  }
});

Then("部分失敗として未処理対象と復旧方法が報告される", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /部分失敗/u);
  assert.match(this.error.message, /未処理対象/u);
  assert.match(this.error.message, /復旧方法/u);
  assert.equal(fs.existsSync(path.join(rootOf(this), "a-parent/first")), false);
  assert.equal(
    fs.existsSync(path.join(rootOf(this), "z-blocked/second")),
    true,
  );
});

Then("apply成功結果は返らない", function () {
  assert.equal(this.applyResult, undefined);
});

Given(
  "登録済みworktreeと未登録の空containerを持つ隔離repositoryがある",
  function () {
    this.root = this.initRepo();
    const containers = mkdir(this.root, ".worktrees");
    mkdir(this.root, ".worktrees/完了済み");
    execFileSync(
      "git",
      [
        "worktree",
        "add",
        "-q",
        "-b",
        "hygiene-active",
        path.join(containers, "active"),
      ],
      { cwd: this.root },
    );
  },
);

Then("未登録の空containerだけがworktree container候補になる", function () {
  const candidates = reportOf(this).candidates.filter(
    (candidate) => candidate.kind === "completed-worktree-container",
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.relative),
    [".worktrees/完了済み"],
  );
});

Then("登録済みworktreeはGit公式command専用として保持される", function () {
  assert.equal(
    fs.existsSync(path.join(rootOf(this), ".worktrees/active")),
    true,
  );
  assert.ok(
    reportOf(this).excluded.some(
      (entry) =>
        entry.relative === ".worktrees/active" &&
        entry.reason.includes("Git公式command"),
    ),
  );
});

Given("Git不変条件を記録したworkspace hygiene候補がある", function () {
  this.root = this.initRepo();
  mkdir(this.root, "invariant-empty");
  write(this.root, "invariant.log");
  this.gitBefore = gitState(this.root);
});

Then("Git HEADとrefsとworktree listは不変である", function () {
  const after = gitState(rootOf(this));
  assert.equal(after.head, this.gitBefore?.head);
  assert.equal(after.refs, this.gitBefore?.refs);
  assert.equal(after.worktrees, this.gitBefore?.worktrees);
});

Then("Git statusは未追跡一時生成物の削除だけを反映する", function () {
  assert.match(this.gitBefore?.status ?? "", /\?\? invariant\.log/u);
  assert.equal(gitState(rootOf(this)).status, "");
});

Given("CLI preview対象の隔離repositoryがある", function () {
  this.root = this.initRepo();
  mkdir(this.root, "CLI空");
  write(this.root, "cli.log");
});

When("worktree hygiene CLIをapplyなしで実行する", function () {
  this.cliResult = runCli(["worktree", "hygiene", `--root=${rootOf(this)}`]);
});

Then("CLI previewは終了code 0で候補一覧をJSON出力する", function () {
  assert.equal(this.cliResult?.status, 0, this.cliResult?.stderr);
  const parsed: unknown = JSON.parse(this.cliResult?.stdout ?? "");
  assert.ok(parsed !== null && typeof parsed === "object");
  assert.match(this.cliResult?.stdout ?? "", /"candidates"/u);
  assert.match(this.cliResult?.stdout ?? "", /CLI空/u);
});

Then("CLI previewは候補を削除しない", function () {
  assert.equal(fs.existsSync(path.join(rootOf(this), "CLI空")), true);
  assert.equal(fs.existsSync(path.join(rootOf(this), "cli.log")), true);
});

Given("CLI apply対象の隔離repositoryとpreview hashがある", function () {
  this.root = this.initRepo();
  mkdir(this.root, "CLI-apply-empty");
  this.previewHash = previewWorkspaceHygiene({ root: this.root }).hash;
});

When("異なるapproved hashでworktree hygiene CLIをapplyする", function () {
  const differentHash =
    this.previewHash === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64);
  this.cliResult = runCli([
    "worktree",
    "hygiene",
    `--root=${rootOf(this)}`,
    "--apply",
    `--approved-hash=${differentHash}`,
    "--operations=empty-directory",
  ]);
});

Then("CLI applyは非0でhash不一致を報告する", function () {
  assert.notEqual(this.cliResult?.status, 0);
  assert.match(this.cliResult?.stdout ?? "", /hash.*一致しません/u);
});

Then("CLI applyは対象を一件も削除しない", function () {
  assert.equal(fs.existsSync(path.join(rootOf(this), "CLI-apply-empty")), true);
});
