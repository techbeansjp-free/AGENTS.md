import assert from "node:assert/strict";
import fs from "node:fs";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import {
  PROGRESS_END,
  PROGRESS_START,
} from "../../src/domain/review-progress.js";

interface PlanArtifactWorld extends WorkflowWorld {
  text: string;
  history: string;
  checked: boolean;
}

const { Given, When, Then } = stepDefinitions<PlanArtifactWorld>();

Given("配布する03_実装計画.md templateを読む", function () {
  this.text = fs.readFileSync(
    ".agent-skill-chain/templates/issue/03_実装計画.md",
    "utf8",
  );
});

When("進捗表の有無を確認する", function () {
  this.checked = true;
});

Then(
  "progress markerと進捗節が無く進捗の正本をGitとstep journalと示す",
  function () {
    assert.ok(this.checked);
    assert.ok(!this.text.includes(PROGRESS_START));
    assert.ok(!this.text.includes(PROGRESS_END));
    assert.doesNotMatch(this.text, /^## \d+\. 進捗$/mu);
    assert.match(this.text, /進捗の正本はGitのcommit履歴とstep journal/u);
  },
);

Given("本repositoryのproject policy manifestを読む", function () {
  this.text = fs.readFileSync(".agent-skill-chain/project-policy.json", "utf8");
});

When("staging節の有無を確認する", function () {
  this.checked = true;
});

Then("staging節が存在しない", function () {
  assert.ok(this.checked);
  const manifest = JSON.parse(this.text) as {
    policy?: Record<string, unknown>;
  };
  assert.ok(manifest.policy, "manifest.policyがありません");
  assert.equal(Object.hasOwn(manifest.policy, "staging"), false);
});

Given("REQ-WF-037と仕様変更履歴を読む", function () {
  this.text = fs.readFileSync(
    "docs/specs/02_要件/01_ワークフロー要件.md",
    "utf8",
  );
  this.history = fs.readFileSync(
    "docs/specs/15_要件追跡/01_変更履歴.md",
    "utf8",
  );
});

When("本repositoryのstaging宣言の記述を確認する", function () {
  this.checked = true;
});

Then(
  "docs\\/issuesを宣言する一文が無く既定配置を使う旨と取り消しのentryがある",
  function () {
    assert.ok(this.checked);
    assert.doesNotMatch(
      this.text,
      /本repositoryは`staging: \{root: "docs\/issues"/u,
    );
    assert.match(this.text, /本repositoryは`staging`節を宣言せず、既定配置/u);
    assert.match(
      this.history,
      /本repository自身の`docs\/issues`版管理下staging宣言（2026-09-26、REQ-WF-037）を取り消/u,
    );
  },
);
