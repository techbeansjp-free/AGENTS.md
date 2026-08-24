import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readProjectChoices } from "../../src/domain/policy.js";
import {
  isRecord,
  type ModelMappingChoice,
  type ProjectChoices,
} from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class ProjectChoiceRoutingWorld extends WorkflowWorld {
  configuredChoice: ProjectChoices | undefined = undefined;
  unconfiguredChoice: ProjectChoices | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<ProjectChoiceRoutingWorld>();

function fixture(name: string): string {
  return fs.readFileSync(
    path.resolve("test", "fixtures", "routing", name),
    "utf8",
  );
}

function structuredMapping(
  choice: ProjectChoices | undefined,
): ModelMappingChoice {
  const mapping = choice?.modelMapping;
  assert.ok(mapping && typeof mapping !== "string");
  return mapping;
}

Given("構造化したmodelMappingを持つproject choiceを読み込む", function () {
  this.configuredChoice = readProjectChoices(
    fixture("project-choice-configured.json"),
  );
});

When("implementerのmodel設定を確認する", function () {
  assert.ok(this.configuredChoice?.modelMapping);
});

Then("project choiceのreasoning effortはhighである", function () {
  assert.equal(
    structuredMapping(this.configuredChoice).roles.implementer.reasoningEffort,
    "high",
  );
});

Then("処理速度はstandardである", function () {
  assert.equal(
    structuredMapping(this.configuredChoice).roles.implementer.speed,
    "standard",
  );
  const invalid = structuredClone(this.configuredChoice);
  structuredMapping(invalid).retention.rotationCondition =
    "unsupported" as never;
  assert.throws(() => readProjectChoices(JSON.stringify(invalid)));
});

Given(
  "modelMapping設定済みとlegacy形式のproject choice fixtureがある",
  function () {
    assert.ok(fixture("project-choice-configured.json").length > 0);
    assert.ok(fixture("project-choice-unconfigured.json").length > 0);
  },
);

When("両方のproject choice fixtureを読み込む", function () {
  this.configuredChoice = readProjectChoices(
    fixture("project-choice-configured.json"),
  );
  this.unconfiguredChoice = readProjectChoices(
    fixture("project-choice-unconfigured.json"),
  );
});

Then("両方のproject choice fixtureは読み込みに成功する", function () {
  assert.ok(this.configuredChoice);
  assert.ok(this.unconfiguredChoice);
});

Then(
  "設定済みfixtureのevidence store rootはproject choiceが所有する",
  function () {
    const modelMapping: unknown = this.configuredChoice?.modelMapping;
    assert.ok(isRecord(modelMapping));
    assert.equal(modelMapping.evidenceStoreRoot, "docs/evidence/routing/");
  },
);

Then("legacy fixtureのmodelMappingは従来文字列である", function () {
  assert.equal(
    this.unconfiguredChoice?.modelMapping,
    "roleごとにprojectが選択する",
  );
});
