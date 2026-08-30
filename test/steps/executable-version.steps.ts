import assert from "node:assert/strict";
import { inspectExecutableVersionOutput } from "../../src/lib/executable-version.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface ExecutableVersionWorld extends WorkflowWorld {
  output: string;
  observation?: ReturnType<typeof inspectExecutableVersionOutput>;
}

const { Given, When, Then } = stepDefinitions<ExecutableVersionWorld>();

Given("外部toolがversion出力 {string} を返す", function (output: string) {
  this.output = output;
});

When("最低version {string} と比較する", function (minimum: string) {
  this.observation = inspectExecutableVersionOutput(
    "git",
    this.output,
    minimum,
  );
});

Then("観測versionは {string} で対応済みである", function (version: string) {
  assert.equal(this.observation?.version, version);
  assert.equal(this.observation?.supported, true);
  assert.equal(this.observation?.diagnostic, null);
});

Then("観測versionは {string} で未対応である", function (version: string) {
  assert.equal(this.observation?.version, version);
  assert.equal(this.observation?.supported, false);
  assert.match(this.observation?.diagnostic ?? "", /以上が必要/u);
});

Then("versionを判定できず未対応である", function () {
  assert.equal(this.observation?.version, null);
  assert.equal(this.observation?.supported, false);
  assert.match(this.observation?.diagnostic ?? "", /versionを判定できません/u);
});
