import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  createIssueStaging,
  issueSyncArtifactNames,
} from "../../src/domain/issue.js";
import type { Mode } from "../../src/domain/mode.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface ScaffoldingWorld extends WorkflowWorld {
  root: string;
  staging: string;
  syncArtifacts: readonly string[];
  syncMode: Mode;
  syncCheckpoint: 4 | 8;
}

const { Given, When, Then } = stepDefinitions<ScaffoldingWorld>();

Given("issue scaffolding用のfull stagingを生成する", function () {
  this.root = this.initRepo();
  const answers = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: true as const, evidence: "fixture evidence" },
    ]),
  );
  this.staging = createIssueStaging(this.root, {
    title: "機械導出テスト",
    answers,
    requestedMode: "full",
    now: new Date("2026-09-11T00:00:00.000Z"),
  }).path;
});

Then("00から03の件名は同じ値である", function () {
  for (const name of [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ])
    assert.match(
      fs.readFileSync(path.join(this.staging, name), "utf8"),
      /機械導出テスト/u,
    );
});

Then("01から03の作成日は具体値である", function () {
  for (const name of ["01_要件定義.md", "02_設計.md", "03_実装計画.md"])
    assert.match(
      fs.readFileSync(path.join(this.staging, name), "utf8"),
      /2026-09-11T00:00:00\.000Z/u,
    );
});

When("full stagingの転記結果を確認する", function () {
  assert.ok(fs.statSync(this.staging).isDirectory());
});

Given(
  "{word} modeのcheckpoint {int}という同期条件がある",
  function (mode: Mode, checkpoint: number) {
    this.syncMode = mode;
    this.syncCheckpoint = checkpoint as 4 | 8;
  },
);

When("同期対象を導出する", function () {
  this.syncArtifacts = issueSyncArtifactNames(
    this.syncMode,
    this.syncCheckpoint,
  );
});

Then("同期対象は{word}である", function (artifacts: string) {
  assert.deepEqual(this.syncArtifacts, artifacts.split(","));
});
