import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { validateExecutionEntry } from "../../scripts/check_conformance.js";
import { findPackageRoot } from "../../src/lib/package-root.js";

class ExecutionEntryWorld extends WorkflowWorld {
  linked = "";
  output = "";
  source = "";
  relative = "";
  errors: string[] = [];
}

const { Given, When, Then } = stepDefinitions<ExecutionEntryWorld>();

const repositoryRoot = (): string => findPackageRoot(import.meta.url);

Given("{string}へのsymlinkを用意する", function (script: string) {
  this.linked = path.join(this.temp("asc-entry-"), "linked.ts");
  fs.symlinkSync(path.join(repositoryRoot(), "scripts", script), this.linked);
});

When("symlink経由でgate scriptを実行する", function () {
  /**
   * **判定が偽になると出力が空のまま終了値0で終わる。** 失敗ではなく無言の合格として
   * 現れるため、終了値ではなく出力の有無で観測する。
   */
  this.output = execFileSync(
    process.execPath,
    ["--import", "tsx", this.linked],
    { cwd: repositoryRoot(), encoding: "utf8" },
  );
});

Then("gate scriptの出力は空でない", function () {
  assert.notEqual(
    this.output.trim(),
    "",
    "symlink経由の起動で検査が走っていません",
  );
});

Given("実行entry判定を直接比較するsourceがある", function () {
  this.source = [
    'import { pathToFileURL } from "node:url";',
    "if (import.meta.url === pathToFileURL(process.argv[1]).href) run();",
  ].join("\n");
  this.relative = "scripts/example.ts";
});

Given("実行entry判定を手書きするsourceがある", function () {
  /** 比較を変数へ逃がした形。直接比較のpatternには一致しない。 */
  this.source = [
    "const self = import.meta.url;",
    "const entry = process.argv[1];",
    "if (compare(self, entry)) run();",
  ].join("\n");
  this.relative = "scripts/example.ts";
});

Given("正本をcommentで参照しつつ手書きするsourceがある", function () {
  /** commentへ`lib/entrypoint.js`と書くだけの回避。実呼び出しは無い。 */
  this.source = [
    "// lib/entrypoint.js のisExecutionEntryを使うべき箇所",
    "const self = import.meta.url;",
    "const entry = process.argv[1];",
    "if (compare(self, entry)) run();",
  ].join("\n");
  this.relative = "scripts/example.ts";
});

Given("正本moduleのsourceがある", function () {
  this.source = fs.readFileSync(
    path.join(repositoryRoot(), "src/lib/entrypoint.ts"),
    "utf8",
  );
  this.relative = "src/lib/entrypoint.ts";
});

Given("共有helperを使うsourceがある", function () {
  this.source = [
    'import { isExecutionEntry } from "../src/lib/entrypoint.js";',
    "if (isExecutionEntry(import.meta.url)) run();",
  ].join("\n");
  this.relative = "scripts/example.ts";
});

When("test資産として実行entry判定の検査を実行する", function () {
  this.errors = validateExecutionEntry(
    this.source,
    "test/steps/example.steps.ts",
  );
});

When("実行entry判定の検査を実行する", function () {
  this.errors = validateExecutionEntry(this.source, this.relative);
});

Then("実行entry判定の検査は直接比較を報告する", function () {
  assert.ok(
    this.errors.some((error) => error.includes("直接比較")),
    `直接比較を検出していません: ${this.errors.join(" | ")}`,
  );
});

Then("実行entry判定の検査は手書きを報告する", function () {
  assert.ok(
    this.errors.some((error) => error.includes("手書き")),
    `手書きを検出していません: ${this.errors.join(" | ")}`,
  );
});

Then("実行entry判定の検査は合格する", function () {
  assert.deepEqual(this.errors, []);
});
