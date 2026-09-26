import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkFileAudit } from "../../scripts/check_file_audit.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import { syntheticReviewEvidenceContent } from "../support/review-evidence-fixture.js";

type AuditResult = ReturnType<typeof checkFileAudit>;

class AuditBumpWorld extends WorkflowWorld {
  auditRoot = "";
  /**
   * 隔離fixtureの旧bump除外境界。**fixtureのHEADを既定にする。**
   * 本repositoryの`LEGACY_RELEASE_BUMP_CUTOFF`はfixture履歴に存在しないため、
   * 既定値のまま渡すと解決不能でfail-closedになる（Issue #1184）。
   */
  auditCutoff = "";
  auditError: string | undefined;
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

function writeAuditArtifact(
  root: string,
  base: string,
  implementation: string,
  auditDirectory = "docs/reviews",
): void {
  const artifactFile = path.join(root, auditDirectory, "873_review.json");
  fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
  fs.writeFileSync(
    artifactFile,
    syntheticReviewEvidenceContent({
      issue: 873,
      baseSha: base,
      implementationHeadSha: implementation,
    }),
  );
}

function createAuditedRepository(
  world: AuditBumpWorld,
  auditDirectory = "docs/reviews",
): string {
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
  writeAuditArtifact(root, base, implementation, auditDirectory);
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

Given("生成物distを実装commitへ含む隔離repository", function () {
  const root = this.initRepo();
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
  fs.mkdirSync(path.join(root, "dist", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "dist", "src", "generated.js"),
    "export const generated = true;\n",
  );
  const implementation = commitAll(root, "feat: 監査対象と生成物を実装する");
  writeAuditArtifact(root, base, implementation);
  commitAll(root, "docs: 課題873実装レビューを記録する");
  this.auditRoot = root;
});

Given(
  "package内review directoryに監査artifactがある隔離repository",
  function () {
    createAuditedRepository(this, ".agent-skill-chain/reviews");
  },
);

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

Given("release bump commitを持たない隔離repository", function () {
  /**
   * **bumpを含まない履歴でもfail-closedにする。** cutoffの解決をrelease bump
   * transitionを見つけた後にだけ行うと、この形では解決不能なcutoffでも合格する
   * （PR #1189 の外部指摘）。
   */
  createAuditedRepository(this);
});

Given("正規のrelease bumpをmergeした隔離repository", function () {
  mergePackageChange(
    this,
    "chore(release): bump version to 0.3.1-beta.2 [skip ci]",
  );
});

/**
 * 既定branch追随の後にrelease bump PRのmergeを取り込んだ実際の着地形を作る。
 *
 * 自動releaseは`release/bump-*` branchのPR mergeとして着地するため、追随merge commitの
 * 別親側には親2個のmerge commitが必ず入る（Issue #975）。`sideNoise`はそのmergeの
 * 別親側へbumpでないcommitを混ぜ、除外がmerge commitを無条件に受け付けていないことを示す。
 */
function createFollowUpBumpRepository(
  world: AuditBumpWorld,
  sideNoise: boolean,
): void {
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
  commitAll(root, "test: 監査fixtureの基点を作る");
  git(root, ["checkout", "-q", "-b", "bugfix/975-follow"]);
  fs.writeFileSync(path.join(root, "implementation.txt"), "implemented\n");
  commitAll(root, "feat: 監査対象を実装する");
  git(root, ["checkout", "-q", "main"]);
  fs.writeFileSync(path.join(root, "mainline.txt"), "mainline\n");
  const mainline = commitAll(root, "feat: 既定branch側を変更する");
  git(root, ["checkout", "-q", "bugfix/975-follow"]);
  git(root, [
    "merge",
    "--no-ff",
    "-q",
    "main",
    "-m",
    "chore: 既定branchを取り込む",
  ]);
  writeAuditArtifact(root, mainline, git(root, ["rev-parse", "HEAD"]));
  commitAll(root, "docs: 課題873実装レビューを記録する");
  git(root, ["checkout", "-q", "main"]);
  git(root, ["checkout", "-q", "-b", "release/bump-v0.3.1-beta.2"]);
  if (sideNoise) {
    // 混入fileは次のbump commitで消す。**mergeの導入差分をbumpだけに保つため**であり、
    // 残すと`hasReleaseBumpChanges`が先に弾いて側の判定へ到達しない。
    fs.writeFileSync(path.join(root, "sneaky.txt"), "sneaky\n");
    commitAll(root, "chore: 別親側へbump以外の変更を混ぜる");
    fs.rmSync(path.join(root, "sneaky.txt"));
  }
  bumpPackage(root);
  commitAll(root, "chore(release): bump version to 0.3.1-beta.2 [skip ci]");
  git(root, ["checkout", "-q", "main"]);
  git(root, [
    "merge",
    "--no-ff",
    "-q",
    "release/bump-v0.3.1-beta.2",
    "-m",
    "Merge pull request #874 from example/release/bump-v0.3.1-beta.2",
  ]);
  git(root, ["checkout", "-q", "bugfix/975-follow"]);
  git(root, [
    "merge",
    "--no-ff",
    "-q",
    "main",
    "-m",
    "chore: 既定branchを取り込む",
  ]);
  world.auditRoot = root;
}

Given(
  "既定branch追随の後にrelease bump PRのmergeだけを取り込んだ隔離repository",
  function () {
    createFollowUpBumpRepository(this, false);
  },
);

Given(
  "既定branch追随で取り込んだmergeの別親側にbump以外のcommitがある隔離repository",
  function () {
    createFollowUpBumpRepository(this, true);
  },
);

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
  this.auditResult = checkFileAudit(
    this.auditRoot,
    this.auditCutoff || git(this.auditRoot, ["rev-parse", "HEAD"]),
  );
});

When("cutoffをbump commitの直前に置いてfile監査を実行する", function () {
  /**
   * **cutoffをbump commit直前（review artifact commit）へ置く。**
   * bumpはcutoffのancestorでなくなるため除外されず、`package.json`が
   * `H_impl..current`へ現れる。**除外窓を広げる変異でも、cutoff判定を消す変異でも落ちる。**
   */
  this.auditResult = checkFileAudit(
    this.auditRoot,
    git(this.auditRoot, ["rev-parse", "HEAD~1"]),
  );
});

When("履歴に存在しないcutoffでfile監査を実行する", function () {
  try {
    this.auditResult = checkFileAudit(
      this.auditRoot,
      "0123456789012345678901234567890123456789",
    );
    this.auditError = undefined;
  } catch (error) {
    this.auditError = error instanceof Error ? error.message : String(error);
  }
});

Then("file監査はbump commitを境界に含めたことを理由に失敗する", function () {
  /**
   * **除外されなかったbumpがreview境界そのものになる。** `H_impl..current`の差分は
   * `package.json`だけになり、review artifactが1件も無い形で拒否される。
   * 除外が効いている場合はこの経路へ到達しない。
   */
  assert.match(
    (this.auditResult?.errors ?? []).join(" "),
    /review証跡のcommitがありません/u,
  );
});

Then("file監査はcutoffを解決できないことを理由に停止する", function () {
  assert.match(
    this.auditError ?? "",
    /cutoff commit .* を解決できないため監査できません/u,
  );
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
    /H_impl\.\.currentはreview証跡だけ/u,
  );
});
