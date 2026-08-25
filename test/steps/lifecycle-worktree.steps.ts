import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
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
}

const { Given, When, Then } = stepDefinitions<LifecycleWorld>();

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
  this.worktree = `${this.root}-worktree`;
  this.temporaryDirectories.push(this.worktree);
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
    worktreePath: this.worktree,
    branch: "feature/gherkin-worktree",
    base: "main",
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
  assert.equal(branch, "feature/gherkin-worktree");
});

Given("異なるorigin URLを持つ一時Git repositoryがある", function () {
  this.root = this.initRepo();
  this.worktree = `${this.root}-wrong-remote`;
  this.temporaryDirectories.push(this.worktree);
  execFileSync(
    "git",
    ["remote", "add", "origin", "https://github.com/wrong/repository.git"],
    { cwd: this.root },
  );
});
Given(
  "期待repository文字列を一部に含む別originの一時Git repositoryがある",
  function () {
    this.root = this.initRepo();
    this.worktree = `${this.root}-substring-remote`;
    this.temporaryDirectories.push(this.worktree);
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
  },
);
When("期待repositoryを指定してworktreeを作成する", function () {
  try {
    createWorktree({
      repoRoot: this.root,
      worktreePath: this.worktree,
      branch: "feature/must-not-exist",
      base: "main",
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
  const alias = `${this.root}-git-alias`;
  this.temporaryDirectories.push(alias);
  fs.symlinkSync(path.join(this.root, ".git"), alias, "dir");
  this.worktree = path.join(alias, "nested-worktree");
});
When("symlink祖先配下へworktreeを作成する", function () {
  try {
    createWorktree({
      repoRoot: this.root,
      worktreePath: this.worktree,
      branch: "feature/symlink-ancestor",
      base: "main",
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
  this.worktree = `${this.root}-pushed-worktree`;
  this.temporaryDirectories.push(this.worktree);
  createWorktree({
    repoRoot: this.root,
    worktreePath: this.worktree,
    branch: "feature/recovery",
    base: "main",
  });
  fs.writeFileSync(path.join(this.worktree, "implemented.txt"), "実装済み\n");
  execFileSync("git", ["add", "implemented.txt"], { cwd: this.worktree });
  execFileSync("git", ["commit", "-m", "test: recovery fixture"], {
    cwd: this.worktree,
  });
  execFileSync("git", ["push", "-u", "origin", "feature/recovery"], {
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
  assert.equal(this.finalizeState.recoveryRef, "origin/feature/recovery");
  assert.equal(this.finalizeState.recoveryReachable, true);
});
