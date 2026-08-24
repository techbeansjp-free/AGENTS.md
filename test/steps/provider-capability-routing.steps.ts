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

When(
  "汎用packageのschemaとtemplateとsourceでmodel slugを検索する",
  function () {
    assert.ok(this.capabilityMapping);
    const slugs = this.capabilityMapping.providers.flatMap((provider) =>
      provider.models.map((model) => model.slug),
    );
    this.modelSlugOccurrences = [
      ".agent-skill-chain/schemas",
      ".agent-skill-chain/templates",
      "src",
    ].flatMap((directory) =>
      sourceFiles(directory).filter((file) => {
        const source = fs.readFileSync(file, "utf8");
        return slugs.some((slug) => source.includes(slug));
      }),
    );
  },
);

Then("必須値としてのmodel slug該当件数は0件である", function () {
  assert.deepEqual(this.modelSlugOccurrences, []);
});

Then("未知fieldと型不正と非昇順rankのmappingを拒否する", function () {
  assert.ok(this.capabilityMapping);
  const unknownField: unknown = {
    ...structuredClone(this.capabilityMapping),
    unexpected: true,
  };
  const invalidRank = structuredClone(this.capabilityMapping);
  const firstProvider = invalidRank.providers[0];
  assert.ok(firstProvider?.models[1]);
  firstProvider.models[1].rank = firstProvider.models[0]!.rank;
  assert.equal(validateProviderCapabilityMapping(unknownField).valid, false);
  assert.equal(validateProviderCapabilityMapping(invalidRank).valid, false);
});
