import assert from "node:assert/strict";
import fs from "node:fs";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import {
  validatePolicy,
  validateProjectPolicyManifest,
} from "../../src/domain/policy.js";
import { isCurrentPolicySchemaVersion } from "../../src/lib/version.js";

interface SchemaAliasWorld extends WorkflowWorld {
  manifest: Record<string, unknown>;
  defaultPolicy: Record<string, unknown>;
  results: Array<{ valid: boolean; errors?: readonly string[] }>;
  judged: Record<string, boolean>;
}

const { Given, When, Then } = stepDefinitions<SchemaAliasWorld>();
const namespace = "agent-skill-chain/project-policy/v";

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function withManifestVersion(
  manifest: Record<string, unknown>,
  version: string,
): Record<string, unknown> {
  return {
    ...manifest,
    policy: {
      ...(manifest.policy as Record<string, unknown>),
      schemaVersion: `${namespace}${version}`,
    },
  };
}

Given(
  "現行のproject policy manifestとdefault policyのschemaVersionをv0.3.1へ置き換える",
  function () {
    this.manifest = withManifestVersion(
      readJson(".agent-skill-chain/project-policy.json"),
      "0.3.1",
    );
    this.defaultPolicy = {
      ...readJson(".agent-skill-chain/policy/default.json"),
      schemaVersion: `${namespace}0.3.1`,
    };
  },
);

When("manifestとdefault policyを検証する", function () {
  this.results = [
    validateProjectPolicyManifest(this.manifest),
    validatePolicy(this.defaultPolicy),
  ];
});

Then("どちらも合格する", function () {
  for (const result of this.results)
    assert.equal(result.valid, true, JSON.stringify(result));
});

Given("policy schemaの版の一覧がある", function () {
  this.judged = {};
});

When("各版が現行schemaとして扱われるかを判定する", function () {
  for (const version of ["0.4.4", "0.3.1", "0.3.0", "0.3", "0.3.2", "0.4.3"])
    this.judged[version] = isCurrentPolicySchemaVersion(
      `${namespace}${version}`,
    );
});

Then("v0.4.4とv0.3.1だけが現行schemaとして扱われる", function () {
  assert.deepEqual(this.judged, {
    "0.4.4": true,
    "0.3.1": true,
    "0.3.0": false,
    "0.3": false,
    "0.3.2": false,
    "0.4.3": false,
  });
});

Then("v0.3.2を宣言するmanifestは不正な版として拒否される", function () {
  const result = validateProjectPolicyManifest(
    withManifestVersion(
      readJson(".agent-skill-chain/project-policy.json"),
      "0.3.2",
    ),
  );
  assert.equal(result.valid, false);
  assert.ok(
    JSON.stringify(result).includes("manifest.policy.schemaVersionが不正です"),
    JSON.stringify(result),
  );
});
