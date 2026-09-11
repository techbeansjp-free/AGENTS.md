import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  createIssueStaging,
  issueSyncArtifactNames,
} from "../../src/domain/issue.js";
import type { Mode } from "../../src/domain/mode.js";
import {
  isReviewArtifactParentContained,
  renderReviewArtifactDraft,
} from "../../src/domain/review-artifact.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface ScaffoldingWorld extends WorkflowWorld {
  root: string;
  staging: string;
  reviewTemplate: string;
  reviewDraft: string;
  reviewPaths: Array<{ path: string; changeType: "A" | "M" | "D" }>;
  syncArtifacts: readonly string[];
  syncMode: Mode;
  syncCheckpoint: 4 | 8;
  reviewParentContained: boolean;
}

const { Given, When, Then } = stepDefinitions<ScaffoldingWorld>();
const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);

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

Given("review artifact templateとbase head変更pathがある", function () {
  this.reviewTemplate = fs.readFileSync(
    path.resolve(".agent-skill-chain/templates/issue/04_レビュー.md"),
    "utf8",
  );
  this.reviewPaths = [
    { path: "src/cli.ts", changeType: "M" },
    { path: "src/domain/review-artifact.ts", changeType: "A" },
  ];
});

Given("削除を含むreview artifact入力がある", function () {
  this.reviewTemplate = fs.readFileSync(
    path.resolve(".agent-skill-chain/templates/issue/04_レビュー.md"),
    "utf8",
  );
  this.reviewPaths = [{ path: "docs/obsolete.md", changeType: "D" }];
});

When("review artifact雛形を描画する", function () {
  this.reviewDraft = renderReviewArtifactDraft({
    template: this.reviewTemplate,
    staging: ".agent-skill-chain/tmp/issues/fixture",
    stagingDigest: "3".repeat(64),
    baseSha,
    headSha,
    paths: this.reviewPaths,
  });
});

Then("比較基点とH_implは厳密SHA書式である", function () {
  assert.ok(this.reviewDraft.includes(`| 比較基点 | \`${baseSha}\` |`));
  assert.ok(this.reviewDraft.includes(`| H_impl | \`${headSha}\` |`));
});

Then("全変更pathが個別監査表にある", function () {
  for (const item of this.reviewPaths)
    assert.ok(
      this.reviewDraft.includes(`| \`${item.path}\` | ${item.changeType} |`),
    );
});

Then("review判定とtest結果は未確定である", function () {
  assert.match(this.reviewDraft, /review未実施/u);
  assert.match(this.reviewDraft, /未実行（reviewerが実行後に記録）/u);
  assert.doesNotMatch(this.reviewDraft, /\| ラウンド数 \| 1 \|/u);
});

Then("削除pathはDとして個別監査表にある", function () {
  assert.match(this.reviewDraft, /\| `docs\/obsolete\.md` \| D \|/u);
});

Given("repository内の出力親がrepository外へ解決される", function () {
  this.root = path.join(path.sep, "repository");
});

When("review artifactの出力親包含を判定する", function () {
  this.reviewParentContained = isReviewArtifactParentContained(
    this.root,
    this.root,
    path.join(this.root, "docs", "reviews"),
    path.join(path.sep, "outside", "reviews"),
  );
});

Then("review artifactの出力親は拒否される", function () {
  assert.equal(this.reviewParentContained, false);
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
