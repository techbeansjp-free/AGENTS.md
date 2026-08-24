import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findPackageModelSlugViolations } from "../../scripts/check_conformance.js";
import { readProviderCapabilityMapping } from "../../src/domain/provider-capability.js";
import { isRecord, type ProviderCapabilityMapping } from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class RoutingConformanceWorld extends WorkflowWorld {
  ownershipBinding: Record<string, unknown> | undefined = undefined;
  mapping: ProviderCapabilityMapping | undefined = undefined;
  modelSlugViolations: ReturnType<typeof findPackageModelSlugViolations> = [];
}

const { Given, When, Then } = stepDefinitions<RoutingConformanceWorld>();

Given("provider routingのconformance bindingを読み込む", function () {
  const input: unknown = JSON.parse(
    fs.readFileSync(
      path.resolve(
        ".agent-skill-chain",
        "project",
        "conformance",
        "bindings.json",
      ),
      "utf8",
    ),
  );
  assert.ok(isRecord(input));
  const bindings: unknown = input.bindings;
  assert.ok(Array.isArray(bindings));
  this.ownershipBinding = bindings.find(
    (binding): binding is Record<string, unknown> =>
      isRecord(binding) && binding.id === "I2",
  );
  this.mapping = readProviderCapabilityMapping(
    fs.readFileSync(
      path.resolve(
        "test",
        "fixtures",
        "routing",
        "capability-mapping.json",
      ),
      "utf8",
    ),
  );
});

When("model slug所有境界のbindingを検査する", function () {
  assert.ok(this.ownershipBinding);
  assert.ok(this.mapping);
  this.modelSlugViolations = findPackageModelSlugViolations(
    process.cwd(),
    this.mapping,
  );
});

Then("所有境界bindingは汎用packageのmodel slug検査を持つ", function () {
  const enforcement: unknown = this.ownershipBinding?.enforcement;
  assert.ok(Array.isArray(enforcement));
  assert.ok(
    enforcement.some(
      (entry) =>
        isRecord(entry) &&
        entry.path === "scripts/check_conformance.ts" &&
        entry.export === "findPackageModelSlugViolations",
    ),
  );
});

Then("汎用packageのmodel slug所有境界違反は0件である", function () {
  assert.deepEqual(this.modelSlugViolations, []);
});

Then("所有境界bindingはroutingの反例シナリオを持つ", function () {
  const scenarios: unknown = this.ownershipBinding?.counterexampleScenarios;
  assert.ok(Array.isArray(scenarios));
  assert.ok(scenarios.includes("SCN-UNIT-ROUTING-002"));
  assert.ok(scenarios.includes("SCN-INT-ROUTING-005"));
});
