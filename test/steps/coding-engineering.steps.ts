import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkDirectoryGuides } from "../../scripts/check_directory_guides.js";
import { checkSkillTemplateContracts } from "../../scripts/check_skill_templates.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface CodingEngineeringWorld extends WorkflowWorld {
  codingRoot: string;
  codingResult: ReturnType<typeof checkSkillTemplateContracts>;
}
const { Given, When, Then } = stepDefinitions<CodingEngineeringWorld>();
const skillPath = ".agent-skill-chain/skills/coding-engineering";

Given("Coding Engineeringを含む隔離package資産がある", function () {
  this.codingRoot = this.temp("asc-coding-engineering-");
  for (const directory of [
    "skills",
    "templates",
    "docs",
    "policy",
    "schemas",
    "hooks",
  ]) {
    fs.cpSync(
      path.join(".agent-skill-chain", directory),
      path.join(this.codingRoot, ".agent-skill-chain", directory),
      { recursive: true },
    );
  }
  for (const file of ["AGENTS.md", ".agent-skill-chain/00_利用案内.md"])
    fs.copyFileSync(file, path.join(this.codingRoot, file));
});

When("Coding Engineeringの配布参照を検証する", function () {
  this.codingResult = checkSkillTemplateContracts(this.codingRoot);
});
When("冪等性Lensを欠落させて配布参照を検証する", function () {
  fs.unlinkSync(
    path.join(this.codingRoot, skillPath, "lenses/idempotency-concurrency.md"),
  );
  this.codingResult = checkSkillTemplateContracts(this.codingRoot);
});
When("未登録skillを追加して配布参照を検証する", function () {
  fs.mkdirSync(
    path.join(this.codingRoot, ".agent-skill-chain/skills/unregistered"),
  );
  this.codingResult = checkSkillTemplateContracts(this.codingRoot);
});
When("Lensにpackage境界外参照を追加して配布参照を検証する", function () {
  fs.appendFileSync(
    path.join(this.codingRoot, skillPath, "lenses/unix-ddd.md"),
    "\n[不正な参照](../../../../outside.md)\n",
  );
  this.codingResult = checkSkillTemplateContracts(this.codingRoot);
});
Then("内部skillの参照とdirectory入口は有効でStepは12件である", function () {
  assert.equal(
    this.codingResult.valid,
    true,
    this.codingResult.errors.join("; "),
  );
  assert.equal(this.codingResult.skills, 12);
  const guides = checkDirectoryGuides(this.codingRoot);
  assert.equal(guides.valid, true, guides.errors.join("; "));
  assert.equal(guides.entries[`${skillPath}/lenses`], `${skillPath}/SKILL.md`);
});
Then("欠落したLensへの到達不能を報告する", function () {
  assert.equal(this.codingResult.valid, false);
  assert.match(
    this.codingResult.errors.join("; "),
    /idempotency-concurrency\.md/u,
  );
});
Then("skillの正規集合違反を報告する", function () {
  assert.equal(this.codingResult.valid, false);
  assert.match(this.codingResult.errors.join("; "), /正規集合.*unregistered/u);
});
Then("Lensの不正な参照先を報告する", function () {
  assert.equal(this.codingResult.valid, false);
  assert.match(
    this.codingResult.errors.join("; "),
    /参照先が不正.*outside\.md/u,
  );
});

When("Lensにタイトル付き境界外参照を追加して配布参照を検証する", function () {
  fs.appendFileSync(
    path.join(this.codingRoot, skillPath, "lenses/unix-ddd.md"),
    '\n[不正な参照](../../../../outside.md "説明")\n',
  );
  this.codingResult = checkSkillTemplateContracts(this.codingRoot);
});
