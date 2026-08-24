import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadProjectPolicySetAtCommit } from "../../src/domain/policy.js";
import {
  checkRoutingIndependence,
  ROUTING_EVALUATOR_PATHS,
  ROUTING_TRUSTED_DATA_PATHS,
  type RoutingIndependenceResult,
} from "../../src/domain/routing-independence.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class RoutingIndependenceWorld extends WorkflowWorld {
  independenceResult: RoutingIndependenceResult | undefined = undefined;
  trustedEvaluatorResult: RoutingIndependenceResult | undefined = undefined;
  trustedRef: string | undefined = undefined;
  candidateHead: string | undefined = undefined;
  trustedMappingVersion: string | undefined = undefined;
  trustedChoiceRoot: string | undefined = undefined;
  trustedBindingRaw: string | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<RoutingIndependenceWorld>();

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

Given("Codexが対象scopeを実装した", function () {
  this.value = {
    implementerIdentity: "codex-implementer",
    reviewerIdentity: "codex-implementer",
  };
});

When("同じagent identityで最終reviewを承認しようとする", function () {
  assert.ok(typeof this.value === "object" && this.value !== null);
  assert.ok("implementerIdentity" in this.value);
  assert.ok("reviewerIdentity" in this.value);
  this.independenceResult = checkRoutingIndependence({
    implementerIdentity: String(this.value.implementerIdentity),
    reviewerIdentity: String(this.value.reviewerIdentity),
    candidatePaths: [],
    trustedRef: "trusted-ref-fixture",
    candidateHead: "candidate-head-fixture",
    evaluatorRef: "trusted-ref-fixture",
  });
});

Then("role独立性違反として拒否する", function () {
  assert.equal(this.independenceResult?.verdict, "violated");
  assert.equal(this.independenceResult?.ruleId, "FR-836-11");
});

Given(
  "candidateがmappingとproject choiceとresolverとvalidatorとconformance bindingを同一変更で変更した",
  function () {
    const repository = this.initRepo();
    fs.mkdirSync(path.join(repository, ".agent-skill-chain"), {
      recursive: true,
    });
    fs.cpSync(
      path.resolve(".agent-skill-chain", "project-policy.json"),
      path.join(repository, ".agent-skill-chain", "project-policy.json"),
    );
    fs.cpSync(
      path.resolve(".agent-skill-chain", "project"),
      path.join(repository, ".agent-skill-chain", "project"),
      { recursive: true },
    );
    for (const evaluatorPath of ROUTING_EVALUATOR_PATHS) {
      const destination = path.join(repository, evaluatorPath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.resolve(evaluatorPath), destination);
    }
    git(repository, ["add", ".agent-skill-chain", ...ROUTING_EVALUATOR_PATHS]);
    git(repository, ["commit", "-q", "-m", "trusted routing assets"]);
    this.trustedRef = git(repository, ["rev-parse", "HEAD"]);
    const trustedSet = loadProjectPolicySetAtCommit(
      repository,
      this.trustedRef,
    );
    this.trustedMappingVersion = trustedSet.providerMappings[0]?.mappingVersion;
    this.trustedChoiceRoot =
      trustedSet.choices[0]?.modelMapping?.evidenceStoreRoot;
    this.trustedBindingRaw =
      trustedSet.rawEntries["project/conformance/bindings.json"];

    for (const relative of [
      ...ROUTING_TRUSTED_DATA_PATHS,
      ...ROUTING_EVALUATOR_PATHS,
    ])
      fs.appendFileSync(path.join(repository, relative), "\n");
    git(repository, [
      "add",
      ...ROUTING_TRUSTED_DATA_PATHS,
      ...ROUTING_EVALUATOR_PATHS,
    ]);
    git(repository, ["commit", "-q", "-m", "candidate routing assets"]);
    this.candidateHead = git(repository, ["rev-parse", "HEAD"]);
    this.value = { repository };
  },
);

When("そのcandidateのmodel選択とreview権限を評価する", function () {
  assert.ok(this.trustedRef);
  assert.ok(this.candidateHead);
  this.independenceResult = checkRoutingIndependence({
    implementerIdentity: "codex-implementer",
    reviewerIdentity: "independent-reviewer",
    candidatePaths: [...ROUTING_TRUSTED_DATA_PATHS, ...ROUTING_EVALUATOR_PATHS],
    trustedRef: this.trustedRef,
    candidateHead: this.candidateHead,
    evaluatorRef: this.candidateHead,
  });
});

Then("trusted base側の資産だけで評価する", function () {
  assert.ok(typeof this.value === "object" && this.value !== null);
  assert.ok("repository" in this.value);
  assert.ok(this.trustedRef);
  const trustedSet = loadProjectPolicySetAtCommit(
    String(this.value.repository),
    this.trustedRef,
  );
  assert.equal(
    trustedSet.providerMappings[0]?.mappingVersion,
    this.trustedMappingVersion,
  );
  assert.equal(
    trustedSet.choices[0]?.modelMapping?.evidenceStoreRoot,
    this.trustedChoiceRoot,
  );
  assert.equal(
    trustedSet.rawEntries["project/conformance/bindings.json"],
    this.trustedBindingRaw,
  );
  assert.ok(this.candidateHead);
  this.trustedEvaluatorResult = checkRoutingIndependence({
    implementerIdentity: "codex-implementer",
    reviewerIdentity: "independent-reviewer",
    candidatePaths: [...ROUTING_TRUSTED_DATA_PATHS, ...ROUTING_EVALUATOR_PATHS],
    trustedRef: this.trustedRef,
    candidateHead: this.candidateHead,
    evaluatorRef: this.trustedRef,
  });
  assert.equal(this.trustedEvaluatorResult.verdict, "independent");
  assert.equal(this.trustedEvaluatorResult.evaluatorRef, this.trustedRef);
});

Then("candidate側の資産による自己評価を拒否する", function () {
  assert.equal(this.independenceResult?.verdict, "pending");
  assert.equal(this.independenceResult?.ruleId, "FR-836-12");
});

Then("evaluatorRefは評価結果に記録する", function () {
  assert.equal(this.independenceResult?.evaluatorRef, this.candidateHead);
});
