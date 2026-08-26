import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  REQUIREMENT_TEMPLATES,
  checkRequirementIdScheme,
} from "../../scripts/check_requirement_id_scheme.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

const PRODUCT_REQUIREMENT_LIST = "docs/specs/02_要件/00_要件一覧.md";

function replicate(world: WorkflowWorld): string {
  const root = world.temp("asc-reqid-");
  for (const relative of REQUIREMENT_TEMPLATES) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.resolve(relative), destination);
  }
  return root;
}

function rewrite(
  root: string,
  relative: string,
  edit: (text: string) => string,
): void {
  const file = path.join(root, relative);
  fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")));
}

const LIST = REQUIREMENT_TEMPLATES[0];
const ACCEPTANCE = REQUIREMENT_TEMPLATES[1];
const NON_FUNCTIONAL = REQUIREMENT_TEMPLATES[2];

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-UNIT-REQID-001": (world) => {
    assert.deepEqual(checkRequirementIdScheme(replicate(world)).errors, []);
  },
  "SCN-UNIT-REQID-002": (world) => {
    const root = replicate(world);
    rewrite(root, LIST, (text) =>
      text.replace("| REQ-{domain}-001 | 機能 |", "| FR-001 | 機能 |"),
    );
    const errors = checkRequirementIdScheme(root).errors;
    assert.ok(
      errors.some((error) => error.includes("FR-001")),
      errors.join(" / "),
    );
  },
  "SCN-UNIT-REQID-003": (world) => {
    const root = replicate(world);
    rewrite(root, NON_FUNCTIONAL, (text) =>
      text.replace("| REQ-{domain}-001 |", "| NFR-001 |"),
    );
    const errors = checkRequirementIdScheme(root).errors;
    assert.ok(
      errors.some((error) => error.includes("NFR-001")),
      errors.join(" / "),
    );
  },
  "SCN-UNIT-REQID-004": (world) => {
    const root = replicate(world);
    rewrite(root, ACCEPTANCE, (text) =>
      text.replace("| AC-{domain}-001 |", "| AC-001 |"),
    );
    const errors = checkRequirementIdScheme(root).errors;
    assert.ok(
      errors.some((error) => error.includes("AC-001")),
      errors.join(" / "),
    );
  },
  "SCN-UNIT-REQID-005": (world) => {
    const root = replicate(world);
    rewrite(root, LIST, (text) =>
      text.replace("Issue番号や課題番号をIDに使わない", "自由に決める"),
    );
    const errors = checkRequirementIdScheme(root).errors;
    assert.ok(
      errors.some((error) =>
        error.includes("domainの決め方の記述がありません"),
      ),
      errors.join(" / "),
    );
  },
  "SCN-UNIT-REQID-006": (world) => {
    const root = replicate(world);
    fs.rmSync(path.join(root, ACCEPTANCE));
    const result = checkRequirementIdScheme(root);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("がありません")));
  },
  "SCN-UNIT-REQID-007": (world) => {
    const root = world.temp("asc-reqid-product-");
    const destination = path.join(root, LIST);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.resolve(PRODUCT_REQUIREMENT_LIST), destination);
    for (const relative of REQUIREMENT_TEMPLATES.slice(1)) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.resolve(relative), target);
    }
    const errors = checkRequirementIdScheme(root).errors.filter(
      (error) => !error.includes("domainの決め方"),
    );
    assert.deepEqual(errors, []);
  },
};

Given("要件ID体系検査の準備がある", function () {
  this.value = undefined;
});

When("{string}の要件ID体系検査を実行する", function (scenario: string) {
  const check = CHECKS[scenario];
  if (!check) return;
  check(this);
  this.validationOutcome = { valid: true };
});

Then("要件ID体系検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
