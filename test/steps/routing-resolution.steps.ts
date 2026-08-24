import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readProjectChoices } from "../../src/domain/policy.js";
import { readProviderCapabilityMapping } from "../../src/domain/provider-capability.js";
import {
  authorizeImplementation,
  rejectRoutingDowngrade,
  revalidateRouting,
  resolveRouting,
  type RoutingDecision,
  type RoutingResolutionInput,
} from "../../src/domain/routing.js";
import { parseJsonStrict } from "../../src/lib/security.js";
import type {
  ModelMappingChoice,
  ProjectChoices,
  ProviderCapabilityMapping,
} from "../../src/types.js";
import { isRecord } from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class RoutingResolutionWorld extends WorkflowWorld {
  choices: ProjectChoices | undefined = undefined;
  mapping: ProviderCapabilityMapping | undefined = undefined;
  input: RoutingResolutionInput | undefined = undefined;
  decision: RoutingDecision | undefined = undefined;
  secondDecision: RoutingDecision | undefined = undefined;
  expectedModel: string | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<RoutingResolutionWorld>();

function readFixture(relative: string): string {
  return fs.readFileSync(
    path.resolve("test", "fixtures", "routing", relative),
    "utf8",
  );
}

function configuredChoices(): ProjectChoices {
  return readProjectChoices(readFixture("project-choice-configured.json"));
}

function structuredMapping(choices: ProjectChoices): ModelMappingChoice {
  const mapping = choices.modelMapping;
  assert.ok(mapping && typeof mapping !== "string");
  return mapping;
}

function fixtureSlug(name: "current" | "lower" | "unknown" | "higher"): string {
  const value: unknown = parseJsonStrict(
    readFixture("resolution-slugs.json"),
    "routing resolution slug fixture",
  );
  assert.ok(isRecord(value));
  const slug = value[name];
  assert.equal(typeof slug, "string");
  return slug as string;
}

function projectMapping(): ProviderCapabilityMapping {
  return readProviderCapabilityMapping(
    fs.readFileSync(
      path.resolve("test", "fixtures", "routing", "capability-mapping.json"),
      "utf8",
    ),
  );
}

function makeInput(
  choices: ProjectChoices,
  mapping: ProviderCapabilityMapping,
  models: string[],
  recommendedModels: string[] = models.slice(0, 1),
): RoutingResolutionInput {
  const modelMapping = structuredMapping(choices);
  return {
    scope: "T04-routing-domain",
    coordinatorIdentity: "claude-coordinator",
    implementerIdentity: "codex-implementer",
    reviewerIdentity: "independent-reviewer",
    availability: {
      provider: modelMapping.roles.implementer.provider,
      state: "available",
      models,
      modelMetadata: models.map((model) => ({
        model,
        recommended: recommendedModels.includes(model),
        supportedReasoningEfforts: ["low", "medium", "high"],
      })),
      observedAt: "2026-08-24T00:00:00.000Z",
      entrypoint: "provider-fixture",
    },
    mapping,
    modelMapping,
    requiredCapability: "coding",
    evaluatorRef: "trusted-ref-fixture",
  };
}

function requireResolved(
  decision: RoutingDecision | undefined,
): Extract<RoutingDecision, { state: "resolved" }> {
  assert.equal(decision?.state, "resolved");
  return decision as Extract<RoutingDecision, { state: "resolved" }>;
}

Given("ClaudeがcoordinatorでCodexの最高位coding tierを利用できる", function () {
  this.choices = configuredChoices();
  this.mapping = projectMapping();
  this.input = makeInput(
    this.choices,
    this.mapping,
    [fixtureSlug("current"), fixtureSlug("lower")],
    [fixtureSlug("current")],
  );
});

When("product実装taskの担当を解決する", function () {
  assert.ok(this.input);
  this.decision = resolveRouting(this.input);
});

Then("implementerはCodexである", function () {
  const decision = requireResolved(this.decision);
  assert.equal(
    decision.roles.implementer.provider,
    this.input?.availability.provider,
  );
  assert.equal(
    decision.roles.implementer.identity,
    this.input?.implementerIdentity,
  );
});

Then("modelはprovider公式recommended defaultである", function () {
  const decision = requireResolved(this.decision);
  assert.equal(decision.model, fixtureSlug("current"));
});

Then("reasoning effortはhighである", function () {
  assert.equal(requireResolved(this.decision).reasoningEffort, "high");
});

Then("service tierはdefaultである", function () {
  assert.equal(requireResolved(this.decision).serviceTier, "default");
});

Then("high非対応の公式recommended defaultはpendingである", function () {
  assert.ok(this.input);
  const unsupported = resolveRouting({
    ...this.input,
    availability: {
      ...this.input.availability,
      modelMetadata: this.input.availability.modelMetadata.map((model) =>
        model.recommended
          ? { ...model, supportedReasoningEfforts: ["low", "medium"] }
          : model,
      ),
    },
  });
  assert.equal(unsupported.state, "pending");
  assert.equal(
    unsupported.state === "pending" ? unsupported.ruleId : "",
    "FR-836-05",
  );
});

Given("ClaudeがcoordinatorでCodexを利用できる", function () {
  this.choices = configuredChoices();
  this.mapping = projectMapping();
  this.input = makeInput(this.choices, this.mapping, [fixtureSlug("current")]);
});

When("coordinator identityでproduct pathの実装を開始しようとする", function () {
  assert.ok(this.input);
  const decision = resolveRouting(this.input);
  this.value = [
    authorizeImplementation({
      decision,
      actorIdentity: this.input.coordinatorIdentity,
      changedPaths: ["src/domain/routing.ts"],
    }),
    authorizeImplementation({
      decision,
      actorIdentity: "unassigned-agent",
      changedPaths: ["test/features/unit/routing-resolution.feature"],
    }),
  ];
});

Then("role違反として拒否する", function () {
  assert.ok(Array.isArray(this.value));
  assert.deepEqual(this.value[0], {
    allowed: false,
    ruleId: "BR-836-01",
    reason: "coordinatorはCodex利用可能scopeのproduct実装を担当できません",
  });
  assert.deepEqual(this.value[1], {
    allowed: false,
    ruleId: "BR-836-01",
    reason: "product実装は解決済みimplementer identityだけが担当できます",
  });
});

Then("拒否結果はrule IDを持つ", function () {
  assert.equal(
    typeof this.value === "object" &&
      this.value !== null &&
      Array.isArray(this.value) &&
      this.value.every((result) => isRecord(result) && "ruleId" in result),
    true,
  );
});

Given(
  "最高位coding tierとreasoning effort highとservice tier defaultを解決した",
  function () {
    this.choices = configuredChoices();
    this.mapping = projectMapping();
    this.input = makeInput(
      this.choices,
      this.mapping,
      [fixtureSlug("current"), fixtureSlug("lower")],
      [fixtureSlug("current")],
    );
    this.decision = resolveRouting(this.input);
  },
);

When(
  "低位modelまたは別のreasoning effortまたはfast以上の速度tierへ差し替えようとする",
  function () {
    const resolved = requireResolved(this.decision);
    const lower = fixtureSlug("lower");
    this.value = [
      rejectRoutingDowngrade(resolved, { ...resolved, model: lower }),
      rejectRoutingDowngrade(resolved, {
        ...resolved,
        reasoningEffort: "medium",
      }),
      rejectRoutingDowngrade(resolved, {
        ...resolved,
        serviceTier: "priority",
      }),
      revalidateRouting(resolved, {
        ...this.input!,
        availability: {
          ...this.input!.availability,
          models: [lower],
        },
      }),
      revalidateRouting(resolved, {
        ...this.input!,
        implementerIdentity: "different-implementer",
      }),
    ];
  },
);

Then("無告知の後退として拒否する", function () {
  assert.ok(Array.isArray(this.value));
  for (const outcome of this.value.slice(0, 3))
    assert.deepEqual(outcome, {
      allowed: false,
      ruleId: "BR-836-02",
      reason: "解決済みrouting条件の無告知変更を拒否しました",
    });
});

Then("実行直前の再検証で解決結果が変化しても拒否する", function () {
  assert.ok(Array.isArray(this.value));
  for (const outcome of this.value.slice(3))
    assert.deepEqual(outcome, {
      allowed: false,
      ruleId: "FR-836-06",
      reason: "実行直前のrouting再検証で解決結果が変化しました",
    });
});

Then("実装を開始しない", function () {
  assert.ok(Array.isArray(this.value));
  const outcomes: unknown[] = this.value;
  assert.equal(
    outcomes.every((outcome) => isRecord(outcome) && outcome.allowed === false),
    true,
  );
});

Given("利用可能model一覧に公式recommended defaultがない", function () {
  this.choices = configuredChoices();
  this.mapping = projectMapping();
  this.input = makeInput(
    this.choices,
    this.mapping,
    [fixtureSlug("unknown")],
    [],
  );
});

When("最高位coding tierを解決する", function () {
  assert.ok(this.input);
  this.decision = resolveRouting(this.input);
});

Then("解決状態はpendingである", function () {
  assert.equal(this.decision?.state, "pending");
});

Then("provider再観測要求を返す", function () {
  assert.equal(
    this.decision?.state === "pending" && this.decision.updateRequired,
    true,
  );
});

Then("順位を推測しない", function () {
  assert.equal(
    this.decision?.state === "pending" && "model" in this.decision,
    false,
  );
});

Given("provider観測にrecommended defaultが2件ある", function () {
  this.choices = configuredChoices();
  this.mapping = projectMapping();
  const models = [fixtureSlug("current"), fixtureSlug("higher")];
  this.input = makeInput(this.choices, this.mapping, models, models);
});

Given("その2件がいずれも利用可能である", function () {
  assert.equal(this.input?.availability.models.length !== 0, true);
});

Then("同一入力に対する結果は一意である", function () {
  assert.ok(this.input);
  this.secondDecision = resolveRouting(this.input);
  assert.deepEqual(this.secondDecision, this.decision);
});

Given("起票時点のcatalog fixtureとtrusted mappingを読み込む", function () {
  this.choices = configuredChoices();
  this.mapping = projectMapping();
  this.expectedModel = fixtureSlug("current");
  this.input = makeInput(
    this.choices,
    this.mapping,
    [fixtureSlug("current"), fixtureSlug("lower")],
    [fixtureSlug("current")],
  );
});

Then("解決済みmodelはgpt-5.6-solである", function () {
  assert.equal(requireResolved(this.decision).model, this.expectedModel);
});

Then("mapping versionを記録する", function () {
  assert.equal(
    requireResolved(this.decision).mappingVersion,
    this.mapping?.mappingVersion,
  );
});

Given(
  "catalog fixtureの公式recommended defaultを新modelへ変更する",
  function () {
    this.choices = configuredChoices();
    this.mapping = projectMapping();
    this.expectedModel = fixtureSlug("higher");
    this.input = makeInput(
      this.choices,
      this.mapping,
      [this.expectedModel, fixtureSlug("current")],
      [this.expectedModel],
    );
  },
);

When("sourceを変更せずに最高位coding tierを解決する", function () {
  assert.ok(this.input);
  this.decision = resolveRouting(this.input);
});

Then("解決済みmodelは追加したmodelである", function () {
  assert.equal(requireResolved(this.decision).model, this.expectedModel);
});
