import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkProjectQualityContract } from "../../scripts/check_project_quality.js";

class ProtectionBootstrapWorld extends WorkflowWorld {
  root = "";
  errors: string[] = [];
}

const { Given, When, Then } = stepDefinitions<ProtectionBootstrapWorld>();

/** 契約checkが読む資産だけを複写する。候補treeを実workspaceから隔離するためである。 */
const CANDIDATE_COPY = [
  ".github",
  ".prettierignore",
  "cucumber.mjs",
  "eslint.config.mjs",
  "package.json",
  "package-lock.json",
  "scripts",
  "src",
  "test",
  "tsconfig.json",
  "tsconfig.build.json",
  ".agent-skill-chain",
] as const;

const VALIDATOR = "scripts/check_project_quality.ts";
/** 保護対象へ新たに加える題材。既存の保護対象と重ならないpathにする。 */
const ADDED = "src/types.ts";

function candidateCopy(world: ProtectionBootstrapWorld): string {
  const root = world.temp("asc-protboot-");
  for (const relative of CANDIDATE_COPY)
    fs.cpSync(path.resolve(relative), path.join(root, relative), {
      recursive: true,
    });
  return root;
}

function rewriteValidator(
  root: string,
  replace: (source: string) => string,
): void {
  const file = path.join(root, VALIDATOR);
  fs.writeFileSync(file, replace(fs.readFileSync(file, "utf8")));
}

Given("保護対象へfileを追加した候補treeがある", function () {
  this.root = candidateCopy(this);
  rewriteValidator(this.root, (source) => {
    const anchor = '  "src/lib/security.ts",\n';
    assert.ok(source.includes(anchor), "保護対象一覧の並びが変わっています");
    return source.replace(anchor, `${anchor}  "${ADDED}",\n`);
  });
});

Given("保護対象一覧を読み取れない候補treeがある", function () {
  this.root = candidateCopy(this);
  rewriteValidator(this.root, (source) =>
    source.replace(
      "const PROTECTED_FILES = [",
      "const PROTECTED_FILES: readonly string[] = buildProtectedFiles([",
    ),
  );
});

Given("追加したfileを候補側で改竄する", function () {
  fs.appendFileSync(path.join(this.root, ADDED), "\n// tampered\n");
});

When("候補treeへ品質契約checkを実行する", function () {
  this.errors = checkProjectQualityContract(
    this.root,
    process.cwd(),
  ).errors.filter(
    (error) =>
      error.includes("保護対象へ加える") || error.includes("PROTECTED_FILES"),
  );
});

Then("保護bootstrap拘束は追加fileの変更を報告する", function () {
  assert.deepEqual(this.errors, [
    `新たに保護対象へ加えるfileを同じPRで変更できません: ${ADDED}`,
  ]);
});

Then("保護bootstrap拘束は読み取り失敗を報告する", function () {
  assert.deepEqual(this.errors, [
    "候補のPROTECTED_FILESを読み取れません。保護対象の追加を検証できないため拒否します",
  ]);
});

Then("保護bootstrap拘束は何も報告しない", function () {
  assert.deepEqual(this.errors, []);
});
