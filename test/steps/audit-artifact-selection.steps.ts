import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkFileAudit } from "../../scripts/check_file_audit.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

type AuditResult = ReturnType<typeof checkFileAudit>;

class AuditSelectionWorld extends WorkflowWorld {
  auditRoot = "";
  auditResult: AuditResult | undefined = undefined;
  auditResults: AuditResult[] = [];
  expectedAuditPath = "";
}

const { Given, When, Then } = stepDefinitions<AuditSelectionWorld>();

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commitPaths(root: string, message: string, paths: string[]): string {
  git(root, ["add", "--", ...paths]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function writeFile(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function auditMarkdown(
  base: string,
  implementation: string,
  auditedPath: string,
  status = "A",
  identity = "| ラウンド数 | 1 |\n| Step chain | 迂回: fixtureのため製品経路を通していない |",
): string {
  return `# fixture実装レビュー

| 項目 | 値 |
|---|---|
| 比較基点 | \`${base}\` |
| H_impl | \`${implementation}\` |
${identity}

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| \`${auditedPath}\` | ${status} | test owner | fixture | 監査対象 | 依存なし | AC-892 | commitを戻す | pass |
`;
}

function addHistoricalArtifacts(root: string, count: number): void {
  const paths: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const auditPath = `docs/reviews/${String(index).padStart(2, "0")}_課題${800 + index}履歴レビュー.md`;
    writeFile(root, auditPath, `# 既存review artifact ${index}\n`);
    paths.push(auditPath);
  }
  if (paths.length > 0) commitPaths(root, "docs: 既存監査履歴を作る", paths);
}

function createImplementation(
  world: AuditSelectionWorld,
  options: { historicalArtifacts?: number; implementationPath?: string } = {},
): { root: string; base: string; implementation: string; changedPath: string } {
  const root = world.initRepo();
  addHistoricalArtifacts(root, options.historicalArtifacts ?? 0);
  const base = git(root, ["rev-parse", "HEAD"]);
  const changedPath = options.implementationPath ?? "src/selection.ts";
  writeFile(root, changedPath, "export const selected = true;\n");
  const implementation = commitPaths(root, "feat: 監査対象を実装する", [
    changedPath,
  ]);
  world.auditRoot = root;
  return { root, base, implementation, changedPath };
}

function commitArtifact(
  world: AuditSelectionWorld,
  fixture: ReturnType<typeof createImplementation>,
  auditPath: string,
  recordedImplementation = fixture.implementation,
  extras: string[] = [],
): void {
  writeFile(
    fixture.root,
    auditPath,
    auditMarkdown(fixture.base, recordedImplementation, fixture.changedPath),
  );
  for (const extra of extras)
    writeFile(fixture.root, extra, `余分な差分: ${extra}\n`);
  commitPaths(fixture.root, "docs: review artifactを記録する", [
    auditPath,
    ...extras,
  ]);
  world.expectedAuditPath = auditPath;
}

function writePackage(root: string, version: string): void {
  writeFile(
    root,
    "package.json",
    `${JSON.stringify({ name: "audit-selection", version }, null, 2)}\n`,
  );
  writeFile(
    root,
    "package-lock.json",
    `${JSON.stringify(
      {
        name: "audit-selection",
        version,
        lockfileVersion: 3,
        packages: { "": { name: "audit-selection", version } },
      },
      null,
      2,
    )}\n`,
  );
}

Given("差分がreview artifact 1件だけの監査選択repository", function () {
  const fixture = createImplementation(this);
  commitArtifact(this, fixture, "docs/reviews/40_課題892実装レビュー.md");
});

Given(
  "40番の既存成果物より後に05番の成果物を追加した監査選択repository",
  function () {
    const root = this.initRepo();
    writeFile(root, "docs/reviews/40_課題840履歴レビュー.md", "# 既存成果物\n");
    commitPaths(root, "docs: 40番の既存成果物を作る", [
      "docs/reviews/40_課題840履歴レビュー.md",
    ]);
    this.auditRoot = root;
    const base = git(root, ["rev-parse", "HEAD"]);
    writeFile(root, "src/lower.ts", "export const lower = true;\n");
    const implementation = commitPaths(root, "feat: 小さい番号を実装する", [
      "src/lower.ts",
    ]);
    const fixture = {
      root,
      base,
      implementation,
      changedPath: "src/lower.ts",
    };
    commitArtifact(this, fixture, "docs/reviews/05_課題892実装レビュー.md");
  },
);

Given("review headの差分が0件の監査選択repository", function () {
  const fixture = createImplementation(this);
  git(fixture.root, [
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "docs: 空のreview commit",
  ]);
});

Given(
  "review artifactと2件の余分なpathを同時にcommitした監査選択repository",
  function () {
    const fixture = createImplementation(this);
    commitArtifact(
      this,
      fixture,
      "docs/reviews/42_課題892実装レビュー.md",
      fixture.implementation,
      ["unexpected/first.txt", "unexpected/second.txt"],
    );
  },
);

Given("差分1件がdocs reviews配下でない監査選択repository", function () {
  const fixture = createImplementation(this);
  writeFile(fixture.root, "notes/review.md", "# review\n");
  commitPaths(fixture.root, "docs: 誤った場所へreviewを記録する", [
    "notes/review.md",
  ]);
});

Given(
  "review artifact後に正規のrelease bumpがある監査選択repository",
  function () {
    const fixture = createImplementation(this);
    writePackage(fixture.root, "0.3.1-beta.1");
    commitPaths(fixture.root, "chore: package fixtureを作る", [
      "package.json",
      "package-lock.json",
    ]);
    const base = git(fixture.root, ["rev-parse", "HEAD"]);
    writeFile(
      fixture.root,
      "src/release-safe.ts",
      "export const safe = true;\n",
    );
    const implementation = commitPaths(fixture.root, "feat: release前実装", [
      "src/release-safe.ts",
    ]);
    commitArtifact(
      this,
      {
        root: fixture.root,
        base,
        implementation,
        changedPath: "src/release-safe.ts",
      },
      "docs/reviews/42_課題892実装レビュー.md",
    );
    writePackage(fixture.root, "0.3.1-beta.2");
    commitPaths(
      fixture.root,
      "chore(release): bump version to 0.3.1-beta.2 [skip ci]",
      ["package.json", "package-lock.json"],
    );
  },
);

Given(
  "artifact本文のH_implがreview headの親と異なる監査選択repository",
  function () {
    const fixture = createImplementation(this);
    commitArtifact(
      this,
      fixture,
      "docs/reviews/42_課題892実装レビュー.md",
      fixture.base,
    );
  },
);

Given(
  "9番の既存成果物より後に10番の成果物を追加した監査選択repository",
  function () {
    const root = this.initRepo();
    writeFile(root, "docs/reviews/9_課題809履歴レビュー.md", "# 既存成果物\n");
    commitPaths(root, "docs: 9番の既存成果物を作る", [
      "docs/reviews/9_課題809履歴レビュー.md",
    ]);
    this.auditRoot = root;
    const base = git(root, ["rev-parse", "HEAD"]);
    writeFile(root, "src/ten.ts", "export const ten = true;\n");
    const implementation = commitPaths(root, "feat: 10番を実装する", [
      "src/ten.ts",
    ]);
    commitArtifact(
      this,
      { root, base, implementation, changedPath: "src/ten.ts" },
      "docs/reviews/10_課題892実装レビュー.md",
    );
  },
);

/** identity欄だけを差し替えたartifactを最終commitにする。他の条件は既存fixtureと同じ。 */
function commitArtifactWithIdentity(
  world: AuditSelectionWorld,
  identity: string,
): void {
  const fixture = createImplementation(world, { historicalArtifacts: 1 });
  const auditPath = "docs/reviews/02_課題986実装レビュー.md";
  writeFile(
    fixture.root,
    auditPath,
    auditMarkdown(
      fixture.base,
      fixture.implementation,
      fixture.changedPath,
      "A",
      identity,
    ),
  );
  commitPaths(fixture.root, "docs: review artifactを記録する", [auditPath]);
  world.expectedAuditPath = auditPath;
}

const BYPASS_IDENTITY =
  "| Step chain | 迂回: fixtureのため製品経路を通していない |";

Given(
  "ラウンド数が{string}のreview artifactを持つ統合監査repository",
  function (rounds: string) {
    commitArtifactWithIdentity(
      this,
      `| ラウンド数 | ${rounds} |\n${BYPASS_IDENTITY}`,
    );
  },
);

Given("ラウンド数欄が無いreview artifactを持つ統合監査repository", function () {
  commitArtifactWithIdentity(this, BYPASS_IDENTITY);
});

Given("Step chain欄が無いreview artifactを持つ統合監査repository", function () {
  commitArtifactWithIdentity(this, "| ラウンド数 | 1 |");
});

Given(
  "Step chainを理由なしで迂回と申告したreview artifactを持つ統合監査repository",
  function () {
    /** 理由が空の申告は申告として成立しない。parserが`(.+)`で非空を保証する。 */
    commitArtifactWithIdentity(
      this,
      "| ラウンド数 | 1 |\n| Step chain | 迂回: |",
    );
  },
);

Given(
  "Step chainを{string}と申告したreview artifactを持つ統合監査repository",
  function (declaration: string) {
    commitArtifactWithIdentity(
      this,
      `| ラウンド数 | 1 |\n| Step chain | ${declaration} |`,
    );
  },
);

Then("監査選択のfile監査は合格する", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    `file監査が失敗しました: ${this.auditResult?.errors.join(" | ")}`,
  );
});

/** 診断文の一部で照合する。**errorsが空でないことだけを見ない。** */
function assertReported(world: AuditSelectionWorld, fragment: string): void {
  const errors = world.auditResult?.errors ?? [];
  assert.ok(
    errors.some((error) => error.includes(fragment)),
    `期待した診断がありません（${fragment}）: ${errors.join(" | ")}`,
  );
}

Then("file監査はラウンド上限超過を報告する", function () {
  assertReported(this, "reviewラウンドが上限を超えています");
});

Then("file監査はラウンド数の欠落を報告する", function () {
  assertReported(this, "ラウンド数");
});

Then("file監査はStep chain申告の欠落を報告する", function () {
  assertReported(this, "Step chain");
});

Given("review artifactを最終commitにした統合監査repository", function () {
  const fixture = createImplementation(this, { historicalArtifacts: 3 });
  commitArtifact(this, fixture, "docs/reviews/02_課題892実装レビュー.md");
});

Given(
  "同じ番号のreview artifactを持つ2 branchを両方mergeしたrepository",
  function () {
    this.auditResults = [];
    const root = this.initRepo();
    const base = git(root, ["rev-parse", "HEAD"]);
    const createBranch = (
      branch: string,
      implementationPath: string,
      auditPath: string,
    ): void => {
      git(root, ["checkout", "-q", "-b", branch, base]);
      writeFile(
        root,
        implementationPath,
        `export const ${branch.replaceAll("-", "_")} = true;\n`,
      );
      const implementation = commitPaths(root, `feat: ${branch}を実装する`, [
        implementationPath,
      ]);
      writeFile(
        root,
        auditPath,
        auditMarkdown(base, implementation, implementationPath),
      );
      commitPaths(root, `docs: ${branch}のreview artifactを記録する`, [
        auditPath,
      ]);
    };
    createBranch(
      "parallel-a",
      "src/parallel-a.ts",
      "docs/reviews/22_課題892並行Aレビュー.md",
    );
    createBranch(
      "parallel-b",
      "src/parallel-b.ts",
      "docs/reviews/22_課題893並行Bレビュー.md",
    );
    git(root, ["checkout", "-q", "main"]);
    git(root, [
      "merge",
      "--no-ff",
      "-q",
      "parallel-a",
      "-m",
      "merge parallel-a",
    ]);
    this.auditResults.push(checkFileAudit(root));
    git(root, [
      "merge",
      "--no-ff",
      "-q",
      "parallel-b",
      "-m",
      "merge parallel-b",
    ]);
    this.auditResults.push(checkFileAudit(root));
    this.auditRoot = root;
  },
);

Given("review artifactと余分なpathをcommitした統合監査repository", function () {
  const fixture = createImplementation(this);
  commitArtifact(
    this,
    fixture,
    "docs/reviews/42_課題892実装レビュー.md",
    fixture.implementation,
    ["unexpected/integration.txt"],
  );
});

Given("既存41件のreview artifactを持つ統合監査repository", function () {
  const fixture = createImplementation(this, { historicalArtifacts: 40 });
  commitArtifact(this, fixture, "docs/reviews/41_課題892実装レビュー.md");
});

When("監査選択repositoryのfile監査を実行する", function () {
  this.auditResult = checkFileAudit(this.auditRoot);
});

When("各branchのmerge後にfile監査を実行する", function () {
  assert.equal(this.auditResults.length, 2);
});

Then("差分内のreview artifactが選ばれてfile監査は合格する", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
  assert.equal(this.auditResult?.auditPath, this.expectedAuditPath);
});

Then("05番のreview artifactが選ばれてfile監査は合格する", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
  assert.equal(
    this.auditResult?.auditPath,
    "docs/reviews/05_課題892実装レビュー.md",
  );
});

Then("review artifact commitの追加方法を示して失敗する", function () {
  assert.equal(this.auditResult?.valid, false);
  assert.match(
    this.auditResult?.errors.join("\n") ?? "",
    /review artifactのcommitがありません。実装commitの後にreview artifactだけをcommitしてください/u,
  );
});

Then("複数差分の診断に全pathが列挙される", function () {
  assert.equal(this.auditResult?.valid, false);
  const errors = this.auditResult?.errors.join("\n") ?? "";
  assert.match(
    errors,
    /H_impl\.\.currentにreview artifact以外のfileが含まれています/u,
  );
  for (const expected of ["unexpected/first.txt", "unexpected/second.txt"])
    assert.ok(errors.includes(expected), expected);
  assert.ok(!errors.includes("docs/reviews/42_課題892実装レビュー.md"));
});

Then("docs reviews配下でないpathと修正方法を示して失敗する", function () {
  assert.equal(this.auditResult?.valid, false);
  const errors = this.auditResult?.errors.join("\n") ?? "";
  assert.ok(errors.includes("notes/review.md"));
  assert.match(errors, /docs\/reviews\/配下/u);
});

Then("release bumpを除外してreview artifact 1件が選ばれる", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
  assert.equal(
    this.auditResult?.auditPath,
    "docs/reviews/42_課題892実装レビュー.md",
  );
});

Then("H_implとcommit構造の不一致を示して失敗する", function () {
  assert.equal(this.auditResult?.valid, false);
  assert.match(
    this.auditResult?.errors.join("\n") ?? "",
    /H_impl.*commit構造.*一致しません/u,
  );
});

Then("10番のreview artifactが選ばれてfile監査は合格する", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
  assert.equal(
    this.auditResult?.auditPath,
    "docs/reviews/10_課題892実装レビュー.md",
  );
});

Then("両方のmerge後に対応するreview artifactが選ばれて合格する", function () {
  assert.deepEqual(
    this.auditResults.map((result) => ({
      valid: result.valid,
      auditPath: result.auditPath,
    })),
    [
      { valid: true, auditPath: "docs/reviews/22_課題892並行Aレビュー.md" },
      { valid: true, auditPath: "docs/reviews/22_課題893並行Bレビュー.md" },
    ],
    this.auditResults.flatMap((result) => result.errors).join("\n"),
  );
});

Then("統合監査の複数差分診断に余分なpathが含まれる", function () {
  assert.equal(this.auditResult?.valid, false);
  const errors = this.auditResult?.errors.join("\n") ?? "";
  assert.match(
    errors,
    /H_impl\.\.currentにreview artifact以外のfileが含まれています/u,
  );
  assert.ok(errors.includes("unexpected/integration.txt"));
});

Then("41件目のreview artifactが選ばれてfile監査は合格する", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
  assert.equal(
    this.auditResult?.auditPath,
    "docs/reviews/41_課題892実装レビュー.md",
  );
});
