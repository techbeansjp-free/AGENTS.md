import assert from "node:assert/strict";
import fs from "node:fs";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class IsolatedCopyTrustAnchorWorld extends WorkflowWorld {}

const { Given, Then, When } = stepDefinitions<IsolatedCopyTrustAnchorWorld>();

const QUALITY_PATH = ".agent-skill-chain/docs/02_品質基準.md";
const PLAN_PATH = ".agent-skill-chain/templates/issue/03_実装計画.md";

function readIsolatedCopyDocuments(): { quality: string; plan: string } {
  return {
    quality: fs.readFileSync(QUALITY_PATH, "utf8"),
    plan: fs.readFileSync(PLAN_PATH, "utf8"),
  };
}

Given("隔離copy検査の配布規範と実装計画templateがある", function () {
  assert.equal(fs.existsSync(QUALITY_PATH), true);
  assert.equal(fs.existsSync(PLAN_PATH), true);
});

When("trust anchor境界の記述を検査する", function () {
  assert.doesNotThrow(readIsolatedCopyDocuments);
});

Then("Git依存検査の実行場所と外部anchorが定義されている", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.match(quality, /trust anchorをcandidateの外部で検査前に固定/);
  assert.match(quality, /Git metadataをread-only/);
  assert.match(plan, /検査分類・実行場所\/trust anchor/);
});

Then("candidate由来のrepositoryとoriginとcommitは禁止されている", function () {
  const { quality } = readIsolatedCopyDocuments();
  for (const authority of ["`.git`", "origin", "commit"])
    assert.match(
      quality,
      new RegExp(`${authority}.*authority`),
      `${authority}の禁止契約がありません`,
    );
});

Then("no-index検査は終了値ではなく空の標準出力を合格条件にする", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.match(quality, /`git diff --check --no-index`/);
  assert.match(quality, /stdoutが空/);
  assert.match(plan, /合格observable/);
});

Then("Git非依存検査はGit状態を合成せずcopy内で実行する", function () {
  const { quality } = readIsolatedCopyDocuments();
  assert.match(quality, /Git非依存検査/);
  assert.match(quality, /通常fileのcopy/);
  assert.match(quality, /Git repositoryを生成しない/);
});
