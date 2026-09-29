import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveUniqueMergeBase } from "../../src/adapters/review-diff.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

const { Given, When, Then } = stepDefinitions<MergeBaseAuditWorld>();

class MergeBaseAuditWorld extends WorkflowWorld {
  root = "";
  a = "";
  b = "";
  /** `git merge-base --all a b`の実測値（複数件の場合は全件）。 */
  observedMergeBases: string[] = [];
  resolved: string | undefined = undefined;
  resolveError: Error | undefined = undefined;
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function writeAndCommit(
  root: string,
  file: string,
  content: string,
  message: string,
): string {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  git(root, ["add", "--", file]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

/** `git merge-base --all`をそのまま実測する（productionの解決関数を経由しない独立oracle）。 */
function observeMergeBasesDirectly(
  root: string,
  a: string,
  b: string,
): string[] {
  const result = spawnSync("git", ["merge-base", "--all", a, b], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .trim()
    .split(/\r?\n/u)
    .filter((line) => /^[a-f0-9]{40}$/u.test(line));
}

Given(
  "一意なmerge-baseを持つ2 commitがある",
  function (this: MergeBaseAuditWorld) {
    // 共通祖先Oから2 branchへ分かれ、mergeを挟まない単純な分岐にする。
    // merge-base(A,B)は常にOの1件だけになる。
    const root = fs.realpathSync(this.initRepo());
    this.root = root;
    const ancestor = writeAndCommit(root, "o.txt", "o\n", "common ancestor");
    git(root, ["branch", "branch-a", ancestor]);
    git(root, ["branch", "branch-b", ancestor]);
    git(root, ["checkout", "-q", "branch-a"]);
    this.a = writeAndCommit(root, "a.txt", "a\n", "advance on branch a");
    git(root, ["checkout", "-q", "branch-b"]);
    this.b = writeAndCommit(root, "b.txt", "b\n", "advance on branch b");
    this.observedMergeBases = observeMergeBasesDirectly(root, this.a, this.b);
    assert.deepEqual(
      this.observedMergeBases,
      [ancestor],
      "fixtureの前提: merge-baseは共通祖先1件のはず",
    );
  },
);

Given("無関係な履歴を持つ2 commitがある", function (this: MergeBaseAuditWorld) {
  // 同一repository内に2本のorphan branch（祖先を共有しない独立した履歴）を作る。
  // `git merge-base --all`は共通祖先が無いため0件・非0終了になる。
  const root = fs.realpathSync(this.initRepo());
  this.root = root;
  git(root, ["checkout", "-q", "--orphan", "orphan-a"]);
  git(root, ["rm", "-rf", "-q", "."]);
  this.a = writeAndCommit(root, "orphan-a.txt", "a\n", "orphan history a");
  git(root, ["checkout", "-q", "--orphan", "orphan-b"]);
  git(root, ["rm", "-rf", "-q", "."]);
  this.b = writeAndCommit(root, "orphan-b.txt", "b\n", "orphan history b");
  this.observedMergeBases = observeMergeBasesDirectly(root, this.a, this.b);
  assert.deepEqual(
    this.observedMergeBases,
    [],
    "fixtureの前提: 無関係な履歴はmerge-baseが0件のはず",
  );
});

Given(
  "criss-cross mergeで複数のmerge-baseを持つ2 commitがある",
  function (this: MergeBaseAuditWorld) {
    // 教科書的なcriss-cross merge: O→A1、O→B1の後、互いを取り込んだA2・B2を作る。
    // merge-base(A2,B2)はA1・B1の2件になる（どちらも他方の祖先ではない）。
    const root = fs.realpathSync(this.initRepo());
    this.root = root;
    const origin = writeAndCommit(root, "o.txt", "o\n", "common ancestor");
    git(root, ["branch", "branch-a", origin]);
    git(root, ["branch", "branch-b", origin]);
    git(root, ["checkout", "-q", "branch-a"]);
    const a1 = writeAndCommit(root, "a.txt", "a1\n", "a1");
    git(root, ["checkout", "-q", "branch-b"]);
    const b1 = writeAndCommit(root, "b.txt", "b1\n", "b1");
    git(root, ["checkout", "-q", "branch-a"]);
    git(root, ["merge", "-q", "--no-ff", b1, "-m", "a2: merge b1 into a1"]);
    const a2 = git(root, ["rev-parse", "HEAD"]);
    git(root, ["checkout", "-q", "branch-b"]);
    git(root, ["merge", "-q", "--no-ff", a1, "-m", "b2: merge a1 into b1"]);
    const b2 = git(root, ["rev-parse", "HEAD"]);
    this.a = a2;
    this.b = b2;
    this.observedMergeBases = observeMergeBasesDirectly(
      root,
      this.a,
      this.b,
    ).sort();
    assert.deepEqual(
      this.observedMergeBases,
      [a1, b1].sort(),
      "fixtureの前提: criss-cross mergeはmerge-baseが2件のはず",
    );
  },
);

When("実際のmerge-baseを解決する", function (this: MergeBaseAuditWorld) {
  this.resolved = undefined;
  this.resolveError = undefined;
  try {
    this.resolved = resolveUniqueMergeBase(this.root, this.a, this.b);
  } catch (error) {
    this.resolveError =
      error instanceof Error ? error : new Error(String(error));
  }
});

Then(
  "解決したmerge-baseはgit merge-baseの実測値と一致する",
  function (this: MergeBaseAuditWorld) {
    assert.equal(this.resolveError, undefined, this.resolveError?.message);
    assert.equal(this.observedMergeBases.length, 1);
    assert.equal(this.resolved, this.observedMergeBases[0]);
  },
);

Then("一意性を理由に拒否される", function (this: MergeBaseAuditWorld) {
  assert.equal(this.resolved, undefined);
  assert.ok(this.resolveError, "resolveUniqueMergeBaseが拒否していません");
  assert.match(this.resolveError!.message, /一意/u);
});
