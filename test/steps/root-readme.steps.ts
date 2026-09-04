import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkCliContract } from "../../scripts/check_cli_contract.js";
import {
  LEGACY_LIFECYCLE_ALIASES,
  PUBLIC_LIFECYCLE_COMMANDS,
} from "../../src/cli-contract.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface RootReadmeWorld extends WorkflowWorld {
  cliCheck?: ReturnType<typeof checkCliContract>;
  contractCheck?: ReturnType<typeof checkCliContract>;
  packageCheck?: boolean;
  readme: string;
  /** 配布される中央利用案内。公開入口の記述を同じ条件で検査する（Issue #1213）。 */
  guide: string;
  root: string;
}

const { Given, When, Then } = stepDefinitions<RootReadmeWorld>();

const README = "README.md";
const CONTRACT_FILES = [
  "package.json",
  README,
  ".agent-skill-chain/00_利用案内.md",
  "docs/specs/04_機能/01_ワークフローv0.3.md",
  "docs/specs/12_運用保守/00_運用設計.md",
  "docs/specs/13_移行・廃止/01_移行方針.md",
] as const;

Given("repository rootに利用者向けREADMEがある", function () {
  this.root = process.cwd();
  const readme = path.join(this.root, README);
  assert.equal(
    fs.existsSync(readme),
    true,
    "repository rootにREADME.mdが必要です",
  );
});

When("READMEの公開案内を検査する", function () {
  this.readme = fs.readFileSync(path.join(this.root, README), "utf8");
  this.guide = fs.readFileSync(
    path.join(this.root, ".agent-skill-chain/00_利用案内.md"),
    "utf8",
  );
});

Then(
  "READMEは製品目的と前提条件と現行の公開CLI 4 commandを記載する",
  function () {
    assert.match(this.readme, /人とAI agent/u);
    assert.match(this.readme, /Node\.js 20以上/u);
    assert.match(this.readme, /npm/u);
    for (const command of PUBLIC_LIFECYCLE_COMMANDS)
      assert.match(
        this.readme,
        new RegExp(`npx\\s+agent-skill-chain\\s+${command}\\b`, "u"),
      );
    /**
     * **取得元はnpm registryではなくGit remoteである。** `npx agent-skill-chain`
     * だけを案内すると registry を引いて404になる（Issue #1213）。README と
     * 配布される中央利用案内の**両方**が、Git remote指定と版固定の形、および
     * 短縮表記であることの断りを持つ。
     */
    for (const document of [this.readme, this.guide]) {
      assert.match(document, /npx github:techbeansjp-free\/AGENTS\.md /u);
      assert.match(document, /npx github:techbeansjp-free\/AGENTS\.md#<tag>/u);
      assert.match(document, /短縮表記/u);
      assert.match(document, /registry/u);
    }
    /** registry前提の版固定形を案内し続けない。 */
    assert.doesNotMatch(this.guide, /`agent-skill-chain@<version>`とする/u);
  },
);

Then("READMEは旧CLI aliasをnpx commandとして推奨しない", function () {
  for (const alias of [...Object.keys(LEGACY_LIFECYCLE_ALIASES), "setup"])
    assert.doesNotMatch(
      this.readme,
      new RegExp(`npx\\s+agent-skill-chain(?:@[^\\s]+)?\\s+${alias}\\b`, "u"),
    );
});

Then("READMEは対象directoryとpreview既定とapply条件を明示する", function () {
  assert.match(this.readme, /対象directoryを省略した場合は現在directory/u);
  assert.match(this.readme, /--root=\./u);
  assert.match(this.readme, /previewが既定/u);
  assert.match(this.readme, /--apply/u);
});

Then("READMEはhost連携と規範と仕様の正本へ有効なlinkを持つ", function () {
  for (const managed of [
    ".claude/skills/asc-step/SKILL.md",
    ".agents/skills/asc-step/SKILL.md",
  ])
    assert.ok(this.readme.includes(`\`${managed}\``));

  const requiredTargets = [
    "AGENTS.md",
    ".agent-skill-chain/00_利用案内.md",
    ".agent-skill-chain/docs/00_運用ポリシー.md",
    ".agent-skill-chain/docs/01_開発ワークフロー.md",
    ".agent-skill-chain/docs/02_品質基準.md",
    "docs/specs/00_利用案内.md",
  ];
  assert.match(this.readme, /非規範的な公開入口/u);
  for (const target of requiredTargets) {
    assert.ok(this.readme.includes(`](${target})`), target);
    assert.equal(fs.existsSync(path.join(this.root, target)), true, target);
  }
});

When("実READMEのCLI契約と配布物収録設定を検査する", function () {
  this.cliCheck = checkCliContract(this.root);
  const metadata = JSON.parse(
    fs.readFileSync(path.join(this.root, "package.json"), "utf8"),
  ) as { files?: string[] };
  const packageCheck = fs.readFileSync(
    path.join(this.root, "scripts", "check_package_contents.ts"),
    "utf8",
  );
  this.packageCheck =
    metadata.files?.includes(README) === true &&
    packageCheck.includes(`"${README}"`);
});

Then("両方の公開README検査が成功する", function () {
  assert.equal(this.cliCheck?.valid, true, this.cliCheck?.errors.join("; "));
  assert.equal(this.packageCheck, true);
});

Given("公開commandを欠落させたREADME fixtureがある", function () {
  this.root = this.temp("asc-root-readme-drift-");
  for (const relative of CONTRACT_FILES) {
    const destination = path.join(this.root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.resolve(relative), destination);
  }
  const readme = path.join(this.root, README);
  fs.writeFileSync(
    readme,
    fs
      .readFileSync(readme, "utf8")
      .replaceAll(
        "npx agent-skill-chain update",
        "npx agent-skill-chain refresh",
      ),
  );
});

When("README fixtureのCLI契約検査を実行する", function () {
  this.contractCheck = checkCliContract(this.root);
});

Then("CLI契約検査はREADMEのcommand driftを拒否する", function () {
  assert.equal(this.contractCheck?.valid, false);
  assert.match(this.contractCheck?.errors.join(" ") ?? "", /README.*update/u);
});
