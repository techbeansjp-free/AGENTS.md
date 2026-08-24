import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const ROUTING_CONTRACT_PATHS = [
  ".agent-skill-chain/skills/step-06-plan/SKILL.md",
  ".agent-skill-chain/skills/step-09-implement/SKILL.md",
  ".agent-skill-chain/skills/step-10-review/SKILL.md",
  ".agent-skill-chain/templates/issue/02_設計.md",
  ".agent-skill-chain/templates/issue/03_実装計画.md",
  ".agent-skill-chain/templates/issue/04_レビュー.md",
] as const;

const ROUTING_CONTRACT_MARKERS = [
  "role欄",
  "provider欄",
  "model設定欄",
  "fallback欄",
  "独立性証拠欄",
] as const;

class WorkflowRoutingContractWorld extends WorkflowWorld {
  missingMarkers: string[] = [];
}

const { Given, When, Then } = stepDefinitions<WorkflowRoutingContractWorld>();

Given("routing入力契約を持つべきskillとtemplateがある", function () {
  for (const relative of ROUTING_CONTRACT_PATHS)
    assert.equal(fs.statSync(path.resolve(relative)).isFile(), true);
});

When("routing入力契約の欄を検査する", function () {
  this.missingMarkers = ROUTING_CONTRACT_PATHS.flatMap((relative) => {
    const markdown = fs.readFileSync(path.resolve(relative), "utf8");
    return ROUTING_CONTRACT_MARKERS.filter(
      (marker) => !markdown.includes(marker),
    ).map((marker) => `${relative}:${marker}`);
  });
});

Then(
  "role欄とprovider欄とmodel設定欄とfallback欄と独立性証拠欄の対応漏れは0件である",
  function () {
    assert.deepEqual(this.missingMarkers, []);
  },
);
