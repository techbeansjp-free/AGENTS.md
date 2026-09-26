import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkFileAudit,
  remoteDefaultTip,
} from "../../scripts/check_file_audit.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import {
  syntheticReviewEvidenceContent,
  unvalidatedReviewEvidenceContent,
} from "../support/review-evidence-fixture.js";

type AuditResult = ReturnType<typeof checkFileAudit>;

class AuditSelectionWorld extends WorkflowWorld {
  auditRoot = "";
  auditResult: AuditResult | undefined = undefined;
  auditTrustedDefaultTip: string | undefined = undefined;
  /** fixtureが期待する`H_impl`。`valid`だけでなく導出結果そのものを照合する。 */
  expectedImplementation: string | undefined = undefined;
  auditResults: AuditResult[] = [];
  expectedAuditPath = "";
  expectedRemoteDefaultTip: string | undefined = undefined;
  observedRemoteDefaultTip: string | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<AuditSelectionWorld>();

/**
 * 隔離fixtureの旧bump除外境界。**fixtureのHEADを使う。**
 * 本repositoryの`LEGACY_RELEASE_BUMP_CUTOFF`はfixture履歴に存在しないため、
 * 既定値のまま渡すと解決不能でfail-closedになる（Issue #1184）。
 */
function isolatedCutoff(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

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

/**
 * review証跡の正規byte列。Issue番号はfile名から導く。`variant`は同じ実装境界のまま
 * 検証記録だけを変えた前進commitを作るために使う。
 */
function auditEvidence(
  auditPath: string,
  base: string,
  implementation: string,
  variant = 0,
): string {
  const issue = Number(/(\d+)_review\.json$/u.exec(auditPath)?.[1] ?? "1");
  return syntheticReviewEvidenceContent({
    issue,
    baseSha: base,
    implementationHeadSha: implementation,
    verification:
      variant === 0
        ? ["npm test"]
        : ["npm test", `npm test -- --variant=${variant}`],
  });
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
    auditEvidence(auditPath, fixture.base, recordedImplementation),
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

/**
 * artifactだけを変える前進commitを`count`本積む。
 *
 * **帳簿合わせの再現である。** 実装は変えず、artifactの記述だけを直す。
 */
function appendAuditOnlyCommits(
  fixture: ReturnType<typeof createImplementation>,
  auditPath: string,
  count: number,
  recordedImplementation: string,
): void {
  for (let index = 0; index < count; index += 1) {
    writeFile(
      fixture.root,
      auditPath,
      auditEvidence(auditPath, fixture.base, recordedImplementation, index + 1),
    );
    commitPaths(fixture.root, `docs: review artifactの記載を直す ${index}`, [
      auditPath,
    ]);
  }
}

Given(
  "review artifactだけを直す前進commitを2本積んだ監査選択repository",
  function () {
    const fixture = createImplementation(this);
    const auditPath = "docs/reviews/1074_review.json";
    commitArtifact(this, fixture, auditPath);
    /** **記載する`H_impl`は実装commitのまま動かさない。** 安定化の観測点である。 */
    appendAuditOnlyCommits(fixture, auditPath, 2, fixture.implementation);
    this.expectedImplementation = fixture.implementation;
  },
);

Given(
  "review artifactの直後に実装を変える前進commitを積んだ監査選択repository",
  function () {
    const fixture = createImplementation(this);
    const auditPath = "docs/reviews/1074_review.json";
    commitArtifact(this, fixture, auditPath);
    /**
     * artifactでないpathを含むcommitは境界になる。**遡りはここで止まる。**
     * したがって`H_impl`はこのcommit自身であり、記載も同じ値にする。
     */
    writeFile(
      fixture.root,
      fixture.changedPath,
      "export const selected = 2;\n",
    );
    const second = commitPaths(fixture.root, "fix: 実装を直す", [
      fixture.changedPath,
    ]);
    /**
     * **`比較基点..H_impl`へartifact自身が入る。** 遡りが`second`で止まるため、
     * その手前でcommitした本artifactが範囲に含まれる。個別監査へ自己行を置く。
     */
    writeFile(
      fixture.root,
      auditPath,
      auditEvidence(auditPath, fixture.base, second),
    );
    commitPaths(fixture.root, "docs: review artifactを追随させる", [auditPath]);
    this.expectedImplementation = second;
  },
);

Given("suffixの途中でartifactを2件同時に変える監査選択repository", function () {
  const fixture = createImplementation(this);
  const auditPath = "docs/reviews/1074_review.json";
  const otherPath = "docs/reviews/1075_review.json";
  commitArtifact(this, fixture, auditPath);
  /**
   * **artifactが2件同時に変わるcommitで遡りを止める。** 1 fileだけの帳簿合わせと
   * 区別できないと、遡りが実装commitまで到達して`H_impl`が過去へ飛ぶ。
   * このcommitを**suffixの途中**（`HEAD^`）へ置き、その先に帳簿合わせを1本積む。
   */
  /** **両方のartifactを同じcommitで変える。** 片方だけだと差分が1件になり遡ってしまう。 */
  writeFile(
    fixture.root,
    auditPath,
    auditEvidence(auditPath, fixture.base, fixture.implementation, 7),
  );
  writeFile(fixture.root, otherPath, "# 別\n");
  const boundary = commitPaths(
    fixture.root,
    "docs: artifactを2件同時に変える",
    [auditPath, otherPath],
  );
  writeFile(
    fixture.root,
    auditPath,
    auditEvidence(auditPath, fixture.base, boundary),
  );
  commitPaths(fixture.root, "docs: review artifactの記載を直す", [auditPath]);
  this.expectedImplementation = boundary;
});

Given("suffixの途中にmerge commitがある監査選択repository", function () {
  const fixture = createImplementation(this);
  const auditPath = "docs/reviews/1074_review.json";
  commitArtifact(this, fixture, auditPath);
  /**
   * **merge commitで遡りを止める。**
   *
   * 第1親差分がartifact 1件だけになるmergeを作る。止めないと遡りが実装commitまで
   * 到達し、`比較基点..H_impl`からartifactが外れて個別監査表の期待が変わる。
   * **第1親差分に実装が含まれるmergeでは次の判定が止めるため、この形でしか観測できない。**
   */
  git(fixture.root, ["checkout", "-q", "-b", "side"]);
  writeFile(
    fixture.root,
    auditPath,
    auditEvidence(auditPath, fixture.base, fixture.implementation, 8),
  );
  commitPaths(fixture.root, "docs: 別branchでartifactを直す", [auditPath]);
  git(fixture.root, ["checkout", "-q", "main"]);
  git(fixture.root, [
    "merge",
    "--no-ff",
    "-q",
    "-m",
    "merge: sideを取り込む",
    "side",
  ]);
  const merged = git(fixture.root, ["rev-parse", "HEAD"]);
  /** 記載する`H_impl`はmerge commit自身。`比較基点..H_impl`は実装1件とartifact 1件。 */
  writeFile(
    fixture.root,
    auditPath,
    auditEvidence(auditPath, fixture.base, merged),
  );
  commitPaths(fixture.root, "docs: review artifactの記載を直す", [auditPath]);
  this.expectedImplementation = merged;
});

Given("差分がreview artifact 1件だけの監査選択repository", function () {
  const fixture = createImplementation(this);
  commitArtifact(this, fixture, "docs/reviews/892_review.json");
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
    commitArtifact(this, fixture, "docs/reviews/892_review.json");
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
      "docs/reviews/892_review.json",
      fixture.implementation,
      ["unexpected/first.txt", "unexpected/second.txt"],
    );
  },
);

Given("差分1件が許可review directory配下でない監査選択repository", function () {
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
      "docs/reviews/892_review.json",
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
  world.auditTrustedDefaultTip = mainTip;
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
  const auditPath = "docs/reviews/966_review.json";
  writeFile(
    root,
    auditPath,
    auditEvidence(auditPath, declaredBase, implementation),
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
    const auditPath = "docs/reviews/1004_review.json";
    writeFile(root, auditPath, auditEvidence(auditPath, start, implementation));
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
  const auditPath = "docs/reviews/966_review.json";
  writeFile(root, auditPath, auditEvidence(auditPath, start, implementation));
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
    const auditPath = "docs/reviews/966_review.json";
    writeFile(
      root,
      auditPath,
      auditEvidence(auditPath, targetTip, implementation),
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
  const auditPath = "docs/reviews/966_review.json";
  // 比較基点を候補branch内へ前進させた申告。浅いcloneで導出を飛ばすと通ってしまう
  writeFile(
    origin,
    auditPath,
    auditEvidence(auditPath, hidden, implementation),
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
    commitArtifact(this, fixture, "docs/reviews/892_review.json", fixture.base);
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
      "docs/reviews/892_review.json",
    );
  },
);

/** 上限を超えたround数を持つ証跡を最終commitにする。parserの上限検査を通さずに書く。 */
Given(
  "ラウンド数が{string}のreview artifactを持つ統合監査repository",
  function (rounds: string) {
    const fixture = createImplementation(this, { historicalArtifacts: 1 });
    const auditPath = "docs/reviews/986_review.json";
    writeFile(
      fixture.root,
      auditPath,
      unvalidatedReviewEvidenceContent({
        issue: 986,
        baseSha: fixture.base,
        implementationHeadSha: fixture.implementation,
        countedRounds: Number(rounds),
      }),
    );
    commitPaths(fixture.root, "docs: review証跡を記録する", [auditPath]);
    this.expectedAuditPath = auditPath;
  },
);

Given(
  "file名のIssue番号とissueが一致しないreview証跡を持つ統合監査repository",
  function () {
    const fixture = createImplementation(this);
    const auditPath = "docs/reviews/987_review.json";
    writeFile(
      fixture.root,
      auditPath,
      auditEvidence(
        "docs/reviews/986_review.json",
        fixture.base,
        fixture.implementation,
      ),
    );
    commitPaths(fixture.root, "docs: review証跡を記録する", [auditPath]);
  },
);

Given("Markdownのreview artifactを持つ統合監査repository", function () {
  const fixture = createImplementation(this);
  const auditPath = "docs/reviews/42_課題892実装レビュー.md";
  writeFile(fixture.root, auditPath, "# 手書きreview\n");
  commitPaths(fixture.root, "docs: 手書きreviewを記録する", [auditPath]);
});

Given("手で書き直したreview証跡を持つ統合監査repository", function () {
  const fixture = createImplementation(this);
  const auditPath = "docs/reviews/892_review.json";
  const canonical = auditEvidence(
    auditPath,
    fixture.base,
    fixture.implementation,
  );
  writeFile(
    fixture.root,
    auditPath,
    `${JSON.stringify(JSON.parse(canonical) as unknown)}\n`,
  );
  commitPaths(fixture.root, "docs: review証跡を記録する", [auditPath]);
});

Then("file監査はfile名書式の不一致を報告する", function () {
  assertReported(this, "review証跡のfile名書式に一致しません");
});

Then("file監査はIssue番号の不一致を報告する", function () {
  assertReported(
    this,
    "file名のIssue番号とreview証跡のissue 986 が一致しません",
  );
});

Then("file監査は正規直列化の不一致を報告する", function () {
  assertReported(this, "正規直列化と一致しません");
});

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
    /review証跡の比較基点 [a-f0-9]{40} が実際のcommit構造から導出した比較基点 [a-f0-9]{40} と一致しません/u,
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

Then("監査選択のfile監査は不合格になる", function () {
  assert.equal(
    this.auditResult?.valid,
    false,
    JSON.stringify(this.auditResult),
  );
});

Then("監査選択のfile監査は合格し導出したH_implが期待どおりである", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    `file監査が失敗しました: ${this.auditResult?.errors.join("\n")}`,
  );
  /**
   * **`valid`だけを見ない。** 記載した`H_impl`と導出値の一致は検査が担保するため、
   * 記載値そのものを照合すれば導出結果を固定できる（外部review指摘）。
   */
  assert.equal(this.auditResult?.implementation, this.expectedImplementation);
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
  assertReported(this, "countedRoundsが上限8を超えています");
});

Given("review artifactを最終commitにした統合監査repository", function () {
  const fixture = createImplementation(this, { historicalArtifacts: 3 });
  commitArtifact(this, fixture, "docs/reviews/892_review.json");
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
        auditEvidence(auditPath, base, implementation),
      );
      commitPaths(root, `docs: ${branch}のreview artifactを記録する`, [
        auditPath,
      ]);
    };
    createBranch(
      "parallel-a",
      "src/parallel-a.ts",
      "docs/reviews/892_review.json",
    );
    createBranch(
      "parallel-b",
      "src/parallel-b.ts",
      "docs/reviews/893_review.json",
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
    this.auditResults.push(checkFileAudit(root, isolatedCutoff(root)));
    git(root, [
      "merge",
      "--no-ff",
      "-q",
      "parallel-b",
      "-m",
      "merge parallel-b",
    ]);
    this.auditResults.push(checkFileAudit(root, isolatedCutoff(root)));
    this.auditRoot = root;
  },
);

Given("review artifactと余分なpathをcommitした統合監査repository", function () {
  const fixture = createImplementation(this);
  commitArtifact(
    this,
    fixture,
    "docs/reviews/892_review.json",
    fixture.implementation,
    ["unexpected/integration.txt"],
  );
});

Given("既存41件のreview artifactを持つ統合監査repository", function () {
  const fixture = createImplementation(this, { historicalArtifacts: 40 });
  commitArtifact(this, fixture, "docs/reviews/892_review.json");
});

When("監査選択repositoryのfile監査を実行する", function () {
  this.auditResult = checkFileAudit(
    this.auditRoot,
    isolatedCutoff(this.auditRoot),
    this.auditTrustedDefaultTip === undefined
      ? {}
      : { trustedDefaultTip: this.auditTrustedDefaultTip },
  );
});

When("各branchのmerge後にfile監査を実行する", function () {
  assert.equal(this.auditResults.length, 2);
});

Given(
  "local origin HEADより新しいremote default branchを持つ監査repository",
  function () {
    const root = this.initRepo();
    const remote = this.temp("asc-audit-remote-");
    git(remote, ["init", "--bare", "-q"]);
    git(root, ["branch", "-M", "main"]);
    git(root, ["remote", "add", "origin", remote]);
    git(root, ["push", "-q", "-u", "origin", "main"]);
    git(root, ["remote", "set-head", "origin", "main"]);
    git(root, ["checkout", "-q", "-b", "next"]);
    writeFile(root, "src/next.ts", "export const next = true;\n");
    this.expectedRemoteDefaultTip = commitPaths(
      root,
      "feat: nextを既定branch候補にする",
      ["src/next.ts"],
    );
    git(root, ["push", "-q", "origin", "next"]);
    git(remote, ["symbolic-ref", "HEAD", "refs/heads/next"]);
    assert.equal(
      git(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]),
      "refs/remotes/origin/main",
    );
    this.auditRoot = root;
  },
);

When("remoteの現在default tipを解決する", function () {
  this.observedRemoteDefaultTip = remoteDefaultTip(this.auditRoot);
});

Then("remoteの現在default tipがtrust anchorとして返る", function () {
  assert.equal(this.observedRemoteDefaultTip, this.expectedRemoteDefaultTip);
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
  assert.equal(this.auditResult?.auditPath, "docs/reviews/892_review.json");
});

Then("review artifact commitの追加方法を示して失敗する", function () {
  assert.equal(this.auditResult?.valid, false);
  assert.match(
    this.auditResult?.errors.join("\n") ?? "",
    /review証跡のcommitがありません。実装commitの後に`review export`で生成したreview証跡だけをcommitしてください/u,
  );
});

Then("複数差分の診断に全pathが列挙される", function () {
  assert.equal(this.auditResult?.valid, false);
  const errors = this.auditResult?.errors.join("\n") ?? "";
  assert.match(
    errors,
    /H_impl\.\.currentにreview証跡以外のfileが含まれています/u,
  );
  for (const expected of ["unexpected/first.txt", "unexpected/second.txt"])
    assert.ok(errors.includes(expected), expected);
  assert.ok(!errors.includes("docs/reviews/892_review.json"));
});

Then(
  "許可review directory配下でないpathと修正方法を示して失敗する",
  function () {
    assert.equal(this.auditResult?.valid, false);
    const errors = this.auditResult?.errors.join("\n") ?? "";
    assert.ok(errors.includes("notes/review.md"));
    assert.ok(errors.includes("docs/reviews/"));
    assert.ok(errors.includes(".agent-skill-chain/reviews/"));
  },
);

Then("release bumpを除外してreview artifact 1件が選ばれる", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
  assert.equal(this.auditResult?.auditPath, "docs/reviews/892_review.json");
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
  assert.equal(this.auditResult?.auditPath, "docs/reviews/892_review.json");
});

Then("両方のmerge後に対応するreview artifactが選ばれて合格する", function () {
  assert.deepEqual(
    this.auditResults.map((result) => ({
      valid: result.valid,
      auditPath: result.auditPath,
    })),
    [
      { valid: true, auditPath: "docs/reviews/892_review.json" },
      { valid: true, auditPath: "docs/reviews/893_review.json" },
    ],
    this.auditResults.flatMap((result) => result.errors).join("\n"),
  );
});

Then("統合監査の複数差分診断に余分なpathが含まれる", function () {
  assert.equal(this.auditResult?.valid, false);
  const errors = this.auditResult?.errors.join("\n") ?? "";
  assert.match(
    errors,
    /H_impl\.\.currentにreview証跡以外のfileが含まれています/u,
  );
  assert.ok(errors.includes("unexpected/integration.txt"));
});

Then("41件目のreview artifactが選ばれてfile監査は合格する", function () {
  assert.equal(
    this.auditResult?.valid,
    true,
    this.auditResult?.errors.join("\n"),
  );
  assert.equal(this.auditResult?.auditPath, "docs/reviews/892_review.json");
});
