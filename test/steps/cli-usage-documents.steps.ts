import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkCliUsageDocuments } from "../../scripts/check_cli_usage.js";
import {
  CLI_GUIDE_BEGIN,
  CLI_GUIDE_DOCUMENT,
  CLI_README_DOCUMENT,
  applyCliUsageGuide,
  renderCliReadmeGuide,
  renderCliUsageGuide,
} from "../../scripts/generate_cli_usage_guide.js";
import { findCommandUsage, missingRequiredFlags } from "../../src/cli-usage.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

function replicate(world: WorkflowWorld): string {
  const root = world.temp("asc-clidoc-");
  for (const relative of [CLI_GUIDE_DOCUMENT, CLI_README_DOCUMENT]) {
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

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-UNIT-CLIDOC-001": (world) => {
    assert.deepEqual(checkCliUsageDocuments(replicate(world)), []);
  },
  "SCN-UNIT-CLIDOC-002": (world) => {
    const root = replicate(world);
    rewrite(root, CLI_GUIDE_DOCUMENT, (text) =>
      text.replace("--remote-default-sha=...が必要です", ""),
    );
    const errors = checkCliUsageDocuments(root);
    assert.ok(
      errors.some((error) =>
        error.includes("自動生成区画が正本と一致しません"),
      ),
      errors.join(" / "),
    );
  },
  "SCN-UNIT-CLIDOC-003": (world) => {
    const root = replicate(world);
    rewrite(root, CLI_README_DOCUMENT, (text) =>
      text.replace(CLI_GUIDE_BEGIN, ""),
    );
    const errors = checkCliUsageDocuments(root);
    assert.ok(
      errors.some((error) => error.includes("自動生成markerがありません")),
      errors.join(" / "),
    );
  },
  "SCN-UNIT-CLIDOC-004": (world) => {
    const root = replicate(world);
    fs.rmSync(path.join(root, CLI_README_DOCUMENT));
    const errors = checkCliUsageDocuments(root);
    assert.ok(
      errors.some((error) =>
        error.includes(`${CLI_README_DOCUMENT}がありません`),
      ),
    );
  },
  "SCN-UNIT-CLIDOC-005": (world) => {
    const root = replicate(world);
    rewrite(root, CLI_GUIDE_DOCUMENT, (text) =>
      text.replace("--remote-default-sha=...が必要です", ""),
    );
    assert.notDeepEqual(checkCliUsageDocuments(root), []);
    const applied = applyCliUsageGuide(root);
    assert.deepEqual(applied.errors, []);
    assert.deepEqual(applied.changed, [CLI_GUIDE_DOCUMENT]);
    assert.deepEqual(checkCliUsageDocuments(root), []);
  },
  "SCN-UNIT-CLIDOC-006": () => {
    const usage = findCommandUsage("worktree", "create");
    assert.ok(usage);
    const missing = missingRequiredFlags(usage, {});
    const guide = renderCliUsageGuide();
    for (const name of missing)
      assert.ok(
        guide.includes(`--${name}=...が必要です`),
        `${name}が生成本文にありません`,
      );
    assert.ok(renderCliReadmeGuide().includes(`${missing.length}件`));
  },
};

Given("CLI配布文書検査の準備がある", function () {
  this.value = undefined;
});

When("{string}のCLI配布文書検査を実行する", function (scenario: string) {
  const check = CHECKS[scenario];
  if (!check) return;
  check(this);
  this.validationOutcome = { valid: true };
});

Then("CLI配布文書検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
