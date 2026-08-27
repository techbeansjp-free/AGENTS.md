import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkFileAudit } from "../../scripts/check_file_audit.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

type AuditResult = ReturnType<typeof checkFileAudit>;

class AuditBumpWorld extends WorkflowWorld {
  auditRoot = "";
  auditResult: AuditResult | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<AuditBumpWorld>();

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function commitAll(root: string, message: string): string {
  git(root, ["add", "--all"]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function createAuditedRepository(world: AuditBumpWorld): string {
  const root = world.initRepo();
  writeJson(root, "package.json", {
    name: "audit-fixture",
    version: "0.3.1-beta.1",
    description: "fixture",
  });
  writeJson(root, "package-lock.json", {
    name: "audit-fixture",
    version: "0.3.1-beta.1",
    lockfileVersion: 3,
    packages: { "": { name: "audit-fixture", version: "0.3.1-beta.1" } },
  });
  fs.writeFileSync(path.join(root, "implementation.txt"), "base\n");
  const base = commitAll(root, "test: 監査fixtureの基点を作る");
  fs.writeFileSync(path.join(root, "implementation.txt"), "implemented\n");
  const implementation = commitAll(root, "feat: 監査対象を実装する");
  const auditPath = "docs/reviews/01_課題873実装レビュー.md";
  const artifact = `# 課題873 実装レビュー

| 項目 | 値 |
|---|---|
| 比較基点 | \`${base}\` |
| H_impl | \`${implementation}\` |
| ラウンド数 | 1 |
| Step chain | 迂回: fixtureのため製品経路を通していない |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| \`implementation.txt\` | M | maintainer | fixture | 実装 | 依存なし | AC-873 | 差分を戻す | pass |
`;
  const artifactFile = path.join(root, auditPath);
  fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
  fs.writeFileSync(artifactFile, artifact);
  commitAll(root, "docs: 課題873実装レビューを記録する");
  world.auditRoot = root;
  return root;
}

function bumpPackage(
  root: string,
  includeMetadata = false,
  version = "0.3.1-beta.2",
): void {
  writeJson(root, "package.json", {
    name: "audit-fixture",
    version,
    description: includeMetadata ? "変更されたfixture" : "fixture",
  });
  writeJson(root, "package-lock.json", {
    name: "audit-fixture",
    version,
    lockfileVersion: 3,
    packages: { "": { name: "audit-fixture", version } },
  });
}

function mergePackageChange(
  world: AuditBumpWorld,
  commitMessage: string,
): void {
  const root = createAuditedRepository(world);
  git(root, ["checkout", "-q", "-b", "release/bump-v0.3.1-beta.2"]);
  bumpPackage(root);
  commitAll(root, commitMessage);
  git(root, ["checkout", "-q", "main"]);
  git(root, [
    "merge",
    "--no-ff",
    "-q",
    "release/bump-v0.3.1-beta.2",
    "-m",
    "Merge pull request #873 from example/release/bump-v0.3.1-beta.2",
  ]);
}

Given(
  "監査artifact後に正規のrelease bump commitがある隔離repository",
  function () {
    const root = createAuditedRepository(this);
    bumpPackage(root);
    commitAll(root, "chore(release): bump version to 0.3.1-beta.2 [skip ci]");
  },
);

Given(
  "release bump形式のmessageで対象外fileも変更した隔離repository",
  function () {
    const root = createAuditedRepository(this);
    bumpPackage(root);
    fs.writeFileSync(path.join(root, "unexpected.txt"), "unexpected\n");
    commitAll(root, "chore(release): bump version to 0.3.1-beta.2 [skip ci]");
  },
);

Given(
  "release bump形式のmessageでpackage metadataも変更した隔離repository",
  function () {
    const root = createAuditedRepository(this);
    bumpPackage(root, true);
    commitAll(root, "chore(release): bump version to 0.3.1-beta.2");
  },
);

Given(
  "release bump以外のmessageでpackage.jsonを変更した隔離repository",
  function () {
    const root = createAuditedRepository(this);
    bumpPackage(root);
    commitAll(root, "chore: package metadataを更新する");
  },
);

Given("正規のrelease bumpをmergeした隔離repository", function () {
  mergePackageChange(
    this,
    "chore(release): bump version to 0.3.1-beta.2 [skip ci]",
  );
});

Given("bump以外のpackage変更をmergeした隔離repository", function () {
  const root = createAuditedRepository(this);
  git(root, ["checkout", "-q", "-b", "release/bump-v0.3.1-beta.3"]);
  bumpPackage(root);
  commitAll(root, "chore: package metadataを更新する");
  bumpPackage(root, false, "0.3.1-beta.3");
  commitAll(root, "chore(release): bump version to 0.3.1-beta.3 [skip ci]");
  git(root, ["checkout", "-q", "main"]);
  git(root, [
    "merge",
    "--no-ff",
    "-q",
    "release/bump-v0.3.1-beta.3",
    "-m",
    "Merge pull request #873 from example/release/bump-v0.3.1-beta.3",
  ]);
});

When("隔離repositoryのfile監査を実行する", function () {
  this.auditResult = checkFileAudit(this.auditRoot);
});

Then("file監査は合格する", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
});

Then("file監査はreview artifact以外のpathを理由に失敗する", function () {
  assert.equal(this.auditResult?.valid, false);
  assert.match(
    this.auditResult?.errors.join("\n") ?? "",
    /H_impl\.\.currentはreview artifactだけ/u,
  );
});
