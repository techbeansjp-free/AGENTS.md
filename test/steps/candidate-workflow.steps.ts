import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decideCandidatePreflight,
  decideCandidatePost,
  CANDIDATE_RISKS,
  type CandidatePreflightInput,
  type CandidatePostInput,
  type CandidateDecision,
} from "../../src/domain/candidate-workflow.js";
import {
  observeCandidateBoundary,
  observeCandidateGit,
  observeRemovedAccessGuard,
} from "../../src/adapters/candidate-git.js";
import { run } from "../../src/lib/process.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
class CandidateWorld extends WorkflowWorld {
  pre?: CandidatePreflightInput;
  post?: CandidatePostInput;
  decision?: CandidateDecision;
  repo = "";
  source = "";
  baseSha = "";
}
const { Given, When, Then } = stepDefinitions<CandidateWorld>();
Given("隔離候補の事前条件を用意する", function () {
  this.pre = {
    intent: "内部ラベルをHelloに修正",
    correctnessCriterion: "label() === Hello",
    baseSha: "a".repeat(40),
    isolatedWorktree: true,
    allowedPaths: ["src/label.ts"],
    risk: Object.fromEntries(CANDIDATE_RISKS.map((key) => [key, "cleared"])),
    unresolved: [],
  };
});
Given("事前条件「{word}」を設定する", function (condition: string) {
  assert.ok(this.pre);
  if (condition === "auth") this.pre.risk.authentication = "triggered";
  if (condition === "no-criterion") this.pre.correctnessCriterion = "";
  if (condition === "unknown-risk") delete this.pre.risk.authorization;
  if (condition === "no-isolation") this.pre.isolatedWorktree = false;
  if (condition === "vague-intent") this.pre.intent = "";
  if (condition === "misclassified-auth-path")
    this.pre.allowedPaths = ["src/auth.ts"];
  if (condition === "misclassified-neutral-path")
    this.pre.allowedPaths = ["src/service.ts"];
});
When("候補実装の事前判定を行う", function () {
  assert.ok(this.pre);
  this.decision = decideCandidatePreflight(this.pre);
});
Given("候補実装後の差分と対象テストを用意する", function () {
  this.post = {
    observedPaths: ["src/label.ts"],
    allowedPaths: ["src/label.ts"],
    targetTestsPassed: true,
    gaps: [],
  };
});
Given("事後条件「{word}」を設定する", function (condition: string) {
  assert.ok(this.post);
  if (condition === "unexpected-path")
    this.post.observedPaths = ["src/auth.ts"];
  if (condition === "failed-test") this.post.targetTestsPassed = false;
  if (condition === "security-gap") this.post.gaps = ["security-risk"];
  if (condition === "requirement-gap") this.post.gaps = ["requirement"];
  if (condition === "verification-gap") this.post.gaps = ["verification"];
  if (condition === "no-diff") this.post.observedPaths = [];
  if (condition === "hidden-scope-and-implementation-gap") {
    this.post.observedPaths = ["src/auth.ts"];
    this.post.gaps = ["implementation"];
    this.post.targetTestsPassed = false;
  }
  if (condition === "removed-access-guard") {
    this.post.observedPaths = ["src/service.ts"];
    this.post.allowedPaths = ["src/service.ts"];
    this.post.removedAccessGuard = true;
  }
});
When("候補実装の事後判定を行う", function () {
  assert.ok(this.post);
  this.decision = decideCandidatePost(this.post);
});
Then("候補の経路は「{word}」で正式権限を持たない", function (route: string) {
  assert.equal(this.decision?.route, route);
  assert.equal(this.decision?.authority, "none");
});
Given("専用Git worktreeに候補実装をcommitする", function () {
  this.source = fs.mkdtempSync(path.join(os.tmpdir(), "asc-candidate-test-"));
  run("git", ["init", "-q"], this.source);
  run("git", ["config", "user.name", "Candidate Test"], this.source);
  run(
    "git",
    ["config", "user.email", "candidate@example.invalid"],
    this.source,
  );
  fs.writeFileSync(path.join(this.source, "label.txt"), "old\n");
  run("git", ["add", "."], this.source);
  run("git", ["commit", "-qm", "base"], this.source);
  this.baseSha = run("git", ["rev-parse", "HEAD"], this.source).stdout.trim();
  this.repo = path.join(this.source, "candidate");
  run(
    "git",
    ["worktree", "add", "-qb", "candidate", this.repo, this.baseSha],
    this.source,
  );
  fs.writeFileSync(path.join(this.repo, "label.txt"), "new\n");
  run("git", ["commit", "-qam", "candidate"], this.repo);
});
When("候補のGit差分を観測する", function () {
  assert.deepEqual(observeCandidateGit(this.repo, this.baseSha).changedPaths, [
    "label.txt",
  ]);
});
Then("変更ファイルはGitから観測される", function () {
  assert.deepEqual(observeCandidateGit(this.repo, this.baseSha).changedPaths, [
    "label.txt",
  ]);
});
When("候補worktreeに未追跡ファイルを追加する", function () {
  fs.writeFileSync(path.join(this.repo, "untracked.txt"), "not evidence\n");
});
Then("候補のGit観測はdirty worktreeを拒否する", function () {
  assert.throws(() => observeCandidateGit(this.repo, this.baseSha), /未記録/);
  fs.rmSync(this.source, { recursive: true, force: true });
});

Then("主worktreeは候補として拒否される", function () {
  assert.throws(
    () => observeCandidateBoundary(this.source),
    /専用Git worktree/,
  );
});
When("Git環境上書きを設定する", function () {
  process.env.GIT_DIR = path.join(this.source, ".git");
});
Then("候補のGit観測は環境上書きを拒否する", function () {
  try {
    assert.throws(
      () => observeCandidateGit(this.repo, this.baseSha),
      /worktree境界/,
    );
  } finally {
    delete process.env.GIT_DIR;
    fs.rmSync(this.source, { recursive: true, force: true });
  }
});
When("候補worktreeでファイルをrenameしてcommitする", function () {
  run("git", ["mv", "label.txt", "renamed.txt"], this.repo);
  run("git", ["commit", "-qm", "rename"], this.repo);
});
Then("renameの旧新両pathをGitから観測する", function () {
  assert.deepEqual(observeCandidateGit(this.repo, this.baseSha).changedPaths, [
    "label.txt",
    "renamed.txt",
  ]);
  fs.rmSync(this.source, { recursive: true, force: true });
});

Given("著者名fieldを変更する隔離Git dummyがある", function () {
  this.source = fs.mkdtempSync(path.join(os.tmpdir(), "asc-author-test-"));
  run("git", ["init", "-q"], this.source);
  run("git", ["config", "user.name", "Author Test"], this.source);
  run("git", ["config", "user.email", "author@example.invalid"], this.source);
  fs.writeFileSync(
    path.join(this.source, "book.js"),
    "export const field = book.author;\n",
  );
  run("git", ["add", "."], this.source);
  run("git", ["commit", "-qm", "base"], this.source);
  this.baseSha = run("git", ["rev-parse", "HEAD"], this.source).stdout.trim();
  fs.writeFileSync(
    path.join(this.source, "book.js"),
    "export const field = book.title;\n",
  );
  run("git", ["commit", "-qam", "rename field"], this.source);
});

Then("著者名の削除を認可guard削除と誤判定しない", function () {
  const head = run("git", ["rev-parse", "HEAD"], this.source).stdout.trim();
  assert.equal(
    observeRemovedAccessGuard(this.source, this.baseSha, head),
    false,
  );
});
