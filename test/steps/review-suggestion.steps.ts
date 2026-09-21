import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  MAX_SUGGESTION_BYTES,
  verifyReviewSuggestion,
} from "../../src/adapters/review-suggestion.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class SuggestionWorld extends WorkflowWorld {
  root = "";
  headSha = "";
  patch = "";
  result: { headSha: string; patch: string } | undefined;
  status = "";
  original = "";
}

const { Given, When, Then } = stepDefinitions<SuggestionWorld>();

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function patchFor(file: string, oldLine: string, newLine: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1 +1 @@",
    `-${oldLine}`,
    `+${newLine}`,
    "",
  ].join("\n");
}

Given("修正提案用の隔離Git repositoryがある", function () {
  this.root = fs.realpathSync(this.temp("asc-suggestion-"));
  git(this.root, "init", "-q", "-b", "main", "--object-format=sha1");
  git(this.root, "config", "user.name", "Test");
  git(this.root, "config", "user.email", "test@example.invalid");
  this.original = "export const value = 1;\n";
  fs.writeFileSync(path.join(this.root, "target.ts"), this.original);
  fs.writeFileSync(path.join(this.root, "other.ts"), this.original);
  git(this.root, "add", "target.ts", "other.ts");
  git(this.root, "commit", "-q", "-m", "fixture");
  this.headSha = git(this.root, "rev-parse", "HEAD");
  this.status = git(this.root, "status", "--porcelain");
  this.patch = patchFor(
    "target.ts",
    "export const value = 1;",
    "export const value = 2;",
  );
});

When("対象HEADの有効な修正提案を検証する", function () {
  this.result = verifyReviewSuggestion({
    root: this.root,
    headSha: this.headSha,
    file: "target.ts",
    patch: this.patch,
  });
});

When("{string} の修正提案を検証する", function (caseName: string) {
  let headSha = this.headSha;
  let patch = this.patch;
  if (caseName === "別HEAD") headSha = "0".repeat(40);
  if (caseName === "別path")
    patch = patchFor(
      "other.ts",
      "export const value = 1;",
      "export const value = 2;",
    );
  if (caseName === "文脈不一致")
    patch = patchFor(
      "target.ts",
      "export const value = 9;",
      "export const value = 2;",
    );
  if (caseName === "構文破壊")
    patch = patchFor(
      "target.ts",
      "export const value = 1;",
      "export const value = ;",
    );
  if (caseName === "複数path")
    patch += patchFor(
      "other.ts",
      "export const value = 1;",
      "export const value = 2;",
    );
  if (caseName === "path脱出")
    patch = patchFor(
      "../target.ts",
      "export const value = 1;",
      "export const value = 2;",
    );
  if (caseName === "64KiB超過") patch += " ".repeat(MAX_SUGGESTION_BYTES);
  if (caseName === "symlink") {
    fs.rmSync(path.join(this.root, "target.ts"));
    fs.symlinkSync("other.ts", path.join(this.root, "target.ts"));
    this.status = git(this.root, "status", "--porcelain");
  }
  this.result = verifyReviewSuggestion({
    root: this.root,
    headSha,
    file: "target.ts",
    patch,
  });
});

Then("対象HEADとpatchを持つ修正提案が返る", function () {
  assert.deepEqual(this.result, { headSha: this.headSha, patch: this.patch });
});
Then("修正提案は省略される", function () {
  assert.equal(this.result, undefined);
});
Then("修正提案の検証は作業treeを変更しない", function () {
  assert.equal(git(this.root, "status", "--porcelain"), this.status);
  if (this.status === "")
    assert.equal(
      fs.readFileSync(path.join(this.root, "target.ts"), "utf8"),
      this.original,
    );
});
