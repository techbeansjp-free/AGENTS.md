import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkWorktreeContract } from "../../scripts/check_worktree_contract.js";
import {
  WORKFLOW_DOCUMENT,
  applyWorktreeContract,
  renderWorktreeContract,
} from "../../scripts/generate_worktree_contract.js";
import {
  WORKTREE_NAME_FORMAT,
  WORKTREE_TIMESTAMP_MAX_AGE_MINUTES,
} from "../../src/domain/worktree.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

function replicate(world: WorkflowWorld): string {
  const root = world.temp("asc-wtdoc-");
  const destination = path.join(root, WORKFLOW_DOCUMENT);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.resolve(WORKFLOW_DOCUMENT), destination);
  return root;
}

function rewrite(root: string, edit: (text: string) => string): void {
  const file = path.join(root, WORKFLOW_DOCUMENT);
  fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")));
}

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-UNIT-WTDOC-001": (world) => {
    assert.deepEqual(checkWorktreeContract(replicate(world)).errors, []);
  },
  "SCN-UNIT-WTDOC-002": (world) => {
    const root = replicate(world);
    rewrite(root, (text) =>
      text.replace(
        `${WORKTREE_TIMESTAMP_MAX_AGE_MINUTES}分を超えて`,
        "しばらく経って",
      ),
    );
    const errors = checkWorktreeContract(root).errors;
    assert.ok(
      errors.some((error) =>
        error.includes("自動生成区画が正本と一致しません"),
      ),
      errors.join(" / "),
    );
  },
  "SCN-UNIT-WTDOC-003": (world) => {
    const root = replicate(world);
    rewrite(root, (text) =>
      text.replace("<!-- 自動生成: worktree作成契約 -->", ""),
    );
    const errors = checkWorktreeContract(root).errors;
    assert.ok(
      errors.some((error) => error.includes("自動生成markerがありません")),
      errors.join(" / "),
    );
  },
  "SCN-UNIT-WTDOC-004": (world) => {
    const root = replicate(world);
    fs.rmSync(path.join(root, WORKFLOW_DOCUMENT));
    const result = checkWorktreeContract(root);
    assert.equal(result.valid, false);
  },
  "SCN-UNIT-WTDOC-005": (world) => {
    const result = checkWorktreeContract(replicate(world));
    assert.ok(
      !result.errors.some((error) => error.includes("runtimeが受理しません")),
      result.errors.join(" / "),
    );
    assert.equal(result.valid, true);
  },
  "SCN-UNIT-WTDOC-006": (world) => {
    const root = replicate(world);
    rewrite(root, (text) =>
      text.replace(
        `${WORKTREE_TIMESTAMP_MAX_AGE_MINUTES}分を超えて`,
        "しばらく経って",
      ),
    );
    assert.equal(checkWorktreeContract(root).valid, false);
    const applied = applyWorktreeContract(root);
    assert.deepEqual(applied.errors, []);
    assert.equal(applied.changed, true);
    assert.deepEqual(checkWorktreeContract(root).errors, []);
  },
  "SCN-UNIT-WTDOC-007": () => {
    const rendered = renderWorktreeContract();
    assert.ok(rendered.includes(WORKTREE_NAME_FORMAT));
    assert.ok(
      rendered.includes(`${WORKTREE_TIMESTAMP_MAX_AGE_MINUTES}分を超えて`),
    );
  },
};

Given("worktree契約文書検査の準備がある", function () {
  this.value = undefined;
});

When("{string}のworktree契約文書検査を実行する", function (scenario: string) {
  const check = CHECKS[scenario];
  if (!check) return;
  check(this);
  this.validationOutcome = { valid: true };
});

Then("worktree契約文書検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
