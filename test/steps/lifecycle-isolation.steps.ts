import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  doctor,
  init,
  uninstall,
  upgrade,
} from "../../src/domain/lifecycle.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface IsolationWorld extends WorkflowWorld {
  applyResult: ReturnType<typeof uninstall>;
  cliResults: Array<ReturnType<typeof runCli>>;
  consumerFiles: Record<string, string>;
  doctorHealthy: boolean;
  externalFile: string;
  installedAssets: string[];
  invalidRecordRejected: boolean;
  root: string;
  secondDeleteRejected: boolean;
  statusBefore: string;
}

const { Given, When, Then } = stepDefinitions<IsolationWorld>();

function sha256(contents: string | Buffer): string {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function write(root: string, relative: string, contents: string): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function readObject(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError(`JSON objectではありません: ${file}`);
  return parsed as Record<string, unknown>;
}

function recordFiles(record: Record<string, unknown>): Record<string, unknown> {
  const files = record.files;
  if (files === null || typeof files !== "object" || Array.isArray(files))
    throw new TypeError("managed asset recordのfilesがobjectではありません");
  return files as Record<string, unknown>;
}

function recordPath(root: string): string {
  return path.join(root, ".agent-skill-chain", "managed-assets.json");
}

function writeRecord(root: string, record: Record<string, unknown>): void {
  fs.writeFileSync(recordPath(root), `${JSON.stringify(record, null, 2)}\n`);
}

function gitStatus(root: string): string {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  );
}

function runCli(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [path.resolve("dist/bin/agent-skill-chain.js"), ...args, `--root=${root}`],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

function captureFiles(
  root: string,
  relatives: string[],
): Record<string, string> {
  return Object.fromEntries(
    relatives.map((relative) => [
      relative,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

function assertCapturedFiles(
  root: string,
  expected: Record<string, string>,
): void {
  for (const [relative, contents] of Object.entries(expected))
    assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), contents);
}

Given("lifecycle検証用の隔離directoryがある", function () {
  this.root = this.temp("asc-lifecycle-sequence-");
  write(this.root, "README.md", "# fixture\n");
  this.consumerFiles = { "README.md": "# fixture\n" };
});

When("隔離先でsetupとupdateとdeleteを順に適用する", function () {
  const preview = init(this.root, { apply: false });
  assert.equal(preview.applied, false);
  assert.equal(fs.existsSync(path.join(this.root, "AGENTS.md")), false);
  const installed = init(this.root, { apply: true });
  this.installedAssets = installed.assets;
  const updated = upgrade(this.root, { apply: true });
  assert.equal(updated.applied, true);
  this.doctorHealthy = doctor(this.root).healthy;
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("package管理資産だけが追加更新削除される", function () {
  assert.equal(this.applyResult.applied, true);
  assert.equal(this.doctorHealthy, true);
  assert.equal(fs.existsSync(recordPath(this.root)), false);
  for (const relative of this.installedAssets)
    assert.equal(fs.existsSync(path.join(this.root, relative)), false);
  assertCapturedFiles(this.root, this.consumerFiles);
});

Given("lifecycle隔離先に他skillと利用者文書と他ツール設定がある", function () {
  this.root = this.temp("asc-lifecycle-assets-");
  const external = this.temp("asc-lifecycle-link-target-");
  this.externalFile = write(external, "外部.txt", "外部の利用者資産\n");
  const relatives = [
    ".other-tool/skills/foo.md",
    "docs/specs/利用者仕様.md",
    "README.md",
    ".editorconfig",
    ".vscode/settings.json",
  ];
  relatives.forEach((relative) =>
    write(this.root, relative, `keep:${relative}\n`),
  );
  fs.mkdirSync(path.join(this.root, "links"), { recursive: true });
  fs.symlinkSync(
    path.join(this.root, ".agent-skill-chain", "docs", "00_運用ポリシー.md"),
    path.join(this.root, "links", "package-owned"),
  );
  fs.symlinkSync(this.externalFile, path.join(this.root, "links", "external"));
  this.consumerFiles = captureFiles(this.root, relatives);
});

When("lifecycle隔離先で導入後にdeleteを適用する", function () {
  init(this.root, { apply: true });
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("他skillと利用者文書と他ツール設定は同一内容で残る", function () {
  assert.equal(this.applyResult.applied, true);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(
    fs
      .lstatSync(path.join(this.root, "links", "package-owned"))
      .isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.lstatSync(path.join(this.root, "links", "external")).isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.readFileSync(this.externalFile, "utf8"),
    "外部の利用者資産\n",
  );
});

Given("dirtyな隔離Git repositoryにconsumer所有資産がある", function () {
  this.root = this.initRepo();
  const tracked = [
    "docs/specs/利用者仕様.md",
    ".agent-skill-chain/project-policy.json",
    ".agent-skill-chain/project/rules/consumer.json",
  ];
  tracked.forEach((relative) =>
    write(this.root, relative, `tracked:${relative}\n`),
  );
  execFileSync("git", ["add", ...tracked], { cwd: this.root });
  execFileSync("git", ["commit", "-q", "-m", "consumer assets"], {
    cwd: this.root,
  });
  write(this.root, "docs/specs/利用者仕様.md", "dirty spec\n");
  write(this.root, ".agent-skill-chain/tmp/issues/draft.md", "staging\n");
  write(this.root, "未追跡.txt", "untracked\n");
  this.consumerFiles = captureFiles(this.root, [
    ...tracked,
    ".agent-skill-chain/tmp/issues/draft.md",
    "未追跡.txt",
  ]);
  this.statusBefore = gitStatus(this.root);
});

When("dirty状態のままsetupとupdateとdeleteを適用する", function () {
  init(this.root, { apply: true });
  upgrade(this.root, { apply: true });
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("consumer所有資産とdirty状態は保持される", function () {
  assert.equal(this.applyResult.applied, true);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(gitStatus(this.root), this.statusBefore);
});

Given("導入済み隔離先と改ざんrecordの反例がある", function () {
  this.root = this.temp("asc-lifecycle-tampered-");
  init(this.root, { apply: true });
  this.invalidRecordRejected = false;
});

When("hash不一致と不正recordでdeleteを試みる", function () {
  write(this.root, "AGENTS.md", "consumer modified\n");
  this.applyResult = uninstall(this.root, { apply: true });

  const corruptions: Array<(root: string) => void> = [
    (root) => fs.writeFileSync(recordPath(root), "{broken"),
    (root) => {
      const record = readObject(recordPath(root));
      record.files = [];
      writeRecord(root, record);
    },
    (root) => {
      const record = readObject(recordPath(root));
      recordFiles(record)["AGENTS.md"] = "not-a-sha256";
      writeRecord(root, record);
    },
  ];
  this.invalidRecordRejected = corruptions.every((corrupt) => {
    const root = this.temp("asc-lifecycle-invalid-record-");
    init(root, { apply: true });
    corrupt(root);
    try {
      uninstall(root, { apply: true });
      return false;
    } catch {
      return fs.existsSync(path.join(root, "AGENTS.md"));
    }
  });
});

Then("hash不一致資産を保持し不正recordは削除前に拒否する", function () {
  assert.ok(this.applyResult.retained.includes("AGENTS.md"));
  assert.equal(
    fs.readFileSync(path.join(this.root, "AGENTS.md"), "utf8"),
    "consumer modified\n",
  );
  assert.equal(this.invalidRecordRejected, true);
});

Given("導入済み隔離先と境界外の一時資産がある", function () {
  this.root = this.temp("asc-lifecycle-boundary-");
  const outside = this.temp("asc-lifecycle-outside-");
  this.externalFile = write(outside, "重要.txt", "境界外\n");
  init(this.root, { apply: true });
  this.invalidRecordRejected = false;
});

When("traversal recordとsymlink脱出でdeleteを試みる", function () {
  const traversalKeys = [
    "../outside.txt",
    this.externalFile,
    ".agent-skill-chain/docs/e\u0301/../00_運用ポリシー.md",
  ];
  const traversalRejected = traversalKeys.every((key) => {
    const root = this.temp("asc-lifecycle-traversal-");
    init(root, { apply: true });
    const record = readObject(recordPath(root));
    recordFiles(record)[key] = sha256("境界外\n");
    writeRecord(root, record);
    try {
      uninstall(root, { apply: true });
      return false;
    } catch {
      return fs.existsSync(path.join(root, "AGENTS.md"));
    }
  });

  const agents = path.join(this.root, "AGENTS.md");
  const original = fs.readFileSync(agents);
  fs.writeFileSync(this.externalFile, original);
  fs.rmSync(agents);
  fs.symlinkSync(this.externalFile, agents);
  let symlinkRejected = false;
  try {
    uninstall(this.root, { apply: true });
  } catch {
    symlinkRejected = true;
  }
  this.invalidRecordRejected = traversalRejected && symlinkRejected;
});

Then("境界内外の資産を削除せず拒否する", function () {
  assert.equal(this.invalidRecordRejected, true);
  assert.equal(
    fs.lstatSync(path.join(this.root, "AGENTS.md")).isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(this.root, ".agent-skill-chain", "00_利用案内.md")),
    true,
  );
  assert.equal(fs.existsSync(this.externalFile), true);
});

Given("delete preview済みの隔離先がある", function () {
  this.root = this.temp("asc-lifecycle-toctou-");
  init(this.root, { apply: true });
  const preview = uninstall(this.root, { apply: false });
  assert.ok(preview.removable.includes(path.join(this.root, "AGENTS.md")));
});

When("preview後に削除対象の内容を変更してapplyする", function () {
  write(this.root, "AGENTS.md", "preview後の変更\n");
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("変更された削除対象はretainedとして残る", function () {
  assert.ok(this.applyResult.retained.includes("AGENTS.md"));
  assert.equal(
    fs.readFileSync(path.join(this.root, "AGENTS.md"), "utf8"),
    "preview後の変更\n",
  );
});

Given("削除の一部だけが失敗する導入済み隔離先がある", function () {
  this.root = this.temp("asc-lifecycle-partial-");
  init(this.root, { apply: true });
});

When("部分失敗を起こすdeleteを適用する", function () {
  fs.chmodSync(this.root, 0o555);
  try {
    this.applyResult = uninstall(this.root, { apply: true });
  } finally {
    fs.chmodSync(this.root, 0o755);
  }
});

Then("削除済みと未処理と復旧方法を報告してrecordを保持する", function () {
  assert.equal(this.applyResult.applied, false);
  assert.ok(this.applyResult.removed.length > 0);
  assert.ok(this.applyResult.pending.includes("AGENTS.md"));
  assert.match(this.applyResult.recovery, /再実行/u);
  assert.equal(fs.existsSync(recordPath(this.root)), true);
});

Given("旧version recordとconsumer資産を持つ隔離先がある", function () {
  this.root = this.temp("asc-lifecycle-legacy-");
  init(this.root, { apply: true });
  write(this.root, "consumer-owned.txt", "consumer\n");
  const legacyRelative = ".agent-skill-chain/docs/旧配置.md";
  write(this.root, legacyRelative, "legacy package asset\n");
  const record = readObject(recordPath(this.root));
  record.version = "0.2.0";
  recordFiles(record)[legacyRelative] = sha256("legacy package asset\n");
  writeRecord(this.root, record);
  this.consumerFiles = captureFiles(this.root, ["consumer-owned.txt"]);
  this.secondDeleteRejected = false;
});

When("updateを2回適用してdeleteも再実行する", function () {
  upgrade(this.root, { apply: true });
  upgrade(this.root, { apply: true });
  this.applyResult = uninstall(this.root, { apply: true });
  try {
    uninstall(this.root, { apply: true });
  } catch {
    this.secondDeleteRejected = true;
  }
});

Then("consumer資産を保持して2回目のdeleteは安全に停止する", function () {
  assert.equal(this.applyResult.applied, true);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(this.secondDeleteRejected, true);
});

Given("Unicode pathと読み取り専用資産が共存する隔離先がある", function () {
  this.root = this.temp("asc-lifecycle-unicode-");
  const relatives = [
    "利用者/全角/文書.txt",
    "利用者/café/文書.txt",
    "利用者/cafe\u0301/文書.txt",
    "利用者/読取専用.txt",
  ];
  relatives.forEach((relative) =>
    write(this.root, relative, `keep:${relative}\n`),
  );
  fs.chmodSync(path.join(this.root, "利用者", "読取専用.txt"), 0o444);
  this.consumerFiles = captureFiles(this.root, relatives);
});

When("setupとupdateとdeleteを適用する", function () {
  init(this.root, { apply: true });
  upgrade(this.root, { apply: true });
  this.applyResult = uninstall(this.root, { apply: true });
});

Then("Unicode pathと読み取り専用資産は同一内容で残る", function () {
  assert.equal(this.applyResult.applied, true);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(
    fs.statSync(path.join(this.root, "利用者", "読取専用.txt")).mode & 0o777,
    0o444,
  );
});

Given("CLI lifecycle用の隔離consumerがある", function () {
  this.root = this.temp("asc-lifecycle-cli-");
  write(this.root, "README.md", "CLI consumer\n");
  this.consumerFiles = captureFiles(this.root, ["README.md"]);
  this.cliResults = [];
});

When("CLIのinstallとupdateとdeleteをapplyする", function () {
  this.cliResults = [
    runCli(this.root, ["install", "--apply"]),
    runCli(this.root, ["update", "--apply"]),
    runCli(this.root, ["delete", "--apply"]),
  ];
});

Then("CLI lifecycleは成功してconsumer資産だけが残る", function () {
  for (const result of this.cliResults)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assertCapturedFiles(this.root, this.consumerFiles);
  assert.equal(fs.existsSync(recordPath(this.root)), false);
  assert.equal(fs.existsSync(path.join(this.root, "AGENTS.md")), false);
});

Given("CLIで導入済みの隔離consumerと外部一時資産がある", function () {
  this.root = this.temp("asc-lifecycle-cli-preview-");
  const outside = this.temp("asc-lifecycle-cli-outside-");
  this.externalFile = write(outside, "保持.txt", "outside\n");
  const installResult = runCli(this.root, ["install", "--apply"]);
  assert.equal(installResult.status, 0, installResult.stderr);
  fs.symlinkSync(this.externalFile, path.join(this.root, "external-link"));
  this.consumerFiles = {
    "AGENTS.md": sha256(fs.readFileSync(path.join(this.root, "AGENTS.md"))),
    ".agent-skill-chain/managed-assets.json": sha256(
      fs.readFileSync(recordPath(this.root)),
    ),
  };
  this.cliResults = [];
});

When("applyなしでCLIのdeleteを実行する", function () {
  this.cliResults = [runCli(this.root, ["delete"])];
});

Then("deleteはpreviewだけを返して隔離先と外部資産を変更しない", function () {
  const result = this.cliResults[0];
  assert.equal(result?.status, 0, result?.stderr);
  assert.equal(
    sha256(fs.readFileSync(path.join(this.root, "AGENTS.md"))),
    this.consumerFiles["AGENTS.md"],
  );
  assert.equal(
    sha256(fs.readFileSync(recordPath(this.root))),
    this.consumerFiles[".agent-skill-chain/managed-assets.json"],
  );
  assert.equal(fs.readFileSync(this.externalFile, "utf8"), "outside\n");
  assert.equal(
    fs.lstatSync(path.join(this.root, "external-link")).isSymbolicLink(),
    true,
  );
});
