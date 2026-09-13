import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../src/cli.js";
import {
  detectArtifactUnitWarnings,
  type IssueScopeWarning,
} from "../../src/domain/issue.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface ArtifactUnitWorld extends WorkflowWorld {
  markdown: string;
  warnings: readonly IssueScopeWarning[];
  issuePath: string;
  cliStatus: number;
  cliResult: {
    valid: boolean;
    errors: string[];
    warnings: IssueScopeWarning[];
    mode: string;
    blockedOperations: string[];
  };
  baselineCliStatus: number;
  baselineCliResult: ArtifactUnitWorld["cliResult"];
  contractDocuments: string[];
}

const { Given, When, Then } = stepDefinitions<ArtifactUnitWorld>();
const repositoryRoot = process.cwd();

function document(inScope: string, outside = ""): string {
  return `# 00 要求定義

## 2. 対象範囲

### 2.1 対象内（必須）

${inScope}

### 2.2 対象外（必須）

${outside}
`;
}

async function captureCli(issuePath: string): Promise<{
  status: number;
  result: ArtifactUnitWorld["cliResult"];
}> {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await main(["issue", "validate", `--path=${issuePath}`]);
    return {
      status,
      result: JSON.parse(output) as ArtifactUnitWorld["cliResult"],
    };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function materializeFullTemplate(): string {
  return fs
    .readFileSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/templates/issue/00_要求定義_full.md",
      ),
      "utf8",
    )
    .split("\n")
    .map((line) =>
      line.startsWith("#")
        ? line
        : line
            .replaceAll("applicable / not-applicable", "not-applicable")
            .replace(/（[^）\n]+）/gu, "具体的な記入済み内容")
            .replace(/<[^>\n]+>/gu, "記入済み")
            .replace(/\{[^}\n]+\}/gu, "記入済み"),
    )
    .join("\n");
}

function considerationDocument(): string {
  const rows = ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"]
    .map(
      (id) =>
        `| ${id} | 対象 | not-applicable | CLIだけのため対象外 | SCN-INT-ARTUNIT-008で確認 |`,
    )
    .join("\n");
  return `# 検証済み成果物\n\n${rows}\n`;
}

function createFullIssue(world: ArtifactUnitWorld, valid: boolean): string {
  const issuePath = world.temp("asc-artifact-unit-");
  const requirement = `${materializeFullTemplate().replace(
    /^- \[成果物:feature\].*$/mu,
    "- [成果物:feature] CLI warning\n- [成果物:contract] JSON contract",
  )}

Scenario: SCN-INT-ARTUNIT-008 成果物単位を検証する
Given 記入済みである
When 検証する
Then 成否を維持する
`;
  fs.writeFileSync(
    path.join(issuePath, "00_要求定義.md"),
    valid ? requirement : requirement.replace("## 3. 利害関係者", "## 3. 欠落"),
  );
  for (const name of ["01_要件定義.md", "02_設計.md", "03_実装計画.md"])
    fs.writeFileSync(path.join(issuePath, name), considerationDocument());
  return issuePath;
}

Given("対象内にfeatureとcontractの成果物markerがある", function () {
  this.markdown = document(
    "- [成果物:feature] CLI warning\n- [成果物:contract] JSON contract",
  );
});

Given("対象内にadrの成果物markerが2件ある", function () {
  this.markdown = document(
    "- [成果物:adr] decision one\n- [成果物:adr] decision two",
  );
});

Given("対象内に通常の箇条書きだけがある", function () {
  this.markdown = document("- CLI warning\n- JSON contract");
});

Given("対象内にfeatureの成果物markerが1件ある", function () {
  this.markdown = document("- [成果物:feature] CLI warning");
});

Given("対象内にmalformedと入れ子の成果物markerだけがある", function () {
  this.markdown = document(
    "- [成果物:unknown] unknown\n- [成果物:feature]\n  - [成果物:contract] nested\n - [成果物:adr] indented",
  );
});

Given("対象外sectionに成果物markerが2件ある", function () {
  this.markdown = document(
    "- one unit",
    "- [成果物:feature] outside\n- [成果物:contract] outside",
  );
});

Given("対象内のcode fenceに成果物markerが2件ある", function () {
  this.markdown = document(
    "```markdown\n- [成果物:feature] example\n- [成果物:contract] example\n```",
  );
});

Given("対象内にinline code説明を持つ成果物markerが2件ある", function () {
  this.markdown = document(
    "- [成果物:feature] `issue validate` warning\n- [成果物:contract] `warnings` JSON contract",
  );
});

When("成果物単位warningを検出する", function () {
  this.warnings = detectArtifactUnitWarnings(this.markdown);
});

Then("codeとcount 2とkindを持つwarningを1件返す", function () {
  assert.equal(this.warnings.length, 1);
  assert.deepEqual(this.warnings[0], {
    code: "ASC-ISSUE-ARTIFACT-UNIT-001",
    count: 2,
    kinds: ["contract", "feature"],
    message:
      "対象内に独立した成果物単位が複数あります。1 Issue＝成果物1単位を目安に分割を検討してください。",
  });
});

Then("count 2とadrだけを持つwarningを1件返す", function () {
  assert.equal(this.warnings.length, 1);
  assert.equal(this.warnings[0]?.count, 2);
  assert.deepEqual(this.warnings[0]?.kinds, ["adr"]);
});

Then("成果物単位warningは空である", function () {
  assert.deepEqual(this.warnings, []);
});

Given("配布する成果物単位marker契約がある", function () {
  this.contractDocuments = [];
});

When("workflowと3 templateとCLI helpを読む", function () {
  this.contractDocuments = [
    ".agent-skill-chain/docs/01_開発ワークフロー.md",
    ".agent-skill-chain/templates/issue/00_要求定義_full.md",
    ".agent-skill-chain/templates/issue/00_要求定義_quick.md",
    ".agent-skill-chain/templates/issue/00_要求定義_poc.md",
    "src/cli-usage.ts",
  ].map((file) => fs.readFileSync(path.join(repositoryRoot, file), "utf8"));
});

Then(
  "全文書が結合度と補助指標とmode別固定費とmarkerの非停止性を案内する",
  function () {
    for (const text of this.contractDocuments) {
      assert.match(text, /結合度/u);
      assert.match(text, /45分/u);
      assert.match(text, /補助指標/u);
      assert.match(text, /固定費/u);
      assert.match(text, /長いだけでは分割し(?:ない|ません)/u);
      assert.match(text, /切り戻/u);
      assert.match(text, /review担当|reviewの担当者/u);
      assert.match(text, /先(?:行|に)merge/u);
      assert.match(text, /失敗.*(?:影響|巻き戻)/u);
      assert.match(text, /Step 0〜11/u);
      assert.match(text, /PR.*review/u);
      assert.match(text, /既定branch追随.*Step 9/u);
      assert.match(text, /有限review予算/u);
      assert.doesNotMatch(text, /45分(?:を)?超(?:える)?見込みなら.*分割/u);
    }
    const [workflow, full, quick, poc, help] = this.contractDocuments;
    assert.match(workflow!, /同一scope最大6回/u);
    assert.match(workflow!, /取り直し2回/u);
    assert.match(workflow!, /通算8回/u);
    assert.match(
      workflow!,
      /fullの00 §2\.1にあるtop-level bullet.*非停止warning.*quick\/pocの集約形式はmarker warningの判定対象外/u,
    );
    assert.match(full!, /^- \[成果物:feature\] .+$/mu);
    assert.match(full!, /adr\|contract\|feature\|documentation\|migration/u);
    assert.match(full!, /top-level markerが2件以上/u);
    assert.match(full!, /validation成否は変えない/u);
    assert.match(full!, /full.*quick\/pocより固定費が大き/u);
    for (const aggregate of [quick, poc]) {
      assert.match(
        aggregate!,
        /^- 対象内:.*複数成果物markerの非停止warningはfullだけに適用し、quick\/poc集約形式では適用しない.*$/mu,
      );
      assert.doesNotMatch(aggregate!, /^\s+- \[成果物:/mu);
      assert.match(aggregate!, /集約00でfullより固定費が小さい/u);
    }
    assert.match(help!, /fullの00 §2\.1直下/u);
    assert.match(
      help!,
      /成果物:adr\|contract\|feature\|documentation\|migration/u,
    );
    assert.match(help!, /quick\/poc集約形式はmarker warningの判定対象外/u);
    assert.match(help!, /full.*quick\/pocより固定費が大き/u);
    assert.match(
      help!,
      /valid、errors、mode、blockedOperations、終了値を変更しません/u,
    );
  },
);

Given("成果物markerを2件持つvalidなfull Issue fixtureがある", function () {
  this.issuePath = createFullIssue(this, true);
});

Given("成果物markerを2件持つinvalidなfull Issue fixtureがある", function () {
  this.issuePath = createFullIssue(this, false);
});

When("実CLIで成果物単位を検証する", async function () {
  const marked = await captureCli(this.issuePath);
  this.cliStatus = marked.status;
  this.cliResult = marked.result;

  const requirementPath = path.join(this.issuePath, "00_要求定義.md");
  fs.writeFileSync(
    requirementPath,
    fs
      .readFileSync(requirementPath, "utf8")
      .replace(
        /^- \[成果物:(?:adr|contract|feature|documentation|migration)\] (.+)$/gmu,
        "- $1",
      ),
  );
  const baseline = await captureCli(this.issuePath);
  this.baselineCliStatus = baseline.status;
  this.baselineCliResult = baseline.result;
});

function assertOnlyWarningChanged(world: ArtifactUnitWorld): void {
  assert.equal(world.cliStatus, world.baselineCliStatus);
  assert.equal(world.cliResult.valid, world.baselineCliResult.valid);
  assert.deepEqual(world.cliResult.errors, world.baselineCliResult.errors);
  assert.equal(world.cliResult.mode, world.baselineCliResult.mode);
  assert.deepEqual(
    world.cliResult.blockedOperations,
    world.baselineCliResult.blockedOperations,
  );
  assert.equal(
    world.baselineCliResult.warnings.some(
      (warning) => warning.code === "ASC-ISSUE-ARTIFACT-UNIT-001",
    ),
    false,
  );
}

Then("終了値0のまま成果物単位warningを返す", function () {
  assertOnlyWarningChanged(this);
  assert.equal(this.cliStatus, 0);
  assert.equal(this.cliResult.valid, true, this.cliResult.errors.join("\n"));
  assert.equal(this.cliResult.warnings[0]?.code, "ASC-ISSUE-ARTIFACT-UNIT-001");
});

Then("終了値1のままerrorと成果物単位warningを返す", function () {
  assertOnlyWarningChanged(this);
  assert.equal(this.cliStatus, 1);
  assert.equal(this.cliResult.valid, false);
  assert.ok(this.cliResult.errors.length > 0);
  assert.equal(this.cliResult.warnings[0]?.code, "ASC-ISSUE-ARTIFACT-UNIT-001");
});
