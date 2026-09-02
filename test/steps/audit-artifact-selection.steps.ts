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
  identity = [
    "| ラウンド数 | 1 |",
    "| Step chain | 迂回: fixtureのため製品経路を通していない |",
    "| 仕様の所有箇所 | `docs/specs/fixture.md:1`「fixtureの仕様」 |",
    "| 成果物行数 | 製品 1行 / 支援層 2行 |",
    "| 縮小の先行評価 | 既存fixtureの流用では監査経路を通らないため |",
  ].join("\n"),
): string {
  return `# fixture実装レビュー

## 0. レビュー識別情報

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

/**
 * 比較基点の導出を確かめるfixture。
 *
 * `mergeRef`はCIが`pull_request`でcheckoutする`refs/pull/<N>/merge`と同じ形、つまり
 * **第1親が取り込み先の既定branch tip、第2親が候補head**のmerge commitをHEADにする。
 * 既定branch上のPR mergeも同じ形である。`narrowed`は比較基点を候補branch内のcommitへ
 * 前進させ、個別監査表もその範囲へ揃える。**表と範囲は整合したままなので、比較基点の
 * 導出だけが縮小を検出できる**（Issue #966）。
 */
function createBaseDerivationFixture(
  world: AuditSelectionWorld,
  options: { narrowed: boolean; mergeRef: boolean },
): void {
  const root = world.initRepo();
  world.auditRoot = root;
  writeFile(root, "keep.txt", "base\n");
  const mainTip = commitPaths(root, "test: 既定branchの基点を作る", [
    "keep.txt",
  ]);
  git(root, ["checkout", "-q", "-b", "feature/966-base"]);
  let declaredBase = mainTip;
  if (options.narrowed) {
    writeFile(root, "hidden.txt", "監査から隠したい変更\n");
    declaredBase = commitPaths(root, "feat: 監査から隠したい変更", [
      "hidden.txt",
    ]);
  }
  writeFile(root, "keep.txt", "changed\n");
  const implementation = commitPaths(root, "feat: 申告する変更", ["keep.txt"]);
  const auditPath = "docs/reviews/42_課題966実装レビュー.md";
  writeFile(
    root,
    auditPath,
    auditMarkdown(declaredBase, implementation, "keep.txt", "M"),
  );
  const head = commitPaths(root, "docs: review artifactを記録する", [
    auditPath,
  ]);
  world.expectedAuditPath = auditPath;
  if (!options.mergeRef) return;
  const tree = git(root, ["merge-tree", "--write-tree", mainTip, head]);
  const mergeRef = git(root, [
    "commit-tree",
    tree,
    "-p",
    mainTip,
    "-p",
    head,
    "-m",
    "Merge pull request #966 from example/feature/966-base",
  ]);
  git(root, [
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "-q",
    "--detach",
    mergeRef,
  ]);
}

function world_expect(world: AuditSelectionWorld, auditPath: string): void {
  world.expectedAuditPath = auditPath;
}

/** 候補branchのhead上にmerge refを作り、detachしてHEADにする。 */
function checkoutMergeRef(
  root: string,
  firstParent: string,
  head: string,
): void {
  const tree = git(root, ["merge-tree", "--write-tree", firstParent, head]);
  const mergeRef = git(root, [
    "commit-tree",
    tree,
    "-p",
    firstParent,
    "-p",
    head,
    "-m",
    "Merge pull request #966 from example/feature/966-base",
  ]);
  git(root, [
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "-q",
    "--detach",
    mergeRef,
  ]);
}

/**
 * 既定branch追随mergeを作る。**親順は`[候補head, 既定branch tip]`である。**
 *
 * `gh pr update-branch`と`git merge origin/main`がこの形を作る。既定branchへのPR merge
 * （親順`[取り込み先tip, 候補head]`）と親の個数が同じで順序だけが逆であり、位置では
 * 区別できない（Issue #1004）。
 */
function checkoutFollowMergeRef(
  root: string,
  candidateHead: string,
  defaultBranchTip: string,
): void {
  const tree = git(root, [
    "merge-tree",
    "--write-tree",
    candidateHead,
    defaultBranchTip,
  ]);
  const mergeRef = git(root, [
    "commit-tree",
    tree,
    "-p",
    candidateHead,
    "-p",
    defaultBranchTip,
    "-m",
    "Merge remote-tracking branch 'origin/main' into feature/1004-follow",
  ]);
  git(root, [
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "-q",
    "--detach",
    mergeRef,
  ]);
}

Given(
  "既定branchを取り込んだ追随merge commitをHEADにした監査選択repository",
  function () {
    const root = this.initRepo();
    this.auditRoot = root;
    writeFile(root, "keep.txt", "base\n");
    const start = commitPaths(root, "test: 既定branchの基点を作る", [
      "keep.txt",
    ]);
    git(root, ["checkout", "-q", "-b", "candidate", start]);
    writeFile(root, "keep.txt", "changed\n");
    const implementation = commitPaths(root, "feat: 申告する変更", [
      "keep.txt",
    ]);
    const auditPath = "docs/reviews/42_課題1004実装レビュー.md";
    writeFile(
      root,
      auditPath,
      auditMarkdown(start, implementation, "keep.txt", "M"),
    );
    const candidateHead = commitPaths(root, "docs: review artifactを記録する", [
      auditPath,
    ]);
    git(root, ["checkout", "-q", "main", "--"]);
    git(root, ["checkout", "-q", "main"]);
    /**
     * **既定branch側の変更を2 fileにする。** 候補側の着地形（review artifact 1件）と
     * 件数が同じだと、件数を常に同じ値にする実装でも診断のassertionが通る。
     */
    writeFile(root, "other.txt", "既定branch側の別変更\n");
    writeFile(root, "another.txt", "既定branch側の2件目\n");
    const defaultTip = commitPaths(root, "feat: 既定branch側を進める", [
      "other.txt",
      "another.txt",
    ]);
    this.expectedAuditPath = auditPath;
    checkoutFollowMergeRef(root, candidateHead, defaultTip);
  },
);

Given(
  "どちらの親も着地形でない境界commitをHEADにした監査選択repository",
  function () {
    const root = this.initRepo();
    this.auditRoot = root;
    writeFile(root, "keep.txt", "base\n");
    const start = commitPaths(root, "test: 既定branchの基点を作る", [
      "keep.txt",
    ]);
    git(root, ["checkout", "-q", "-b", "candidate", start]);
    writeFile(root, "keep.txt", "changed\n");
    writeFile(root, "extra.txt", "artifactと同じcommitに混ぜた変更\n");
    const candidateHead = commitPaths(root, "feat: 申告する変更", [
      "keep.txt",
      "extra.txt",
    ]);
    git(root, ["checkout", "-q", "main"]);
    writeFile(root, "other.txt", "既定branch側の別変更\n");
    const defaultTip = commitPaths(root, "feat: 既定branch側を進める", [
      "other.txt",
    ]);
    checkoutFollowMergeRef(root, candidateHead, defaultTip);
  },
);

Given("親が3個の境界commitをHEADにした監査選択repository", function () {
  const root = this.initRepo();
  this.auditRoot = root;
  writeFile(root, "keep.txt", "base\n");
  const start = commitPaths(root, "test: 基点を作る", ["keep.txt"]);
  git(root, ["checkout", "-q", "-b", "extra", start]);
  writeFile(root, "extra.txt", "extra\n");
  const extra = commitPaths(root, "feat: 第3の親を作る", ["extra.txt"]);
  git(root, ["checkout", "-q", "-b", "target", start]);
  writeFile(root, "target.txt", "target\n");
  const targetTip = commitPaths(root, "feat: 取り込み先を進める", [
    "target.txt",
  ]);
  git(root, ["checkout", "-q", "-b", "candidate", start]);
  writeFile(root, "keep.txt", "changed\n");
  const implementation = commitPaths(root, "feat: 申告する変更", ["keep.txt"]);
  const auditPath = "docs/reviews/42_課題966実装レビュー.md";
  writeFile(
    root,
    auditPath,
    auditMarkdown(start, implementation, "keep.txt", "M"),
  );
  const head = commitPaths(root, "docs: review artifactを記録する", [
    auditPath,
  ]);
  world_expect(this, auditPath);
  // octopus merge: 取り込み先・第3の親・候補headの3親
  const tree = git(root, ["merge-tree", "--write-tree", targetTip, head]);
  const mergeRef = git(root, [
    "commit-tree",
    tree,
    "-p",
    targetTip,
    "-p",
    extra,
    "-p",
    head,
    "-m",
    "Merge pull request #966 (octopus)",
  ]);
  git(root, [
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "-q",
    "--detach",
    mergeRef,
  ]);
});

Given(
  "merge-baseが一意でない履歴でmerge commitをHEADにした監査選択repository",
  function () {
    const root = this.initRepo();
    this.auditRoot = root;
    writeFile(root, "keep.txt", "base\n");
    const start = commitPaths(root, "test: 基点を作る", ["keep.txt"]);
    git(root, ["checkout", "-q", "-b", "left", start]);
    writeFile(root, "left.txt", "left\n");
    const left = commitPaths(root, "feat: 片側を変更する", ["left.txt"]);
    git(root, ["checkout", "-q", "-b", "right", start]);
    writeFile(root, "right.txt", "right\n");
    const right = commitPaths(root, "feat: もう片側を変更する", ["right.txt"]);
    // criss-cross: 互いに相手を取り込み、merge-baseを2解にする
    git(root, ["checkout", "-q", "-b", "target", right]);
    git(root, [
      "merge",
      "-q",
      "--no-ff",
      left,
      "-m",
      "chore: 取り込み先で取り込む",
    ]);
    const targetTip = git(root, ["rev-parse", "HEAD"]);
    git(root, ["checkout", "-q", "-b", "candidate", left]);
    git(root, ["merge", "-q", "--no-ff", right, "-m", "chore: 候補で取り込む"]);
    writeFile(root, "keep.txt", "changed\n");
    const implementation = commitPaths(root, "feat: 申告する変更", [
      "keep.txt",
    ]);
    const auditPath = "docs/reviews/42_課題966実装レビュー.md";
    writeFile(
      root,
      auditPath,
      auditMarkdown(targetTip, implementation, "keep.txt", "M"),
    );
    const head = commitPaths(root, "docs: review artifactを記録する", [
      auditPath,
    ]);
    world_expect(this, auditPath);
    checkoutMergeRef(root, targetTip, head);
  },
);

Given("fork点を取得範囲の外に置いた浅いcloneの監査選択repository", function () {
  const origin = this.initRepo();
  writeFile(origin, "keep.txt", "base\n");
  const forkPoint = commitPaths(origin, "test: 分岐点を作る", ["keep.txt"]);
  // 取り込み先を深くして、fork点を浅いcloneの取得範囲の外へ出す
  for (let index = 1; index <= 8; index += 1) {
    writeFile(origin, `target${index}.txt`, `target ${index}\n`);
    commitPaths(origin, `feat: 取り込み先を進める ${index}`, [
      `target${index}.txt`,
    ]);
  }
  const targetTip = git(origin, ["rev-parse", "HEAD"]);
  git(origin, ["checkout", "-q", "-b", "candidate", forkPoint]);
  writeFile(origin, "hidden.txt", "監査から隠したい変更\n");
  const hidden = commitPaths(origin, "feat: 監査から隠したい変更", [
    "hidden.txt",
  ]);
  writeFile(origin, "keep.txt", "changed\n");
  const implementation = commitPaths(origin, "feat: 申告する変更", [
    "keep.txt",
  ]);
  const auditPath = "docs/reviews/42_課題966実装レビュー.md";
  // 比較基点を候補branch内へ前進させた申告。浅いcloneで導出を飛ばすと通ってしまう
  writeFile(
    origin,
    auditPath,
    auditMarkdown(hidden, implementation, "keep.txt", "M"),
  );
  const head = commitPaths(origin, "docs: review artifactを記録する", [
    auditPath,
  ]);
  checkoutMergeRef(origin, targetTip, head);
  const mergeRef = git(origin, ["rev-parse", "HEAD"]);
  const shallow = path.join(this.temp(), "shallow");
  execFileSync(
    "git",
    [
      "-c",
      "advice.detachedHead=false",
      "clone",
      "-q",
      "--depth",
      "3",
      "--no-single-branch",
      `file://${origin}`,
      shallow,
    ],
    { encoding: "utf8" },
  );
  git(shallow, ["fetch", "-q", "--depth", "3", "origin", mergeRef]);
  git(shallow, [
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "-q",
    "--detach",
    "FETCH_HEAD",
  ]);
  this.auditRoot = shallow;
  world_expect(this, auditPath);
});

Given(
  "第1親が既定branch tipのmerge commitをHEADにした監査選択repository",
  function () {
    createBaseDerivationFixture(this, { narrowed: false, mergeRef: true });
  },
);

Given(
  "比較基点を候補branch内へ前進させmerge commitをHEADにした監査選択repository",
  function () {
    createBaseDerivationFixture(this, { narrowed: true, mergeRef: true });
  },
);

Given(
  "比較基点を候補branch内へ前進させartifact commitをHEADにした監査選択repository",
  function () {
    createBaseDerivationFixture(this, { narrowed: true, mergeRef: false });
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

const OBSERVATION_ROWS: Readonly<Record<string, string>> = {
  仕様の所有箇所: "`docs/specs/fixture.md:1`「fixtureの仕様」",
  成果物行数: "製品 1行 / 支援層 2行",
  縮小の先行評価: "既存fixtureの流用では監査経路を通らないため",
};

/** 観測基準の欄を組み立てる。`overrides`で1欄だけ差し替え、`undefined`で欄ごと落とす。 */
function observationRows(
  overrides: Readonly<Record<string, string | undefined>> = {},
): string {
  return Object.entries(OBSERVATION_ROWS)
    .map(([label, value]) => [
      label,
      label in overrides ? overrides[label] : value,
    ])
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `| ${label} | ${value} |`)
    .join("\n");
}

const BYPASS_IDENTITY = [
  "| Step chain | 迂回: fixtureのため製品経路を通していない |",
  observationRows(),
].join("\n");

Given(
  "{string}の欄が無いreview artifactを持つ統合監査repository",
  function (label: string) {
    commitArtifactWithIdentity(
      this,
      [
        "| ラウンド数 | 1 |",
        "| Step chain | 迂回: fixtureのため製品経路を通していない |",
        observationRows({ [label]: undefined }),
      ].join("\n"),
    );
  },
);

Given(
  "{string}が空欄のreview artifactを持つ統合監査repository",
  function (label: string) {
    commitArtifactWithIdentity(
      this,
      [
        "| ラウンド数 | 1 |",
        "| Step chain | 迂回: fixtureのため製品経路を通していない |",
        observationRows({ [label]: "" }),
      ].join("\n"),
    );
  },
);

Given(
  "仕様の所有箇所が{string}のreview artifactを持つ統合監査repository",
  function (value: string) {
    commitArtifactWithIdentity(
      this,
      [
        "| ラウンド数 | 1 |",
        "| Step chain | 迂回: fixtureのため製品経路を通していない |",
        observationRows({ 仕様の所有箇所: value }),
      ].join("\n"),
    );
  },
);

Given(
  "成果物行数が{string}のreview artifactを持つ統合監査repository",
  function (value: string) {
    commitArtifactWithIdentity(
      this,
      [
        "| ラウンド数 | 1 |",
        "| Step chain | 迂回: fixtureのため製品経路を通していない |",
        observationRows({ 成果物行数: value }),
      ].join("\n"),
    );
  },
);

Then("file監査は{string}の欠落を報告する", function (label: string) {
  assertReported(this, `| ${label} | … |」がありません`);
});

Then("file監査は仕様側の起票先の欠落を報告する", function () {
  assertReported(this, "仕様側の欠落を起票したIssue番号");
});

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
  "申告行を本文とcode fenceだけに置いたreview artifactを持つ統合監査repository",
  function () {
    /**
     * 識別情報の節には申告を置かず、**本文とcode fenceにだけ**申告の形をした行を置く。
     * 全文検索する実装はこれを申告として受理してしまう。
     */
    const fixture = createImplementation(this, { historicalArtifacts: 1 });
    const auditPath = "docs/reviews/02_課題986実装レビュー.md";
    /**
     * 識別情報の節の**中**にcode fenceを置き、節の**外**に平文の申告行を置く。
     * 節の限定とcodeの除去の**どちらを外しても**受理されてしまう配置である。
     */
    const body = auditMarkdown(
      fixture.base,
      fixture.implementation,
      fixture.changedPath,
      "A",
      [
        "| reviewer | fixture |",
        "",
        "```markdown",
        "| ラウンド数 | 1 |",
        "| Step chain | 迂回: 節の中のcode fence |",
        "```",
      ].join("\n"),
    );
    writeFile(
      fixture.root,
      auditPath,
      [
        body,
        "",
        "## 9. 補足",
        "",
        "| ラウンド数 | 1 |",
        "| Step chain | 迂回: 本文へ書いただけ |",
        "",
        "",
      ].join("\n"),
    );
    commitPaths(fixture.root, "docs: review artifactを記録する", [auditPath]);
    this.expectedAuditPath = auditPath;
  },
);

Given(
  "Step chainを{string}と申告したreview artifactを持つ統合監査repository",
  function (declaration: string) {
    commitArtifactWithIdentity(
      this,
      [
        "| ラウンド数 | 1 |",
        `| Step chain | ${declaration} |`,
        observationRows(),
      ].join("\n"),
    );
  },
);

Then(
  "file監査は選択した親が候補側でない可能性と両親の着地形file数を示す",
  function () {
    assert.equal(this.auditResult?.valid, false);
    const joined = this.auditResult?.errors.join("\n") ?? "";
    assert.match(joined, /候補branch側の差分でない可能性がある/u);
    // **file数を両側とも示すことまで要求する。** 注記の存在だけでは、
    // 片側しか観測していない実装でも通る
    // **実値まで要求する。** 桁だけを見ると、件数を常に0にする実装でも通る。
    // fixtureは候補側=review artifact 1件、既定branch側=other.txtとkeep.txtの2件
    assert.match(joined, /第1親=1件、第2親=2件/u);
    assert.match(joined, /追随merge/u);
  },
);

Then("file監査は候補側の注記を付けない", function () {
  // 親が2個でない境界では、両親の観測を持たないため注記を付けない
  assert.doesNotMatch(
    this.auditResult?.errors.join("\n") ?? "",
    /候補branch側の差分でない可能性がある/u,
  );
});

Then("file監査は不合格になり候補側の注記を付けない", function () {
  // **不合格まで確認する。** 合格して`errors`が空なら、注記の不在は自明であり
  // 常に注記を付ける実装でも通ってしまう
  assert.equal(this.auditResult?.valid, false);
  const joined = this.auditResult?.errors.join("\n") ?? "";
  assert.doesNotMatch(joined, /候補branch側の差分でない可能性がある/u);
});

Then("file監査は比較基点の導出不能を報告する", function () {
  assert.equal(this.auditResult?.valid, false);
  assert.match(
    this.auditResult?.errors.join("\n") ?? "",
    /比較基点を導出できません。/u,
  );
});

Then("file監査は比較基点の不一致を報告する", function () {
  assert.equal(this.auditResult?.valid, false);
  assert.match(
    this.auditResult?.errors.join("\n") ?? "",
    /review artifact本文の比較基点 [a-f0-9]{40} が実際のcommit構造から導出した比較基点 [a-f0-9]{40} と一致しません/u,
  );
});

Then("file監査は比較基点を検証せず合格する", function () {
  // **合格まで確認する。** 不一致errorの不在だけでは、別の理由で落ちた場合も通ってしまう。
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
  assert.doesNotMatch(
    this.auditResult?.errors.join("\n") ?? "",
    /比較基点 [a-f0-9]{40} が実際のcommit構造から導出した/u,
  );
});

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
