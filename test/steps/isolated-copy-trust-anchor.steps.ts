import assert from "node:assert/strict";
import fs from "node:fs";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class IsolatedCopyTrustAnchorWorld extends WorkflowWorld {}

const { Given, Then, When } = stepDefinitions<IsolatedCopyTrustAnchorWorld>();

const QUALITY_PATH = ".agent-skill-chain/docs/02_品質基準.md";
const PLAN_PATH = ".agent-skill-chain/templates/issue/03_実装計画.md";

const QUALITY_CONTRACTS = [
  "Git非依存検査 | 通常fileのcopy内で実行し、Git repositoryを生成しない",
  "trust anchorをcandidateの外部で検査前に固定し、そのGit metadataをread-onlyでcandidate work treeに結び付ける",
  "`git diff --check --no-index`のstdoutが空",
  "candidateが作った`.git`をauthorityにしない",
  "candidateが作ったoriginをauthorityにしない",
  "candidateが作ったcommitをauthorityにしない",
  "外部の固定済みtrust anchorをread-onlyで供給できないtrusted repository依存検査はfail closedとする",
  "終了値だけをwhitespace不備と判定しない",
] as const;

const PLAN_CONTRACTS = [
  "隔離copyを使うSCNは、Git非依存、trusted repository依存、no-index差分のいずれかを記録する",
  "trusted repository依存検査はcandidate外部で事前に固定したtrust anchorとread-only Git metadataを記録し",
  "candidate内で生成した`.git`、origin、commitをauthorityにしない",
  "`git diff --check --no-index`のstdoutが空であることを合格observableにする",
] as const;

function readIsolatedCopyDocuments(): { quality: string; plan: string } {
  return {
    quality: fs.readFileSync(QUALITY_PATH, "utf8"),
    plan: fs.readFileSync(PLAN_PATH, "utf8"),
  };
}

function missingContracts(
  document: string,
  contracts: readonly string[],
): string[] {
  return contracts.filter((contract) => !document.includes(contract));
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
  assert.equal(missingContracts(quality, QUALITY_CONTRACTS).length, 0);
  assert.equal(missingContracts(plan, PLAN_CONTRACTS).length, 0);
  assert.match(plan, /検査分類・実行場所\/trust anchor/);
});

Then("candidate由来のrepositoryとoriginとcommitは禁止されている", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.equal(missingContracts(quality, QUALITY_CONTRACTS).length, 0);
  assert.equal(missingContracts(plan, PLAN_CONTRACTS).length, 0);
});

Then("配布規範とtemplateの契約削除変異をすべて検出する", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  for (const [document, contracts] of [
    [quality, QUALITY_CONTRACTS],
    [plan, PLAN_CONTRACTS],
  ] as const)
    for (const contract of contracts) {
      const mutated = document.replace(contract, "");
      assert.notEqual(mutated, document, `変異対象がありません: ${contract}`);
      assert.deepEqual(missingContracts(mutated, contracts), [contract]);
    }
});

Then("no-index検査は終了値ではなく空の標準出力を合格条件にする", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.equal(missingContracts(quality, QUALITY_CONTRACTS).length, 0);
  assert.equal(missingContracts(plan, PLAN_CONTRACTS).length, 0);
});

Then("Git非依存検査はGit状態を合成せずcopy内で実行する", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.equal(missingContracts(quality, QUALITY_CONTRACTS).length, 0);
  assert.equal(missingContracts(plan, PLAN_CONTRACTS).length, 0);
});
