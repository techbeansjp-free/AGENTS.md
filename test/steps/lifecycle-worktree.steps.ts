import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { type Policy } from "../../src/types.js";
import {
  init,
  upgrade,
  uninstall,
  doctor,
} from "../../src/domain/lifecycle.js";
import {
  createWorktree,
  inspectFinalizeState,
} from "../../src/domain/worktree.js";

interface LifecycleWorld extends WorkflowWorld {
  assetDuringPreview: boolean;
  consumerGuide: string;
  doctorResult: ReturnType<typeof doctor>;
  finalizeState: ReturnType<typeof inspectFinalizeState>;
  outsideFile: string;
  preview: ReturnType<typeof init>;
  root: string;
  statusBefore: string;
  uninstallResult: ReturnType<typeof uninstall>;
  upgradeResult: ReturnType<typeof upgrade>;
  worktree: string;
  declaredPolicy: Policy | undefined;
  defaultSha: string;
  developSha: string;
}

type LifecycleWorktreeWorld = LifecycleWorld;

const { Given, When, Then } = stepDefinitions<LifecycleWorld>();

function configureRemoteDefault(root: string): string {
  fs.appendFileSync(
    path.join(root, ".git", "info", "exclude"),
    ".worktrees/\n",
  );
  const origin = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: root,
  });
  if (origin.status !== 0)
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/example/fixture.git"],
      { cwd: root },
    );
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", sha], {
    cwd: root,
  });
  execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: root },
  );
  return sha;
}

function readJsonObject(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError(`JSON objectではありません: ${file}`);
  return parsed as Record<string, unknown>;
}

Given("空のconsumer directoryがある", function () {
  this.root = this.temp();
});
When("install domainをdry-runしてからapplyする", function () {
  this.preview = init(this.root, { apply: false });
  this.assetDuringPreview = fs.existsSync(path.join(this.root, "AGENTS.md"));
  init(this.root, { apply: true });
});
Then("dry-run時はassetが存在しない", function () {
  assert.equal(this.assetDuringPreview, false);
});
Then("apply後はmanaged asset recordが存在する", function () {
  assert.equal(
    fs.existsSync(
      path.join(this.root, ".agent-skill-chain", "managed-assets.json"),
    ),
    true,
  );
});
Then("managed asset recordのversionはpackage.jsonと一致する", function () {
  const record = readJsonObject(
    path.join(this.root, ".agent-skill-chain", "managed-assets.json"),
  );
  const packageMetadata = readJsonObject("package.json");
  assert.equal(record.version, packageMetadata.version);
});

Given("consumerの運用ポリシー文書が既に存在する", function () {
  this.root = this.temp();
  fs.mkdirSync(path.join(this.root, ".agent-skill-chain", "docs"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(this.root, ".agent-skill-chain", "docs", "00_運用ポリシー.md"),
    "利用側ポリシー",
  );
});
When("install domainのapplyを試みる", function () {
  try {
    init(this.root, { apply: true });
  } catch (error) {
    this.error = error;
  }
});
Then("installは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("AGENTS.mdは作成されない", function () {
  assert.equal(fs.existsSync(path.join(this.root, "AGENTS.md")), false);
});

Given("packageをinstall済みのconsumerがある", function () {
  this.root = this.temp();
  init(this.root, { apply: true });
});
Given(
  "consumerが品質基準、project policy、docs specsを変更している",
  function () {
    fs.writeFileSync(
      path.join(this.root, ".agent-skill-chain", "docs", "02_品質基準.md"),
      "利用側による変更",
    );
    fs.writeFileSync(
      path.join(this.root, ".agent-skill-chain", "project-policy.json"),
      '{"consumer":true}\n',
    );
    fs.mkdirSync(
      path.join(this.root, ".agent-skill-chain", "project", "rules"),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        this.root,
        ".agent-skill-chain",
        "project",
        "rules",
        "consumer.json",
      ),
      '{"consumer":true}\n',
    );
    fs.mkdirSync(path.join(this.root, "docs", "specs", "00_仕様書構成"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        this.root,
        "docs",
        "specs",
        "00_仕様書構成",
        "00_仕様書索引.md",
      ),
      "利用側仕様",
    );
  },
);
When("update domainをapplyする", function () {
  this.upgradeResult = upgrade(this.root, { apply: true });
});
Then("consumer変更はすべて保持される", function () {
  assert.ok(
    this.upgradeResult.retained.includes(
      path.join(".agent-skill-chain", "docs", "02_品質基準.md"),
    ),
  );
  assert.equal(
    fs.readFileSync(
      path.join(this.root, ".agent-skill-chain", "docs", "02_品質基準.md"),
      "utf8",
    ),
    "利用側による変更",
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        this.root,
        "docs",
        "specs",
        "00_仕様書構成",
        "00_仕様書索引.md",
      ),
      "utf8",
    ),
    "利用側仕様",
  );
  assert.equal(
    fs.readFileSync(
      path.join(this.root, ".agent-skill-chain", "project-policy.json"),
      "utf8",
    ),
    '{"consumer":true}\n',
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        this.root,
        ".agent-skill-chain",
        "project",
        "rules",
        "consumer.json",
      ),
      "utf8",
    ),
    '{"consumer":true}\n',
  );
});

Given("consumerが品質基準とtransient stagingを持つ", function () {
  fs.writeFileSync(
    path.join(this.root, ".agent-skill-chain", "docs", "02_品質基準.md"),
    "保持する",
  );
  fs.mkdirSync(path.join(this.root, ".agent-skill-chain", "tmp", "issues"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(this.root, ".agent-skill-chain", "tmp", "issues", "draft"),
    "keep",
  );
  fs.mkdirSync(
    path.join(this.root, ".agent-skill-chain", "project", "choices"),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(
      this.root,
      ".agent-skill-chain",
      "project",
      "choices",
      "consumer.json",
    ),
    "keep",
  );
});
When("delete domainをapplyする", function () {
  this.uninstallResult = uninstall(this.root, { apply: true });
});
Then("modified品質基準とtransient stagingは保持される", function () {
  assert.ok(
    this.uninstallResult.retained.includes(
      path.join(".agent-skill-chain", "docs", "02_品質基準.md"),
    ),
  );
  assert.equal(
    fs.readFileSync(
      path.join(this.root, ".agent-skill-chain", "docs", "02_品質基準.md"),
      "utf8",
    ),
    "保持する",
  );
  assert.equal(
    fs.readFileSync(
      path.join(this.root, ".agent-skill-chain", "tmp", "issues", "draft"),
      "utf8",
    ),
    "keep",
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        this.root,
        ".agent-skill-chain",
        "project",
        "choices",
        "consumer.json",
      ),
      "utf8",
    ),
    "keep",
  );
});

Given(
  "packageをinstall済みでlegacy .agentsと.workflowを持つconsumerがある",
  function () {
    this.root = this.temp();
    init(this.root, { apply: true });
    fs.writeFileSync(path.join(this.root, ".agents", "legacy.md"), "legacy");
    fs.mkdirSync(path.join(this.root, ".workflow"));
  },
);
When("doctorを実行する", function () {
  this.doctorResult = doctor(this.root);
});
Then("legacy directoryを2件報告する", function () {
  assert.deepEqual(this.doctorResult.legacyDetected.sort(), [
    ".agents",
    ".workflow",
  ]);
});
Then("legacy runtime enabledはfalseである", function () {
  assert.equal(this.doctorResult.legacyRuntimeEnabled, false);
});

Given("managed asset recordへconsumer外の一致hash fileを混入する", function () {
  const outside = this.temp("asc-outside-");
  this.outsideFile = path.join(outside, "重要データ.txt");
  fs.writeFileSync(this.outsideFile, "削除してはいけない");
  const recordPath = path.join(
    this.root,
    ".agent-skill-chain",
    "managed-assets.json",
  );
  const record = readJsonObject(recordPath);
  const files = record.files;
  if (files === null || typeof files !== "object" || Array.isArray(files))
    throw new TypeError("managed-assets.jsonのfilesがobjectではありません");
  (files as Record<string, unknown>)[
    path.relative(this.root, this.outsideFile)
  ] = crypto
    .createHash("sha256")
    .update(fs.readFileSync(this.outsideFile))
    .digest("hex");
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
});
When("delete domainをapplyして失敗を確認する", function () {
  try {
    uninstall(this.root, { apply: true });
  } catch (error) {
    this.error = error;
  }
});
Then("deleteは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("consumer外のfileは保持される", function () {
  assert.equal(fs.readFileSync(this.outsideFile, "utf8"), "削除してはいけない");
});

Given("旧version導入後にconsumerが同名の利用案内を作成している", function () {
  this.root = this.temp();
  init(this.root, { apply: true });
  this.consumerGuide = path.join(
    this.root,
    ".agent-skill-chain",
    "00_利用案内.md",
  );
  const recordPath = path.join(
    this.root,
    ".agent-skill-chain",
    "managed-assets.json",
  );
  const record = readJsonObject(recordPath);
  const files = record.files;
  if (files === null || typeof files !== "object" || Array.isArray(files))
    throw new TypeError("managed-assets.jsonのfilesがobjectではありません");
  delete (files as Record<string, unknown>)[
    path.join(".agent-skill-chain", "00_利用案内.md")
  ];
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(this.consumerGuide, "consumerが先に所有した案内\n");
});
Then("consumerの同名利用案内は保持される", function () {
  assert.ok(
    this.upgradeResult.retained.includes(
      path.join(".agent-skill-chain", "00_利用案内.md"),
    ),
  );
  assert.equal(
    fs.readFileSync(this.consumerGuide, "utf8"),
    "consumerが先に所有した案内\n",
  );
});

Given("dirty fileを持つ一時Git repositoryがある", function () {
  this.root = this.initRepo();
  this.worktree = path.join(
    this.root,
    ".worktrees",
    "20260825_090000-831-gherkin-worktree",
  );
  this.value = configureRemoteDefault(this.root);
  fs.writeFileSync(path.join(this.root, "dirty.txt"), "preserve");
  this.statusBefore = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: this.root, encoding: "utf8" },
  );
});
When("新しいbranchと専用pathでworktreeを作成する", function () {
  createWorktree({
    repoRoot: this.root,
    worktreePath: path.relative(this.root, this.worktree),
    branch: "feature/831-gherkin-worktree",
    base: String(this.value),
    issueNumber: 831,
    slug: "gherkin-worktree",
    currentTime: new Date(2026, 7, 25, 9, 0, 30),
    remoteDefaultBranch: "main",
    remoteDefaultSha: String(this.value),
  });
});
Then("source dirty statusは作成前後で同一である", function () {
  const after = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: this.root, encoding: "utf8" },
  );
  assert.equal(after, this.statusBefore);
});
Then("専用worktreeに指定branchがある", function () {
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: this.worktree,
    encoding: "utf8",
  }).trim();
  assert.equal(branch, "feature/831-gherkin-worktree");
});

Given("異なるorigin URLを持つ一時Git repositoryがある", function () {
  this.root = this.initRepo();
  this.worktree = path.join(
    this.root,
    ".worktrees",
    "20260825_090001-832-wrong-remote",
  );
  execFileSync(
    "git",
    ["remote", "add", "origin", "https://github.com/wrong/repository.git"],
    { cwd: this.root },
  );
  this.value = configureRemoteDefault(this.root);
});
Given(
  "期待repository文字列を一部に含む別originの一時Git repositoryがある",
  function () {
    this.root = this.initRepo();
    this.worktree = path.join(
      this.root,
      ".worktrees",
      "20260825_090002-833-substring-remote",
    );
    execFileSync(
      "git",
      [
        "remote",
        "add",
        "origin",
        "https://github.com/evil/expected/repository.git",
      ],
      { cwd: this.root },
    );
    this.value = configureRemoteDefault(this.root);
  },
);
When("期待repositoryを指定してworktreeを作成する", function () {
  try {
    createWorktree({
      repoRoot: this.root,
      worktreePath: path.relative(this.root, this.worktree),
      branch: `feature/${path.basename(this.worktree).split("-")[1]}-${path.basename(this.worktree).split("-").slice(2).join("-")}`,
      base: String(this.value),
      issueNumber: Number(path.basename(this.worktree).split("-")[1]),
      slug: path.basename(this.worktree).split("-").slice(2).join("-"),
      currentTime: new Date(2026, 7, 25, 9, 0, 30),
      remoteDefaultBranch: "main",
      remoteDefaultSha: String(this.value),
      expectedRepository: "expected/repository",
    });
  } catch (error) {
    this.error = error;
  }
});
Then("worktree createは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("専用pathは存在しない", function () {
  assert.equal(fs.existsSync(this.worktree), false);
});

Given("Git common dirを指すsymlink祖先のworktree pathがある", function () {
  this.root = this.initRepo();
  fs.symlinkSync(
    path.join(this.root, ".git"),
    path.join(this.root, ".worktrees"),
    "dir",
  );
  this.worktree = path.join(
    this.root,
    ".worktrees",
    "20260825_090003-834-symlink-ancestor",
  );
  this.value = configureRemoteDefault(this.root);
});
When("symlink祖先配下へworktreeを作成する", function () {
  try {
    createWorktree({
      repoRoot: this.root,
      worktreePath: path.relative(this.root, this.worktree),
      branch: "feature/834-symlink-ancestor",
      base: String(this.value),
      issueNumber: 834,
      slug: "symlink-ancestor",
      currentTime: new Date(2026, 7, 25, 9, 0, 30),
      remoteDefaultBranch: "main",
      remoteDefaultSha: String(this.value),
    });
  } catch (error) {
    this.error = error;
  }
});

Given("remoteへpush済みのcleanな専用worktreeがある", function () {
  this.root = this.initRepo();
  const remote = this.temp("asc-bare-");
  execFileSync("git", ["init", "--bare", remote]);
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: this.root });
  execFileSync("git", ["push", "-u", "origin", "main"], { cwd: this.root });
  execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: this.root },
  );
  const remoteDefaultSha = execFileSync("git", ["rev-parse", "origin/main"], {
    cwd: this.root,
    encoding: "utf8",
  }).trim();
  this.worktree = path.join(
    this.root,
    ".worktrees",
    "20260825_090004-835-recovery",
  );
  createWorktree({
    repoRoot: this.root,
    worktreePath: path.relative(this.root, this.worktree),
    branch: "feature/835-recovery",
    base: remoteDefaultSha,
    issueNumber: 835,
    slug: "recovery",
    currentTime: new Date(2026, 7, 25, 9, 0, 30),
    remoteDefaultBranch: "main",
    remoteDefaultSha,
  });
  fs.writeFileSync(path.join(this.worktree, "implemented.txt"), "実装済み\n");
  execFileSync("git", ["add", "implemented.txt"], { cwd: this.worktree });
  execFileSync("git", ["commit", "-m", "test: recovery fixture"], {
    cwd: this.worktree,
  });
  execFileSync("git", ["push", "-u", "origin", "feature/835-recovery"], {
    cwd: this.worktree,
  });
});
When("finalize stateをread-onlyで検査する", function () {
  this.finalizeState = inspectFinalizeState(this.root, this.worktree, {
    repository: "o/r",
    base: "main",
    specConsistent: true,
    testsPassed: true,
    reviewApproved: true,
    prMerged: true,
  });
});
Then("recovery参照は上流branchで到達可能である", function () {
  assert.equal(this.finalizeState.recoveryRef, "origin/feature/835-recovery");
  assert.equal(this.finalizeState.recoveryReachable, true);
});

/**
 * 長命branchを宣言したtrusted policyと、その branch を持つ repository を用意する。
 *
 * **`develop`のtipは既定branchと別のcommitにする。** 同一commitだと「baseが
 * 既定branchのtipと一致している」だけで通ってしまい、branch固有の束縛を
 * 検査したことにならない。
 */
function packageRootDir(): string {
  return path.resolve(process.cwd());
}

function prepareDeclaredBaseRepository(
  world: LifecycleWorktreeWorld,
  declared: string[],
): { defaultSha: string; developSha: string } {
  world.root = world.temp();
  execFileSync("git", ["init", "-b", "main"], { cwd: world.root });
  execFileSync("git", ["config", "user.email", "t@example.com"], {
    cwd: world.root,
  });
  execFileSync("git", ["config", "user.name", "t"], { cwd: world.root });
  fs.writeFileSync(path.join(world.root, "seed.txt"), "seed\n");
  execFileSync("git", ["add", "."], { cwd: world.root });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: world.root });
  const defaultSha = configureRemoteDefault(world.root);
  fs.writeFileSync(path.join(world.root, "develop.txt"), "develop\n");
  execFileSync("git", ["add", "."], { cwd: world.root });
  execFileSync("git", ["commit", "-m", "develop"], { cwd: world.root });
  const developSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: world.root,
    encoding: "utf8",
  }).trim();
  execFileSync(
    "git",
    ["update-ref", "refs/remotes/origin/develop", developSha],
    { cwd: world.root },
  );
  execFileSync("git", ["reset", "--hard", defaultSha], { cwd: world.root });
  /**
   * **配布されるdefault policyを土台にし、`merge.branches`だけを差し替える。**
   *
   * fixtureを手書きすると`rules`必須や`worktree.allowedBranchTypes`のような
   * 既存契約を落とし、検査したい境界と別の理由で落ちる。
   */
  const base = JSON.parse(
    fs.readFileSync(
      path.join(
        packageRootDir(),
        ".agent-skill-chain",
        "policy",
        "default.json",
      ),
      "utf8",
    ),
  ) as { policy?: Record<string, unknown> } & Record<string, unknown>;
  const policy = (base.policy ?? base) as Record<string, unknown>;
  const merge = { ...(policy.merge as Record<string, unknown>) };
  merge.mode = "assisted";
  merge.branches = declared;
  merge.methods = ["merge"];
  world.declaredPolicy = { ...policy, merge } as unknown as Policy;
  world.defaultSha = defaultSha;
  world.developSha = developSha;
  return { defaultSha, developSha };
}

Given(
  /^"(.+)"を長命branchとして宣言したtrusted policyと一時Git repositoryがある$/u,
  function (branch: string) {
    prepareDeclaredBaseRepository(this, [branch, "main"]);
  },
);

Given(
  /^trusted policyなしで"(.+)"を持つ一時Git repositoryがある$/u,
  function (branch: string) {
    prepareDeclaredBaseRepository(this, [branch, "main"]);
    this.declaredPolicy = undefined;
  },
);

function createWithBase(
  world: LifecycleWorktreeWorld,
  base: string,
  overrides: { baseSha?: string; withPolicy?: boolean } = {},
) {
  const worktree = path.join(
    world.root,
    ".worktrees",
    "20260825_090000-1139-declared-base",
  );
  try {
    createWorktree({
      repoRoot: world.root,
      worktreePath: path.relative(world.root, worktree),
      branch: "fix/1139-declared-base",
      base: world.developSha,
      issueNumber: 1139,
      slug: "declared-base",
      currentTime: new Date(2026, 7, 25, 9, 0, 30),
      remoteDefaultBranch: "main",
      remoteDefaultSha: world.defaultSha,
      baseBranch: base,
      baseSha: overrides.baseSha ?? world.developSha,
      trustedPolicy:
        overrides.withPolicy === false ? undefined : world.declaredPolicy,
    });
    world.worktree = worktree;
  } catch (error) {
    world.error = error;
  }
}

When(/^"(.+)"を基点にworktreeを作成する$/u, function (base: string) {
  createWithBase(this, base);
});

When(
  /^trusted policyを渡さず"(.+)"を基点にworktreeを作成する$/u,
  function (base: string) {
    createWithBase(this, base, { withPolicy: false });
  },
);

When(
  /^誤ったbase SHAで"(.+)"を基点にworktreeを作成する$/u,
  function (base: string) {
    createWithBase(this, base, { baseSha: "0".repeat(40) });
  },
);

/**
 * base branchの宣言・tip照合はすべて通しつつ、**基点commitだけを別commitにする**。
 *
 * base SHAを誤らせる`SCN-INT-WORKTREE-013`とは別の境界である。あちらは
 * 「申告したtipがproviderの観測と違う」を検出し、こちらは「申告どおりのtipを
 * 持つbranchなのに、実際に分岐する基点がそこでない」を検出する。
 */
When(
  /^base branchのtipでない基点で"(.+)"を基点にworktreeを作成する$/u,
  function (base: string) {
    const worktree = path.join(
      this.root,
      ".worktrees",
      "20260825_090000-1139-declared-base",
    );
    try {
      createWorktree({
        repoRoot: this.root,
        worktreePath: path.relative(this.root, worktree),
        branch: "fix/1139-declared-base",
        base: this.defaultSha,
        issueNumber: 1139,
        slug: "declared-base",
        currentTime: new Date(2026, 7, 25, 9, 0, 30),
        remoteDefaultBranch: "main",
        remoteDefaultSha: this.defaultSha,
        baseBranch: base,
        baseSha: this.developSha,
        trustedPolicy: this.declaredPolicy,
      });
      this.worktree = worktree;
    } catch (error) {
      this.error = error;
    }
  },
);

Then("errorに基点とbase branch commitの不一致が含まれる", function () {
  assert.match(
    String(this.error),
    /基点は取得済みbase branch commitと一致しなければなりません/u,
  );
});

Then("errorに受理するbaseの一覧が含まれる", function () {
  assert.match(String(this.error), /受理するbaseは/u);
});

Then("errorにtrusted policyの観測が必要である旨が含まれる", function () {
  assert.match(String(this.error), /trusted policyの観測が必要です/u);
});

Then("errorにbase branchのtip不一致が含まれる", function () {
  assert.match(String(this.error), /tipが取得済みSHAと一致しません/u);
});

Then("宣言済みbaseのworktreeが作られる", function () {
  assert.equal(this.error, undefined, String(this.error));
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: this.worktree,
    encoding: "utf8",
  }).trim();
  assert.equal(
    head,
    this.developSha,
    "worktreeのHEADがbase branchのtipと一致していません",
  );
  const branch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
    cwd: this.worktree,
    encoding: "utf8",
  }).trim();
  assert.equal(branch, "fix/1139-declared-base");
  assert.notEqual(
    this.developSha,
    this.defaultSha,
    "fixtureのdevelopが既定branchと同一commitでは、branch固有の束縛を検査したことにならない",
  );
});

/**
 * **`--base-branch <既定branch> --base-sha <別commit>`の迂回を固定する。**
 *
 * SHAの正本を「`baseBranch`の指定有無」で決めると、既定branchを明示した経路が
 * 分岐を素通りし、任意commitを基点にできる。実CLIで再現した迂回である。
 */
When("既定branchを明示し別SHAを指定してworktreeを作成する", function () {
  const worktree = path.join(
    this.root,
    ".worktrees",
    "20260825_090000-1139-declared-base",
  );
  try {
    createWorktree({
      repoRoot: this.root,
      worktreePath: path.relative(this.root, worktree),
      branch: "fix/1139-declared-base",
      base: this.developSha,
      issueNumber: 1139,
      slug: "declared-base",
      currentTime: new Date(2026, 7, 25, 9, 0, 30),
      remoteDefaultBranch: "main",
      remoteDefaultSha: this.defaultSha,
      baseBranch: "main",
      baseSha: this.developSha,
      trustedPolicy: this.declaredPolicy,
    });
    this.worktree = worktree;
  } catch (error) {
    this.error = error;
  }
});

Then("errorに既定branch SHAの不一致が含まれる", function () {
  assert.match(
    String(this.error),
    /base branch SHAはremote default branch SHAと一致しなければなりません/u,
  );
});
