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
  fs.writeFileSync(
    path.join(this.codingRoot, "outside.md"),
    "境界外の参照先\n",
  );
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

When(
  "Step 9のCoding Engineering{string}参照を{string}にして配布参照を検証する",
  function (entry: string, state: string) {
    const file = path.join(
      this.codingRoot,
      ".agent-skill-chain/skills/step-09-implement/SKILL.md",
    );
    const markdown = fs.readFileSync(file, "utf8");
    const links: Record<string, string> = {
      本文: "[Coding Engineering Skill](../coding-engineering/SKILL.md)",
      索引: "[Coding Engineering索引](../coding-engineering/index.md)",
    };
    const link = links[entry];
    assert.ok(link);
    assert.ok(markdown.includes(link), "変更前にはStep 9からの接続が存在する");
    const replacements: Record<string, string> = {
      削除: "Coding Engineering Skill",
      コメント: `<!-- ${link} -->`,
      インラインコード: "`" + link + "`",
      コード例: `\n\`\`\`markdown\n${link}\n\`\`\`\n`,
    };
    const replacement = replacements[state];
    assert.notEqual(replacement, undefined);
    fs.writeFileSync(file, markdown.replace(link, replacement!));
    assert.ok(fs.existsSync(path.join(this.codingRoot, skillPath, "SKILL.md")));
    this.codingResult = checkSkillTemplateContracts(this.codingRoot);
  },
);
Then("Step 9からCoding Engineeringへの接続欠落を報告する", function () {
  assert.equal(this.codingResult.valid, false);
  assert.match(
    this.codingResult.errors.join("; "),
    /Step 9からCoding Engineeringへの参照がありません/u,
  );
});

When("Step 9のrouting契約を{string}に変更する", function (change: string) {
  const file = path.join(
    this.codingRoot,
    ".agent-skill-chain/skills/step-09-implement/SKILL.md",
  );
  const markdown = fs.readFileSync(file, "utf8");
  const zeroRead =
    "Coding Engineering本文・索引・Lensは読まず、0 Lensを優先する";
  const softBudget = "これはsoft budgetでありhard limitや停止条件ではない。";
  const mutations: Record<string, [string, string]> = {
    local本文必読: [
      zeroRead,
      "Coding Engineering本文を読み、索引・Lensは読まない",
    ],
    local索引必読: [
      zeroRead,
      "Coding Engineering索引を読み、本文・Lensは読まない",
    ],
    localLens必読: [
      zeroRead,
      "Coding Engineering本文・索引は読まず、Lensを1件読む",
    ],
    全変更で本文必読: [
      "## 実装時のCoding Engineering",
      "## 実装時のCoding Engineering\n\nすべての変更でCoding Engineering本文を先に読む。",
    ],
    bounded本文必読: [
      "から必要ならLens 0〜1件。本文は読まない",
      "から本文を必ず読み、必要ならLens 0〜1件",
    ],
    risk不明を軽量経路へ: [
      "risky・cross-boundary、または境界・riskが不明",
      "risky・cross-boundaryのみ。境界・risk不明はlocal経路へ進む",
    ],
    risky優先を削除: [
      "risky・cross-boundary・境界/risk不明の経路を優先し、影響が小さくても省略経路へ入れない。",
      "",
    ],
    "hard limit化": [softBudget, "候補3件を超えたら停止する。"],
    "soft budgetをコメント化": [softBudget, `<!-- ${softBudget} -->`],
    "soft budgetをコード例化": [
      softBudget,
      `\n\`\`\`text\n${softBudget}\n\`\`\`\n`,
    ],
  };
  const mutation = mutations[change];
  assert.ok(mutation);
  assert.ok(markdown.includes(mutation[0]), "変更前の契約が存在する");
  fs.writeFileSync(file, markdown.replace(...mutation));
  this.codingResult = checkSkillTemplateContracts(this.codingRoot);
});
Then("入口を維持していてもrouting契約違反を報告する", function () {
  assert.equal(this.codingResult.valid, false);
  assert.ok(
    this.codingResult.errors.some((error) =>
      error.includes("Coding Engineering routing契約が変更されています"),
    ),
  );
  assert.ok(
    !this.codingResult.errors.some((error) =>
      error.includes("Coding Engineeringへの参照がありません"),
    ),
  );
});

When("Step 9のroutingを空白とCRLFだけ変更する", function () {
  const file = path.join(
    this.codingRoot,
    ".agent-skill-chain/skills/step-09-implement/SKILL.md",
  );
  const markdown = fs.readFileSync(file, "utf8");
  fs.writeFileSync(
    file,
    markdown.replace(
      /## 実装時のCoding Engineering\n[\s\S]*?(?=\n## )/u,
      (section) => section.replace(/\|/gu, "|  ").replace(/\n/gu, "  \r\n"),
    ),
  );
  this.codingResult = checkSkillTemplateContracts(this.codingRoot);
});
