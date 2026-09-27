import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * 派生した欠陥の是正原則（REQ-WF-041）とASC本体規律の適用対象（REQ-WF-042）を検査する。
 *
 * **規範文書の当該節本文だけを対象にする。** file全体を対象にすると、原則を
 * 別文書へ複製して規範側の節を空にする変異が生存する（issue-admission-timing
 * と同じ理由）。
 */
interface DerivedDefectWorld extends WorkflowWorld {
  sectionText: string;
}

const { Given, When, Then } = stepDefinitions<DerivedDefectWorld>();
const repositoryRoot = process.cwd();

const WORKFLOW_DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";
const STEP_09_SKILL = ".agent-skill-chain/skills/step-09-implement/SKILL.md";
const STEP_10_SKILL = ".agent-skill-chain/skills/step-10-review/SKILL.md";
const PRINCIPLE_HEADING = "### 派生した欠陥の是正原則";
const ASC_BODY_HEADING = "## ASC本体の是正を作業scopeへ入れない";

function read(relative: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
}

function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `規範文書に見出しがありません: ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3} /u.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

Given(
  "配布される開発ワークフローの規範文書の派生した欠陥の是正原則節がある",
  function () {
    this.sectionText = extractSection(
      read(WORKFLOW_DOCUMENT),
      PRINCIPLE_HEADING,
    );
  },
);

Given(
  "配布される開発ワークフローの規範文書のASC本体是正禁止節がある",
  function () {
    this.sectionText = extractSection(
      read(WORKFLOW_DOCUMENT),
      ASC_BODY_HEADING,
    );
  },
);

Given("配布されるStep 9のskill契約がある", function () {
  this.sectionText = read(STEP_09_SKILL);
});

Given("配布されるStep 10のskill契約がある", function () {
  this.sectionText = read(STEP_10_SKILL);
});

When("節の内容を確認する", function () {
  assert.notEqual(this.sectionText, "");
});

Then("節には発見時期によらず同じIssue・同じPRで直す原則がある", function () {
  assert.ok(this.sectionText.includes("発見の時期"));
  assert.ok(this.sectionText.includes("同じIssue・同じPRで最小に直す"));
});

Then("節には閉じた6条件の分離基準がある", function () {
  for (const marker of ["(1)", "(2)", "(3)", "(4)", "(5)", "(6)"])
    assert.ok(
      this.sectionText.includes(marker),
      `分離条件${marker}が見つかりません`,
    );
});

Then("round数は分離理由に含まれない", function () {
  assert.ok(this.sectionText.includes("round数が多いことは分離の理由にしない"));
});

Then("節には収束解除と未解決blocker0件による終了条件がある", function () {
  assert.ok(this.sectionText.includes("収束を解除し"));
  assert.ok(this.sectionText.includes("未解決blockerが0件であることとする"));
});

Then("節の適用対象が利用projectでの作業だと読み取れる", function () {
  assert.ok(
    this.sectionText.includes(
      "ASC本体が依存packageである利用projectでの作業に適用する",
    ),
  );
});

Then("ASC本体repository自身には適用しないと書かれている", function () {
  assert.ok(
    this.sectionText.includes(
      "ASC本体のrepository自身（本repositoryを含む）での作業には適用しない",
    ),
  );
});

Then("派生した欠陥の是正原則への参照がある", function () {
  assert.ok(this.sectionText.includes("#派生した欠陥の是正原則"));
});
