import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  MAX_SUGGESTION_BYTES,
  validateReviewSuggestionSyntax,
  verifyReviewSuggestion,
} from "../../src/adapters/review-suggestion.js";
import { attachVerifiedReviewSuggestions } from "../../src/adapters/review-suggestion-launch.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class SuggestionWorld extends WorkflowWorld {
  root = "";
  headSha = "";
  patch = "";
  result: { headSha: string; patch: string } | undefined;
  status = "";
  original = "";
  syntaxResult = true;
  resultFindings: Array<{
    file: string;
    committableSuggestion?: { headSha: string; patch: string };
  }> = [];
}

const { Given, When, Then } = stepDefinitions<SuggestionWorld>();

Given("修正提案の構文検証器がある", function () {
  this.syntaxResult = true;
});

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
  fs.writeFileSync(path.join(this.root, "vite.config.ts"), this.original);
  fs.writeFileSync(path.join(this.root, "target.js"), "const limit = 1;\n");
  fs.writeFileSync(
    path.join(this.root, "legacy.js"),
    Buffer.from([0x2f, 0x2f, 0x20, 0x80, 0x0a]),
  );
  git(
    this.root,
    "add",
    "target.ts",
    "other.ts",
    "vite.config.ts",
    "target.js",
    "legacy.js",
  );
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

When("複数ドット名の有効な修正提案を検証する", function () {
  this.patch = patchFor(
    "vite.config.ts",
    "export const value = 1;",
    "export const value = 2;",
  );
  this.result = verifyReviewSuggestion({
    root: this.root,
    headSha: this.headSha,
    file: "vite.config.ts",
    patch: this.patch,
  });
});

When("過大候補の次に有効な修正提案を検証する", function () {
  const first = { file: "target.ts" };
  const second = { file: "target.ts" };
  this.resultFindings = attachVerifiedReviewSuggestions({
    root: this.root,
    headSha: this.headSha,
    findings: [first, second],
    candidates: new Map([
      [first, "x".repeat(MAX_SUGGESTION_BYTES + 1)],
      [second, this.patch],
    ]),
  });
});

When("大きなTypeScript sourceを1ms期限で構文検証する", function () {
  const source = `export const value = ${"1 + ".repeat(200_000)}0;\n`;
  this.syntaxResult = validateReviewSuggestionSyntax("target.ts", source, 1);
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
  if (caseName === "JS内の型注釈")
    patch = patchFor(
      "target.js",
      "const limit = 1;",
      "const limit: number = 2;",
    );
  if (caseName === "JS内のJSX")
    patch = patchFor("target.js", "const limit = 1;", "const limit = <div/>;");
  if (caseName === "UTF-8でないblob")
    patch = patchFor("legacy.js", "// �", "// fixed");
  if (caseName === "symlink") {
    fs.rmSync(path.join(this.root, "target.ts"));
    fs.symlinkSync("other.ts", path.join(this.root, "target.ts"));
    this.status = git(this.root, "status", "--porcelain");
  }
  this.result = verifyReviewSuggestion({
    root: this.root,
    headSha,
    file:
      caseName === "JS内の型注釈" || caseName === "JS内のJSX"
        ? "target.js"
        : caseName === "UTF-8でないblob"
          ? "legacy.js"
          : "target.ts",
    patch,
  });
});

Then("対象HEADとpatchを持つ修正提案が返る", function () {
  assert.deepEqual(this.result, { headSha: this.headSha, patch: this.patch });
});
Then("修正提案は省略される", function () {
  assert.equal(this.result, undefined);
});
Then("構文検証は期限切れとして失敗する", function () {
  assert.equal(this.syntaxResult, false);
});
Then("後続の有効提案だけがfindingへ添えられる", function () {
  assert.equal(this.resultFindings.length, 2);
  assert.equal(this.resultFindings[0]?.committableSuggestion, undefined);
  assert.deepEqual(this.resultFindings[1]?.committableSuggestion, {
    headSha: this.headSha,
    patch: this.patch,
  });
});
Then("修正提案の検証は作業treeを変更しない", function () {
  assert.equal(git(this.root, "status", "--porcelain"), this.status);
  if (this.status === "")
    assert.equal(
      fs.readFileSync(path.join(this.root, "target.ts"), "utf8"),
      this.original,
    );
});
