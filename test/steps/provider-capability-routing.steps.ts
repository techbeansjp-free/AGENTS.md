import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findPackageModelSlugViolations } from "../../scripts/check_conformance.js";
import {
  readProviderCapabilityMapping,
  validateProviderCapabilityMapping,
} from "../../src/domain/provider-capability.js";
import type { ProviderCapabilityMapping } from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class ProviderCapabilityRoutingWorld extends WorkflowWorld {
  capabilityMapping: ProviderCapabilityMapping | undefined = undefined;
  modelSlugOccurrences: string[] = [];
}

const { Given, When, Then } = stepDefinitions<ProviderCapabilityRoutingWorld>();

Given("project固有のprovider capability mappingを読み込む", function () {
  this.capabilityMapping = readProviderCapabilityMapping(
    fs.readFileSync(
      path.resolve("test", "fixtures", "routing", "capability-mapping.json"),
      "utf8",
    ),
  );
});

When("project mappingと汎用packageで固定model slugを検索する", function () {
  assert.ok(this.capabilityMapping);
  this.modelSlugOccurrences = findPackageModelSlugViolations(
    process.cwd(),
    this.capabilityMapping,
  ).map((violation) => `${violation.path}:${violation.slug}`);
});

Then("必須値としてのmodel slug該当件数は0件である", function () {
  assert.deepEqual(this.modelSlugOccurrences, []);
});

Then("Claude系の固定model slugも所有境界違反として検出する", function () {
  const root = this.temp("asc-claude-slug-");
  const sourceDirectory = path.join(root, "src");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDirectory, "fixed-model.ts"),
    'export const model = "claude-opus-4-1-fixture";\n',
  );
  assert.deepEqual(findPackageModelSlugViolations(root), [
    {
      path: "src/fixed-model.ts",
      slug: "claude-opus-4-1-fixture",
    },
  ]);
});

Then("未知fieldと型不正と不正な選択元のmappingを拒否する", function () {
  assert.ok(this.capabilityMapping);
  const unknownField: unknown = {
    ...structuredClone(this.capabilityMapping),
    unexpected: true,
  };
  const invalidSelection = structuredClone(this.capabilityMapping);
  const firstProvider = invalidSelection.providers[0];
  assert.ok(firstProvider);
  firstProvider.selectionSource = "manual_slug_rank" as never;
  assert.equal(validateProviderCapabilityMapping(unknownField).valid, false);
  assert.equal(
    validateProviderCapabilityMapping(invalidSelection).valid,
    false,
  );
});
