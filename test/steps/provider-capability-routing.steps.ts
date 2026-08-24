import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
      path.resolve(
        ".agent-skill-chain",
        "project",
        "providers",
        "capability-mapping.json",
      ),
      "utf8",
    ),
  );
});

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(resolved) : [resolved];
  });
}

When("project mappingと汎用packageで固定model slugを検索する", function () {
  assert.ok(this.capabilityMapping);
  const modelSlug = /\bgpt-[a-z0-9.-]+\b/u;
  const mappingSource = JSON.stringify(this.capabilityMapping);
  this.modelSlugOccurrences = [
    ...(mappingSource.match(/\bgpt-[a-z0-9.-]+\b/gu) ?? []).map(
      (slug) => `project mapping:${slug}`,
    ),
    ".agent-skill-chain/schemas",
    ".agent-skill-chain/templates",
    "src",
  ].flatMap((directory) =>
    directory.startsWith("project mapping:")
      ? [directory]
      : sourceFiles(directory).filter((file) =>
          modelSlug.test(fs.readFileSync(file, "utf8")),
        ),
  );
});

Then("必須値としてのmodel slug該当件数は0件である", function () {
  assert.deepEqual(this.modelSlugOccurrences, []);
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
