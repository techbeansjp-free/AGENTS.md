import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  REPOSITORY_READ_EXCEPTIONS,
  checkTestDeterminism,
} from "../../scripts/check_test_determinism.js";
import {
  fixtureBaseInstant,
  fixtureInstant,
  fixtureInstantMs,
} from "../support/fixture-instant.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

function syntheticSteps(world: WorkflowWorld, body: string): string {
  const root = world.temp("asc-testdet-");
  fs.mkdirSync(path.join(root, "test", "steps"), { recursive: true });
  fs.writeFileSync(path.join(root, "test", "steps", "fixture.steps.ts"), body);
  return root;
}

function errorsFor(world: WorkflowWorld, body: string): string[] {
  return checkTestDeterminism(syntheticSteps(world, body)).errors.filter(
    (error) => !error.startsWith("使われていない"),
  );
}

const HOUR = 60 * 60 * 1000;

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-UNIT-TESTDET-001": (world) => {
    const errors = errorsFor(world, "const now = Date.now();\n");
    assert.equal(errors.length, 1);
    assert.ok(errors[0]?.includes("Date.now()は実時計・乱数へ依存します"));
  },
  "SCN-UNIT-TESTDET-002": (world) => {
    const errors = errorsFor(world, "const now = new Date();\n");
    assert.equal(errors.length, 1);
    assert.ok(errors[0]?.includes("引数なしのnew Date()"));
  },
  "SCN-UNIT-TESTDET-003": (world) => {
    const errors = errorsFor(world, "const value = Math.random();\n");
    assert.equal(errors.length, 1);
    assert.ok(errors[0]?.includes("Math.random()"));
  },
  "SCN-UNIT-TESTDET-004": (world) => {
    assert.deepEqual(
      errorsFor(world, 'const at = new Date("2026-08-26T00:00:00.000Z");\n'),
      [],
    );
  },
  "SCN-UNIT-TESTDET-005": (world) => {
    const errors = errorsFor(
      world,
      'const raw = fs.readFileSync("package.json", "utf8");\n',
    );
    assert.equal(errors.length, 1);
    assert.ok(errors[0]?.includes("実repository相対pathへの直接access"));
    assert.ok(errors[0]?.includes("package.json"));
  },
  "SCN-UNIT-TESTDET-006": (world) => {
    const errors = errorsFor(
      world,
      'const raw = fs.readFileSync(".agent-skill-chain/project/choices/development.json", "utf8");\n',
    );
    assert.equal(errors.length, 1);
    assert.ok(errors[0]?.includes(".agent-skill-chain/project/"));
  },
  "SCN-UNIT-TESTDET-007": (world) => {
    const errors = errorsFor(
      world,
      'fs.cpSync(path.resolve(".agent-skill-chain/project"), target);\n',
    );
    assert.equal(errors.length, 1);
    assert.ok(errors[0]?.includes(".agent-skill-chain/project"));
  },
  "SCN-UNIT-TESTDET-008": (world) => {
    assert.deepEqual(
      errorsFor(
        world,
        [
          'const raw = fs.readFileSync("/etc/hostname", "utf8");',
          'const other = fs.readFileSync(path.join(temporary, "package.json"), "utf8");',
          "",
        ].join("\n"),
      ),
      [],
    );
  },
  "SCN-UNIT-TESTDET-009": (world) => {
    const result = checkTestDeterminism(syntheticSteps(world, "export {};\n"));
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.filter((error) => error.startsWith("使われていない"))
        .length,
      REPOSITORY_READ_EXCEPTIONS.length,
    );
  },
  "SCN-UNIT-TESTDET-010": () => {
    const base = fixtureBaseInstant();
    assert.equal(fixtureInstantMs(), base);
    assert.equal(fixtureInstantMs({ hoursAgo: 1 }), base - HOUR);
    assert.equal(fixtureInstantMs({ hoursAhead: 2 }), base + 2 * HOUR);
    assert.equal(fixtureInstant(), new Date(base).toISOString());
  },
  "SCN-UNIT-TESTDET-011": () => {
    assert.equal(process.env.ASC_FIXTURE_BASE_INSTANT, undefined);
    assert.ok(Number.isFinite(fixtureBaseInstant()));
  },
  "SCN-UNIT-TESTDET-012": () => {
    const result = checkTestDeterminism(process.cwd());
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  },
};

Given("決定性検査単体の準備がある", function () {
  this.value = undefined;
});

When("{string}の決定性検査単体を実行する", function (scenario: string) {
  const check = CHECKS[scenario];
  if (!check) return;
  check(this);
  this.validationOutcome = { valid: true };
});

Then("決定性検査単体は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
